"use strict";
/** Optional Google Drive integration for offline-first, off-device DB backups. */
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
exports.googleDrive = exports.MAX_QR_MENU_PDF_BYTES = exports.DRIVE_WARNING_SETTING = exports.DRIVE_RESTORE_CONFIRMATION = exports.DRIVE_BACKUP_FOLDER_NAME = exports.DRIVE_FILE_SCOPE = void 0;
exports.setQrMenuDriveClientFactoryForTests = setQrMenuDriveClientFactoryForTests;
exports.getGoogleDriveErrorCode = getGoogleDriveErrorCode;
exports.isGoogleDriveConfigured = isGoogleDriveConfigured;
exports.isBackupDue = isBackupDue;
exports.createPkcePair = createPkcePair;
const electron_1 = require("electron");
const http = __importStar(require("node:http"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const node_stream_1 = require("node:stream");
const node_events_1 = require("node:events");
const drive_1 = require("@googleapis/drive");
const qrcode_1 = __importDefault(require("qrcode"));
const url_allowlist_1 = require("../security/url-allowlist");
const db_1 = require("../db");
const shutdown_1 = require("../shutdown");
const offline_mode_1 = require("./offline-mode");
const security_1 = require("../middleware/security");
const jwt_secret_1 = require("../security/jwt-secret");
let qrMenuDriveClientFactory = (auth) => (0, drive_1.drive)({ version: 'v3', auth });
function setQrMenuDriveClientFactoryForTests(factory) {
    qrMenuDriveClientFactory = factory || ((auth) => (0, drive_1.drive)({ version: 'v3', auth }));
}
exports.DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
exports.DRIVE_BACKUP_FOLDER_NAME = 'FloCafe Backups';
exports.DRIVE_RESTORE_CONFIRMATION = 'RESTORE GOOGLE DRIVE BACKUP';
exports.DRIVE_WARNING_SETTING = 'google_drive_warning_acknowledged';
const DEFAULT_RETENTION = 7;
const MIN_RETENTION = 1;
const MAX_RETENTION = 100;
const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 60_000;
const LOOPBACK_TIMEOUT_MS = 5 * 60_000;
const DRIVE_REQUEST_TIMEOUT_MS = 30_000;
const GOOGLE_DRIVE_SNAPSHOT_TIMEOUT_MS = 30 * 60_000;
const STAGING_CLEANUP_RETRY_MS = 50;
const BACKUP_RETRY_BASE_MS = 5 * 60_000;
const BACKUP_RETRY_MAX_MS = 60 * 60_000;
const RESTORE_RECOVERY_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const RETENTION_RETRY_BASE_MS = 5 * 60_000;
const RETENTION_RETRY_MAX_MS = 60 * 60_000;
const TOKEN_ENVELOPE_VERSION = 2;
const MARKER_VERSION = '1';
exports.MAX_QR_MENU_PDF_BYTES = 15 * 1024 * 1024;
function requestSignal(signal, timeoutMs) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
function createDriveShutdownError(label, timedOut = false) {
    const error = new Error(`${label} ${timedOut ? 'timed out' : 'cancelled'} during shutdown`);
    error.code = timedOut ? 'ERR_SHUTDOWN_TIMEOUT' : 'ERR_SHUTDOWN_ABORTED';
    return error;
}
function isExpectedShutdownCancellation(error) {
    if (error instanceof AggregateError) {
        return (error.errors.length > 0 &&
            error.errors.every((nested) => isExpectedShutdownCancellation(nested)));
    }
    const candidate = error;
    return (candidate?.code === 'ERR_SHUTDOWN_ABORTED' ||
        candidate?.code === 'ABORT_ERR' ||
        candidate?.name === 'AbortError');
}
function cancelDriveOperation(operation) {
    const cancellable = operation;
    try {
        if (typeof cancellable.cancel === 'function')
            cancellable.cancel();
        else if (typeof cancellable.abort === 'function')
            cancellable.abort();
    }
    catch { }
}
function waitForDriveOperation(operationFactory, signal, timeoutMs, label, trackOperation, joinOnCancellation = () => false, cancellationTimeoutMs = timeoutMs) {
    if (signal?.aborted)
        return Promise.reject(createDriveShutdownError(label));
    const operationController = new AbortController();
    const operationSignal = signal
        ? AbortSignal.any([signal, operationController.signal])
        : operationController.signal;
    let operation;
    try {
        operation = operationFactory(operationSignal);
    }
    catch (error) {
        return Promise.reject(error);
    }
    trackOperation?.(operation);
    let timeout;
    let cancellationTimeout;
    let onAbort;
    let operationSettled = false;
    let cancellationStarted = false;
    void operation.then(() => {
        operationSettled = true;
    }, () => {
        operationSettled = true;
    });
    void operation.catch(() => { });
    const cancellation = new Promise((_resolve, reject) => {
        const rejectAfterOperation = (error) => {
            if (cancellationStarted || operationSettled)
                return;
            cancellationStarted = true;
            operationController.abort();
            cancelDriveOperation(operation);
            if (!joinOnCancellation()) {
                reject(error);
                return;
            }
            const settleCancellation = () => {
                if (cancellationTimeout)
                    clearTimeout(cancellationTimeout);
                reject(error);
            };
            cancellationTimeout = setTimeout(settleCancellation, cancellationTimeoutMs);
            void operation.then(settleCancellation, settleCancellation);
        };
        onAbort = () => rejectAfterOperation(createDriveShutdownError(label));
        if (signal?.aborted) {
            onAbort();
            return;
        }
        if (signal)
            signal.addEventListener('abort', onAbort, { once: true });
        timeout = setTimeout(() => rejectAfterOperation(createDriveShutdownError(label, true)), timeoutMs);
    });
    return Promise.race([operation, cancellation]).finally(() => {
        if (timeout)
            clearTimeout(timeout);
        if (cancellationTimeout)
            clearTimeout(cancellationTimeout);
        if (signal && onAbort)
            signal.removeEventListener('abort', onAbort);
    });
}
const SAFE_ERROR_MESSAGES = {
    configuration_unavailable: 'configuration_unavailable',
    secure_storage_unavailable: 'secure_storage_unavailable',
    not_connected: 'not_connected',
    reauth_required: 'reauth_required',
    warning_acknowledgement_required: 'warning_acknowledgement_required',
    destination_required: 'destination_required',
    destination_invalid: 'destination_invalid',
    permission_denied: 'permission_denied',
    offline: 'offline',
    rate_limited: 'rate_limited',
    quota_exceeded: 'quota_exceeded',
    local_snapshot_failed: 'local_snapshot_failed',
    local_file_missing: 'local_file_missing',
    upload_failed: 'upload_failed',
    duplicate_upload: 'duplicate_upload',
    preferences_invalid: 'preferences_invalid',
    restore_validation_failed: 'restore_validation_failed',
    restore_failed: 'restore_failed',
    retention_pending: 'retention_pending',
    conflict: 'conflict',
    cancelled: 'cancelled',
    menu_pdf_invalid: 'menu_pdf_invalid',
    menu_pdf_too_large: 'menu_pdf_too_large',
    menu_not_published: 'menu_not_published',
    menu_file_invalid: 'menu_file_invalid',
    unknown: 'unknown',
};
function createDriveError(code, retryable = false) {
    const error = new Error(SAFE_ERROR_MESSAGES[code]);
    error.code = code;
    error.retryable = retryable;
    return error;
}
function providerStatus(error) {
    const candidate = error;
    const status = candidate?.response?.status ?? candidate?.status;
    return typeof status === 'number' && Number.isInteger(status) ? status : null;
}
function isMissingDestinationError(error) {
    const candidate = error;
    return candidate?.destination_missing === true || providerStatus(error) === 404;
}
function nextBackupRetryAt(attemptCount) {
    const attempt = Number.isSafeInteger(attemptCount) && attemptCount > 0 ? attemptCount : 1;
    return new Date(Date.now() + Math.min(BACKUP_RETRY_MAX_MS, BACKUP_RETRY_BASE_MS * attempt)).toISOString();
}
function getGoogleDriveErrorCode(error) {
    const candidate = error;
    if (candidate?.code &&
        typeof candidate.code === 'string' &&
        candidate.code in SAFE_ERROR_MESSAGES)
        return candidate.code;
    if (candidate?.code === 'ERR_SHUTDOWN_ABORTED' || candidate?.name === 'AbortError')
        return 'cancelled';
    if (candidate?.code === 'ECONNRESET' ||
        candidate?.code === 'ETIMEDOUT' ||
        candidate?.code === 'EAI_AGAIN' ||
        candidate?.code === 'ENETUNREACH' ||
        candidate?.code === 'ENOTFOUND')
        return 'offline';
    const status = providerStatus(error);
    if (status === 401)
        return 'reauth_required';
    if (status === 429)
        return 'rate_limited';
    if (status === 507)
        return 'quota_exceeded';
    const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';
    const responseData = error?.response?.data;
    let providerMessage = '';
    try {
        providerMessage = JSON.stringify(responseData ?? '').toLowerCase();
    }
    catch { }
    if (message.includes('invalid_grant') || message.includes('revoked'))
        return 'reauth_required';
    if (message.includes('quota') ||
        message.includes('storage') ||
        providerMessage.includes('quota') ||
        providerMessage.includes('storage') ||
        providerMessage.includes('dailylimit') ||
        providerMessage.includes('ratelimit'))
        return 'quota_exceeded';
    if (status === 403)
        return 'permission_denied';
    if (message.includes('timeout') ||
        message.includes('econn') ||
        message.includes('enotfound') ||
        message.includes('network'))
        return 'offline';
    return 'unknown';
}
function classifyDriveError(error) {
    if (isExpectedShutdownCancellation(error))
        return createDriveError('cancelled');
    const status = providerStatus(error);
    const code = getGoogleDriveErrorCode(error);
    const retryable = error?.retryable === true ||
        code === 'offline' ||
        code === 'rate_limited' ||
        (status !== null && [408, 500, 502, 503, 504].includes(status));
    return createDriveError(code, retryable);
}
function getTokenFilePath() {
    return path.join(electron_1.app.getPath('userData'), 'google-drive-token.enc');
}
function getInstallationMarkerPath() {
    return path.join(electron_1.app.getPath('userData'), 'google-drive-installation.marker');
}
function getStagingDir() {
    return path.join(electron_1.app.getPath('userData'), 'google-drive-staging');
}
function getRestoreInvalidationIntentPath() {
    return path.join(electron_1.app.getPath('userData'), 'google-drive-restore.pending');
}
function getRestoreJobResultPath() {
    return path.join(electron_1.app.getPath('userData'), 'google-drive-restore-result.json');
}
function syncRestoreIntentDirectory(directoryPath) {
    try {
        const fd = fs.openSync(directoryPath, 'r');
        try {
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        return true;
    }
    catch {
        return false;
    }
}
function syncTokenFile(filePath) {
    const fd = fs.openSync(filePath, 'r+');
    try {
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
}
function persistRestoreJobResult(job) {
    const resultPath = getRestoreJobResultPath();
    const tempPath = `${resultPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    let fd = null;
    try {
        fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        fs.writeFileSync(fd, JSON.stringify(job), 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(tempPath, resultPath);
        if (!syncRestoreIntentDirectory(path.dirname(resultPath)) && process.platform !== 'win32')
            throw new Error('Could not durably record restore job result');
    }
    catch (error) {
        if (fd !== null)
            try {
                fs.closeSync(fd);
            }
            catch { }
        try {
            if (fs.existsSync(tempPath))
                fs.unlinkSync(tempPath);
        }
        catch { }
        throw error;
    }
}
function readRestoreJobResult() {
    try {
        return parseJob(fs.readFileSync(getRestoreJobResultPath(), 'utf8'));
    }
    catch {
        return null;
    }
}
function clearRestoreJobResult() {
    try {
        if (fs.existsSync(getRestoreJobResultPath()))
            fs.unlinkSync(getRestoreJobResultPath());
    }
    catch { }
}
function readCommittedRestoreJobResult() {
    if (!fs.existsSync(getRestoreInvalidationIntentPath()))
        return null;
    const replacement = (0, db_1.getDatabaseReplacementJournal)();
    if (replacement?.phase !== 'committed')
        return null;
    try {
        const intent = parseJson(fs.readFileSync(getRestoreInvalidationIntentPath(), 'utf8'));
        const jobId = intent?.job_id;
        if (!safeId(jobId))
            return null;
        return {
            id: jobId,
            operation: 'restore',
            state: 'succeeded',
            updated_at: new Date().toISOString(),
        };
    }
    catch {
        return null;
    }
}
function getClientCredentials() {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
    if (clientId || clientSecret) {
        if (!clientId || !clientSecret)
            return null;
        return { clientId, clientSecret };
    }
    if (process.env.ELECTRON_RUN_AS_NODE !== '1') {
        try {
            const configPath = path.join(__dirname, '../../google-drive-client.json');
            if (fs.existsSync(configPath)) {
                const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (parsed.clientId?.trim() && parsed.clientSecret?.trim()) {
                    return { clientId: parsed.clientId.trim(), clientSecret: parsed.clientSecret.trim() };
                }
            }
        }
        catch {
            // Fall through to null on read or parse error
        }
    }
    return null;
}
function isGoogleDriveConfigured() {
    return getClientCredentials() !== null;
}
function isSecureStorageAvailable() {
    try {
        if (!electron_1.safeStorage.isEncryptionAvailable())
            return false;
        const backend = typeof electron_1.safeStorage.getSelectedStorageBackend === 'function'
            ? electron_1.safeStorage.getSelectedStorageBackend()
            : null;
        return !backend || !['basic_text', ''].includes(backend);
    }
    catch {
        return false;
    }
}
function isBackupDue(lastBackupAtIso, frequency, nowMs = Date.now()) {
    if (!lastBackupAtIso)
        return true;
    const last = new Date(lastBackupAtIso).getTime();
    if (Number.isNaN(last))
        return true;
    return nowMs - last >= (frequency === 'weekly' ? WEEK_MS : DAY_MS);
}
function createPkcePair() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}
function isSafeGoogleAuthorizationUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return ((0, url_allowlist_1.isSafeExternalUrl)(rawUrl) &&
            parsed.protocol === 'https:' &&
            parsed.hostname === 'accounts.google.com' &&
            parsed.pathname === '/o/oauth2/v2/auth' &&
            !parsed.username &&
            !parsed.password &&
            !parsed.port);
    }
    catch {
        return false;
    }
}
function compareAppVersions(left, right) {
    const parse = (value) => {
        const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim());
        return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
    };
    const a = parse(left);
    const b = parse(right);
    if (!a || !b)
        return left === right ? 0 : null;
    for (let index = 0; index < a.length; index += 1)
        if (a[index] !== b[index])
            return a[index] > b[index] ? 1 : -1;
    return 0;
}
function safeId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
function parseJson(value) {
    if (!value)
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function parseJob(value) {
    const parsed = parseJson(value);
    return parsed &&
        typeof parsed.id === 'string' &&
        typeof parsed.operation === 'string' &&
        typeof parsed.state === 'string'
        ? parsed
        : null;
}
function parsePending(value) {
    const parsed = parseJson(value);
    if (!parsed ||
        !safeId(parsed.run_id) ||
        !['automatic', 'manual'].includes(parsed.kind) ||
        typeof parsed.local_path !== 'string' ||
        !/^[a-f0-9]{64}$/.test(parsed.sha256) ||
        !Number.isSafeInteger(parsed.byte_count) ||
        (parsed.destination_folder_id !== '' && !safeId(parsed.destination_folder_id)))
        return null;
    return parsed;
}
function isDriveStagingFile(filePath, prefix) {
    if (typeof filePath !== 'string')
        return false;
    const fileName = path.basename(filePath);
    if (!fileName.startsWith(`${prefix}-`) || !fileName.endsWith('.db'))
        return false;
    try {
        const resolved = fs.realpathSync(filePath);
        const stagingDir = fs.realpathSync(getStagingDir());
        const stat = fs.lstatSync(filePath);
        return stat.isFile() && !stat.isSymbolicLink() && resolved.startsWith(stagingDir + path.sep);
    }
    catch {
        return false;
    }
}
function isUploadStagingFile(filePath) {
    return isDriveStagingFile(filePath, 'upload');
}
function isDownloadStagingFile(filePath) {
    return isDriveStagingFile(filePath, 'download');
}
function createUploadStagingPath() {
    fs.mkdirSync(getStagingDir(), { recursive: true, mode: 0o700 });
    return path.join(getStagingDir(), `upload-${crypto.randomUUID()}.db`);
}
function removeStagingFile(filePath) {
    if (!isUploadStagingFile(filePath) && !isDownloadStagingFile(filePath))
        return;
    for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
        try {
            if (fs.existsSync(candidate))
                fs.unlinkSync(candidate);
        }
        catch { }
    }
}
async function removeDownloadStagingFileWithRetry(filePath) {
    if (!isDownloadStagingFile(filePath))
        return;
    const candidates = [filePath, `${filePath}-wal`, `${filePath}-shm`];
    const deadline = Date.now() + shutdown_1.SHUTDOWN_TIMEOUT_MS;
    while (true) {
        for (const candidate of candidates) {
            try {
                if (fs.existsSync(candidate))
                    fs.unlinkSync(candidate);
            }
            catch { }
        }
        if (!candidates.some((candidate) => fs.existsSync(candidate)) || Date.now() >= deadline)
            return;
        await new Promise((resolve) => setTimeout(resolve, STAGING_CLEANUP_RETRY_MS));
    }
}
async function hashBackupFile(filePath) {
    if (!(0, db_1.isManagedBackupFile)(filePath) && !isUploadStagingFile(filePath))
        throw createDriveError('local_file_missing');
    const entry = fs.lstatSync(filePath);
    if (entry.isSymbolicLink() ||
        !entry.isFile() ||
        fs.existsSync(`${filePath}-wal`) ||
        fs.existsSync(`${filePath}-shm`))
        throw createDriveError('local_file_missing');
    const initial = fs.statSync(filePath);
    const hash = crypto.createHash('sha256');
    let byteCount = 0;
    const stream = fs.createReadStream(filePath, { flags: 'r' });
    try {
        for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            byteCount += buffer.byteLength;
            hash.update(buffer);
        }
    }
    finally {
        stream.destroy();
    }
    const final = fs.statSync(filePath);
    if (initial.size !== final.size || initial.mtimeMs !== final.mtimeMs || byteCount !== final.size)
        throw createDriveError('local_file_missing');
    return { sha256: hash.digest('hex'), byteCount };
}
class GoogleDriveService {
    scheduleTimer = null;
    startupTimer = null;
    backingUp = false;
    backupPromise = null;
    backupAbortController = null;
    stopping = false;
    stopPromise = null;
    stopSettled = true;
    terminalCleanup = false;
    operationRunning = false;
    operationTail = Promise.resolve();
    queuedOperationControllers = new Set();
    activeDriveOperations = new Set();
    activeJobs = new Set();
    jobControllers = new Map();
    shutdownController = new AbortController();
    databaseRestorePending = false;
    databaseRestoreInProcess = false;
    restoreInvalidationCleanupPending = false;
    restoreRecoveryRetryTimer = null;
    restoreRecoveryRetryCount = 0;
    tokenReadIssue = null;
    restoreInvalidationIntentExists() {
        try {
            return fs.existsSync(getRestoreInvalidationIntentPath());
        }
        catch {
            return true;
        }
    }
    persistRestoreInvalidationIntent(jobId) {
        const intentPath = getRestoreInvalidationIntentPath();
        const tempPath = `${intentPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
        const baseline = this.databaseAccountSubject();
        const intent = {
            phase: 'prepared',
            ...(jobId ? { job_id: jobId } : {}),
            ...(baseline.known ? { database_account_subject: baseline.value } : {}),
        };
        let fd = null;
        try {
            fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
            fs.writeFileSync(fd, JSON.stringify(intent), 'utf8');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = null;
            fs.renameSync(tempPath, intentPath);
            if (!syncRestoreIntentDirectory(path.dirname(intentPath)) && process.platform !== 'win32')
                throw new Error('Could not durably record restore invalidation intent');
        }
        catch (error) {
            if (fd !== null)
                try {
                    fs.closeSync(fd);
                }
                catch { }
            try {
                if (fs.existsSync(tempPath))
                    fs.unlinkSync(tempPath);
            }
            catch { }
            throw error;
        }
    }
    clearRestoreInvalidationIntent() {
        const intentPath = getRestoreInvalidationIntentPath();
        try {
            if (fs.existsSync(intentPath))
                fs.unlinkSync(intentPath);
            if (!syncRestoreIntentDirectory(path.dirname(intentPath)) && process.platform !== 'win32')
                throw new Error('Could not durably clear restore invalidation intent');
        }
        catch (error) {
            this.restoreInvalidationCleanupPending = true;
            this.scheduleRestoreRecoveryRetry();
            throw error;
        }
        this.restoreInvalidationCleanupPending = false;
        if (this.restoreRecoveryRetryTimer)
            clearTimeout(this.restoreRecoveryRetryTimer);
        this.restoreRecoveryRetryTimer = null;
        this.restoreRecoveryRetryCount = 0;
    }
    restoreInvalidationActive() {
        if (this.databaseRestorePending || this.restoreInvalidationCleanupPending)
            return true;
        if (!this.restoreInvalidationIntentExists())
            return false;
        this.databaseRestorePending = true;
        return true;
    }
    scheduleRestoreRecoveryRetry() {
        if (this.restoreRecoveryRetryTimer ||
            this.restoreRecoveryRetryCount >= RESTORE_RECOVERY_RETRY_DELAYS_MS.length ||
            this.stopping)
            return;
        const delay = RESTORE_RECOVERY_RETRY_DELAYS_MS[this.restoreRecoveryRetryCount++];
        this.restoreRecoveryRetryTimer = setTimeout(() => {
            this.restoreRecoveryRetryTimer = null;
            this.recoverDatabaseRestoreInvalidation();
            if (this.restoreInvalidationActive())
                this.scheduleRestoreRecoveryRetry();
            else
                this.start();
        }, delay);
        this.restoreRecoveryRetryTimer.unref?.();
    }
    databaseRestoreRecoveryDecision() {
        if (this.tokenReadIssue === 'persistence_ambiguous')
            return 'ambiguous';
        let tokenFilePresent = false;
        try {
            tokenFilePresent = fs.existsSync(getTokenFilePath());
        }
        catch {
            return 'ambiguous';
        }
        const envelope = this.readTokenEnvelope();
        if (!tokenFilePresent)
            return 'recovered';
        if (this.tokenReadIssue === 'corrupt' || !envelope)
            return 'ambiguous';
        const tokenState = envelope.account_subject && envelope.installation_id ? 'bound' : 'legacy';
        const current = this.databaseAccountSubject();
        if (!current.known)
            return 'ambiguous';
        const intent = this.restoreInvalidationIntent();
        if (intent.known) {
            if (intent.value === null)
                return 'ambiguous';
            return current.value === intent.value ? 'recovered' : 'committed';
        }
        if (tokenState === 'legacy')
            return current.value ? 'recovered' : 'ambiguous';
        return current.value === envelope.account_subject ? 'recovered' : 'ambiguous';
    }
    databaseAccountSubject() {
        try {
            const row = (0, db_1.getDatabase)()
                .prepare("SELECT value FROM settings WHERE key = 'google_drive_account_subject'")
                .get();
            return {
                known: true,
                value: typeof row?.value === 'string' && row.value.trim() ? row.value : null,
            };
        }
        catch {
            return { known: false, value: null };
        }
    }
    restoreInvalidationIntent() {
        try {
            const parsed = parseJson(fs.readFileSync(getRestoreInvalidationIntentPath(), 'utf8'));
            if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'database_account_subject'))
                return { known: false, value: null };
            if (parsed.database_account_subject !== null &&
                typeof parsed.database_account_subject !== 'string')
                return { known: false, value: null };
            return { known: true, value: parsed.database_account_subject };
        }
        catch {
            return { known: false, value: null };
        }
    }
    activateDatabaseRestoreInvalidation(jobId) {
        this.databaseRestorePending = true;
        this.restoreInvalidationCleanupPending = false;
        try {
            this.persistRestoreInvalidationIntent(jobId);
        }
        catch (error) {
            if (!this.restoreInvalidationIntentExists())
                this.databaseRestorePending = false;
            else {
                this.restoreInvalidationCleanupPending = true;
                this.scheduleRestoreRecoveryRetry();
            }
            throw error;
        }
    }
    recoverDatabaseRestoreInvalidation() {
        const replacement = (0, db_1.getDatabaseReplacementJournal)();
        const intentExists = this.restoreInvalidationIntentExists();
        if (!intentExists &&
            replacement?.phase !== 'committed' &&
            !this.restoreInvalidationCleanupPending)
            return;
        this.databaseRestorePending = true;
        try {
            if (replacement?.phase === 'committed') {
                this.invalidateAfterDatabaseRestore(replacement);
                return;
            }
            const decision = this.databaseRestoreRecoveryDecision();
            if (decision === 'committed')
                this.invalidateAfterDatabaseRestore(null);
            else if (decision === 'recovered')
                this.clearDatabaseRestoreInvalidation();
            else {
                this.restoreInvalidationCleanupPending = true;
                this.scheduleRestoreRecoveryRetry();
            }
        }
        catch (error) {
            console.error('[Google Drive] Restore invalidation recovery failed:', error);
            this.restoreInvalidationCleanupPending = true;
            this.scheduleRestoreRecoveryRetry();
        }
    }
    reconcilePersistedJob() {
        const settings = this.readSettings();
        const job = parseJob(settings.google_drive_job);
        if (!job ||
            !['queued', 'snapshot_created', 'uploading', 'retention_pending', 'restoring'].includes(job.state))
            return;
        if (job.operation === 'backup') {
            const pending = parsePending(settings.google_drive_pending_upload);
            const paused = [
                'destination_required',
                'destination_invalid',
                'reauth_required',
                'permission_denied',
                'duplicate_upload',
            ].includes(settings.google_drive_last_error_code);
            if (job.state === 'retention_pending') {
                if (settings.google_drive_retention_status !== 'pending')
                    (0, db_1.upsertSettings)({
                        google_drive_retention_status: 'pending',
                        google_drive_next_retry_at: '',
                        google_drive_last_error_code: 'retention_pending',
                    });
                return;
            }
            if (pending) {
                const storedRetryAt = pending.next_retry_at || settings.google_drive_next_retry_at || '';
                const retryAt = paused
                    ? null
                    : Number.isFinite(Date.parse(storedRetryAt))
                        ? storedRetryAt
                        : nextBackupRetryAt(pending.attempt_count || 1);
                pending.next_retry_at = retryAt;
                (0, db_1.upsertSettings)({
                    google_drive_pending_upload: JSON.stringify(pending),
                    google_drive_next_retry_at: retryAt || '',
                });
                this.writeJob({
                    ...job,
                    state: paused ? 'failed' : 'offline_pending',
                    error_code: paused
                        ? settings.google_drive_last_error_code
                        : 'unknown',
                    updated_at: (0, db_1.now)(),
                });
            }
            else {
                this.writeJob({ ...job, state: 'failed', error_code: 'unknown', updated_at: (0, db_1.now)() });
            }
            return;
        }
        const completedRestore = readRestoreJobResult() || readCommittedRestoreJobResult();
        this.writeJob(completedRestore?.id === job.id
            ? completedRestore
            : { ...job, state: 'failed', error_code: 'restore_failed', updated_at: (0, db_1.now)() });
    }
    armScheduling() {
        if (this.scheduleTimer || this.stopping || this.terminalCleanup || !this.stopSettled)
            return;
        this.scheduleTimer = setInterval(() => {
            void this.maybeRunScheduled().catch(() => { });
        }, SCHEDULE_CHECK_INTERVAL_MS);
        this.scheduleTimer.unref?.();
        this.cleanupStaging();
        this.startupTimer = setTimeout(() => {
            this.startupTimer = null;
            void this.maybeRunScheduled().catch(() => { });
        }, 0);
        this.startupTimer.unref?.();
    }
    start() {
        if (this.terminalCleanup || !this.stopSettled)
            return;
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
            this.scheduleTimer = null;
        }
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
        if (this.restoreRecoveryRetryTimer)
            clearTimeout(this.restoreRecoveryRetryTimer);
        this.restoreRecoveryRetryTimer = null;
        this.stopping = false;
        this.stopPromise = null;
        this.shutdownController = new AbortController();
        this.reconcilePersistedJob();
        this.recoverDatabaseRestoreInvalidation();
        if (this.restoreInvalidationActive())
            return;
        this.armScheduling();
    }
    stop() {
        if (this.stopPromise)
            return this.stopPromise;
        this.stopping = true;
        this.stopSettled = false;
        this.shutdownController.abort();
        this.backupAbortController?.abort();
        this.abortQueuedDriveOperations();
        for (const controller of this.jobControllers.values())
            controller.abort();
        if (this.scheduleTimer)
            clearInterval(this.scheduleTimer);
        if (this.startupTimer)
            clearTimeout(this.startupTimer);
        if (this.restoreRecoveryRetryTimer)
            clearTimeout(this.restoreRecoveryRetryTimer);
        this.restoreRecoveryRetryTimer = null;
        this.scheduleTimer = null;
        this.startupTimer = null;
        if (!this.backupPromise &&
            this.queuedOperationControllers.size === 0 &&
            this.activeDriveOperations.size === 0 &&
            this.activeJobs.size === 0) {
            this.stopSettled = true;
            this.stopPromise = Promise.resolve();
            return this.stopPromise;
        }
        const waitForWork = async () => {
            const errors = [];
            while (this.backupPromise ||
                this.queuedOperationControllers.size > 0 ||
                this.activeDriveOperations.size > 0 ||
                this.activeJobs.size > 0) {
                const work = [...this.activeDriveOperations, ...this.activeJobs];
                if (this.backupPromise)
                    work.push(this.backupPromise);
                if (this.queuedOperationControllers.size > 0)
                    work.push(this.operationTail);
                const results = await Promise.allSettled(work);
                for (const result of results)
                    if (result.status === 'rejected')
                        errors.push(result.reason);
            }
            if (errors.length > 0)
                throw errors.length === 1
                    ? errors[0]
                    : new AggregateError(errors, 'Google Drive work failed');
        };
        const backup = waitForWork();
        void backup.catch(() => { });
        this.stopPromise = new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                this.terminalCleanup = true;
                this.backupAbortController?.abort();
                this.abortQueuedDriveOperations();
                this.cancelActiveDriveOperations();
                settled = true;
                this.stopSettled = true;
                reject(createDriveShutdownError('Google Drive shutdown', true));
            }, shutdown_1.SHUTDOWN_TIMEOUT_MS);
            backup.then(() => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                this.stopSettled = true;
                resolve();
            }, (error) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                this.stopSettled = true;
                if (this.stopping && isExpectedShutdownCancellation(error))
                    resolve();
                else
                    reject(error);
            });
        });
        return this.stopPromise;
    }
    trackDriveOperation(operation) {
        this.activeDriveOperations.add(operation);
        void operation.finally(() => this.activeDriveOperations.delete(operation)).catch(() => { });
    }
    trackJob(operation) {
        this.activeJobs.add(operation);
        void operation.finally(() => this.activeJobs.delete(operation)).catch(() => { });
    }
    cancelActiveDriveOperations() {
        for (const operation of this.activeDriveOperations)
            cancelDriveOperation(operation);
    }
    /** Cancels in-flight Drive work when Offline mode is switched on; the service stays usable. */
    suspendForOfflineMode() {
        this.backupAbortController?.abort();
        this.abortQueuedDriveOperations();
        for (const controller of this.jobControllers.values())
            controller.abort();
        this.cancelActiveDriveOperations();
    }
    abortQueuedDriveOperations() {
        for (const controller of this.queuedOperationControllers)
            controller.abort();
    }
    async abortAndAwaitActiveDriveOperations() {
        while (this.activeDriveOperations.size > 0) {
            const operations = [...this.activeDriveOperations];
            this.cancelActiveDriveOperations();
            await Promise.allSettled(operations);
        }
    }
    queueOperation(operation, allowDuringStop = false, allowDuringRestore = false, jobId) {
        const controller = new AbortController();
        this.queuedOperationControllers.add(controller);
        const run = this.operationTail
            .catch(() => { })
            .then(async () => {
            if (this.restoreInvalidationActive() && !allowDuringRestore)
                throw createDriveError('conflict');
            if (this.stopping && !allowDuringStop)
                throw createDriveShutdownError('Google Drive operation');
            if (controller.signal.aborted)
                throw createDriveShutdownError('Google Drive operation');
            this.operationRunning = true;
            try {
                return await operation(controller.signal);
            }
            finally {
                this.operationRunning = false;
            }
        });
        this.operationTail = run.then(() => undefined, () => undefined);
        void run
            .catch((error) => {
            if (jobId)
                this.finalizeQueuedJob(jobId, error);
        })
            .finally(() => this.queuedOperationControllers.delete(controller))
            .catch(() => { });
        return run;
    }
    finalizeQueuedJob(jobId, error) {
        try {
            const job = parseJob(this.readSettings().google_drive_job);
            if (!job || job.id !== jobId || job.state !== 'queued')
                return;
            const classified = classifyDriveError(error);
            this.writeJob({
                ...job,
                state: classified.code === 'cancelled' ? 'cancelled' : 'failed',
                error_code: classified.code,
                updated_at: (0, db_1.now)(),
            });
        }
        catch { }
    }
    async maybeRunScheduled() {
        if (this.stopping ||
            this.restoreInvalidationActive() ||
            this.operationRunning ||
            this.backingUp ||
            this.activeJobs.size > 0 ||
            (0, offline_mode_1.isOfflineMode)())
            return;
        const settings = this.readSettings();
        if (settings.google_drive_revoke_status === 'unconfirmed')
            return;
        const tokenEnvelope = this.readTokenEnvelope();
        if (!settings.google_drive_account_subject ||
            this.tokenReadIssue ||
            !tokenEnvelope?.refresh_token)
            return;
        const pending = parsePending(settings.google_drive_pending_upload);
        if (pending) {
            if (settings.google_drive_retention_status === 'pending') {
                try {
                    await this.backupNow(undefined, pending.kind);
                }
                catch { }
                return;
            }
            if ([
                'destination_required',
                'destination_invalid',
                'reauth_required',
                'permission_denied',
                'duplicate_upload',
            ].includes(settings.google_drive_last_error_code))
                return;
            const retryAt = Date.parse(settings.google_drive_next_retry_at || pending.next_retry_at || '');
            if (!Number.isFinite(retryAt)) {
                const nextRetryAt = nextBackupRetryAt(pending.attempt_count);
                pending.next_retry_at = nextRetryAt;
                (0, db_1.upsertSettings)({
                    google_drive_pending_upload: JSON.stringify(pending),
                    google_drive_next_retry_at: nextRetryAt,
                });
                return;
            }
            if (retryAt > Date.now())
                return;
            try {
                await this.backupNow(undefined, pending.kind);
            }
            catch { }
            return;
        }
        if (settings.google_drive_retention_status === 'pending') {
            const retryAt = Date.parse(settings.google_drive_next_retry_at || '');
            if (!Number.isFinite(retryAt) || retryAt <= Date.now()) {
                try {
                    await this.retryPendingRetention();
                }
                catch { }
                return;
            }
        }
        const frequency = settings.google_drive_frequency === 'weekly' ? 'weekly' : 'daily';
        if (!isBackupDue(settings.google_drive_last_automatic_backup_at || null, frequency))
            return;
        try {
            await this.backupNow(undefined, 'automatic');
        }
        catch { }
    }
    getStatus() {
        const settings = this.readSettings();
        const configured = isGoogleDriveConfigured();
        const secureStorage = isSecureStorageAvailable();
        const marker = this.ensureInstallationMarker();
        const envelope = this.readTokenEnvelope();
        const tokenPresent = Boolean(envelope && (envelope.refresh_token || envelope.access_token));
        const tokenConnected = Boolean(envelope?.refresh_token && envelope.installation_id === marker);
        const credentials = getClientCredentials();
        const clientIdFingerprint = credentials
            ? crypto.createHash('sha256').update(credentials.clientId).digest('hex').slice(0, 16)
            : '';
        const accountBound = Boolean(tokenConnected &&
            envelope?.account_subject &&
            settings.google_drive_account_subject &&
            envelope.account_subject === settings.google_drive_account_subject &&
            envelope.client_id_fingerprint === clientIdFingerprint);
        const revocationPending = settings.google_drive_revoke_status === 'unconfirmed';
        const reauthRequired = settings.google_drive_last_error_code === 'reauth_required';
        const restoreRecoveryPending = this.restoreInvalidationCleanupPending;
        const connected = tokenConnected &&
            accountBound &&
            !reauthRequired &&
            !revocationPending &&
            !restoreRecoveryPending;
        const authState = !configured
            ? 'configuration_unavailable'
            : !secureStorage
                ? 'storage_unavailable'
                : restoreRecoveryPending ||
                    this.tokenReadIssue ||
                    reauthRequired ||
                    (tokenPresent && !accountBound)
                    ? 'reauth_required'
                    : revocationPending
                        ? 'disconnected'
                        : connected
                            ? 'connected'
                            : 'disconnected';
        const retention = this.retentionFromSettings(settings);
        const lastBackupStatus = settings.google_drive_last_backup_status === 'success' ||
            settings.google_drive_last_backup_status === 'error'
            ? settings.google_drive_last_backup_status
            : null;
        const lastBackupAt = lastBackupStatus === 'error'
            ? settings.google_drive_last_attempt_at ||
                settings.google_drive_last_success_at ||
                settings.google_drive_last_backup_at ||
                null
            : settings.google_drive_last_success_at || settings.google_drive_last_backup_at || null;
        return {
            configured,
            secure_storage_available: secureStorage,
            connected,
            auth_state: authState,
            account_email: settings.google_drive_account_email || null,
            frequency: settings.google_drive_frequency === 'weekly' ? 'weekly' : 'daily',
            retention_count: retention,
            destination_folder_id: settings.google_drive_destination_folder_id || settings.google_drive_folder_id || null,
            destination_folder_name: settings.google_drive_destination_folder_name ||
                (connected ? this.resolveBackupFolderName() : null),
            last_backup_at: lastBackupAt,
            last_backup_status: lastBackupStatus,
            last_error: settings.google_drive_last_error_code || null,
            last_attempt_at: settings.google_drive_last_attempt_at || null,
            last_success_at: settings.google_drive_last_success_at || null,
            last_success_kind: settings.google_drive_last_success_kind === 'automatic' ||
                settings.google_drive_last_success_kind === 'manual'
                ? settings.google_drive_last_success_kind
                : null,
            next_retry_at: settings.google_drive_next_retry_at || null,
            retention_status: settings.google_drive_retention_status === 'pending'
                ? 'pending'
                : settings.google_drive_retention_status === 'error'
                    ? 'error'
                    : settings.google_drive_last_success_at
                        ? 'ok'
                        : null,
            revoke_status: settings.google_drive_revoke_status === 'confirmed' ||
                settings.google_drive_revoke_status === 'unconfirmed'
                ? settings.google_drive_revoke_status
                : null,
            warning_acknowledged: settings[exports.DRIVE_WARNING_SETTING] === 'true',
            warning_required: settings[exports.DRIVE_WARNING_SETTING] !== 'true',
            job: parseJob(settings.google_drive_job) ||
                readRestoreJobResult() ||
                readCommittedRestoreJobResult(),
        };
    }
    statusWithJobFallback(job, fallback) {
        if (fallback) {
            return this.restoreInvalidationCleanupPending
                ? {
                    ...fallback,
                    connected: false,
                    auth_state: fallback.configured
                        ? fallback.secure_storage_available
                            ? 'reauth_required'
                            : fallback.auth_state
                        : fallback.auth_state,
                    job,
                }
                : { ...fallback, job };
        }
        return {
            configured: isGoogleDriveConfigured(),
            secure_storage_available: isSecureStorageAvailable(),
            connected: false,
            auth_state: 'disconnected',
            account_email: null,
            frequency: 'daily',
            retention_count: DEFAULT_RETENTION,
            destination_folder_id: null,
            destination_folder_name: null,
            last_backup_at: null,
            last_backup_status: null,
            last_error: null,
            last_attempt_at: null,
            last_success_at: null,
            last_success_kind: null,
            next_retry_at: null,
            retention_status: null,
            revoke_status: null,
            warning_acknowledged: false,
            warning_required: true,
            job,
        };
    }
    updatePreferences(input) {
        if (this.operationRunning)
            throw createDriveError('conflict');
        const updates = {};
        if (input.frequency !== undefined) {
            if (input.frequency !== 'daily' && input.frequency !== 'weekly')
                throw createDriveError('preferences_invalid');
            updates.google_drive_frequency = input.frequency;
        }
        const rawRetention = input.retention_count;
        if (rawRetention !== undefined) {
            const n = Number(rawRetention);
            if (!Number.isInteger(n) || n < MIN_RETENTION || n > MAX_RETENTION)
                throw createDriveError('preferences_invalid');
            updates.google_drive_retention_count = String(n);
        }
        (0, db_1.upsertSettings)(updates);
        return this.getStatus();
    }
    acknowledgeWarning() {
        (0, db_1.upsertSettings)({ [exports.DRIVE_WARNING_SETTING]: 'true' });
        return this.getStatus();
    }
    async connect(signal, allowSwitch = false, warningAcknowledged = false) {
        if (signal?.aborted)
            throw createDriveShutdownError('Google Drive connection');
        if ((0, offline_mode_1.isOfflineMode)())
            throw createDriveError('offline');
        const allowRestoreRecovery = this.restoreInvalidationCleanupPending;
        return this.queueOperation((operationSignal) => this.connectInternal(signal ? AbortSignal.any([signal, operationSignal]) : operationSignal, allowSwitch, warningAcknowledged, allowRestoreRecovery), false, allowRestoreRecovery);
    }
    async connectInternal(signal, allowSwitch, warningAcknowledged, allowRestoreRecovery) {
        const creds = getClientCredentials();
        if (!creds)
            throw createDriveError('configuration_unavailable');
        if (!isSecureStorageAvailable())
            throw createDriveError('secure_storage_unavailable');
        if (!warningAcknowledged && this.readSettings()[exports.DRIVE_WARNING_SETTING] !== 'true')
            throw createDriveError('warning_acknowledgement_required');
        const current = this.readTokenEnvelope();
        const settings = this.readSettings();
        if (settings.google_drive_revoke_status === 'unconfirmed')
            throw createDriveError('not_connected');
        const reauthRequired = settings.google_drive_last_error_code === 'reauth_required';
        if (current &&
            (current.refresh_token || current.access_token) &&
            current.account_subject &&
            settings.google_drive_account_subject &&
            !allowSwitch &&
            !reauthRequired)
            throw createDriveError('conflict');
        const marker = this.ensureInstallationMarker();
        const { code, redirectUri, verifier } = await this.runLoopbackFlow(creds, signal);
        this.throwIfStopping(signal);
        const client = new drive_1.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
        const tokenResult = await waitForDriveOperation(() => client.getToken({ code, codeVerifier: verifier }), signal, DRIVE_REQUEST_TIMEOUT_MS, 'Google Drive token exchange');
        const tokens = tokenResult.tokens;
        if (!tokens.refresh_token)
            throw createDriveError('reauth_required');
        client.setCredentials(tokens);
        const identity = await this.fetchAccountIdentity(client, signal);
        if (!identity.subject)
            throw createDriveError('reauth_required');
        const candidateDrive = (0, drive_1.drive)({ version: 'v3', auth: client });
        const existingSubjects = [
            current?.account_subject,
            settings.google_drive_account_subject,
        ].filter((subject) => typeof subject === 'string' && subject.length > 0);
        if (!allowSwitch && existingSubjects.some((subject) => subject !== identity.subject))
            throw createDriveError('reauth_required');
        const preservedDestinations = this.readOwnedDestinations();
        const destinationCandidates = [
            ...new Set([
                settings.google_drive_destination_folder_id || settings.google_drive_folder_id,
                ...preservedDestinations,
            ].filter((value) => Boolean(value) && safeId(value))),
        ];
        let destination = null;
        for (const folderId of destinationCandidates) {
            try {
                destination = await this.validateDestination(candidateDrive, folderId, marker, signal);
                break;
            }
            catch (error) {
                this.throwIfStopping(signal);
                const classified = classifyDriveError(error);
                if (classified.code !== 'destination_invalid' && !isMissingDestinationError(error))
                    throw classified;
            }
        }
        if (!destination) {
            destination = await this.findExistingAppFolder(candidateDrive, marker, signal);
        }
        if (!destination) {
            destination = await this.createAppFolder(candidateDrive, marker, signal);
        }
        if (allowRestoreRecovery) {
            const replacement = (0, db_1.getDatabaseReplacementJournal)();
            if (replacement?.phase === 'prepared') {
                this.restoreInvalidationCleanupPending = true;
                this.scheduleRestoreRecoveryRetry();
                throw new Error('Prepared database replacement recovery remains pending');
            }
            if (replacement?.phase === 'committed') {
                try {
                    (0, db_1.finalizeDatabaseReplacementJournal)(replacement);
                }
                catch (error) {
                    this.restoreInvalidationCleanupPending = true;
                    this.scheduleRestoreRecoveryRetry();
                    throw error;
                }
            }
        }
        this.throwIfStopping(signal);
        this.writeTokens({
            ...tokens,
            version: TOKEN_ENVELOPE_VERSION,
            installation_id: marker,
            account_subject: identity.subject,
            client_id_fingerprint: crypto
                .createHash('sha256')
                .update(creds.clientId)
                .digest('hex')
                .slice(0, 16),
        });
        this.tokenReadIssue = null;
        (0, db_1.upsertSettings)({
            [exports.DRIVE_WARNING_SETTING]: warningAcknowledged
                ? 'true'
                : settings[exports.DRIVE_WARNING_SETTING] || 'false',
            google_drive_account_subject: identity.subject,
            google_drive_account_email: identity.email || '',
            google_drive_destination_folder_id: destination.id,
            google_drive_destination_folder_name: destination.name,
            google_drive_folder_id: destination.id,
            google_drive_last_error_code: '',
            google_drive_revoke_status: '',
        });
        this.rememberDestination(destination.id);
        if (allowRestoreRecovery) {
            this.clearRestoreInvalidationIntent();
            this.databaseRestorePending = false;
            this.armScheduling();
        }
        return this.getStatus();
    }
    qrMenuGeneratorPrefs(settings = this.readSettings()) {
        const defaults = {
            template: 'mobile-cafe',
            pageSize: 'A4',
            includeDescriptions: true,
            includeModifiers: true,
            includePhotos: false,
            includeOutOfStock: false,
            includeInactive: false,
            includeHidden: false,
        };
        const parsed = parseJson(settings.google_drive_menu_generator_prefs);
        if (!parsed)
            return defaults;
        return {
            template: ['mobile-cafe', 'classic-bistro', 'standard'].includes(String(parsed.template))
                ? parsed.template
                : defaults.template,
            pageSize: parsed.pageSize === 'Letter' ? 'Letter' : 'A4',
            includeDescriptions: parsed.includeDescriptions !== false,
            includeModifiers: parsed.includeModifiers !== false,
            includePhotos: parsed.includePhotos === true,
            includeOutOfStock: parsed.includeOutOfStock === true,
            includeInactive: parsed.includeInactive === true,
            includeHidden: parsed.includeHidden === true,
        };
    }
    normalizeQrMenuGeneratorPrefs(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw createDriveError('preferences_invalid');
        const candidate = value;
        if (!['mobile-cafe', 'classic-bistro', 'standard'].includes(String(candidate.template)) ||
            !['A4', 'Letter'].includes(String(candidate.pageSize)) ||
            ![
                'includeDescriptions',
                'includeModifiers',
                'includePhotos',
                'includeOutOfStock',
                'includeInactive',
                'includeHidden',
            ].every((key) => typeof candidate[key] === 'boolean'))
            throw createDriveError('preferences_invalid');
        return candidate;
    }
    async getQrMenuStatus() {
        const settings = this.readSettings();
        const driveStatus = this.getStatus();
        const fileId = safeId(settings.google_drive_menu_file_id)
            ? settings.google_drive_menu_file_id
            : null;
        const webViewLink = fileId
            ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
            : null;
        const source = settings.google_drive_menu_source === 'generated' ||
            settings.google_drive_menu_source === 'uploaded'
            ? settings.google_drive_menu_source
            : null;
        return {
            configured: driveStatus.configured,
            connected: driveStatus.connected,
            published: Boolean(fileId),
            file_id: fileId,
            file_name: settings.google_drive_menu_file_name || null,
            web_view_link: webViewLink,
            sharing_enabled: settings.google_drive_menu_sharing_enabled === 'true',
            source,
            updated_at: settings.google_drive_menu_updated_at || null,
            qr_data_url: webViewLink
                ? await qrcode_1.default.toDataURL(webViewLink, { width: 512, margin: 2 })
                : null,
            qr_download_data_url: webViewLink
                ? await qrcode_1.default.toDataURL(webViewLink, { width: 1024, margin: 3 })
                : null,
            generator_prefs: this.qrMenuGeneratorPrefs(settings),
        };
    }
    async saveQrMenuGeneratorPrefs(value) {
        const prefs = this.normalizeQrMenuGeneratorPrefs(value);
        (0, db_1.upsertSettings)({ google_drive_menu_generator_prefs: JSON.stringify(prefs) });
        return this.getQrMenuStatus();
    }
    async publishQrMenuPdf(input) {
        if (!Buffer.isBuffer(input.pdfBuffer) ||
            input.pdfBuffer.length < 5 ||
            !input.pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
            throw createDriveError('menu_pdf_invalid');
        if (input.pdfBuffer.length > exports.MAX_QR_MENU_PDF_BYTES)
            throw createDriveError('menu_pdf_too_large');
        if (input.source !== 'generated' && input.source !== 'uploaded')
            throw createDriveError('menu_pdf_invalid');
        const prefs = input.generatorPrefs === undefined
            ? null
            : this.normalizeQrMenuGeneratorPrefs(input.generatorPrefs);
        return this.queueOperation(async (signal) => {
            const client = await this.getAuthorizedClient(signal);
            const driveClient = qrMenuDriveClientFactory(client);
            const marker = this.ensureInstallationMarker();
            const folderId = await this.resolveQrMenuFolder(driveClient, marker, signal);
            const settings = this.readSettings();
            const shortId = /^[a-z0-9]{6}$/.test(settings.google_drive_menu_short_id || '')
                ? settings.google_drive_menu_short_id
                : crypto.randomBytes(4).toString('hex').slice(0, 6);
            const businessName = (settings.business_name || 'Store')
                .replace(/[\\/\u0000-\u001f]+/g, ' ')
                .trim()
                .slice(0, 100) || 'Store';
            const fileName = `${businessName} - Menu (${shortId}).pdf`;
            const appProperties = {
                flo_marker_version: MARKER_VERSION,
                flo_installation_id: marker,
                flo_file_kind: 'public_menu_pdf',
            };
            let fileId = settings.google_drive_menu_file_id;
            if (fileId) {
                await this.validateQrMenuFile(driveClient, fileId, marker, signal);
                await driveClient.files.update({
                    fileId,
                    requestBody: { name: fileName, mimeType: 'application/pdf', appProperties },
                    media: { mimeType: 'application/pdf', body: node_stream_1.Readable.from(input.pdfBuffer) },
                    fields: 'id,name,mimeType,parents,trashed,appProperties',
                }, {
                    signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                    timeout: DRIVE_REQUEST_TIMEOUT_MS,
                });
            }
            else {
                const response = await driveClient.files.create({
                    requestBody: {
                        name: fileName,
                        parents: [folderId],
                        mimeType: 'application/pdf',
                        appProperties,
                    },
                    media: { mimeType: 'application/pdf', body: node_stream_1.Readable.from(input.pdfBuffer) },
                    fields: 'id,name,mimeType,parents,trashed,appProperties',
                }, {
                    signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                    timeout: DRIVE_REQUEST_TIMEOUT_MS,
                });
                fileId = String(response.data.id || '');
                if (!safeId(fileId))
                    throw createDriveError('upload_failed');
            }
            const webViewLink = `https://drive.google.com/file/d/${fileId}/view`;
            (0, db_1.upsertSettings)({
                google_drive_menu_folder_id: folderId,
                google_drive_menu_file_id: fileId,
                google_drive_menu_short_id: shortId,
                google_drive_menu_sharing_enabled: 'false',
                google_drive_menu_file_name: fileName,
                google_drive_menu_web_view_link: webViewLink,
            });
            await this.ensureQrMenuPublicPermission(driveClient, fileId, marker, signal);
            (0, db_1.upsertSettings)({
                google_drive_menu_sharing_enabled: 'true',
                google_drive_menu_source: input.source,
                google_drive_menu_updated_at: (0, db_1.now)(),
                ...(prefs ? { google_drive_menu_generator_prefs: JSON.stringify(prefs) } : {}),
            });
            return this.getQrMenuStatus();
        });
    }
    async setQrMenuSharing(enabled) {
        return this.queueOperation(async (signal) => {
            const settings = this.readSettings();
            const fileId = settings.google_drive_menu_file_id;
            if (!safeId(fileId))
                throw createDriveError('menu_not_published');
            const client = await this.getAuthorizedClient(signal);
            const driveClient = qrMenuDriveClientFactory(client);
            const marker = this.ensureInstallationMarker();
            await this.validateQrMenuFile(driveClient, fileId, marker, signal);
            if (enabled) {
                await this.ensureQrMenuPublicPermission(driveClient, fileId, marker, signal);
            }
            else {
                const response = await driveClient.permissions.list({ fileId, fields: 'permissions(id,type,role)' }, {
                    signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                    timeout: DRIVE_REQUEST_TIMEOUT_MS,
                });
                for (const permission of response.data.permissions || []) {
                    if (permission.type === 'anyone' && permission.id) {
                        await driveClient.permissions.delete({ fileId, permissionId: permission.id }, {
                            signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                            timeout: DRIVE_REQUEST_TIMEOUT_MS,
                        });
                    }
                }
            }
            (0, db_1.upsertSettings)({ google_drive_menu_sharing_enabled: enabled ? 'true' : 'false' });
            return this.getQrMenuStatus();
        });
    }
    async resolveQrMenuFolder(driveClient, marker, signal) {
        const settings = this.readSettings();
        const storedId = settings.google_drive_menu_folder_id;
        if (safeId(storedId)) {
            try {
                const response = await driveClient.files.get({ fileId: storedId, fields: 'id,mimeType,trashed,appProperties,capabilities' }, {
                    signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                    timeout: DRIVE_REQUEST_TIMEOUT_MS,
                });
                const file = response.data;
                if (!file.trashed &&
                    file.mimeType === 'application/vnd.google-apps.folder' &&
                    file.appProperties?.flo_installation_id === marker &&
                    file.appProperties?.flo_destination_kind === 'flocafe_menu' &&
                    file.capabilities?.canAddChildren !== false)
                    return storedId;
            }
            catch { }
        }
        const escapedMarker = marker.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const found = await driveClient.files.list({
            q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='flo_installation_id' and value='${escapedMarker}' }`,
            fields: 'files(id,appProperties,capabilities)',
            pageSize: 20,
        }, {
            signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
            timeout: DRIVE_REQUEST_TIMEOUT_MS,
        });
        const existing = (found.data.files || []).find((file) => file.id &&
            file.appProperties?.flo_destination_kind === 'flocafe_menu' &&
            file.capabilities?.canAddChildren !== false);
        if (existing?.id && safeId(existing.id)) {
            (0, db_1.upsertSettings)({ google_drive_menu_folder_id: existing.id });
            return existing.id;
        }
        const sanitized = (settings.business_name || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const folderName = sanitized ? `${sanitized}_flocafe_menu` : 'flocafe_menu';
        const response = await driveClient.files.create({
            requestBody: {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                appProperties: {
                    flo_marker_version: MARKER_VERSION,
                    flo_installation_id: marker,
                    flo_destination_kind: 'flocafe_menu',
                },
            },
            fields: 'id',
        }, {
            signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
            timeout: DRIVE_REQUEST_TIMEOUT_MS,
        });
        const folderId = String(response.data.id || '');
        if (!safeId(folderId))
            throw createDriveError('destination_required');
        (0, db_1.upsertSettings)({ google_drive_menu_folder_id: folderId });
        return folderId;
    }
    async validateQrMenuFile(driveClient, fileId, marker, signal) {
        if (!safeId(fileId))
            throw createDriveError('menu_file_invalid');
        try {
            const response = await driveClient.files.get({ fileId, fields: 'id,mimeType,parents,trashed,appProperties' }, {
                signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                timeout: DRIVE_REQUEST_TIMEOUT_MS,
            });
            const file = response.data;
            const settings = this.readSettings();
            const forbiddenParents = new Set([
                ...this.readOwnedDestinations(),
                settings.google_drive_destination_folder_id,
                settings.google_drive_folder_id,
            ].filter((value) => Boolean(value)));
            if (file.trashed ||
                file.mimeType !== 'application/pdf' ||
                file.appProperties?.flo_file_kind !== 'public_menu_pdf' ||
                file.appProperties?.flo_installation_id !== marker ||
                (file.parents || []).some((parent) => forbiddenParents.has(parent)))
                throw createDriveError('menu_file_invalid');
        }
        catch (error) {
            if (error?.code === 'menu_file_invalid')
                throw error;
            throw createDriveError('menu_file_invalid');
        }
    }
    async ensureQrMenuPublicPermission(driveClient, fileId, marker, signal) {
        await this.validateQrMenuFile(driveClient, fileId, marker, signal);
        const response = await driveClient.permissions.list({ fileId, fields: 'permissions(id,type,role)' }, {
            signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
            timeout: DRIVE_REQUEST_TIMEOUT_MS,
        });
        if ((response.data.permissions || []).some((permission) => permission.type === 'anyone' && permission.role === 'reader'))
            return;
        await driveClient.permissions.create({ fileId, requestBody: { type: 'anyone', role: 'reader' }, fields: 'id,type,role' }, {
            signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
            timeout: DRIVE_REQUEST_TIMEOUT_MS,
        });
    }
    async disconnect() {
        return this.queueOperation(async (signal) => {
            const settings = this.readSettings();
            const cleanupPending = settings.google_drive_revoke_cleanup_pending === 'true';
            const envelope = this.readTokenEnvelope();
            if (this.tokenReadIssue && !cleanupPending)
                throw createDriveError('reauth_required');
            if (cleanupPending)
                this.tokenReadIssue = null;
            const pending = parsePending(settings.google_drive_pending_upload);
            let revokeStatus = 'confirmed';
            const token = envelope?.refresh_token || envelope?.access_token;
            if (token && !cleanupPending) {
                try {
                    if ((0, offline_mode_1.isOfflineMode)())
                        throw createDriveError('offline');
                    const response = await fetch('https://oauth2.googleapis.com/revoke', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ token }).toString(),
                        signal: requestSignal(signal, 8_000),
                    });
                    revokeStatus = response.ok ? 'confirmed' : 'unconfirmed';
                }
                catch (error) {
                    if (signal.aborted)
                        throw error;
                    revokeStatus = 'unconfirmed';
                }
            }
            if (revokeStatus === 'unconfirmed' && !cleanupPending) {
                (0, db_1.upsertSettings)({
                    google_drive_revoke_status: 'unconfirmed',
                    google_drive_revoke_cleanup_pending: '',
                });
                return this.getStatus();
            }
            (0, db_1.upsertSettings)({
                google_drive_revoke_status: 'unconfirmed',
                google_drive_revoke_cleanup_pending: 'true',
                google_drive_last_error_code: 'reauth_required',
            });
            if (pending)
                removeStagingFile(pending.local_path);
            this.deleteTokens();
            clearRestoreJobResult();
            (0, db_1.upsertSettings)({
                google_drive_account_email: '',
                google_drive_last_backup_at: '',
                google_drive_last_backup_status: '',
                google_drive_last_automatic_backup_at: '',
                google_drive_last_attempt_at: '',
                google_drive_last_success_at: '',
                google_drive_last_success_kind: '',
                google_drive_next_retry_at: '',
                google_drive_retention_status: '',
                google_drive_retention_retry_count: '',
                google_drive_last_error_code: '',
                google_drive_pending_upload: '',
                google_drive_job: '',
                google_drive_revoke_status: revokeStatus,
                google_drive_revoke_cleanup_pending: '',
                google_drive_menu_folder_id: '',
                google_drive_menu_file_id: '',
                google_drive_menu_sharing_enabled: '',
                google_drive_menu_source: '',
                google_drive_menu_updated_at: '',
                google_drive_menu_file_name: '',
                google_drive_menu_web_view_link: '',
            });
            return this.getStatus();
        }, true);
    }
    async prepareForDatabaseRestore(options = {}) {
        if (this.databaseRestoreInProcess)
            throw createDriveError('conflict');
        const hadRestoreBoundary = this.databaseRestorePending || this.restoreInvalidationCleanupPending;
        if (this.restoreInvalidationActive()) {
            if (this.operationRunning || this.activeJobs.size > 0)
                throw createDriveError('conflict');
            if (hadRestoreBoundary && !options.discardUnresolvedBoundary)
                throw createDriveError('conflict');
            try {
                this.clearDatabaseRestoreInvalidation();
            }
            catch (recoveryError) {
                if (!options.discardUnresolvedBoundary ||
                    !this.restoreInvalidationCleanupPending ||
                    this.databaseRestoreRecoveryDecision() !== 'ambiguous')
                    throw createDriveError('conflict');
                console.error('[Google Drive] Discarding unresolvable restore boundary:', recoveryError);
                try {
                    this.invalidateAfterDatabaseRestore((0, db_1.getDatabaseReplacementJournal)(), {
                        discardUnresolvedBoundary: true,
                    });
                }
                catch {
                    throw createDriveError('conflict');
                }
            }
            if (this.restoreInvalidationActive())
                throw createDriveError('conflict');
        }
        this.databaseRestoreInProcess = true;
        this.databaseRestorePending = true;
        try {
            this.backupAbortController?.abort();
            this.abortQueuedDriveOperations();
            for (const controller of this.jobControllers.values())
                controller.abort();
            await this.abortAndAwaitActiveDriveOperations();
            await this.operationTail;
            await this.abortAndAwaitActiveDriveOperations();
            this.activateDatabaseRestoreInvalidation();
        }
        catch (error) {
            this.databaseRestoreInProcess = false;
            throw error;
        }
    }
    async beginDatabaseRestoreInvalidation(jobId) {
        if (this.restoreInvalidationActive())
            throw createDriveError('conflict');
        this.databaseRestorePending = true;
        await this.abortAndAwaitActiveDriveOperations();
        this.activateDatabaseRestoreInvalidation(jobId);
    }
    releaseDatabaseRestore() {
        this.databaseRestoreInProcess = false;
        if (this.restoreInvalidationCleanupPending)
            return;
        const replacement = (0, db_1.getDatabaseReplacementJournal)();
        if (this.restoreInvalidationIntentExists() || replacement?.phase === 'prepared') {
            try {
                this.clearDatabaseRestoreInvalidation();
            }
            catch (error) {
                console.error('[Google Drive] Restore cancellation cleanup deferred:', error);
            }
            return;
        }
        this.databaseRestorePending = false;
    }
    clearDatabaseRestoreInvalidation() {
        const replacement = (0, db_1.getDatabaseReplacementJournal)();
        if (replacement?.phase === 'committed') {
            this.invalidateAfterDatabaseRestore(replacement);
            return;
        }
        const decision = this.databaseRestoreRecoveryDecision();
        if (!replacement && decision === 'committed') {
            this.invalidateAfterDatabaseRestore(null);
            return;
        }
        if (decision === 'ambiguous') {
            this.restoreInvalidationCleanupPending = true;
            this.scheduleRestoreRecoveryRetry();
            throw new Error('Database replacement outcome is ambiguous');
        }
        if (replacement?.phase === 'prepared') {
            if (decision === 'committed') {
                this.restoreInvalidationCleanupPending = true;
                this.scheduleRestoreRecoveryRetry();
                throw new Error('Prepared database replacement recovery remains pending');
            }
            try {
                (0, db_1.abortDatabaseReplacementJournal)(replacement);
            }
            catch (error) {
                this.restoreInvalidationCleanupPending = true;
                this.scheduleRestoreRecoveryRetry();
                throw error;
            }
        }
        this.clearRestoreInvalidationIntent();
        this.databaseRestorePending = false;
        this.armScheduling();
    }
    completeDatabaseRestore() {
        this.databaseRestoreInProcess = false;
        const replacement = (0, db_1.getDatabaseReplacementJournal)();
        if (!replacement) {
            const decision = this.databaseRestoreRecoveryDecision();
            if (decision === 'committed') {
                try {
                    this.invalidateAfterDatabaseRestore(null);
                    return { committed: true, cleanupPending: false };
                }
                catch (error) {
                    console.error('[Google Drive] Post-restore cleanup deferred:', error);
                }
            }
            else if (decision === 'recovered') {
                try {
                    this.clearDatabaseRestoreInvalidation();
                    return { committed: true, cleanupPending: false };
                }
                catch (error) {
                    console.error('[Google Drive] Post-restore boundary cleanup deferred:', error);
                }
            }
            return {
                committed: true,
                cleanupPending: this.restoreInvalidationCleanupPending || this.restoreInvalidationIntentExists(),
            };
        }
        try {
            this.invalidateAfterDatabaseRestore();
            return { committed: true, cleanupPending: false };
        }
        catch (error) {
            console.error('[Google Drive] Post-restore cleanup deferred:', error);
            return { committed: true, cleanupPending: true };
        }
    }
    invalidateAfterDatabaseRestore(replacement = (0, db_1.getDatabaseReplacementJournal)(), options = {}) {
        if ((0, db_1.getDatabaseReplacementJournal)()?.phase === 'prepared') {
            this.restoreInvalidationCleanupPending = true;
            this.scheduleRestoreRecoveryRetry();
            throw new Error('Prepared database replacement recovery remains pending');
        }
        const committedReplacement = replacement?.phase === 'committed' ? replacement : null;
        if (!committedReplacement &&
            !options.discardUnresolvedBoundary &&
            this.databaseRestoreRecoveryDecision() !== 'committed')
            throw new Error('Database replacement is not committed');
        try {
            for (const fileName of fs.readdirSync(getStagingDir()))
                removeStagingFile(path.join(getStagingDir(), fileName));
        }
        catch { }
        this.deleteTokens();
        this.tokenReadIssue = null;
        (0, db_1.clearGoogleDriveRestoreBinding)();
        if (committedReplacement)
            (0, db_1.finalizeDatabaseReplacementJournal)(committedReplacement);
        this.clearRestoreInvalidationIntent();
        clearRestoreJobResult();
        this.databaseRestorePending = false;
        this.armScheduling();
    }
    async setDestination(folderId) {
        if (!safeId(folderId))
            throw createDriveError('destination_invalid');
        return this.queueOperation(async (signal) => {
            const client = await this.getAuthorizedClient(signal);
            const destination = await this.validateDestination((0, drive_1.drive)({ version: 'v3', auth: client }), folderId, this.ensureInstallationMarker(), signal);
            this.rememberDestination(destination.id);
            (0, db_1.upsertSettings)({
                google_drive_destination_folder_id: destination.id,
                google_drive_destination_folder_name: destination.name,
                google_drive_folder_id: destination.id,
                google_drive_last_error_code: '',
            });
            return this.getStatus();
        });
    }
    async listDestinations() {
        return this.queueOperation(async (signal) => {
            const client = await this.getAuthorizedClient(signal);
            const marker = this.ensureInstallationMarker();
            const settings = this.readSettings();
            const current = settings.google_drive_destination_folder_id || settings.google_drive_folder_id;
            const ids = [
                ...new Set([current, ...this.readOwnedDestinations()].filter((value) => Boolean(value))),
            ];
            const result = [];
            for (const id of ids) {
                try {
                    const destination = await this.validateDestination((0, drive_1.drive)({ version: 'v3', auth: client }), id, marker, signal);
                    result.push({
                        id: destination.id,
                        name: destination.name,
                        current: destination.id === current,
                    });
                }
                catch (error) {
                    const classified = classifyDriveError(error);
                    if (classified.code !== 'destination_invalid' && !isMissingDestinationError(error))
                        throw classified;
                }
            }
            return result;
        });
    }
    async createDestination() {
        return this.queueOperation(async (signal) => {
            const client = await this.getAuthorizedClient(signal);
            const marker = this.ensureInstallationMarker();
            const driveClient = (0, drive_1.drive)({ version: 'v3', auth: client });
            let destination = await this.findExistingAppFolder(driveClient, marker, signal);
            if (!destination) {
                destination = await this.createAppFolder(driveClient, marker, signal);
            }
            this.rememberDestination(destination.id);
            (0, db_1.upsertSettings)({
                google_drive_destination_folder_id: destination.id,
                google_drive_destination_folder_name: destination.name,
                google_drive_folder_id: destination.id,
                google_drive_last_error_code: '',
            });
            return this.getStatus();
        });
    }
    async backupNow(signal, kind = 'manual') {
        if (signal?.aborted)
            throw createDriveShutdownError('Google Drive backup');
        if (this.restoreInvalidationActive())
            throw createDriveError('conflict');
        if (this.readSettings().google_drive_revoke_status === 'unconfirmed')
            throw createDriveError('not_connected');
        if (kind === 'manual' &&
            parsePending(this.readSettings().google_drive_pending_upload)?.kind === 'automatic')
            throw createDriveError('conflict');
        if (this.backingUp)
            return this.getStatus();
        this.backingUp = true;
        const abortController = new AbortController();
        this.backupAbortController = abortController;
        const operationSignal = signal
            ? AbortSignal.any([signal, abortController.signal, this.shutdownController.signal])
            : AbortSignal.any([abortController.signal, this.shutdownController.signal]);
        const operation = this.queueOperation((queueSignal) => this.runBackup(AbortSignal.any([operationSignal, queueSignal]), kind));
        this.backupPromise = operation;
        try {
            return await operation;
        }
        finally {
            this.backingUp = false;
            this.backupPromise = null;
            if (this.backupAbortController === abortController)
                this.backupAbortController = null;
        }
    }
    startBackupJob(kind = 'manual', warningAcknowledged = false) {
        if (this.restoreInvalidationActive())
            throw createDriveError('conflict');
        if (this.readSettings().google_drive_revoke_status === 'unconfirmed')
            throw createDriveError('not_connected');
        if (this.operationRunning || this.activeJobs.size > 0)
            throw createDriveError('conflict');
        if (kind === 'manual' &&
            !warningAcknowledged &&
            this.readSettings()[exports.DRIVE_WARNING_SETTING] !== 'true')
            throw createDriveError('warning_acknowledgement_required');
        if (kind === 'manual' &&
            parsePending(this.readSettings().google_drive_pending_upload)?.kind === 'automatic')
            throw createDriveError('conflict');
        if (warningAcknowledged)
            this.acknowledgeWarning();
        const jobId = crypto.randomUUID();
        const controller = new AbortController();
        this.jobControllers.set(jobId, controller);
        this.writeJob({ id: jobId, operation: 'backup', kind, state: 'queued', updated_at: (0, db_1.now)() });
        const job = this.queueOperation((queueSignal) => this.runBackup(AbortSignal.any([controller.signal, queueSignal]), kind, jobId), false, false, jobId);
        this.trackJob(job);
        void job.finally(() => this.jobControllers.delete(jobId)).catch(() => { });
        return this.getStatus();
    }
    getJob(jobId) {
        try {
            const job = parseJob(this.readSettings().google_drive_job);
            if (job?.id === jobId)
                return job;
        }
        catch { }
        const fallback = readRestoreJobResult() || readCommittedRestoreJobResult();
        return fallback?.id === jobId ? fallback : null;
    }
    cancelJob(jobId) {
        const controller = this.jobControllers.get(jobId);
        const job = parseJob(this.readSettings().google_drive_job);
        if (!job || job.id !== jobId)
            throw createDriveError('unknown');
        if (!['queued', 'snapshot_created', 'uploading', 'restoring'].includes(job.state))
            throw createDriveError('conflict');
        const pending = parsePending(this.readSettings().google_drive_pending_upload);
        controller?.abort();
        if (job.state === 'queued' || !controller)
            this.writeJob({ ...job, state: 'cancelled', error_code: 'cancelled', updated_at: (0, db_1.now)() });
        else if (job.operation === 'backup' && pending) {
            pending.next_retry_at = nextBackupRetryAt(pending.attempt_count || 1);
            (0, db_1.upsertSettings)({
                google_drive_pending_upload: JSON.stringify(pending),
                google_drive_next_retry_at: pending.next_retry_at,
                google_drive_last_backup_status: 'error',
                google_drive_last_error_code: 'cancelled',
            });
            this.writeJob({
                ...job,
                state: 'offline_pending',
                error_code: 'cancelled',
                updated_at: (0, db_1.now)(),
            });
        }
        else {
            this.writeJob({ ...job, state: 'cancelled', error_code: 'cancelled', updated_at: (0, db_1.now)() });
        }
        return this.getStatus();
    }
    async listRemoteBackupsPage(options = {}) {
        if (options.limit !== undefined &&
            (typeof options.limit !== 'number' ||
                !Number.isSafeInteger(options.limit) ||
                options.limit < 1 ||
                options.limit > 100)) {
            const error = new Error('Invalid backup pagination limit');
            error.code = 'ERR_INVALID_BACKUP_PAGINATION';
            throw error;
        }
        const cursor = options.cursor !== undefined ? (0, db_1.decodeBackupCursor)(options.cursor) : null;
        return this.queueOperation(async (signal) => {
            const marker = this.ensureInstallationMarker();
            const envelope = this.readTokenEnvelope();
            if (envelope?.installation_id && envelope.installation_id !== marker)
                throw createDriveError('reauth_required');
            const client = await this.getAuthorizedClient(signal);
            const settings = this.readSettings();
            const current = settings.google_drive_destination_folder_id || settings.google_drive_folder_id;
            const folders = [
                ...new Set([current, ...this.readOwnedDestinations()].filter((value) => Boolean(value))),
            ];
            const result = [];
            for (const folderId of folders) {
                try {
                    const files = await this.listFilesInDestination((0, drive_1.drive)({ version: 'v3', auth: client }), folderId, signal, {
                        query: `appProperties has { key='flo_marker_version' and value='${MARKER_VERSION}' } and appProperties has { key='flo_installation_id' and value='${marker}' }`,
                    });
                    for (const file of files) {
                        const backup = this.toRemoteBackup(file, folderId);
                        if (backup)
                            result.push(backup);
                    }
                }
                catch (error) {
                    const classified = classifyDriveError(error);
                    if (classified.code === 'destination_invalid' || isMissingDestinationError(error))
                        continue;
                    throw classified;
                }
            }
            result.sort((a, b) => {
                if (a.created_at !== b.created_at)
                    return a.created_at < b.created_at ? 1 : -1;
                return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
            });
            const filtered = cursor
                ? result.filter((entry) => entry.created_at < cursor.createdAt ||
                    (entry.created_at === cursor.createdAt && entry.id < cursor.id))
                : result;
            const limit = options.limit;
            const sliced = limit !== undefined ? filtered.slice(0, limit + 1) : filtered;
            const hasMore = limit !== undefined && sliced.length > limit;
            const backups = limit !== undefined ? sliced.slice(0, limit) : sliced;
            const last = backups[backups.length - 1];
            const nextCursor = hasMore && last ? (0, db_1.encodeBackupCursor)(last.created_at, last.id) : null;
            return { backups, nextCursor, hasMore };
        });
    }
    async listRemoteBackups(options) {
        if (options === undefined) {
            return (await this.listRemoteBackupsPage()).backups;
        }
        return this.listRemoteBackupsPage(options);
    }
    startRestoreJob(input) {
        if (input.confirmation !== exports.DRIVE_RESTORE_CONFIRMATION || !safeId(input.fileId))
            throw createDriveError('restore_validation_failed');
        if (this.restoreInvalidationActive())
            throw createDriveError('conflict');
        if (this.readSettings().google_drive_revoke_status === 'unconfirmed')
            throw createDriveError('not_connected');
        if (this.operationRunning || this.activeJobs.size > 0)
            throw createDriveError('conflict');
        const jobId = crypto.randomUUID();
        const controller = new AbortController();
        this.jobControllers.set(jobId, controller);
        this.writeJob({ id: jobId, operation: 'restore', state: 'queued', updated_at: (0, db_1.now)() });
        const job = this.queueOperation((queueSignal) => this.runRestore(AbortSignal.any([controller.signal, queueSignal]), jobId, input), false, false, jobId);
        this.trackJob(job);
        void job.finally(() => this.jobControllers.delete(jobId)).catch(() => { });
        return this.getStatus();
    }
    async runBackup(signal, kind, jobId) {
        (0, db_1.upsertSettings)({
            google_drive_last_attempt_at: new Date().toISOString(),
            google_drive_last_error_code: '',
            google_drive_next_retry_at: '',
        });
        let pending = parsePending(this.readSettings().google_drive_pending_upload);
        const persistedJob = parseJob(this.readSettings().google_drive_job);
        const trackedJobId = jobId ||
            (persistedJob?.operation === 'backup' &&
                ['offline_pending', 'retention_pending'].includes(persistedJob.state)
                ? persistedJob.id
                : undefined);
        const backupKind = pending?.kind || kind;
        let stagedPath = '';
        try {
            let snapshot;
            if (pending) {
                if (pending.kind === 'automatic' && kind === 'manual')
                    throw createDriveError('conflict');
                snapshot = await this.snapshotFromPending(pending, signal);
            }
            else {
                if (jobId)
                    this.writeJob({
                        id: jobId,
                        operation: 'backup',
                        kind: backupKind,
                        state: 'snapshot_created',
                        updated_at: (0, db_1.now)(),
                    });
                stagedPath = createUploadStagingPath();
                const result = await waitForDriveOperation((operationSignal) => (0, db_1.createBackup)(stagedPath, operationSignal, {
                    stagingDirectory: path.dirname(stagedPath),
                }), signal, GOOGLE_DRIVE_SNAPSHOT_TIMEOUT_MS, 'Google Drive local backup', (operation) => this.trackDriveOperation(operation), () => this.stopping, shutdown_1.SHUTDOWN_TIMEOUT_MS);
                const metadata = (0, db_1.getBackupMetadata)(result.path);
                if (metadata.schemaVersion === null || !metadata.appVersion || !metadata.backupCreatedAt) {
                    removeStagingFile(result.path);
                    throw createDriveError('local_snapshot_failed');
                }
                let hash;
                try {
                    hash = await hashBackupFile(result.path);
                }
                catch (error) {
                    removeStagingFile(result.path);
                    throw error;
                }
                snapshot = {
                    path: result.path,
                    fileName: path.basename(result.path),
                    sha256: hash.sha256,
                    byteCount: hash.byteCount,
                    schemaVersion: metadata.schemaVersion,
                    appVersion: metadata.appVersion,
                    backupCreatedAt: metadata.backupCreatedAt,
                };
                const nextRetryAt = nextBackupRetryAt(1);
                pending = {
                    run_id: crypto.randomUUID(),
                    kind: backupKind,
                    local_path: result.path,
                    sha256: snapshot.sha256,
                    byte_count: snapshot.byteCount,
                    schema_version: snapshot.schemaVersion,
                    app_version: snapshot.appVersion,
                    backup_created_at: snapshot.backupCreatedAt,
                    destination_folder_id: this.readSettings().google_drive_destination_folder_id ||
                        this.readSettings().google_drive_folder_id ||
                        '',
                    attempt_count: 0,
                    next_retry_at: nextRetryAt,
                };
                (0, db_1.upsertSettings)({
                    google_drive_pending_upload: JSON.stringify(pending),
                    google_drive_next_retry_at: nextRetryAt,
                });
            }
            this.throwIfStopping(signal);
            if (jobId)
                this.writeJob({
                    id: jobId,
                    operation: 'backup',
                    kind: backupKind,
                    state: 'uploading',
                    bytes_sent: 0,
                    total_bytes: snapshot.byteCount,
                    updated_at: (0, db_1.now)(),
                });
            const client = await this.getAuthorizedClient(signal);
            const driveClient = (0, drive_1.drive)({ version: 'v3', auth: client });
            const destinationId = await this.resolveDestinationForUpload(driveClient, signal);
            if (!pending)
                throw createDriveError('unknown');
            pending.destination_folder_id = destinationId;
            pending.attempt_count += 1;
            pending.next_retry_at = nextBackupRetryAt(pending.attempt_count);
            (0, db_1.upsertSettings)({
                google_drive_pending_upload: JSON.stringify(pending),
                google_drive_next_retry_at: pending.next_retry_at,
            });
            const remote = await this.uploadSnapshot(driveClient, snapshot, pending, signal, jobId);
            this.throwIfStopping(signal);
            if (jobId) {
                const currentJob = parseJob(this.readSettings().google_drive_job);
                if (!currentJob || currentJob.id !== jobId || currentJob.state !== 'uploading')
                    throw createDriveError('cancelled');
            }
            const successAt = new Date().toISOString();
            (0, db_1.upsertSettings)({
                google_drive_destination_folder_id: destinationId,
                google_drive_folder_id: destinationId,
                google_drive_last_backup_at: successAt,
                google_drive_last_success_at: successAt,
                google_drive_last_automatic_backup_at: backupKind === 'automatic'
                    ? successAt
                    : this.readSettings().google_drive_last_automatic_backup_at || '',
                google_drive_last_success_kind: backupKind,
                google_drive_last_backup_status: 'success',
                google_drive_last_error_code: 'retention_pending',
                google_drive_next_retry_at: '',
                google_drive_retention_status: 'pending',
                google_drive_retention_retry_count: '',
            });
            if (trackedJobId)
                this.writeJob({
                    id: trackedJobId,
                    operation: 'backup',
                    kind: backupKind,
                    state: 'retention_pending',
                    remote_id: remote.id,
                    bytes_sent: snapshot.byteCount,
                    total_bytes: snapshot.byteCount,
                    updated_at: (0, db_1.now)(),
                });
            removeStagingFile(snapshot.path);
            (0, db_1.upsertSettings)({ google_drive_pending_upload: '' });
            let retentionPending = false;
            try {
                await this.applyRetention(driveClient, signal);
                (0, db_1.upsertSettings)({
                    google_drive_retention_status: '',
                    google_drive_retention_retry_count: '',
                    google_drive_next_retry_at: '',
                    google_drive_last_error_code: '',
                });
            }
            catch (error) {
                const classified = classifyDriveError(error);
                if (classified.code === 'cancelled')
                    throw classified;
                if (classified.retryable) {
                    retentionPending = true;
                    this.scheduleRetentionRetry();
                }
                else {
                    (0, db_1.upsertSettings)({
                        google_drive_retention_status: 'error',
                        google_drive_retention_retry_count: '',
                        google_drive_next_retry_at: '',
                        google_drive_last_error_code: classified.code,
                    });
                }
            }
            if (trackedJobId)
                this.writeJob({
                    id: trackedJobId,
                    operation: 'backup',
                    kind: backupKind,
                    state: retentionPending ? 'retention_pending' : 'succeeded',
                    remote_id: remote.id,
                    bytes_sent: snapshot.byteCount,
                    total_bytes: snapshot.byteCount,
                    updated_at: (0, db_1.now)(),
                });
            return this.getStatus();
        }
        catch (error) {
            const missingDestination = isMissingDestinationError(error);
            const classified = missingDestination
                ? createDriveError('destination_required')
                : classifyDriveError(error);
            if (classified.code === 'cancelled' && this.stopping)
                throw createDriveShutdownError('Google Drive backup');
            pending = parsePending(this.readSettings().google_drive_pending_upload);
            if (!pending)
                removeStagingFile(stagedPath);
            const discardPending = classified.code === 'local_file_missing';
            if (pending && discardPending) {
                removeStagingFile(pending.local_path);
                (0, db_1.upsertSettings)({ google_drive_pending_upload: '' });
            }
            const cancelledWithPending = classified.code === 'cancelled' && Boolean(pending);
            const retryPaused = missingDestination ||
                classified.code === 'destination_invalid' ||
                classified.code === 'reauth_required' ||
                classified.code === 'permission_denied' ||
                classified.code === 'duplicate_upload';
            const nextRetry = retryPaused
                ? ''
                : classified.retryable || cancelledWithPending
                    ? nextBackupRetryAt(pending?.attempt_count || 1)
                    : '';
            if (pending && retryPaused) {
                pending.next_retry_at = null;
                (0, db_1.upsertSettings)({ google_drive_pending_upload: JSON.stringify(pending) });
            }
            if (pending && (classified.retryable || cancelledWithPending)) {
                pending.next_retry_at = nextRetry;
                (0, db_1.upsertSettings)({ google_drive_pending_upload: JSON.stringify(pending) });
            }
            (0, db_1.upsertSettings)({
                google_drive_last_backup_status: 'error',
                google_drive_last_error_code: classified.code,
                google_drive_next_retry_at: nextRetry,
            });
            if (trackedJobId)
                this.writeJob({
                    id: trackedJobId,
                    operation: 'backup',
                    kind,
                    state: cancelledWithPending || classified.retryable
                        ? 'offline_pending'
                        : classified.code === 'cancelled'
                            ? 'cancelled'
                            : 'failed',
                    error_code: classified.code,
                    updated_at: (0, db_1.now)(),
                });
            if (classified.code === 'cancelled' || classified.code === 'conflict')
                throw classified;
            return this.getStatus();
        }
    }
    async snapshotFromPending(pending, signal) {
        this.throwIfStopping(signal);
        if (!(0, db_1.isManagedBackupFile)(pending.local_path) && !isUploadStagingFile(pending.local_path)) {
            (0, db_1.upsertSettings)({
                google_drive_pending_upload: '',
                google_drive_last_error_code: 'local_file_missing',
            });
            throw createDriveError('local_file_missing');
        }
        const metadata = (0, db_1.getBackupMetadata)(pending.local_path);
        const hash = await hashBackupFile(pending.local_path);
        if (metadata.schemaVersion === null ||
            !metadata.appVersion ||
            !metadata.backupCreatedAt ||
            metadata.schemaVersion !== pending.schema_version ||
            metadata.appVersion !== pending.app_version ||
            hash.sha256 !== pending.sha256 ||
            hash.byteCount !== pending.byte_count)
            throw createDriveError('local_file_missing');
        return {
            path: pending.local_path,
            fileName: path.basename(pending.local_path),
            sha256: hash.sha256,
            byteCount: hash.byteCount,
            schemaVersion: metadata.schemaVersion,
            appVersion: metadata.appVersion,
            backupCreatedAt: metadata.backupCreatedAt,
        };
    }
    scheduleRetentionRetry() {
        const settings = this.readSettings();
        const previousAttempt = Number.parseInt(settings.google_drive_retention_retry_count || '', 10);
        const attempt = Number.isSafeInteger(previousAttempt) && previousAttempt >= 0 ? previousAttempt + 1 : 1;
        const delay = Math.min(RETENTION_RETRY_MAX_MS, RETENTION_RETRY_BASE_MS * 2 ** Math.min(attempt - 1, 8));
        (0, db_1.upsertSettings)({
            google_drive_retention_status: 'pending',
            google_drive_retention_retry_count: String(attempt),
            google_drive_next_retry_at: new Date(Date.now() + delay).toISOString(),
            google_drive_last_error_code: 'retention_pending',
        });
    }
    retryPendingRetention() {
        return this.queueOperation(async (signal) => {
            try {
                const operationSignal = AbortSignal.any([this.shutdownController.signal, signal]);
                const client = await this.getAuthorizedClient(operationSignal);
                await this.applyRetention((0, drive_1.drive)({ version: 'v3', auth: client }), operationSignal);
                const job = parseJob(this.readSettings().google_drive_job);
                if (job?.state === 'retention_pending')
                    this.writeJob({ ...job, state: 'succeeded', updated_at: (0, db_1.now)() });
                (0, db_1.upsertSettings)({
                    google_drive_retention_status: '',
                    google_drive_retention_retry_count: '',
                    google_drive_next_retry_at: '',
                    google_drive_last_error_code: '',
                });
            }
            catch (error) {
                if (this.stopping || signal.aborted)
                    throw error;
                const classified = classifyDriveError(error);
                if (classified.retryable) {
                    this.scheduleRetentionRetry();
                    return;
                }
                const job = parseJob(this.readSettings().google_drive_job);
                if (job?.state === 'retention_pending')
                    this.writeJob({ ...job, state: 'succeeded', error_code: undefined, updated_at: (0, db_1.now)() });
                (0, db_1.upsertSettings)({
                    google_drive_retention_status: 'error',
                    google_drive_retention_retry_count: '',
                    google_drive_next_retry_at: '',
                    google_drive_last_error_code: classified.code,
                });
            }
        });
    }
    async uploadSnapshot(driveClient, snapshot, pending, signal, jobId) {
        const marker = this.ensureInstallationMarker();
        const matching = await this.findMatchingUploads(driveClient, pending.destination_folder_id, pending.run_id, marker, signal);
        if (matching.length > 1)
            throw createDriveError('duplicate_upload');
        if (matching.length === 1) {
            if (this.remoteMatchesSnapshot(matching[0], snapshot, pending))
                return { id: String(matching[0].id) };
            throw createDriveError('duplicate_upload');
        }
        const appProperties = {
            flo_marker_version: MARKER_VERSION,
            flo_installation_id: marker,
            flo_backup_run_id: pending.run_id,
            flo_backup_kind: pending.kind,
            flo_payload_version: 'sqlite-full-v1',
            flo_schema_version: String(snapshot.schemaVersion),
            flo_app_version: snapshot.appVersion,
            flo_backup_created_at: snapshot.backupCreatedAt,
            flo_byte_count: String(snapshot.byteCount),
            flo_sha256: snapshot.sha256,
            flo_destination_folder_id: pending.destination_folder_id,
        };
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            this.throwIfStopping(signal);
            try {
                const stream = fs.createReadStream(snapshot.path, { flags: 'r' });
                const remoteFileName = this.resolveRemoteFileName(snapshot, pending.kind);
                const response = await driveClient.files.create({
                    requestBody: {
                        name: remoteFileName,
                        parents: [pending.destination_folder_id],
                        appProperties,
                        mimeType: 'application/x-sqlite3',
                    },
                    media: { mimeType: 'application/x-sqlite3', body: stream },
                    fields: 'id,appProperties,size,createdTime,name,parents,trashed,mimeType',
                }, {
                    resumable: true,
                    signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                    timeout: DRIVE_REQUEST_TIMEOUT_MS,
                    onUploadProgress: (event) => {
                        if (jobId) {
                            const job = parseJob(this.readSettings().google_drive_job);
                            if (job?.id === jobId)
                                this.writeJob({
                                    ...job,
                                    state: 'uploading',
                                    bytes_sent: Math.min(snapshot.byteCount, event.bytesRead || 0),
                                    total_bytes: snapshot.byteCount,
                                    updated_at: (0, db_1.now)(),
                                });
                        }
                    },
                });
                const id = String(response.data.id || '');
                if (safeId(id))
                    return { id };
                const reconciled = await this.findMatchingUploads(driveClient, pending.destination_folder_id, pending.run_id, marker, signal);
                if (reconciled.length === 1 && this.remoteMatchesSnapshot(reconciled[0], snapshot, pending))
                    return { id: String(reconciled[0].id) };
                throw createDriveError('upload_failed', true);
            }
            catch (error) {
                lastError = error;
                const reconciled = await this.findMatchingUploads(driveClient, pending.destination_folder_id, pending.run_id, marker, signal).catch((reconciliationError) => {
                    if (isMissingDestinationError(reconciliationError)) {
                        const missing = createDriveError('destination_invalid');
                        missing.destination_missing = true;
                        throw missing;
                    }
                    return [];
                });
                if (reconciled.length === 1 && this.remoteMatchesSnapshot(reconciled[0], snapshot, pending))
                    return { id: String(reconciled[0].id) };
                const classified = classifyDriveError(error);
                if (!classified.retryable || attempt === 2)
                    throw classified;
                await this.delayWithSignal(250 * 2 ** attempt, signal);
            }
        }
        throw classifyDriveError(lastError);
    }
    async applyRetention(driveClient, signal) {
        const marker = this.ensureInstallationMarker();
        const retentionCount = this.retentionFromSettings(this.readSettings());
        const newest = [];
        let retryPending = false;
        for (const folderId of this.readOwnedDestinations()) {
            try {
                await this.listFilesInDestination(driveClient, folderId, signal, {
                    query: `appProperties has { key='flo_marker_version' and value='${MARKER_VERSION}' } and appProperties has { key='flo_installation_id' and value='${marker}' } and appProperties has { key='flo_backup_kind' and value='automatic' } and appProperties has { key='flo_destination_folder_id' and value='${folderId}' }`,
                    onFile: async (file) => {
                        const properties = this.appProperties(file);
                        if (properties.flo_installation_id !== marker ||
                            properties.flo_backup_kind !== 'automatic' ||
                            properties.flo_destination_folder_id !== folderId ||
                            !safeId(String(file.id || '')))
                            return;
                        newest.push({
                            id: String(file.id),
                            createdTime: String(file.createdTime || properties.flo_backup_created_at || ''),
                        });
                        newest.sort((a, b) => b.createdTime.localeCompare(a.createdTime) || b.id.localeCompare(a.id));
                        if (newest.length > retentionCount) {
                            const fileId = newest.pop()?.id;
                            if (!fileId)
                                return;
                            this.throwIfStopping(signal);
                            try {
                                await driveClient.files.update({ fileId, requestBody: { trashed: true }, fields: 'id,trashed' }, {
                                    signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                                    timeout: DRIVE_REQUEST_TIMEOUT_MS,
                                });
                            }
                            catch (error) {
                                const classified = classifyDriveError(error);
                                if (classified.code === 'reauth_required' ||
                                    classified.code === 'permission_denied')
                                    throw classified;
                                throw createDriveError('retention_pending', true);
                            }
                        }
                    },
                });
            }
            catch (error) {
                const classified = classifyDriveError(error);
                if (classified.code === 'retention_pending' || classified.code === 'cancelled')
                    throw classified;
                if (isMissingDestinationError(error))
                    continue;
                else if (classified.code === 'permission_denied' || classified.code === 'reauth_required')
                    throw classified;
                else if (classified.retryable)
                    retryPending = true;
                else
                    throw classified;
            }
        }
        if (retryPending)
            throw createDriveError('retention_pending', true);
    }
    async runRestore(signal, jobId, input) {
        let stagingPath = '';
        let restoreInvalidationStarted = false;
        let committedJob = null;
        let statusFallback = null;
        try {
            try {
                statusFallback = this.getStatus();
            }
            catch { }
            this.writeJob({ id: jobId, operation: 'restore', state: 'restoring', updated_at: (0, db_1.now)() });
            const marker = this.ensureInstallationMarker();
            const client = await this.getAuthorizedClient(signal);
            const driveClient = (0, drive_1.drive)({ version: 'v3', auth: client });
            const remote = await this.getRemoteFile(driveClient, input.fileId, marker, signal);
            if (!remote)
                throw createDriveError('restore_validation_failed');
            const properties = this.appProperties(remote);
            const expectedHash = input.expectedSha256 || properties.flo_sha256;
            const expectedSize = Number(properties.flo_byte_count || remote.size || 0);
            const remoteSchema = Number(properties.flo_schema_version);
            const remoteAppVersion = properties.flo_app_version;
            if (remote.mimeType !== 'application/x-sqlite3' ||
                !expectedHash ||
                !/^[a-f0-9]{64}$/.test(expectedHash) ||
                properties.flo_sha256 !== expectedHash ||
                !Number.isSafeInteger(expectedSize) ||
                expectedSize <= 0 ||
                !Number.isSafeInteger(remoteSchema) ||
                !remoteAppVersion ||
                !['automatic', 'manual'].includes(properties.flo_backup_kind))
                throw createDriveError('restore_validation_failed');
            const versionComparison = compareAppVersions(remoteAppVersion, electron_1.app.getVersion());
            if (versionComparison === null ||
                versionComparison > 0 ||
                remoteSchema > (0, db_1.getCurrentSchemaVersion)())
                throw createDriveError('restore_validation_failed');
            stagingPath = await this.downloadRemoteFile(driveClient, input.fileId, expectedSize, signal, jobId);
            const hash = await hashStagedFile(stagingPath);
            if (hash.byteCount !== expectedSize || hash.sha256 !== expectedHash)
                throw createDriveError('restore_validation_failed');
            const metadata = (0, db_1.getBackupMetadata)(stagingPath);
            if (metadata.schemaVersion !== remoteSchema ||
                metadata.appVersion !== remoteAppVersion ||
                metadata.schemaVersion === null)
                throw createDriveError('restore_validation_failed');
            const forceDirect = remoteSchema === (0, db_1.getCurrentSchemaVersion)();
            await this.beginDatabaseRestoreInvalidation(jobId);
            restoreInvalidationStarted = true;
            const restoreResult = await (0, db_1.withDatabaseMaintenanceLock)(async (maintenanceSignal) => {
                const result = (0, db_1.restoreBackup)(stagingPath, forceDirect, maintenanceSignal);
                if (result.success) {
                    const cleanup = this.completeDatabaseRestore();
                    if (!cleanup.cleanupPending)
                        restoreInvalidationStarted = false;
                }
                return result;
            }, signal);
            if (!restoreResult.success) {
                this.writeJob({
                    id: jobId,
                    operation: 'restore',
                    state: 'failed',
                    error_code: 'restore_failed',
                    updated_at: (0, db_1.now)(),
                });
                return this.getStatus();
            }
            committedJob = { id: jobId, operation: 'restore', state: 'succeeded', updated_at: (0, db_1.now)() };
            const cleanupPending = restoreResult.cleanupPending === true || restoreInvalidationStarted;
            if (cleanupPending)
                persistRestoreJobResult(committedJob);
            try {
                (0, security_1.clearUserAuthCache)();
                (0, security_1.clearInMemoryRevokedTokens)();
                (0, jwt_secret_1.clearJWTSecretCache)();
                (0, db_1.upsertSettings)({ google_drive_pending_upload: '', google_drive_job: '' });
                this.writeJob(committedJob);
                clearRestoreJobResult();
                return this.getStatus();
            }
            catch {
                try {
                    persistRestoreJobResult(committedJob);
                }
                catch (persistError) {
                    console.error('[Google Drive] Committed restore job persistence failed:', persistError);
                }
                return this.statusWithJobFallback(committedJob, statusFallback);
            }
        }
        catch (error) {
            if (committedJob) {
                try {
                    persistRestoreJobResult(committedJob);
                }
                catch (persistError) {
                    console.error('[Google Drive] Committed restore job persistence failed:', persistError);
                }
                return this.statusWithJobFallback(committedJob, statusFallback);
            }
            const classified = classifyDriveError(error);
            if (classified.code === 'cancelled')
                this.writeJob({
                    id: jobId,
                    operation: 'restore',
                    state: 'cancelled',
                    error_code: 'cancelled',
                    updated_at: (0, db_1.now)(),
                });
            if (classified.code === 'cancelled' && this.stopping)
                throw createDriveShutdownError('Google Drive restore');
            if (classified.code !== 'cancelled')
                this.writeJob({
                    id: jobId,
                    operation: 'restore',
                    state: 'failed',
                    error_code: classified.code,
                    updated_at: (0, db_1.now)(),
                });
            return this.getStatus();
        }
        finally {
            if (restoreInvalidationStarted) {
                try {
                    this.clearDatabaseRestoreInvalidation();
                    restoreInvalidationStarted = false;
                }
                catch (cleanupError) {
                    console.error('[Google Drive] Restore invalidation cleanup failed:', cleanupError);
                }
            }
            if (stagingPath)
                await removeDownloadStagingFileWithRetry(stagingPath);
        }
    }
    async downloadRemoteFile(driveClient, fileId, expectedSize, signal, jobId) {
        fs.mkdirSync(getStagingDir(), { recursive: true, mode: 0o700 });
        const stagingPath = path.join(getStagingDir(), `download-${crypto.randomUUID()}.db`);
        const response = await driveClient.files.get({ fileId, alt: 'media' }, {
            responseType: 'stream',
            signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
            timeout: DRIVE_REQUEST_TIMEOUT_MS,
        });
        const output = fs.createWriteStream(stagingPath, { flags: 'wx', mode: 0o600 });
        const outputError = new Promise((_, reject) => output.once('error', reject));
        void outputError.catch(() => { });
        let bytes = 0;
        try {
            for await (const chunk of response.data) {
                this.throwIfStopping(signal);
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                bytes += buffer.byteLength;
                if (bytes > expectedSize)
                    throw createDriveError('restore_validation_failed');
                if (!output.write(buffer))
                    await Promise.race([(0, node_events_1.once)(output, 'drain'), outputError]);
                const job = parseJob(this.readSettings().google_drive_job);
                if (job?.id === jobId)
                    this.writeJob({
                        ...job,
                        state: 'restoring',
                        bytes_sent: bytes,
                        total_bytes: expectedSize,
                        updated_at: (0, db_1.now)(),
                    });
            }
            output.end();
            await Promise.race([(0, node_events_1.once)(output, 'close'), outputError]);
            if (bytes !== expectedSize)
                throw createDriveError('restore_validation_failed');
            return stagingPath;
        }
        catch (error) {
            try {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Google Drive restore stream close timed out')), shutdown_1.SHUTDOWN_TIMEOUT_MS);
                    output.destroy();
                    clearTimeout(timeout);
                    resolve();
                });
            }
            catch { }
            await removeDownloadStagingFileWithRetry(stagingPath);
            throw error;
        }
    }
    async getRemoteFile(driveClient, fileId, marker, signal) {
        if (!safeId(fileId))
            throw createDriveError('restore_validation_failed');
        try {
            const response = await driveClient.files.get({ fileId, fields: 'id,name,createdTime,size,mimeType,parents,trashed,appProperties' }, {
                signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                timeout: DRIVE_REQUEST_TIMEOUT_MS,
            });
            const file = response.data;
            const properties = this.appProperties(file);
            const folderId = String(properties.flo_destination_folder_id || '');
            if (file.trashed ||
                properties.flo_installation_id !== marker ||
                !safeId(folderId) ||
                !this.readOwnedDestinations().includes(folderId))
                return null;
            return file;
        }
        catch (error) {
            const classified = classifyDriveError(error);
            if (classified.code !== 'unknown' || classified.retryable)
                throw classified;
            throw createDriveError('restore_validation_failed');
        }
    }
    async resolveDestinationForUpload(driveClient, signal) {
        const settings = this.readSettings();
        const folderId = settings.google_drive_destination_folder_id || settings.google_drive_folder_id;
        const marker = this.ensureInstallationMarker();
        if (folderId && safeId(folderId)) {
            try {
                const destination = await this.validateDestination(driveClient, folderId, marker, signal);
                if (destination.id === folderId)
                    return destination.id;
            }
            catch (error) {
                if (!isMissingDestinationError(error) &&
                    classifyDriveError(error).code !== 'destination_invalid') {
                    throw error;
                }
            }
        }
        let destination = await this.findExistingAppFolder(driveClient, marker, signal);
        if (!destination) {
            destination = await this.createAppFolder(driveClient, marker, signal);
        }
        this.rememberDestination(destination.id);
        (0, db_1.upsertSettings)({
            google_drive_destination_folder_id: destination.id,
            google_drive_destination_folder_name: destination.name,
            google_drive_folder_id: destination.id,
            google_drive_last_error_code: '',
        });
        return destination.id;
    }
    async validateDestination(driveClient, folderId, marker, signal) {
        if (!safeId(folderId))
            throw createDriveError('destination_invalid');
        try {
            const response = await driveClient.files.get({ fileId: folderId, fields: 'id,name,mimeType,trashed,capabilities,appProperties' }, {
                signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                timeout: DRIVE_REQUEST_TIMEOUT_MS,
            });
            const file = response.data;
            const owned = file.appProperties?.flo_installation_id === marker ||
                this.readOwnedDestinations().includes(folderId);
            if (file.trashed) {
                const missing = createDriveError('destination_invalid');
                missing.destination_missing = true;
                throw missing;
            }
            if (!file.id ||
                file.mimeType !== 'application/vnd.google-apps.folder' ||
                file.capabilities?.canAddChildren === false ||
                !owned)
                throw createDriveError('destination_invalid');
            return { id: file.id, name: file.name || exports.DRIVE_BACKUP_FOLDER_NAME, owned };
        }
        catch (error) {
            if (isMissingDestinationError(error))
                throw error;
            if (providerStatus(error) === 404) {
                const missing = createDriveError('destination_invalid');
                missing.destination_missing = true;
                throw missing;
            }
            const classified = classifyDriveError(error);
            if (classified.retryable ||
                classified.code === 'permission_denied' ||
                classified.code === 'destination_invalid')
                throw classified;
            throw createDriveError('destination_required');
        }
    }
    async findExistingAppFolder(driveClient, marker, signal) {
        if (!safeId(marker))
            return null;
        try {
            const escapedMarker = marker.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const response = await driveClient.files.list({
                q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='flo_installation_id' and value='${escapedMarker}' }`,
                fields: 'files(id,name,mimeType,trashed,capabilities,appProperties)',
                pageSize: 10,
            }, {
                signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                timeout: DRIVE_REQUEST_TIMEOUT_MS,
            });
            const files = response.data.files || [];
            for (const file of files) {
                if (file.id &&
                    safeId(file.id) &&
                    file.capabilities?.canAddChildren !== false &&
                    file.appProperties?.flo_destination_kind !== 'flocafe_menu') {
                    return { id: file.id, name: file.name || this.resolveBackupFolderName(), owned: true };
                }
            }
            const folderName = this.resolveBackupFolderName();
            const escapedName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const nameResponse = await driveClient.files.list({
                q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '${escapedName}'`,
                fields: 'files(id,name,mimeType,trashed,capabilities,appProperties)',
                pageSize: 10,
            }, {
                signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                timeout: DRIVE_REQUEST_TIMEOUT_MS,
            });
            const nameFiles = nameResponse.data.files || [];
            for (const file of nameFiles) {
                if (file.id && safeId(file.id) && file.capabilities?.canAddChildren !== false) {
                    return { id: file.id, name: file.name || folderName, owned: true };
                }
            }
            return null;
        }
        catch {
            return null;
        }
    }
    resolveBackupFolderName() {
        const businessName = this.readSettings().business_name;
        const sanitized = (businessName || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return sanitized ? `${sanitized}_flocafe_backups` : 'flocafe_backups';
    }
    resolveRemoteFileName(snapshot, kind) {
        const businessName = this.readSettings().business_name;
        const sanitized = (businessName || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const prefix = sanitized ? `${sanitized}_backup` : 'flo_backup';
        const timestamp = (snapshot.backupCreatedAt || new Date().toISOString())
            .replace(/[:.]/g, '-')
            .replace(/Z$/, '');
        return `${prefix}_${timestamp}_${kind}.db`;
    }
    async createAppFolder(driveClient, marker, signal) {
        try {
            const folderName = this.resolveBackupFolderName();
            const response = await driveClient.files.create({
                requestBody: {
                    name: folderName,
                    mimeType: 'application/vnd.google-apps.folder',
                    appProperties: {
                        flo_marker_version: MARKER_VERSION,
                        flo_installation_id: marker,
                        flo_destination_kind: 'flocafe',
                    },
                },
                fields: 'id,name,mimeType,trashed,capabilities,appProperties',
            }, {
                signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                timeout: DRIVE_REQUEST_TIMEOUT_MS,
            });
            const file = response.data;
            if (!file.id || !safeId(file.id))
                throw createDriveError('destination_required');
            return { id: file.id, name: file.name || folderName, owned: true };
        }
        catch (error) {
            const classified = classifyDriveError(error);
            if (classified.retryable)
                throw classified;
            throw classified.code === 'unknown' ? createDriveError('destination_required') : classified;
        }
    }
    async fetchAccountIdentity(client, signal) {
        try {
            const accessToken = (await waitForDriveOperation(() => client.getAccessToken(), signal, DRIVE_REQUEST_TIMEOUT_MS, 'Google Drive access token refresh')).token;
            if (!accessToken)
                throw createDriveError('reauth_required');
            const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
            });
            if (!response.ok) {
                const error = new Error('Google account identity request failed');
                error.status = response.status;
                throw error;
            }
            const data = (await response.json());
            return {
                subject: typeof data.sub === 'string' ? data.sub : null,
                email: typeof data.email === 'string' ? data.email : null,
            };
        }
        catch (error) {
            throw classifyDriveError(error);
        }
    }
    async getAuthorizedClient(signal) {
        if (signal?.aborted)
            throw createDriveShutdownError('Google Drive operation');
        if ((0, offline_mode_1.isOfflineMode)())
            throw createDriveError('offline');
        const creds = getClientCredentials();
        if (!creds)
            throw createDriveError('configuration_unavailable');
        if (!isSecureStorageAvailable())
            throw createDriveError('secure_storage_unavailable');
        const envelope = this.readTokenEnvelope();
        const marker = this.ensureInstallationMarker();
        if (!envelope)
            throw createDriveError('not_connected');
        if (this.tokenReadIssue)
            throw createDriveError('reauth_required');
        if (!envelope.refresh_token)
            throw createDriveError('reauth_required');
        const settings = this.readSettings();
        if (settings.google_drive_revoke_status === 'unconfirmed')
            throw createDriveError('not_connected');
        if (settings.google_drive_last_error_code === 'reauth_required')
            throw createDriveError('reauth_required');
        const clientIdFingerprint = crypto
            .createHash('sha256')
            .update(creds.clientId)
            .digest('hex')
            .slice(0, 16);
        if (envelope.installation_id !== marker ||
            !envelope.account_subject ||
            !settings.google_drive_account_subject ||
            envelope.account_subject !== settings.google_drive_account_subject ||
            envelope.client_id_fingerprint !== clientIdFingerprint)
            throw createDriveError('reauth_required');
        const client = new drive_1.auth.OAuth2(creds.clientId, creds.clientSecret);
        client.setCredentials(envelope);
        let latestEnvelope = { ...envelope };
        client.on('tokens', (refreshed) => {
            if (!this.stopping && !this.terminalCleanup && !signal?.aborted) {
                latestEnvelope = {
                    ...latestEnvelope,
                    ...refreshed,
                    version: TOKEN_ENVELOPE_VERSION,
                    installation_id: marker,
                    account_subject: envelope.account_subject,
                };
                this.writeTokens(latestEnvelope);
            }
        });
        return client;
    }
    async listFilesInDestination(driveClient, folderId, signal, options = {}) {
        if (!safeId(folderId))
            throw createDriveError('destination_invalid');
        const files = [];
        let pageToken;
        const limit = options.limit ?? Number.POSITIVE_INFINITY;
        do {
            const pageSize = Number.isFinite(limit)
                ? Math.min(1000, Math.max(1, limit - files.length))
                : 1000;
            const response = await driveClient.files.list({
                q: [`'${folderId}' in parents and trashed=false`, options.query || '']
                    .filter(Boolean)
                    .join(' and '),
                fields: 'nextPageToken,files(id,name,createdTime,size,mimeType,parents,trashed,appProperties)',
                spaces: 'drive',
                pageSize,
                pageToken,
                ...(options.query ? { orderBy: 'createdTime desc' } : {}),
            }, {
                signal: requestSignal(signal, DRIVE_REQUEST_TIMEOUT_MS),
                timeout: DRIVE_REQUEST_TIMEOUT_MS,
            });
            const pageFiles = response.data.files || [];
            if (options.onFile) {
                for (const file of pageFiles)
                    await options.onFile(file);
            }
            else {
                files.push(...pageFiles);
            }
            pageToken = response.data.nextPageToken || undefined;
        } while (pageToken && (Boolean(options.onFile) || files.length < limit));
        return files.slice(0, limit);
    }
    async findMatchingUploads(driveClient, folderId, runId, marker, signal) {
        return (await this.listFilesInDestination(driveClient, folderId, signal, {
            query: `appProperties has { key='flo_installation_id' and value='${marker}' } and appProperties has { key='flo_backup_run_id' and value='${runId}' }`,
            limit: 2,
        })).filter((file) => {
            const properties = this.appProperties(file);
            return properties.flo_installation_id === marker && properties.flo_backup_run_id === runId;
        });
    }
    remoteMatchesSnapshot(file, snapshot, pending) {
        const properties = this.appProperties(file);
        return (safeId(String(file.id || '')) &&
            properties.flo_marker_version === MARKER_VERSION &&
            properties.flo_backup_kind === pending.kind &&
            properties.flo_destination_folder_id === pending.destination_folder_id &&
            properties.flo_sha256 === snapshot.sha256 &&
            properties.flo_byte_count === String(snapshot.byteCount) &&
            properties.flo_schema_version === String(snapshot.schemaVersion) &&
            properties.flo_app_version === snapshot.appVersion &&
            String(file.size || properties.flo_byte_count) === String(snapshot.byteCount));
    }
    appProperties(file) {
        const raw = file.appProperties;
        if (!raw || typeof raw !== 'object')
            return {};
        return Object.fromEntries(Object.entries(raw).filter((entry) => typeof entry[1] === 'string'));
    }
    toRemoteBackup(file, folderId) {
        const properties = this.appProperties(file);
        if (!safeId(String(file.id || '')) ||
            properties.flo_marker_version !== MARKER_VERSION ||
            !['automatic', 'manual'].includes(properties.flo_backup_kind) ||
            properties.flo_destination_folder_id !== folderId)
            return null;
        const schemaVersion = Number(properties.flo_schema_version);
        const bytes = Number(properties.flo_byte_count || file.size);
        const fileSize = file.size === undefined ? null : Number(file.size);
        if (file.mimeType !== 'application/x-sqlite3' ||
            !Number.isSafeInteger(schemaVersion) ||
            !Number.isSafeInteger(bytes) ||
            bytes <= 0 ||
            !Number.isSafeInteger(fileSize ?? bytes) ||
            (fileSize !== null && fileSize !== bytes) ||
            !/^[a-f0-9]{64}$/.test(properties.flo_sha256 || '') ||
            !properties.flo_app_version)
            return null;
        const versionComparison = compareAppVersions(properties.flo_app_version, electron_1.app.getVersion());
        const compatible = file.mimeType === 'application/x-sqlite3' &&
            /^[a-f0-9]{64}$/.test(properties.flo_sha256) &&
            versionComparison !== null &&
            versionComparison <= 0 &&
            schemaVersion <= (0, db_1.getCurrentSchemaVersion)() &&
            (fileSize === null || fileSize === bytes);
        return {
            id: String(file.id),
            name: String(file.name || 'FloCafe backup'),
            kind: properties.flo_backup_kind,
            created_at: String(file.createdTime || properties.flo_backup_created_at || ''),
            bytes,
            sha256: properties.flo_sha256,
            schema_version: schemaVersion,
            app_version: properties.flo_app_version,
            destination_folder_id: folderId,
            compatible,
        };
    }
    writeJob(job) {
        (0, db_1.upsertSettings)({ google_drive_job: JSON.stringify(job) });
    }
    retentionFromSettings(settings) {
        const parsed = Number.parseInt(settings.google_drive_retention_count || '', 10);
        const retention = Number.isInteger(parsed) && parsed >= MIN_RETENTION && parsed <= MAX_RETENTION
            ? parsed
            : DEFAULT_RETENTION;
        if (settings.google_drive_retention_count !== String(retention))
            (0, db_1.upsertSettings)({ google_drive_retention_count: String(retention) });
        return retention;
    }
    readOwnedDestinations() {
        const settings = this.readSettings();
        const parsed = parseJson(settings.google_drive_owned_destinations);
        const current = settings.google_drive_destination_folder_id || settings.google_drive_folder_id;
        const values = Array.isArray(parsed)
            ? parsed.filter((value) => safeId(value))
            : [];
        return [...new Set([current, ...values].filter((value) => Boolean(value)))];
    }
    rememberDestination(folderId) {
        if (!safeId(folderId))
            return;
        (0, db_1.upsertSettings)({
            google_drive_owned_destinations: JSON.stringify([folderId, ...this.readOwnedDestinations()].filter((value, index, array) => array.indexOf(value) === index)),
        });
    }
    readSettings() {
        const rows = (0, db_1.getDatabase)().prepare('SELECT key, value FROM settings').all();
        return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    }
    ensureInstallationMarker() {
        const markerPath = getInstallationMarkerPath();
        try {
            const marker = fs.readFileSync(markerPath, 'utf8').trim();
            if (safeId(marker))
                return marker;
        }
        catch { }
        const marker = crypto.randomUUID();
        fs.mkdirSync(path.dirname(markerPath), { recursive: true });
        const tempPath = `${markerPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
        try {
            fs.writeFileSync(tempPath, marker, { mode: 0o600, flag: 'wx' });
            fs.renameSync(tempPath, markerPath);
        }
        catch (error) {
            try {
                if (fs.existsSync(tempPath))
                    fs.unlinkSync(tempPath);
            }
            catch { }
            throw error;
        }
        const persistedMarker = fs.readFileSync(markerPath, 'utf8').trim();
        if (!safeId(persistedMarker) || persistedMarker !== marker)
            throw new Error('Google Drive installation marker persistence failed');
        return persistedMarker;
    }
    readTokenEnvelope() {
        const tokenPath = getTokenFilePath();
        this.recoverTokenRollbackArtifacts();
        try {
            if (!fs.existsSync(tokenPath)) {
                if (this.tokenReadIssue !== 'persistence_ambiguous')
                    this.tokenReadIssue = null;
                return null;
            }
            const parsed = JSON.parse(electron_1.safeStorage.decryptString(fs.readFileSync(tokenPath)));
            if (!parsed || (!parsed.access_token && !parsed.refresh_token))
                throw new Error('invalid token');
            if (this.tokenReadIssue !== 'persistence_ambiguous')
                this.tokenReadIssue = null;
            return parsed;
        }
        catch {
            if (this.tokenReadIssue !== 'persistence_ambiguous')
                this.tokenReadIssue = fs.existsSync(tokenPath) ? 'corrupt' : null;
            return null;
        }
    }
    recoverTokenRollbackArtifacts() {
        const tokenPath = getTokenFilePath();
        const tokenDirectory = path.dirname(tokenPath);
        const tokenName = path.basename(tokenPath);
        let restorePaths;
        try {
            restorePaths = fs
                .readdirSync(tokenDirectory)
                .filter((name) => name.startsWith(`${tokenName}.restore-`))
                .map((name) => path.join(tokenDirectory, name))
                .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                this.tokenReadIssue = 'persistence_ambiguous';
            return;
        }
        if (restorePaths.length === 0)
            return;
        const recoveryPath = restorePaths[0];
        try {
            const recoveryStat = fs.lstatSync(recoveryPath);
            if (recoveryStat.isSymbolicLink() || !recoveryStat.isFile())
                throw new Error('Token rollback evidence must be a regular file');
            const previousToken = fs.readFileSync(recoveryPath);
            if (previousToken.length === 0) {
                if (fs.existsSync(tokenPath)) {
                    const tokenStat = fs.lstatSync(tokenPath);
                    if (tokenStat.isSymbolicLink() || !tokenStat.isFile())
                        throw new Error('Token file must be a regular file');
                    fs.unlinkSync(tokenPath);
                }
            }
            else {
                if (fs.existsSync(tokenPath)) {
                    const tokenStat = fs.lstatSync(tokenPath);
                    if (tokenStat.isSymbolicLink() || !tokenStat.isFile())
                        throw new Error('Token file must be a regular file');
                    fs.unlinkSync(tokenPath);
                }
                fs.copyFileSync(recoveryPath, tokenPath, fs.constants.COPYFILE_EXCL);
                syncTokenFile(tokenPath);
            }
            if (!syncRestoreIntentDirectory(tokenDirectory) && process.platform !== 'win32')
                throw new Error('Could not durably recover Google Drive token');
            for (const restorePath of restorePaths) {
                if (fs.existsSync(restorePath))
                    fs.unlinkSync(restorePath);
            }
            if (!syncRestoreIntentDirectory(tokenDirectory) && process.platform !== 'win32')
                throw new Error('Could not durably clear Google Drive token rollback evidence');
            this.tokenReadIssue = null;
            this.clearStaleReauthAfterTokenRollback(previousToken);
        }
        catch {
            this.tokenReadIssue = 'persistence_ambiguous';
        }
    }
    // A completed rollback restores a bound credential, so a reauth latch recorded for ambiguous token persistence is stale.
    clearStaleReauthAfterTokenRollback(rollbackBytes) {
        if (rollbackBytes.length === 0)
            return;
        let envelope = null;
        try {
            envelope = JSON.parse(electron_1.safeStorage.decryptString(rollbackBytes));
        }
        catch {
            return;
        }
        if (!envelope?.refresh_token || !envelope.installation_id || !envelope.account_subject)
            return;
        const settings = this.readSettings();
        if (settings.google_drive_last_error_code !== 'reauth_required')
            return;
        if (envelope.installation_id !== this.ensureInstallationMarker())
            return;
        if (!settings.google_drive_account_subject ||
            envelope.account_subject !== settings.google_drive_account_subject)
            return;
        try {
            (0, db_1.upsertSettings)({ google_drive_last_error_code: '' });
        }
        catch { }
    }
    writeTokens(tokens) {
        const tokenPath = getTokenFilePath();
        const tokenDirectory = path.dirname(tokenPath);
        const tempPath = `${tokenPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
        const restorePath = `${tokenPath}.restore-${crypto.randomBytes(4).toString('hex')}`;
        const encrypted = electron_1.safeStorage.encryptString(JSON.stringify(tokens));
        let previousToken = null;
        let hadPreviousToken = false;
        let fd = null;
        let renamed = false;
        let replacementDurable = false;
        try {
            if (fs.existsSync(tokenPath)) {
                hadPreviousToken = true;
                const tokenStat = fs.lstatSync(tokenPath);
                if (tokenStat.isSymbolicLink() || !tokenStat.isFile())
                    throw new Error('Token file must be a regular file');
                previousToken = fs.readFileSync(tokenPath);
            }
            fs.writeFileSync(restorePath, previousToken ?? Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
            syncTokenFile(restorePath);
            fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
            fs.writeFileSync(fd, encrypted);
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = null;
            fs.renameSync(tempPath, tokenPath);
            renamed = true;
            if (!syncRestoreIntentDirectory(tokenDirectory) && process.platform !== 'win32')
                throw new Error('Could not durably store Google Drive token');
            replacementDurable = true;
            if (fs.existsSync(restorePath)) {
                fs.unlinkSync(restorePath);
                if (!syncRestoreIntentDirectory(tokenDirectory) && process.platform !== 'win32')
                    throw new Error('Could not durably remove token rollback evidence');
            }
            this.tokenReadIssue = null;
        }
        catch (error) {
            if (fd !== null)
                try {
                    fs.closeSync(fd);
                }
                catch { }
            try {
                if (fs.existsSync(tempPath))
                    fs.unlinkSync(tempPath);
            }
            catch { }
            if (!renamed)
                try {
                    if (fs.existsSync(restorePath))
                        fs.unlinkSync(restorePath);
                }
                catch { }
            if (renamed && !replacementDurable) {
                if (!fs.existsSync(restorePath)) {
                    try {
                        fs.writeFileSync(restorePath, previousToken ?? Buffer.alloc(0), {
                            flag: 'wx',
                            mode: 0o600,
                        });
                        syncTokenFile(restorePath);
                    }
                    catch { }
                }
                let rolledBack = false;
                try {
                    if (hadPreviousToken) {
                        if (fs.existsSync(tokenPath))
                            fs.unlinkSync(tokenPath);
                        fs.copyFileSync(restorePath, tokenPath, fs.constants.COPYFILE_EXCL);
                        syncTokenFile(tokenPath);
                    }
                    else {
                        if (fs.existsSync(tokenPath))
                            fs.unlinkSync(tokenPath);
                    }
                    if (!syncRestoreIntentDirectory(tokenDirectory) && process.platform !== 'win32')
                        throw new Error('Could not durably roll back token replacement');
                    rolledBack = true;
                }
                catch {
                    rolledBack = false;
                }
                if (!rolledBack) {
                    this.tokenReadIssue = 'persistence_ambiguous';
                    try {
                        (0, db_1.upsertSettings)({ google_drive_last_error_code: 'reauth_required' });
                    }
                    catch { }
                    throw new Error('Token persistence is ambiguous; rollback evidence was retained', {
                        cause: error,
                    });
                }
            }
            else if (renamed) {
                this.tokenReadIssue = 'persistence_ambiguous';
                try {
                    (0, db_1.upsertSettings)({ google_drive_last_error_code: 'reauth_required' });
                }
                catch { }
                throw new Error('Token persistence cleanup is ambiguous', { cause: error });
            }
            throw error;
        }
    }
    deleteTokens() {
        const tokenPath = getTokenFilePath();
        if (!fs.existsSync(tokenPath))
            return;
        fs.unlinkSync(tokenPath);
        if (!syncRestoreIntentDirectory(path.dirname(tokenPath)) && process.platform !== 'win32')
            throw new Error('Could not durably delete stored Google Drive tokens');
    }
    throwIfStopping(signal) {
        if (signal?.aborted || this.stopping || this.terminalCleanup)
            throw createDriveShutdownError('Google Drive operation');
    }
    async delayWithSignal(milliseconds, signal) {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, milliseconds);
            const abort = () => {
                clearTimeout(timer);
                reject(createDriveError('cancelled'));
            };
            if (signal.aborted)
                abort();
            else
                signal.addEventListener('abort', abort, { once: true });
        });
    }
    runLoopbackFlow(creds, signal) {
        return new Promise((resolve, reject) => {
            const state = crypto.randomBytes(32).toString('base64url');
            const pkce = createPkcePair();
            let settled = false;
            let redirectUri = '';
            let abort = () => { };
            let server;
            const finish = (fn) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                signal?.removeEventListener('abort', abort);
                try {
                    server.close();
                }
                catch { }
                fn();
            };
            abort = () => finish(() => reject(createDriveShutdownError('Google Drive connection')));
            server = http.createServer((req, res) => {
                let requestUrl;
                try {
                    requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
                }
                catch {
                    res.writeHead(400).end();
                    return;
                }
                if (req.method !== 'GET' || requestUrl.pathname !== '/oauth2callback') {
                    res.writeHead(404).end();
                    return;
                }
                const returnedState = requestUrl.searchParams.get('state') || '';
                const code = requestUrl.searchParams.get('code');
                const error = requestUrl.searchParams.get('error');
                const stateMatches = returnedState.length === state.length &&
                    crypto.timingSafeEqual(Buffer.from(returnedState), Buffer.from(state));
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(error || !code || !stateMatches
                    ? '<html><body>Google Drive connection failed. Close this window and return to FloCafe.</body></html>'
                    : '<html><body>Google Drive connected. Close this window and return to FloCafe.</body></html>');
                if (error)
                    return finish(() => reject(createDriveError('reauth_required')));
                if (!code || !stateMatches)
                    return finish(() => reject(createDriveError('reauth_required')));
                finish(() => resolve({ code, redirectUri, verifier: pkce.verifier }));
            });
            const timeout = setTimeout(() => finish(() => reject(createDriveError('reauth_required'))), LOOPBACK_TIMEOUT_MS);
            if (signal?.aborted) {
                abort();
                return;
            }
            signal?.addEventListener('abort', abort, { once: true });
            server.on('error', () => finish(() => reject(createDriveError('offline'))));
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
                const client = new drive_1.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
                const authUrl = client.generateAuthUrl({
                    access_type: 'offline',
                    prompt: 'consent',
                    scope: [exports.DRIVE_FILE_SCOPE, 'openid', 'email'],
                    state,
                    code_challenge: pkce.challenge,
                    code_challenge_method: 'S256',
                });
                if (!isSafeGoogleAuthorizationUrl(authUrl))
                    return finish(() => reject(createDriveError('reauth_required')));
                electron_1.shell.openExternal(authUrl).catch(() => finish(() => reject(createDriveError('offline'))));
            });
        });
    }
    cleanupStaging() {
        try {
            fs.mkdirSync(getStagingDir(), { recursive: true, mode: 0o700 });
            const pending = parsePending(this.readSettings().google_drive_pending_upload);
            const pendingPath = pending?.local_path ? path.resolve(pending.local_path) : '';
            for (const fileName of fs.readdirSync(getStagingDir())) {
                const fullPath = path.join(getStagingDir(), fileName);
                try {
                    if (path.resolve(fullPath) !== pendingPath &&
                        Date.now() - fs.statSync(fullPath).mtimeMs > 24 * 60 * 60_000)
                        fs.rmSync(fullPath, { recursive: true, force: true });
                }
                catch { }
            }
        }
        catch { }
    }
}
async function hashStagedFile(filePath) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink())
        throw createDriveError('restore_validation_failed');
    const hash = crypto.createHash('sha256');
    let byteCount = 0;
    const stream = fs.createReadStream(filePath, { flags: 'r' });
    try {
        for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            byteCount += buffer.byteLength;
            hash.update(buffer);
        }
    }
    finally {
        stream.destroy();
    }
    return { sha256: hash.digest('hex'), byteCount };
}
exports.googleDrive = new GoogleDriveService();
//# sourceMappingURL=google-drive.js.map