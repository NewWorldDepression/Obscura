/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This file contains the shared types for the performance-new client.
 */

import {
  Reducer as ReduxReducer,
  Store as ReduxStore,
} from "resource://devtools/client/shared/vendor/redux.js";

export interface PanelWindow {
  gToolbox?: any;
  gStore?: Store;
  gInit(
    perfFront: PerfFront,
    traits: RootTraits,
    pageContext: PageContext,
    openAboutProfiling: () => void
  ): Promise<void>;
  gDestroy(): void;
  gIsPanelDestroyed?: boolean;
}

/**
 * TS-TODO - Stub.
 */
export interface Target {
  // TODO
  client: any;
}

/**
 * TS-TODO - Stub.
 */
export interface Toolbox {
  target: Target;
}

/**
 * TS-TODO - Stub.
 */
export interface Commands {
  client: any;
  targetCommand: {
    targetFront: {
      // @backward-compat { version 141 } This trait is used to support Firefox < 140
      // It should be removed when ESR 128 isn't supported anymore.
      getTrait(
        traitName: "useBulkTransferForPerformanceProfile"
      ): boolean | undefined;
      getTrait(traitName: string): unknown;
    };
  };
}

/* @backward-compat { version 141 } This interface is only useful for Firefox <
 * 140. Starting Firefox 140 a gzipped ArrayBuffer is used in all cases, then
 * this interface can be replaced by MockedExports.ProfileAndAdditionalInformation
 * directly after we stop supporting older versions.
 */
export interface ProfileAndAdditionalInformation {
  profile: ArrayBuffer | MinimallyTypedGeckoProfile;
  additionalInformation?: MockedExports.ProfileGenerationAdditionalInformation;
}

/**
 * TS-TODO - Stub.
 */
export interface PerfFront {
  startProfiler: (options: RecordingSettings) => Promise<boolean>;
  getProfileAndStopProfiler: () => Promise<ProfileAndAdditionalInformation>;

  /* Note that this front also has getProfileAndStopProfilerBulk and
   * getPreviouslyRetrievedAdditionalInformation, but we don't
   * want to be able to call these functions directly, so they're commented out
   * in this interface, only specified for documentation purposes. */
  // getProfileAndStopProfilerBulk: () => Promise<ArrayBuffer>
  // getPreviouslyRetrievedAdditionalInformation: () => Promise<MockedExports.ProfileGenerationAdditionalInformation>;
  stopProfilerAndDiscardProfile: () => Promise<void>;
  getSymbolTable: (
    path: string,
    breakpadId: string
  ) => Promise<[number[], number[], number[]]>;
  isActive: () => Promise<boolean>;
  isSupportedPlatform: () => Promise<boolean>;
  on: (type: string, listener: () => void) => void;
  off: (type: string, listener: () => void) => void;
  destroy: () => void;
  getSupportedFeatures: () => Promise<string[]>;
}

/**
 * TS-TODO - Stub
 */
export interface PreferenceFront {
  clearUserPref: (prefName: string) => Promise<void>;
  getStringPref: (prefName: string) => Promise<string>;
  setStringPref: (prefName: string, value: string) => Promise<void>;
  getCharPref: (prefName: string) => Promise<string>;
  setCharPref: (prefName: string, value: string) => Promise<void>;
  getIntPref: (prefName: string) => Promise<number>;
  setIntPref: (prefName: string, value: number) => Promise<void>;
}

export interface RootTraits {
  // @backward-compat { version 141 }
  // In Firefox >= 140, this will be true, and will be missing in older
  // versions. The functionality controlled by this property can be cleaned up
  // once ESR 128 isn't supported anymore.
  useBulkTransferForPerformanceProfile?: boolean;

  // There are other properties too, but we don't list them here as they're not
  // related to the performance panel.
}

