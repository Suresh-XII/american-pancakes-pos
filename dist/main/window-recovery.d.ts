/**
 * Main-window failed-load recovery.
 *
 * Recovery destroys the failed window before its replacement exists - the only
 * way to reuse Electron's persisted window name. Destroying the last window
 * raises `window-all-closed`, so the replacement flag has to be set before the
 * destroy or Windows/Linux quit the app mid-recovery.
 */
export interface RecoverableWindow {
    isDestroyed(): boolean;
    destroy(): void;
}
export interface FailedWindowRecoveryOptions {
    getMainWindow: () => RecoverableWindow | null;
    /** True when a quit or shutdown already owns the lifecycle. */
    isAborted: () => boolean;
    /** False when runtime services are down, so relaunching is the only recovery. */
    isRuntimeHealthy: () => boolean;
    requestRelaunch: (reason: string) => void;
    createWindow: () => void;
    logError?: (message: string, error: unknown) => void;
}
export interface FailedWindowRecovery {
    /** True while a failed window is being replaced. */
    isReplacingWindow(): boolean;
    /** Runs `work` with the all-closed quit suppressed, restoring the prior state. */
    suppressAllClosedQuit<T>(work: () => T): T;
    /** Re-arms in-place recovery after a window loaded successfully. */
    markLoadSucceeded(): void;
    recover(failedWindow: RecoverableWindow): void;
}
/** Windows/Linux quit on the last closed window; macOS keeps the app alive. */
export declare function shouldQuitOnAllWindowsClosed(platform: string, replacingWindow: boolean): boolean;
export declare function createFailedWindowRecovery(options: FailedWindowRecoveryOptions): FailedWindowRecovery;
//# sourceMappingURL=window-recovery.d.ts.map