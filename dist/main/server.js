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
exports.getAllLocalIPs = exports.getLocalIP = exports.getServerPort = void 0;
exports.requireAuth = requireAuth;
exports.isServerRunning = isServerRunning;
exports.resolveStaticPage = resolveStaticPage;
exports.startServer = startServer;
exports.stopServer = stopServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const http = __importStar(require("http"));
const shutdown_1 = require("./shutdown");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const routes_1 = require("./routes");
const jwt_secret_1 = require("./security/jwt-secret");
const db_1 = require("./db");
const kds_1 = require("./services/kds");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const security_1 = require("./middleware/security");
const whatsapp_1 = require("./services/whatsapp");
const scheduled_orders_1 = require("./services/scheduled-orders");
const posthog_1 = require("./services/posthog");
const http_limits_1 = require("./http-limits");
const csp_1 = require("./csp");
const path_containment_1 = require("./lib/path-containment");
const server_state_1 = require("./server-state");
var server_state_2 = require("./server-state");
Object.defineProperty(exports, "getServerPort", { enumerable: true, get: function () { return server_state_2.getServerPort; } });
Object.defineProperty(exports, "getLocalIP", { enumerable: true, get: function () { return server_state_2.getLocalIP; } });
Object.defineProperty(exports, "getAllLocalIPs", { enumerable: true, get: function () { return server_state_2.getAllLocalIPs; } });
let server = null;
let app;
let wss = null;
let stopPromise = null;
let startReject = null;
let stopping = false;
/** JWT verification middleware protecting API routes from unauthenticated LAN access. Exported so tests can assert its path exemptions. */
function requireAuth(req, res, next) {
    // Express matches routes case-insensitively by default, so /API/pos-info
    // reaches the same handler as /api/pos-info. Every path decision below must
    // use one canonical lowercase form, otherwise a case-variant path skips this
    // middleware while still routing to the protected handler behind it.
    const reqPath = req.path.toLowerCase();
    // Only protect API routes — static files and SPA fallback must pass through
    if (!reqPath.startsWith('/api')) {
        next();
        return;
    }
    // Health check — unauthenticated
    if (reqPath === '/api/health') {
        next();
        return;
    }
    // Auth routes handle their own token verification. Matched with a trailing
    // slash so this doesn't also swallow /api/authorization, which relies on
    // this middleware to populate req.user before its own permission gate runs.
    if (reqPath === '/api/auth' || reqPath.startsWith('/api/auth/')) {
        next();
        return;
    }
    // Allow unauthenticated GET requests for product images (so <img> tags work)
    if (reqPath.startsWith('/api/products/') && reqPath.endsWith('/image') && req.method === 'GET') {
        next();
        return;
    }
    // Paired display devices authenticate with their own scoped token in the handler.
    // Exact path and method, so no lookalike path can skip auth.
    if (req.method === 'GET' && reqPath === '/api/customer-display/feed') {
        next();
        return;
    }
    // Login-screen support-ticket paths, rate-limited in support-ticket.ts.
    // Matched exactly (not by prefix) so a lookalike path can't skip auth.
    if (req.method === 'POST' && reqPath === '/api/support-ticket/pre-login') {
        next();
        return;
    }
    if (req.method === 'GET' && reqPath === '/api/support-ticket/pre-login/profile') {
        next();
        return;
    }
    if (req.method === 'GET' &&
        /^\/api\/support-ticket\/pre-login\/[0-9a-f-]{36}\/status$/i.test(reqPath)) {
        next();
        return;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    try {
        const token = authHeader.split(' ')[1];
        if ((0, security_1.isTokenRevoked)(token)) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }
        const decoded = jsonwebtoken_1.default.verify(token, (0, jwt_secret_1.getJWTSecret)());
        // Reject tokens for users deactivated (or deleted) since token was issued.
        const freshKdsAuth = reqPath.startsWith('/api/kds') ||
            reqPath.startsWith('/api/kitchen') ||
            reqPath.startsWith('/api/order-items');
        const status = (0, security_1.getUserAuthStatus)(decoded.userId, { fresh: freshKdsAuth });
        if (!status || !status.isActive) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }
        // Reject tokens issued before user password/PIN was last changed.
        if ((0, security_1.isTokenStale)(decoded.iat, status.tokensValidAfter)) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }
        // Use current DB role rather than JWT role claim for immediate updates.
        req.user = { ...decoded, role: status.role };
        next();
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
function isServerRunning() {
    return server !== null;
}
/** Locate Next.js static export directory for dev or packaged builds. */
function getFrontendDir() {
    const candidates = [
        // Development / unpackaged: relative to dist/main/ (compiled output of
        // main/, see tsconfig rootDir covering shared/ since #441)
        path.join(__dirname, '../../frontend/out'),
        // Packaged: electron-builder copies it to resources/frontend-out
        path.join(process.resourcesPath || '', 'frontend-out'),
    ];
    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'index.html'))) {
            return dir;
        }
    }
    return null;
}
/** Helper to rewrite dotted Next.js static segment file requests on Windows. */
function rewriteNextExportPath(reqPath) {
    const nextIndex = reqPath.indexOf('__next.');
    if (nextIndex === -1)
        return reqPath;
    const prefix = reqPath.substring(0, nextIndex + '__next.'.length);
    const rest = reqPath.substring(nextIndex + '__next.'.length);
    const lastDotIndex = rest.lastIndexOf('.');
    if (lastDotIndex === -1)
        return reqPath;
    const namePart = rest.substring(0, lastDotIndex);
    const extPart = rest.substring(lastDotIndex);
    const rewrittenName = namePart.replace(/\./g, '/');
    return prefix + rewrittenName + extPart;
}
/** Resolve a clean application route to its own Next.js static-export page. */
function resolveStaticPage(frontendDir, reqPath) {
    const route = reqPath.replace(/^\/+|\/+$/g, '');
    if (!route)
        return path.join(frontendDir, 'index.html');
    // Static app routes contain only path-safe segments. Unknown or suspicious
    // paths fall back to the root page without ever escaping frontendDir.
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(route)) {
        return path.join(frontendDir, 'index.html');
    }
    const candidate = (0, path_containment_1.resolveContainedPath)(frontendDir, route, 'index.html');
    if (!candidate)
        return path.join(frontendDir, 'index.html');
    return fs.existsSync(candidate) ? candidate : path.join(frontendDir, 'index.html');
}
function startServer() {
    stopPromise = null;
    stopping = false;
    return new Promise((resolve, reject) => {
        startReject = reject;
        app = (0, express_1.default)();
        app.set('trust proxy', 1);
        app.disable('x-powered-by');
        // ── Security Headers ───────────────────────────────────────────────
        // Blocks sniffing, framing, crawlers, referrer leaks, and hardware permissions
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
        app.use(posthog_1.postHogApiFailureMiddleware);
        // Scope the anonymous pre-login route to a body limit far below the
        // general API import limit, so it can't force a large allocation.
        app.use('/api/support-ticket/pre-login', express_1.default.json({ limit: '300kb' }));
        app.use(express_1.default.json({ limit: http_limits_1.API_JSON_BODY_LIMIT }));
        app.use((error, req, res, next) => {
            if (error?.type === 'entity.too.large') {
                res.status(413).json({
                    error: req.path === '/api/support-ticket/pre-login'
                        ? 'Request body is too large.'
                        : `Request body is too large. JSON imports are limited to ${http_limits_1.API_JSON_BODY_LIMIT}; use Backup/Restore for full database migration.`,
                });
                return;
            }
            next(error);
        });
        // Restore empty body default for Express 5 compatibility.
        app.use((req, _res, next) => {
            if (req.body === undefined)
                req.body = {};
            next();
        });
        app.use('/api', db_1.databaseMaintenanceMiddleware);
        // ── Global API rate limiting ───────────────────────────────────────
        // Protect all API routes with express-rate-limit and LAN bypass.
        app.use('/api', (0, express_rate_limit_1.default)({
            windowMs: 60 * 1000,
            limit: 100,
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => (0, security_1.isAllowedPrivateIp)(req.ip || req.socket.remoteAddress || ''),
        }));
        // ── Auth middleware (skips /api/health and /api/auth) ─────────────
        app.use(requireAuth);
        // ── API health check ───────────────────────────────────────────────
        app.get('/api/health', (_req, res) => {
            const db = (0, db_1.getDbHealth)();
            res.status(db.ok ? 200 : 503).json({
                status: db.ok ? 'ok' : 'error',
                db: db.ok ? 'ok' : db.error,
                service: 'Flo Local API',
                version: process.env.npm_package_version || '2.4.7',
                timestamp: new Date().toISOString(),
            });
        });
        // ── All API routes ─────────────────────────────────────────────────
        (0, routes_1.registerRoutes)(app);
        // ── Serve Next.js static export ────────────────────────────────────
        // Must come AFTER API routes so /api/* is not caught by the SPA fallback.
        const frontendDir = getFrontendDir();
        if (frontendDir) {
            console.log(`[Server] Serving frontend from: ${frontendDir}`);
            // Middleware to patch Windows-specific Next.js static export path nesting.
            if (process.platform === 'win32') {
                app.use((0, security_1.staticRouteRateLimit)(), (req, res, next) => {
                    if (req.path.includes('__next.')) {
                        const originalPath = req.path;
                        const rewritten = rewriteNextExportPath(originalPath);
                        if (rewritten !== originalPath) {
                            const fullPath = (0, path_containment_1.resolveContainedPath)(frontendDir, rewritten);
                            if (fullPath && fs.existsSync(fullPath)) {
                                req.url = rewritten;
                            }
                        }
                    }
                    next();
                });
            }
            app.use(express_1.default.static(frontendDir, { dotfiles: 'allow', index: false }));
            // Serve each Next.js static route index directly to avoid root redirects.
            app.get(/^(?!\/api(?:\/|$)|\/kds(?:\/|$)).*$/, (0, security_1.staticRouteRateLimit)(), (req, res) => {
                res.sendFile(resolveStaticPage(frontendDir, req.path), { dotfiles: 'allow' });
            });
        }
        else {
            console.warn('[Server] Frontend build not found. Run `npm run build:frontend` first.');
            app.get('/', (_req, res) => {
                res.send(`
          <html><body style="font-family:sans-serif;padding:2rem">
            <h2>Flo – Frontend not built</h2>
            <p>Run <code>npm run build:frontend</code> then restart the app.</p>
          </body></html>
        `);
            });
        }
        // ── Global error handler ───────────────────────────────────────────
        app.use((err, _req, res, _next) => {
            if (err.type === 'entity.parse.failed') {
                return res.status(400).json({ error: 'Malformed JSON request body' });
            }
            const status = typeof err.status === 'number' && err.status >= 400 && err.status < 500
                ? err.status
                : 500;
            if (status >= 500) {
                console.error('[Server] Error:', err);
            }
            res
                .status(status)
                .json({ error: status >= 500 ? 'Internal server error' : err.message || 'Client error' });
        });
        const basePort = parseInt(process.env.PORT || '3001', 10);
        let currentPort = basePort;
        let attempts = 0;
        const listeningServer = http.createServer(app);
        server = listeningServer;
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
                const address = listeningServer.address();
                const boundPort = address && typeof address !== 'string' ? address.port : attemptedPort;
                (0, server_state_1.setServerPort)(boundPort);
                console.log(`[Server] HTTP server running on http://localhost:${boundPort}`);
                if (listeningServer) {
                    // Manual upgrade handler allows checking runtime KDS enablement dynamically per connection.
                    const websocketServer = new ws_1.WebSocketServer({ noServer: true });
                    wss = websocketServer;
                    (0, kds_1.setupKdsWebSocket)(websocketServer);
                    listeningServer.on('upgrade', (request, socket, head) => {
                        const pathname = (request.url || '').split('?')[0];
                        if (pathname !== '/kds') {
                            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
                            socket.destroy();
                            return;
                        }
                        if ((0, db_1.isDatabaseMaintenanceActive)()) {
                            socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
                            socket.destroy();
                            return;
                        }
                        if (!(0, db_1.isKdsEnabled)()) {
                            // Return 404 when disabled to avoid revealing KDS presence to LAN clients.
                            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
                            socket.destroy();
                            return;
                        }
                        try {
                            websocketServer.handleUpgrade(request, socket, head, (ws) => {
                                websocketServer.emit('connection', ws, request);
                            });
                        }
                        catch (error) {
                            console.error('[Server] KDS WebSocket upgrade failed:', error);
                            socket.destroy();
                        }
                    });
                    console.log(`[Server] KDS WebSocket running on ws://localhost:${boundPort}/kds`);
                }
                // This is the single startup owner for WhatsApp in every server mode.
                try {
                    (0, whatsapp_1.initFromDb)();
                }
                catch (error) {
                    console.error('[Server] WhatsApp startup initialization failed:', error);
                }
                (0, scheduled_orders_1.startScheduledOrderSweep)();
                resolve();
            };
            const onError = (err) => {
                if (stopping)
                    return;
                listeningServer.off('listening', onListening);
                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    attempts++;
                    if (attempts >= 10) {
                        const errorMsg = `[Server] Failed to bind to any port after 10 attempts starting from ${basePort}`;
                        console.error(errorMsg);
                        reject(new Error(errorMsg));
                        return;
                    }
                    currentPort++;
                    console.log(`[Server] Port ${attemptedPort} in use (${err.code}), trying ${currentPort}`);
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
function stopServer() {
    if (stopPromise)
        return stopPromise;
    stopping = true;
    (0, scheduled_orders_1.stopScheduledOrderSweep)();
    const rejectStart = startReject;
    startReject = null;
    rejectStart?.((0, shutdown_1.createShutdownCancellationError)('Main server'));
    const serverToClose = server;
    const wssToClose = wss;
    // Mark resources unavailable immediately. Repeated callers share the same
    // promise while the captured resources finish draining.
    server = null;
    wss = null;
    stopPromise = (0, shutdown_1.closeServerResources)(serverToClose, wssToClose, 'Main server').then(() => {
        console.log('[Server] HTTP/WebSocket server stopped');
    });
    return stopPromise;
}
//# sourceMappingURL=server.js.map