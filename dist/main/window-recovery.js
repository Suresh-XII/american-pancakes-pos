"use strict";
/**
 * Main-window failed-load recovery.
 *
 * Recovery destroys the failed window before its replacement exists - the only
 * way to reuse Electron's persisted window name. Destroying the last window
 * raises `window-all-closed`, so the replacement flag has to be set before the
 * destroy or Windows/Linux quit the app mid-recovery.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldQuitOnAllWindowsClosed = shouldQuitOnAllWindowsClosed;
exports.createFailedWindowRecovery = createFailedWindowRecovery;
/** Windows/Linux quit on the last closed window; macOS keeps the app alive. */
function shouldQuitOnAllWindowsClosed(platform, replacingWindow) {
    return platform !== 'darwin' && !replacingWindow;
}
function createFailedWindowRecovery(options) {
    let recoveryAttempted = false;
    let replacingWindow = false;
    const suppressAllClosedQuit = (work) => {
        const previous = replacingWindow;
        replacingWindow = true;
        try {
            return work();
        }
        finally {
            replacingWindow = previous;
        }
    };
    const recover = (failedWindow) => {
        if (options.isAborted())
            return;
        if (options.getMainWindow() !== failedWindow)
            return;
        if (!options.isRuntimeHealthy()) {
            options.requestRelaunch('window-load-retry-exhausted');
            return;
        }
        if (recoveryAttempted) {
            options.requestRelaunch('window-load-recovery-failed');
            return;
        }
        recoveryAttempted = true;
        suppressAllClosedQuit(() => {
            try {
                if (!failedWindow.isDestroyed())
                    failedWindow.destroy();
                options.createWindow();
            }
            catch (error) {
                options.logError?.('[Window] Window recreation failed:', error);
                options.requestRelaunch('window-load-recovery-create-failed');
            }
        });
    };
    return {
        isReplacingWindow: () => replacingWindow,
        suppressAllClosedQuit,
        markLoadSucceeded: () => { recoveryAttempted = false; },
        recover,
    };
}
//# sourceMappingURL=window-recovery.js.map