export type RecordingState =
  // The initial state before we've queried the PerfActor
  | "not-yet-known"
  // The profiler is available, we haven't started recording yet.
  | "available-to-record"
  // An async request has been sent to start the profiler.
  | "request-to-start-recording"
  // An async request has been sent to get the profile and stop the profiler.
  | "request-to-get-profile-and-stop-profiler"
  // An async request has been sent to stop the profiler.
  | "request-to-stop-profiler"
  // The profiler notified us that our request to start it actually started
  // it, or it was already started.
  | "recording";

// We are currently migrating to a new UX workflow with about:profiling.
// This type provides an easy way to change the implementation based
// on context.
export type PageContext =
  | "devtools"
  | "devtools-remote"
  | "aboutlogging"
  | "aboutprofiling"
  | "aboutprofiling-remote";

export type PrefPostfix = "" | ".remote";

export interface State {
  recordingState: RecordingState;
  recordingUnexpectedlyStopped: boolean;
  isSupportedPlatform: boolean | null;
  recordingSettings: RecordingSettings;
  initializedValues: InitializedValues | null;
  promptEnvRestart: null | string;
}

export type Selector<T> = (state: State) => T;

export type ThunkDispatch = <Returns>(action: ThunkAction<Returns>) => Returns;
export type PlainDispatch = (action: Action) => Action;
export type GetState = () => State;
export type SymbolTableAsTuple = [Uint32Array, Uint32Array, Uint8Array];
export type ProfilerFaviconData = {
  data: ArrayBuffer;
  mimeType: string;
};

/**
 * The `dispatch` function can accept either a plain action or a thunk action.
 * This is similar to a type `(action: Action | ThunkAction) => any` except this
 * allows to type the return value as well.
 */
export type Dispatch = PlainDispatch & ThunkDispatch;

export type ThunkAction<Returns> = ({
  dispatch,
  getState,
}: {
  dispatch: Dispatch;
  getState: GetState;
}) => Returns;

export interface Library {
  start: number;
  end: number;
  offset: number;
  name: string;
  path: string;
  debugName: string;
  debugPath: string;
  breakpadId: string;
  arch: string;
}

/**
 * Only provide types for the GeckoProfile as much as we need it. There is no
 * reason to maintain a full type definition here.
 * @backward-compat { version 141 } This interface is only useful for Firefox <
 * 140. Starting Firefox 140 a gzipped ArrayBuffer is used in all cases.
 */
export interface MinimallyTypedGeckoProfile {
  libs: Library[];
  processes: MinimallyTypedGeckoProfile[];
}

export type GetSymbolTableCallback = (
  debugName: string,
  breakpadId: string
) => Promise<SymbolTableAsTuple>;

export interface SymbolicationService {
  getSymbolTable: GetSymbolTableCallback;
  querySymbolicationApi: (path: string, requestJson: string) => Promise<string>;
}

/**
 * This is the type signature for the event listener that's called once the
 * profile has been obtained.
 */
export type OnProfileReceived = (
  profileAndAdditionalInformation: ProfileAndAdditionalInformation | null,
  error?: Error | string
) => void;

/**
 * This is the type signature for a function to query the browser for the
 * ID of the active tab.
 */
export type GetActiveBrowserID = () => number;

export interface RecordingSettings {
  presetName: string;
  entries: number;
  interval: number; // in milliseconds
  features: string[];
  threads: string[];
  objdirs: string[];
  // The duration is currently not wired up to the UI yet. See Bug 1587165.
  duration?: number;
}

/**
 * A Redux Reducer that knows about the performance-new client's Actions.
 */
export type Reducer<S> = (state: S | undefined, action: Action) => S;

export interface InitializedValues {
  // The current list of presets, loaded in from a JSM.
  presets: Presets;
  // Determine the current page context.
  pageContext: PageContext;
  // The list of profiler features that the current target supports.
  supportedFeatures: string[];
  // Allow about:profiling to switch back to the remote devtools panel.
  openRemoteDevTools?: () => void;
}

/**
 * Export a store that is opinionated about our State definition, and the union
 * of all Actions, as well as specific Dispatch behavior.
 */
export type Store = ReduxStore<State, Action>;

