"use strict";
/**
 * One pageview per screen per window; skipped views are counted in `repeatViews`, so cashiers
 * switching screens all day stay inside the free event allowance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCREEN_VIEW_WINDOW_MS = void 0;
exports.createScreenViewThrottle = createScreenViewThrottle;
exports.screenKey = screenKey;
exports.SCREEN_VIEW_WINDOW_MS = 30 * 60_000;
function createScreenViewThrottle(windowMs = exports.SCREEN_VIEW_WINDOW_MS) {
    const screens = new Map();
    let current = null;
    return (screen, now) => {
        if (screen === current)
            return { send: false, repeatViews: 0 };
        current = screen;
        const seen = screens.get(screen);
        if (seen && now - seen.sentAt < windowMs) {
            seen.folded += 1;
            return { send: false, repeatViews: 0 };
        }
        const repeatViews = seen?.folded ?? 0;
        screens.set(screen, { sentAt: now, folded: 0 });
        return { send: true, repeatViews };
    };
}
/** The settings tab is the feature a settings visit is about; other query values are dropped. */
function screenKey(pathname, tab) {
    const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
    return tab && /^[a-z][a-z0-9-]{0,40}$/.test(tab) && path.startsWith('/settings/')
        ? `${path}?tab=${tab}`
        : path;
}
//# sourceMappingURL=posthog-screen-views.js.map