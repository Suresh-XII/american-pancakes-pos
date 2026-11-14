"use strict";
/** Daily automatic database backups kept outside the app's data folder. */
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
exports.localBackup = exports.LOCAL_BACKUP_RETENTION = exports.LOCAL_BACKUP_SETTING_KEY = void 0;
exports.getLocalBackupDir = getLocalBackupDir;
exports.isLocalBackupEnabled = isLocalBackupEnabled;
exports.setLocalBackupEnabled = setLocalBackupEnabled;
exports.localBackupFileName = localBackupFileName;
exports.parseLocalBackupTime = parseLocalBackupTime;
exports.listLocalBackups = listLocalBackups;
exports.getLastLocalBackupAt = getLastLocalBackupAt;
exports.isLocalBackupDue = isLocalBackupDue;
exports.pruneLocalBackups = pruneLocalBackups;
exports.retainBackupLocally = retainBackupLocally;
const electron_1 = require("electron");
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const db_1 = require("../db");
exports.LOCAL_BACKUP_SETTING_KEY = 'local_backup_enabled';
exports.LOCAL_BACKUP_RETENTION = 5;
const DAY_MS = 24 * 60 * 60_000;
const CHECK_INTERVAL_MS = 60 * 60_000;
const STARTUP_DELAY_MS = 2 * 60_000;
const BACKUP_FILE_PATTERN = /^flo-backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z\.db$/;
function getLocalBackupDir() {
    try {
        return path.join(electron_1.app.getPath('documents'), 'FloCafe', 'Backups');
    }
    catch {
        return path.join(electron_1.app.getPath('userData'), 'FloCafe', 'Backups');
    }
}
function isLocalBackupEnabled() {
    return (0, db_1.getSettingValue)(exports.LOCAL_BACKUP_SETTING_KEY) !== 'false';
}
function setLocalBackupEnabled(enabled) {
    (0, db_1.upsertSettings)({ [exports.LOCAL_BACKUP_SETTING_KEY]: enabled ? 'true' : 'false' });
    if (!enabled) {
        exports.localBackup.cancel();
    }
}
function localBackupFileName(at) {
    return `flo-backup-${at.toISOString().replace(/[:.]/g, '-')}.db`;
}
function parseLocalBackupTime(fileName) {
    const match = BACKUP_FILE_PATTERN.exec(fileName);
    if (!match)
        return null;
    const [, y, mo, d, h, mi, s, ms = '0'] = match;
    const time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms));
    return Number.isNaN(time) ? null : time;
}
let lastPublish = { wallMs: 0, stampMs: 0 };
function currentNowMs() {
    const now = Date.now();
    return now >= lastPublish.wallMs ? Math.max(now, lastPublish.stampMs) : now;
}
/**
 * Newest first. Files dated ahead of the clock sort last: their time cannot be trusted.
 * Only files this service wrote are ever listed.
 */
