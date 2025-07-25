/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "WebRenderLayerManager.h"

#include "DisplayItemCache.h"
#include "GeckoProfiler.h"
#include "mozilla/StaticPrefs_apz.h"
#include "mozilla/StaticPrefs_layers.h"
#include "mozilla/dom/BrowserChild.h"
#include "mozilla/gfx/DrawEventRecorder.h"
#include "mozilla/layers/CompositorBridgeChild.h"
#include "mozilla/layers/StackingContextHelper.h"
#include "mozilla/layers/TextureClient.h"
#include "mozilla/layers/TransactionIdAllocator.h"
#include "mozilla/layers/WebRenderBridgeChild.h"
#include "mozilla/layers/UpdateImageHelper.h"
#include "mozilla/PerfStats.h"
#include "nsDisplayList.h"
#include "nsLayoutUtils.h"
#include "WebRenderCanvasRenderer.h"
#include "LayerUserData.h"

#ifdef XP_WIN
#  include "gfxDWriteFonts.h"
#  include "mozilla/WindowsProcessMitigations.h"
#endif

namespace mozilla {

namespace gfx {
wr::PipelineId GetTemporaryWebRenderPipelineId(wr::PipelineId aMainPipeline);
}

using namespace gfx;

namespace layers {

WebRenderLayerManager::WebRenderLayerManager(nsIWidget* aWidget)
    : mWidget(aWidget),
      mLatestTransactionId{0},
      mNeedsComposite(false),
      mIsFirstPaint(false),
      mDestroyed(false),
      mTarget(nullptr),
      mPaintSequenceNumber(0),
      mWebRenderCommandBuilder(this) {
  MOZ_COUNT_CTOR(WebRenderLayerManager);
  mStateManager.mLayerManager = this;

  if (XRE_IsContentProcess() &&
      StaticPrefs::gfx_webrender_enable_item_cache_AtStartup()) {
    static const size_t kInitialCacheSize = 1024;
    static const size_t kMaximumCacheSize = 10240;

    mDisplayItemCache.SetCapacity(kInitialCacheSize, kMaximumCacheSize);
  }
}

KnowsCompositor* WebRenderLayerManager::AsKnowsCompositor() { return mWrChild; }

bool WebRenderLayerManager::Initialize(
    PCompositorBridgeChild* aCBChild, wr::PipelineId aLayersId,
    TextureFactoryIdentifier* aTextureFactoryIdentifier, nsCString& aError) {
  MOZ_ASSERT(mWrChild == nullptr);
  MOZ_ASSERT(aTextureFactoryIdentifier);

  // When we fail to initialize WebRender, it is useful to know if it has ever
  // succeeded, or if this is the first attempt.
  static bool hasInitialized = false;

  WindowKind windowKind;
  if (mWidget->GetWindowType() != widget::WindowType::Popup) {
    windowKind = WindowKind::MAIN;
  } else {
    windowKind = WindowKind::SECONDARY;
  }

  LayoutDeviceIntSize size = mWidget->GetClientSize();
  // Check widget size
  if (!wr::WindowSizeSanityCheck(size.width, size.height)) {
    gfxCriticalNoteOnce << "Widget size is not valid " << size
                        << " isParent: " << XRE_IsParentProcess();
  }

  PWebRenderBridgeChild* bridge =
      aCBChild->SendPWebRenderBridgeConstructor(aLayersId, size, windowKind);
  if (!bridge) {
    // This should only fail if we attempt to access a layer we don't have
    // permission for, or more likely, the GPU process crashed again during
    // reinitialization. We can expect to be notified again to reinitialize
    // (which may or may not be using WebRender).
    gfxCriticalNote << "Failed to create WebRenderBridgeChild.";
    aError.Assign(hasInitialized
                      ? "FEATURE_FAILURE_WEBRENDER_INITIALIZE_IPDL_POST"_ns
                      : "FEATURE_FAILURE_WEBRENDER_INITIALIZE_IPDL_FIRST"_ns);
    return false;
  }

  mWrChild = static_cast<WebRenderBridgeChild*>(bridge);
  mHasFlushedThisChild = false;

  TextureFactoryIdentifier textureFactoryIdentifier;
  wr::MaybeIdNamespace idNamespace;
  // Sync ipc
  if (!WrBridge()->SendEnsureConnected(&textureFactoryIdentifier, &idNamespace,
                                       &aError)) {
    gfxCriticalNote << "Failed as lost WebRenderBridgeChild.";
    aError.Assign(hasInitialized
                      ? "FEATURE_FAILURE_WEBRENDER_INITIALIZE_SYNC_POST"_ns
                      : "FEATURE_FAILURE_WEBRENDER_INITIALIZE_SYNC_FIRST"_ns);
    return false;
  }

  if (textureFactoryIdentifier.mParentBackend == LayersBackend::LAYERS_NONE ||
      idNamespace.isNothing()) {
    gfxCriticalNote << "Failed to connect WebRenderBridgeChild. isParent="
                    << XRE_IsParentProcess();
    aError.Append(hasInitialized ? "_POST"_ns : "_FIRST"_ns);
    return false;
  }

  WrBridge()->SetWebRenderLayerManager(this);
  WrBridge()->IdentifyTextureHost(textureFactoryIdentifier);
  WrBridge()->SetNamespace(idNamespace.ref());
  *aTextureFactoryIdentifier = textureFactoryIdentifier;

  mDLBuilder = MakeUnique<wr::DisplayListBuilder>(
      WrBridge()->GetPipeline(), WrBridge()->GetWebRenderBackend());

  hasInitialized = true;
  return true;
}

void WebRenderLayerManager::Destroy() { DoDestroy(/* aIsSync */ false); }

void WebRenderLayerManager::DoDestroy(bool aIsSync) {
  MOZ_ASSERT(NS_IsMainThread());

  if (IsDestroyed()) {
    return;
  }

  mDLBuilder = nullptr;
  mUserData.Destroy();
  mPartialPrerenderedAnimations.Clear();

  mStateManager.Destroy();

  if (WrBridge()) {
    WrBridge()->Destroy(aIsSync);
  }

  mWebRenderCommandBuilder.Destroy();

  if (mTransactionIdAllocator) {
    // Make sure to notify the refresh driver just in case it's waiting on a
    // pending transaction. Do this at the top of the event loop so we don't
    // cause a paint to occur during compositor shutdown.
    RefPtr<TransactionIdAllocator> allocator = mTransactionIdAllocator;
    TransactionId id = mLatestTransactionId;

    RefPtr<Runnable> task = NS_NewRunnableFunction(
        "TransactionIdAllocator::NotifyTransactionCompleted",
        [allocator, id]() -> void {
          allocator->ClearPendingTransactions();
          allocator->NotifyTransactionCompleted(id);
        });
    NS_DispatchToMainThread(task.forget());
  }

  // Forget the widget pointer in case we outlive our owning widget.
  mWidget = nullptr;
  mDestroyed = true;
}

WebRenderLayerManager::~WebRenderLayerManager() {
  Destroy();
  MOZ_COUNT_DTOR(WebRenderLayerManager);
}

CompositorBridgeChild* WebRenderLayerManager::GetCompositorBridgeChild() {
  return WrBridge()->GetCompositorBridgeChild();
}

void WebRenderLayerManager::GetBackendName(nsAString& name) {
  if (WrBridge()->UsingSoftwareWebRenderD3D11()) {
    name.AssignLiteral("WebRender (Software D3D11)");
  } else if (WrBridge()->UsingSoftwareWebRenderOpenGL()) {
    name.AssignLiteral("WebRender (Software OpenGL)");
  } else if (WrBridge()->UsingSoftwareWebRender()) {
    name.AssignLiteral("WebRender (Software)");
  } else if (WrBridge()->GetUseLayerCompositor()) {
    name.AssignLiteral("WebRender Layer Compositor");
  } else {
    name.AssignLiteral("WebRender");
  }
}

uint32_t WebRenderLayerManager::StartFrameTimeRecording(int32_t aBufferSize) {
  CompositorBridgeChild* renderer = GetCompositorBridgeChild();
  if (renderer) {
    uint32_t startIndex;
    renderer->SendStartFrameTimeRecording(aBufferSize, &startIndex);
    return startIndex;
  }
  return -1;
}

void WebRenderLayerManager::StopFrameTimeRecording(
    uint32_t aStartIndex, nsTArray<float>& aFrameIntervals) {
  CompositorBridgeChild* renderer = GetCompositorBridgeChild();
  if (renderer) {
    renderer->SendStopFrameTimeRecording(aStartIndex, &aFrameIntervals);
  }
}

void WebRenderLayerManager::TakeCompositionPayloads(
    nsTArray<CompositionPayload>& aPayloads) {
  aPayloads.Clear();

  std::swap(mPayload, aPayloads);
}

bool WebRenderLayerManager::BeginTransactionWithTarget(gfxContext* aTarget,
                                                       const nsCString& aURL) {
  mTarget = aTarget;
  bool retval = BeginTransaction(aURL);
  if (!retval) {
    mTarget = nullptr;
  }
  return retval;
}

bool WebRenderLayerManager::BeginTransaction(const nsCString& aURL) {
  if (!WrBridge()->IPCOpen()) {
    gfxCriticalNote << "IPC Channel is already torn down unexpectedly\n";
    return false;
  }

  mTransactionStart = TimeStamp::Now();
  mURL = aURL;

  // Increment the paint sequence number even if test logging isn't
  // enabled in this process; it may be enabled in the parent process,
  // and the parent process expects unique sequence numbers.
  ++mPaintSequenceNumber;
  if (StaticPrefs::apz_test_logging_enabled()) {
    mApzTestData.StartNewPaint(mPaintSequenceNumber);
  }
  return true;
}

bool WebRenderLayerManager::EndEmptyTransaction(EndTransactionFlags aFlags) {
  auto clearTarget = MakeScopeExit([&] { mTarget = nullptr; });

  // If we haven't sent a display list (since creation or since the last time we
  // sent ClearDisplayList to the parent) then we can't do an empty transaction
  // because the parent doesn't have a display list for us and we need to send a
  // display list first.
  if (!WrBridge()->GetSentDisplayList()) {
    return false;
  }

  mDisplayItemCache.SkipWaitingForPartialDisplayList();

  // Don't block on hidden windows on Linux as it may block all rendering.
  const bool throttle = mWidget->IsMapped();
  mLatestTransactionId = mTransactionIdAllocator->GetTransactionId(throttle);

  if (aFlags & EndTransactionFlags::END_NO_COMPOSITE &&
      !mWebRenderCommandBuilder.NeedsEmptyTransaction()) {
    if (mPendingScrollUpdates.IsEmpty()) {
      MOZ_ASSERT(!mTarget);
      WrBridge()->SendSetFocusTarget(mFocusTarget);
      // Revoke TransactionId to trigger next paint.
      mTransactionIdAllocator->RevokeTransactionId(mLatestTransactionId);
      mLatestTransactionId = mLatestTransactionId.Prev();
      return true;
    }
  }

  LayoutDeviceIntSize size = mWidget->GetClientSize();
  WrBridge()->BeginTransaction();

  mWebRenderCommandBuilder.EmptyTransaction();

  // Get the time of when the refresh driver start its tick (if available),
  // otherwise use the time of when LayerManager::BeginTransaction was called.
  TimeStamp refreshStart = mTransactionIdAllocator->GetTransactionStart();
  if (!refreshStart) {
    refreshStart = mTransactionStart;
  }

  // Skip the synchronization for buffer since we also skip the painting during
  // device-reset status.
  if (!gfxPlatform::GetPlatform()->DidRenderingDeviceReset()) {
    if (WrBridge()->GetSyncObject() &&
        WrBridge()->GetSyncObject()->IsSyncObjectValid()) {
      WrBridge()->GetSyncObject()->Synchronize();
    }
  }

  GetCompositorBridgeChild()->EndCanvasTransaction();

  Maybe<TransactionData> transactionData;
  if (mStateManager.mAsyncResourceUpdates || !mPendingScrollUpdates.IsEmpty() ||
      WrBridge()->HasWebRenderParentCommands()) {
    transactionData.emplace();
    transactionData->mIdNamespace = WrBridge()->GetNamespace();
    transactionData->mPaintSequenceNumber = mPaintSequenceNumber;
    if (mStateManager.mAsyncResourceUpdates) {
      mStateManager.mAsyncResourceUpdates->Flush(
          transactionData->mResourceUpdates, transactionData->mSmallShmems,
          transactionData->mLargeShmems);
    }
    transactionData->mScrollUpdates = std::move(mPendingScrollUpdates);
    for (const auto& scrollId : transactionData->mScrollUpdates.Keys()) {
      nsLayoutUtils::NotifyPaintSkipTransaction(/*scroll id=*/scrollId);
    }
  }

  Maybe<wr::IpcResourceUpdateQueue> nothing;
  WrBridge()->EndEmptyTransaction(mFocusTarget, std::move(transactionData),
                                  mLatestTransactionId,
                                  mTransactionIdAllocator->GetVsyncId(),
                                  mTransactionIdAllocator->GetVsyncStart(),
                                  refreshStart, mTransactionStart, mURL);
  mTransactionStart = TimeStamp();

  MakeSnapshotIfRequired(size);
  return true;
}

void WebRenderLayerManager::EndTransactionWithoutLayer(
    nsDisplayList* aDisplayList, nsDisplayListBuilder* aDisplayListBuilder,
    WrFiltersHolder&& aFilters, WebRenderBackgroundData* aBackground,
    const double aGeckoDLBuildTime, bool aRenderOffscreen) {
  AUTO_PROFILER_TRACING_MARKER("Paint", "WrDisplayList", GRAPHICS);

  auto clearTarget = MakeScopeExit([&] { mTarget = nullptr; });

  WrBridge()->BeginTransaction();

  LayoutDeviceIntSize size = mWidget->GetClientSize();

  UniquePtr<wr::DisplayListBuilder> offscreenBuilder;
  wr::DisplayListBuilder* diplayListBuilder = mDLBuilder.get();
  DisplayItemCache* itemCache = &mDisplayItemCache;
  if (aRenderOffscreen) {
    wr::PipelineId mainId = WrBridge()->GetPipeline();
    wr::PipelineId tmpPipeline = gfx::GetTemporaryWebRenderPipelineId(mainId);
    offscreenBuilder = MakeUnique<wr::DisplayListBuilder>(
        tmpPipeline, WrBridge()->GetWebRenderBackend());
    diplayListBuilder = offscreenBuilder.get();
    itemCache = nullptr;
  }

  diplayListBuilder->Begin(itemCache);

  wr::IpcResourceUpdateQueue resourceUpdates(WrBridge());
  wr::usize builderDumpIndex = 0;
  bool containsSVGGroup = false;
  bool dumpEnabled =
      mWebRenderCommandBuilder.ShouldDumpDisplayList(aDisplayListBuilder);
  Maybe<AutoDisplayItemCacheSuppressor> cacheSuppressor;
  if (dumpEnabled) {
    cacheSuppressor.emplace(itemCache);
    printf_stderr("-- WebRender display list build --\n");
  }

  if (XRE_IsContentProcess() &&
      StaticPrefs::gfx_webrender_debug_dl_dump_content_serialized()) {
    diplayListBuilder->DumpSerializedDisplayList();
  }

  if (aDisplayList) {
    MOZ_ASSERT(aDisplayListBuilder && !aBackground);
    if (itemCache) {
      itemCache->SetDisplayList(aDisplayListBuilder, aDisplayList);
    }

    mWebRenderCommandBuilder.BuildWebRenderCommands(
        *diplayListBuilder, resourceUpdates, aDisplayList, aDisplayListBuilder,
        mScrollData, std::move(aFilters));

    aDisplayListBuilder->NotifyAndClearScrollContainerFrames();

    builderDumpIndex = mWebRenderCommandBuilder.GetBuilderDumpIndex();
    containsSVGGroup = mWebRenderCommandBuilder.GetContainsSVGGroup();
  } else {
    // ViewToPaint does not have frame yet, then render only background clolor.
    MOZ_ASSERT(!aDisplayListBuilder && aBackground);
    aBackground->AddWebRenderCommands(*diplayListBuilder);
    if (dumpEnabled) {
      printf_stderr("(no display list; background only)\n");
      builderDumpIndex = diplayListBuilder->Dump(
          /*indent*/ 1, Some(builderDumpIndex), Nothing());
    }
  }

  if (AsyncPanZoomEnabled()) {
    if (mIsFirstPaint) {
      mScrollData.SetIsFirstPaint(true);
      mIsFirstPaint = false;
    }
    mScrollData.SetPaintSequenceNumber(mPaintSequenceNumber);
    if (dumpEnabled) {
      std::stringstream str;
      str << mScrollData;
      print_stderr(str);
    }
  }

  // Since we're sending a full mScrollData that will include the new scroll
  // offsets, and we can throw away the pending scroll updates we had kept for
  // an empty transaction.
  auto scrollIdsUpdated = ClearPendingScrollInfoUpdate();
  for (ScrollableLayerGuid::ViewID update : scrollIdsUpdated) {
    nsLayoutUtils::NotifyPaintSkipTransaction(update);
  }

  // Don't block on hidden windows on Linux as it may block all rendering.
  const bool throttle = mWidget->IsMapped() && !aRenderOffscreen;
  mLatestTransactionId = mTransactionIdAllocator->GetTransactionId(throttle);

  // Get the time of when the refresh driver start its tick (if available),
  // otherwise use the time of when LayerManager::BeginTransaction was called.
  TimeStamp refreshStart = mTransactionIdAllocator->GetTransactionStart();
  if (!refreshStart) {
    refreshStart = mTransactionStart;
  }

  if (mStateManager.mAsyncResourceUpdates) {
    if (resourceUpdates.IsEmpty()) {
      resourceUpdates.ReplaceResources(
          std::move(mStateManager.mAsyncResourceUpdates.ref()));
    } else {
      WrBridge()->UpdateResources(mStateManager.mAsyncResourceUpdates.ref());
    }
    mStateManager.mAsyncResourceUpdates.reset();
  }

  if (aRenderOffscreen) {
    // Unused images are safe to discard since we know that no display list
    // references them. We Want to do this because in some contrived cases
    // we can end up generating a lot of offscreen transactions that produce
    // a lot of unused images without sending a non-offscreen transaction
    // to clean them up.
    mStateManager.DiscardUnusedImagesInTransaction(resourceUpdates);
  } else {
    // Don't discard images and fonts in an offscreen transaction. It won't
    // replace the display list in the active scene so the images may still
    // be used by the previous (which remains current) display list.
    mStateManager.DiscardImagesInTransaction(resourceUpdates);
    WrBridge()->RemoveExpiredFontKeys(resourceUpdates);
  }

  // Skip the synchronization for buffer since we also skip the painting during
  // device-reset status.
  if (!gfxPlatform::GetPlatform()->DidRenderingDeviceReset()) {
    if (WrBridge()->GetSyncObject() &&
        WrBridge()->GetSyncObject()->IsSyncObjectValid()) {
      WrBridge()->GetSyncObject()->Synchronize();
    }
  }

  GetCompositorBridgeChild()->EndCanvasTransaction();

  {
    AUTO_PROFILER_TRACING_MARKER("Paint", "ForwardDPTransaction", GRAPHICS);
    DisplayListData dlData;
    diplayListBuilder->End(dlData);
    resourceUpdates.Flush(dlData.mResourceUpdates, dlData.mSmallShmems,
                          dlData.mLargeShmems);
    dlData.mRect =
        LayoutDeviceRect(LayoutDevicePoint(), LayoutDeviceSize(size));
    dlData.mScrollData.emplace(std::move(mScrollData));
    dlData.mDLDesc.gecko_display_list_type =
        aDisplayListBuilder && aDisplayListBuilder->PartialBuildFailed()
            ? wr::GeckoDisplayListType::Full(aGeckoDLBuildTime)
            : wr::GeckoDisplayListType::Partial(aGeckoDLBuildTime);

    // convert from nanoseconds to microseconds
    auto duration = TimeDuration::FromMicroseconds(
        double(dlData.mDLDesc.builder_finish_time -
               dlData.mDLDesc.builder_start_time) /
        1000.);
    PerfStats::RecordMeasurement(PerfStats::Metric::WrDisplayListBuilding,
                                 duration);
    bool ret = WrBridge()->EndTransaction(
        std::move(dlData), mLatestTransactionId, containsSVGGroup,
        mTransactionIdAllocator->GetVsyncId(), aRenderOffscreen,
        mTransactionIdAllocator->GetVsyncStart(), refreshStart,
        mTransactionStart, mURL);
    if (!ret && itemCache) {
      // Failed to send display list, reset display item cache state.
      itemCache->Clear();
    }

    WrBridge()->SendSetFocusTarget(mFocusTarget);
    mFocusTarget = FocusTarget();
  }

  // Discard animations after calling WrBridge()->EndTransaction().
  // It updates mWrEpoch in WebRenderBridgeParent. The updated mWrEpoch is
  // necessary for deleting animations at the correct time.
  mStateManager.DiscardCompositorAnimations();

  mTransactionStart = TimeStamp();

  MakeSnapshotIfRequired(size);
  mNeedsComposite = false;
}

void WebRenderLayerManager::SetFocusTarget(const FocusTarget& aFocusTarget) {
  mFocusTarget = aFocusTarget;
}

bool WebRenderLayerManager::AsyncPanZoomEnabled() const {
  return mWidget->AsyncPanZoomEnabled();
}

IntRect ToOutsideIntRect(const gfxRect& aRect) {
  return IntRect::RoundOut(aRect.X(), aRect.Y(), aRect.Width(), aRect.Height());
}

void WebRenderLayerManager::MakeSnapshotIfRequired(LayoutDeviceIntSize aSize) {
  auto clearTarget = MakeScopeExit([&] { mTarget = nullptr; });

  if (!mTarget || !mTarget->GetDrawTarget() || aSize.IsEmpty()) {
    return;
  }

  // XXX Add other TextureData supports.
  // Only BufferTexture is supported now.

  // TODO: fixup for proper surface format.
  // The GLES spec only guarantees that RGBA can be used with glReadPixels,
  // so on Android we use RGBA.
  SurfaceFormat format =
#ifdef MOZ_WIDGET_ANDROID
      SurfaceFormat::R8G8B8A8;
#else
      SurfaceFormat::B8G8R8A8;
#endif
  RefPtr<TextureClient> texture = TextureClient::CreateForRawBufferAccess(
      WrBridge(), format, aSize.ToUnknownSize(), BackendType::SKIA,
      TextureFlags::SNAPSHOT);
  if (!texture) {
    return;
  }

  // The other side knows our ContentParentId and WebRenderBridgeChild will
  // ignore the one provided here in favour of what WebRenderBridgeParent
  // already has.
  texture->InitIPDLActor(WrBridge(), dom::ContentParentId());
  if (!texture->GetIPDLActor()) {
    return;
  }

  IntRect bounds = ToOutsideIntRect(mTarget->GetClipExtents());
  bool needsYFlip = false;
  if (!WrBridge()->SendGetSnapshot(WrapNotNull(texture->GetIPDLActor()),
                                   &needsYFlip)) {
    return;
  }

  TextureClientAutoLock autoLock(texture, OpenMode::OPEN_READ_ONLY);
  if (!autoLock.Succeeded()) {
    return;
  }
  RefPtr<DrawTarget> drawTarget = texture->BorrowDrawTarget();
  if (!drawTarget || !drawTarget->IsValid()) {
    return;
  }
  RefPtr<SourceSurface> snapshot = drawTarget->Snapshot();
  /*
    static int count = 0;
    char filename[100];
    snprintf(filename, 100, "output%d.png", count++);
    printf_stderr("Writing to :%s\n", filename);
    gfxUtils::WriteAsPNG(snapshot, filename);
    */

  Rect dst(bounds.X(), bounds.Y(), bounds.Width(), bounds.Height());
  Rect src(0, 0, bounds.Width(), bounds.Height());

  Matrix m;
  if (needsYFlip) {
    m = Matrix::Scaling(1.0, -1.0).PostTranslate(0.0, aSize.height);
  }
  SurfacePattern pattern(snapshot, ExtendMode::CLAMP, m);
  DrawTarget* dt = mTarget->GetDrawTarget();
  MOZ_RELEASE_ASSERT(dt);
  dt->FillRect(dst, pattern);

  mTarget = nullptr;
}

void WebRenderLayerManager::DiscardImages() {
  wr::IpcResourceUpdateQueue resources(WrBridge());
  mStateManager.DiscardImagesInTransaction(resources);
  WrBridge()->UpdateResources(resources);
}

void WebRenderLayerManager::DiscardLocalImages() {
  mStateManager.DiscardLocalImages();
}

void WebRenderLayerManager::DidComposite(
    TransactionId aTransactionId, const mozilla::TimeStamp& aCompositeStart,
    const mozilla::TimeStamp& aCompositeEnd) {
  if (IsDestroyed()) {
    return;
  }

  MOZ_ASSERT(mWidget);

  // Notifying the observers may tick the refresh driver which can cause
  // a lot of different things to happen that may affect the lifetime of
  // this layer manager. So let's make sure this object stays alive until
  // the end of the method invocation.
  RefPtr<WebRenderLayerManager> selfRef = this;

  // |aTransactionId| will be > 0 if the compositor is acknowledging a shadow
  // layers transaction.
  if (aTransactionId.IsValid()) {
    nsIWidgetListener* listener = mWidget->GetWidgetListener();
    if (listener) {
      listener->DidCompositeWindow(aTransactionId, aCompositeStart,
                                   aCompositeEnd);
    }
    listener = mWidget->GetAttachedWidgetListener();
    if (listener) {
      listener->DidCompositeWindow(aTransactionId, aCompositeStart,
                                   aCompositeEnd);
    }
    if (mTransactionIdAllocator) {
      mTransactionIdAllocator->NotifyTransactionCompleted(aTransactionId);
    }
  }
}

void WebRenderLayerManager::ClearCachedResources() {
  if (!WrBridge()->IPCOpen()) {
    gfxCriticalNote << "IPC Channel is already torn down unexpectedly\n";
    return;
  }
  WrBridge()->BeginClearCachedResources();
  // We flush any pending async resource updates before we clear the display
  // list items because some resources (e.g. images) might be shared between
  // multiple layer managers, not get freed here, and we want to keep their
  // states consistent.
  mStateManager.FlushAsyncResourceUpdates();
  mWebRenderCommandBuilder.ClearCachedResources();
  DiscardImages();
  mStateManager.ClearCachedResources();
  if (CompositorBridgeChild* compositorBridge = GetCompositorBridgeChild()) {
    compositorBridge->ClearCachedResources();
  }
  WrBridge()->EndClearCachedResources();
}

void WebRenderLayerManager::WrUpdated() {
  ClearAsyncAnimations();
  mStateManager.mAsyncResourceUpdates.reset();
  mWebRenderCommandBuilder.ClearCachedResources();
  DiscardLocalImages();
  mDisplayItemCache.Clear();

  if (mWidget) {
    if (dom::BrowserChild* browserChild = mWidget->GetOwningBrowserChild()) {
      browserChild->SchedulePaint();
    }
  }
}

void WebRenderLayerManager::UpdateTextureFactoryIdentifier(
    const TextureFactoryIdentifier& aNewIdentifier) {
  WrBridge()->IdentifyTextureHost(aNewIdentifier);
}

TextureFactoryIdentifier WebRenderLayerManager::GetTextureFactoryIdentifier() {
  return WrBridge()->GetTextureFactoryIdentifier();
}

void WebRenderLayerManager::SetTransactionIdAllocator(
    TransactionIdAllocator* aAllocator) {
  // When changing the refresh driver, the previous refresh driver may never
  // receive updates of pending transactions it's waiting for. So clear the
  // waiting state before assigning another refresh driver.
  if (mTransactionIdAllocator && (aAllocator != mTransactionIdAllocator)) {
    mTransactionIdAllocator->ClearPendingTransactions();

    // We should also reset the transaction id of the new allocator to previous
    // allocator's last transaction id, so that completed transactions for
    // previous allocator will be ignored and won't confuse the new allocator.
    if (aAllocator) {
      aAllocator->ResetInitialTransactionId(
          mTransactionIdAllocator->LastTransactionId());
    }
  }

  mTransactionIdAllocator = aAllocator;
}

TransactionId WebRenderLayerManager::GetLastTransactionId() {
  return mLatestTransactionId;
}

void WebRenderLayerManager::FlushRendering(wr::RenderReasons aReasons) {
  CompositorBridgeChild* cBridge = GetCompositorBridgeChild();
  if (!cBridge) {
    return;
  }
  MOZ_ASSERT(mWidget);

  // If widget bounds size is different from the last flush, consider
  // this to be a resize. It's important to use GetClientSize here,
  // because that has extra plumbing to support initial display cases
  // where the widget doesn't yet have real bounds.
  LayoutDeviceIntSize widgetSize = mWidget->GetClientSize();
  bool resizing = widgetSize != mFlushWidgetSize;
  mFlushWidgetSize = widgetSize;

  if (resizing) {
    aReasons = aReasons | wr::RenderReasons::RESIZE;
  }

  // Check for the conditions where we we force a sync flush. The first
  // flush for this child should always be sync. Resizes should be
  // sometimes be sync. Everything else can be async.
  if (!mHasFlushedThisChild ||
      (resizing && (mWidget->SynchronouslyRepaintOnResize() ||
                    StaticPrefs::layers_force_synchronous_resize()))) {
    cBridge->SendFlushRendering(aReasons);
  } else {
    cBridge->SendFlushRenderingAsync(aReasons);
  }

  mHasFlushedThisChild = true;
}

void WebRenderLayerManager::WaitOnTransactionProcessed() {
  CompositorBridgeChild* bridge = GetCompositorBridgeChild();
  if (bridge) {
    bridge->SendWaitOnTransactionProcessed();
  }
}

void WebRenderLayerManager::SendInvalidRegion(const nsIntRegion& aRegion) {
  // XXX Webrender does not support invalid region yet.

#ifndef XP_WIN
  if (WrBridge()) {
    WrBridge()->SendInvalidateRenderedFrame();
  }
#endif
}

void WebRenderLayerManager::ScheduleComposite(wr::RenderReasons aReasons) {
  WrBridge()->SendScheduleComposite(aReasons);
}

already_AddRefed<PersistentBufferProvider>
WebRenderLayerManager::CreatePersistentBufferProvider(
    const gfx::IntSize& aSize, gfx::SurfaceFormat aFormat,
    bool aWillReadFrequently) {
  // Only initialize devices if hardware acceleration may possibly be used.
  // Remoting moves hardware usage out-of-process, while will-read-frequently
  // avoids hardware acceleration entirely.
  if (!aWillReadFrequently && !gfxPlatform::UseRemoteCanvas()) {
#ifdef XP_WIN
    // Any kind of hardware acceleration is incompatible with Win32k Lockdown
    // We don't initialize devices here so that PersistentBufferProviderShared
    // will fall back to using a piece of shared memory as a backing for the
    // canvas
    if (!IsWin32kLockedDown()) {
      gfxPlatform::GetPlatform()->EnsureDevicesInitialized();
    }
#else
    gfxPlatform::GetPlatform()->EnsureDevicesInitialized();
#endif
  }

  RefPtr<PersistentBufferProvider> provider =
      PersistentBufferProviderShared::Create(
          aSize, aFormat, AsKnowsCompositor(), aWillReadFrequently);
  if (provider) {
    return provider.forget();
  }

  return WindowRenderer::CreatePersistentBufferProvider(aSize, aFormat);
}

void WebRenderLayerManager::ClearAsyncAnimations() {
  mStateManager.ClearAsyncAnimations();
}

void WebRenderLayerManager::WrReleasedImages(
    const nsTArray<wr::ExternalImageKeyPair>& aPairs) {
  mStateManager.WrReleasedImages(aPairs);
}

void WebRenderLayerManager::GetFrameUniformity(FrameUniformityData* aOutData) {
  WrBridge()->SendGetFrameUniformity(aOutData);
}

/*static*/
void WebRenderLayerManager::LayerUserDataDestroy(void* data) {
  delete static_cast<LayerUserData*>(data);
}

UniquePtr<LayerUserData> WebRenderLayerManager::RemoveUserData(void* aKey) {
  UniquePtr<LayerUserData> d(static_cast<LayerUserData*>(
      mUserData.Remove(static_cast<gfx::UserDataKey*>(aKey))));
  return d;
}

std::unordered_set<ScrollableLayerGuid::ViewID>
WebRenderLayerManager::ClearPendingScrollInfoUpdate() {
  std::unordered_set<ScrollableLayerGuid::ViewID> scrollIds(
      mPendingScrollUpdates.Keys().cbegin(),
      mPendingScrollUpdates.Keys().cend());
  mPendingScrollUpdates.Clear();
  return scrollIds;
}

bool WebRenderLayerManager::AddPendingScrollUpdateForNextTransaction(
    ScrollableLayerGuid::ViewID aScrollId,
    const ScrollPositionUpdate& aUpdateInfo) {
  mPendingScrollUpdates.LookupOrInsert(aScrollId).AppendElement(aUpdateInfo);
  return true;
}

}  // namespace layers
}  // namespace mozilla
