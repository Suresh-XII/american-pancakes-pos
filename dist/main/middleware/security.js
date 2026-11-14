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
exports.validatePassword = exports.corsOptions = exports.PIN_WINDOW_MS = exports.PIN_MAX_ATTEMPTS = exports.FAILED_LOGIN_LOCKOUT_MINUTES = exports.FAILED_LOGIN_MAX_ATTEMPTS = void 0;
exports.normalizeIpForRateLimit = normalizeIpForRateLimit;
exports.rateLimit = rateLimit;
exports.loginAuthRateLimit = loginAuthRateLimit;
exports.resetSharedLoginAuthRateLimiter = resetSharedLoginAuthRateLimiter;
exports.authRateLimit = authRateLimit;
exports.checkLoginRateLimit = checkLoginRateLimit;
exports.incrementFailedLogin = incrementFailedLogin;
exports.resetSuccessfulLogin = resetSuccessfulLogin;
exports.clearLoginRateLimits = clearLoginRateLimits;
exports.checkPinRateLimit = checkPinRateLimit;
exports.isPinRateLimited = isPinRateLimited;
exports.clearPinRateLimit = clearPinRateLimit;
exports.resetPinRateLimitForTests = resetPinRateLimitForTests;
exports.withPinVerificationLock = withPinVerificationLock;
exports.staticRouteRateLimit = staticRouteRateLimit;
exports.getUserAuthStatus = getUserAuthStatus;
exports.invalidateUserAuthCache = invalidateUserAuthCache;
exports.clearUserAuthCache = clearUserAuthCache;
exports.isTokenStale = isTokenStale;
exports.revokeToken = revokeToken;
exports.isTokenRevoked = isTokenRevoked;
exports.clearInMemoryRevokedTokens = clearInMemoryRevokedTokens;
exports.clearRevokedTokens = clearRevokedTokens;
exports.requireRole = requireRole;
exports.requireKdsEnabled = requireKdsEnabled;
exports.requireKdsEnabledOr404 = requireKdsEnabledOr404;
exports.isAllowedPrivateIp = isAllowedPrivateIp;
exports.isBlockedSsrfTarget = isBlockedSsrfTarget;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX = 100;
/** Canonicalizes an IP address for rate-limit bucketing so equivalent forms share budget. */
function normalizeIpForRateLimit(ip) {
    const lower = ip.toLowerCase();
    return lower.startsWith('::ffff:') ? lower.substring(7) : lower;
}
/** In-memory rate limiter for local Express API keyed by canonicalized IP. */
function rateLimit(options = {}) {
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    const max = options.max ?? DEFAULT_MAX;
    const message = options.message ?? 'Too many requests, please try again later.';
    const requests = new Map();
    return (req, res, next) => {
        const rawIp = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const ip = normalizeIpForRateLimit(rawIp);
        // Bound in-memory table: sweep expired entries once past threshold.
        if (requests.size > 1000) {
            for (const [key, value] of requests.entries()) {
                if (value.resetAt <= now)
                    requests.delete(key);
            }
        }
        // Bypass rate limit for local/private/Tailscale IPs unless bypassPrivateIp is false.
        const bypassPrivateIp = options.bypassPrivateIp !== false;
        if (bypassPrivateIp && isAllowedPrivateIp(ip)) {
            return next();
        }
        let record = requests.get(ip);
        if (!record || record.resetAt <= now) {
            record = { count: 0, resetAt: now + windowMs };
            requests.set(ip, record);
        }
        record.count += 1;
        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, max - record.count)));
        res.setHeader('RateLimit-Reset', new Date(record.resetAt).toISOString());
        if (record.count > max) {
            return res.status(429).json({ error: message });
        }
        if (options.skipSuccessfulRequests) {
            const originalSend = res.send.bind(res);
            res.send = (body) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    record.count = Math.max(0, record.count - 1);
                }
                return originalSend(body);
            };
        }
        next();
    };
}
let sharedLoginAuthRateLimiter = null;
let sharedLoginAuthRateLimiterEnvMax = undefined;
/** Shared volume rate limiter across default login endpoints (:3001, :3002, :3003). */
function loginAuthRateLimit(options = {}) {
    const envMax = process.env.FLO_AUTH_RATE_LIMIT_MAX;
    if (!options.max) {
        if (!sharedLoginAuthRateLimiter || sharedLoginAuthRateLimiterEnvMax !== envMax) {
            sharedLoginAuthRateLimiterEnvMax = envMax;
            const parsedEnvMax = envMax ? parseInt(envMax, 10) : undefined;
            sharedLoginAuthRateLimiter = (0, express_rate_limit_1.default)({
                windowMs: 15 * 60 * 1000, // 15 minutes
                limit: Number.isFinite(parsedEnvMax) ? parsedEnvMax : 10,
                standardHeaders: true,
                legacyHeaders: false,
                message: { error: 'Too many authentication attempts. Please try again later.' },
            });
        }
        return sharedLoginAuthRateLimiter;
    }
    const parsedEnvMax = envMax ? parseInt(envMax, 10) : undefined;
    return (0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000, // 15 minutes
        limit: options.max ?? (Number.isFinite(parsedEnvMax) ? parsedEnvMax : 10),
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many authentication attempts. Please try again later.' },
    });
}
function resetSharedLoginAuthRateLimiter() {
    sharedLoginAuthRateLimiter = null;
    sharedLoginAuthRateLimiterEnvMax = undefined;
}
/** Stricter rate limiter for authentication endpoints; private/LAN IPs are not exempt. */
function authRateLimit(options = {}) {
    const envMax = process.env.FLO_AUTH_RATE_LIMIT_MAX
        ? parseInt(process.env.FLO_AUTH_RATE_LIMIT_MAX, 10)
        : undefined;
    return (0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000, // 15 minutes
        limit: options.max ?? (Number.isFinite(envMax) ? envMax : 10),
        skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many authentication attempts. Please try again later.' },
        ...(options.onRateLimited
            ? {
                handler: (req, res, _next, rateLimitOptions) => {
                    try {
                        options.onRateLimited?.(req, res);
                    }
                    catch {
                        // Ignore audit errors in rate-limit handler
                    }
                    res.status(rateLimitOptions.statusCode).send(rateLimitOptions.message);
                },
            }
            : {}),
    });
}
// ── Shared Failed-Login Lockout (Install-wide across all login surfaces) ───────
const loginAttempts = new Map();
exports.FAILED_LOGIN_MAX_ATTEMPTS = 5;
exports.FAILED_LOGIN_LOCKOUT_MINUTES = 15;
function checkLoginRateLimit(ip) {
    const canonicalIp = normalizeIpForRateLimit(ip);
    const nowMs = Date.now();
    let record = loginAttempts.get(canonicalIp);
    if (record) {
        if (record.lockedUntil > nowMs) {
            const waitMinutes = Math.ceil((record.lockedUntil - nowMs) / 60000);
            return { allowed: false, waitMinutes };
        }
        // If lock expired, reset
        if (record.lockedUntil > 0 && record.lockedUntil <= nowMs) {
            record = { count: 0, lockedUntil: 0 };
            loginAttempts.set(canonicalIp, record);
        }
    }
    return { allowed: true };
}
function incrementFailedLogin(ip) {
    const canonicalIp = normalizeIpForRateLimit(ip);
    const record = loginAttempts.get(canonicalIp) || { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= exports.FAILED_LOGIN_MAX_ATTEMPTS) {
        record.lockedUntil = Date.now() + exports.FAILED_LOGIN_LOCKOUT_MINUTES * 60000;
    }
    loginAttempts.set(canonicalIp, record);
    return Math.max(0, exports.FAILED_LOGIN_MAX_ATTEMPTS - record.count);
}
function resetSuccessfulLogin(ip) {
    const canonicalIp = normalizeIpForRateLimit(ip);
    loginAttempts.delete(canonicalIp);
    const pinIdx = canonicalIp.indexOf(':pin:');
    if (pinIdx >= 0) {
        loginAttempts.delete(`pin-user:${canonicalIp.slice(pinIdx + 5)}`);
    }
}
function clearLoginRateLimits() {
    loginAttempts.clear();
}
// ── Shared Manager PIN Rate Limiting & Concurrency Accounting ─────────────────
exports.PIN_MAX_ATTEMPTS = 5;
exports.PIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const pinAttempts = new Map();
const pinVerificationLocks = new Map();
function checkPinRateLimit(key) {
    const nowMs = Date.now();
    if (pinAttempts.size > 500) {
        for (const [k, v] of pinAttempts.entries()) {
            if (nowMs > v.resetAt)
                pinAttempts.delete(k);
        }
    }
    const entry = pinAttempts.get(key);
    if (!entry || nowMs > entry.resetAt) {
        pinAttempts.set(key, { count: 1, resetAt: nowMs + exports.PIN_WINDOW_MS });
        return true;
    }
    if (entry.count >= exports.PIN_MAX_ATTEMPTS)
        return false;
    entry.count++;
    return true;
}
function isPinRateLimited(key) {
    const entry = pinAttempts.get(key);
    if (!entry || Date.now() > entry.resetAt) {
        pinAttempts.delete(key);
        return false;
    }
    return entry.count >= exports.PIN_MAX_ATTEMPTS;
}
function clearPinRateLimit(key) {
    pinAttempts.delete(key);
}
function resetPinRateLimitForTests() {
    pinAttempts.clear();
    pinVerificationLocks.clear();
}
/**
 * Serializes PIN verification for the given rateLimitKey to ensure that
 * simultaneous invalid requests do not execute redundant bcrypt computations
 * in parallel before the failure counter is updated.
 */
