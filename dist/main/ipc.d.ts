import { BrowserWindow } from 'electron';
/** Verifies that a URL has http: scheme, no credentials, loopback host, and matches the configured port. */
export declare function isTrustedLoopbackUrl(rawUrl: string, port: number): boolean;
/** Verifies that IPC sender origin is the localhost-served POS renderer. */
export declare function isTrustedSender(event: Pick<Electron.IpcMainInvokeEvent, 'sender'>): boolean;
type MainWindowGetter = () => BrowserWindow | null;
/** Verifies that IPC sender is the active main BrowserWindow, current top-level frame, and exact local app origin. */
export declare function isTrustedMainWindowSender(event: Pick<Electron.IpcMainInvokeEvent, 'sender' | 'senderFrame'>, mainWindowOrGetter?: BrowserWindow | null | (() => BrowserWindow | null) | undefined, port?: number, browserWindowClass?: {
    fromWebContents: (sender: Electron.WebContents) => BrowserWindow | null;
}): boolean;
export declare function registerIpcHandlers(shutdownSignal?: AbortSignal, getMainWindow?: MainWindowGetter, showMainWindow?: (window: BrowserWindow) => boolean, getCurrentEffectiveIsDark?: () => boolean): void;
export {};
//# sourceMappingURL=ipc.d.ts.map