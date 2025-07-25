/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  URILoadingHelper: "resource:///modules/URILoadingHelper.sys.mjs",

  AnimationFramePromise: "chrome://remote/content/shared/Sync.sys.mjs",
  AppInfo: "chrome://remote/content/shared/AppInfo.sys.mjs",
  BrowsingContextListener:
    "chrome://remote/content/shared/listeners/BrowsingContextListener.sys.mjs",
  DebounceCallback: "chrome://remote/content/marionette/sync.sys.mjs",
  error: "chrome://remote/content/shared/webdriver/Errors.sys.mjs",
  EventPromise: "chrome://remote/content/shared/Sync.sys.mjs",
  generateUUID: "chrome://remote/content/shared/UUID.sys.mjs",
  Log: "chrome://remote/content/shared/Log.sys.mjs",
  TabManager: "chrome://remote/content/shared/TabManager.sys.mjs",
  TimedPromise: "chrome://remote/content/shared/Sync.sys.mjs",
  UserContextManager:
    "chrome://remote/content/shared/UserContextManager.sys.mjs",
  waitForObserverTopic: "chrome://remote/content/marionette/sync.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => lazy.Log.get());

// Timeout used to abort fullscreen, maximize, and minimize
// commands if no window manager is present.
const TIMEOUT_NO_WINDOW_MANAGER = 5000;

/**
 * Provides helpers to interact with Window objects.
 *
 * @class WindowManager
 */
class WindowManager {
  #clientWindowIds;
  #contextListener;

  constructor() {
    // Maps ChromeWindow to uuid: WeakMap.<Object, string>
    this._chromeWindowHandles = new WeakMap();

    /**
     * Keep track of the client window for any registered contexts. When the
     * contextDestroyed event is fired, the context is already destroyed so
     * we cannot query for the client window at that time.
     */
    this.#clientWindowIds = new WeakMap();

    this.#contextListener = new lazy.BrowsingContextListener();
    this.#contextListener.on("attached", this.#onContextAttached);
    this.#contextListener.startListening();
  }

  get chromeWindowHandles() {
    const chromeWindowHandles = [];

    for (const win of this.windows) {
      chromeWindowHandles.push(this.getIdForWindow(win));
    }

    return chromeWindowHandles;
  }

  /**
   * Retrieve all the open windows.
   *
   * @returns {Array<Window>}
   *     All the open windows. Will return an empty list if no window is open.
   */
  get windows() {
    const windows = [];

    for (const win of Services.wm.getEnumerator(null)) {
      if (win.closed) {
        continue;
      }
      windows.push(win);
    }

    return windows;
  }

  /**
   * Find a specific window matching the provided window handle.
   *
   * @param {string} handle
   *     The unique handle of either a chrome window or a content browser, as
   *     returned by :js:func:`#getIdForBrowser` or :js:func:`#getIdForWindow`.
   *
   * @returns {object} A window properties object,
   *     @see :js:func:`GeckoDriver#getWindowProperties`
   */
  findWindowByHandle(handle) {
    for (const win of this.windows) {
      // In case the wanted window is a chrome window, we are done.
      const chromeWindowId = this.getIdForWindow(win);
      if (chromeWindowId == handle) {
        return this.getWindowProperties(win);
      }

      // Otherwise check if the chrome window has a tab browser, and that it
      // contains a tab with the wanted window handle.
      const tabBrowser = lazy.TabManager.getTabBrowser(win);
      if (tabBrowser && tabBrowser.tabs) {
        for (let i = 0; i < tabBrowser.tabs.length; ++i) {
          let contentBrowser = lazy.TabManager.getBrowserForTab(
            tabBrowser.tabs[i]
          );
          let contentWindowId = lazy.TabManager.getIdForBrowser(contentBrowser);

          if (contentWindowId == handle) {
            return this.getWindowProperties(win, { tabIndex: i });
          }
        }
      }
    }

    return null;
  }

  /**
   * A set of properties describing a window and that should allow to uniquely
   * identify it. The described window can either be a Chrome Window or a
   * Content Window.
   *
   * @typedef {object} WindowProperties
   * @property {Window} win - The Chrome Window containing the window.
   *     When describing a Chrome Window, this is the window itself.
   * @property {string} id - The unique id of the containing Chrome Window.
   * @property {boolean} hasTabBrowser - `true` if the Chrome Window has a
   *     tabBrowser.
   * @property {number} tabIndex - Optional, the index of the specific tab
   *     within the window.
   */