export type Action =
  | {
      type: "REPORT_PROFILER_READY";
      isActive: boolean;
    }
  | {
      type: "REPORT_PROFILER_STARTED";
    }
  | {
      type: "REPORT_PROFILER_STOPPED";
    }
  | {
      type: "REQUESTING_TO_START_RECORDING";
    }
  | {
      type: "REQUESTING_TO_STOP_RECORDING";
    }
  | {
      type: "REQUESTING_PROFILE";
    }
  | {
      type: "OBTAINED_PROFILE";
    }
  | {
      type: "CHANGE_INTERVAL";
      interval: number;
    }
  | {
      type: "CHANGE_ENTRIES";
      entries: number;
    }
  | {
      type: "CHANGE_FEATURES";
      features: string[];
      promptEnvRestart: string | null;
    }
  | {
      type: "CHANGE_THREADS";
      threads: string[];
    }
  | {
      type: "CHANGE_OBJDIRS";
      objdirs: string[];
    }
  | {
      type: "INITIALIZE_STORE";
      isSupportedPlatform: boolean;
      presets: Presets;
      pageContext: PageContext;
      openRemoteDevTools?: () => void;
      supportedFeatures: string[];
    }
  | {
      type: "CHANGE_PRESET";
      presetName: string;
      preset: PresetDefinition | undefined;
    }
  | {
      type: "UPDATE_SETTINGS_FROM_PREFERENCES";
      recordingSettingsFromPreferences: RecordingSettings;
    };

export interface InitializeStoreValues {
  isSupportedPlatform: boolean;
  presets: Presets;
  pageContext: PageContext;
  supportedFeatures: string[];
  openRemoteDevTools?: () => void;
}

export type PopupBackgroundFeatures = { [feature: string]: boolean };

// TS-TODO - Stub
export interface ContentFrameMessageManager {
  addMessageListener: (event: string, listener: (event: any) => void) => void;
  addEventListener: (event: string, listener: (event: any) => void) => void;
  sendAsyncMessage: (name: string, data: any) => void;
}

/**
 * This interface serves as documentation for all of the prefs used by the
 * performance-new client. Each preference access string access can be coerced to
 * one of the properties of this interface.
 */
export interface PerformancePref {
  /**
   * The recording preferences by default are controlled by different presets.
   * This pref stores that preset.
   */
  Preset: "devtools.performance.recording.preset";
  /**
   * Stores the total number of entries to be used in the profile buffer.
   */
  Entries: "devtools.performance.recording.entries";
  /**
   * The recording interval, stored in microseconds. Note that the StartProfiler
   * interface uses milliseconds, but this lets us store higher precision numbers
   * inside of an integer preference store.
   */
  Interval: "devtools.performance.recording.interval";
  /**
   * The features enabled for the profiler, stored as a comma-separated list.
   */
  Features: "devtools.performance.recording.features";
  /**
   * The threads to profile, stored as a comma-separated list.
   */
  Threads: "devtools.performance.recording.threads";
  /**
   * The location of the objdirs to use, stored as a comma-separated list.
   */
  ObjDirs: "devtools.performance.recording.objdirs";
  /**
   * The duration of the profiling window to use in seconds. Setting this to 0
   * will cause no profile window to be used, and the values will naturally roll
   * off from the profiling buffer.
   *
   * This is currently not hooked up to any UI. See Bug 1587165.
   */
  Duration: "devtools.performance.recording.duration";
  /**
   * Normally this defaults to https://profiler.firefox.com, but this can be overridden
   * to point the profiler to a different URL, such as http://localhost:4242/ for
   * local development workflows.
   */
  UIBaseUrl: "devtools.performance.recording.ui-base-url";
  /**
   * This pref allows tests to override the /from-browser in order to more easily
   * test the profile injection mechanism.
   */
  UIBaseUrlPathPref: "devtools.performance.recording.ui-base-url-path";
  /**
   * This controls whether we enable the active tab view when capturing in web
   * developer preset.
   * We're not enabling the active-tab view in all environments until we
   * iron out all its issues.
   */
  UIEnableActiveTabView: "devtools.performance.recording.active-tab-view.enabled";
  /**
   * The profiler popup has some introductory text explaining what it is the first
   * time that you open it. After that, it is not displayed by default.
   */
  PopupIntroDisplayed: "devtools.performance.popup.intro-displayed";
  /**
   * This preference is used outside of the performance-new type system
   * (in DevToolsStartup). It toggles the availability of the profiler menu
   * button in the customization palette.
   */
  PopupFeatureFlag: "devtools.performance.popup.feature-flag";
  /**
   * This preference controls whether about:profiling contains some Firefox
   * developer-specific options. For example when true the "more actions" menu
   * contains items to copy parameters to use with mach try perf.
   */
  AboutProfilingHasDeveloperOptions: "devtools.performance.aboutprofiling.has-developer-options";
}