async function withPinVerificationLock(key, fn) {
    const previous = pinVerificationLocks.get(key) || Promise.resolve();
    let resolveCurrent;
    const current = new Promise((resolve) => {
        resolveCurrent = resolve;
    });
    pinVerificationLocks.set(key, current);
    try {
        await previous.catch(() => { });
        return await fn();
    }
    finally {
        resolveCurrent();
        if (pinVerificationLocks.get(key) === current) {
            pinVerificationLocks.delete(key);
        }
    }
}
/** Shared rate limiter for static/SPA file serving with private IP bypass. */
function staticRouteRateLimit(options = {}) {
    return (0, express_rate_limit_1.default)({
        windowMs: options.windowMs ?? 60 * 1000,
        limit: options.limit ?? 600,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => isAllowedPrivateIp(req.ip || req.socket.remoteAddress || ''),
    });
}
// Short cache TTL bounds how long deactivated/role-changed user JWTs persist.
const USER_AUTH_CACHE_TTL_MS = 30 * 1000;
const USER_AUTH_CACHE_PRUNE_INTERVAL_MS = USER_AUTH_CACHE_TTL_MS;
const userAuthCache = new Map();
let lastUserAuthCachePruneAt = 0;
/** Caches user active status, current role, and tokens_valid_after timestamp. */
function getUserAuthStatus(userId, options = {}) {
    const now = Date.now();
    if (options.fresh)
        userAuthCache.delete(userId);
    if (userAuthCache.size > 1000 &&
        now - lastUserAuthCachePruneAt >= USER_AUTH_CACHE_PRUNE_INTERVAL_MS) {
        for (const [k, v] of userAuthCache.entries()) {
            if (v.expiresAt <= now)
                userAuthCache.delete(k);
        }
        lastUserAuthCachePruneAt = now;
    }
    const cached = userAuthCache.get(userId);
    if (!options.fresh && cached && cached.expiresAt > now) {
        return {
            isActive: cached.isActive,
            role: cached.role,
            tokensValidAfter: cached.tokensValidAfter,
        };
    }
    const db = (0, db_1.getDatabase)();
    const user = db
        .prepare('SELECT is_active, role, tokens_valid_after FROM users WHERE id = ?')
        .get(userId);
    if (!user) {
        userAuthCache.delete(userId);
        return null;
    }
    const entry = {
        isActive: user.is_active === 1,
        role: user.role,
        tokensValidAfter: user.tokens_valid_after,
        expiresAt: now + USER_AUTH_CACHE_TTL_MS,
    };
    userAuthCache.set(userId, entry);
    return { isActive: entry.isActive, role: entry.role, tokensValidAfter: entry.tokensValidAfter };
}
/** Forces next requireAuth check for user to re-read DB instead of cache. */
function invalidateUserAuthCache(userId) {
    userAuthCache.delete(userId);
}
function clearUserAuthCache() {
    userAuthCache.clear();
    lastUserAuthCachePruneAt = 0;
}
/** True if token iat predates user tokens_valid_after (e.g. after password/PIN change). */
function isTokenStale(iat, tokensValidAfter) {
    if (!tokensValidAfter || typeof iat !== 'number')
        return false;
    // tokens_valid_after is stored in UTC; compare at second resolution.
    const tokensValidAfterSeconds = Math.floor((0, db_1.parseDbTimestamp)(tokensValidAfter).getTime() / 1000);
    return iat < tokensValidAfterSeconds;
}
// In-memory fallback and persistent hash store for token revocations.
const revokedTokens = new Set();
const MAX_IN_MEMORY_REVOKED_TOKENS = 5000;
const REVOCATION_CLEANUP_INTERVAL_MS = 60 * 1000;
let lastRevocationCleanupAt = 0;
function hashRevokedToken(token) {
    return (0, node_crypto_1.createHash)('sha256').update(token).digest('hex');
}
function cleanupExpiredRevocations(db, nowMs) {
    if (nowMs - lastRevocationCleanupAt < REVOCATION_CLEANUP_INTERVAL_MS)
        return;
    db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(nowMs);
    lastRevocationCleanupAt = nowMs;
}
function revokeToken(token, verifiedExpiresAtMs) {
    if (!token || typeof token !== 'string')
        return;
    if (!revokedTokens.has(token)) {
        if (revokedTokens.size >= MAX_IN_MEMORY_REVOKED_TOKENS) {
            const firstToken = revokedTokens.values().next().value;
            if (firstToken !== undefined)
                revokedTokens.delete(firstToken);
        }
        revokedTokens.add(token);
    }
    const expiresAt = typeof verifiedExpiresAtMs === 'number' && Number.isFinite(verifiedExpiresAtMs)
        ? verifiedExpiresAtMs
        : null;
    if (expiresAt === null || expiresAt <= Date.now())
        return;
    try {
        const db = (0, db_1.getDatabase)();
        const nowMs = Date.now();
        cleanupExpiredRevocations(db, nowMs);
        db.prepare(`
      INSERT INTO revoked_tokens (token_hash, expires_at, revoked_at)
      VALUES (?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET
        expires_at = excluded.expires_at,
        revoked_at = excluded.revoked_at
    `).run(hashRevokedToken(token), expiresAt, (0, db_1.now)());
    }
    catch (error) {
        // The in-memory fallback still blocks the token in this process. Normal
        // authenticated requests already fail when the database is unavailable.
        console.error('[Auth] Could not persist token revocation:', error);
    }
}
function isTokenRevoked(token) {
    if (!token || typeof token !== 'string')
        return true;
    if (revokedTokens.has(token))
        return true;
    try {
        const db = (0, db_1.getDatabase)();
        const nowMs = Date.now();
        cleanupExpiredRevocations(db, nowMs);
        const row = db
            .prepare('SELECT 1 AS revoked FROM revoked_tokens WHERE token_hash = ? AND expires_at > ?')
            .get(hashRevokedToken(token), nowMs);
        return row?.revoked === 1;
    }
    catch (error) {
        // Fail closed: database query failure denies rather than allows token.
        console.error('[Auth] Token revocation lookup failed; rejecting token:', error);
        return true;
    }
}
function clearInMemoryRevokedTokens() {
    revokedTokens.clear();
}
function clearRevokedTokens() {
    clearInMemoryRevokedTokens();
    try {
        (0, db_1.getDatabase)().prepare('DELETE FROM revoked_tokens').run();
    }
    catch {
        // Test cleanup may run after the database has already been closed.
    }
}
/** Role-based authorization middleware (must follow requireAuth). */
function requireRole(...roles) {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        if (!roles.includes(user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}
/** Gates authenticated KDS REST endpoints behind the kds_enabled setting. */
function requireKdsEnabled(req, res, next) {
    if (!(0, db_1.isKdsEnabled)()) {
        return res.status(403).json({ error: 'KDS is disabled for this business' });
    }
    next();
}
/** Gates KDS pairing endpoints behind kds_enabled, returning 404 when disabled. */
function requireKdsEnabledOr404(req, res, next) {
    if (!(0, db_1.isKdsEnabled)()) {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}
const url_1 = require("url");
const net = __importStar(require("net"));
/** Checks if IP address is private, local, or Tailscale IP. */
function isAllowedPrivateIp(ip) {
    const version = net.isIP(ip);
    if (!version)
        return false;
    // IPv6: loopback is local; IPv4-mapped IPv6 is normalized to IPv4.
    if (version === 6) {
        if (ip === '::1')
            return true;
        const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        return mapped ? isAllowedPrivateIp(mapped[1]) : false;
    }
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4)
        return false;
    const [a, b] = parts;
    // Localhost (127.0.0.0/8)
    if (a === 127)
        return true;
    // Private Class A (10.0.0.0/8)
    if (a === 10)
        return true;
    // Private Class B (172.16.0.0/12)
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    // Private Class C (192.168.0.0/16)
    if (a === 192 && b === 168)
        return true;
    // Tailscale CGNAT (100.64.0.0/10)
    if (a === 100 && b >= 64 && b <= 127)
        return true;
    return false;
}
/** Expands an IPv6 literal (with an optional trailing dotted-quad) into its 8 hextets. */
function expandIpv6Groups(ip) {
    let text = ip;
    const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) {
        const octets = dotted[2].split('.').map(Number);
        if (octets.some((n) => n > 255))
            return null;
        const hi = ((octets[0] << 8) | octets[1]).toString(16);
        const lo = ((octets[2] << 8) | octets[3]).toString(16);
        text = `${dotted[1]}${hi}:${lo}`;
    }
    const halves = text.split('::');
    if (halves.length > 2)
        return null;
    const parseSide = (side) => {
        if (side === '')
            return [];
        const groups = [];
        for (const piece of side.split(':')) {
            if (!/^[0-9a-f]{1,4}$/.test(piece))
                return null;
            groups.push(parseInt(piece, 16));
        }
        return groups;
    };
    const left = parseSide(halves[0]);
    const right = parseSide(halves[1] ?? '');
    if (left === null || right === null)
        return null;
    const explicit = left.length + right.length;
    if (explicit > 8)
        return null;
    if (halves.length === 1)
        return explicit === 8 ? left : null;
    return [...left, ...Array(8 - explicit).fill(0), ...right];
}
/** Checks if an IP address is disallowed as an outbound fetch target for SSRF protection. */
function isBlockedSsrfTarget(ip) {
    const version = net.isIP(ip);
    if (version === 4) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n)))
            return true;
        const [a, b] = parts;
        if (a === 0)
            return true; // 0.0.0.0/8 - "this network"
        if (a === 10)
            return true; // private
        if (a === 100 && b >= 64 && b <= 127)
            return true; // CGNAT / Tailscale
        if (a === 127)
            return true; // loopback
        if (a === 169 && b === 254)
            return true; // link-local, incl. cloud metadata
        if (a === 172 && b >= 16 && b <= 31)
            return true; // private
        if (a === 192 && b === 0)
            return true; // IETF protocol assignments
        if (a === 192 && b === 168)
            return true; // private
        if (a === 198 && (b === 18 || b === 19))
            return true; // benchmark
        if (a >= 224)
            return true; // multicast (224-239) + reserved (240-255)
        return false;
    }
    if (version === 6) {
        const normalized = ip.toLowerCase();
        if (normalized === '::1' || normalized === '::')
            return true; // loopback / unspecified
        if (/^fe[89ab]/.test(normalized))
            return true; // link-local fe80::/10
        if (/^f[cd]/.test(normalized))
            return true; // unique local fc00::/7
        // IPv4-embedded IPv6 — validate the embedded IPv4 against the same blocklist,
        // whichever notation carries it. WHATWG URL canonicalizes ::ffff:127.0.0.1
        // and 0:0:0:0:0:ffff:127.0.0.1 to ::ffff:7f00:1, so a dotted-quad-only
        // check never fires for a URL-supplied host.
        const groups = expandIpv6Groups(normalized);
        if (groups) {
            const isZeros = (from, to) => groups.slice(from, to).every((g) => g === 0);
            const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
            const ipv4Mapped = isZeros(0, 5) && groups[5] === 0xffff; // ::ffff:0:0/96
            const ipv4Compatible = isZeros(0, 6); // ::/96 (IPv4-compatible, deprecated)
            const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && isZeros(2, 6); // 64:ff9b::/96
            if (ipv4Mapped || ipv4Compatible || nat64)
                return isBlockedSsrfTarget(embedded);
        }
        return false;
    }
    return true; // unparseable — fail closed
}
exports.corsOptions = {
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        try {
            const parsedOrigin = new url_1.URL(origin);
            const hostname = parsedOrigin.hostname;
            if (hostname === 'localhost' || hostname.endsWith('.local') || isAllowedPrivateIp(hostname)) {
                return callback(null, true);
            }
            callback(new Error('Not allowed by CORS'));
        }
        catch (err) {
            callback(new Error('Invalid origin format'));
        }
    },
};
/** The single password policy shared by backend routes and frontend forms. */
var password_policy_1 = require("../../shared/password-policy");
Object.defineProperty(exports, "validatePassword", { enumerable: true, get: function () { return password_policy_1.validatePassword; } });
//# sourceMappingURL=security.js.map