  /**
   * Returns a WindowProperties object, that can be used with :js:func:`GeckoDriver#setWindowHandle`.
   *
   * @param {Window} win
   *     The Chrome Window for which we want to create a properties object.
   * @param {object} options
   * @param {number} options.tabIndex
   *     Tab index of a specific Content Window in the specified Chrome Window.
   * @returns {WindowProperties} A window properties object.
   */
  getWindowProperties(win, options = {}) {
    if (!Window.isInstance(win)) {
      throw new TypeError("Invalid argument, expected a Window object");
    }

    return {
      win,
      id: this.getIdForWindow(win),
      hasTabBrowser: !!lazy.TabManager.getTabBrowser(win),
      tabIndex: options.tabIndex,
    };
  }

  /**
   * Returns the window ID for a specific browsing context.
   *
   * @param {BrowsingContext} context
   *     The browsing context for which we want to retrieve the window ID.
   *
   * @returns {(string|undefined)}
   *    The ID of the window associated with the browsing context.
   */
  getIdForBrowsingContext(context) {
    const window = this.#getBrowsingContextWindow(context);

    return window
      ? this.getIdForWindow(window)
      : this.#clientWindowIds.get(context);
  }

  /**
   * Retrieves an id for the given chrome window. The id is a dynamically
   * generated uuid associated with the window object.
   *
   * @param {window} win
   *     The window object for which we want to retrieve the id.
   * @returns {string} The unique id for this chrome window.
   */
  getIdForWindow(win) {
    if (!this._chromeWindowHandles.has(win)) {
      this._chromeWindowHandles.set(win, lazy.generateUUID());
    }
    return this._chromeWindowHandles.get(win);
  }

  /**
   * Close the specified window.
   *
   * @param {window} win
   *     The window to close.
   * @returns {Promise}
   *     A promise which is resolved when the current window has been closed.
   */
  async closeWindow(win) {
    const destroyed = lazy.waitForObserverTopic("xul-window-destroyed", {
      checkFn: () => win && win.closed,
    });

    win.close();

    return destroyed;
  }

  /**
   * Adjusts the window geometry.
   *
   *@param {window} win
   *     The browser window to adjust.
   * @param {number} x
   *     The x-coordinate of the window.
   * @param {number} y
   *     The y-coordinate of the window.
   * @param {number} width
   *     The width of the window.
   * @param {number} height
   *     The height of the window.
   *
   * @returns {Promise}
   *     A promise that resolves when the window geometry has been adjusted.
   *
   * @throws {TimeoutError}
   *     Raised if the operating system fails to honor the requested move or resize.
   */
  async adjustWindowGeometry(win, x, y, width, height) {
    // we find a matching position on e.g. resize, then resolve, then a geometry
    // change comes in, then the window pos listener runs, we might try to
    // incorrectly reset the position without this check.
    let foundMatch = false;

    function geometryMatches() {
      lazy.logger.trace(
        `Checking window geometry ${win.outerWidth}x${win.outerHeight} @ (${win.screenX}, ${win.screenY})`
      );

      if (foundMatch) {
        lazy.logger.trace(`Already found a previous match for this request`);
        return true;
      }

      let sizeMatches = true;
      let posMatches = true;

      if (
        width !== null &&
        height !== null &&
        (win.outerWidth !== width || win.outerHeight !== height)
      ) {
        sizeMatches = false;
      }

      // Wayland doesn't support getting the window position.
      if (
        x !== null &&
        y !== null &&
        (win.screenX !== x || win.screenY !== y)
      ) {
        if (lazy.AppInfo.isWayland) {
          lazy.logger.info(
            `Wayland doesn't support setting the window position`
          );
        } else {
          posMatches = false;
        }
      }

      if (sizeMatches && posMatches) {
        lazy.logger.trace(`Requested window geometry matches`);
        foundMatch = true;
        return true;
      }

      return false;
    }

    if (!geometryMatches()) {
      // There might be more than one resize or MozUpdateWindowPos event due
      // to previous geometry changes, such as from restoreWindow(), so
      // wait longer if window geometry does not match.
      const options = {
        checkFn: geometryMatches,
        timeout: 500,
      };
      const promises = [];

      if (width !== null && height !== null) {
        promises.push(new lazy.EventPromise(win, "resize", options));
        win.resizeTo(width, height);
      }

      // Wayland doesn't support setting the window position.
      if (!lazy.AppInfo.isWayland && x !== null && y !== null) {
        promises.push(
          new lazy.EventPromise(win.windowRoot, "MozUpdateWindowPos", options)
        );
        win.moveTo(x, y);
      }

      try {
        await Promise.race(promises);
      } catch (e) {
        if (e instanceof lazy.error.TimeoutError) {
          // The operating system might not honor the move or resize, in which
          // case assume that geometry will have been adjusted "as close as
          // possible" to that requested.  There may be no event received if the
          // geometry is already as close as possible.
        } else {
          throw e;
        }
      }
    }
  }