function listLocalBackups(dir = getLocalBackupDir(), nowMs = currentNowMs()) {
    try {
        return fs
            .readdirSync(dir)
            .map((name) => ({ name, time: parseLocalBackupTime(name) }))
            .filter((entry) => entry.time !== null)
            .sort((a, b) => Number(a.time > nowMs) - Number(b.time > nowMs) ||
            b.time - a.time ||
            b.name.localeCompare(a.name))
            .map((entry) => entry.name);
    }
    catch {
        return [];
    }
}
function getLastLocalBackupAt(dir) {
    const newest = listLocalBackups(dir)[0];
    return newest ? new Date(parseLocalBackupTime(newest)).toISOString() : null;
}
function isLocalBackupDue(newestFileName, nowMs = currentNowMs()) {
    if (!newestFileName)
        return true;
    const last = parseLocalBackupTime(newestFileName);
    return last === null || last > nowMs || nowMs - last >= DAY_MS;
}
/** Keeps the newest backups by listing order; `justWritten` is always kept. */
function pruneLocalBackups(dir, keep = exports.LOCAL_BACKUP_RETENTION, justWritten) {
    const listed = listLocalBackups(dir);
    const ranked = justWritten && listed.includes(justWritten)
        ? [justWritten, ...listed.filter((name) => name !== justWritten)]
        : listed;
    const removed = [];
    for (const name of ranked.slice(keep)) {
        try {
            fs.unlinkSync(path.join(dir, name));
            removed.push(name);
        }
        catch (error) {
            console.warn(`[LocalBackup] Could not remove old backup ${name}:`, error);
        }
    }
    return removed;
}
function removeQuietly(filePath) {
    try {
        fs.unlinkSync(filePath);
    }
    catch {
        // Ignore cleanup failure
    }
}
function stagingPath(dir) {
    return path.join(dir, `.flo-backup-${(0, node_crypto_1.randomUUID)()}.tmp`);
}
/** Links a staged file in under the first free backup name; never replaces an existing file. */
function publishBackup(stagedPath, dir) {
    const wallMs = Date.now();
    const startStamp = wallMs >= lastPublish.wallMs ? Math.max(wallMs, lastPublish.stampMs) : wallMs;
    for (let stamp = startStamp;; stamp++) {
        const name = localBackupFileName(new Date(stamp));
        try {
            fs.linkSync(stagedPath, path.join(dir, name));
        }
        catch (error) {
            if (error.code === 'EEXIST')
                continue;
            throw error;
        }
        lastPublish = { wallMs, stampMs: stamp };
        removeQuietly(stagedPath);
        return name;
    }
}
/** Copies a finished backup into the local backup folder and applies retention. Best effort. */
function retainBackupLocally(sourcePath) {
    if (!isLocalBackupEnabled())
        return null;
    let tempTarget = null;
    try {
        const dir = getLocalBackupDir();
        fs.mkdirSync(dir, { recursive: true });
        tempTarget = stagingPath(dir);
        fs.copyFileSync(sourcePath, tempTarget);
        const name = publishBackup(tempTarget, dir);
        tempTarget = null;
        pruneLocalBackups(dir, exports.LOCAL_BACKUP_RETENTION, name);
        return path.join(dir, name);
    }
    catch (error) {
        if (tempTarget)
            removeQuietly(tempTarget);
        console.warn('[LocalBackup] Could not keep a copy of the backup:', error);
        return null;
    }
}
/** A never-used database is not worth a slot: it would push real backups out of retention. */
function hasBusinessData() {
    const db = (0, db_1.getDatabase)();
    return ['orders', 'products', 'customers'].some((table) => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() !== undefined);
}
class LocalBackupService {
    timer = null;
    startupTimer = null;
    running = null;
    abortController = null;
    stopping = false;
    start() {
        this.stopping = false;
        if (this.timer)
            return;
        this.timer = setInterval(() => void this.runIfDue(), CHECK_INTERVAL_MS);
        this.timer.unref?.();
        this.startupTimer = setTimeout(() => void this.runIfDue(), STARTUP_DELAY_MS);
        this.startupTimer.unref?.();
    }
    async stop() {
        this.stopping = true;
        if (this.timer)
            clearInterval(this.timer);
        if (this.startupTimer)
            clearTimeout(this.startupTimer);
        this.timer = null;
        this.startupTimer = null;
        this.abortController?.abort();
        await this.running?.catch(() => { });
    }
    cancel() {
        this.abortController?.abort();
    }
    runIfDue() {
        if (this.running || this.stopping)
            return this.running ?? Promise.resolve();
        this.running = this.backupIfDue()
            .catch((error) => console.warn('[LocalBackup] Backup skipped:', error))
            .finally(() => {
            this.running = null;
            this.abortController = null;
        });
        return this.running;
    }
    async backupIfDue() {
        if (!isLocalBackupEnabled())
            return;
        const dir = getLocalBackupDir();
        if (!isLocalBackupDue(listLocalBackups(dir)[0]))
            return;
        if (!hasBusinessData())
            return;
        fs.mkdirSync(dir, { recursive: true });
        this.abortController = new AbortController();
        const staged = stagingPath(dir);
        let name;
        try {
            await (0, db_1.createBackup)(staged, this.abortController.signal);
            if (this.stopping || this.abortController?.signal.aborted || !isLocalBackupEnabled()) {
                removeQuietly(staged);
                return;
            }
            name = publishBackup(staged, dir);
        }
        catch (error) {
            removeQuietly(staged);
            throw error;
        }
        pruneLocalBackups(dir, exports.LOCAL_BACKUP_RETENTION, name);
    }
}
exports.localBackup = new LocalBackupService();
//# sourceMappingURL=local-backup.js.map