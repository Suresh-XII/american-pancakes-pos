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
exports.isServerAppRunning = isServerAppRunning;
exports.startServerApp = startServerApp;
exports.stopServerApp = stopServerApp;
exports.getServerAppPort = getServerAppPort;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const node_crypto_1 = require("node:crypto");
const shutdown_1 = require("./shutdown");
const db_1 = require("./db");
const jwt_secret_1 = require("./security/jwt-secret");
const security_1 = require("./middleware/security");
const server_1 = require("./server");
const server_app_state_1 = require("./server-app-state");
const http_limits_1 = require("./http-limits");
const csp_1 = require("./csp");
const pos_sort_1 = require("./lib/pos-sort");
const path_containment_1 = require("./lib/path-containment");
const countries_1 = require("./countries");
const authorization_1 = require("./services/authorization");
let serverApp = null;
let stopPromise = null;
let startReject = null;
let stopping = false;
const SERVER_APP_PORT = (0, server_app_state_1.getDefaultServerAppPort)();
function normalizeEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}
function isServerAppRunning() {
    return serverApp !== null;
}
function getStaticDir() {
    const candidates = [
        path.join(__dirname, '../../frontend/out'),
        path.join(process.resourcesPath || '', 'frontend-out'),
    ];
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'index.html')))
            return dir;
    }
    return null;
}
function rewriteNextExportPath(reqPath) {
    const nextIndex = reqPath.indexOf('__next.');
    if (nextIndex === -1)
        return reqPath;
    const prefix = reqPath.substring(0, nextIndex + '__next.'.length);
    const rest = reqPath.substring(nextIndex + '__next.'.length);
    const lastDotIndex = rest.lastIndexOf('.');
    if (lastDotIndex === -1)
        return reqPath;
    return (prefix + rest.substring(0, lastDotIndex).replace(/\./g, '/') + rest.substring(lastDotIndex));
}
function requireServerAppAuth(req, res, next) {
    if (!(0, db_1.isServerAppEnabled)())
        return res.status(404).json({ error: 'Not found' });
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    if ((0, security_1.isTokenRevoked)(token))
        return res.status(401).json({ error: 'Invalid token' });
    try {
        const decoded = jsonwebtoken_1.default.verify(token, (0, jwt_secret_1.getJWTSecret)());
        const db = (0, db_1.getDatabase)();
        const user = db
            .prepare('SELECT id, email, role, tokens_valid_after FROM users WHERE id = ? AND is_active = 1')
            .get(decoded.userId);
        if (!user || (0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (!(0, authorization_1.hasPermission)(user.id, 'server-app.use')) {
            return res.status(403).json({
                error: 'Access denied. Only server, manager, or owner accounts allowed.',
                code: 'permission_denied',
            });
        }
        req.user = {
            userId: user.id,
            email: user.email,
            role: user.role,
            iat: decoded.iat,
            exp: decoded.exp,
        };
        next();
    }
    catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
}
async function forwardToMainApi(req, res, targetPath) {
    return (0, shutdown_1.trackHttpRequestWork)(req, forwardToMainApiImpl(req, res, targetPath));
}
async function forwardToMainApiImpl(req, res, targetPath) {
    const target = new URL(`/api${targetPath}`, `http://127.0.0.1:${(0, server_1.getServerPort)()}`);
    for (const [key, value] of Object.entries(req.query)) {
        if (Array.isArray(value)) {
            value.forEach((entry) => target.searchParams.append(key, String(entry)));
        }
        else if (value !== undefined) {
            target.searchParams.set(key, String(value));
        }
    }
    const reservation = req.databaseAdmissionReservation;
    const handoffToken = reservation ? (0, db_1.createDatabaseMaintenanceHandoff)(reservation) : undefined;
    try {
        const upstream = await fetch(target, {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
                ...(req.get('Idempotency-Key') ? { 'Idempotency-Key': req.get('Idempotency-Key') } : {}),
                ...(handoffToken ? { 'x-flo-maintenance-handoff': handoffToken } : {}),
            },
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
            signal: (0, shutdown_1.getHttpRequestSignal)(req),
        });
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.status(upstream.status);
        res.type(upstream.headers.get('content-type') || 'application/json');
        res.send(buffer);
    }
    catch (error) {
        if ((0, shutdown_1.getHttpRequestSignal)(req)?.aborted) {
            if (!res.headersSent)
                res.status(503).end();
            else if (!res.writableEnded)
                res.destroy();
            return;
        }
        console.error('[Server App] Main API forward failed:', error);
        res.status(502).json({ error: 'Could not reach the local POS API' });
    }
    finally {
        if (handoffToken) {
            (0, db_1.revokeDatabaseMaintenanceHandoff)(handoffToken);
        }
    }
}
function startServerApp() {
    stopPromise = null;
    stopping = false;
    return new Promise((resolve, reject) => {
        startReject = reject;
        const app = (0, express_1.default)();
        app.disable('x-powered-by');
        app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
            res.setHeader('Content-Security-Policy', (0, csp_1.buildCspHeader)(req));
            next();
        });
        app.get('/robots.txt', (_req, res) => {
            res.type('text/plain');
            res.send('User-agent: *\nDisallow: /\n');
        });
        app.use((0, cors_1.default)(security_1.corsOptions));
        app.use(express_1.default.json({ limit: http_limits_1.API_JSON_BODY_LIMIT }));
        app.use((error, _req, res, next) => {
            if (error?.type === 'entity.too.large') {
                res.status(413).json({
                    error: `Request body is too large. JSON imports are limited to ${http_limits_1.API_JSON_BODY_LIMIT}; use Backup/Restore for full database migration.`,
                });
                return;
            }
            next(error);
        });
        app.use((req, _res, next) => {
            if (req.body === undefined)
                req.body = {};
            next();
        });
        app.use(db_1.databaseMaintenanceMiddleware);
        app.use('/api', (0, security_1.rateLimit)({ windowMs: 60 * 1000, max: 150 }));
        app.get('/api/health', (_req, res) => {
            res.json({
                status: 'ok',
                service: 'Flo Server App',
                version: '1.0.0',
                timestamp: new Date().toISOString(),
            });
        });
        const serverAppApiRateLimit = (0, express_rate_limit_1.default)({
            windowMs: 60 * 1000,
            limit: 600,
            standardHeaders: true,
            legacyHeaders: false,
        });
        app.get('/api/server-app/info', serverAppApiRateLimit, (_req, res) => {
            if (!(0, db_1.isServerAppEnabled)())
                return res.status(404).json({ error: 'Not found' });
            const rows = (0, db_1.getDatabase)().prepare('SELECT key, value FROM settings').all();
            const settings = {};
            for (const row of rows)
                settings[row.key] = row.value;
            let snapshot;
            try {
                snapshot = (0, countries_1.resolveRegionalSnapshot)(settings);
            }
            catch (error) {
                if (error instanceof countries_1.RegionalNotConfiguredError)
                    return res.status(409).json({ error: 'regional_not_configured' });
                throw error;
            }
            res.json({
                language: settings.language || null,
                country: snapshot.country,
                currency: snapshot.currency,
                currency_symbol: snapshot.currencySymbol,
                currency_position: snapshot.currencyPosition,
                currency_fraction_digits: snapshot.currencyFractionDigits,
                kds_enabled: settings.kds_enabled !== 'false',
                ...(0, pos_sort_1.readPosSortSettings)(settings),
            });
        });
        app.post('/api/auth/login', (0, security_1.loginAuthRateLimit)(), (req, res) => {
            if (!(0, db_1.isServerAppEnabled)())
                return res.status(404).json({ error: 'Not found' });
            try {
                const ip = req.ip || req.socket.remoteAddress || 'unknown';
                const loginLimiter = (0, security_1.checkLoginRateLimit)(ip);
                if (!loginLimiter.allowed) {
                    return res.status(429).json({
                        error: `Too many failed attempts. Try again in ${loginLimiter.waitMinutes} minutes.`,
                    });
                }
                const email = normalizeEmail(req.body?.email);
                const { password, remember_me } = req.body;
                if (!email || !password)
                    return res.status(400).json({ error: 'Email and password required' });
                const db = (0, db_1.getDatabase)();
                const bcrypt = require('bcryptjs');
                const user = db
                    .prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
                    .get(email);
                let passwordMatches = false;
                if (user) {
                    try {
                        passwordMatches = bcrypt.compareSync(password, user.password);
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
                if (!(0, authorization_1.hasPermission)(user.id, 'server-app.use')) {
                    return res.status(403).json({
                        error: 'Access denied. Only server, manager, or owner accounts allowed.',
                        code: 'permission_denied',
                    });
                }
                (0, security_1.resetSuccessfulLogin)(ip);
                const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role, jti: (0, node_crypto_1.randomUUID)() }, (0, jwt_secret_1.getJWTSecret)(), { expiresIn: remember_me ? '10d' : '24h' });
                res.json({
                    access_token: token,
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        role: user.role,
                        permission_ids: [...((0, authorization_1.resolveEffectivePermissions)(user.id)?.permissionIds ?? [])],
                        authorization_revision: (0, authorization_1.effectivePermissionRevision)(user.id),
                    },
                });
            }
            catch (error) {
                console.error('[Server App] Login error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        app.get('/api/auth/me', serverAppApiRateLimit, requireServerAppAuth, (req, res) => {
            const user = req.user;
            const row = (0, db_1.getDatabase)()
                .prepare('SELECT id, name, email, role FROM users WHERE id = ? AND is_active = 1')
                .get(user.userId);
            if (!row)
                return res.status(401).json({ error: 'Invalid token' });
            res.json({
                user: {
                    ...row,
                    permission_ids: [...((0, authorization_1.resolveEffectivePermissions)(row.id)?.permissionIds ?? [])],
                    authorization_revision: (0, authorization_1.effectivePermissionRevision)(row.id),
                },
            });
        });
        app.post('/api/auth/logout', serverAppApiRateLimit, requireServerAppAuth, (req, res) => {
            const token = req.headers.authorization?.split(' ')[1];
            const user = req.user;
            if (token)
                (0, security_1.revokeToken)(token, typeof user.exp === 'number' ? user.exp * 1000 : undefined);
            res.json({ success: true });
        });
        app.get('/api/settings/auto_lock_minutes', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/settings/auto_lock_minutes'));
        app.get('/api/categories', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/categories'));
        app.get('/api/products', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/products'));
        app.get('/api/products/:id/image', serverAppApiRateLimit, (req, res) => {
            if (!(0, db_1.isServerAppEnabled)())
                return res.status(404).json({ error: 'Not found' });
            return forwardToMainApi(req, res, `/products/${encodeURIComponent(String(req.params.id))}/image`);
        });
        app.get('/api/tables', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/tables'));
        app.post('/api/tables/:id/move-order', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, `/tables/${encodeURIComponent(String(req.params.id))}/move-order`));
        app.get('/api/orders', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/orders'));
        app.post('/api/orders', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/orders'));
        app.post('/api/orders/:id/items', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, `/orders/${encodeURIComponent(String(req.params.id))}/items`));
        app.get('/api/customers-search', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/customers-search'));
        app.get('/api/crm/lookup', serverAppApiRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/crm/lookup'));
        const customerWriteRateLimit = (0, express_rate_limit_1.default)({
            windowMs: 60 * 1000,
            limit: 150,
            standardHeaders: true,
            legacyHeaders: false,
        });
        app.post('/api/customers', customerWriteRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/customers'));
        const printForwardRateLimit = (0, express_rate_limit_1.default)({
            windowMs: 60 * 1000,
            limit: 30,
            standardHeaders: true,
            legacyHeaders: false,
        });
        app.post('/api/printers/print-kot', printForwardRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/printers/print-kot'));
        app.post('/api/printers/print-bill', printForwardRateLimit, requireServerAppAuth, (req, res) => forwardToMainApi(req, res, '/printers/print-bill'));
        const staticDir = getStaticDir();
        if (staticDir) {
            console.log(`[Server App] Serving static files from: ${staticDir}`);
            if (process.platform === 'win32') {
                app.use((0, security_1.staticRouteRateLimit)(), (req, _res, next) => {
                    if (req.path.includes('__next.')) {
                        const rewritten = rewriteNextExportPath(req.path);
                        if (rewritten !== req.path) {
                            const fullPath = (0, path_containment_1.resolveContainedPath)(staticDir, rewritten);
                            if (fullPath && fs.existsSync(fullPath)) {
                                req.url = rewritten;
                            }
                        }
                    }
                    next();
                });
            }
            app.use(express_1.default.static(staticDir, { dotfiles: 'allow', index: false }));
            app.get('/', (_req, res) => res.redirect('/server-standalone'));
            app.get('/*splat', (0, security_1.staticRouteRateLimit)(), (req, res) => {
                const routePath = (0, path_containment_1.resolveContainedPath)(staticDir, `.${req.path}`, 'index.html');
                if (routePath && fs.existsSync(routePath)) {
                    res.sendFile(routePath, { dotfiles: 'allow' });
                }
                else {
                    res.sendFile(path.join(staticDir, 'server-standalone', 'index.html'), {
                        dotfiles: 'allow',
                    });
                }
            });
        }
        else {
            console.warn('[Server App] Static build not found. Run `npm run build:frontend` first.');
            app.get('/', (_req, res) => {
                res.send(`
          <html><body style="font-family:sans-serif;padding:2rem">
            <h2>Flo Server App - Build not found</h2>
            <p>Run <code>npm run build:frontend</code> then restart the app.</p>
          </body></html>
        `);
            });
        }
        app.use((err, _req, res, _next) => {
            console.error('[Server App] Error:', err);
            res.status(500).json({ error: 'Internal server error' });
        });
        const baseServerAppPort = parseInt(process.env.SERVER_APP_PORT || String(SERVER_APP_PORT), 10);
        let currentPort = baseServerAppPort;
        let attempts = 0;
        const listeningServer = http.createServer(app);
        serverApp = listeningServer;
        (0, shutdown_1.installHttpShutdownTracking)(listeningServer);
        const tryListen = () => {
            const attemptedPort = currentPort;
            const onListening = () => {
                if (stopping) {
                    try {
                        listeningServer.close();
                    }
                    catch {
                        return;
                    }
                    return;
                }
                startReject = null;
                listeningServer.off('error', onError);
                (0, server_app_state_1.setServerAppPort)(attemptedPort);
                console.log(`[Server App] HTTP server running on http://localhost:${(0, server_app_state_1.getServerAppPort)()}`);
                resolve();
            };
            const onError = (err) => {
                if (stopping)
                    return;
                listeningServer.off('listening', onListening);
                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    attempts++;
                    if (attempts >= 10) {
                        const errorMsg = `[Server App] Failed to bind to any port after 10 attempts starting from ${baseServerAppPort}`;
                        console.error(errorMsg);
                        reject(new Error(errorMsg));
                        return;
                    }
                    currentPort++;
                    console.log(`[Server App] Port ${attemptedPort} in use (${err.code}), trying ${currentPort}`);
                    tryListen();
                    return;
                }
                reject(err);
            };
            listeningServer.once('listening', onListening);
            listeningServer.once('error', onError);
            listeningServer.listen(attemptedPort, '0.0.0.0');
        };
        tryListen();
    });
}
function stopServerApp() {
    if (stopPromise)
        return stopPromise;
    stopping = true;
    const rejectStart = startReject;
    startReject = null;
    rejectStart?.((0, shutdown_1.createShutdownCancellationError)('Server App'));
    const serverToClose = serverApp;
    // Mark the server unavailable immediately while active requests drain.
    serverApp = null;
    stopPromise = (0, shutdown_1.closeServerResources)(serverToClose, null, 'Server App').then(() => {
        console.log('[Server App] HTTP server stopped');
    });
    return stopPromise;
}
function getServerAppPort() {
    return (0, server_app_state_1.getServerAppPort)();
}
//# sourceMappingURL=server-app.js.map