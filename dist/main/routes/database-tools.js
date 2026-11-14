"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseToolsRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const authorization_1 = require("../services/authorization");
const master_pin_1 = require("../middleware/master-pin");
const async_handler_1 = require("../middleware/async-handler");
const schema_health_1 = require("../services/schema-health");
const master_pin_2 = require("../services/master-pin");
const jwt_secret_1 = require("../security/jwt-secret");
const shutdown_1 = require("../shutdown");
const google_drive_1 = require("../services/google-drive");
const currencies_1 = require("../../shared/currencies");
const local_backup_1 = require("../services/local-backup");
const router = (0, express_1.Router)();
// Read-only / additive-only — not master-PIN gated, only owner-gated.
router.get('/health-check', (0, authorization_1.requirePermission)('database.manage'), (_req, res) => {
    try {
        res.json((0, schema_health_1.runHealthCheck)());
    }
    catch (error) {
        console.error('[DB Tools] health-check error:', error);
        res.status(500).json({ error: 'Health check failed' });
    }
});
router.post('/apply-safe-fixes', (0, authorization_1.requirePermission)('database.manage'), (req, res) => {
    try {
        const body = (req.body && typeof req.body === 'object' ? req.body : {});
        const { findingIds } = body;
        if (findingIds !== undefined &&
            (!Array.isArray(findingIds) || findingIds.some((id) => typeof id !== 'string'))) {
            return res.status(400).json({ error: 'findingIds must be an array of finding id strings' });
        }
        res.json((0, schema_health_1.applySafeFixes)(findingIds));
    }
    catch (error) {
        console.error('[DB Tools] apply-safe-fixes error:', error);
        res.status(500).json({ error: 'Applying fixes failed' });
    }
});
router.get('/backups', (0, authorization_1.requirePermission)('database.manage'), (req, res) => {
    try {
        const pagination = (0, db_1.parseBackupPaginationQuery)(req.query.limit, req.query.cursor);
        res.json((0, db_1.listBackupsPage)(pagination));
    }
    catch (error) {
        if (error?.code === 'ERR_INVALID_BACKUP_PAGINATION') {
            return res.status(400).json({ error: error.message });
        }
        console.error('[DB Tools] list backups error:', error);
        res.status(500).json({ error: 'Listing backups failed' });
    }
});
// Deletes one backup from the managed backups directory, protected by Master PIN.
router.post('/backups/:fileName/delete', (0, authorization_1.requirePermission)('database.manage'), master_pin_1.requireMasterPin, (req, res) => {
    try {
        (0, db_1.deleteBackup)(req.params.fileName);
        res.json({ success: true });
    }
    catch (error) {
        console.error('[DB Tools] delete backup error:', error);
        if (error?.code === 'ERR_INVALID_BACKUP_NAME') {
            return res.status(400).json({ error: 'Invalid backup file name' });
        }
        if (error?.code === 'ERR_BACKUP_NOT_FOUND') {
            return res.status(404).json({ error: 'Backup not found' });
        }
        res.status(500).json({ error: 'Deleting backup failed' });
    }
});
function localBackupStatus() {
    return {
        enabled: (0, local_backup_1.isLocalBackupEnabled)(),
        directory: (0, local_backup_1.getLocalBackupDir)(),
        retention: local_backup_1.LOCAL_BACKUP_RETENTION,
        lastBackupAt: (0, local_backup_1.getLastLocalBackupAt)(),
    };
}
router.get('/local-backup', (0, authorization_1.requirePermission)('database.manage'), (_req, res) => {
    try {
        res.json(localBackupStatus());
    }
    catch (error) {
        console.error('[DB Tools] local backup status error:', error);
        res.status(500).json({ error: 'Could not read local backup status' });
    }
});
router.put('/local-backup', (0, authorization_1.requirePermission)('database.manage'), (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    try {
        (0, local_backup_1.setLocalBackupEnabled)(req.body.enabled);
        res.json(localBackupStatus());
    }
    catch (error) {
        console.error('[DB Tools] local backup update error:', error);
        res.status(500).json({ error: 'Could not update local backup setting' });
    }
});
router.get('/master-pin/status', (0, authorization_1.requirePermission)('database.manage'), (_req, res) => {
    res.json({
        available: (0, master_pin_2.isMasterPinAvailable)(),
        isSet: (0, master_pin_2.isMasterPinSet)(),
        schemaVersion: (0, db_1.getCurrentSchemaVersion)(),
    });
});
router.post('/master-pin/reset', (0, authorization_1.requirePermission)('database.manage'), (req, res, next) => {
    if ((0, master_pin_2.isMasterPinSet)()) {
        (0, master_pin_1.requireMasterPin)(req, res, next);
        return;
    }
    next();
}, (req, res) => {
    const { pin, confirm_pin } = req.body;
    const cleanPin = String(pin || '').trim();
    if (!/^\d{4}$/.test(cleanPin)) {
        return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }
    if (cleanPin !== confirm_pin) {
        return res.status(400).json({ error: 'PINs do not match' });
    }
    if (!(0, master_pin_2.isMasterPinAvailable)()) {
        return res.status(409).json({ error: 'Master PIN is not available on this device' });
    }
    try {
        (0, master_pin_2.resetMasterPin)(cleanPin);
        res.json({ success: true });
    }
    catch (error) {
        console.error('[DB Tools] set Master PIN error:', error);
        res.status(500).json({ error: 'Failed to set Master PIN' });
    }
});
const INITIALIZE_CONFIRM_PHRASE = 'INITIALIZE';
router.get('/currency-reset-impact', (0, authorization_1.requirePermission)('database.manage'), (_req, res) => {
    try {
        res.json((0, db_1.getCurrencyResetImpact)());
    }
    catch (error) {
        console.error('[DB Tools] currency reset impact error:', error);
        res.status(500).json({ error: 'Could not inspect currency reset impact' });
    }
});
router.post('/currency-reset', (0, authorization_1.requirePermission)('database.manage'), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const currency = typeof req.body?.currency === 'string' ? req.body.currency.trim().toUpperCase() : '';
    if (!(0, currencies_1.isSupportedCurrencyCode)(currency)) {
        return res.status(400).json({ error: 'Invalid or unsupported currency' });
    }
    const impact = (0, db_1.getCurrencyResetImpact)();
    if (!impact.currentCurrency) {
        return res.status(409).json({ error: 'Store currency is not configured' });
    }
    if (impact.currentCurrency === currency) {
        return res.status(409).json({ error: 'The selected currency is already active' });
    }
    if (req.body?.current_currency !== impact.currentCurrency) {
        return res
            .status(409)
            .json({ error: 'The active currency changed. Reload settings and try again.' });
    }
    const confirmationPhrase = `CHANGE TO ${currency}`;
    if (req.body?.confirmation_phrase !== confirmationPhrase) {
        return res.status(400).json({ error: `Type "${confirmationPhrase}" to confirm` });
    }
    let restorePrepared = false;
    try {
        await google_drive_1.googleDrive.prepareForDatabaseRestore();
        restorePrepared = true;
        const keepLocalBackup = (0, local_backup_1.isLocalBackupEnabled)();
        const result = await (0, db_1.resetDatabaseForCurrencyChange)(currency, impact.currentCurrency, (0, shutdown_1.getHttpRequestSignal)(req));
        let localBackupFailed = false;
        if (keepLocalBackup) {
            localBackupFailed = (0, local_backup_1.retainBackupLocally)(result.backupPath) === null;
        }
        else {
            (0, local_backup_1.setLocalBackupEnabled)(false);
        }
        const cleanup = google_drive_1.googleDrive.completeDatabaseRestore();
        (0, security_1.clearUserAuthCache)();
        (0, security_1.clearInMemoryRevokedTokens)();
        (0, jwt_secret_1.clearJWTSecretCache)();
        res.json({
            success: true,
            currency,
            backupPath: result.backupPath,
            cleanupPending: result.cleanupPending || cleanup.cleanupPending,
            localBackupFailed,
        });
    }
    catch (error) {
        if (typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ERR_CURRENCY_CHANGED') {
            return res
                .status(409)
                .json({ error: 'The active currency changed. Reload settings and try again.' });
        }
        console.error('[DB Tools] currency reset error:', error);
        res.status(500).json({ error: 'Currency reset failed' });
    }
    finally {
        if (restorePrepared)
            google_drive_1.googleDrive.releaseDatabaseRestore();
    }
}));
router.post('/initialize', (0, authorization_1.requirePermission)('database.manage'), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (req.body?.confirmation_phrase !== INITIALIZE_CONFIRM_PHRASE) {
        return res.status(400).json({ error: `Type "${INITIALIZE_CONFIRM_PHRASE}" to confirm` });
    }
    let restorePrepared = false;
    try {
        // The owner's typed INITIALIZE may discard a Drive restore boundary that can
        // never resolve on its own; the reset invalidates Drive state either way.
        await google_drive_1.googleDrive.prepareForDatabaseRestore({ discardUnresolvedBoundary: true });
        restorePrepared = true;
        const keepLocalBackup = (0, local_backup_1.isLocalBackupEnabled)();
        const { backupPath } = await (0, db_1.resetDatabaseWithBackup)((0, shutdown_1.getHttpRequestSignal)(req));
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
        res.json({
            success: true,
            backupPath,
            cleanupPending: cleanup.cleanupPending,
            localBackupFailed,
        });
    }
    catch (error) {
        console.error('[DB Tools] initialize error:', error);
        res.status(500).json({ error: 'Initialize failed' });
    }
    finally {
        if (restorePrepared)
            google_drive_1.googleDrive.releaseDatabaseRestore();
    }
}));
exports.databaseToolsRoutes = router;
//# sourceMappingURL=database-tools.js.map