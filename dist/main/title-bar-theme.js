"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TITLE_BAR_OVERLAY_COLORS = exports.TITLE_BAR_HEIGHT = void 0;
exports.resolveTitleBarOverlayColors = resolveTitleBarOverlayColors;
exports.supportsTitleBarOverlay = supportsTitleBarOverlay;
exports.applyTitleBarOverlayTheme = applyTitleBarOverlayTheme;
exports.attachTitleBarThemeSync = attachTitleBarThemeSync;
exports.isThemeMode = isThemeMode;
exports.resolveThemeMode = resolveThemeMode;
exports.resolveInitialIsDark = resolveInitialIsDark;
exports.appendThemeQueryParam = appendThemeQueryParam;
/** Title-bar palette tokens and overlay helpers for native title bars. */
exports.TITLE_BAR_HEIGHT = 40;
exports.TITLE_BAR_OVERLAY_COLORS = {
    light: { color: '#ffffff', symbolColor: '#0a0a0a' },
    dark: { color: '#0f0f0f', symbolColor: '#fafafa' },
};
function resolveTitleBarOverlayColors(isDark) {
    return isDark ? exports.TITLE_BAR_OVERLAY_COLORS.dark : exports.TITLE_BAR_OVERLAY_COLORS.light;
}
/** Checks whether the platform reliably supports runtime title-bar overlay theme updates. */
function supportsTitleBarOverlay(platform) {
    return platform === 'darwin' || platform === 'win32';
}
/** Applies the overlay colors for the given theme mode. */
function applyTitleBarOverlayTheme(win, isDark, platform = process.platform) {
    if (!supportsTitleBarOverlay(platform))
        return false;
    const candidate = win;
    if (!candidate || typeof candidate.setTitleBarOverlay !== 'function')
        return false;
    try {
        candidate.setTitleBarOverlay({ ...resolveTitleBarOverlayColors(isDark), height: exports.TITLE_BAR_HEIGHT });
        return true;
    }
    catch {
        // Some window-manager combinations reject runtime overlay changes even
        // when the API exists; keep the last applied colors instead of crashing.
        return false;
    }
}
/** Subscribes to OS theme changes and syncs the window's title-bar overlay. */
function attachTitleBarThemeSync(nativeTheme, getWindow, platform = process.platform) {
    if (!supportsTitleBarOverlay(platform))
        return () => { };
    const onUpdated = () => {
        applyTitleBarOverlayTheme(getWindow(), nativeTheme.shouldUseDarkColors, platform);
    };
    nativeTheme.on('updated', onUpdated);
    return () => {
        nativeTheme.off?.('updated', onUpdated);
    };
}
function isThemeMode(value) {
    return value === 'light' || value === 'dark' || value === 'system';
}
/** Absent, null, or unrecognized values resolve to 'system'. */
function resolveThemeMode(value) {
    return isThemeMode(value) ? value : 'system';
}
/** Initial window darkness: explicit modes win; 'system' defers to the OS signal. */
function resolveInitialIsDark(mode, systemPrefersDark) {
    return mode === 'dark' || (mode === 'system' && systemPrefersDark);
}
/** Adds current theme palette query parameter to standalone-window URLs. */
function appendThemeQueryParam(url, isDark) {
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('theme', isDark ? 'dark' : 'light');
        return parsed.toString();
    }
    catch {
        return url;
    }
}
//# sourceMappingURL=title-bar-theme.js.map