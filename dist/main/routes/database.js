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
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const authorization_1 = require("../services/authorization");
const master_pin_1 = require("../middleware/master-pin");
const jwt_secret_1 = require("../security/jwt-secret");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const async_handler_1 = require("../middleware/async-handler");
const shutdown_1 = require("../shutdown");
const phone_1 = require("../lib/phone");
const role_permissions_1 = require("../../shared/role-permissions");
const node_crypto_1 = require("node:crypto");
const google_drive_1 = require("../services/google-drive");
const restore_file_selection_1 = require("../services/restore-file-selection");
const router = (0, express_1.Router)();
// Settings keys stripped from export — these are secrets; exporting them would
// allow token forgery or cloud credential theft (vuln-0005).
const EXPORT_SETTINGS_REDACT = new Set([
    'jwt_secret',
    'cloud_api_key',
    'cloud_device_secret',
    'cloud_pos_hash',
    'mobile_pairing_code',
    'mobile_pairing_code_expires_at',
    // Token used to poll pending cloud account-deletion requests.
    'cloud_deletion_status_token',
    // Redact legacy error strings from exported settings.
    'cloud_last_error',
]);
// User columns stripped from export — hashes must never leave the server.
const USER_REDACT_COLS = new Set(['password', 'pin', 'pin_hash']);
// Tables excluded entirely — cloud_sync_outbox may contain cloud auth payloads.
// local_diagnostics is device-local operator-facing state, not customer data, so
// a backup taken on one till must not carry another till's failure log.
const EXPORT_EXCLUDE_TABLES = new Set([
    'cloud_sync_outbox',
    'support_ticket_outbox',
    'store_diagnostics_outbox',
    'diagnostics_hourly_aggregates',
    'diagnostics_delivery_gaps',
    'local_diagnostics',
    'kds_pairing_tokens',
    'customer_display_tokens',
]);
// Parse schema version; invalid or missing versions collapse to -1 or 0 to trigger mismatch handling.
function parseImportSchemaVersion(value) {
    const raw = String(value ?? '0');
    return /^(?:0|[1-9]\d*)$/.test(raw) ? Number(raw) : -1;
}
router.get('/export', (0, authorization_1.requirePermission)('database.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const result = (0, db_1.withTxn)(() => {
            const tables = (0, db_1.getTables)(db);
            const exportData = {};
            const redactedFields = [];
            for (const tableName of tables) {
                if (!(0, db_1.isSafeIdentifier)(tableName)) {
                    console.warn(`[DB Export] Skipping unsafe table name: ${tableName}`);
                    continue;
                }
                if (EXPORT_EXCLUDE_TABLES.has(tableName)) {
                    redactedFields.push(`table:${tableName}`);
                    continue;
                }
                const allowedColumns = new Set(getTableColumns(db, tableName));
                const rawRows = db.prepare(`SELECT * FROM ${tableName}`).all();
                const rows = rawRows.map((row) => {
                    const sanitized = {};
                    for (const [key, value] of Object.entries(row)) {
                        if (allowedColumns.has(key)) {
                            sanitized[key] = value;
                        }
                    }
                    return sanitized;
                });
                if (tableName === 'settings') {
                    exportData[tableName] = rows.map((row) => {
                        if (EXPORT_SETTINGS_REDACT.has(row.key)) {
                            redactedFields.push(`settings.${row.key}`);
                            return { ...row, value: '[REDACTED]' };
                        }
                        return row;
                    });
                }
                else if (tableName === 'users') {
                    exportData[tableName] = rows.map((row) => {
                        const sanitized = { ...row };
                        for (const col of USER_REDACT_COLS) {
                            if (col in sanitized) {
                                delete sanitized[col];
                                if (!redactedFields.includes(`users.${col}`))
                                    redactedFields.push(`users.${col}`);
                            }
                        }
                        return sanitized;
                    });
                }
                else {
                    exportData[tableName] = rows;
                }
            }
            return { exportData, redactedFields };
        });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `flo-export-${timestamp}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json({
            version: 1,
            app: 'FloDesktop',
            exported_at: new Date().toISOString(),
            schema_version: String((0, db_1.getCurrentSchemaVersion)()),
            redacted_fields: result.redactedFields,
            data: result.exportData,
        });
    }
    catch (error) {
        console.error('[DB Export] Error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
});
router.post('/import', (0, authorization_1.requirePermission)('database.manage'), (req, res, next) => {
    // Require Master PIN for overwrite or version mismatch to guard destructive replacement.
    const body = req.body;
    const overwrite = Boolean(body?.overwrite);
    const schemaVersionMismatch = body?.data && typeof body.data === 'object'
        ? parseImportSchemaVersion(body.data.schema_version ?? body.data.schemaVersion) !==
            (0, db_1.getCurrentSchemaVersion)()
        : false;
    return overwrite || schemaVersionMismatch ? (0, master_pin_1.requireMasterPin)(req, res, next) : next();
}, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { data } = req.body;
    if (!data || !data.data || typeof data.data !== 'object') {
        return res.status(400).json({ error: 'Invalid import file format' });
    }
    await google_drive_1.googleDrive.prepareForDatabaseRestore();
    try {
        return await (0, db_1.withDatabaseMaintenanceLock)(async (signal) => {
            try {
                (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                const { data, overwrite } = req.body;
                const db = (0, db_1.getDatabase)();
                const allowedTables = new Set((0, db_1.getTables)(db));
                const preservedRevocations = db
                    .prepare('SELECT token_hash, expires_at, revoked_at FROM revoked_tokens')
                    .all();
                const baselineForeignKeyViolations = (0, db_1.getForeignKeyViolationKeys)(db);
                const preservedUserSecurity = (0, db_1.captureUserSecurityState)(db);
                const preservedUserStations = (0, db_1.captureUserStationSecurityState)(db);
                const preservedStationSecurity = (0, db_1.captureKitchenStationSecurityState)(db);
                const preservedKdsEnabled = (0, db_1.captureKdsEnabledSetting)(db);
                const preservedProtectedSettings = (0, db_1.captureRestoreProtectedSettings)(db);
                const importData = data.data;
                const importerUserId = String(req.user?.userId || '');
                const importBatchId = (0, node_crypto_1.randomUUID)();
                const importTimestamp = (0, db_1.now)();
                const importSchemaVersion = parseImportSchemaVersion(data.schema_version ?? data.schemaVersion);
                const hasVersionMismatch = importSchemaVersion !== (0, db_1.getCurrentSchemaVersion)();
                if (hasVersionMismatch) {
                    console.log(`[DB Import] Version mismatch: import v${importSchemaVersion} vs current v${(0, db_1.getCurrentSchemaVersion)()}. Using data-only merge.`);
                }
                const requiredTables = ['settings', 'categories', 'products', 'users'];
                const importedTables = Object.keys(importData);
                const missingTables = requiredTables.filter((t) => !importedTables.includes(t));
                if (missingTables.length > 0) {
                    return res.status(400).json({
                        error: `Missing required tables: ${missingTables.join(', ')}`,
                    });
                }
                const malformedTables = requiredTables.filter((tableName) => !Array.isArray(importData[tableName]));
                if (malformedTables.length > 0) {
                    return res.status(400).json({
                        error: `Import tables must be arrays: ${malformedTables.join(', ')}`,
                    });
                }
                const invalidRecipeMultiplierIndex = Array.isArray(importData.product_variants)
                    ? importData.product_variants.findIndex((variant) => variant?.recipe_multiplier !== undefined &&
                        (typeof variant.recipe_multiplier !== 'number' ||
                            !Number.isFinite(variant.recipe_multiplier) ||
                            variant.recipe_multiplier <= 0))
                    : -1;
                if (invalidRecipeMultiplierIndex >= 0) {
                    return res.status(400).json({
                        error: `product_variants[${invalidRecipeMultiplierIndex}].recipe_multiplier must be a positive finite number`,
                    });
                }
                const invalidSupplyCostIndex = Array.isArray(importData.supplies)
                    ? importData.supplies.findIndex((supply) => supply?.unit_cost !== undefined &&
                        supply?.unit_cost !== null &&
                        (typeof supply.unit_cost !== 'number' ||
                            !Number.isFinite(supply.unit_cost) ||
                            supply.unit_cost < 0))
                    : -1;
                if (invalidSupplyCostIndex >= 0) {
                    return res.status(400).json({
                        error: `supplies[${invalidSupplyCostIndex}].unit_cost must be a non-negative finite number or null`,
                    });
                }
                if (Array.isArray(importData.products) && importData.products.length > 0) {
                    if (!Array.isArray(importData.inventory_movements)) {
                        const legacyZeroStockImport = !importedTables.includes('inventory_movements') &&
                            importData.products.every((row) => {
                                if (!row || typeof row !== 'object')
                                    return false;
                                const stockQuantity = row.stock_quantity == null ? 0 : Number(row.stock_quantity);
                                return Number.isFinite(stockQuantity) && stockQuantity === 0;
                            });
                        if (!legacyZeroStockImport) {
                            return res.status(400).json({
                                error: 'Product imports must include inventory movement history so stock changes remain auditable',
                            });
                        }
                    }
                    const importAddons = Array.isArray(importData.addons)
                        ? importData.addons.map((a) => a && typeof a === 'object' && a.stock_quantity === undefined
                            ? { ...a, stock_quantity: 0 }
                            : a)
                        : [];
                    if (Array.isArray(importData.inventory_movements) &&
                        (0, db_1.validateInventoryLedgerRows)(importData.products, importData.inventory_movements, Array.isArray(importData.product_variants) ? importData.product_variants : [], importAddons)) {
                        return res.status(400).json({
                            error: 'Product stock must match the latest inventory movement history',
                        });
                    }
                }
                if ((overwrite || hasVersionMismatch) &&
                    Array.isArray(importData.inventory_movements) &&
                    (0, db_1.getInventoryMovementRows)(db).length > 0) {
                    return res.status(400).json({
                        error: 'Overwrite imports cannot replace existing inventory movement history',
                    });
                }
                if ((overwrite || hasVersionMismatch) && Array.isArray(importData.products)) {
                    const inventoryReplacementError = (0, db_1.validateInventoryLedgerReplacement)(db.prepare('SELECT id, stock_quantity FROM products').all(), importedTables.includes('inventory_movements') ? (0, db_1.getInventoryMovementRows)(db) : [], importData.products, Array.isArray(importData.inventory_movements) ? importData.inventory_movements : []);
                    if (inventoryReplacementError) {
                        return res.status(400).json({ error: inventoryReplacementError });
                    }
                }
                // Preserve existing accounts and create inactive placeholders for redacted users without hashes.
                const importedUserRows = Array.isArray(importData.users) ? importData.users : [];
                const credentialedUserIds = new Set(importedUserRows
                    .filter((row) => typeof row?.password === 'string' && row.password.length > 0)
                    .map((row) => String(row.id)));
                const redactedUserIds = new Set(importedUserRows
                    .filter((row) => row &&
                    typeof row === 'object' &&
                    row.id != null &&
                    !credentialedUserIds.has(String(row.id)))
                    .map((row) => String(row.id)));
                const importProvidedUserIds = new Set([...credentialedUserIds, ...redactedUserIds]);
                const existingUserIds = new Set(db.prepare('SELECT id FROM users').all().map((row) => String(row.id)));
                const unresolvedUserIds = new Set();
                for (const [tableName, rows] of Object.entries(importData)) {
                    if (tableName === 'users' ||
                        !Array.isArray(rows) ||
                        !(0, db_1.isSafeIdentifier)(tableName) ||
                        !allowedTables.has(tableName) ||
                        EXPORT_EXCLUDE_TABLES.has(tableName))
                        continue;
                    const userReferenceColumns = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all()
                        .filter((foreignKey) => foreignKey.table === 'users')
                        .map((foreignKey) => foreignKey.from);
                    if (userReferenceColumns.length === 0)
                        continue;
                    for (const row of rows) {
                        if (!row || typeof row !== 'object')
                            continue;
                        for (const column of userReferenceColumns) {
                            if (tableName === 'inventory_movements' &&
                                (column === 'actor_user_id' || column === 'imported_by_user_id'))
                                continue;
                            const value = row[column];
                            if (value != null && String(value) !== '') {
                                const userId = String(value);
                                if (!existingUserIds.has(userId) && !importProvidedUserIds.has(userId))
                                    unresolvedUserIds.add(userId);
                            }
                        }
                    }
                }
                const importedWhatsappActivator = importedTables.includes('settings') && Array.isArray(importData.settings)
                    ? importData.settings.find((row) => row?.key === 'whatsapp_activated_by_user_id')
                        ?.value
                    : null;
                if (importedWhatsappActivator &&
                    !existingUserIds.has(String(importedWhatsappActivator)) &&
                    !importProvidedUserIds.has(String(importedWhatsappActivator))) {
                    unresolvedUserIds.add(String(importedWhatsappActivator));
                }
                if (unresolvedUserIds.size > 0) {
                    return res.status(400).json({
                        error: 'Import contains rows linked to user accounts that are not present in this export or this install. Set up matching staff accounts first.',
                    });
                }
                const { path: backupPath } = await (0, db_1.createBackupUnlocked)(undefined, signal);
                (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                const previousForeignKeys = Number(db.pragma('foreign_keys', { simple: true })) === 1;
                db.pragma('foreign_keys = OFF');
                try {
                    (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                    db.exec('BEGIN IMMEDIATE');
                    try {
                        let whatsappMessagesCleared = false;
                        let whatsappMessagesImported = false;
                        for (const tableName of importedTables) {
                            (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                            if (!allowedTables.has(tableName) || EXPORT_EXCLUDE_TABLES.has(tableName))
                                continue;
                            // Validate table name to prevent SQL injection
                            if (!(0, db_1.isSafeIdentifier)(tableName)) {
                                console.warn(`[DB Import] Skipping unsafe table name: ${tableName}`);
                                continue;
                            }
                            const rows = importData[tableName];
                            if (!rows || !Array.isArray(rows))
                                continue;
                            if (rows.length === 0) {
                                if (overwrite || hasVersionMismatch) {
                                    if (tableName === 'settings') {
                                        const protectedKeys = Array.from(EXPORT_SETTINGS_REDACT);
                                        const placeholders = protectedKeys.map(() => '?').join(', ');
                                        db.prepare(`DELETE FROM settings WHERE key NOT IN (${placeholders})`).run(...protectedKeys);
                                    }
                                    else {
                                        db.exec(`DELETE FROM ${tableName}`);
                                        if (tableName === 'whatsapp_messages') {
                                            whatsappMessagesCleared = true;
                                        }
                                    }
                                }
                                continue;
                            }
                            const currentCols = getTableColumns(db, tableName);
                            // Validate and filter column names to prevent SQL injection
                            const importCols = tableName === 'product_variants' ||
                                tableName === 'addons' ||
                                tableName === 'order_item_addons' ||
                                tableName === 'orders'
                                ? Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter(db_1.isSafeIdentifier))))
                                : Object.keys(rows[0]).filter(db_1.isSafeIdentifier);
                            // A normal export intentionally omits password/pin hashes. It must not
                            // attempt to recreate users with a NULL required password.
                            if (tableName === 'users' && !importCols.includes('password'))
                                continue;
                            const commonCols = importCols.filter((c) => currentCols.includes(c) && (0, db_1.isSafeIdentifier)(c));
                            if (commonCols.length === 0)
                                continue;
                            if (overwrite || hasVersionMismatch) {
                                if (tableName === 'settings') {
                                    const protectedKeys = Array.from(EXPORT_SETTINGS_REDACT);
                                    const placeholders = protectedKeys.map(() => '?').join(', ');
                                    db.prepare(`DELETE FROM settings WHERE key NOT IN (${placeholders})`).run(...protectedKeys);
                                }
                                else {
                                    db.exec(`DELETE FROM ${tableName}`);
                                    if (tableName === 'whatsapp_messages') {
                                        whatsappMessagesCleared = true;
                                    }
                                }
                            }
                            if (tableName === 'whatsapp_messages') {
                                whatsappMessagesImported = true;
                            }
                            if (tableName === 'inventory_movements') {
                                const insertImportedMovement = db.prepare(`
            INSERT INTO inventory_movements (
              product_id, variant_id, addon_id, quantity_delta, movement_type, reference_type, reference_id,
              reason, actor_user_id, stock_after, created_at,
              imported_by_user_id, import_batch_id,
              source_actor_user_id, source_reference_type, source_reference_id,
              source_reason, source_created_at
            ) VALUES (?, ?, ?, ?, ?, 'import', ?, 'Imported inventory movement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
                                const allHavePositiveIntegerIds = rows.length > 0 &&
                                    rows.every((row) => {
                                        const rawId = Number(row?.id);
                                        return Number.isInteger(rawId) && rawId > 0;
                                    });
                                const orderedRows = rows
                                    .map((row, index) => ({ row, index }))
                                    .sort((left, right) => {
                                    if (allHavePositiveIntegerIds) {
                                        const leftId = Number(left.row?.id);
                                        const rightId = Number(right.row?.id);
                                        if (leftId !== rightId)
                                            return leftId - rightId;
                                    }
                                    return left.index - right.index;
                                });
                                for (const { row } of orderedRows) {
                                    (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                                    const sourceValue = (value) => value == null ? null : String(value);
                                    insertImportedMovement.run(row.product_id, sourceValue(row.variant_id), sourceValue(row.addon_id), row.quantity_delta, row.movement_type, importBatchId, importerUserId, row.stock_after, importTimestamp, importerUserId, importBatchId, sourceValue(row.source_actor_user_id ?? row.actor_user_id), sourceValue(row.source_reference_type ?? row.reference_type), sourceValue(row.source_reference_id ?? row.reference_id), sourceValue(row.source_reason ?? row.reason), sourceValue(row.source_created_at ?? row.created_at));
                                }
                                console.log(`[DB Import] ${tableName}: ${rows.length} rows (${commonCols.length} columns)`);
                                continue;
                            }
                            const insertStatements = new Map();
                            const tenantCountryRow = db
                                .prepare("SELECT value FROM settings WHERE key = 'country'")
                                .get();
                            const tenantCountry = tenantCountryRow?.value || '';
                            for (const row of rows) {
                                (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                                // Exported secret fields are deliberately redacted. Never import the
                                // marker itself as a real credential (which would make it known).
                                if (tableName === 'settings' &&
                                    EXPORT_SETTINGS_REDACT.has(String(row.key)) &&
                                    row.value === '[REDACTED]')
                                    continue;
                                if (tableName === 'settings' &&
                                    !overwrite &&
                                    !hasVersionMismatch &&
                                    String(row.key) === 'offline_mode')
                                    continue;
                                if (tableName === 'customers' && row.phone) {
                                    const parsed = (0, phone_1.parsePhoneE164)(String(row.phone), tenantCountry);
                                    if (parsed) {
                                        row.phone = parsed.e164;
                                        if (commonCols.includes('country_code')) {
                                            row.country_code = parsed.countryCode;
                                        }
                                    }
                                }
                                const rowCols = tableName === 'product_variants' ||
                                    tableName === 'addons' ||
                                    tableName === 'order_item_addons' ||
                                    tableName === 'orders'
                                    ? commonCols.filter((column) => Object.prototype.hasOwnProperty.call(row, column) &&
                                        row[column] !== undefined &&
                                        !(tableName === 'orders' &&
                                            (column === 'release_status' ||
                                                column === 'checkout_stage' ||
                                                column === 'dispatch_policy') &&
                                            row[column] === null))
                                    : commonCols;
                                const rowColumnKey = rowCols.join(', ');
                                let insertStmt = insertStatements.get(rowColumnKey);
                                if (!insertStmt) {
                                    const placeholders = rowCols.map(() => '?').join(', ');
                                    insertStmt = db.prepare(`INSERT INTO ${tableName} (${rowColumnKey}) VALUES (${placeholders})`);
                                    insertStatements.set(rowColumnKey, insertStmt);
                                }
                                insertStmt.run(rowCols.map((column) => row[column]));
                            }
                            console.log(`[DB Import] ${tableName}: ${rows.length} rows (${commonCols.length} columns)`);
                        }
                        if (whatsappMessagesCleared || whatsappMessagesImported) {
                            (0, db_1.backfillWhatsAppMessageAttempts)(db, {
                                reset: whatsappMessagesCleared &&
                                    (!importedTables.includes('whatsapp_message_attempts') ||
                                        !Array.isArray(importData.whatsapp_message_attempts)),
                            });
                        }
                        const placeholderUsersCreated = restoreRedactedUserPlaceholders(db, importedUserRows, existingUserIds);
                        if (placeholderUsersCreated > 0) {
                            console.log(`[DB Import] Created ${placeholderUsersCreated} inactive placeholder user(s) for redacted exported accounts`);
                        }
                        (0, db_1.mergeUserSecurityState)(db, preservedUserSecurity);
                        (0, db_1.mergeUserStationSecurityState)(db, preservedUserStations, preservedUserSecurity.map((row) => row.id), preservedStationSecurity);
                        (0, db_1.mergeKdsEnabledSetting)(db, preservedKdsEnabled);
                        (0, db_1.mergeRestoreProtectedSettings)(db, preservedProtectedSettings);
                        db.prepare('DELETE FROM kds_pairing_tokens').run();
                        db.prepare('DELETE FROM customer_display_tokens').run();
                        const mergeRevocation = db.prepare(`
        INSERT INTO revoked_tokens (token_hash, expires_at, revoked_at)
        VALUES (?, ?, ?)
        ON CONFLICT(token_hash) DO UPDATE SET
          expires_at = MAX(revoked_tokens.expires_at, excluded.expires_at),
          revoked_at = MIN(revoked_tokens.revoked_at, excluded.revoked_at)
      `);
                        for (const revocation of preservedRevocations) {
                            mergeRevocation.run(revocation.token_hash, revocation.expires_at, revocation.revoked_at);
                        }
                        const inventoryValidationError = (0, db_1.validateInventoryLedgerDatabase)(db);
                        if (inventoryValidationError) {
                            throw new Error(`Import would violate the inventory ledger: ${inventoryValidationError}`);
                        }
                        const newForeignKeyViolations = [...(0, db_1.getForeignKeyViolationKeys)(db)].filter((key) => !baselineForeignKeyViolations.has(key));
                        if (newForeignKeyViolations.length > 0) {
                            throw new Error(`Import would introduce ${newForeignKeyViolations.length} new foreign-key violation(s)`);
                        }
                        (0, db_1.throwIfDatabaseMaintenanceAborted)(signal);
                        (0, db_1.clearGoogleDriveRestoreBinding)(db);
                        (0, db_1.executeSequenceRepair)(db);
                        db.prepare(`
                INSERT INTO settings (key, value, updated_at) VALUES ('sequence_repair_completed_at', ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
              `).run((0, db_1.now)(), (0, db_1.now)());
                        db.prepare(`
                INSERT INTO settings (key, value, updated_at) VALUES ('sequence_repair_pending', '0', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
              `).run((0, db_1.now)());
                        (0, db_1.rebuildSearchIndex)(db);
                        db.exec('COMMIT');
                        const cleanup = google_drive_1.googleDrive.completeDatabaseRestore();
                        try {
                            (0, security_1.clearUserAuthCache)();
                            (0, security_1.clearInMemoryRevokedTokens)();
                            (0, jwt_secret_1.clearJWTSecretCache)();
                        }
                        catch (cacheError) {
                            // Log post-commit cache cleanup failure without failing the committed import.
                            console.error('[DB Import] Post-commit cache cleanup failed:', cacheError);
                        }
                        res.json({
                            success: true,
                            message: hasVersionMismatch
                                ? 'Data imported with schema compatibility (some fields may be missing)'
                                : 'Database imported successfully',
                            backup: backupPath,
                            schemaVersionMismatch: hasVersionMismatch,
                            importedSchemaVersion: importSchemaVersion,
                            currentSchemaVersion: (0, db_1.getCurrentSchemaVersion)(),
                            placeholderUsersCreated,
                            cleanupPending: cleanup.cleanupPending,
                        });
                    }
                    catch (err) {
                        try {
                            db.exec('ROLLBACK');
                        }
                        catch { }
                        throw err;
                    }
                }
                finally {
                    db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
                }
            }
            catch (error) {
                console.error('[DB Import] Error:', error);
                res.status(500).json({ error: 'Import failed' });
            }
        }, (0, shutdown_1.getHttpRequestSignal)(req));
    }
    finally {
        google_drive_1.googleDrive.releaseDatabaseRestore();
    }
}));
function restoreRedactedUserPlaceholders(db, importedUserRows, existingUserIds) {
    if (importedUserRows.length === 0)
        return 0;
    const currentCols = getTableColumns(db, 'users');
    const insertableCols = [
        'id',
        'name',
        'email',
        'password',
        'role',
        'category_ids',
        'is_active',
        'terms_accepted_at',
        'tokens_valid_after',
        'station_assignments_configured',
        'created_at',
        'updated_at',
    ].filter((column) => currentCols.includes(column));
    if (!insertableCols.includes('id') || !insertableCols.includes('password'))
        return 0;
    const colList = insertableCols.join(', ');
    const placeholders = insertableCols.map(() => '?').join(', ');
    const insertStmt = db.prepare(`INSERT OR IGNORE INTO users (${colList}) VALUES (${placeholders})`);
    let created = 0;
    for (const row of importedUserRows) {
        if (!row || typeof row !== 'object')
            continue;
        if (typeof row.password === 'string' && row.password.length > 0)
            continue;
        const id = row.id == null ? '' : String(row.id);
        if (!id || existingUserIds.has(id))
            continue;
        const timestamp = typeof row.updated_at === 'string' && row.updated_at
            ? row.updated_at
            : new Date().toISOString();
        const roleValue = String(row.role);
        const role = (0, role_permissions_1.isRole)(roleValue) ? roleValue : 'cashier';
        const values = {
            id,
            name: typeof row.name === 'string' && row.name.trim() ? row.name : `Imported staff ${id}`,
            email: null,
            password: `disabled-redacted-import-${id}`,
            role,
            category_ids: typeof row.category_ids === 'string' ? row.category_ids : null,
            is_active: 0,
            terms_accepted_at: null,
            tokens_valid_after: null,
            station_assignments_configured: 0,
            created_at: typeof row.created_at === 'string' && row.created_at ? row.created_at : timestamp,
            updated_at: timestamp,
        };
        const info = insertStmt.run(...insertableCols.map((column) => values[column] ?? null));
        if (info.changes > 0) {
            existingUserIds.add(id);
            created += 1;
        }
    }
    return created;
}
function getTableColumns(db, tableName) {
    if (!(0, db_1.isSafeIdentifier)(tableName)) {
        console.warn(`[DB Columns] Unsafe table name rejected: ${tableName}`);
        return [];
    }
    try {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return columns.map((col) => col.name);
    }
    catch {
        return [];
    }
}
router.post('/backup', (0, authorization_1.requirePermission)('database.manage'), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const { path: backupPath, schemaVersion } = await (0, db_1.createBackup)(undefined, (0, shutdown_1.getHttpRequestSignal)(req));
        res.json({
            success: true,
            path: backupPath,
            filename: path.basename(backupPath),
            schemaVersion,
        });
    }
    catch (error) {
        console.error('[DB Backup] Error:', error);
        res.status(500).json({ error: 'Backup failed' });
    }
}));
const RESTORE_CONFIRMATION = 'RESTORE BACKUP';
// Restore from a file the operator picked in the native dialog. This is the
// authorised alternative to the Master PIN gate: the session must hold
// database.manage, the operator must type the confirmation phrase, and the file
// path is only accepted when it is the one the main process just handed out from
// that dialog (see services/restore-file-selection). The restore itself runs
// through the same restoreBackup() mechanism as every other route.
router.post('/restore', (0, authorization_1.requirePermission)('database.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (req.body?.confirmation !== RESTORE_CONFIRMATION) {
        return res.status(400).json({ error: `Type "${RESTORE_CONFIRMATION}" to confirm` });
    }
    const selectionToken = typeof req.body?.selection_token === 'string' ? req.body.selection_token : '';
    const backupPath = (0, restore_file_selection_1.peekRestoreFileSelection)(selectionToken);
    if (!backupPath) {
        return res
            .status(400)
            .json({ error: 'Choose a backup file in the restore dialog before confirming' });
    }
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ error: 'Backup file no longer exists' });
    }
    const backupVersion = (0, db_1.getSchemaVersionFromBackup)(backupPath);
    if (backupVersion === null) {
        return res.status(400).json({
            error: 'Invalid backup file: missing schema version metadata. This backup may have been created with an older version of Flo.',
        });
    }
    if (!(0, restore_file_selection_1.consumeRestoreFileSelection)(selectionToken)) {
        return res
            .status(400)
            .json({ error: 'Choose a backup file in the restore dialog before confirming' });
    }
    const currentVersion = (0, db_1.getCurrentSchemaVersion)();
    const versionMismatch = backupVersion !== currentVersion;
    await google_drive_1.googleDrive.prepareForDatabaseRestore();
    try {
        const restoreResult = await (0, db_1.withDatabaseMaintenanceLock)((signal) => (0, db_1.restoreBackup)(backupPath, !versionMismatch, signal), (0, shutdown_1.getHttpRequestSignal)(req));
        if (!restoreResult.success) {
            return res.status(422).json({ error: restoreResult.error || 'Restore failed' });
        }
        const cleanup = google_drive_1.googleDrive.completeDatabaseRestore();
        (0, security_1.clearUserAuthCache)();
        (0, security_1.clearInMemoryRevokedTokens)();
        (0, jwt_secret_1.clearJWTSecretCache)();
        res.json({
            success: true,
            mode: restoreResult.mode,
            backupVersion,
            currentVersion,
            tablesRestored: restoreResult.tablesRestored,
            cleanupPending: restoreResult.cleanupPending === true || cleanup?.cleanupPending === true,
        });
    }
    catch (error) {
        console.error('[DB Restore] Error:', error);
        res.status(500).json({ error: 'Restore failed' });
    }
    finally {
        google_drive_1.googleDrive.releaseDatabaseRestore();
    }
}));
router.get('/download', (0, authorization_1.requirePermission)('database.manage'), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    let tempDir = null;
    try {
        const dbPath = (0, db_1.getDbPath)();
        tempDir = fs.mkdtempSync(path.join(path.dirname(dbPath), '.flo-download-'));
        const snapshotPath = path.join(tempDir, 'flo-database.db');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `flo-database-${timestamp}.db`;
        // Download a clean checkpointed backup rather than streaming the live WAL
        // file. The temporary snapshot is independent of later restore/reset work.
        await (0, db_1.createBackup)(snapshotPath, (0, shutdown_1.getHttpRequestSignal)(req));
        const signal = (0, shutdown_1.getHttpRequestSignal)(req);
        const download = new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
                try {
                    res.destroy();
                }
                catch (error) {
                    settle(error);
                    return;
                }
            };
            const settle = (error) => {
                if (settled)
                    return;
                settled = true;
                signal?.removeEventListener('abort', onAbort);
                if (error)
                    reject(error);
                else
                    resolve();
            };
            res.once('finish', () => settle());
            res.once('close', () => settle());
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) {
                onAbort();
                return;
            }
            try {
                res.download(snapshotPath, filename, (error) => settle(error));
            }
            catch (error) {
                settle(error);
            }
        });
        void (0, shutdown_1.trackHttpRequestWork)(req, download)
            .finally(() => {
            try {
                if (tempDir)
                    fs.rmSync(tempDir, { recursive: true, force: true });
            }
            catch { }
        })
            .catch((error) => {
            console.error('[DB Download] Stream error:', error.message);
        });
    }
    catch (error) {
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
            catch { }
        }
        console.error('[DB Download] Error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
}));
router.get('/tables', (0, authorization_1.requirePermission)('database.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const tables = db
            .prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_flo_meta'
      ORDER BY name
    `)
            .all();
        const tableInfo = tables
            .filter(({ name: tableName }) => (0, db_1.isSafeIdentifier)(tableName))
            .map(({ name: tableName }) => {
            const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
            return { name: tableName, rows: count.count };
        });
        res.json({ tables: tableInfo });
    }
    catch (error) {
        console.error('[DB Tables] Error:', error);
        res.status(500).json({ error: 'Could not fetch database tables' });
    }
});
exports.databaseRoutes = router;
//# sourceMappingURL=database.js.map