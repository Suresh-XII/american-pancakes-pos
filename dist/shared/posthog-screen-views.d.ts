/**
 * One pageview per screen per window; skipped views are counted in `repeatViews`, so cashiers
 * switching screens all day stay inside the free event allowance.
 */
export declare const SCREEN_VIEW_WINDOW_MS: number;
export interface ScreenViewDecision {
    send: boolean;
    /** Views of this screen folded into this one since the last pageview sent for it. */
    repeatViews: number;
}
export declare function createScreenViewThrottle(windowMs?: number): (screen: string, now: number) => ScreenViewDecision;
/** The settings tab is the feature a settings visit is about; other query values are dropped. */
export declare function screenKey(pathname: string, tab: string | null): string;
//# sourceMappingURL=posthog-screen-views.d.ts.map