/* The next 2 types bring some duplication from gecko.d.ts, but this is simpler
 * this way. */

/**
 * This is a function called by a preference observer.
 */
export type PrefObserverFunction = (
  aSubject: nsIPrefBranch,
  aTopic: "nsPref:changed",
  aData: string
) => unknown;

/**
 * This is the type of an observer we can pass to Service.prefs.addObserver and
 * Service.prefs.removeObserver.
 */
export type PrefObserver =
  | PrefObserverFunction
  | { observe: PrefObserverFunction };

/**
 * Scale a number value.
 */
export type NumberScaler = (value: number) => number;

/**
 * A collection of functions to scale numbers.
 */
export interface ScaleFunctions {
  fromFractionToValue: NumberScaler;
  fromValueToFraction: NumberScaler;
  fromFractionToSingleDigitValue: NumberScaler;
  steps: number;
}

/**
 * View mode for the Firefox Profiler front-end timeline.
 * `undefined` is defaulted to full automatically.
 */
export type ProfilerViewMode = "full" | "active-tab" | "origins";

/**
 * Panel string identifier in the profiler frontend.
 *
 * To be synchronized with:
 * https://github.com/firefox-devtools/profiler/blob/b7fe97217b5d3ae770e2b7025738a075eba9ec34/src/app-logic/tabs-handling.js#L12
 */
export type ProfilerPanel =
  | "calltree"
  | "flame-graph"
  | "stack-chart"
  | "marker-chart"
  | "marker-table"
  | "network-chart"
  | "js-tracer";

export interface PresetDefinition {
  entries: number;
  interval: number;
  features: string[];
  threads: string[];
  duration: number;
  profilerViewMode?: ProfilerViewMode;
  l10nIds: {
    popup: {
      label: string;
      description: string;
    };
    devtools: {
      label: string;
      description: string;
    };
  };
}

export interface Presets {
  [presetName: string]: PresetDefinition;
}

// Should be kept in sync with the types in https://github.com/firefox-devtools/profiler/blob/main/src/app-logic/web-channel.js .
// Compatibility is handled as follows:
//  - The front-end needs to worry about compatibility and handle older browser versions.
//  - The browser can require the latest front-end version and does not need to keep any legacy functionality for older front-end versions.

type MessageFromFrontend = {
  requestId: number;
} & RequestFromFrontend;

export type RequestFromFrontend =
  | StatusQueryRequest
  | EnableMenuButtonRequest
  | GetProfileRequest
  | GetExternalMarkersRequest
  | GetExternalPowerTracksRequest
  | GetSymbolTableRequest
  | QuerySymbolicationApiRequest
  | GetPageFaviconsRequest
  | OpenScriptInTabDebuggerRequest;

