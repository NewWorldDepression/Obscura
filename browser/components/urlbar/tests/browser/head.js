/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  AboutNewTab: "resource:///modules/AboutNewTab.sys.mjs",
  BrowsetUIUtils: "resource:///modules/BrowserUIUtils.sys.mjs",
  ExperimentAPI: "resource://nimbus/ExperimentAPI.sys.mjs",
  NimbusTestUtils: "resource://testing-common/NimbusTestUtils.sys.mjs",
  ObjectUtils: "resource://gre/modules/ObjectUtils.sys.mjs",
  PromptTestUtils: "resource://testing-common/PromptTestUtils.sys.mjs",
  ResetProfile: "resource://gre/modules/ResetProfile.sys.mjs",
  SearchUITestUtils: "resource://testing-common/SearchUITestUtils.sys.mjs",
  SearchUtils: "moz-src:///toolkit/components/search/SearchUtils.sys.mjs",
  TelemetryTestUtils: "resource://testing-common/TelemetryTestUtils.sys.mjs",
  UrlbarController: "resource:///modules/UrlbarController.sys.mjs",
  UrlbarEventBufferer: "resource:///modules/UrlbarEventBufferer.sys.mjs",
  UrlbarQueryContext: "resource:///modules/UrlbarUtils.sys.mjs",
  UrlbarPrefs: "resource:///modules/UrlbarPrefs.sys.mjs",
  UrlbarResult: "resource:///modules/UrlbarResult.sys.mjs",
  UrlbarSearchUtils: "resource:///modules/UrlbarSearchUtils.sys.mjs",
  UrlbarUtils: "resource:///modules/UrlbarUtils.sys.mjs",
  UrlbarView: "resource:///modules/UrlbarView.sys.mjs",
  sinon: "resource://testing-common/Sinon.sys.mjs",
});

ChromeUtils.defineLazyGetter(this, "PlacesFrecencyRecalculator", () => {
  return Cc["@mozilla.org/places/frecency-recalculator;1"].getService(
    Ci.nsIObserver
  ).wrappedJSObject;
});

SearchUITestUtils.init(this);

let sandbox;

Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/browser/components/urlbar/tests/browser/head-common.js",
  this
);

registerCleanupFunction(async () => {
  // Ensure the Urlbar popup is always closed at the end of a test, to save having
  // to do it within each test.
  await UrlbarTestUtils.promisePopupClose(window);
});

async function selectAndPaste(str, win = window) {
  await SimpleTest.promiseClipboardChange(str, () => {
    clipboardHelper.copyString(str);
  });
  win.gURLBar.select();
  win.document.commandDispatcher
    .getControllerForCommand("cmd_paste")
    .doCommand("cmd_paste");
}

/**
 * Waits for a load starting in any browser or a timeout, whichever comes first.
 *
 * @param {window} win
 *   The top-level browser window to listen in.
 * @param {number} timeoutMs
 *   The timeout in ms.
 * @returns {Promise} resolved to the loading uri in case of load, rejected in
 *   case of timeout.
 */
function waitForLoadStartOrTimeout(win = window, timeoutMs = 1000) {
  let listener;
  let timeout;
  return Promise.race([
    new Promise(resolve => {
      listener = {
        onStateChange(browser, webprogress, request, flags) {
          if (flags & Ci.nsIWebProgressListener.STATE_START) {
            resolve(request.QueryInterface(Ci.nsIChannel).URI);
          }
        },
      };
      win.gBrowser.addTabsProgressListener(listener);
    }),
    new Promise((resolve, reject) => {
      timeout = win.setTimeout(() => reject("timed out"), timeoutMs);
    }),
  ]).finally(() => {
    win.gBrowser.removeTabsProgressListener(listener);
    win.clearTimeout(timeout);
  });
}

/**
 * Opens the url bar context menu by synthesizing a click.
 * Returns a menu item that is specified by an id.
 *
 * @param {string} anonid - Identifier of a menu item of the url bar context menu.
 * @returns {string} - The element that has the corresponding identifier.
 */
async function promiseContextualMenuitem(anonid) {
  let textBox = gURLBar.querySelector("moz-input-box");
  let cxmenu = textBox.menupopup;
  let cxmenuPromise = BrowserTestUtils.waitForEvent(cxmenu, "popupshown");
  EventUtils.synthesizeMouseAtCenter(gURLBar.inputField, {
    type: "contextmenu",
    button: 2,
  });
  await cxmenuPromise;
  return textBox.getMenuItem(anonid);
}

