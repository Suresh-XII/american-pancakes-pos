import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
/** How the main window's caption controls are supplied. */
export type TitleBarMode = 'native-overlay' | 'html-fallback';
/** The single narrow window-control verb set exposed over IPC. */
export type WindowControlAction = 'minimize' | 'toggle-maximize' | 'close';
export type BrowserWindowConstructor = new (options: BrowserWindowConstructorOptions) => BrowserWindow;
export declare const MAC_TRAFFIC_LIGHT_POSITION: {
    readonly x: 16;
    readonly y: 14;
};
/** Resolves whether to use native titleBarOverlay or fallback to HTML caption buttons. */
export declare function resolveTitleBarMode(probe: {
    platform: NodeJS.Platform;
    electronVersion: string;
    overlayApiPresent: boolean;
}): TitleBarMode;
export declare function createMainWindow(BrowserWindowConstructor: BrowserWindowConstructor, preload: string, platform?: NodeJS.Platform, isDarkOrTitleBarMode?: boolean | TitleBarMode, titleBarModeOrOptions?: TitleBarMode | Partial<BrowserWindowConstructorOptions>, options?: Partial<BrowserWindowConstructorOptions>): BrowserWindow;
/** Minimal window surface needed to service a window-control action. */
export type WindowControlTarget = Pick<BrowserWindow, 'isDestroyed' | 'minimize' | 'isMaximized' | 'maximize' | 'unmaximize' | 'close'> & {
    isFullScreen?: () => boolean;
    setFullScreen?: (flag: boolean) => void;
};
/** Applies a window action (minimize, toggle-maximize, close) preserving close-to-tray. */
export declare function applyWindowControlAction(win: WindowControlTarget, action: unknown): {
    success: true;
} | {
    error: string;
};
export declare function getPopupWindowOptions(isBlank: boolean): BrowserWindowConstructorOptions;
export declare function getKdsWindowOptions(): BrowserWindowConstructorOptions;
export declare function createKdsWindow(BrowserWindowConstructor: BrowserWindowConstructor): BrowserWindow;
type LocalWindowUrlChecker = (rawUrl: string, port: number, localIp?: string) => boolean;
export declare function createLocalWindowOpenHandler(isAllowedLocalWindowUrl: LocalWindowUrlChecker, getServerPort: () => number, getLocalIP: () => string): (details: {
    url: string;
}) => {
    action: 'allow';
    overrideBrowserWindowOptions: BrowserWindowConstructorOptions;
} | null;
/**
 * Creates a will-navigate event handler for the privileged main window.
 * Allows safe local application URLs, delegates safe external HTTP/HTTPS URLs
 * to the default system browser via shell.openExternal, and blocks unsafe schemes.
 */
export declare function createMainWindowWillNavigateHandler(isAllowedLocalWindowUrl: LocalWindowUrlChecker, getServerPort: () => number, getLocalIP: () => string, isSafeExternalUrl: (rawUrl: string) => boolean, openExternal: (url: string) => Promise<unknown> | unknown, warn?: (message: string, ...args: unknown[]) => void): (event: {
    preventDefault: () => void;
}, url: string) => void;
export {};
//# sourceMappingURL=window-options.d.ts.map