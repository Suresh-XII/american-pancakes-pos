import type { NativeTheme } from 'electron';
/** Title-bar palette tokens and overlay helpers for native title bars. */
export declare const TITLE_BAR_HEIGHT = 40;
export interface TitleBarOverlayColors {
    readonly color: string;
    readonly symbolColor: string;
}
export declare const TITLE_BAR_OVERLAY_COLORS: Readonly<Record<'light' | 'dark', TitleBarOverlayColors>>;
export declare function resolveTitleBarOverlayColors(isDark: boolean): TitleBarOverlayColors;
/** Checks whether the platform reliably supports runtime title-bar overlay theme updates. */
export declare function supportsTitleBarOverlay(platform: NodeJS.Platform): boolean;
type OverlayCapableWindow = {
    setTitleBarOverlay?: (options: {
        color: string;
        symbolColor: string;
        height?: number;
    }) => void;
};
/** Applies the overlay colors for the given theme mode. */
export declare function applyTitleBarOverlayTheme(win: unknown, isDark: boolean, platform?: NodeJS.Platform): boolean;
type ThemeLike = Pick<NativeTheme, 'shouldUseDarkColors'> & {
    on(event: 'updated', listener: () => void): unknown;
};
/** Subscribes to OS theme changes and syncs the window's title-bar overlay. */
export declare function attachTitleBarThemeSync(nativeTheme: ThemeLike, getWindow: () => OverlayCapableWindow | null | undefined, platform?: NodeJS.Platform): () => void;
export type ThemeMode = 'light' | 'dark' | 'system';
export declare function isThemeMode(value: unknown): value is ThemeMode;
/** Absent, null, or unrecognized values resolve to 'system'. */
export declare function resolveThemeMode(value: string | null | undefined): ThemeMode;
/** Initial window darkness: explicit modes win; 'system' defers to the OS signal. */
export declare function resolveInitialIsDark(mode: ThemeMode, systemPrefersDark: boolean): boolean;
/** Adds current theme palette query parameter to standalone-window URLs. */
export declare function appendThemeQueryParam(url: string, isDark: boolean): string;
export {};
//# sourceMappingURL=title-bar-theme.d.ts.map