type StatusQueryRequest = { type: "STATUS_QUERY" };
type EnableMenuButtonRequest = { type: "ENABLE_MENU_BUTTON" };
type GetProfileRequest = { type: "GET_PROFILE" };
type GetExternalMarkersRequest = {
  type: "GET_EXTERNAL_MARKERS";
  startTime: number;
  endTime: number;
};
type GetExternalPowerTracksRequest = {
  type: "GET_EXTERNAL_POWER_TRACKS";
  startTime: number;
  endTime: number;
};
type GetSymbolTableRequest = {
  type: "GET_SYMBOL_TABLE";
  debugName: string;
  breakpadId: string;
};
type QuerySymbolicationApiRequest = {
  type: "QUERY_SYMBOLICATION_API";
  path: string;
  requestJson: string;
};
type GetPageFaviconsRequest = {
  type: "GET_PAGE_FAVICONS";
  pageUrls: Array<string>;
};
type OpenScriptInTabDebuggerRequest = {
  type: "OPEN_SCRIPT_IN_DEBUGGER";
  tabId: number;
  scriptUrl: string;
  line: number;
  column: number;
};

export type MessageToFrontend<R> =
  | OutOfBandErrorMessageToFrontend
  | ErrorResponseMessageToFrontend
  | SuccessResponseMessageToFrontend<R>;

type OutOfBandErrorMessageToFrontend = {
  errno: number;
  error: string;
};

type ErrorResponseMessageToFrontend = {
  type: "ERROR_RESPONSE";
  requestId: number;
  error: string;
};

type SuccessResponseMessageToFrontend<R> = {
  type: "SUCCESS_RESPONSE";
  requestId: number;
  response: R;
};

export type ResponseToFrontend =
  | StatusQueryResponse
  | EnableMenuButtonResponse
  | GetProfileResponse
  | GetExternalMarkersResponse
  | GetExternalPowerTracksResponse
  | GetSymbolTableResponse
  | QuerySymbolicationApiResponse
  | GetPageFaviconsResponse
  | OpenScriptInTabDebuggerResponse;

type StatusQueryResponse = {
  menuButtonIsEnabled: boolean;
  // The version indicates which message types are supported by the browser.
  // No version:
  //   Shipped in Firefox 76.
  //   Supports the following message types:
  //    - STATUS_QUERY
  //    - ENABLE_MENU_BUTTON
  // Version 1:
  //   Shipped in Firefox 93.
  //   Adds support for the following message types:
  //    - GET_PROFILE
  //    - GET_SYMBOL_TABLE
  //    - QUERY_SYMBOLICATION_API
  // Version 2:
  //   Shipped in Firefox 121.
  //   Adds support for the following message types:
  //    - GET_EXTERNAL_POWER_TRACKS
  version: number;
};
type EnableMenuButtonResponse = void;

/* @backward-compat { version 141 } When the target is < v140, this is a JS
 * object. Starting v140 this is an ArrayBuffer containing a gzipped profile. */
type GetProfileResponse = ArrayBuffer | MinimallyTypedGeckoProfile;
type GetExternalMarkersResponse = Array<object>;
type GetExternalPowerTracksResponse = Array<object>;
type GetSymbolTableResponse = SymbolTableAsTuple;
type QuerySymbolicationApiResponse = string;
type GetPageFaviconsResponse = Array<ProfilerFaviconData | null>;
type OpenScriptInTabDebuggerResponse = void;

/**
 * This represents an event channel that can talk to a content page on the web.
 * This interface is a manually typed version of toolkit/modules/WebChannel.sys.mjs
 * and is opinionated about the types of messages we can send with it.
 *
 * The definition is here rather than gecko.d.ts because it was simpler than getting
 * generics working with the ChromeUtils.import machinery.
 */
export class ProfilerWebChannel {
  constructor(id: string, url: MockedExports.nsIURI);
  send: (
    message: MessageToFrontend<ResponseToFrontend>,
    target: MockedExports.WebChannelTarget
  ) => void;
  listen: (
    handler: (
      idle: string,
      message: MessageFromFrontend,
      target: MockedExports.WebChannelTarget
    ) => void
  ) => void;
}

/**
 * The per-tab information that is stored when a new profile is captured
 * and a profiler tab is opened, to serve the correct profile to the tab
 * that sends the WebChannel message.
 */
export type ProfilerBrowserInfo = {
  profileCaptureResult: ProfileCaptureResult;
  symbolicationService: SymbolicationService | null;
};