/**
 * Puts all CustomizableUI widgetry back to their default locations, and
 * then fires the `aftercustomization` toolbox event so that UrlbarInput
 * knows to reinitialize itself.
 *
 * @param {window} [win=window]
 *   The top-level browser window to fire the `aftercustomization` event in.
 */
function resetCUIAndReinitUrlbarInput(win = window) {
  CustomizableUI.reset();
  CustomizableUI.dispatchToolboxEvent("aftercustomization", {}, win);
}

/**
 * This function does the following:
 *
 * 1. Starts a search with `searchString` but doesn't wait for it to complete.
 * 2. Compares the input value to `valueBefore`. If anything is autofilled at
 *    this point, it will be due to the placeholder.
 * 3. Waits for the search to complete.
 * 4. Compares the input value to `valueAfter`. If anything is autofilled at
 *    this point, it will be due to the autofill result fetched by the search.
 * 5. Compares the placeholder to `placeholderAfter`.
 *
 * @param {object} options
 *   The options object.
 * @param {string} options.searchString
 *   The search string.
 * @param {string} options.valueBefore
 *   The expected input value before the search completes.
 * @param {string} options.valueAfter
 *   The expected input value after the search completes.
 * @param {string} options.placeholderAfter
 *   The expected placeholder value after the search completes.
 * @returns {Promise}
 */
async function search({
  searchString,
  valueBefore,
  valueAfter,
  placeholderAfter,
}) {
  info(
    "Searching: " +
      JSON.stringify({
        searchString,
        valueBefore,
        valueAfter,
        placeholderAfter,
      })
  );

  await SimpleTest.promiseFocus(window);
  gURLBar.inputField.focus();

  // Set the input value and move the caret to the end to simulate the user
  // typing. It's important the caret is at the end because otherwise autofill
  // won't happen.
  gURLBar._setValue(searchString);
  gURLBar.inputField.setSelectionRange(
    searchString.length,
    searchString.length
  );

  // Placeholder autofill is done on input, so fire an input event. We can't use
  // `promiseAutocompleteResultPopup()` or other helpers that wait for the
  // search to complete because we are specifically checking placeholder
  // autofill before the search completes.
  UrlbarTestUtils.fireInputEvent(window);

  // Check the input value and selection immediately, before waiting on the
  // search to complete.
  Assert.equal(
    gURLBar.value,
    valueBefore,
    "gURLBar.value before the search completes"
  );
  Assert.equal(
    gURLBar.selectionStart,
    searchString.length,
    "gURLBar.selectionStart before the search completes"
  );
  Assert.equal(
    gURLBar.selectionEnd,
    valueBefore.length,
    "gURLBar.selectionEnd before the search completes"
  );

  // Wait for the search to complete.
  info("Waiting for the search to complete");
  await UrlbarTestUtils.promiseSearchComplete(window);

  // Check the final value after the results arrived.
  Assert.equal(
    gURLBar.value,
    valueAfter,
    "gURLBar.value after the search completes"
  );
  Assert.equal(
    gURLBar.selectionStart,
    searchString.length,
    "gURLBar.selectionStart after the search completes"
  );
  Assert.equal(
    gURLBar.selectionEnd,
    valueAfter.length,
    "gURLBar.selectionEnd after the search completes"
  );

  // Check the placeholder.
  if (placeholderAfter) {
    Assert.ok(
      gURLBar._autofillPlaceholder,
      "gURLBar._autofillPlaceholder exists after the search completes"
    );
    Assert.strictEqual(
      gURLBar._autofillPlaceholder.value,
      placeholderAfter,
      "gURLBar._autofillPlaceholder.value after the search completes"
    );
  } else {
    Assert.strictEqual(
      gURLBar._autofillPlaceholder,
      null,
      "gURLBar._autofillPlaceholder does not exist after the search completes"
    );
  }

  // Check the first result.
  let details = await UrlbarTestUtils.getDetailsOfResultAt(window, 0);
  Assert.equal(
    !!details.autofill,
    !!placeholderAfter,
    "First result is an autofill result iff a placeholder is expected"
  );
}

function selectWithMouseDrag(fromX, toX, win = window) {
  let target = win.gURLBar.inputField;
  let rect = target.getBoundingClientRect();
  let promise = BrowserTestUtils.waitForEvent(target, "mouseup");
  EventUtils.synthesizeMouse(
    target,
    fromX,
    rect.height / 2,
    { type: "mousemove" },
    target.ownerGlobal
  );
  EventUtils.synthesizeMouse(
    target,
    fromX,
    rect.height / 2,
    { type: "mousedown" },
    target.ownerGlobal
  );
  EventUtils.synthesizeMouse(
    target,
    toX,
    rect.height / 2,
    { type: "mousemove" },
    target.ownerGlobal
  );
  EventUtils.synthesizeMouse(
    target,
    toX,
    rect.height / 2,
    { type: "mouseup" },
    target.ownerGlobal
  );
  return promise;
}

