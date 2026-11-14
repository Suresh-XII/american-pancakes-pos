"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDirectUpdateIpcHandlers = createDirectUpdateIpcHandlers;
exports.registerDirectUpdateIpcHandlers = registerDirectUpdateIpcHandlers;
const ipc_1 = require("./ipc");
const update_state_1 = require("./update-state");
function createDirectUpdateIpcHandlers(options) {
    const { getMainWindow, getServerPort, getStoredUpdateStatus, getStagedUpdateReady, getUpdaterPhase, getAppVersion, checkForUpdates, downloadUpdate, readAutoUpdateCheckEnabled, writeAutoUpdateCheckEnabled, readBetaChannelEnabled, writeBetaChannelEnabled, enqueueBetaChannelTransition, configureAutoUpdaterChannel, setUpdateStatus, restartAndInstallHandler, isServerRunning, isKdsServerRunning, isServerAppRunning, getResolvedTitleBarMode, getRendererReadinessEpoch, getRendererDocumentNonce, getCurrentEffectiveIsDark, setCurrentEffectiveIsDark, applyTitleBarOverlayTheme, resolveTitleBarOverlayColors, withDatabaseRequest, log, validateSender, } = options;
    const isSenderAuthorized = (event) => {
        if (validateSender)
            return validateSender(event);
        return (0, ipc_1.isTrustedMainWindowSender)(event, getMainWindow, getServerPort());
    };
    return {
        'get-update-status': (event) => {
            if (!isSenderAuthorized(event))
                return { error: 'Unauthorized sender' };
            return (0, update_state_1.toIpcUpdateStatus)(getStoredUpdateStatus(), getAppVersion());
        },
        'check-for-updates': (event) => {
            if (!isSenderAuthorized(event))
                return { error: 'Unauthorized sender' };
            checkForUpdates();
        },
        'download-update': (event) => {
            if (!isSenderAuthorized(event))
                return { error: 'Unauthorized sender' };
            return downloadUpdate();
        },
        'updates:get-auto-check': (event) => {
            if (!isSenderAuthorized(event))
                return { error: 'Unauthorized sender' };
            return withDatabaseRequest(() => readAutoUpdateCheckEnabled());
        },
        'updates:set-auto-check': (event, enabled) => {
            if (!isSenderAuthorized(event)) {
                return { success: false, error: 'Unauthorized sender' };
            }
            if (typeof enabled !== 'boolean') {
                return { success: false, error: 'enabled must be a boolean' };
            }
            return withDatabaseRequest(() => {
                try {
                    writeAutoUpdateCheckEnabled(enabled);
                }
                catch (error) {
                    log?.error('[Update] Failed to persist automatic update preference:', error);
                    return { success: false, error: 'Could not save the automatic update preference' };
                }
                log?.info(`[Update] Automatic update checks ${enabled ? 'enabled' : 'disabled'} by user`);
                return { success: true };
            });
        },
        'updates:get-beta-channel': (event) => {
            if (!isSenderAuthorized(event))
                return { error: 'Unauthorized sender' };
            return withDatabaseRequest(() => readBetaChannelEnabled());
        },
        'updates:set-beta-channel': (event, enabled) => {
            if (!isSenderAuthorized(event)) {
                return { success: false, error: 'Unauthorized sender' };
            }
            if (typeof enabled !== 'boolean') {
                return { success: false, error: 'enabled must be a boolean' };
            }
            return enqueueBetaChannelTransition(() => withDatabaseRequest(async () => {
                if ((0, update_state_1.isInstallReady)(getStoredUpdateStatus(), getStagedUpdateReady())) {
                    return {
                        success: false,
                        error: 'A downloaded update is waiting to be installed — install it before switching channels',
                    };
                }
                if ((0, update_state_1.isUpdateCheckInFlight)(getStoredUpdateStatus(), getUpdaterPhase())) {
                    return {
                        success: false,
                        error: 'An update check or download is in progress — try again once it finishes',
                    };
                }
                try {
                    writeBetaChannelEnabled(enabled);
                }
                catch (error) {
                    log?.error('[Update] Failed to persist beta-channel preference:', error);
                    return { success: false, error: 'Could not save the channel preference' };
                }
                log?.info(`[Update] Beta channel ${enabled ? 'enabled' : 'disabled'} by user`);
                configureAutoUpdaterChannel(enabled);
                setUpdateStatus((0, update_state_1.initialUpdateState)());
                checkForUpdates();
                return { success: true };
            }));
        },
        'restart-and-install': (event, pin) => {
            if (!isSenderAuthorized(event)) {
                return Promise.resolve({ success: false, error: 'Unauthorized sender' });
            }
            return restartAndInstallHandler(event, pin);
        },
        'get-status': (event) => {
            if (!isSenderAuthorized(event))
                return { error: 'Unauthorized sender' };
            const mem = process.memoryUsage();
            return {
                server: isServerRunning() ? 'running' : 'stopped',
                kdsServer: isKdsServerRunning() ? 'running' : 'stopped',
                serverApp: isServerAppRunning() ? 'running' : 'stopped',
                memory: {
                    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
                    rss: Math.round(mem.rss / 1024 / 1024),
                },
                uptime: process.uptime(),
                port: getServerPort(),
                titleBarMode: getResolvedTitleBarMode(),
                titleBarEpoch: getRendererReadinessEpoch(),
                titleBarDocumentNonce: getRendererDocumentNonce() ?? undefined,
                effectiveTheme: getCurrentEffectiveIsDark() ? 'dark' : 'light',
            };
        },
        'set-theme-effective': (event, isDark) => {
            if (!isSenderAuthorized(event)) {
                return { success: false, error: 'Unauthorized sender' };
            }
            if (typeof isDark !== 'boolean') {
                return { success: false, error: 'isDark must be boolean' };
            }
            setCurrentEffectiveIsDark(isDark);
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                applyTitleBarOverlayTheme(mainWindow, isDark, process.platform);
                mainWindow.setBackgroundColor(resolveTitleBarOverlayColors(isDark).color);
            }
            return { success: true };
        },
    };
}
function registerDirectUpdateIpcHandlers(options) {
    const handlers = createDirectUpdateIpcHandlers(options);
    for (const [channel, handler] of Object.entries(handlers)) {
        options.ipcMain.handle(channel, handler);
    }
}
//# sourceMappingURL=update-ipc.js.map