export type ProfileCaptureResult =
  | {
      type: "SUCCESS";
      /* @backward-compat { version 141 } When the target is < v140, this is a JS
       * object. Starting v140 this is an ArrayBuffer containing a gzipped profile. */
      profile: MinimallyTypedGeckoProfile | ArrayBuffer;
    }
  | {
      type: "ERROR";
      error: Error;
    };

/**
 * Describes all of the profiling features that can be turned on and
 * off in about:profiling.
 */
export interface FeatureDescription {
  // The name of the feature as shown in the UI.
  name: string;
  // The key value of the feature, this will be stored in prefs, and used in the
  // nsiProfiler interface.
  value: string;
  // The full description of the preset, this will need to be localized.
  title: string;
  // This will give the user a hint that it's recommended on.
  recommended?: boolean;
  // This will give the user a hint that it's an experimental feature.
  experimental?: boolean;
  // This will give a reason if the feature is disabled.
  disabledReason?: string;
}

// The key has the shape `${debugName}:${breakpadId}`.
export type LibInfoMapKey = string;

// This is a subset of the full Library struct.
export type LibInfoMapValue = {
  name: string;
  path: string;
  debugName: string;
  debugPath: string;
  breakpadId: string;
  arch: string;
};

export type SymbolicationWorkerInitialMessage = {
  request: SymbolicationWorkerRequest;
  // A map that allows looking up library info based on debugName + breakpadId.
  // This is rather redundant at the moment, but it will make more sense once
  // we can request symbols for multiple different libraries with one worker
  // message.
  libInfoMap: Map<LibInfoMapKey, LibInfoMapValue>;
  // An array of objdir paths on the host machine that should be searched for
  // relevant build artifacts.
  objdirs: string[];
  // The profiler-get-symbols wasm module.
  module: WebAssembly.Module;
};

export type SymbolicationWorkerRequest =
  | {
      type: "GET_SYMBOL_TABLE";
      // The debugName of the binary whose symbols should be obtained.
      debugName: string;
      // The breakpadId for the binary whose symbols should be obtained.
      breakpadId: string;
    }
  | {
      type: "QUERY_SYMBOLICATION_API";
      // The API entry path, such as "/symbolicate/v5".
      path: string;
      // The payload JSON, as a string.
      requestJson: string;
    };

export type SymbolicationWorkerError = {
  name: string;
  message: string;
  fileName?: string;
  lineNumber?: number;
};

export type SymbolicationWorkerReplyData<R> =
  | {
      result: R;
    }
  | {
      error: SymbolicationWorkerError;
    };

// This type is used in the symbolication worker for the return type of the
// FileAndPathHelper's readFile method.
// FIXME: Or rather, this type *would* be used if the worker code was checked
// by TypeScript.
export interface FileHandle {
  // Return the length of the file in bytes.
  getLength: () => number;
  // Synchronously read the bytes at offset `offset` into the array `dest`.
  readBytesInto: (dest: Uint8Array, offset: number) => void;
  // Called when the file is no longer needed, to allow closing the file.
  drop: () => void;
}

// This interface is the object returned by startBulkSend.
// See https://searchfox.org/mozilla-central/rev/cc231cc166e845deb02d08b175e22236bfad8b84/devtools/shared/transport/transport.js#141-154
export interface BulkSending {
  stream: nsIAsyncOutputStream;
  done: (err: void | Error) => void;
  copyFrom: (inputStream: nsIInputStream) => Promise<void>;
  copyFromBuffer: (inputBuffer: ArrayBuffer) => Promise<void>;
}

// This interface is the object received by the receiving end.
// See https://searchfox.org/mozilla-central/rev/cc231cc166e845deb02d08b175e22236bfad8b84/devtools/client/devtools-client.js#524-547
export interface BulkReceiving {
  actor: string;
  type: string;
  length: number;
  stream: nsIAsyncInputStream;
  done: (err: void | Error) => void;
  copyTo: (outputStream: nsIAsyncOutputStream) => Promise<void>;
  copyToBuffer: (outputBuffer: ArrayBuffer) => Promise<void>;
}