  /**
   * Focus the specified window.
   *
   * @param {window} win
   *     The window to focus.
   * @returns {Promise}
   *     A promise which is resolved when the window has been focused.
   */
  async focusWindow(win) {
    if (Services.focus.activeWindow != win) {
      let activated = new lazy.EventPromise(win, "activate");
      let focused = new lazy.EventPromise(win, "focus", { capture: true });

      win.focus();

      await Promise.all([activated, focused]);
    }
  }

  /**
   * Open a new browser window.
   *
   * @param {object=} options
   * @param {boolean=} options.focus
   *     If true, the opened window will receive the focus. Defaults to false.
   * @param {boolean=} options.isPrivate
   *     If true, the opened window will be a private window. Defaults to false.
   * @param {ChromeWindow=} options.openerWindow
   *     Use this window as the opener of the new window. Defaults to the
   *     topmost window.
   * @param {string=} options.userContextId
   *     The id of the user context which should own the initial tab of the new
   *     window.
   * @returns {Promise}
   *     A promise resolving to the newly created chrome window.
   */
  async openBrowserWindow(options = {}) {
    let {
      focus = false,
      isPrivate = false,
      openerWindow = null,
      userContextId = null,
    } = options;

    switch (lazy.AppInfo.name) {
      case "Firefox":
        if (openerWindow === null) {
          // If no opener was provided, fallback to the topmost window.
          openerWindow = Services.wm.getMostRecentBrowserWindow();
        }

        if (!openerWindow) {
          throw new lazy.error.UnsupportedOperationError(
            `openWindow() could not find a valid opener window`
          );
        }

        // Open new browser window, and wait until it is fully loaded.
        // Also wait for the window to be focused and activated to prevent a
        // race condition when promptly focusing to the original window again.
        const browser = await new Promise(resolveOnContentBrowserCreated =>
          lazy.URILoadingHelper.openTrustedLinkIn(
            openerWindow,
            "about:blank",
            "window",
            {
              private: isPrivate,
              resolveOnContentBrowserCreated,
              userContextId:
                lazy.UserContextManager.getInternalIdById(userContextId),
            }
          )
        );

        // TODO: Both for WebDriver BiDi and classic, opening a new window
        // should not run the focus steps. When focus is false we should avoid
        // focusing the new window completely. See Bug 1766329

        if (focus) {
          // Focus the currently selected tab.
          browser.focus();
        } else {
          // If the new window shouldn't get focused, set the
          // focus back to the opening window.
          await this.focusWindow(openerWindow);
        }

        return browser.ownerGlobal;

      default:
        throw new lazy.error.UnsupportedOperationError(
          `openWindow() not supported in ${lazy.AppInfo.name}`
        );
    }
  }

  supportsWindows() {
    return !lazy.AppInfo.isAndroid;
  }

  /**
   * Minimize the specified window.
   *
   * @param {window} win
   *     The window to minimize.
   *
   * @returns {Promise}
   *     A promise resolved when the window is minimized, or times out if no window manager is present.
   */
  async minimizeWindow(win) {
    if (WindowState.from(win.windowState) != WindowState.Minimized) {
      await waitForWindowState(win, () => win.minimize());
    }
  }

  /**
   * Maximize the specified window.
   *
   * @param {window} win
   *     The window to maximize.
   *
   * @returns {Promise}
   *     A promise resolved when the window is maximized, or times out if no window manager is present.
   */
  async maximizeWindow(win) {
    if (WindowState.from(win.windowState) != WindowState.Maximized) {
      await waitForWindowState(win, () => win.maximize());
    }
  }

