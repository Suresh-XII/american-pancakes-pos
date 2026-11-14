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
exports.isMasterPinAvailable = isMasterPinAvailable;
exports.isMasterPinSet = isMasterPinSet;
exports.setMasterPin = setMasterPin;
exports.resetMasterPin = resetMasterPin;
exports.verifyMasterPin = verifyMasterPin;
exports.isMasterPinRateLimited = isMasterPinRateLimited;
exports.recordMasterPinFailedAttempt = recordMasterPinFailedAttempt;
exports.resetMasterPinRateLimit = resetMasterPinRateLimit;
exports.checkMasterPinRateLimit = checkMasterPinRateLimit;
exports.authorizeMasterPin = authorizeMasterPin;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const bcrypt = __importStar(require("bcryptjs"));
const PIN_REGEX = /^\d{4}$/;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
function getMasterPinFilePath() {
    return path.join(electron_1.app.getPath('userData'), 'master-pin.enc');
}
function isMasterPinAvailable() {
    try {
        return electron_1.safeStorage.isEncryptionAvailable();
    }
    catch {
        return false;
    }
}
function isMasterPinSet() {
    return fs.existsSync(getMasterPinFilePath());
}
function readBlob() {
    try {
        const encrypted = fs.readFileSync(getMasterPinFilePath());
        const decrypted = electron_1.safeStorage.decryptString(encrypted);
        const blob = JSON.parse(decrypted);
        if (!blob?.hash)
            return null;
        return blob;
    }
    catch {
        return null;
    }
}
function writeBlob(blob) {
    const encrypted = electron_1.safeStorage.encryptString(JSON.stringify(blob));
    fs.writeFileSync(getMasterPinFilePath(), encrypted, { mode: 0o600 });
}
function savePin(pin) {
    if (!PIN_REGEX.test(pin)) {
        throw new Error('Master PIN must be exactly 4 digits');
    }
    const existing = readBlob();
    const now = new Date().toISOString();
    writeBlob({
        hash: bcrypt.hashSync(pin, 10),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
}
/** Sets the master PIN for the first time (first-run setup). */
function setMasterPin(pin) {
    savePin(pin);
}
/** Overwrites the master PIN for first-run setup or authenticated owner recovery. */
function resetMasterPin(pin) {
    savePin(pin);
}
function verifyMasterPin(pin) {
    const blob = readBlob();
    if (!blob)
        return false;
    return bcrypt.compareSync(pin, blob.hash);
}
const pinAttempts = new Map();
function isMasterPinRateLimited(key) {
    const nowMs = Date.now();
    const entry = pinAttempts.get(key);
    if (!entry)
        return false;
    if (nowMs > entry.resetAt) {
        pinAttempts.delete(key);
        return false;
    }
    return entry.count >= RATE_LIMIT_MAX_ATTEMPTS;
}
function recordMasterPinFailedAttempt(key) {
    const nowMs = Date.now();
    const entry = pinAttempts.get(key);
    if (!entry || nowMs > entry.resetAt) {
        pinAttempts.set(key, { count: 1, resetAt: nowMs + RATE_LIMIT_WINDOW_MS });
        return true;
    }
    if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS)
        return false;
    entry.count++;
    return true;
}
function resetMasterPinRateLimit(key) {
    pinAttempts.delete(key);
}
function checkMasterPinRateLimit(key) {
    return recordMasterPinFailedAttempt(key);
}
/** Authorizes master PIN for Express middleware and ipcMain handlers. */
function authorizeMasterPin(pin, rateLimitKey) {
    if (!isMasterPinAvailable()) {
        // Block operations when OS-backed encryption is unavailable to prevent bypasses.
        return {
            ok: false,
            status: 503,
            error: 'Master PIN is not available on this device (OS encryption unavailable). ' +
                'Master PIN-gated operations require a desktop environment with keyring support.',
        };
    }
    if (!isMasterPinSet()) {
        return { ok: false, status: 409, error: 'Master PIN is not set on this device yet. Set one in Settings first.' };
    }
    if (isMasterPinRateLimited(rateLimitKey)) {
        return { ok: false, status: 429, error: 'Too many incorrect Master PIN attempts. Try again later.' };
    }
    if (!pin || typeof pin !== 'string' || !PIN_REGEX.test(pin)) {
        return { ok: false, status: 403, error: 'Invalid Master PIN' };
    }
    if (!verifyMasterPin(pin)) {
        recordMasterPinFailedAttempt(rateLimitKey);
        if (isMasterPinRateLimited(rateLimitKey)) {
            return { ok: false, status: 429, error: 'Too many incorrect Master PIN attempts. Try again later.' };
        }
        return { ok: false, status: 403, error: 'Invalid Master PIN' };
    }
    resetMasterPinRateLimit(rateLimitKey);
    return { ok: true };
}
//# sourceMappingURL=master-pin.js.map