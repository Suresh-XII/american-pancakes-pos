"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const bonjour_service_1 = require("bonjour-service");
const db_1 = require("./db");
const downgrade_recovery_1 = require("./downgrade-recovery");
const update_channel_1 = require("./update-channel");
const catalog_1 = require("./tax-packs/catalog");
const server_1 = require("./server");
const cloud_sync_1 = require("./services/cloud-sync");
const offline_mode_1 = require("./services/offline-mode");
const telemetry_1 = require("./services/telemetry");
const posthog_1 = require("./services/posthog");
const google_drive_1 = require("./services/google-drive");
const local_backup_1 = require("./services/local-backup");
const kds_server_1 = require("./kds-server");
const server_app_1 = require("./server-app");
const thermal_1 = require("./printers/thermal");
const raster_renderer_1 = require("./printers/raster-renderer");
const ipc_1 = require("./ipc");
const master_pin_1 = require("./services/master-pin");
const whatsapp_1 = require("./services/whatsapp");
const scheduled_orders_1 = require("./services/scheduled-orders");
const main_1 = __importDefault(require("electron-log/main"));
const electron_updater_1 = require("electron-updater");
const builder_util_runtime_1 = require("builder-util-runtime");
const url_allowlist_1 = require("./security/url-allowlist");
const update_state_1 = require("./update-state");
const updater_shutdown_1 = require("./updater-shutdown");
const startup_cache_1 = require("./startup-cache");
const window_options_1 = require("./window-options");
const update_ipc_1 = require("./update-ipc");
const title_bar_theme_1 = require("./title-bar-theme");
const window_readiness_1 = require("./window-readiness");
const window_load_retry_1 = require("./window-load-retry");
const window_recovery_1 = require("./window-recovery");
const usb_device_permissions_1 = require("./usb-device-permissions");
const backend_health_1 = require("./backend-health");
const runtime_recovery_1 = require("./runtime-recovery");
const shutdown_1 = require("./shutdown");
// Disable GPU sandbox on Windows to avoid DLL crash fallback
if (process.platform === 'win32') {
    electron_1.app.commandLine.appendSwitch('disable-gpu-sandbox');
}
// Mac App Store builds: Electron sets process.mas = true inside the MAS sandbox.
// MAS_BUILD=1 is the build-time fallback (dev/CI).
const isMasBuild = process.env.MAS_BUILD === '1' || process.mas === true;
// MSIX apps install under WindowsApps; check path for runtime detection.
const isMsixBuild = process.platform === 'win32' && process.execPath.toLowerCase().includes('windowsapps');
// Either store build: skip third-party auto-updater entirely.
const isStoreBuild = isMasBuild || isMsixBuild;
const UNPACKED_DEV_MARKER = 'flo-unpacked-dev.marker';
main_1.default.initialize();
main_1.default.transports.file.level = 'info';
main_1.default.transports.console.level = 'debug';
// electron-log's default rotation (~1MB, one archived copy) already bounds disk usage.
const logPath = main_1.default.transports.file.getFile().path.replace(/[^\/\\]+$/, '');
console.log('[Log] Log files location:', logPath);
// Persisted update state: transitions are routed here for status recovery.
let storedUpdateStatus = (0, update_state_1.initialUpdateState)();
let updaterPhase = 'check';
let stagedUpdateReady = false;
const updateCheckTracker = (0, updater_shutdown_1.createUpdateCheckTracker)({
    shouldRunDeferredCheck: () => !(0, offline_mode_1.isOfflineMode)() && !(0, update_state_1.isInstallReady)(storedUpdateStatus, stagedUpdateReady),
});
let startupFailure = false;
let isInstallingUpdate = false;
let betaChannelTransitionTail = Promise.resolve();
// Beta channel opt-in stored in SQLite settings; defaults to stable on error.
function readBetaChannelEnabled() {
    try {
        const row = (0, db_1.getDatabase)()
            .prepare('SELECT value FROM settings WHERE key = ?')
            .get(update_channel_1.BETA_CHANNEL_SETTING_KEY);
        const prerelease = electron_updater_1.autoUpdater.currentVersion.prerelease[0];
        const isBetaBuild = prerelease === 'beta';
        return (0, update_channel_1.parseStoredBetaChannelEnabled)(row?.value, isBetaBuild);
    }
    catch (error) {
        main_1.default.warn('[Update] Could not read beta-channel preference; using stable:', error);
        return false;
    }
}
function writeBetaChannelEnabled(enabled) {
    (0, db_1.getDatabase)()
        .prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run(update_channel_1.BETA_CHANNEL_SETTING_KEY, enabled ? 'true' : 'false', (0, db_1.now)());
}
function readAutoUpdateCheckEnabled() {
    try {
        const row = (0, db_1.getDatabase)()
            .prepare('SELECT value FROM settings WHERE key = ?')
            .get(update_state_1.AUTO_UPDATE_CHECK_SETTING_KEY);
        return (0, update_state_1.parseStoredAutoUpdateCheckEnabled)(row?.value);
    }
    catch (error) {
        main_1.default.warn('[Update] Could not read automatic update preference; checking anyway:', error);
        return true;
    }
}
function writeAutoUpdateCheckEnabled(enabled) {
    (0, db_1.getDatabase)()
        .prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run(update_state_1.AUTO_UPDATE_CHECK_SETTING_KEY, enabled ? 'true' : 'false', (0, db_1.now)());
}
function enqueueBetaChannelTransition(operation) {
    const transition = betaChannelTransitionTail.then(operation, operation);
    betaChannelTransitionTail = transition.then(() => undefined, () => undefined);
    return transition;
}
function configureAutoUpdaterChannel(betaOptInOverride) {
    const prerelease = electron_updater_1.autoUpdater.currentVersion.prerelease[0];
    const versionChannel = typeof prerelease === 'string' ? prerelease : null;
    const resolved = (0, update_channel_1.resolveUpdateChannel)({
        versionPrereleaseChannel: versionChannel,
        betaOptIn: betaOptInOverride ?? readBetaChannelEnabled(),
    });
    electron_updater_1.autoUpdater.channel = resolved.channel;
    electron_updater_1.autoUpdater.allowPrerelease = resolved.allowPrerelease;
    // Allow downgrade only for beta builds remaining on beta feed.
    electron_updater_1.autoUpdater.allowDowngrade = resolved.allowDowngrade;
    if (resolved.channel) {
        main_1.default.info(`[Update] Opted into ${resolved.channel} release channel`);
    }
    else if (versionChannel) {
        // Unsupported prerelease channels fall back to stable updates.
        main_1.default.warn(`[Update] Unsupported prerelease channel ${versionChannel}; using stable updates only`);
    }
}
function setUpdateStatus(next) {
    if (next.status !== storedUpdateStatus.status) {
        const reasonSuffix = next.reason ? ` (${next.reason})` : '';
        main_1.default.info(`[Update] Status change: ${storedUpdateStatus.status} -> ${next.status}${reasonSuffix}`);
    }
    storedUpdateStatus = next;
    mainWindow?.webContents.send('update-status', storedUpdateStatus);
}
function setupAutoUpdater() {
    electron_updater_1.autoUpdater.logger = main_1.default;
    configureAutoUpdaterChannel();
    // The user approves both the download and the restart-to-install.
    electron_updater_1.autoUpdater.autoDownload = false;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = false;
    // electron-updater has no public check cancellation; every provider metadata request uses this executor.
    const updaterHttpExecutor = electron_updater_1.autoUpdater.httpExecutor;
    if (updaterHttpExecutor) {
        (0, updater_shutdown_1.linkUpdateCheckRequests)(updaterHttpExecutor, () => updateCheckToken);
    }
    else {
        main_1.default.warn('[Update] Updater HTTP executor unavailable; Offline mode cannot abort checks');
    }
    electron_updater_1.autoUpdater.on('checking-for-update', () => {
        if ((0, offline_mode_1.isOfflineMode)() || !updateCheckTracker.canAcceptCheckEvent())
            return;
        console.log('[Update] Checking for updates...');
        updaterPhase = 'check';
        setUpdateStatus({ status: 'checking' });
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        if (!(0, update_state_1.canAcceptUpdateCheckResult)(storedUpdateStatus, updaterPhase, (0, offline_mode_1.isOfflineMode)(), updateCheckTracker.canAcceptCheckEvent())) {
            return;
        }
        console.log('[Update] Update available, awaiting user approval to download:', info.version);
        updaterPhase = 'check';
        setUpdateStatus({
            status: 'available',
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
        });
    });
    electron_updater_1.autoUpdater.on('update-not-available', () => {
        if (!(0, update_state_1.canAcceptUpdateCheckResult)(storedUpdateStatus, updaterPhase, (0, offline_mode_1.isOfflineMode)(), updateCheckTracker.canAcceptCheckEvent())) {
            return;
        }
        console.log('[Update] No updates available');
        setUpdateStatus({ status: 'up-to-date' });
    });
    electron_updater_1.autoUpdater.on('download-progress', (progress) => {
        console.log(`[Update] Download progress: ${progress.percent.toFixed(1)}%`);
        setUpdateStatus({
            status: 'downloading',
            percent: progress.percent,
            version: storedUpdateStatus.version,
        });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        // The renderer's update badge shows a "Restart Now" prompt. Because
        // autoInstallOnAppQuit is disabled, only that explicit action installs it.
        console.log('[Update] Download complete:', info.version);
        stagedUpdateReady = true;
        updaterPhase = 'check';
        setUpdateStatus({
            status: 'ready-to-install',
            version: info.version,
        });
    });
    electron_updater_1.autoUpdater.on('error', (0, updater_shutdown_1.createAutoUpdaterErrorHandler)({
        getPhase: () => updaterPhase,
        setPhase: (phase) => {
            updaterPhase = phase;
        },
        isInstallReady: () => (0, update_state_1.isInstallReady)(storedUpdateStatus, stagedUpdateReady),
        isInstallingUpdate: () => isInstallingUpdate,
        isOfflineSuppressed: () => (0, offline_mode_1.isOfflineMode)(),
        isStaleCheckSuppressed: () => updaterPhase === 'check' && !updateCheckTracker.canAcceptCheckEvent(),
        setUpdateStatus,
        onInstallFailure: () => requestRuntimeRelaunchOnce('update-install-failed'),
        logInfo: (message, detail) => main_1.default.info(message, detail),
    }));
    (0, offline_mode_1.onOfflineModeEnabled)(suspendUpdaterForOfflineMode);
}
function checkForUpdates() {
    if ((0, update_state_1.isInstallReady)(storedUpdateStatus, stagedUpdateReady)) {
        main_1.default.info('[Update] Ignoring check while a staged update awaits installation');
        return;
    }
    if ((0, update_state_1.isUpdateCheckInFlight)(storedUpdateStatus, updaterPhase)) {
        main_1.default.info('[Update] Ignoring check while another update operation is in progress');
        return;
    }
    if ((0, offline_mode_1.isOfflineMode)()) {
        setUpdateStatus({ status: 'offline', reason: 'unknown', error: 'Offline mode is on' });
        return;
    }
    // Linux: only AppImage supports self-update via electron-updater;
    // package manager installs are notified accordingly.
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
        main_1.default.info('[Update] Linux non-AppImage install — updates managed by package manager');
        setUpdateStatus((0, update_state_1.oneShotUpdateState)('linux-managed'));
        return;
    }
    if (isStoreBuild) {
        main_1.default.debug('[Update] Store build — updates handled by the platform store');
        setUpdateStatus((0, update_state_1.oneShotUpdateState)('store-managed'));
        return;
    }
    const isUpdaterDevelopmentArtifact = (0, update_state_1.isDevelopmentOrUnpackedArtifact)({
        defaultApp: process.defaultApp === true,
        packaged: electron_1.app.isPackaged,
        unpackedMarker: fs.existsSync(path.join(process.resourcesPath, UNPACKED_DEV_MARKER)),
    });
    const configPath = path.join(process.resourcesPath, 'app-update.yml');
    let configMissing = false;
    let configProbeFailed = false;
    let configProbeError;
    if (!isUpdaterDevelopmentArtifact) {
        try {
            fs.statSync(configPath);
        }
        catch (error) {
            if ((0, update_state_1.isMissingUpdateConfigError)(error)) {
                configMissing = true;
            }
            else {
                configProbeFailed = true;
                configProbeError = error;
            }
        }
    }
    const configDetail = `app-update.yml not found at ${configPath}`;
    if (isUpdaterDevelopmentArtifact) {
        main_1.default.debug('[Update] Skipping update check in dev mode');
        setUpdateStatus((0, update_state_1.oneShotUpdateState)('dev-mode'));
        return;
    }
    if (configProbeFailed) {
        const classified = (0, update_state_1.classifyUpdateError)(configProbeError, 'check');
        main_1.default.info(`[Update] Update configuration probe classified as ${classified.state}` +
            `/${classified.reason}:`, classified.detail);
        setUpdateStatus({
            status: classified.state,
            reason: classified.reason,
            error: classified.detail,
        });
        return;
    }
    if (configMissing) {
        main_1.default.info('[Update] Packaged build is missing app-update.yml at', configPath);
        setUpdateStatus((0, update_state_1.missingUpdateConfigState)(false, configDetail));
        return;
    }
    updaterPhase = 'check';
    setUpdateStatus({ status: 'checking' });
    updateCheckTracker.beginCheck(() => {
        updaterPhase = 'check';
        setUpdateStatus({ status: 'checking' });
        const checkToken = new builder_util_runtime_1.CancellationToken();
        updateCheckToken = checkToken;
        return electron_updater_1.autoUpdater
            .checkForUpdates()
            .catch((err) => {
            // Record error state; catch prevents unhandled rejection.
            console.error('[Update] Check failed:', err);
        })
            .finally(() => {
            if (updateCheckToken === checkToken)
                updateCheckToken = null;
        });
    });
}
let updateCheckToken = null;
let updateDownloadToken = null;
const suspendUpdaterForOfflineMode = (0, updater_shutdown_1.createSuspendUpdaterForOfflineMode)({
    getPhase: () => updaterPhase,
    setPhase: (phase) => {
        updaterPhase = phase;
    },
    getStatus: () => storedUpdateStatus,
    setUpdateStatus,
    cancelDownload: () => {
        updateDownloadToken?.cancel();
        updateDownloadToken = null;
    },
    invalidateCheck: () => {
        updateCheckToken?.cancel();
        updateCheckTracker.invalidateActiveCheck();
    },
});
function downloadUpdate() {
    if ((0, offline_mode_1.isOfflineMode)())
        return { success: false, error: 'Offline mode is on' };
    if (!(0, update_state_1.canStartUpdateDownload)(storedUpdateStatus, updaterPhase, stagedUpdateReady)) {
        return { success: false, error: 'No update is waiting to be downloaded' };
    }
    main_1.default.info(`[Update] User approved download of ${storedUpdateStatus.version ?? 'update'}`);
    updaterPhase = 'download';
    setUpdateStatus({ status: 'downloading', percent: 0, version: storedUpdateStatus.version });
    updateDownloadToken = new builder_util_runtime_1.CancellationToken();
    electron_updater_1.autoUpdater.downloadUpdate(updateDownloadToken).catch((err) => {
        // The updater 'error' event records the failure state.
        console.error('[Update] Download failed:', err);
    });
    return { success: true };
}
// Best-effort startup check for tax pack plugin updates.
async function checkTaxPackUpdatesOnStartup() {
    if ((0, offline_mode_1.isOfflineMode)())
        return;
    try {
        const remote = await (0, catalog_1.fetchRemoteTaxPackCatalog)();
        const installedRows = (0, db_1.getDatabase)()
            .prepare(`
      SELECT pack.id AS pack_id, pack.country, pack.publisher, version.version
      FROM country_packs AS pack
      JOIN country_pack_versions AS version ON version.id = pack.active_version_id
      WHERE pack.status = 'active'
    `)
            .all();
        const updates = (0, catalog_1.computeTaxPackUpdates)(installedRows.map((row) => ({
            packId: row.pack_id,
            country: row.country,
            publisher: row.publisher,
            version: row.version,
        })), remote.catalog);
        if (updates.length > 0) {
            const summary = updates
                .map((update) => `${update.packId} ${update.currentVersion} -> ${update.latestVersion}`)
                .join(', ');
            console.log(`[Tax Packs] ${updates.length} plugin update(s) available: ${summary}`);
        }
        else {
            console.log('[Tax Packs] Plugin update check: all installed tax packs are up to date');
        }
    }
    catch (error) {
        console.warn('[Tax Packs] Startup plugin update check skipped (offline or catalog unavailable):', error);
    }
}
let mainWindow = null;
let tray = null;
// Track USB device permissions registration so listeners are not duplicated across windows.
let usbDevicePermissionsRegistered = false;
// Title-bar capability reported to the renderer via get-status; updated each
// time the main window is created.
let resolvedTitleBarMode = 'native-overlay';
// Injected as a getter into ipc.ts — it cannot import ./index (load-time cycle).
let currentEffectiveIsDark = false;
let bonjour = null;
let isQuitting = false;
let runtimeState = 'starting';
let initializationPromise = null;
let activationPending = false;
let runtimeRelaunchRequested = false;
// Last did-fail-load detail captured for diagnostic dialog; cleared on successful load.
let lastWindowLoadFailure = null;
// Self-healing GPU fallback: relaunch with --disable-gpu after repeated crashes.
let shouldDisableGpuOnRelaunch = false;
let consecutiveRendererCrashes = 0;
const GPU_FALLBACK_CRASH_THRESHOLD = 2;
// Reset crash counters only after a window stays up for this duration.
const RENDERER_STABILITY_RESET_MS = 30_000;
let rendererStabilityResetTimer = null;
function clearRendererStabilityResetTimer() {
    if (rendererStabilityResetTimer) {
        clearTimeout(rendererStabilityResetTimer);
        rendererStabilityResetTimer = null;
    }
}
const updateShutdownState = {
    setInstallingUpdate: (value) => {
        isInstallingUpdate = value;
    },
    setQuitting: (value) => {
        isQuitting = value;
        if (value) {
            runtimeState = 'stopping';
            main_1.default.info('[Lifecycle] Runtime is stopping');
        }
    },
};
function showMainWindow(expectedWindow) {
    if (isQuitting || isShutdownRequested())
        return false;
    if (expectedWindow && mainWindow !== expectedWindow)
        return false;
    if (!mainWindow || mainWindow.isDestroyed())
        return false;
    if (!(0, runtime_recovery_1.isRuntimeHealthy)(runtimeState, getRuntimeServices(), isShutdownRequested())) {
        void handleMainWindowActivation();
        return false;
    }
    if (isFailedWindowDocument(mainWindow)) {
        recoverFailedWindow(mainWindow);
        return false;
    }
    if (!(0, window_readiness_1.isWindowRendererReady)() && !(0, window_readiness_1.isRendererReadinessFailSafeShown)())
        return false;
    // Native E2E drives the real app without popping a window on the developer's
    // desktop; the renderer keeps running unthrottled (see createWindow).
    if (process.env.FLO_E2E_HIDDEN_WINDOW === '1')
        return true;
    if (mainWindow.isMinimized())
        mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
    return true;
}
function getRuntimeServices() {
    return {
        main: (0, server_1.isServerRunning)(),
        kds: (0, kds_server_1.isKdsServerRunning)(),
        serverApp: (0, server_app_1.isServerAppRunning)(),
    };
}
function isFailedWindowDocument(window) {
    try {
        return window.webContents.getURL().startsWith('chrome-error://');
    }
    catch {
        return true;
    }
}
const failedWindowRecovery = (0, window_recovery_1.createFailedWindowRecovery)({
    getMainWindow: () => mainWindow,
    isAborted: () => isQuitting || isShutdownRequested() || runtimeState === 'stopping',
    isRuntimeHealthy: () => (0, runtime_recovery_1.isRuntimeHealthy)(runtimeState, getRuntimeServices(), isShutdownRequested()),
    requestRelaunch: (reason) => requestRuntimeRelaunchOnce(reason),
    createWindow,
    logError: (message, error) => main_1.default.error(message, error),
});
function recoverFailedWindow(failedWindow) {
    failedWindowRecovery.recover(failedWindow);
}
// Flag passed in argv to prevent infinite relaunch loops across process restarts.
const RUNTIME_RELAUNCH_ATTEMPT_FLAG = '--flo-runtime-relaunch-attempt';
function hasAlreadyAttemptedRuntimeRelaunch() {
    return (0, runtime_recovery_1.hasRelaunchAttemptFlag)(process.argv, RUNTIME_RELAUNCH_ATTEMPT_FLAG);
}
// Gates repeat relaunches across process restarts until runtime recovers.
const relaunchAttemptGuard = (0, runtime_recovery_1.createRelaunchAttemptGuard)(hasAlreadyAttemptedRuntimeRelaunch());
function performAppRelaunch() {
    // Preserve --disable-gpu flag on relaunch if GPU fallback was triggered.
    const wantsGpuDisabled = shouldDisableGpuOnRelaunch || electron_1.app.commandLine.hasSwitch('disable-gpu');
    if (process.defaultApp || !electron_1.app.isPackaged) {
        const relaunchArgs = process.argv.slice(1).map((arg) => (arg === '.' ? process.cwd() : arg));
        // Retain sandbox and display flags required under Playwright/CI.
        if (electron_1.app.commandLine.hasSwitch('no-sandbox') && !relaunchArgs.includes('--no-sandbox')) {
            relaunchArgs.push('--no-sandbox');
        }
        if (wantsGpuDisabled && !relaunchArgs.includes('--disable-gpu')) {
            relaunchArgs.push('--disable-gpu');
        }
        if (electron_1.app.commandLine.hasSwitch('disable-dev-shm-usage') &&
            !relaunchArgs.includes('--disable-dev-shm-usage')) {
            relaunchArgs.push('--disable-dev-shm-usage');
        }
        if (!relaunchArgs.includes(RUNTIME_RELAUNCH_ATTEMPT_FLAG))
            relaunchArgs.push(RUNTIME_RELAUNCH_ATTEMPT_FLAG);
        electron_1.app.relaunch({ execPath: process.execPath, args: relaunchArgs });
    }
    else {
        const relaunchArgs = process.argv.slice(1);
        if (wantsGpuDisabled && !relaunchArgs.includes('--disable-gpu')) {
            relaunchArgs.push('--disable-gpu');
        }
        if (!relaunchArgs.includes(RUNTIME_RELAUNCH_ATTEMPT_FLAG))
            relaunchArgs.push(RUNTIME_RELAUNCH_ATTEMPT_FLAG);
        electron_1.app.relaunch({ args: relaunchArgs });
    }
}
// Dialog shown when runtime repeatedly fails after a restart.
async function showRuntimeStuckDialog(reason) {
    const services = getRuntimeServices();
    const detailLines = [
        `Reason: ${reason}`,
        `Server: ${services.main ? 'running' : 'stopped'} | KDS: ${services.kds ? 'running' : 'stopped'} | Server App: ${services.serverApp ? 'running' : 'stopped'}`,
    ];
    if (lastWindowLoadFailure) {
        detailLines.push(`Load error: ${lastWindowLoadFailure.errorDescription} (${lastWindowLoadFailure.errorCode})`, `URL: ${lastWindowLoadFailure.validatedURL ?? `http://localhost:${(0, server_1.getServerPort)()}`}`);
    }
    detailLines.push(`Platform: ${process.platform} | Flo: ${electron_1.app.getVersion()}`);
    const { response } = await electron_1.dialog.showMessageBox({
        type: 'error',
        title: 'Flo needs to restart',
        message: 'Flo could not recover automatically. This usually means another program ' +
            '(antivirus, firewall, or a leftover Flo process) is blocking its local server.\n\n' +
            'Please quit and reopen the app. If this keeps happening, sending a diagnostic ' +
            'report helps us fix it — it contains no order, customer, or business data.',
        detail: detailLines.join('\n'),
        buttons: ['Send Diagnostic Report', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
    });
    if (response !== 0)
        return;
    cloud_sync_1.cloudSync.captureOperationFailure({
        capture_point: 'fc.electron.runtime.relaunch_exhausted',
        outcome: 'unknown',
    });
    await electron_1.dialog.showMessageBox({
        type: 'info',
        title: 'Flo',
        message: 'Diagnostic captured. If sharing is enabled and this device is online, it will be sent automatically.',
        buttons: ['Quit'],
    });
}
function requestRuntimeRelaunch(reason) {
    runtimeState = 'stopping';
    isQuitting = true;
    runtimeRelaunchRequested = true;
    main_1.default.error(`[Lifecycle] Runtime recovery relaunch requested: ${reason}`);
    if (process.env.FLO_E2E_PID_FILE)
        console.log('[Native E2E] runtime relaunch requested');
    const alreadyAttempted = relaunchAttemptGuard.hasExhaustedAttempt();
    const finishRelaunch = () => {
        if (alreadyAttempted) {
            main_1.default.error(`[Lifecycle] Runtime already relaunched once and failed again (${reason}); not relaunching again.`);
            void showRuntimeStuckDialog(reason)
                .catch((error) => main_1.default.error('[Lifecycle] Runtime-stuck dialog failed:', error))
                .finally(() => {
                try {
                    electron_1.app.exit(0);
                }
                catch (error) {
                    main_1.default.error('[Lifecycle] Exit after runtime-stuck dialog failed:', error);
                    electron_1.app.exit(1);
                }
            });
            return;
        }
        try {
            main_1.default.info('[Lifecycle] Runtime cleanup finished; relaunching Flo');
            performAppRelaunch();
            electron_1.app.exit(0);
        }
        catch (error) {
            main_1.default.error('[Lifecycle] Runtime relaunch failed after cleanup:', error);
            electron_1.app.exit(1);
        }
    };
    void runCleanup().then(finishRelaunch, (error) => {
        main_1.default.error('[Lifecycle] Runtime recovery cleanup failed; proceeding anyway:', error);
        finishRelaunch();
    });
}
const requestRuntimeRelaunchOnce = (0, runtime_recovery_1.createRelaunchGate)(requestRuntimeRelaunch);
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
let gotSingleInstanceLock = false;
// Single-instance lock: prevent duplicate app instances.
if (process.env.FLO_E2E_USER_DATA_DIR) {
    // Use isolated profile directory in E2E tests.
    electron_1.app.setPath('userData', path.resolve(process.env.FLO_E2E_USER_DATA_DIR));
}
else if (process.platform === 'linux') {
    // Set explicit paths on Linux to avoid temporary mount directories.
    electron_1.app.name = 'flo-desktop';
    electron_1.app.setPath('userData', path.join(os.homedir(), '.config', 'flo-desktop'));
}
gotSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    console.log('[Lock] Another instance is already running. Quitting.');
    electron_1.app.quit();
    process.exit(0);
}
if (gotSingleInstanceLock) {
    // Focus the existing window if a second launch is attempted.
    electron_1.app.on('second-instance', () => {
        void handleMainWindowActivation();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.focus();
            if (process.platform === 'linux') {
                mainWindow.setAlwaysOnTop(true);
                mainWindow.setAlwaysOnTop(false);
                electron_1.app.focus();
            }
        }
    });
}
function createWindow() {
    if (isQuitting || isShutdownRequested())
        return;
    if (!(0, runtime_recovery_1.isRuntimeHealthy)(runtimeState, getRuntimeServices(), isShutdownRequested())) {
        main_1.default.error('[Lifecycle] Refusing to create a POS window without a healthy runtime');
        requestRuntimeRelaunchOnce('create-window-without-healthy-runtime');
        return;
    }
    // Clear stale GPU/code caches when Electron version upgrades.
    (0, startup_cache_1.clearStaleRenderCachesOnVersionChange)(electron_1.app.getPath('userData'), process.versions.electron, main_1.default);
    // Initialize readiness fail-safe and start document epoch.
    (0, window_readiness_1.initWindowReadiness)(() => {
        showMainWindow();
    });
    (0, window_readiness_1.beginRendererDocument)();
    // Resolve whether native title bar overlay is supported or if fallback is required.
    resolvedTitleBarMode = (0, window_options_1.resolveTitleBarMode)({
        platform: process.platform,
        electronVersion: process.versions.electron,
        overlayApiPresent: typeof electron_1.BrowserWindow.prototype?.setTitleBarOverlay === 'function',
    });
    // Direct read: createWindow() runs before IPC handlers exist; re-read on
    // crash-recovery re-entry. Absent/invalid rows resolve to 'system'.
    let themeMode = 'system';
    try {
        const row = (0, db_1.getDatabase)()
            .prepare("SELECT value FROM settings WHERE key = 'theme_mode'")
            .get();
        themeMode = (0, title_bar_theme_1.resolveThemeMode)(row?.value);
    }
    catch {
        // No DB yet (first boot edge) → 'system'.
    }
    const initialIsDark = (0, title_bar_theme_1.resolveInitialIsDark)(themeMode, electron_1.nativeTheme.shouldUseDarkColors);
    currentEffectiveIsDark = initialIsDark;
    const createdWindow = (0, window_options_1.createMainWindow)(electron_1.BrowserWindow, path.join(__dirname, 'preload.js'), process.platform, initialIsDark, resolvedTitleBarMode, 
    // Hidden windows are throttled by Chromium; the native E2E harness still
    // needs live timers and WebSocket traffic from a window it never shows.
    process.env.FLO_E2E_HIDDEN_WINDOW === '1'
        ? { webPreferences: { backgroundThrottling: false } }
        : undefined);
    mainWindow = createdWindow;
    mainWindow.once('ready-to-show', () => {
        // The native E2E harness drives the app through Playwright from a window it
        // never shows, so it must not spawn DevTools on the developer's desktop.
        if (isDev && process.env.FLO_E2E_HIDDEN_WINDOW !== '1') {
            mainWindow?.webContents.openDevTools();
        }
    });
    // Track full navigations to begin new readiness epochs.
    mainWindow.webContents.on('did-start-navigation', (_event, _url, isSameDocument, isMainFrame) => {
        if ((0, window_readiness_1.isFullDocumentMainFrameNavigation)({ isSameDocument, isMainFrame })) {
            (0, window_readiness_1.beginRendererDocument)();
        }
    });
    // Always load from the embedded Express server (serves static Next.js export).
    // This avoids file:// protocol issues and keeps dev/prod behaviour identical.
    mainWindow.loadURL(`http://localhost:${(0, server_1.getServerPort)()}`);
    const mainWindowWillNavigateHandler = (0, window_options_1.createMainWindowWillNavigateHandler)(url_allowlist_1.isAllowedLocalWindowUrl, server_1.getServerPort, server_1.getLocalIP, url_allowlist_1.isSafeExternalUrl, (url) => electron_1.shell.openExternal(url), (msg, ...args) => console.warn(msg, ...args));
    mainWindow.webContents.on('will-navigate', mainWindowWillNavigateHandler);
    // Allow target="_blank" links to open new windows for local URLs (e.g. the KDS page)
    // and blank popup windows (e.g. browser print popups). External URLs are sent to the system browser.
    const localWindowOpenHandler = (0, window_options_1.createLocalWindowOpenHandler)(url_allowlist_1.isAllowedLocalWindowUrl, server_1.getServerPort, server_1.getLocalIP);
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const localWindowResponse = localWindowOpenHandler({ url });
        if (localWindowResponse)
            return localWindowResponse;
        if ((0, url_allowlist_1.isSafeExternalUrl)(url)) {
            electron_1.shell
                .openExternal(url)
                .catch((err) => console.warn('[Flo] Failed to open external URL:', err?.message || err));
        }
        else {
            console.warn('[Flo] Blocked unsafe external URL scheme:', url);
        }
        return { action: 'deny' };
    });
    // Intercept all renderer downloads and show a save dialog instead of
    // auto-saving to Downloads — required for MAS sandbox compliance.
    mainWindow.webContents.session.on('will-download', (_event, item) => {
        item.setSaveDialogOptions({
            defaultPath: path.join(electron_1.app.getPath('documents'), item.getFilename()),
        });
    });
    // Register WebUSB permissions for direct thermal printer connection.
    if (!usbDevicePermissionsRegistered) {
        (0, usb_device_permissions_1.registerUsbDevicePermissions)(mainWindow.webContents.session, `http://localhost:${(0, server_1.getServerPort)()}`);
        usbDevicePermissionsRegistered = true;
    }
    const sendWindowState = () => {
        if (!createdWindow || createdWindow.isDestroyed())
            return;
        try {
            createdWindow.webContents.send('window-state-changed', {
                isMaximized: createdWindow.isMaximized(),
                isFullScreen: createdWindow.isFullScreen(),
            });
        }
        catch {
            // Ignored if webContents destroyed
        }
    };
    createdWindow.on('maximize', sendWindowState);
    createdWindow.on('unmaximize', sendWindowState);
    createdWindow.on('enter-full-screen', sendWindowState);
    createdWindow.on('leave-full-screen', sendWindowState);
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.on('closed', () => {
        if (mainWindow === createdWindow)
            mainWindow = null;
    });
    mainWindow.webContents.once('did-finish-load', () => {
        failedWindowRecovery.markLoadSucceeded();
        lastWindowLoadFailure = null;
        clearRendererStabilityResetTimer();
        rendererStabilityResetTimer = setTimeout(() => {
            rendererStabilityResetTimer = null;
            consecutiveRendererCrashes = 0;
        }, RENDERER_STABILITY_RESET_MS);
    });
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        main_1.default.error('[Window] Renderer process gone:', details.reason);
        console.error('[Window] Renderer process gone:', details.reason);
        if (details.reason !== 'clean-exit') {
            // Crash invalidated stability; cancel reset timer.
            clearRendererStabilityResetTimer();
            if (!isQuitting && !isShutdownRequested()) {
                consecutiveRendererCrashes++;
                cloud_sync_1.cloudSync.captureOperationFailure({
                    capture_point: 'fc.electron.renderer.process_gone',
                    outcome: 'unknown',
                });
            }
            if (consecutiveRendererCrashes >= GPU_FALLBACK_CRASH_THRESHOLD) {
                shouldDisableGpuOnRelaunch = true;
                main_1.default.error('[Window] Repeated renderer crashes — requesting relaunch with hardware acceleration disabled.');
                requestRuntimeRelaunchOnce('renderer-repeated-crash-gpu-fallback');
            }
        }
        if (details.reason !== 'clean-exit' && mainWindow === createdWindow) {
            electron_1.dialog
                .showMessageBox({
                type: 'error',
                title: 'App Crashed',
                message: 'The app crashed and will restart.',
                detail: `Reason: ${details.reason}`,
                buttons: ['OK'],
            })
                .then(() => {
                if (mainWindow !== createdWindow)
                    return;
                failedWindowRecovery.suppressAllClosedQuit(() => {
                    createdWindow.destroy();
                    if (mainWindow === createdWindow)
                        mainWindow = null;
                    void handleMainWindowActivation();
                });
            })
                .catch((error) => {
                main_1.default.error('[Window] Renderer crash recovery failed:', error);
                if (!isQuitting && !isShutdownRequested()) {
                    requestRuntimeRelaunchOnce('renderer-crash-recovery-failed');
                }
            });
        }
    });
    (0, window_load_retry_1.setupWindowLoadRetry)(createdWindow, () => `http://localhost:${(0, server_1.getServerPort)()}`, {
        log: main_1.default,
        onRetryExhausted: ({ errorCode, errorDescription, validatedURL, retries }) => {
            main_1.default.error('[Window] Load retry exhaustion:', errorCode, errorDescription, validatedURL, `retries=${retries}`);
            lastWindowLoadFailure = { errorCode, errorDescription, validatedURL };
            recoverFailedWindow(createdWindow);
        },
    });
    mainWindow.webContents.on('unresponsive', () => {
        console.warn('[Window] Window became unresponsive');
    });
    mainWindow.webContents.on('responsive', () => {
        console.log('[Window] Window became responsive again');
    });
}
async function handleMainWindowActivation() {
    const services = getRuntimeServices();
    const hasWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
    const action = (0, runtime_recovery_1.decideRuntimeActivationAction)({
        state: runtimeState,
        hasWindow,
        services,
        shutdownRequested: isQuitting || isShutdownRequested(),
    });
    main_1.default.info(`[Lifecycle] Activation action=${action} state=${runtimeState}` +
        ` services=${services.main ? 'main' : 'no-main'},${services.kds ? 'kds' : 'no-kds'},${services.serverApp ? 'server-app' : 'no-server-app'}`);
    if (action === 'show') {
        // Confirm backend HTTP listeners are actively responding before showing window.
        const reallyHealthy = await (0, backend_health_1.probeBackendHealth)({
            server: (0, server_1.getServerPort)(),
            kds: (0, kds_server_1.getKdsPort)(),
            serverApp: (0, server_app_1.getServerAppPort)(),
        });
        // Ignore probe results if shutdown or update was initiated while probing.
        if (isQuitting || isShutdownRequested())
            return;
        if (!reallyHealthy) {
            requestRuntimeRelaunchOnce('activation-health-probe-failed');
            return;
        }
        showMainWindow();
        return;
    }
    if (action === 'create') {
        createWindow();
        return;
    }
    if (action === 'wait') {
        if (!initializationPromise) {
            activationPending = true;
            return;
        }
        void initializationPromise.then(() => {
            void handleMainWindowActivation();
        }, (error) => {
            main_1.default.error('[Lifecycle] Startup failed while activation was waiting:', error);
            requestRuntimeRelaunchOnce('activation-startup-failed');
        });
        return;
    }
    if (action === 'ignore')
        return;
    requestRuntimeRelaunchOnce(`activation-runtime-unavailable-${runtimeState}`);
}
// Sleep/wake recovery: nudge window dimensions on resume to force GPU compositor repaint.
function registerPowerMonitorRecovery() {
    electron_1.powerMonitor.on('resume', () => {
        console.log('[Window] System resumed from sleep, forcing repaint');
        (0, whatsapp_1.handleSystemResume)();
        void (0, scheduled_orders_1.triggerScheduledOrderSweep)('resume');
        // Allow display pipeline to wake before nudging.
        setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())
                return;
            const [width, height] = mainWindow.getSize();
            mainWindow.setSize(width + 1, height);
            mainWindow.setSize(width, height);
        }, 1000);
    });
}
// Track child process crashes and trigger GPU fallback relaunch on GPU crash.
function registerChildProcessCrashTelemetry() {
    electron_1.app.on('child-process-gone', (_event, details) => {
        const systemErrorCode = 'systemErrorCode' in details
            ? details.systemErrorCode
            : undefined;
        main_1.default.error('[Process] Child process gone:', details.type, details.reason, details.exitCode, systemErrorCode !== undefined ? `systemErrorCode=${systemErrorCode}` : '');
        console.error('[Process] Child process gone:', details.type, details.reason, details.exitCode, systemErrorCode !== undefined ? `systemErrorCode=${systemErrorCode}` : '');
        // Ignore normal shutdown/clean-exit signals.
        const isGpuFailure = details.type === 'GPU' &&
            details.reason !== 'clean-exit' &&
            !isQuitting &&
            !isShutdownRequested();
        if (isGpuFailure) {
            // Cancel the stability reset timer after a GPU crash.
            clearRendererStabilityResetTimer();
        }
        if (details.reason !== 'clean-exit' && !isQuitting && !isShutdownRequested()) {
            cloud_sync_1.cloudSync.captureOperationFailure({
                capture_point: 'fc.electron.child.process_gone',
                outcome: 'unknown',
            });
        }
        if (isGpuFailure) {
            // Hardware acceleration fallback after GPU process crash.
            shouldDisableGpuOnRelaunch = true;
            main_1.default.error('[Process] GPU process crashed — requesting relaunch with hardware acceleration disabled.');
            requestRuntimeRelaunchOnce('gpu-process-crashed');
        }
    });
}
function createTray() {
    if (process.platform === 'linux') {
        // Linux tray: provides persistent icon to restore or quit the app.
        const linuxIconPath = isDev
            ? path.join(__dirname, '../../assets/icon-512.png')
            : path.join(process.resourcesPath, 'assets/icon-512.png');
        try {
            const linuxIcon = electron_1.nativeImage.createFromPath(linuxIconPath);
            tray = new electron_1.Tray(linuxIcon.resize({ width: 22, height: 22 }));
            const linuxMenu = electron_1.Menu.buildFromTemplate([
                {
                    label: 'Show',
                    click: () => {
                        if (mainWindow) {
                            if (showMainWindow())
                                mainWindow.focus();
                        }
                    },
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    click: () => {
                        isQuitting = true;
                        // On Debian/AppIndicator, quitting while the context menu is open
                        // can cause a deadlock. Defer the teardown so the menu can close.
                        setTimeout(() => {
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.destroy();
                            }
                            // Explicitly destroy tray to release the AppIndicator lock
                            if (tray) {
                                tray.destroy();
                                tray = null;
                            }
                            // Defer quit so context menu can close and drain resources cleanly.
                            electron_1.app.quit();
                        }, 100);
                    },
                },
            ]);
            tray.setToolTip('Flo Cafe');
            tray.setContextMenu(linuxMenu);
            // Single-click also shows the window on Linux (no double-click standard).
            tray.on('click', () => {
                if (mainWindow) {
                    if (showMainWindow())
                        mainWindow.focus();
                }
            });
            console.log('[Tray] Linux tray created');
        }
        catch {
            console.log('[Tray] Linux icon not found, skipping tray');
        }
        return;
    }
    // ── macOS / Windows tray ─────────────────────────────────────────────────
    const iconPath = isDev
        ? path.join(__dirname, '../../assets/icon.png')
        : path.join(process.resourcesPath, 'assets/icon.png');
    try {
        const icon = electron_1.nativeImage.createFromPath(iconPath);
        tray = new electron_1.Tray(icon.resize({ width: 16, height: 16 }));
        const contextMenu = electron_1.Menu.buildFromTemplate([
            {
                label: 'Open Flo',
                click: () => {
                    showMainWindow();
                },
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    isQuitting = true;
                    electron_1.app.quit();
                },
            },
        ]);
        tray.setToolTip('Flo');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => {
            showMainWindow();
        });
    }
    catch {
        console.log('[Tray] Icon not found, skipping tray');
    }
}
function startMdns() {
    try {
        bonjour = new bonjour_service_1.Bonjour();
        bonjour.publish({
            name: 'Flo',
            type: 'http',
            port: (0, server_1.getServerPort)(),
            host: 'flo', // resolves as flo.local on the LAN
            txt: {
                version: electron_1.app.getVersion(),
                kds: `/kds`,
                kds_port: String((0, kds_server_1.getKdsPort)()),
                server_app: '/server-standalone',
                server_app_port: String((0, server_app_1.getServerAppPort)()),
            },
        });
        const ip = (0, server_1.getLocalIP)();
        console.log(`[mDNS] Advertising flo.local:${(0, server_1.getServerPort)()}  (IP fallback: http://${ip}:${(0, server_1.getServerPort)()})`);
        console.log(`[mDNS] KDS available at http://flo.local:${(0, kds_server_1.getKdsPort)()}  (IP fallback: http://${ip}:${(0, kds_server_1.getKdsPort)()})`);
        console.log(`[mDNS] Server App available at http://flo.local:${(0, server_app_1.getServerAppPort)()}  (IP fallback: http://${ip}:${(0, server_app_1.getServerAppPort)()})`);
    }
    catch (err) {
        console.warn('[mDNS] Could not start Bonjour:', err);
    }
}
function stopMdns() {
    // Capture the instance before clearing the global reference. Bonjour invokes
    // this callback later, after unpublishAll has finished.
    const instance = bonjour;
    bonjour = null;
    if (!instance)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            finish(new Error(`Bonjour shutdown timed out after ${shutdown_1.SHUTDOWN_TIMEOUT_MS}ms`));
        }, shutdown_1.SHUTDOWN_TIMEOUT_MS);
        const finish = (unpublishError) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            try {
                instance.destroy();
            }
            catch (destroyError) {
                if (unpublishError) {
                    reject(new AggregateError([unpublishError, destroyError], 'Bonjour shutdown failed'));
                }
                else {
                    reject(destroyError);
                }
                return;
            }
            if (unpublishError)
                reject(unpublishError);
            else
                resolve();
        };
        try {
            instance.unpublishAll(() => finish());
        }
        catch (error) {
            finish(error);
        }
    });
}
function createMenu() {
    const template = [
        ...(process.platform === 'darwin'
            ? [
                {
                    label: electron_1.app.getName(),
                    submenu: [
                        { label: `About ${electron_1.app.getName()}`, click: () => showAbout() },
                        { type: 'separator' },
                        { role: 'services' },
                        { type: 'separator' },
                        { role: 'hide' },
                        { role: 'hideOthers' },
                        { role: 'unhide' },
                        { type: 'separator' },
                        {
                            label: 'Quit',
                            accelerator: 'Cmd+Q',
                            click: () => {
                                isQuitting = true;
                                electron_1.app.quit();
                            },
                        },
                    ],
                },
            ]
            : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Order',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => mainWindow?.webContents.send('new-order'),
                },
                {
                    label: 'Quick Search',
                    accelerator: 'CmdOrCtrl+K',
                    click: () => mainWindow?.webContents.send('quick-search'),
                },
                { type: 'separator' },
                { label: 'Backup Database', click: () => mainWindow?.webContents.send('backup-database') },
                {
                    label: 'Restore Backup',
                    click: () => mainWindow?.webContents.send('menu-restore-from-file'),
                },
                { type: 'separator' },
                {
                    label: 'Database Health Check',
                    click: () => mainWindow?.webContents.send('menu-db-health-check'),
                },
                {
                    label: 'Initialize Database',
                    click: () => mainWindow?.webContents.send('menu-db-initialize'),
                },
                { label: 'Master PIN…', click: () => mainWindow?.webContents.send('menu-master-pin') },
                { type: 'separator' },
                {
                    label: 'Exit',
                    accelerator: process.platform === 'darwin' ? undefined : 'CmdOrCtrl+Q',
                    click: () => {
                        isQuitting = true;
                        electron_1.app.quit();
                    },
                },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'POS',
                    accelerator: 'CmdOrCtrl+1',
                    click: () => mainWindow?.webContents.send('go-pos'),
                },
                {
                    label: 'Dashboard',
                    accelerator: 'CmdOrCtrl+2',
                    click: () => mainWindow?.webContents.send('go-dashboard'),
                },
                {
                    label: 'Orders',
                    accelerator: 'CmdOrCtrl+3',
                    click: () => mainWindow?.webContents.send('go-orders'),
                },
                {
                    label: 'Kitchen Display',
                    accelerator: 'CmdOrCtrl+4',
                    click: () => mainWindow?.webContents.send('go-kds'),
                },
                {
                    label: 'Tables',
                    accelerator: 'CmdOrCtrl+5',
                    click: () => mainWindow?.webContents.send('go-tables'),
                },
                {
                    label: 'Catalog',
                    accelerator: 'CmdOrCtrl+6',
                    click: () => mainWindow?.webContents.send('go-products'),
                },
                {
                    label: 'Inventory',
                    accelerator: 'CmdOrCtrl+7',
                    click: () => mainWindow?.webContents.send('go-inventory'),
                },
                {
                    label: 'Customers',
                    accelerator: 'CmdOrCtrl+8',
                    click: () => mainWindow?.webContents.send('go-customers'),
                },
                {
                    label: 'Staff',
                    accelerator: 'CmdOrCtrl+9',
                    click: () => mainWindow?.webContents.send('go-staff'),
                },
            ],
        },
        {
            label: 'Orders',
            submenu: [
                {
                    label: 'View All Orders',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => mainWindow?.webContents.send('view-orders'),
                },
            ],
        },
        {
            label: 'Reports',
            submenu: [
                { label: 'Daily Summary', click: () => mainWindow?.webContents.send('report-daily') },
                { label: 'Sales Report', click: () => mainWindow?.webContents.send('report-sales') },
                { label: 'X Report', click: () => mainWindow?.webContents.send('report-x') },
                { label: 'Z Report', click: () => mainWindow?.webContents.send('report-z') },
            ],
        },
        {
            label: 'Settings',
            submenu: [
                {
                    label: 'Business Settings',
                    click: () => mainWindow?.webContents.send('settings-business'),
                },
                { label: 'Tax Settings', click: () => mainWindow?.webContents.send('settings-tax') },
                { label: 'Printer Setup', click: () => mainWindow?.webContents.send('settings-printer') },
                {
                    label: 'Kitchen Stations',
                    click: () => mainWindow?.webContents.send('settings-kitchen'),
                },
            ],
        },
        {
            label: 'Window',
            submenu: [
                {
                    label: 'Flo Cafe',
                    click: () => {
                        if (showMainWindow())
                            mainWindow?.focus();
                    },
                },
                { type: 'separator' },
                { role: 'minimize' },
                ...(process.platform === 'darwin'
                    ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
                    : []),
            ],
        },
        {
            label: 'Help',
            submenu: [
                ...(process.platform !== 'darwin'
                    ? [{ label: 'About Flo', click: () => showAbout() }]
                    : []),
                ...(isStoreBuild ? [] : [{ label: 'Check for Updates', click: () => checkForUpdates() }]),
                {
                    label: 'Open Logs Folder',
                    click: () => electron_1.shell.showItemInFolder(main_1.default.transports.file.getFile().path),
                },
            ],
        },
    ];
    if (isDev) {
        template.push({
            label: 'Developer',
            submenu: [
                {
                    label: 'Toggle DevTools',
                    accelerator: 'F12',
                    click: () => mainWindow?.webContents.toggleDevTools(),
                },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => mainWindow?.webContents.reload(),
                },
            ],
        });
    }
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
function showAbout() {
    const ip = (0, server_1.getLocalIP)();
    const kdsPort = (0, kds_server_1.getKdsPort)();
    const serverAppPort = (0, server_app_1.getServerAppPort)();
    electron_1.dialog.showMessageBox({
        type: 'info',
        title: 'About Flo',
        message: 'Flo Cafe',
        detail: [
            `Version: ${electron_1.app.getVersion()}`,
            `Electron: ${process.versions.electron}`,
            `Node: ${process.versions.node}`,
            '',
            'A self-hosted, offline-first Point of Sale system.',
            'Your data stays yours.',
            '',
            `POS URL: http://flo.local:${(0, server_1.getServerPort)()}`,
            `KDS URL: http://flo.local:${kdsPort}`,
            `Server App URL: http://flo.local:${serverAppPort}`,
            '',
            `KDS IP fallback: http://${ip}:${kdsPort}`,
            `Server App IP fallback: http://${ip}:${serverAppPort}`,
        ].join('\n'),
    });
}
async function initialize() {
    while (true) {
        runtimeState = 'starting';
        startupFailure = false;
        main_1.default.info('[Lifecycle] Runtime is starting');
        try {
            if (isShutdownRequested())
                return;
            console.log('[Flo] Initializing...');
            console.log('[Flo] Initializing database...');
            (0, db_1.initDatabase)();
            if (isShutdownRequested())
                return;
            console.log('[Flo] Starting local server...');
            await (0, server_1.startServer)();
            if (isShutdownRequested())
                return;
            cloud_sync_1.cloudSync.start();
            telemetry_1.telemetry.start();
            (0, posthog_1.startPostHog)();
            google_drive_1.googleDrive.start();
            local_backup_1.localBackup.start();
            console.log('[Flo] Starting KDS server on port 3002...');
            await (0, kds_server_1.startKdsServer)();
            if (isShutdownRequested())
                return;
            console.log('[Flo] Starting Server App on port 3003...');
            await (0, server_app_1.startServerApp)();
            if (isShutdownRequested())
                return;
            // Native E2E owns an offline fixture; optional LAN discovery must not
            // contend with a developer session or keep the test process alive.
            if (process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK !== '1') {
                console.log('[Flo] Starting mDNS advertisement...');
                startMdns();
            }
            console.log('[Flo] Initializing printer...');
            await (0, thermal_1.initPrinter)();
            if (isShutdownRequested())
                return;
            console.log('[Flo] Registering IPC handlers...');
            (0, ipc_1.registerIpcHandlers)(shutdownSignal, () => mainWindow, showMainWindow, () => currentEffectiveIsDark);
            (0, update_ipc_1.registerDirectUpdateIpcHandlers)({
                ipcMain: electron_1.ipcMain,
                getMainWindow: () => mainWindow,
                getServerPort: server_1.getServerPort,
                getStoredUpdateStatus: () => storedUpdateStatus,
                getStagedUpdateReady: () => stagedUpdateReady,
                getUpdaterPhase: () => updaterPhase,
                getAppVersion: () => electron_1.app.getVersion(),
                checkForUpdates,
                downloadUpdate: () => downloadUpdate(),
                readAutoUpdateCheckEnabled,
                writeAutoUpdateCheckEnabled,
                readBetaChannelEnabled,
                writeBetaChannelEnabled,
                enqueueBetaChannelTransition,
                configureAutoUpdaterChannel,
                setUpdateStatus,
                restartAndInstallHandler: (0, updater_shutdown_1.createRestartAndInstallHandler)({
                    isInstallReady: () => (0, update_state_1.isInstallReady)(storedUpdateStatus, stagedUpdateReady),
                    authorize: (pin) => (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:restart-and-install'),
                    runCleanup,
                    quitAndInstall: (isSilent, isForceRunAfter) => electron_updater_1.autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
                    updateState: updateShutdownState,
                    onInstallFailure: () => requestRuntimeRelaunchOnce('update-install-failed'),
                    warn: (message) => main_1.default.warn(message),
                    error: (message, error) => main_1.default.error(message, error),
                }),
                isServerRunning: server_1.isServerRunning,
                isKdsServerRunning: kds_server_1.isKdsServerRunning,
                isServerAppRunning: server_app_1.isServerAppRunning,
                getResolvedTitleBarMode: () => resolvedTitleBarMode,
                getRendererReadinessEpoch: window_readiness_1.getRendererReadinessEpoch,
                getRendererDocumentNonce: window_readiness_1.getRendererDocumentNonce,
                getCurrentEffectiveIsDark: () => currentEffectiveIsDark,
                setCurrentEffectiveIsDark: (isDark) => {
                    currentEffectiveIsDark = isDark;
                },
                applyTitleBarOverlayTheme: title_bar_theme_1.applyTitleBarOverlayTheme,
                resolveTitleBarOverlayColors: title_bar_theme_1.resolveTitleBarOverlayColors,
                withDatabaseRequest: db_1.withDatabaseRequest,
                log: main_1.default,
            });
            runtimeState = 'ready';
            relaunchAttemptGuard.markRuntimeRecovered();
            main_1.default.info('[Lifecycle] Runtime is ready');
            console.log('[Flo] Creating window...');
            createWindow();
            registerPowerMonitorRecovery();
            registerChildProcessCrashTelemetry();
            createTray();
            createMenu();
            // Auto-updater configured on non-store platforms.
            if (!isStoreBuild) {
                if (process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK !== '1') {
                    setupAutoUpdater();
                    if (readAutoUpdateCheckEnabled()) {
                        setTimeout(() => checkForUpdates(), 5000);
                    }
                    else {
                        main_1.default.info('[Update] Automatic update check disabled; waiting for a manual check');
                    }
                }
            }
            else {
                // Store builds skip auto-updater and report store-managed status.
                setUpdateStatus((0, update_state_1.oneShotUpdateState)('store-managed'));
            }
            if (process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK !== '1') {
                setTimeout(() => {
                    void checkTaxPackUpdatesOnStartup();
                }, 5000);
            }
            console.log('[Flo] Ready!');
            return;
        }
        catch (error) {
            let fatalStartupError = error;
            if ((0, db_1.isSchemaVersionMismatchError)(error)) {
                try {
                    main_1.default.warn('[Lifecycle] Newer database schema detected during startup:', error);
                    (0, db_1.closeDatabase)();
                    if (isShutdownRequested()) {
                        try {
                            await runCleanup();
                        }
                        catch (cleanupError) {
                            console.error('[Flo] Cleanup after interrupted initialization failed:', cleanupError);
                        }
                        return;
                    }
                    const recoveryOutcome = await (0, downgrade_recovery_1.runDowngradeRecoveryFlow)(error, {
                        appVersion: electron_1.app.getVersion(),
                        dialog: electron_1.dialog,
                        shell: electron_1.shell,
                        log: main_1.default,
                        isShutdownRequested,
                        discoverBackups: () => (0, db_1.discoverDowngradeBackupsAsync)({ signal: shutdownSignal }),
                        planPreservedArchivePath: db_1.planNewerDatabaseArchivePath,
                        restoreBackup: (backupPath, options) => (0, db_1.restoreCompatibleBackupForDowngrade)(backupPath, {
                            ...options,
                            signal: options?.signal
                                ? AbortSignal.any([shutdownSignal, options.signal])
                                : shutdownSignal,
                        }),
                        getBackupDir: db_1.getBackupDir,
                        getDbPath: db_1.getDbPath,
                    });
                    if (recoveryOutcome.outcome === 'restored' && !isShutdownRequested()) {
                        main_1.default.info(`[Lifecycle] Compatible backup restored (${recoveryOutcome.result.restoredBackupPath}); continuing startup`);
                        continue;
                    }
                    if (isShutdownRequested()) {
                        try {
                            await runCleanup();
                        }
                        catch (cleanupError) {
                            console.error('[Flo] Cleanup after interrupted initialization failed:', cleanupError);
                        }
                        return;
                    }
                    isQuitting = true;
                    runtimeState = 'stopping';
                    try {
                        await runCleanup();
                    }
                    catch (cleanupError) {
                        console.error('[Flo] Cleanup after newer-database recovery exit failed:', cleanupError);
                    }
                    electron_1.app.exit(0);
                    return;
                }
                catch (recoveryFlowError) {
                    fatalStartupError = recoveryFlowError;
                }
            }
            runtimeState = 'failed';
            main_1.default.error('[Lifecycle] Runtime initialization failed:', fatalStartupError);
            console.error('[Flo] Initialization error:', fatalStartupError);
            const errorDetails = fatalStartupError;
            const expectedShutdownCancellation = errorDetails?.code === 'ERR_SHUTDOWN_ABORTED' ||
                errorDetails?.code === 'ABORT_ERR' ||
                errorDetails?.name === 'AbortError';
            if (!expectedShutdownCancellation)
                startupFailure = true;
            if (isShutdownRequested()) {
                try {
                    await runCleanup();
                }
                catch (cleanupError) {
                    console.error('[Flo] Cleanup after interrupted initialization failed:', cleanupError);
                }
                return;
            }
            try {
                electron_1.dialog.showErrorBox('Initialization Error', `Failed to start Flo: ${fatalStartupError}`);
            }
            catch (dialogError) {
                console.error('[Flo] Failed to display initialization error dialog:', dialogError);
            }
            // Capture only a safe classification; exception text can contain business data.
            try {
                cloud_sync_1.cloudSync.captureOperationFailure({
                    capture_point: 'fc.electron.startup.failure',
                    outcome: 'not_applied',
                });
            }
            catch (diagnosticError) {
                console.error('[Flo] Failed to capture startup failure:', diagnosticError);
            }
            isQuitting = true;
            try {
                await runCleanup();
            }
            catch (cleanupError) {
                console.error('[Flo] Cleanup after initialization failure failed:', cleanupError);
            }
            // Cleanup has settled (or reported its bounded failure) before exiting.
            electron_1.app.exit(1);
            return;
        }
        finally {
            if (isShutdownRequested() && runtimeState === 'starting')
                runtimeState = 'stopping';
        }
    }
}
electron_1.app.whenReady().then(() => {
    initializationPromise = initialize();
    void initializationPromise.then(() => {
        if (!activationPending)
            return;
        activationPending = false;
        void handleMainWindowActivation();
    }, (error) => {
        main_1.default.error('[Lifecycle] Unhandled startup error:', error);
        if (activationPending) {
            activationPending = false;
            if (!isQuitting && !isShutdownRequested()) {
                requestRuntimeRelaunchOnce('activation-startup-failed');
                return;
            }
        }
        if (!isQuitting && !isShutdownRequested()) {
            isQuitting = true;
            runtimeState = 'failed';
            void runCleanup()
                .catch((cleanupError) => {
                console.error('[Flo] Cleanup after unhandled startup error failed:', cleanupError);
            })
                .finally(() => {
                electron_1.app.exit(1);
            });
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if ((0, window_recovery_1.shouldQuitOnAllWindowsClosed)(process.platform, failedWindowRecovery.isReplacingWindow())) {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    void handleMainWindowActivation();
});
if (process.env.NODE_ENV === 'test' && process.env.FLO_E2E_PID_FILE) {
    try {
        fs.writeFileSync(process.env.FLO_E2E_PID_FILE, String(process.pid));
    }
    catch (error) {
        main_1.default.error('[Native E2E] Could not write Electron PID:', error);
    }
}
// --- Cleanup function (idempotent — safe to call from every entrypoint) ---
const cleanupCoordinator = (0, shutdown_1.createShutdownCoordinator)(() => [
    {
        name: 'tray',
        run: () => {
            const currentTray = tray;
            tray = null;
            if (currentTray)
                currentTray.destroy();
        },
    },
    { name: 'raster surface', run: () => (0, raster_renderer_1.destroySharedRasterRenderer)() },
    // Drain Server App before shutting down main API.
    { name: 'Server App', run: () => (0, server_app_1.stopServerApp)(), blocksDatabase: true },
    { name: 'Main server', run: () => (0, server_1.stopServer)(), blocksDatabase: true },
    { name: 'KDS server', run: () => (0, kds_server_1.stopKdsServer)(), blocksDatabase: true },
    { name: 'cloud sync', run: () => cloud_sync_1.cloudSync.shutdown(), blocksDatabase: true },
    { name: 'telemetry', run: () => telemetry_1.telemetry.stop(), blocksDatabase: true },
    { name: 'posthog', run: () => (0, posthog_1.stopPostHog)(), blocksDatabase: true },
    { name: 'Google Drive', run: () => google_drive_1.googleDrive.stop(), blocksDatabase: true },
    { name: 'local backup', run: () => local_backup_1.localBackup.stop(), blocksDatabase: true },
    { name: 'WhatsApp', run: () => (0, whatsapp_1.shutdown)(), blocksDatabase: true },
    { name: 'Bonjour', run: () => stopMdns() },
    { name: 'HTTP handler cleanup', run: () => (0, shutdown_1.waitForHttpShutdownWork)(), blocksDatabase: true },
    { name: 'database admission', run: () => (0, db_1.beginDatabaseShutdown)(), blocksDatabase: true },
    { name: 'database requests', run: () => (0, db_1.waitForDatabaseRequests)(), blocksDatabase: true },
    // Close database after all in-flight handlers have finished.
    { name: 'database', run: () => (0, db_1.closeDatabase)(), databaseClose: true },
], {
    onFatalTimeout: () => {
        // Avoid exit(1) on timeout during update installation so updater can hand off.
        if (!isInstallingUpdate && !runtimeRelaunchRequested) {
            electron_1.app.exit(1);
        }
    },
});
const { runCleanup, isShutdownRequested, shutdownSignal } = (0, shutdown_1.createShutdownEntrypoints)({
    app: electron_1.app,
    process: process,
    cleanup: async () => {
        main_1.default.info('[Lifecycle] Cleanup started');
        console.log('[Flo] Running cleanup...');
        try {
            await cleanupCoordinator();
            main_1.default.info('[Lifecycle] Cleanup completed');
            console.log('[Flo] Goodbye!');
        }
        catch (error) {
            main_1.default.error('[Lifecycle] Cleanup failed:', error);
            console.error('[Flo] Cleanup failed:', error);
            throw error;
        }
    },
    setQuitting: () => {
        isQuitting = true;
        runtimeState = 'stopping';
    },
    onShutdownRequested: whatsapp_1.requestShutdown,
    destroyWindow: () => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.destroy();
    },
    isInstallingUpdate: () => isInstallingUpdate,
    reportFailure: (context, error) => {
        console.error(`[Flo] Cleanup failed before ${context}:`, error);
    },
    getSignalExitCode: () => (startupFailure ? 1 : 0),
    getQuitExitCode: () => (startupFailure ? 1 : 0),
});
process.on('uncaughtException', (error) => {
    main_1.default.error('[Flo] Uncaught exception:', error);
    console.error('[Flo] Uncaught exception:', error);
    if (!isQuitting && !isShutdownRequested()) {
        cloud_sync_1.cloudSync.captureOperationFailure({
            capture_point: 'fc.electron.main.uncaught',
            outcome: 'unknown',
        });
        (0, posthog_1.capturePostHogException)('uncaughtException', error);
    }
});
process.on('unhandledRejection', (reason) => {
    main_1.default.error('[Flo] Unhandled rejection:', reason);
    console.error('[Flo] Unhandled rejection:', reason);
    if (!isQuitting && !isShutdownRequested()) {
        cloud_sync_1.cloudSync.captureOperationFailure({
            capture_point: 'fc.electron.main.unhandled_rejection',
            outcome: 'unknown',
        });
        (0, posthog_1.capturePostHogException)('unhandledRejection', reason);
    }
});
//# sourceMappingURL=index.js.map