  /**
   * Restores the specified window to its normal state.
   *
   * @param {window} win
   *     The window to restore.
   *
   * @returns {Promise}
   *     A promise resolved when the window is restored, or times out if no window manager is present.
   */
  async restoreWindow(win) {
    if (WindowState.from(win.windowState) !== WindowState.Normal) {
      await waitForWindowState(win, () => win.restore());
    }
  }

  /**
   * Sets the fullscreen state of the specified window.
   *
   * @param {window} win
   *     The target window.
   * @param {boolean} enable
   *     Whether to enter fullscreen (true) or exit fullscreen (false).
   *
   * @returns {Promise}
   *     A promise resolved when the window enters or exits fullscreen mode.
   */
  async setFullscreen(win, enable) {
    const isFullscreen =
      WindowState.from(win.windowState) === WindowState.Fullscreen;
    if (enable !== isFullscreen) {
      await waitForWindowState(win, () => (win.fullScreen = enable));
    }
  }

  /**
   * Wait until the initial application window has been opened and loaded.
   *
   * @returns {Promise<WindowProxy>}
   *     A promise that resolved to the application window.
   */
  waitForInitialApplicationWindowLoaded() {
    return new lazy.TimedPromise(
      async resolve => {
        // This call includes a fallback to "mail:3pane" as well.
        const win = Services.wm.getMostRecentBrowserWindow();

        const windowLoaded = lazy.waitForObserverTopic(
          "browser-delayed-startup-finished",
          {
            checkFn: subject => (win !== null ? subject == win : true),
          }
        );

        // The current window has already been finished loading.
        if (win && win.document.readyState == "complete") {
          resolve(win);
          return;
        }

        // Wait for the next browser/mail window to open and finished loading.
        const { subject } = await windowLoaded;
        resolve(subject);
      },
      {
        errorMessage: "No applicable application window found",
      }
    );
  }

  /**
   * Returns the window for a specific browsing context.
   *
   * @param {BrowsingContext} context
   *    The browsing context for which we want to retrieve the window.
   *
   * @returns {(window|undefined)}
   *    The window associated with the browsing context.
   */
  #getBrowsingContextWindow(context) {
    return lazy.AppInfo.isAndroid
      ? context.top.embedderElement?.ownerGlobal
      : context.topChromeWindow;
  }

  #onContextAttached = (_, data = {}) => {
    const { browsingContext } = data;

    const window = this.#getBrowsingContextWindow(browsingContext);
    this.#clientWindowIds.set(browsingContext, this.getIdForWindow(window));
  };
}

// Expose a shared singleton.
export const windowManager = new WindowManager();

/**
 * Representation of the {@link ChromeWindow} window state.
 *
 * @enum {string}
 */
export const WindowState = {
  Maximized: "maximized",
  Minimized: "minimized",
  Normal: "normal",
  Fullscreen: "fullscreen",

  /**
   * Converts {@link Window.windowState} to WindowState.
   *
   * @param {number} windowState
   *     Attribute from {@link Window.windowState}.
   *
   * @returns {WindowState}
   *     JSON representation.
   *
   * @throws {TypeError}
   *     If <var>windowState</var> was unknown.
   */
  from(windowState) {
    switch (windowState) {
      case 1:
        return WindowState.Maximized;

      case 2:
        return WindowState.Minimized;

      case 3:
        return WindowState.Normal;

      case 4:
        return WindowState.Fullscreen;

      default:
        throw new TypeError(`Unknown window state: ${windowState}`);
    }
  },
};

/**
 * Waits for the window to reach a specific state after invoking a callback.
 *
 * @param {window} win
 *     The target window.
 * @param {Function} callback
 *     The function to invoke to change the window state.
 *
 * @returns {Promise}
 *     A promise resolved when the window reaches the target state, or times out if no window manager is present.
 */
async function waitForWindowState(win, callback) {
  let cb;
  // Use a timed promise to abort if no window manager is present
  await new lazy.TimedPromise(
    resolve => {
      cb = new lazy.DebounceCallback(resolve);
      win.addEventListener("sizemodechange", cb);
      callback();
    },
    { throws: null, timeout: TIMEOUT_NO_WINDOW_MANAGER }
  );
  win.removeEventListener("sizemodechange", cb);
  await new lazy.AnimationFramePromise(win);
}
