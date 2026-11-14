import Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import { dayBoundsInTimezone, utcDayBounds } from '../shared/business-date';
export declare function throwIfDatabaseMaintenanceAborted(signal?: AbortSignal): void;
export declare const MAINTENANCE_DRAIN_TIMEOUT_MS = 10000;
export declare function beginDatabaseShutdown(): void;
export declare function withDatabaseRequest<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T>;
export declare function registerDatabaseMaintenanceStartListener(listener: () => void): () => void;
export declare function registerDatabaseMaintenanceEndListener(listener: () => void): () => void;
export declare function isDatabaseMaintenanceActive(): boolean;
export interface DatabaseAdmissionReservation {
    retain(): boolean;
    release(): void;
    isReleased(): boolean;
}
export declare function createDatabaseMaintenanceHandoff(reservation: DatabaseAdmissionReservation): string | null;
export declare function consumeDatabaseMaintenanceHandoff(token: string): DatabaseAdmissionReservation | null;
export declare function revokeDatabaseMaintenanceHandoff(token: string): void;
export declare function getActiveDatabaseRequestsCount(): number;
export declare function databaseMaintenanceMiddleware(req: Request, res: Response, next: NextFunction): void;
export declare function withDatabaseMaintenanceLock<T>(operation: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T>;
export declare function getSettingValue(key: string): string | null;
/** Resolves the tenant's configured business day start time, holding it to the
 *  `00:00`-`11:59` contract the settings endpoint enforces. */
export declare function tenantBusinessDayStartTime(customDb?: ReturnType<typeof getDatabase>): string;
export declare function getSettingsRevision(): number;
export declare function upsertSettings(entries: Record<string, string | undefined | null>): void;
export declare const GOOGLE_DRIVE_PRIVATE_SETTING_KEYS: string[];
export declare function clearGoogleDriveRestoreBinding(dbInstance?: Database.Database): void;
export declare function getDbHealth(): {
    ok: boolean;
    error?: string;
};
export declare function getDbPath(): string;
export declare function getBackupDir(): string;
export type DatabaseReplacementJournalHandle = {
    phase: 'prepared' | 'committed';
    journalPath: string;
    recoveryPath: string;
    dbPath: string;
};
export declare function getDatabaseReplacementJournal(): DatabaseReplacementJournalHandle | null;
export declare function beginDatabaseReplacementJournal(recoverySourcePath: string, kind: 'restore' | 'reset'): DatabaseReplacementJournalHandle;
export declare function commitDatabaseReplacementJournal(handle: DatabaseReplacementJournalHandle): void;
export declare function abortDatabaseReplacementJournal(handle: DatabaseReplacementJournalHandle): void;
export declare function finalizeDatabaseReplacementJournal(handle: DatabaseReplacementJournalHandle): void;
export declare function isSqliteStorageOrOpenError(error: unknown): boolean;
export declare function readWalCommittedPage1UserVersion(walPath: string, expectedPageSize?: number): number | null;
export declare function recoverDatabaseReplacementJournal(handle: DatabaseReplacementJournalHandle): void;
export declare function getRecoverySchemaBuildCount(): number;
export declare function clearRecoverySchemaReference(): void;
export declare function isHealthyDatabaseFile(filePath: string, allowedForeignKeyViolations?: Set<string> | null | undefined, requireMetadata?: boolean): boolean;
export declare const MAX_RETAINED_RESTORE_SAFETY_COPIES = 3;
/** True for the retained copies a successful restore leaves behind as an undo. */
export declare function isRestoreSafetyCopyName(fileName: string): boolean;
/**
 * A successful restore replaces the live database, so the pre-restore snapshot is
 * the only copy of what it replaced. It is copied into the managed backup naming
 * scheme rather than deleted, which makes it appear in listBackups() and makes it
 * restorable through the same preset-path route as any other managed backup.
 * Retention is bounded so a long-lived install cannot accumulate copies forever.
 *
 * The snapshot is copied rather than renamed so the replacement journal keeps
 * pointing at a real file: a crash between the committed journal and cleanup must
 * still be able to roll the live database back from it.
 */
export declare function retainRestoreSafetyCopy(recoveryPath: string, schemaVersion: number): string | null;
export declare function registerOrderSearchFunctions(dbInstance: Database.Database): void;
export declare function registerSettingsRevisionTriggers(dbInstance?: Database.Database): void;
export declare function initDatabase(recoverInterruptedReplacement?: boolean, allowDuringShutdown?: boolean): void;
export declare function ensureCloudIdentity(): {
    posHash: string;
    deviceSecret: string;
};
/** Locally-cached RevFlo pairing code (plaintext) — FloAdmin only ever returns it once. */
export declare function getCachedPairingCode(): {
    code: string;
    expiresAt: string;
} | null;
export declare function setCachedPairingCode(code: string, expiresAt: string): void;
/** Random UUID, generated once and persisted — never derived from store/device identity. */
export declare function ensureTelemetryAnonId(): string;
/** Anonymous telemetry toggle; enabled by default, reconfigurable in Settings > Privacy. */
export declare function isTelemetryEnabled(): boolean;
/** Tier 2 diagnostics consent toggle; separate from anonymous telemetry. */
export declare function isDiagnosticsConsentEnabled(): boolean;
/** Automatic transmission is separate from capture and is disabled by either diagnostics consent gate. */
export declare function isDiagnosticsTransmissionEnabled(): boolean;
/** Kitchen Display System on/off switch. Defaults to enabled. */
export declare function isKdsEnabled(): boolean;
/** Server App tableside ordering switch; defaults to enabled. */
export declare function isServerAppEnabled(): boolean;
/** KOT ticket printing on/off switch (gates automatic and manual prints). Defaults to enabled. */
export declare function isKotPrintingEnabled(): boolean;
/** Whether the tableside "server" role may print bills/order-slips. Defaults to disabled. */
export declare function isServerBillPrintingEnabled(): boolean;
export declare function upsertTelemetryLastPing(): void;
/** Atomic multi-statement mutation. Use for anything touching >1 row or >1 table. */
export declare function withTxn<T>(fn: () => T): T;
/** Safely append an object to a JSON-array column. Creates the array if missing/invalid. */
export declare function appendJsonArray(table: string, idColumn: string, idValue: any, column: string, value: any): void;
/**
 * Execute sequence repair queries directly inside SQLite.
 *
 * Coverage boundary: Reconstructs sequence counters for canonical daily order format
 * (`ORD-YYYYMMDD-NNNN`) and canonical daily bill format (`INV-YYYYMMDD-NNNN`).
 * Customized prefixes (e.g. `FAC-`, `BILL-`) or non-daily reset periods (`monthly`,
 * `financial_year`, `no_reset`) are not reconstructed from table scans; their counters
 * are managed dynamically in the sequences table.
 */
export declare function executeSequenceRepair(targetDb: Database.Database): {
    orderChanges: number;
    billChanges: number;
};
/**
 * Re-seeds sequences table from existing orders and bills to fix unique constraint collisions.
 *
 * Uses SQL-level aggregation to eliminate JavaScript array materialization of historical IDs.
 * Ordinary boots verify sequence health and skip the full scan unless flagged as pending.
 */
export declare function repairSequences(force?: boolean): {
    repaired: boolean;
    orderSequencesUpdated: number;
    billSequencesUpdated: number;
};
export declare function getDatabase(): Database.Database;
export declare function waitForDatabaseRequests(timeoutMs?: number): Promise<void>;
export declare function closeDatabase(): void;
type BackupOptions = {
    stagingDirectory?: string;
};
export declare function createBackupUnlocked(targetPath?: string, signal?: AbortSignal, options?: BackupOptions): Promise<{
    path: string;
    schemaVersion: number;
}>;
export declare function createBackup(targetPath?: string, signal?: AbortSignal, options?: BackupOptions): Promise<{
    path: string;
    schemaVersion: number;
}>;
/** Resets database while holding maintenance lock; recovers safety backup if reset fails. */
export declare function resetDatabaseWithBackup(signal?: AbortSignal): Promise<{
    backupPath: string;
    committed?: boolean;
    cleanupPending?: boolean;
}>;
export interface CurrencyResetImpact {
    currentCurrency: string;
    invoices: number;
    orders: number;
    refunds: number;
    customers: number;
    products: number;
    addons: number;
}
export declare function getCurrencyResetImpact(dbInstance?: Database.Database): CurrencyResetImpact;
export declare function resetDatabaseForCurrencyChange(targetCurrency: string, expectedCurrentCurrency: string, signal?: AbortSignal): Promise<{
    backupPath: string;
    committed?: boolean;
    cleanupPending?: boolean;
}>;
export type BackupMetadata = {
    schemaVersion: number | null;
    appVersion: string | null;
    backupCreatedAt: string | null;
};
/** Reads the canonical metadata stamp without changing local backup behavior. */
export declare function getBackupMetadata(backupPath: string): BackupMetadata;
export interface BackupInfo {
    fileName: string;
    path: string;
    sizeBytes: number;
    createdAt: string;
    kind: 'manual' | 'auto';
    schemaVersion: number | null;
}
export interface BackupPaginationOptions {
    limit?: number;
    cursor?: string;
}
export interface BackupPageResult {
    backups: BackupInfo[];
    nextCursor: string | null;
    hasMore: boolean;
}
export declare function encodeBackupCursor(createdAt: string, id: string): string;
export declare function decodeBackupCursor(rawCursor: string): {
    createdAt: string;
    id: string;
};
export declare function parseBackupPaginationQuery(rawLimit: unknown, rawCursor: unknown): BackupPaginationOptions;
/** Lists auto and manual backups in the managed backups directory, newest first. */
export declare function listBackupsPage(options?: BackupPaginationOptions): BackupPageResult;
export declare function listBackups(): BackupInfo[];
export declare function listBackups(options: BackupPaginationOptions): BackupPageResult;
/** Deletes a backup from the managed backups directory after validating filename format. */
export declare function deleteBackup(fileName: string): void;
/** Returns true if candidate path points to a valid file inside the managed backups directory. */
export declare function isManagedBackupFile(candidatePath: string): boolean;
export type DowngradeBackupKind = 'pre-upgrade' | 'pre-restore' | 'manual';
export interface CompatibleDowngradeBackup {
    fileName: string;
    path: string;
    sizeBytes: number;
    createdAt: string;
    backupCreatedAt: string | null;
    appVersion: string | null;
    schemaVersion: number;
    kind: DowngradeBackupKind;
}
export interface RejectedDowngradeBackup {
    fileName: string;
    path: string;
    reason: 'incompatible_newer' | 'corrupt_or_invalid';
    schemaVersion: number | null;
    appVersion: string | null;
    detail: string;
}
export interface DowngradeBackupDiscovery {
    backupDir: string;
    maxSupportedSchemaVersion: number;
    compatible: CompatibleDowngradeBackup[];
    incompatibleNewer: RejectedDowngradeBackup[];
    corruptOrInvalid: RejectedDowngradeBackup[];
}
export interface DowngradeRestoreOptions {
    newerDbVersion?: number;
    archivePath?: string;
    signal?: AbortSignal;
}
export interface DowngradeRestoreResult {
    restoredBackupPath: string;
    backupSchemaVersion: number;
    restoredSchemaVersion: number;
    preservedDbPath: string;
    preservedSidecarPaths: string[];
}
export declare function discoverDowngradeBackupsAsync(options?: {
    signal?: AbortSignal;
}): Promise<DowngradeBackupDiscovery>;
export declare function planNewerDatabaseArchivePath(newerDbVersion: number): string;
export declare function restoreCompatibleBackupForDowngrade(backupPath: string, options?: DowngradeRestoreOptions): Promise<DowngradeRestoreResult>;
export declare function getColumns(dbInstance: Database.Database, tableName: string): string[];
export declare function getTables(dbInstance: Database.Database): string[];
export declare function validateInventoryLedgerRows(productRows: readonly Record<string, unknown>[], movementRows: readonly Record<string, unknown>[], variantRows?: readonly Record<string, unknown>[], addonRows?: readonly Record<string, unknown>[]): string | null;
export declare function validateInventoryLedgerDatabase(dbInstance: Database.Database): string | null;
export declare function getInventoryMovementRows(dbInstance: Database.Database): Record<string, unknown>[];
export declare function validateInventoryLedgerReplacement(currentProductRows: readonly Record<string, unknown>[], currentMovementRows: readonly Record<string, unknown>[], replacementProductRows: readonly Record<string, unknown>[], replacementMovementRows: readonly Record<string, unknown>[]): string | null;
export interface RestoreResult {
    success: boolean;
    mode: 'direct' | 'data_only' | 'full';
    backupSchemaVersion: number;
    currentSchemaVersion: number;
    tablesRestored: number;
    committed?: boolean;
    cleanupPending?: boolean;
    ambiguous?: boolean;
    error?: string;
}
export type UserStationSecurityState = {
    user_id: string;
    station_id: string;
    is_active: number;
    category_ids: string | null;
};
export type KitchenStationSecurityState = {
    id: string;
    is_active: number;
    category_ids: string | null;
};
export declare function captureKitchenStationSecurityState(dbInstance: Database.Database): KitchenStationSecurityState[];
export type KdsEnabledSettingState = {
    present: boolean;
    value: string | null;
};
export type RestoreProtectedSettingState = {
    key: string;
    present: boolean;
    value: string | null;
};
export type RestoreOutboxState = {
    cloud: Record<string, unknown>[];
    support: Record<string, unknown>[];
    diagnostics: Record<string, unknown>[];
    diagnosticsAggregates?: Record<string, unknown>[];
    diagnosticsGaps?: Record<string, unknown>[];
    /** Device-local failure log; present on restores that predate it. */
    local?: Record<string, unknown>[];
};
export declare function captureRestoreProtectedSettings(dbInstance: Database.Database): RestoreProtectedSettingState[];
export declare function mergeRestoreProtectedSettings(dbInstance: Database.Database, states: RestoreProtectedSettingState[]): void;
export declare function captureRestoreOutboxState(dbInstance: Database.Database): RestoreOutboxState;
export declare function mergeRestoreOutboxState(dbInstance: Database.Database, state: RestoreOutboxState): void;
export declare function captureKdsEnabledSetting(dbInstance: Database.Database): KdsEnabledSettingState;
export declare function mergeKdsEnabledSetting(dbInstance: Database.Database, state: KdsEnabledSettingState): void;
export declare function captureUserStationSecurityState(dbInstance: Database.Database): UserStationSecurityState[];
export declare function mergeUserStationSecurityState(dbInstance: Database.Database, rows: UserStationSecurityState[], userIds: string[], preservedStations?: KitchenStationSecurityState[]): void;
export type UserSecurityState = {
    id: string;
    name: string;
    email: string | null;
    password: string;
    pin: string | null;
    pin_hash: string | null;
    role: string;
    category_ids: string | null;
    is_active: number;
    tokens_valid_after: string | null;
    station_assignments_configured: number;
};
export declare function getUserKdsStationIds(dbInstance: Database.Database, userId: string): string[] | null;
export declare function getKdsStationCategoryIds(dbInstance: Database.Database, stationIds: string[]): string[] | null;
export type KdsStationRoutingScope = {
    tablelessCategoryIds: string[];
    categoryIdsByStation: Record<string, string[] | null>;
    hasUnrestrictedStation: boolean;
};
export declare function getKdsStationRoutingScope(dbInstance: Database.Database, stationIds: string[], userCategoryIds: string[]): KdsStationRoutingScope | null;
export declare function getKdsStationRoutingCategoryIds(dbInstance: Database.Database, stationIds: string[], userCategoryIds: string[]): string[] | null;
export declare function isKdsStationItemAllowed(stationIds: string[], stationCategoryIds: string[], orderStationId: string | null | undefined, itemCategoryId: string | null | undefined, orderStationCategoryIds?: string[] | null, hasUnrestrictedStation?: boolean): boolean;
export declare function hasUserKdsStationAssignments(dbInstance: Database.Database, userId: string): boolean | null;
export declare function captureUserSecurityState(dbInstance: Database.Database): UserSecurityState[];
export declare function mergeUserSecurityState(dbInstance: Database.Database, rows: UserSecurityState[]): void;
export declare function restoreBackup(backupPath: string, forceDirect?: boolean, signal?: AbortSignal): RestoreResult;
/** Return stable keys for existing FK violations so legacy dirty data can be preserved without accepting new damage. */
export declare function getForeignKeyViolationKeys(dbInstance: Database.Database): Set<string>;
/** Return true only if the string is a safe SQL identifier (letters, digits, underscore). */
export declare function isSafeIdentifier(name: string): boolean;
export declare function getSchemaVersionFromBackup(backupPath: string): number | null;
export declare function getCurrentSchemaVersion(): number;
export declare function rebuildSearchIndex(targetDb?: Database.Database): void;
/** Builds in-memory database using migration pipeline as ideal schema reference. */
export declare function buildIdealSchemaDb(targetVersion?: number): Database.Database;
export declare const MIGRATIONS: {
    version: number;
    name: string;
    up: () => void;
}[];
export declare function backfillWhatsAppMessageAttempts(targetDb?: Database.Database, options?: {
    reset?: boolean;
}): void;
export declare function getLatestSupportedSchemaVersion(): number;
export declare class SchemaVersionMismatchError extends Error {
    readonly dbVersion: number;
    readonly appVersion: number;
    readonly dbAppVersion: string | null;
    constructor(dbVersion: number, appVersion: number, dbAppVersion?: string | null);
}
export declare function isSchemaVersionMismatchError(error: unknown): error is SchemaVersionMismatchError;
export declare function generateShortId(table: string, length?: number): string;
/**
 * Per-install lifetime Z counter used by the day-close (cierre de caja)
 * snapshot. Uses a single, non-date-bucketed `sequences` row with
 * `name='z_report', date='ALL'` so the counter stays outside the daily
 * sequences used by orders/bills and preserves conventional single-store
 * Z numbering.
 */
export declare function nextZNumber(): number;
/** YYYYMMDD for "now" in the given IANA timezone (falls back to UTC if the zone is invalid). */
export declare function dateStampInTimezone(timezone: string): string;
/** A series that restarts every day repeats its counter, so the date is what keeps each number unique. */
export declare function orderNumberIncludesDate(includeDate: boolean, resetDaily: boolean): boolean;
/** A series that restarts every period repeats its counter, so the period is what keeps each number unique. */
export declare function invoiceNumberIncludesPeriod(includePeriod: boolean, resetPeriod: string): boolean;
export declare function generateOrderNumber(): string;
export declare function generateBillNumber(): string;
export declare function now(): string;
/** Records who performed an order/item mutation (docs/reference/product-invariants.md). */
export declare function recordOrderAudit(db: ReturnType<typeof getDatabase>, params: {
    orderId: number | string;
    orderItemId?: number | string | null;
    actorUserId: string;
    action: string;
    details?: Record<string, unknown>;
}): void;
/** Records an authentication event (e.g. PIN sign-in success, failure, or rate-limit lockout). */
export declare function recordAuthAudit(dbInstance: ReturnType<typeof getDatabase>, params: {
    userId: string | null;
    eventType: string;
    outcome: 'success' | 'failure' | 'rate_limited';
    ipAddress?: string | null;
    details?: Record<string, unknown>;
}): void;
/** Parse DB timestamp into Date, ensuring space-delimited timestamps parse as UTC. */
export declare function parseDbTimestamp(ts: string | null | undefined): Date;
/** "Today" as a `YYYY-MM-DD` string in UTC for non-tenant uses. */
export declare function utcTodayDate(): string;
export { dayBoundsInTimezone, utcDayBounds };
/** Deprecated positional alias of `businessDateForInstant`, kept so the existing
 *  `localDateInTimezone(instant, timezone, startTime)` importers keep their exact
 *  signature for one release. A bare rename would have changed the argument order
 *  of a live export without any of those callers changing. */
export declare function localDateInTimezone(instant: Date, timezone: string, startTime?: string): string;
/** Verify a user PIN against the stored pin_hash. */
export declare function verifyPin(storedHash: string | null | undefined, inputPin: string | number): boolean;
/** Verify a user PIN against the stored pin_hash asynchronously without blocking the event loop. */
export declare function verifyPinAsync(storedHash: string | null | undefined, inputPin: string | number): Promise<boolean>;
export declare const KDS_VOIDED_ITEM_VISIBILITY_MS: number;
/** Determines whether a voided order item should still appear on KDS surfaces. */
export declare function isVoidedItemKdsVisible(voidedAt: string | null | undefined): boolean;
export declare const ACTIVE_RELEASED_KDS_ORDER_IDS_SQL = "\n  SELECT id FROM orders\n  WHERE release_status = 'released' AND status IN ('pending', 'preparing', 'ready', 'served')\n  UNION\n  SELECT active_o.id FROM orders active_o\n  JOIN order_items active_oi ON active_oi.order_id = active_o.id\n    AND active_oi.status NOT IN ('served', 'cancelled')\n  WHERE active_o.release_status = 'released'\n    AND active_o.status NOT IN ('pending', 'preparing', 'ready', 'served', 'cancelled')\n";
export declare const UNRELEASED_KDS_ORDER_ITEM_ERROR = "Scheduled order has not been released to the kitchen yet";
export declare function getKdsItemParentOrderState(dbInstance: ReturnType<typeof getDatabase>, orderId: number | string): 'released' | 'unreleased' | 'missing';
export declare function hasActiveUnservedOrderItems(dbInstance: ReturnType<typeof getDatabase>, orderId: number | string): boolean;
export declare function isOrderSettledAndNonRefunded(dbInstance: ReturnType<typeof getDatabase>, orderId: number | string): boolean;
export declare function completeSettledReleasedOrderIfServed(dbInstance: ReturnType<typeof getDatabase>, orderId: number | string, changedAt?: string): boolean;
/** Remove customer/payment/order-financial fields from category-scoped KDS payloads. */
export declare function projectKdsOrder(order: any, restricted: boolean): any;
/** Keep category-scoped KDS lines limited to kitchen-operational fields. */
export declare function projectKdsItem(item: any, restricted: boolean): any;
/** Avoid exposing printer/network credentials in restricted KDS station metadata. */
export declare function projectKdsStation(station: any, restricted: boolean, userCategoryIds?: string[]): any;
/** Snapshots an order item's selected addons into the order_item_addons table. */
export declare function insertOrderItemAddons(dbInstance: Database.Database, orderItemId: number | bigint, addons: {
    id?: string;
    name?: string;
    price?: number;
    quantity?: number;
    inventory_deducted_quantity?: number;
}[] | null | undefined, createdAt: string): void;
/** Parse JSON string fields on order_item rows returned from SQLite. */
export declare function parseItemJson(item: any): any;
/** Resolves selected addons and item audit metadata for a batch of order_items rows. */
export declare function attachEffectiveAddons<T extends {
    id: number;
}>(dbInstance: Database.Database, items: T[]): (T & {
    addons: {
        id: string | null;
        name: string;
        price: number;
        quantity: number;
    }[];
    edit_version: number;
    superseded?: boolean;
})[];
/** Parse JSON text columns on bill/order rows returned from SQLite. */
export declare function parseRowJson(row: any): any;
//# sourceMappingURL=db.d.ts.map