function selectWithDoubleClick(offsetX, win = window) {
  let target = win.gURLBar.inputField;
  let rect = target.getBoundingClientRect();
  let promise = BrowserTestUtils.waitForEvent(target, "dblclick");
  EventUtils.synthesizeMouse(target, offsetX, rect.height / 2, {
    clickCount: 1,
  });
  EventUtils.synthesizeMouse(target, offsetX, rect.height / 2, {
    clickCount: 2,
  });
  return promise;
}

/**
 * Asserts a search term is in the url bar and state values are
 * what they should be.
 *
 * @param {string} searchString
 *   String that should be matched in the url bar.
 * @param {object | null} options
 *   Options for the assertions.
 * @param {Window | null} options.window
 *   Window to use for tests.
 * @param {string | null} options.pageProxyState
 *   The pageproxystate that should be expected.
 * @param {string | null} options.userTypedValue
 *   The userTypedValue that should be expected.
 * @param {boolean | null} options.persistSearchTerms
 *   The attribute persistsearchterms that should be expected.
 */
function assertSearchStringIsInUrlbar(
  searchString,
  {
    win = window,
    pageProxyState = "invalid",
    userTypedValue = searchString,
    persistSearchTerms = true,
  } = {}
) {
  Assert.equal(
    win.gURLBar.value,
    searchString,
    `Search string should be the urlbar value.`
  );
  let state = win.gURLBar.getBrowserState(win.gBrowser.selectedBrowser);
  Assert.equal(
    state.persist?.searchTerms,
    searchString,
    `Search terms should match.`
  );
  Assert.equal(
    win.gBrowser.userTypedValue,
    userTypedValue,
    "userTypedValue should match."
  );
  Assert.equal(
    win.gURLBar.getAttribute("pageproxystate"),
    pageProxyState,
    "Pageproxystate should match."
  );
  if (persistSearchTerms) {
    Assert.ok(
      win.gURLBar.hasAttribute("persistsearchterms"),
      "Urlbar has persistsearchterms attribute."
    );
  } else {
    Assert.ok(
      !win.gURLBar.hasAttribute("persistsearchterms"),
      "Urlbar does not have persistsearchterms attribute."
    );
  }
}

async function searchWithTab(
  searchString,
  tab = null,
  engine = Services.search.defaultEngine,
  expectedPersistedSearchTerms = true
) {
  if (!tab) {
    tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);
  }

  let [expectedSearchUrl] = UrlbarUtils.getSearchQueryUrl(engine, searchString);
  let browserLoadedPromise = BrowserTestUtils.browserLoaded(
    tab.linkedBrowser,
    false,
    expectedSearchUrl
  );

  gURLBar.focus();
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    waitForFocus,
    value: searchString,
    fireInputEvent: true,
    selectionStart: 0,
    selectionEnd: searchString.length - 1,
  });
  EventUtils.synthesizeKey("KEY_Enter");
  await browserLoadedPromise;

  if (expectedPersistedSearchTerms) {
    info("Load a tab with search terms persisting in the urlbar.");
    assertSearchStringIsInUrlbar(searchString);
  }

  return { tab, expectedSearchUrl };
}

async function focusSwitcher(win = window) {
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window: win,
    waitForFocus: true,
    value: "",
    fireInputEvent: true,
  });
  Assert.ok(win.gURLBar.hasAttribute("focused"), "Urlbar was focused");

  EventUtils.synthesizeKey("KEY_Tab", { shiftKey: true }, win);
  let switcher = win.document.getElementById("urlbar-searchmode-switcher");
  await BrowserTestUtils.waitForCondition(
    () => win.document.activeElement == switcher
  );
  Assert.ok(true, "Search mode switcher was focused");
}

/**
 * Clears the SAP telemetry probes (SEARCH_COUNTS and all of Glean).
 */
function clearSAPTelemetry() {
  TelemetryTestUtils.getAndClearKeyedHistogram("SEARCH_COUNTS");
  Services.fog.testResetFOG();
}

async function waitForIdle() {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => Services.tm.idleDispatchToMainThread(resolve));
  }
}
