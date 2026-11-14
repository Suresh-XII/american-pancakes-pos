"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = exports.MAX_EMAIL_LENGTH = exports.ENGLISH_IDENTICAL_SEED_LANGUAGES = exports.seedSetupProfile = exports.clearJWTSecretCache = exports.getJWTSecret = void 0;
exports.normalizeEmail = normalizeEmail;
exports.parseCategoryIds = parseCategoryIds;
exports.isValidEmail = isValidEmail;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const db_1 = require("../db");
const jwt_secret_1 = require("../security/jwt-secret");
const seed_data_1 = require("../setup/seed-data");
const master_pin_1 = require("../services/master-pin");
const security_1 = require("../middleware/security");
const countries_1 = require("../countries");
const country_provenance_1 = require("../services/country-provenance");
const cloud_sync_1 = require("../services/cloud-sync");
const async_handler_1 = require("../middleware/async-handler");
const shutdown_1 = require("../shutdown");
const password_policy_1 = require("../../shared/password-policy");
const phone_1 = require("../lib/phone");
const currencies_1 = require("../../shared/currencies");
const authorization_1 = require("../services/authorization");
const operation_failure_1 = require("../lib/operation-failure");
const posthog_1 = require("../services/posthog");
const posthog_identity_1 = require("../services/posthog-identity");
const router = (0, express_1.Router)();
const JWT_EXPIRES_IN = '24h';
const JWT_REMEMBER_EXPIRES_IN = '10d';
const JWT_REMEMBER_EXPIRES_IN_SECONDS = 10 * 24 * 60 * 60;
function expiresInFor(remember) {
    return remember ? JWT_REMEMBER_EXPIRES_IN : JWT_EXPIRES_IN;
}
const INITIAL_ADMIN_ROLE = 'owner';
const VALID_BUSINESS_TYPES = new Set(['restaurant']);
const VALID_SETUP_PROFILES = new Set(['empty', 'express', 'demo']);
const VALID_SERVICE_MODELS = new Set(['qsr', 'finedine']);
const LOCAL_SETUP_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// The secret itself now lives in main/security/jwt-secret.ts, which is the only
// module allowed to hold its cache. Re-exported here for one release so the
// ~45 test files that resolve the secret through this router do not become a
// mechanical 45-file diff; main/ importers already point at the security module.
var jwt_secret_2 = require("../security/jwt-secret");
Object.defineProperty(exports, "getJWTSecret", { enumerable: true, get: function () { return jwt_secret_2.getJWTSecret; } });
Object.defineProperty(exports, "clearJWTSecretCache", { enumerable: true, get: function () { return jwt_secret_2.clearJWTSecretCache; } });
// The demo/express fixture data likewise belongs to no router. Re-exported
// here for one release, on the same terms as the secret above.
var seed_data_2 = require("../setup/seed-data");
Object.defineProperty(exports, "seedSetupProfile", { enumerable: true, get: function () { return seed_data_2.seedSetupProfile; } });
Object.defineProperty(exports, "ENGLISH_IDENTICAL_SEED_LANGUAGES", { enumerable: true, get: function () { return seed_data_2.ENGLISH_IDENTICAL_SEED_LANGUAGES; } });
/** Build synthetic tenant object from local settings for frontend routing. */
function buildLocalTenant(db, userId, userRole) {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    // Login must never fail on a missing/unresolvable regional snapshot
    // (unreachable for an authenticated, post-setup store per
    // docs/reference/product-invariants.md) — degrade to a neutral en-US-shaped format
    // rather than throw, and never silently claim India.
    let snapshot = null;
    try {
        snapshot = (0, countries_1.resolveRegionalSnapshot)(s);
    }
    catch {
        snapshot = null;
    }
    return {
        id: 1,
        business_name: s.business_name || 'Store',
        slug: 'local',
        database_name: 'local',
        business_type: s.business_type || 'restaurant',
        country: snapshot?.country || '',
        currency: snapshot?.currency || '',
        currency_symbol: snapshot?.currencySymbol || '',
        currency_position: snapshot?.currencyPosition || 'prefix',
        currency_fraction_digits: snapshot?.currencyFractionDigits ?? 2,
        decimal_separator: snapshot?.decimalSeparator || '.',
        group_separator: snapshot?.groupSeparator ?? ',',
        timezone: snapshot?.timezone || s.timezone || '',
        business_day_start_time: s.business_day_start_time || '00:00',
        language: s.language || 'en',
        // Include print policies in tenant snapshot so renderer bootstraps them before first print.
        bill_language_policy: s.bill_language_policy || null,
        kot_language_policy: s.kot_language_policy || null,
        service_model: s.service_model || 'finedine',
        currency_display: snapshot?.preferences.currencyDisplay || s.currency_display || 'rial',
        number_digits: snapshot?.preferences.digits || s.number_digits || 'locale',
        calendar: snapshot?.preferences.calendar || s.calendar || 'locale',
        plan: 'desktop',
        status: 'active',
        role: userRole, // user's role — AuthGuard uses this for routing
        permission_ids: [...((0, authorization_1.resolveEffectivePermissions)(userId)?.permissionIds ?? [])],
        authorization_revision: (0, authorization_1.effectivePermissionRevision)(userId),
    };
}
function getUserCount(db) {
    return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
}
function getPendingCurrencyReset(db) {
    try {
        const row = db
            .prepare("SELECT value FROM _flo_meta WHERE key = 'currency_reset_pending'")
            .get();
        if (!row?.value)
            return null;
        const parsed = JSON.parse(row.value);
        if (typeof parsed.country !== 'string' ||
            typeof parsed.currency !== 'string' ||
            typeof parsed.timezone !== 'string')
            return null;
        return { country: parsed.country, currency: parsed.currency, timezone: parsed.timezone };
    }
    catch {
        return null;
    }
}
function normalizeEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}
function parseCategoryIds(value) {
    if (typeof value !== 'string' || value.length === 0)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    catch {
        return [];
    }
}
// Cap mailbox at RFC 5321 length (254 octets) before regex evaluation to avoid ReDoS.
exports.MAX_EMAIL_LENGTH = 254;
function isValidEmail(email) {
    return email.length <= exports.MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function upsertSettings(db, entries) {
    const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
    for (const [key, value] of Object.entries(entries)) {
        if (value !== undefined && value !== null)
            stmt.run(key, String(value), (0, db_1.now)());
    }
}
function isLocalSetupRequest(req) {
    if (process.env.FLO_ALLOW_REMOTE_SETUP === '1' ||
        process.env.ALLOW_REMOTE_SETUP === '1' ||
        process.env.NODE_ENV === 'production' ||
        Boolean(process.env.FLO_DEV_USER_DATA)) {
        return true;
    }
    const remoteAddress = req.socket.remoteAddress || req.ip || '';
    return LOCAL_SETUP_HOSTS.has(remoteAddress) || remoteAddress.startsWith('127.');
}
function requireLocalSetup(req, res) {
    if (isLocalSetupRequest(req))
        return true;
    res.status(403).json({ error: 'Initial setup must be completed on the POS computer.' });
    return false;
}
// ── Rate Limiting (In-Memory for local offline apps) ──────────────────────────
const passwordChangeAttempts = new Map();
const PASSWORD_CHANGE_MAX_ATTEMPTS = 5;
const PASSWORD_CHANGE_LOCKOUT_MINUTES = 5;
function checkPasswordChangeRateLimit(userId) {
    const nowMs = Date.now();
    const record = passwordChangeAttempts.get(userId);
    if (record?.lockedUntil && record.lockedUntil > nowMs) {
        return { allowed: false, waitMinutes: Math.ceil((record.lockedUntil - nowMs) / 60000) };
    }
    if (record?.lockedUntil && record.lockedUntil <= nowMs) {
        passwordChangeAttempts.delete(userId);
    }
    return { allowed: true };
}
function incrementFailedPasswordChange(userId) {
    const record = passwordChangeAttempts.get(userId) || { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= PASSWORD_CHANGE_MAX_ATTEMPTS) {
        record.lockedUntil = Date.now() + PASSWORD_CHANGE_LOCKOUT_MINUTES * 60000;
    }
    passwordChangeAttempts.set(userId, record);
    return Math.max(0, PASSWORD_CHANGE_MAX_ATTEMPTS - record.count);
}
function resetPasswordChangeRateLimit(userId) {
    passwordChangeAttempts.delete(userId);
}
// ─────────────────────────────────────────────────────────────────────────────
// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', (0, security_1.loginAuthRateLimit)(), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const rateLimit = (0, security_1.checkLoginRateLimit)(ip);
        if (!rateLimit.allowed) {
            return res.status(429).json({
                error: `Too many failed attempts. Try again in ${rateLimit.waitMinutes} minutes.`,
            });
        }
        const email = normalizeEmail(req.body?.email);
        const { password, rememberMe } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        const db = (0, db_1.getDatabase)();
        const user = db
            .prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
            .get(email);
        let passwordMatches = false;
        if (user) {
            try {
                passwordMatches = await bcryptjs_1.default.compare(password, user.password);
            }
            catch {
                passwordMatches = false;
            }
        }
        if (!user || !passwordMatches) {
            const attemptsRemaining = (0, security_1.incrementFailedLogin)(ip);
            return res.status(401).json({
                error: 'Invalid credentials',
                attempts_remaining: attemptsRemaining,
                lockout_minutes: attemptsRemaining === 0 ? security_1.FAILED_LOGIN_LOCKOUT_MINUTES : undefined,
            });
        }
        (0, security_1.resetSuccessfulLogin)(ip);
        const remember = !!rememberMe;
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role, remember, jti: (0, crypto_1.randomUUID)() }, (0, jwt_secret_1.getJWTSecret)(), { expiresIn: expiresInFor(remember) });
        const tenant = buildLocalTenant(db, user.id, user.role);
        res.json({
            access_token: token,
            token_type: 'bearer',
            expires_in: remember ? JWT_REMEMBER_EXPIRES_IN_SECONDS : 86400,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                category_ids: parseCategoryIds(user.category_ids),
            },
            // Single tenant — frontend auto-selects when tenants.length === 1
            tenants: [tenant],
        });
    }
    catch (error) {
        console.error('[Auth] Login error:', error);
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// ── GET /api/auth/pin-users ───────────────────────────────────────────────────
// Public quick-switch user picker directory: active users with a PIN configured.
router.get('/pin-users', (0, security_1.authRateLimit)({ max: 600 }), (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db
            .prepare(`SELECT id, name, role
         FROM users
         WHERE is_active = 1 AND pin_hash IS NOT NULL
         ORDER BY CASE role
           WHEN 'owner' THEN 1
           WHEN 'manager' THEN 2
           WHEN 'cashier' THEN 3
           WHEN 'server' THEN 4
           WHEN 'chef' THEN 5
           ELSE 6
         END, name COLLATE NOCASE ASC`)
            .all();
        res.json({
            users: rows.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                role: String(row.role),
            })),
        });
    }
    catch (error) {
        console.error('[Auth] PIN users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── POST /api/auth/pin-login ──────────────────────────────────────────────────
// Quick user switch via PIN for a specifically selected user_id.
router.post('/pin-login', (0, security_1.authRateLimit)({
    max: 600,
    skipSuccessfulRequests: true,
    onRateLimited: (req) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const rawUserId = req.body?.user_id;
        const userId = typeof rawUserId === 'string' && rawUserId.trim() ? rawUserId.trim() : null;
        (0, db_1.recordAuthAudit)((0, db_1.getDatabase)(), {
            userId,
            eventType: 'pin_login',
            outcome: 'rate_limited',
            ipAddress: ip,
            details: { reason: 'endpoint_rate_limited' },
        });
    },
}), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const { user_id, pin, rememberMe } = req.body || {};
        const userId = typeof user_id === 'string' ? user_id.trim() : '';
        const rawPin = typeof pin === 'string' || typeof pin === 'number' ? String(pin) : '';
        const db = (0, db_1.getDatabase)();
        if (!userId || !rawPin) {
            (0, db_1.recordAuthAudit)(db, {
                userId: userId || null,
                eventType: 'pin_login',
                outcome: 'failure',
                ipAddress: ip,
                details: {
                    reason: !userId && !rawPin
                        ? 'missing_credentials'
                        : !userId
                            ? 'missing_user_id'
                            : 'missing_pin',
                },
            });
            return res.status(400).json({ error: 'user_id and pin are required' });
        }
        const canonicalIp = (0, security_1.normalizeIpForRateLimit)(ip);
        const pinRateKey = `${canonicalIp}:pin:${userId}`;
        const accountRateKey = `pin-user:${userId}`;
        const verificationResult = await (0, security_1.withPinVerificationLock)(accountRateKey, async () => {
            const ipRateLimit = (0, security_1.checkLoginRateLimit)(pinRateKey);
            const accountRateLimit = (0, security_1.checkLoginRateLimit)(accountRateKey);
            if (!ipRateLimit.allowed || !accountRateLimit.allowed) {
                const waitMinutes = Math.max(ipRateLimit.allowed ? 0 : ipRateLimit.waitMinutes || 0, accountRateLimit.allowed ? 0 : accountRateLimit.waitMinutes || 0);
                (0, db_1.recordAuthAudit)(db, {
                    userId,
                    eventType: 'pin_login',
                    outcome: 'rate_limited',
                    ipAddress: ip,
                    details: { wait_minutes: waitMinutes },
                });
                return {
                    status: 429,
                    body: {
                        error: `Too many failed attempts. Try again in ${waitMinutes} minutes.`,
                    },
                };
            }
            if (!/^\d{4,6}$/.test(rawPin)) {
                const ipAttemptsRemaining = (0, security_1.incrementFailedLogin)(pinRateKey);
                const accountAttemptsRemaining = (0, security_1.incrementFailedLogin)(accountRateKey);
                const attemptsRemaining = Math.min(ipAttemptsRemaining, accountAttemptsRemaining);
                (0, db_1.recordAuthAudit)(db, {
                    userId,
                    eventType: 'pin_login',
                    outcome: 'failure',
                    ipAddress: ip,
                    details: {
                        reason: 'invalid_pin_format',
                        attempts_remaining: attemptsRemaining,
                    },
                });
                return {
                    status: 401,
                    body: {
                        error: 'Invalid credentials',
                        attempts_remaining: attemptsRemaining,
                        lockout_minutes: attemptsRemaining === 0 ? security_1.FAILED_LOGIN_LOCKOUT_MINUTES : undefined,
                    },
                };
            }
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            let pinMatches = false;
            if (user && user.is_active === 1 && user.pin_hash) {
                try {
                    pinMatches = await (0, db_1.verifyPinAsync)(user.pin_hash, rawPin);
                }
                catch {
                    pinMatches = false;
                }
            }
            if (!user || user.is_active !== 1 || !user.pin_hash || !pinMatches) {
                const ipAttemptsRemaining = (0, security_1.incrementFailedLogin)(pinRateKey);
                const accountAttemptsRemaining = (0, security_1.incrementFailedLogin)(accountRateKey);
                const attemptsRemaining = Math.min(ipAttemptsRemaining, accountAttemptsRemaining);
                (0, db_1.recordAuthAudit)(db, {
                    userId,
                    eventType: 'pin_login',
                    outcome: 'failure',
                    ipAddress: ip,
                    details: {
                        reason: !user
                            ? 'user_not_found'
                            : user.is_active !== 1
                                ? 'user_inactive'
                                : !user.pin_hash
                                    ? 'pin_not_set'
                                    : 'invalid_pin',
                        attempts_remaining: attemptsRemaining,
                    },
                });
                return {
                    status: 401,
                    body: {
                        error: 'Invalid credentials',
                        attempts_remaining: attemptsRemaining,
                        lockout_minutes: attemptsRemaining === 0 ? security_1.FAILED_LOGIN_LOCKOUT_MINUTES : undefined,
                    },
                };
            }
            (0, security_1.resetSuccessfulLogin)(pinRateKey);
            (0, security_1.resetSuccessfulLogin)(accountRateKey);
            (0, db_1.recordAuthAudit)(db, {
                userId: user.id,
                eventType: 'pin_login',
                outcome: 'success',
                ipAddress: ip,
                details: { role: user.role },
            });
            return { status: 200, user };
        });
        if (verificationResult.status !== 200) {
            return res.status(verificationResult.status).json(verificationResult.body);
        }
        const { user } = verificationResult;
        const remember = !!rememberMe;
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role, remember, jti: (0, crypto_1.randomUUID)() }, (0, jwt_secret_1.getJWTSecret)(), { expiresIn: expiresInFor(remember) });
        const tenant = buildLocalTenant(db, user.id, user.role);
        res.json({
            access_token: token,
            token_type: 'bearer',
            expires_in: remember ? JWT_REMEMBER_EXPIRES_IN_SECONDS : 86400,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                category_ids: parseCategoryIds(user.category_ids),
            },
            tenant,
            tenants: [tenant],
        });
    }
    catch (error) {
        console.error('[Auth] PIN login error:', error);
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// ── POST /api/auth/tenants/select ─────────────────────────────────────────────
// Frontend calls this after login (even when auto-selecting the single tenant).
router.post('/tenants/select', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, (0, jwt_secret_1.getJWTSecret)());
        const db = (0, db_1.getDatabase)();
        const user = db
            .prepare('SELECT id, name, email, role, is_active, tokens_valid_after FROM users WHERE id = ?')
            .get(decoded.userId);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        if (user.is_active !== 1 || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const tenant = buildLocalTenant(db, user.id, user.role);
        // Re-issue token with tenant context embedded (same payload — desktop is single-tenant)
        const remember = !!decoded.remember;
        const newToken = jsonwebtoken_1.default.sign({
            userId: user.id,
            email: user.email,
            role: user.role,
            tenantId: 1,
            remember,
            jti: (0, crypto_1.randomUUID)(),
        }, (0, jwt_secret_1.getJWTSecret)(), { expiresIn: expiresInFor(remember) });
        res.json({
            access_token: newToken,
            token_type: 'bearer',
            tenant,
        });
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});
// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length);
        try {
            const decoded = jsonwebtoken_1.default.verify(token, (0, jwt_secret_1.getJWTSecret)());
            (0, security_1.revokeToken)(token, typeof decoded.exp === 'number' ? decoded.exp * 1000 : undefined);
        }
        catch {
            // Logout is intentionally idempotent; invalid credentials are not
            // persisted as revocations and are still answered successfully.
        }
    }
    res.json({ message: 'Logged out successfully' });
});
// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, (0, jwt_secret_1.getJWTSecret)());
        // Without this, a token minted before a password/PIN change (#173) could
        // keep refreshing itself into new tokens forever, bypassing revocation entirely.
        const db = (0, db_1.getDatabase)();
        const user = db
            .prepare('SELECT role, is_active, tokens_valid_after FROM users WHERE id = ?')
            .get(decoded.userId);
        if (!user || user.is_active !== 1 || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const remember = !!decoded.remember;
        const newToken = jsonwebtoken_1.default.sign({
            userId: decoded.userId,
            email: decoded.email,
            role: user.role,
            tenantId: decoded.tenantId,
            remember,
            jti: (0, crypto_1.randomUUID)(),
        }, (0, jwt_secret_1.getJWTSecret)(), { expiresIn: expiresInFor(remember) });
        res.json({
            access_token: newToken,
            token_type: 'bearer',
            expires_in: remember ? JWT_REMEMBER_EXPIRES_IN_SECONDS : 86400,
        });
    }
    catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});
// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, (0, jwt_secret_1.getJWTSecret)());
        const db = (0, db_1.getDatabase)();
        const user = db
            .prepare('SELECT id, name, email, role, is_active, tokens_valid_after FROM users WHERE id = ?')
            .get(decoded.userId);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        if (user.is_active !== 1 || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const tenant = buildLocalTenant(db, user.id, user.role);
        res.json({
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
            tenants: [tenant],
        });
    }
    catch {
        res.status(401).json({ error: 'Invalid token' });
    }
});
// ── POST /api/auth/password/change ────────────────────────────────────────────
router.post('/password/change', (0, security_1.authRateLimit)(), (req, res) => {
    try {
        const { current_password, password } = req.body || {};
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, (0, jwt_secret_1.getJWTSecret)());
        const db = (0, db_1.getDatabase)();
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        if (user.is_active !== 1 || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const passwordChangeRateLimit = checkPasswordChangeRateLimit(user.id);
        if (!passwordChangeRateLimit.allowed) {
            return res.status(429).json({
                error: `Too many password change attempts. Try again in ${passwordChangeRateLimit.waitMinutes} minutes.`,
            });
        }
        if (typeof current_password !== 'string' || !current_password) {
            return res.status(400).json({ error: 'Current password is required' });
        }
        if (typeof password !== 'string' || !password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        if (!bcryptjs_1.default.compareSync(current_password, user.password)) {
            const attemptsRemaining = incrementFailedPasswordChange(user.id);
            return res.status(400).json({
                error: 'Current password is incorrect',
                attempts_remaining: attemptsRemaining,
                lockout_minutes: attemptsRemaining === 0 ? PASSWORD_CHANGE_LOCKOUT_MINUTES : undefined,
            });
        }
        resetPasswordChangeRateLimit(user.id);
        if (!(0, security_1.validatePassword)(password)) {
            return res.status(400).json({
                error: password_policy_1.PASSWORD_POLICY_MESSAGE,
            });
        }
        const hashedPassword = bcryptjs_1.default.hashSync(password, 10);
        const changedAt = (0, db_1.now)();
        db.prepare('UPDATE users SET password = ?, tokens_valid_after = ?, updated_at = ? WHERE id = ?').run(hashedPassword, changedAt, changedAt, decoded.userId);
        (0, security_1.invalidateUserAuthCache)(decoded.userId);
        res.json({ message: 'Password changed successfully' });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
/** Writes the recovered password and audit trail; shared by Master PIN and cloud email recovery. */
function applyOwnerRecovery(db, user, newPassword, via) {
    const hashedPassword = bcryptjs_1.default.hashSync(newPassword, 10);
    const changedAt = (0, db_1.now)();
    let restoredOwnerAccess = false;
    const updated = db.transaction(() => {
        // Re-checked in the transaction, so a concurrent write cannot turn a
        // plain reset into a promotion.
        if (via === 'FloAdmin email approval' || (0, authorization_1.hasActiveAdministrator)()) {
            return db
                .prepare('UPDATE users SET password = ?, tokens_valid_after = ?, updated_at = ? WHERE id = ? AND role = ? AND is_active = 1')
                .run(hashedPassword, changedAt, changedAt, user.id, INITIAL_ADMIN_ROLE);
        }
        restoredOwnerAccess = true;
        return db
            .prepare(`
        UPDATE users SET password = ?, role = ?, tokens_valid_after = ?, updated_at = ?
        WHERE id = ? AND is_active = 1
      `)
            .run(hashedPassword, INITIAL_ADMIN_ROLE, changedAt, changedAt, user.id);
    })();
    if (updated.changes === 0) {
        const failure = (0, operation_failure_1.serializeOperationFailure)({
            capture_point: 'fc.backend.auth.recovery.owner_state_changed',
            outcome: 'not_applied',
        });
        try {
            if (failure)
                cloud_sync_1.cloudSync.captureOperationFailure(failure);
        }
        catch {
            // Diagnostics cannot change the recovery conflict response.
        }
        return { ok: false };
    }
    (0, security_1.invalidateUserAuthCache)(user.id);
    upsertSettings(db, {
        last_password_recovery_at: (0, db_1.now)(),
        last_password_recovery_user_id: String(user.id),
        ...(restoredOwnerAccess
            ? {
                last_owner_recovery_at: (0, db_1.now)(),
                last_owner_recovery_user_id: String(user.id),
            }
            : {}),
    });
    console.warn(`[Auth] Password recovery: ${restoredOwnerAccess ? 'owner access' : 'owner password'} was reset locally via ${via} for user ${user.id}`);
    return { ok: true, restoredOwnerAccess };
}
// ── POST /api/auth/recover-password ───────────────────────────────────────────
// Local password recovery for locked-out owner gated by Master PIN; requires no active JWT.
router.post('/recover-password', (0, security_1.authRateLimit)(), (req, res) => {
    try {
        if (!requireLocalSetup(req, res))
            return;
        const db = (0, db_1.getDatabase)();
        // First-run setup is the only recovery path when there is no owner yet —
        // never let this endpoint substitute for /setup/initialize.
        if (getUserCount(db) === 0) {
            return res.status(409).json({
                error: 'Setup has not been completed yet. Use first-run setup to create the owner account.',
            });
        }
        const email = normalizeEmail(req.body?.email);
        const { master_pin, new_password } = req.body || {};
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        if (!new_password || !(0, security_1.validatePassword)(new_password)) {
            return res.status(400).json({
                error: password_policy_1.PASSWORD_POLICY_MESSAGE,
            });
        }
        // Rate-limit key is IP-scoped to prevent resetting attempt counters with varying emails.
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const pinResult = (0, master_pin_1.authorizeMasterPin)(master_pin, `auth:recover-password:${ip}`);
        if (!pinResult.ok) {
            return res.status(pinResult.status).json({ error: pinResult.error });
        }
        // Owners alone can hold the protected permissions, so a store whose active
        // owners are all denied the configurable administrative capabilities strands.
        const stranded = !(0, authorization_1.hasActiveAdministrator)();
        const user = stranded
            ? db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email)
            : db
                .prepare('SELECT * FROM users WHERE email = ? AND role = ? AND is_active = 1')
                .get(email, INITIAL_ADMIN_ROLE);
        if (!user) {
            return res.status(404).json({
                error: stranded
                    ? 'No active account found with that email on this install'
                    : 'No active owner account found with that email on this install',
            });
        }
        const recovery = applyOwnerRecovery(db, user, new_password, 'Master PIN');
        if (!recovery.ok) {
            return res.status(409).json({ error: 'Owner access changed during recovery. Try again.' });
        }
        const { restoredOwnerAccess } = recovery;
        res.json({
            message: restoredOwnerAccess
                ? 'Owner access restored. You can now log in with your new password.'
                : 'Password reset successfully. You can now log in with your new password.',
        });
    }
    catch (error) {
        console.error('[Auth] Password recovery error:', error);
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Cloud email recovery (FloAdmin) ───────────────────────────────────────────
// The owner approves a reset from the email FloAdmin sends; the new password is
// chosen and stored here and never leaves this device.
const RESET_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
function cloudRecoveryPrecheck(req, res) {
    if (!requireLocalSetup(req, res))
        return false;
    if (getUserCount((0, db_1.getDatabase)()) === 0) {
        res.status(409).json({
            error: 'Setup has not been completed yet. Use first-run setup to create the owner account.',
        });
        return false;
    }
    if (!cloud_sync_1.cloudSync.isEmailRecoveryAvailable()) {
        res.status(409).json({ error: 'Email recovery is not available on this install.' });
        return false;
    }
    return true;
}
function maskEmail(email) {
    const [local, domain] = email.split('@');
    return local && domain ? `${local[0]}***@${domain}` : '';
}
function sendCloudRecoveryFailure(res, error) {
    if (error instanceof cloud_sync_1.CloudRequestError) {
        if (error.status === 429) {
            return res.status(429).json({ error: 'Too many reset requests. Try again later.' });
        }
        if (error.status === 409) {
            return res.status(409).json({ error: 'Email recovery is not available on this install.' });
        }
        if (error.status === 404) {
            return res.status(404).json({ error: 'Reset request not found.' });
        }
    }
    console.error('[Auth] Cloud password recovery error:', error);
    return res.status(502).json({ error: 'Could not reach FloAdmin.' });
}
router.post('/recover-password/cloud/request', (0, security_1.authRateLimit)(), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!cloudRecoveryPrecheck(req, res))
        return;
    const email = cloud_sync_1.cloudSync.getRegisteredOwnerEmail();
    const owner = (0, db_1.getDatabase)()
        .prepare('SELECT id FROM users WHERE lower(email) = ? AND role = ? AND is_active = 1')
        .get(email, INITIAL_ADMIN_ROLE);
    if (!owner) {
        return res.status(409).json({ error: 'Email recovery is not available on this install.' });
    }
    try {
        const signal = (0, shutdown_1.getHttpRequestSignal)(req);
        // An unverified owner email gets the verification email first; the reset follows once verified.
        if (!(await cloud_sync_1.cloudSync.ensureOwnerEmailVerification(signal))) {
            return res.status(202).json({
                step: 'verify_email',
                email_hint: maskEmail(email),
            });
        }
        const data = await cloud_sync_1.cloudSync.requestPasswordReset(signal);
        res.status(202).json({
            step: 'reset',
            reset_id: String(data.reset_id || ''),
            expires_at: typeof data.expires_at === 'string' ? data.expires_at : null,
            email_hint: typeof data.email_hint === 'string' ? data.email_hint : null,
        });
    }
    catch (error) {
        sendCloudRecoveryFailure(res, error);
    }
}));
router.get('/recover-password/cloud/verification', (0, security_1.authRateLimit)({ max: 600 }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!cloudRecoveryPrecheck(req, res))
        return;
    try {
        res.json({ verified: await cloud_sync_1.cloudSync.isOwnerEmailVerified((0, shutdown_1.getHttpRequestSignal)(req)) });
    }
    catch (error) {
        sendCloudRecoveryFailure(res, error);
    }
}));
router.get('/recover-password/cloud/status', (0, security_1.authRateLimit)({ max: 600 }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!cloudRecoveryPrecheck(req, res))
        return;
    const resetId = String(req.query.reset_id || '');
    if (!RESET_ID_PATTERN.test(resetId)) {
        return res.status(400).json({ error: 'A valid reset_id is required' });
    }
    try {
        const data = await cloud_sync_1.cloudSync.getPasswordResetStatus(resetId, (0, shutdown_1.getHttpRequestSignal)(req));
        res.json({ status: String(data.status || 'pending') });
    }
    catch (error) {
        sendCloudRecoveryFailure(res, error);
    }
}));
router.post('/recover-password/cloud/complete', (0, security_1.authRateLimit)(), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!cloudRecoveryPrecheck(req, res))
        return;
    const db = (0, db_1.getDatabase)();
    const resetId = String(req.body?.reset_id || '');
    const newPassword = req.body?.new_password;
    if (!RESET_ID_PATTERN.test(resetId)) {
        return res.status(400).json({ error: 'A valid reset_id is required' });
    }
    if (!newPassword || !(0, security_1.validatePassword)(newPassword)) {
        return res.status(400).json({
            error: password_policy_1.PASSWORD_POLICY_MESSAGE,
        });
    }
    // Resolve the account before consuming the single-use grant.
    const email = cloud_sync_1.cloudSync.getRegisteredOwnerEmail();
    const user = db
        .prepare('SELECT * FROM users WHERE lower(email) = ? AND role = ? AND is_active = 1')
        .get(email, INITIAL_ADMIN_ROLE);
    if (!user) {
        return res
            .status(404)
            .json({ error: 'No active owner account matches the registered email.' });
    }
    try {
        await cloud_sync_1.cloudSync.redeemPasswordReset(resetId, (0, shutdown_1.getHttpRequestSignal)(req));
    }
    catch (error) {
        if (error instanceof cloud_sync_1.CloudRequestError && error.status === 409) {
            return res.status(409).json({ error: 'This reset has not been approved or has expired.' });
        }
        return sendCloudRecoveryFailure(res, error);
    }
    const recovery = applyOwnerRecovery(db, user, newPassword, 'FloAdmin email approval');
    if (!recovery.ok) {
        return res.status(409).json({
            error: 'Owner access changed during recovery. This reset approval was used and cannot be reused. Request a new password reset.',
        });
    }
    res.json({
        message: recovery.restoredOwnerAccess
            ? 'Owner access restored. You can now log in with your new password.'
            : 'Password reset successfully. You can now log in with your new password.',
    });
}));
// ── GET /api/auth/setup/status ──────────────────────────────────────────────────
// Returns whether the app needs setup (no users exist yet)
router.get('/setup/status', (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const userCount = getUserCount(db);
        const needsSetup = userCount === 0;
        const currencyReset = needsSetup ? getPendingCurrencyReset(db) : null;
        res.json({
            needsSetup,
            userCount,
            initialRole: INITIAL_ADMIN_ROLE,
            schemaVersion: (0, db_1.getCurrentSchemaVersion)(),
            masterPinAvailable: (0, master_pin_1.isMasterPinAvailable)(),
            cloudRecoveryAvailable: cloud_sync_1.cloudSync.isEmailRecoveryAvailable(),
            currencyReset,
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── POST /api/auth/setup/initialize ─────────────────────────────────────────────
// Creates the initial owner user. This endpoint is disabled after any user exists.
router.post('/setup/initialize', (req, res) => {
    try {
        if (!requireLocalSetup(req, res))
            return;
        // Reject request if setup is already complete before running payload validation.
        const db = (0, db_1.getDatabase)();
        if (getUserCount(db) > 0) {
            return res.status(403).json({ error: 'Setup already complete. This endpoint is disabled.' });
        }
        const pendingCurrencyReset = getPendingCurrencyReset(db);
        const { name, password, business_type = 'restaurant', setup_profile = 'express', service_model = 'qsr', language, business_name, store_name, country, currency, currency_symbol, timezone, business_address, address, business_phone, phone, instagram_handle, tax_registration_number, state_code, tax_registered, billing_type, terms_accepted, master_pin, owner_approval_pin, owner_approval_pin_confirmation, cloud_server_url, email_product_updates, email_marketing, product_analytics_level, cloud_sync_enabled, } = req.body;
        // Without a choice the store shares anonymously and the owner is asked after setup.
        const analyticsLevel = (0, posthog_identity_1.parseProductAnalyticsLevel)(product_analytics_level);
        const telemetryChoice = analyticsLevel === 'off' ? 'false' : 'true';
        const email = normalizeEmail(req.body.email);
        // Regional settings come from signup, never from a fallback — see
        // docs/reference/product-invariants.md. There is no default country.
        const resolvedCountry = typeof country === 'string' ? (0, countries_1.getCountryByCode)(country) : undefined;
        if (!resolvedCountry) {
            return res.status(400).json({ error: 'A valid country is required' });
        }
        const displayName = String(name || '').trim();
        const normalizedBusinessType = String(business_type || 'restaurant').trim();
        const normalizedSetupProfile = String(setup_profile || 'express')
            .trim()
            .toLowerCase();
        const normalizedServiceModel = String(service_model || 'qsr')
            .trim()
            .toLowerCase();
        // Omitted currency derives from the country profile; an explicitly-invalid
        // one is rejected rather than silently replaced (resolveTenantCurrency's
        // read-time leniency is the wrong tool for validating a write).
        const normalizedCurrency = currency === undefined
            ? resolvedCountry.currency
            : typeof currency === 'string'
                ? currency.trim().toUpperCase()
                : currency;
        if (!(0, currencies_1.isSupportedCurrencyCode)(normalizedCurrency)) {
            return res.status(400).json({ error: 'Invalid currency' });
        }
        const resolvedTimezone = timezone === undefined ? resolvedCountry.timezone : timezone;
        if (!(0, countries_1.isValidTimeZone)(resolvedTimezone)) {
            return res.status(400).json({ error: 'Invalid timezone' });
        }
        const storeName = String(store_name || business_name || '').trim();
        const resolvedStoreName = storeName || 'Store';
        const outletAddress = String(business_address || address || '').trim();
        const rawOutletPhone = String(business_phone || phone || '').trim();
        let outletPhone = '';
        if (rawOutletPhone) {
            const normPhone = (0, phone_1.normalizeOptionalPhone)(rawOutletPhone, resolvedCountry.code);
            if (!normPhone.valid) {
                return res.status(400).json({ error: normPhone.error || 'Invalid business phone number' });
            }
            outletPhone = normPhone.e164 || '';
        }
        if (!displayName || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        if (!(0, security_1.validatePassword)(password)) {
            return res.status(400).json({
                error: password_policy_1.PASSWORD_POLICY_MESSAGE,
            });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        if (terms_accepted !== true) {
            return res.status(400).json({
                error: 'You must accept the Terms and Conditions, Privacy Policy, and No Warranty Disclaimer to continue.',
            });
        }
        const masterPinRequired = (0, master_pin_1.isMasterPinAvailable)();
        if (masterPinRequired && !/^\d{4}$/.test(String(master_pin || ''))) {
            return res.status(400).json({ error: 'A 4-digit Master PIN is required to complete setup' });
        }
        const ownerApprovalPin = String(owner_approval_pin || '');
        if (!/^\d{4,6}$/.test(ownerApprovalPin)) {
            return res
                .status(400)
                .json({ error: 'A 4-6 digit owner Approval PIN is required to complete setup' });
        }
        if (ownerApprovalPin !== String(owner_approval_pin_confirmation || '')) {
            return res.status(400).json({ error: 'Owner Approval PINs do not match' });
        }
        if (!VALID_BUSINESS_TYPES.has(normalizedBusinessType)) {
            return res.status(400).json({ error: 'FloCafe setup only supports restaurant businesses' });
        }
        if (!VALID_SETUP_PROFILES.has(normalizedSetupProfile)) {
            return res.status(400).json({ error: 'Invalid setup profile' });
        }
        if (!VALID_SERVICE_MODELS.has(normalizedServiceModel)) {
            return res.status(400).json({ error: 'Invalid service model' });
        }
        // American Pancakes runs locally by default. Cloud coordination remains an
        // explicit future opt-in and is never required for POS operation.
        const cloudSyncEnabled = cloud_sync_enabled === true;
        let normalizedCloudServerUrl;
        if (cloudSyncEnabled) {
            try {
                normalizedCloudServerUrl = (0, cloud_sync_1.normalizeCloudServerUrl)(cloud_server_url || cloud_sync_1.DEFAULT_CLOUD_SERVER_URL);
            }
            catch {
                return res.status(400).json({ error: 'Cloud server URL must be a valid HTTPS URL' });
            }
        }
        let userId = '';
        const hashedPassword = bcryptjs_1.default.hashSync(password, 10);
        const hashedApprovalPin = bcryptjs_1.default.hashSync(ownerApprovalPin, 10);
        // Save Master PIN before committing user transaction so keyring errors leave setup retryable.
        if (masterPinRequired) {
            (0, master_pin_1.setMasterPin)(String(master_pin));
        }
        db.transaction(() => {
            const userCount = getUserCount(db);
            if (userCount > 0) {
                throw new Error('Setup already complete. This endpoint is disabled.');
            }
            const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
            if (existingUser) {
                throw new Error('User with this email already exists');
            }
            userId = (0, crypto_1.randomUUID)();
            db.prepare(`
        INSERT INTO users (id, name, email, password, role, pin_hash, is_active, terms_accepted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, displayName, email, hashedPassword, INITIAL_ADMIN_ROLE, hashedApprovalPin, 1, (0, db_1.now)(), (0, db_1.now)(), (0, db_1.now)());
            upsertSettings(db, {
                business_name: resolvedStoreName,
                business_type: normalizedBusinessType,
                country: resolvedCountry.code,
                currency: normalizedCurrency,
                currency_symbol: currency_symbol || (0, countries_1.getCurrencySymbol)(normalizedCurrency, resolvedCountry.locale),
                timezone: resolvedTimezone,
                language,
                business_address: outletAddress,
                business_phone: outletPhone,
                address: outletAddress,
                phone: outletPhone,
                instagram_handle: String(instagram_handle || '')
                    .trim()
                    .slice(0, 100),
                email,
                tax_registration_number,
                state_code,
                tax_registered,
                billing_type: billing_type || (normalizedServiceModel === 'qsr' ? 'prepaid' : 'postpaid'),
                tables_required: normalizedServiceModel === 'finedine' ? 'true' : 'false',
                service_model: normalizedServiceModel,
                setup_profile: pendingCurrencyReset ? 'empty' : normalizedSetupProfile,
                onboarding_completed: 'true',
                // Confirm country if user explicitly selected it or differed from default.
                ...(0, country_provenance_1.countryConfirmationPatch)(resolvedCountry.code, (0, db_1.getSettingValue)('country'), req.body.country_selected),
                anonymous_data_consent: telemetryChoice,
                telemetry_enabled: telemetryChoice,
                ...(analyticsLevel ? { [posthog_identity_1.PRODUCT_ANALYTICS_LEVEL_SETTING]: analyticsLevel } : {}),
                telemetry_scope: 'usage_stats,country,app_version,platform,session_duration,feature_usage,error_diagnostics',
                split_checks_enabled: 'false',
                // '1'/'0', not 'true'/'false' — mirrors FloAdmin's own `stores` table and
                // matches how cloud-sync.ts reads this key everywhere else.
                cloud_sync_enabled: cloudSyncEnabled ? '1' : '0',
                cloud_server_url: cloudSyncEnabled ? normalizedCloudServerUrl || cloud_sync_1.DEFAULT_CLOUD_SERVER_URL : '',
                email_product_updates: email_product_updates === true ? 'true' : 'false',
                email_marketing: email_marketing === true ? 'true' : 'false',
                cloud_services_disabled_by_user: cloudSyncEnabled ? 'false' : 'true',
            });
            if (!pendingCurrencyReset) {
                (0, seed_data_1.seedSetupProfile)(db, normalizedSetupProfile, normalizedServiceModel, language, resolvedCountry.code);
            }
            if (pendingCurrencyReset) {
                db.prepare("DELETE FROM _flo_meta WHERE key = 'currency_reset_pending'").run();
            }
        })();
        if (cloudSyncEnabled) {
            try {
                cloud_sync_1.cloudSync.reload();
                cloud_sync_1.cloudSync.refreshRegistrationProfile();
            }
            catch (error) {
                console.warn('[Auth] Cloud settings reload deferred after setup:', error);
            }
        }
        if (telemetryChoice === 'true') {
            (0, posthog_1.syncPostHogIdentity)();
            (0, posthog_1.capturePostHogUsage)('setup_completed', {
                setup_profile: normalizedSetupProfile,
                service_model: normalizedServiceModel,
                business_type,
            });
        }
        const token = jsonwebtoken_1.default.sign({ userId, email, role: INITIAL_ADMIN_ROLE, jti: (0, crypto_1.randomUUID)() }, (0, jwt_secret_1.getJWTSecret)(), { expiresIn: JWT_EXPIRES_IN });
        const tenant = buildLocalTenant(db, userId, INITIAL_ADMIN_ROLE);
        res.json({
            access_token: token,
            token_type: 'bearer',
            expires_in: 86400,
            user: { id: userId, name: displayName, email, role: INITIAL_ADMIN_ROLE },
            tenant,
            tenants: [tenant],
        });
    }
    catch (error) {
        console.error('[Auth] Setup error:', error);
        const message = error.message || 'Setup failed';
        const status = message.includes('already complete')
            ? 403
            : message.includes('already exists')
                ? 400
                : 500;
        res.status(status).json({ error: status === 500 ? 'Setup failed' : message });
    }
});
// ── POST /api/auth/setup/seed ───────────────────────────────────────────────────
// Legacy endpoint retained to direct callers to /api/auth/setup/initialize.
router.post('/setup/seed', (req, res) => {
    res
        .status(410)
        .json({ error: 'Use /api/auth/setup/initialize with setup_profile and owner details.' });
});
exports.authRoutes = router;
//# sourceMappingURL=auth.js.map