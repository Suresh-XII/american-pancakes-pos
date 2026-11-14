"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAC_TRAFFIC_LIGHT_POSITION = void 0;
exports.resolveTitleBarMode = resolveTitleBarMode;
exports.createMainWindow = createMainWindow;
exports.applyWindowControlAction = applyWindowControlAction;
exports.getPopupWindowOptions = getPopupWindowOptions;
exports.getKdsWindowOptions = getKdsWindowOptions;
exports.createKdsWindow = createKdsWindow;
exports.createLocalWindowOpenHandler = createLocalWindowOpenHandler;
exports.createMainWindowWillNavigateHandler = createMainWindowWillNavigateHandler;
const title_bar_theme_1 = require("./title-bar-theme");
// Centers 12px macOS traffic-light buttons in the 40px custom title bar.
exports.MAC_TRAFFIC_LIGHT_POSITION = { x: 16, y: 14 };
/** Minimum Electron major version with dependable Window Controls Overlay APIs. */
const MIN_OVERLAY_ELECTRON_MAJOR = 33;
/** Resolves whether to use native titleBarOverlay or fallback to HTML caption buttons. */
function resolveTitleBarMode(probe) {
    if (probe.platform !== 'darwin' && probe.platform !== 'win32' && probe.platform !== 'linux') {
        return 'html-fallback';
    }
    if (probe.platform === 'darwin') {
        // macOS supplies native traffic lights via titleBarStyle: 'hiddenInset'.
        // It never needs HTML fallback caption buttons.
        return 'native-overlay';
    }
    const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(probe.electronVersion);
    const major = versionMatch ? Number(versionMatch[1]) : Number.NaN;
    if (!Number.isSafeInteger(major) || major < MIN_OVERLAY_ELECTRON_MAJOR)
        return 'html-fallback';
    if (!probe.overlayApiPresent)
        return 'html-fallback';
    return 'native-overlay';
}
function createMainWindow(BrowserWindowConstructor, preload, platform = process.platform, isDarkOrTitleBarMode = false, titleBarModeOrOptions, options) {
    const isDark = typeof isDarkOrTitleBarMode === 'boolean' ? isDarkOrTitleBarMode : false;
    const resolvedTitleBarMode = typeof titleBarModeOrOptions === 'string'
        ? titleBarModeOrOptions
        : typeof isDarkOrTitleBarMode === 'string'
            ? isDarkOrTitleBarMode
            : 'native-overlay';
    const resolvedOptions = typeof titleBarModeOrOptions === 'object' && titleBarModeOrOptions !== null
        ? titleBarModeOrOptions
        : options;
    // Merge webPreferences instead of replacing it, so overriding one preference
    // cannot drop the generated preload or the isolation settings it enables.
    const { webPreferences: webPreferencesOverrides, ...windowOptions } = resolvedOptions ?? {};
    return new BrowserWindowConstructor({
        name: 'flo-main',
        windowStatePersistence: true,
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        title: 'Flo',
        titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'hidden',
        ...(resolvedTitleBarMode === 'native-overlay'
            ? {
                titleBarOverlay: {
                    ...(0, title_bar_theme_1.resolveTitleBarOverlayColors)(isDark),
                    height: title_bar_theme_1.TITLE_BAR_HEIGHT,
                },
            }
            : {}),
        ...(platform === 'darwin' ? { trafficLightPosition: exports.MAC_TRAFFIC_LIGHT_POSITION } : {}),
        webPreferences: {
            ...(webPreferencesOverrides ?? {}),
            preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
        show: false,
        ...windowOptions,
    });
}
/** Applies a window action (minimize, toggle-maximize, close) preserving close-to-tray. */
function applyWindowControlAction(win, action) {
    if (action !== 'minimize' && action !== 'toggle-maximize' && action !== 'close') {
        return { error: 'Unsupported window action' };
    }
    switch (action) {
        case 'minimize':
            win.minimize();
            break;
        case 'toggle-maximize':
            if (typeof win.isFullScreen === 'function' && win.isFullScreen()) {
                if (typeof win.setFullScreen === 'function') {
                    win.setFullScreen(false);
                }
                else {
                    win.unmaximize();
                }
            }
            else if (win.isMaximized()) {
                win.unmaximize();
            }
            else {
                win.maximize();
            }
            break;
        case 'close':
            win.close();
            break;
    }
    return { success: true };
}
function getPopupWindowOptions(isBlank) {
    return {
        width: isBlank ? 800 : 1280,
        height: isBlank ? 600 : 800,
        title: isBlank ? 'Print Receipt' : 'Flo - Kitchen Display',
        autoHideMenuBar: isBlank,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    };
}
function getKdsWindowOptions() {
    return {
        width: 1200,
        height: 800,
        title: 'Flo - Kitchen Display',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    };
}
function createKdsWindow(BrowserWindowConstructor) {
    return new BrowserWindowConstructor(getKdsWindowOptions());
}
function createLocalWindowOpenHandler(isAllowedLocalWindowUrl, getServerPort, getLocalIP) {
    return ({ url }) => {
        const isBlank = url === 'about:blank' || url === '';
        if (!isAllowedLocalWindowUrl(url, getServerPort(), getLocalIP()))
            return null;
        return {
            action: 'allow',
            overrideBrowserWindowOptions: getPopupWindowOptions(isBlank),
        };
    };
}
/**
 * Creates a will-navigate event handler for the privileged main window.
 * Allows safe local application URLs, delegates safe external HTTP/HTTPS URLs
 * to the default system browser via shell.openExternal, and blocks unsafe schemes.
 */
function createMainWindowWillNavigateHandler(isAllowedLocalWindowUrl, getServerPort, getLocalIP, isSafeExternalUrl, openExternal, warn = console.warn) {
    return (event, url) => {
        if (isAllowedLocalWindowUrl(url, getServerPort(), getLocalIP())) {
            return;
        }
        event.preventDefault();
        if (isSafeExternalUrl(url)) {
            try {
                const res = openExternal(url);
                if (res && typeof res.catch === 'function') {
                    res.catch((err) => {
                        const message = err instanceof Error ? err.message : String(err);
                        warn('[Flo] Failed to open external URL:', message);
                    });
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                warn('[Flo] Failed to open external URL:', message);
            }
        }
        else {
            warn('[Flo] Blocked unsafe navigation URL:', url);
        }
    };
}
//# sourceMappingURL=window-options.js.map