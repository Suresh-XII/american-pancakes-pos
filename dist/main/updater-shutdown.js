"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUpdateCheckTracker = createUpdateCheckTracker;
exports.linkUpdateCheckRequests = linkUpdateCheckRequests;
exports.createSuspendUpdaterForOfflineMode = createSuspendUpdaterForOfflineMode;
exports.createAutoUpdaterErrorHandler = createAutoUpdaterErrorHandler;
exports.createRestartAndInstallHandler = createRestartAndInstallHandler;
const builder_util_runtime_1 = require("builder-util-runtime");
const update_state_1 = require("./update-state");
function createUpdateCheckTracker(options) {
    let nextCheckId = 0;
    let acceptedCheckId = 0;
    const pendingInvalidatedChecks = new Set();
    let deferredRunner = null;
    const beginCheck = (runCheck) => {
        if (pendingInvalidatedChecks.size > 0) {
            deferredRunner = runCheck;
            acceptedCheckId = 0;
            return null;
        }
        const checkId = ++nextCheckId;
        acceptedCheckId = checkId;
        let task;
        try {
            task = Promise.resolve(runCheck(checkId));
        }
        catch (error) {
            task = Promise.reject(error);
        }
        void task
            .catch(() => { })
            .finally(() => {
            const wasInvalidated = pendingInvalidatedChecks.delete(checkId);
            if (wasInvalidated && pendingInvalidatedChecks.size === 0 && deferredRunner) {
                const nextRun = deferredRunner;
                deferredRunner = null;
                if (options?.shouldRunDeferredCheck ? options.shouldRunDeferredCheck() : true) {
                    beginCheck(nextRun);
                }
            }
        });
        return checkId;
    };
    return {
        beginCheck,
        invalidateActiveCheck: () => {
            deferredRunner = null;
            if (acceptedCheckId > 0) {
                pendingInvalidatedChecks.add(acceptedCheckId);
                acceptedCheckId = 0;
            }
        },
        canAcceptCheckEvent: (checkId) => {
            if (pendingInvalidatedChecks.size > 0 || acceptedCheckId === 0)
                return false;
            return checkId === undefined || checkId === acceptedCheckId;
        },
        hasPendingInvalidatedCheck: () => pendingInvalidatedChecks.size > 0,
    };
}
// Providers create their own per-check token, so the active check token is attached as its
// parent: cancelling it aborts the in-flight request and rejects every later one in the chain.
function linkUpdateCheckRequests(executor, getCheckToken) {
    const request = executor.request.bind(executor);
    executor.request = (options, cancellationToken = new builder_util_runtime_1.CancellationToken(), data) => {
        const checkToken = getCheckToken();
        if (checkToken)
            cancellationToken.parent = checkToken;
        return request(options, cancellationToken, data);
    };
}
function createSuspendUpdaterForOfflineMode({ getPhase, setPhase, getStatus, setUpdateStatus, cancelDownload, invalidateCheck, }) {
    return () => {
        const phase = getPhase();
        const status = getStatus().status;
        const checkInFlight = phase === 'check' && status === 'checking';
        const downloadInFlight = phase === 'download' && status === 'downloading';
        if (!checkInFlight && !downloadInFlight)
            return;
        if (downloadInFlight) {
            cancelDownload();
        }
        else {
            invalidateCheck?.();
        }
        setPhase('check');
        setUpdateStatus({ status: 'offline', reason: 'unknown', error: 'Offline mode is on' });
    };
}
function createAutoUpdaterErrorHandler({ getPhase, setPhase, isInstallReady, isInstallingUpdate, isOfflineSuppressed, isStaleCheckSuppressed, setUpdateStatus, onInstallFailure, logInfo, }) {
    return (error) => {
        const errorPhase = getPhase();
        const classified = (0, update_state_1.classifyUpdateError)(error, errorPhase);
        setPhase('check');
        logInfo(`[Update] Updater error classified as ${classified.state}` + `/${classified.reason}:`, classified.detail);
        if (isInstallingUpdate()) {
            logInfo('[Update] Installation failed after shutdown; relaunching the current version');
            onInstallFailure(error);
            return;
        }
        if (isInstallReady()) {
            logInfo('[Update] Preserving ready-to-install status while staged update awaits installation');
            return;
        }
        if (isOfflineSuppressed?.()) {
            setUpdateStatus({ status: 'offline', reason: 'unknown', error: 'Offline mode is on' });
            return;
        }
        if (isStaleCheckSuppressed?.()) {
            return;
        }
        setUpdateStatus({
            status: classified.state,
            reason: classified.reason,
            error: classified.detail,
        });
    };
}
function createRestartAndInstallHandler({ isInstallReady, authorize, runCleanup, quitAndInstall, updateState, onInstallFailure, warn, error, }) {
    return async (_event, pin) => {
        if (!isInstallReady()) {
            warn('[Update] Ignoring install request before an update is downloaded');
            return { success: false, error: 'No downloaded update is ready to install.' };
        }
        const auth = authorize(typeof pin === 'string' ? pin : undefined);
        if (!auth.ok) {
            warn(`[Update] Restart-to-install denied by Master PIN gate: ${auth.error}`);
            return { success: false, error: auth.error };
        }
        updateState.setInstallingUpdate(true);
        updateState.setQuitting(true);
        try {
            await runCleanup();
        }
        catch (cleanupError) {
            error('[Update] Pre-install cleanup failed (proceeding with install):', cleanupError);
        }
        try {
            quitAndInstall(false, true);
            return { success: true };
        }
        catch (installError) {
            error('[Update] quitAndInstall failed:', installError);
            onInstallFailure(installError);
            return {
                success: false,
                error: installError instanceof Error ? installError.message : String(installError),
            };
        }
    };
}
//# sourceMappingURL=updater-shutdown.js.map