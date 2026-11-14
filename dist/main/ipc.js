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
exports.isTrustedLoopbackUrl = isTrustedLoopbackUrl;
exports.isTrustedSender = isTrustedSender;
exports.isTrustedMainWindowSender = isTrustedMainWindowSender;
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const db_1 = require("./db");
const security_1 = require("./middleware/security");
const server_1 = require("./server");
const server_state_1 = require("./server-state");
const jwt_secret_1 = require("./security/jwt-secret");
const kds_server_1 = require("./kds-server");
const master_pin_1 = require("./services/master-pin");
const restore_file_selection_1 = require("./services/restore-file-selection");
const schema_health_1 = require("./services/schema-health");
const whatsapp_1 = require("./services/whatsapp");
const window_options_1 = require("./window-options");
const application_menu_1 = require("./application-menu");
const window_readiness_1 = require("./window-readiness");
const title_bar_theme_1 = require("./title-bar-theme");
const settings_1 = require("./routes/settings");
const google_drive_1 = require("./services/google-drive");
const thermal_1 = require("./printers/thermal");
const document_1 = require("../shared/print/document");
const url_allowlist_1 = require("./security/url-allowlist");
const main_1 = __importDefault(require("electron-log/main"));
const crypto_1 = require("crypto");
const cloud_sync_1 = require("./services/cloud-sync");
const local_backup_1 = require("./services/local-backup");
const posthog_1 = require("./services/posthog");
const html_to_pdf_1 = require("./services/html-to-pdf");
// Cap on the log content attached to a support ticket (most recent bytes only).
const LOG_TAIL_MAX_BYTES = 200_000;
// Prefer excluding log lines older than this from a support-ticket attachment.
const LOG_TAIL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Matches electron-log's default line prefix, e.g. "[2026-09-13 10:15:30.123] [info] ...".
const LOG_LINE_TIMESTAMP_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;
// Settings keys the renderer may write without a permission check.
// Everything else (currency, country, tax_scheme, business profile, ...) is
// permission-gated on the HTTP API and must stay there.
const ALLOWED_IPC_KEYS = new Set(['theme_mode', 'orders_layout']);
const SENSITIVE_SETTING_KEYS = new Set([
    'jwt_secret',
    'cloud_api_key',
    'cloud_device_secret',
    'cloud_deletion_status_token',
    'cloud_last_error',
]);
function maskSetting(key, value) {
    if (key === 'cloud_last_error')
        return value ? 'Cloud service request failed' : '';
    if (!SENSITIVE_SETTING_KEYS.has(key))
        return value;
    return value ? `****${value.slice(-4)}` : '';
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
const MIN_RASTER_COLUMNS = 32;
const MAX_RASTER_COLUMNS = 48;
function isValidRasterColumns(value) {
    return (typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= MIN_RASTER_COLUMNS &&
        value <= MAX_RASTER_COLUMNS);
}
const TRUSTED_LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Verifies that a URL has http: scheme, no credentials, loopback host, and matches the configured port. */
function isTrustedLoopbackUrl(rawUrl, port) {
    if (typeof port !== 'number' || !Number.isSafeInteger(port) || port <= 0) {
        return false;
    }
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' || parsed.username || parsed.password) {
            return false;
        }
        const parsedPort = parsed.port ? Number(parsed.port) : 80;
        if (parsedPort !== port) {
            return false;
        }
        return TRUSTED_LOOPBACK_HOSTNAMES.has(parsed.hostname);
    }
    catch {
        return false;
    }
}
/** Verifies that IPC sender origin is the localhost-served POS renderer. */
function isTrustedSender(event) {
    try {
        const url = new URL(event.sender?.getURL?.() ?? '');
        if (url.protocol !== 'http:' || url.username || url.password)
            return false;
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    }
    catch {
        return false;
    }
}
let activeMainWindowGetter;
/** Verifies that IPC sender is the active main BrowserWindow, current top-level frame, and exact local app origin. */
function isTrustedMainWindowSender(event, mainWindowOrGetter = activeMainWindowGetter, port = (0, server_state_1.getServerPort)(), browserWindowClass = electron_1.BrowserWindow) {
    if (typeof port !== 'number' || !Number.isSafeInteger(port) || port <= 0) {
        return false;
    }
    const mainWindow = typeof mainWindowOrGetter === 'function' ? mainWindowOrGetter() : mainWindowOrGetter;
    if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
    }
    if (!event || !event.sender) {
        return false;
    }
    let senderWindow = null;
    try {
        senderWindow = browserWindowClass.fromWebContents(event.sender);
    }
    catch {
        return false;
    }
    if (!senderWindow || senderWindow !== mainWindow) {
        return false;
    }
    let currentFrame = null;
    try {
        currentFrame = event.sender.mainFrame;
    }
    catch {
        return false;
    }
    if (!(0, window_readiness_1.isCurrentRendererFrame)(event.senderFrame, currentFrame)) {
        return false;
    }
    const senderUrl = event.sender?.getURL?.() ?? '';
    if (!isTrustedLoopbackUrl(senderUrl, port)) {
        return false;
    }
    const frameUrl = event.senderFrame?.url;
    if (typeof frameUrl === 'string' && !isTrustedLoopbackUrl(frameUrl, port)) {
        return false;
    }
    return true;
}
/** Preload origin check before Chromium has committed localhost URL. */
function isEarlyMainWindowSender(event, getMainWindow) {
    if (!getMainWindow)
        return false;
    try {
        const url = event.sender?.getURL?.() ?? '';
        if (url !== '' && url !== 'about:blank')
            return false;
        const expectedWindow = getMainWindow();
        return Boolean(expectedWindow &&
            !expectedWindow.isDestroyed() &&
            electron_1.BrowserWindow.fromWebContents(event.sender) === expectedWindow);
    }
    catch {
        return false;
    }
}
function handle(channel, listener) {
    electron_1.ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedMainWindowSender(event))
            return { error: 'Unauthorized sender' };
        return listener(event, ...args);
    });
}
function registerIpcHandlers(shutdownSignal, getMainWindow, showMainWindow = () => false, getCurrentEffectiveIsDark) {
    activeMainWindowGetter = getMainWindow;
    electron_1.ipcMain.on('window-document', (event, documentNonce) => {
        let currentFrame = null;
        try {
            currentFrame = event.sender.mainFrame;
        }
        catch {
            event.returnValue = { success: false, error: 'Invalid document registration' };
            return;
        }
        if (!(0, window_readiness_1.isCurrentRendererFrame)(event.senderFrame, currentFrame)) {
            event.returnValue = { success: false, error: 'Invalid document registration' };
            return;
        }
        if (!isTrustedSender(event) && !isEarlyMainWindowSender(event, getMainWindow)) {
            event.returnValue = { error: 'Unauthorized sender' };
            return;
        }
        event.returnValue = (0, window_readiness_1.registerRendererDocument)(documentNonce)
            ? { success: true }
            : { success: false, error: 'Invalid document nonce' };
    });
    // Opens the native picker for "Restore from a file...". It only chooses a
    // path; the restore itself is authorised over HTTP by the session that holds
    // database.manage, so this handler performs no destructive step and is not
    // Master-PIN gated. The picked path is bound to a single-use token.
    handle('pick-restore-file', async () => {
        const result = await electron_1.dialog.showOpenDialog({
            filters: [{ name: 'SQLite Database', extensions: ['db'] }],
            properties: ['openFile'],
        });
        if (result.canceled || !result.filePaths.length)
            return { canceled: true };
        const selection = (0, restore_file_selection_1.rememberRestoreFileSelection)(result.filePaths[0]);
        return { canceled: false, path: selection.path, token: selection.token };
    });
    // Database backup/restore
    handle('backup-database', async (event, pin) => {
        const auth = (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:backup');
        if (!auth.ok)
            return { success: false, error: auth.error };
        try {
            console.log('[IPC] backup-database: Starting...');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const result = await electron_1.dialog.showSaveDialog({
                defaultPath: path.join(electron_1.app.getPath('documents'), `flo-backup-${timestamp}.db`),
                filters: [{ name: 'SQLite Database', extensions: ['db'] }],
            });
            if (result.canceled || !result.filePath) {
                return { success: false, error: 'Cancelled' };
            }
            const { path: backupPath, schemaVersion } = await (0, db_1.createBackup)(result.filePath, shutdownSignal);
            console.log('[IPC] backup-database: Complete:', backupPath);
            return {
                success: true,
                path: backupPath,
                schemaVersion,
                message: `Backup saved (Schema v${schemaVersion})`,
            };
        }
        catch (error) {
            console.error('[IPC] backup-database: Error:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
    handle('restore-backup', async (event, pin, presetBackupPath) => {
        (0, restore_file_selection_1.clearRestoreFileSelection)();
        const auth = (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:restore');
        if (!auth.ok)
            return { success: false, error: auth.error };
        try {
            // A specific backup (e.g. picked from the Backup History list, #120)
            // skips the native file picker entirely.
            let backupPath = presetBackupPath;
            if (!backupPath) {
                const result = await electron_1.dialog.showOpenDialog({
                    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                    properties: ['openFile'],
                });
                if (result.canceled || !result.filePaths.length) {
                    return { success: false, error: 'Cancelled' };
                }
                backupPath = result.filePaths[0];
            }
            else if (!fs.existsSync(backupPath)) {
                return { success: false, error: 'Backup file no longer exists' };
            }
            else if (!(0, db_1.isManagedBackupFile)(backupPath)) {
                return { success: false, error: 'Restore source must be a Flo-managed backup file' };
            }
            const backupVersion = (0, db_1.getSchemaVersionFromBackup)(backupPath);
            if (backupVersion === null) {
                return {
                    success: false,
                    error: 'Invalid backup file: missing schema version metadata. This backup may have been created with an older version of FloDesktop.',
                };
            }
            const versionMismatch = backupVersion !== (0, db_1.getCurrentSchemaVersion)();
            if (versionMismatch) {
                const confirmResult = await electron_1.dialog.showMessageBox({
                    type: 'warning',
                    buttons: ['Restore Anyway', 'Cancel'],
                    defaultId: 1,
                    title: 'Schema Version Mismatch',
                    message: `Backup was created with Schema v${backupVersion}`,
                    detail: `Current database uses Schema v${(0, db_1.getCurrentSchemaVersion)()}.\n\nRestoring will import data only (common fields) to preserve new database structure.\n\nDo you want to continue?`,
                });
                if (confirmResult.response !== 0) {
                    return { success: false, error: 'Cancelled' };
                }
            }
            await google_drive_1.googleDrive.prepareForDatabaseRestore();
            try {
                if (versionMismatch) {
                    const restoreResult = await (0, db_1.withDatabaseMaintenanceLock)((signal) => (0, db_1.restoreBackup)(backupPath, false, signal), shutdownSignal);
                    const cleanup = restoreResult.success ? google_drive_1.googleDrive.completeDatabaseRestore() : null;
                    (0, security_1.clearUserAuthCache)();
                    (0, security_1.clearInMemoryRevokedTokens)();
                    (0, jwt_secret_1.clearJWTSecretCache)();
                    const cleanupPending = restoreResult.cleanupPending === true || cleanup?.cleanupPending === true;
                    return {
                        success: restoreResult.success,
                        mode: restoreResult.mode,
                        backupVersion,
                        currentVersion: (0, db_1.getCurrentSchemaVersion)(),
                        tablesRestored: restoreResult.tablesRestored,
                        message: restoreResult.success
                            ? `Restored ${restoreResult.tablesRestored} tables (data-only mode due to version mismatch)`
                            : `Restore failed: ${restoreResult.error}`,
                        error: restoreResult.error,
                        cleanupPending,
                    };
                }
                const restoreResult = await (0, db_1.withDatabaseMaintenanceLock)((signal) => (0, db_1.restoreBackup)(backupPath, true, signal), shutdownSignal);
                const cleanup = restoreResult.success ? google_drive_1.googleDrive.completeDatabaseRestore() : null;
                (0, security_1.clearUserAuthCache)();
                (0, security_1.clearInMemoryRevokedTokens)();
                (0, jwt_secret_1.clearJWTSecretCache)();
                const cleanupPending = restoreResult.cleanupPending === true || cleanup?.cleanupPending === true;
                return {
                    success: restoreResult.success,
                    mode: restoreResult.mode,
                    backupVersion,
                    currentVersion: (0, db_1.getCurrentSchemaVersion)(),
                    tablesRestored: restoreResult.tablesRestored,
                    message: restoreResult.success
                        ? 'Database restored successfully'
                        : `Restore failed: ${restoreResult.error}`,
                    error: restoreResult.error,
                    cleanupPending,
                };
            }
            finally {
                google_drive_1.googleDrive.releaseDatabaseRestore();
            }
        }
        catch (error) {
            console.error('[IPC] restore-backup: Error:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
    // DB health check / master PIN / initialize (menu + tray triggered)
    handle('db-health-check', async () => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                return (0, schema_health_1.runHealthCheck)();
            }
            catch (error) {
                return { error: getErrorMessage(error) };
            }
        });
    });
    handle('db-apply-safe-fixes', async (event, pin, findingIds) => {
        const auth = (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:apply-safe-fixes');
        if (!auth.ok)
            return { success: false, error: auth.error };
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                return (0, schema_health_1.applySafeFixes)(findingIds);
            }
            catch (error) {
                return { applied: [], skipped: [], errors: [{ id: 'all', error: getErrorMessage(error) }] };
            }
        });
    });
    handle('master-pin-status', async () => {
        return { available: (0, master_pin_1.isMasterPinAvailable)(), isSet: (0, master_pin_1.isMasterPinSet)() };
    });
    handle('db-initialize', async (event, { pin, confirmationPhrase }) => {
        const auth = (0, master_pin_1.authorizeMasterPin)(pin, 'ipc:initialize');
        if (!auth.ok)
            return { success: false, error: auth.error };
        if (confirmationPhrase !== 'INITIALIZE') {
            return { success: false, error: 'Confirmation phrase does not match' };
        }
        let restorePrepared = false;
        try {
            // The owner's typed INITIALIZE may discard a Drive restore boundary that can
            // never resolve on its own; the reset invalidates Drive state either way.
            await google_drive_1.googleDrive.prepareForDatabaseRestore({ discardUnresolvedBoundary: true });
            restorePrepared = true;
            const keepLocalBackup = (0, local_backup_1.isLocalBackupEnabled)();
            const { backupPath } = await (0, db_1.resetDatabaseWithBackup)(shutdownSignal);
            let localBackupFailed = false;
            if (keepLocalBackup) {
                localBackupFailed = (0, local_backup_1.retainBackupLocally)(backupPath) === null;
            }
            else {
                (0, local_backup_1.setLocalBackupEnabled)(false);
            }
            const cleanup = google_drive_1.googleDrive.completeDatabaseRestore();
            (0, security_1.clearUserAuthCache)();
            (0, security_1.clearInMemoryRevokedTokens)();
            (0, jwt_secret_1.clearJWTSecretCache)();
            return {
                success: true,
                backupPath,
                cleanupPending: cleanup.cleanupPending,
                localBackupFailed,
            };
        }
        catch (error) {
            console.error('[IPC] db-initialize: Error:', error);
            return { success: false, error: getErrorMessage(error) };
        }
        finally {
            if (restorePrepared)
                google_drive_1.googleDrive.releaseDatabaseRestore();
        }
    });
    // Window-control surface for renderer title bar HTML fallback controls.
    handle('window-action', (event, action) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed())
            return { error: 'Window unavailable' };
        return (0, window_options_1.applyWindowControlAction)(win, action);
    });
    // Application menu for the frameless Windows/Linux title bar. Electron does
    // not draw a menu bar on a frameless window, so the renderer renders the
    // top-level labels and main pops the matching submenu from the same Menu
    // object createMenu() already applied (accelerators keep working). macOS
    // keeps its authoritative native menu bar and has no title-bar menu.
    handle('get-application-menu', () => {
        if (process.platform === 'darwin')
            return { entries: [] };
        const menu = electron_1.Menu.getApplicationMenu() ?? null;
        return { entries: menu ? (0, application_menu_1.listApplicationMenuEntries)(menu.items) : [] };
    });
    handle('open-application-menu', (event, key, x, y) => {
        if (process.platform === 'darwin')
            return { error: 'Application menu is native on macOS' };
        // Bind the popup to the main window's own current renderer frame.
        let currentFrame = null;
        try {
            currentFrame = event.sender.mainFrame;
        }
        catch {
            return { error: 'Unauthorized sender' };
        }
        const mainWindow = getMainWindow?.() ?? null;
        if (!(0, application_menu_1.isApplicationMenuSender)(mainWindow, {
            window: electron_1.BrowserWindow.fromWebContents(event.sender),
            currentFrame,
            senderFrame: event.senderFrame,
        })) {
            return { error: 'Unauthorized sender' };
        }
        return (0, application_menu_1.openApplicationMenuSubmenu)(electron_1.Menu.getApplicationMenu() ?? null, key, mainWindow, x, y);
    });
    handle('get-window-state', (event) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed())
            return { isMaximized: false, isFullScreen: false };
        return {
            isMaximized: win.isMaximized(),
            isFullScreen: win.isFullScreen(),
        };
    });
    handle('window-ready', (event, payload) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed())
            return { error: 'Window unavailable' };
        let currentFrame = null;
        try {
            currentFrame = event.sender.mainFrame;
        }
        catch {
            return { success: false, error: 'Stale or invalid readiness report' };
        }
        if (!(0, window_readiness_1.isCurrentRendererFrame)(event.senderFrame, currentFrame)) {
            return { success: false, error: 'Stale or invalid readiness report' };
        }
        // Verify readiness report epoch/nonce before showing window.
        const reported = payload;
        if (!(0, window_readiness_1.markWindowRendererReady)(reported?.epoch, reported?.documentNonce)) {
            return { success: false, error: 'Stale or invalid readiness report' };
        }
        showMainWindow(win);
        return { success: true };
    });
    // Settings
    handle('get-settings', async () => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                const db = (0, db_1.getDatabase)();
                const rows = db.prepare('SELECT key, value FROM settings').all();
                const settings = {};
                rows.forEach((row) => {
                    settings[row.key] = maskSetting(row.key, row.value);
                });
                return settings;
            }
            catch (error) {
                return { error: getErrorMessage(error) };
            }
        });
    });
    handle('set-setting', async (event, key, value) => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                if (typeof key !== 'string' || typeof value !== 'string' || value.length > 10_000) {
                    return { success: false, error: 'Invalid setting value' };
                }
                if (!ALLOWED_IPC_KEYS.has(key)) {
                    return { success: false, error: 'Setting not allowed via IPC' };
                }
                if (key === 'theme_mode' && !(0, title_bar_theme_1.isThemeMode)(value)) {
                    return { success: false, error: 'Invalid theme_mode value' };
                }
                if (key === 'orders_layout' && !(0, settings_1.isOrdersLayout)(value)) {
                    return { success: false, error: 'orders_layout must be "split" or "cards"' };
                }
                const db = (0, db_1.getDatabase)();
                db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, (0, db_1.now)());
                return { success: true };
            }
            catch (error) {
                return { success: false, error: getErrorMessage(error) };
            }
        });
    });
    // WhatsApp status snapshot for renderer polling on app focus
    handle('whatsapp-get-status', async () => (0, db_1.withDatabaseRequest)(async () => {
        try {
            return (0, whatsapp_1.getStatus)();
        }
        catch (err) {
            return { error: getErrorMessage(err) };
        }
    }));
    handle('whatsapp-open-share', async (_event, rawUrl) => {
        if (typeof rawUrl !== 'string' || !(0, url_allowlist_1.isSafeWhatsAppShareUrl)(rawUrl)) {
            return { success: false, error: 'Invalid WhatsApp share URL' };
        }
        try {
            await electron_1.shell.openExternal(rawUrl);
            return { success: true };
        }
        catch (error) {
            console.error('[IPC] WhatsApp share open failed:', (0, whatsapp_1.sanitizeLogText)(error));
            return { success: false, error: 'Failed to open WhatsApp' };
        }
    });
    // Module-level reference to ensure single instance
    let activeKdsWindow = null;
    // KDS info
    handle('get-kds-info', async () => {
        const localIP = (0, server_1.getLocalIP)();
        const port = (0, kds_server_1.getKdsPort)();
        return {
            url: `http://${localIP}:${port}/kds`,
            wsUrl: `ws://${localIP}:${port}/kds`,
            localIP,
            port,
        };
    });
    // Window management
    handle('open-kds-window', async () => {
        if (activeKdsWindow && !activeKdsWindow.isDestroyed()) {
            activeKdsWindow.focus();
            return;
        }
        const port = (0, kds_server_1.getKdsPort)();
        const localIP = (0, server_1.getLocalIP)();
        const kdsOrigin = `http://${localIP}:${port}`;
        activeKdsWindow = (0, window_options_1.createKdsWindow)(electron_1.BrowserWindow);
        activeKdsWindow.on('closed', () => {
            activeKdsWindow = null;
        });
        // Confine KDS window to its own origin and deny external navigation/windows.
        activeKdsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        activeKdsWindow.webContents.on('will-navigate', (event, url) => {
            let allowed = false;
            try {
                allowed = new URL(url).origin === kdsOrigin;
            }
            catch {
                allowed = false;
            }
            if (!allowed)
                event.preventDefault();
        });
        // KDS window has no preload; learns palette from URL param.
        const kdsUrl = (0, title_bar_theme_1.appendThemeQueryParam)(`${kdsOrigin}/kds`, getCurrentEffectiveIsDark ? getCurrentEffectiveIsDark() : false);
        activeKdsWindow.loadURL(kdsUrl);
    });
    handle('get-app-info', async () => {
        return {
            version: electron_1.app.getVersion(),
            name: electron_1.app.getName(),
            electron: process.versions.electron,
            node: process.versions.node,
            platform: process.platform,
        };
    });
    // Tail of the current session's log file, for attaching to support tickets.
    handle('get-log-tail', async () => {
        try {
            // electron-log rotates main.log at ~1MB, so reading it whole is cheap.
            const logFilePath = main_1.default.transports.file.getFile().path;
            const content = fs.readFileSync(logFilePath, 'utf8');
            const lines = content.split('\n');
            // Cut at the first line whose timestamp is within the window (a byte
            // cut wouldn't line up with "recent enough" for a quiet store's log).
            const cutoff = Date.now() - LOG_TAIL_MAX_AGE_MS;
            let cutIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(LOG_LINE_TIMESTAMP_RE);
                if (!match)
                    continue;
                const ts = new Date(match[1].replace(' ', 'T')).getTime();
                if (Number.isFinite(ts) && ts >= cutoff) {
                    cutIndex = i;
                    break;
                }
            }
            const filtered = cutIndex === -1 ? lines : lines.slice(cutIndex);
            const filteredText = filtered.join('\n');
            // Byte cap stays as a backstop in case even the time-windowed content
            // is still large (e.g. a very chatty week).
            const buffer = Buffer.from(filteredText, 'utf8');
            const overCap = buffer.length > LOG_TAIL_MAX_BYTES;
            const text = overCap ? buffer.subarray(-LOG_TAIL_MAX_BYTES).toString('utf8') : filteredText;
            return { text, truncated: overCap || cutIndex > 0 };
        }
        catch (error) {
            return { error: getErrorMessage(error) };
        }
    });
    // Renderer failures are classified locally; message, stack, digest and route
    // can contain business data and are never sent automatically.
    handle('report-renderer-error', async () => {
        cloud_sync_1.cloudSync.captureOperationFailure({
            capture_point: 'fc.electron.renderer.exception',
            outcome: 'unknown',
            correlation_id: (0, crypto_1.randomUUID)(),
        });
        return { success: true };
    });
    handle('get-posthog-bootstrap', async () => {
        try {
            return (0, posthog_1.readPostHogBootstrap)();
        }
        catch {
            return { enabled: false };
        }
    });
    // Printers
    handle('get-printers', async () => {
        return (0, db_1.withDatabaseRequest)(async () => {
            try {
                const db = (0, db_1.getDatabase)();
                const printers = db.prepare('SELECT * FROM printers ORDER BY name').all();
                return printers;
            }
            catch (error) {
                return { error: getErrorMessage(error) };
            }
        });
    });
    // Saves renderer-built print HTML (the menu, and future documents) as a PDF
    // through an offscreen window, so a merchant can share it without a printer.
    handle('save-html-as-pdf', async (_event, payload) => {
        if (!payload || typeof payload !== 'object')
            return { success: false, error: 'Invalid PDF request' };
        const { html, defaultFileName, pageSize } = payload;
        if (typeof html !== 'string' || html.length === 0) {
            return { success: false, error: 'Invalid PDF request' };
        }
        if (Buffer.byteLength(html, 'utf8') > html_to_pdf_1.MAX_PDF_HTML_BYTES) {
            return { success: false, error: 'Document too large to export' };
        }
        const resolvedPageSize = pageSize === 'Letter' ? 'Letter' : 'A4';
        const requestedName = typeof defaultFileName === 'string' ? defaultFileName.trim() : '';
        const baseName = requestedName.replace(/[^\w.\- ]+/g, '-').slice(0, 80) || 'document.pdf';
        const saveResult = await electron_1.dialog.showSaveDialog({
            defaultPath: path.join(electron_1.app.getPath('documents'), baseName.endsWith('.pdf') ? baseName : `${baseName}.pdf`),
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (saveResult.canceled || !saveResult.filePath)
            return { success: false, canceled: true };
        try {
            const pdfData = await (0, html_to_pdf_1.renderHtmlToPdfBuffer)({ html, pageSize: resolvedPageSize });
            await fs.promises.writeFile(saveResult.filePath, pdfData);
            return { success: true, path: saveResult.filePath };
        }
        catch (error) {
            return { success: false, error: getErrorMessage(error) };
        }
    });
    handle('rasterize-print-document', async (_event, payload) => {
        if (!payload || typeof payload !== 'object')
            return { ok: false, error: 'Invalid raster document request' };
        const request = payload;
        if (!(0, document_1.isPrintDocument)(request.document) ||
            (request.template !== 'classic' && request.template !== 'compact') ||
            typeof request.profileId !== 'string' ||
            request.profileId.length === 0 ||
            !request.options ||
            typeof request.options !== 'object') {
            return { ok: false, error: 'Invalid raster document request' };
        }
        const options = request.options;
        if (!isValidRasterColumns(options.columns) ||
            typeof options.language !== 'string' ||
            typeof options.locale !== 'string' ||
            typeof options.currency !== 'string' ||
            typeof options.currencySymbol !== 'string' ||
            typeof options.trimDecimals !== 'boolean' ||
            typeof options.useUnicode !== 'boolean' ||
            typeof options.arabicShaping !== 'boolean' ||
            (options.timezone !== undefined && typeof options.timezone !== 'string')) {
            return { ok: false, error: 'Invalid raster document options' };
        }
        try {
            return await (0, thermal_1.rasterizePrintDocumentForWebUsb)(request.document, request.template, request.profileId, options);
        }
        catch (error) {
            return { ok: false, error: getErrorMessage(error) };
        }
    });
    handle('rasterize-kot-document', async (_event, payload) => {
        if (!payload || typeof payload !== 'object')
            return { ok: false, error: 'Invalid raster KOT request' };
        const request = payload;
        if (!(0, document_1.isKotDocument)(request.document) ||
            typeof request.profileId !== 'string' ||
            request.profileId.length === 0 ||
            !request.options ||
            typeof request.options !== 'object') {
            return { ok: false, error: 'Invalid raster KOT request' };
        }
        const options = request.options;
        if (!isValidRasterColumns(options.columns) ||
            typeof options.language !== 'string' ||
            typeof options.locale !== 'string' ||
            (options.timezone !== undefined && typeof options.timezone !== 'string') ||
            typeof options.useUnicode !== 'boolean' ||
            typeof options.arabicShaping !== 'boolean') {
            return { ok: false, error: 'Invalid raster KOT options' };
        }
        try {
            return await (0, thermal_1.rasterizeKotDocumentForWebUsb)(request.document, request.profileId, options);
        }
        catch (error) {
            return { ok: false, error: getErrorMessage(error) };
        }
    });
    console.log('[IPC] Handlers registered');
}
//# sourceMappingURL=ipc.js.map