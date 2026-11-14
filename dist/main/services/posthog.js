"use strict";
/**
 * PostHog beside the existing collector. Usage follows the sharing level in posthog-identity.ts;
 * nothing is sent without a project token (posthog-config.ts) or outside official releases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.POSTHOG_SHUTDOWN_TIMEOUT_MS = void 0;
exports.invalidatePostHogConsentCache = invalidatePostHogConsentCache;
exports.readSuperProperties = readSuperProperties;
exports.readInstallationEmail = readInstallationEmail;
exports.readPersonProperties = readPersonProperties;
exports.readDailyUsageSummary = readDailyUsageSummary;
exports.readProductAnalyticsChoice = readProductAnalyticsChoice;
exports.readPostHogBootstrap = readPostHogBootstrap;
exports.syncPostHogIdentity = syncPostHogIdentity;
exports.capturePostHogUsage = capturePostHogUsage;
exports.checkPostHogMilestones = checkPostHogMilestones;
exports.maybeSendPostHogDailyPing = maybeSendPostHogDailyPing;
exports.runPostHogDailyChecks = runPostHogDailyChecks;
exports.startPostHog = startPostHog;
exports.stopPostHog = stopPostHog;
exports.capturePostHogException = capturePostHogException;
exports.apiRoutePattern = apiRoutePattern;
exports.capturePostHogApiFailure = capturePostHogApiFailure;
exports.postHogApiFailureMiddleware = postHogApiFailureMiddleware;
const db_1 = require("../db");
const posthog_config_1 = require("./posthog-config");
const offline_mode_1 = require("./offline-mode");
const country_provenance_1 = require("./country-provenance");
const telemetry_1 = require("./telemetry");
const posthog_identity_1 = require("./posthog-identity");
const currencies_1 = require("../../shared/currencies");
const posthog_scrub_1 = require("../../shared/posthog-scrub");
// Well under SHUTDOWN_TIMEOUT_MS: a timed-out cleanup step aborts the rest, database close included.
exports.POSTHOG_SHUTDOWN_TIMEOUT_MS = 2_000;
let client = null;
let clientKey = null;
let clientAbort = null;
(0, offline_mode_1.onOfflineModeEnabled)(() => {
    invalidatePostHogConsentCache();
    if (client)
        void stopPostHog({ flush: false });
});
function appVersion() {
    try {
        const version = require('electron').app?.getVersion?.();
        if (typeof version === 'string' && version)
            return version;
    }
    catch {
        // Outside Electron.
    }
    return require('../../package.json').version;
}
const CONSENT_CACHE_TTL_MS = 30_000;
let cachedConsent = null;
function invalidatePostHogConsentCache() {
    cachedConsent = null;
}
function getEnvCacheKey() {
    return `${process.env.CI ?? ''}|${process.env.FLO_MATRIX_OFFLINE ?? ''}|${process.env.E2E_TASK_LOCAL_PORTS ?? ''}|${process.env.NODE_ENV ?? ''}|${process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK ?? ''}|${process.type ?? ''}|${process.env.FLO_POSTHOG_DEV ?? ''}|${process.env.FLO_POSTHOG_DEV_TOKEN ?? ''}|${process.env.FLO_POSTHOG_DEV_HOST ?? ''}`;
}
function getConsentState() {
    const nowMs = Date.now();
    const revision = (0, db_1.getSettingsRevision)();
    const envKey = getEnvCacheKey();
    if (cachedConsent &&
        cachedConsent.expiresAt > nowMs &&
        cachedConsent.revision === revision &&
        cachedConsent.envKey === envKey) {
        return cachedConsent;
    }
    const level = (0, posthog_identity_1.readProductAnalyticsLevel)();
    const resolvedIdentity = (0, posthog_identity_1.resolvePostHogIdentity)(level);
    const config = (0, posthog_config_1.readPostHogConfig)();
    const diagnosticsEnabled = (0, db_1.isDiagnosticsTransmissionEnabled)();
    const environment = (0, posthog_config_1.postHogEnvironment)();
    cachedConsent = {
        level,
        identity: resolvedIdentity,
        config,
        diagnosticsEnabled,
        environment,
        envKey,
        revision: (0, db_1.getSettingsRevision)(),
        expiresAt: nowMs + CONSENT_CACHE_TTL_MS,
    };
    return cachedConsent;
}
function usageEnabled() {
    return getConsentState().level !== 'off';
}
function identity() {
    return getConsentState().identity;
}
/** Release and channel, plus the device and, at the `full` level, the account (`store_ref`). */
function readSuperProperties(current = identity()) {
    return {
        app_version: appVersion(),
        platform: process.platform,
        run_mode: (0, telemetry_1.getRunMode)(),
        install_source: (0, telemetry_1.getInstallSource)(),
        environment: getConsentState().environment ?? 'development',
        release_channel: /-beta\b/.test(appVersion()) ? 'beta' : 'stable',
        ...(current.installRef ? { install_ref: current.installRef } : {}),
        ...(current.accountRef ? { store_ref: current.accountRef } : {}),
    };
}
function emailField(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 320 || /\s/.test(trimmed) || !trimmed.includes('@')) {
        return undefined;
    }
    return trimmed;
}
/**
 * The store email cloud registration already sends, falling back to the account setup created.
 * Names are never sent.
 */
function readInstallationEmail() {
    const store = emailField((0, db_1.getSettingValue)('email'));
    if (store)
        return store;
    const row = (0, db_1.getDatabase)().prepare('SELECT email FROM users ORDER BY rowid ASC LIMIT 1').get();
    return emailField(row?.email);
}
function readStoreProperties() {
    const properties = {};
    const country = (0, country_provenance_1.readCountryProvenance)().country;
    if (country)
        properties.country = country;
    const currency = (0, currencies_1.normalizeSupportedCurrencyCode)((0, db_1.getSettingValue)('currency'));
    if (currency)
        properties.currency = currency;
    const language = (0, db_1.getSettingValue)('language');
    if (language)
        properties.language = language;
    const serviceModel = (0, db_1.getSettingValue)('service_model');
    if (serviceModel)
        properties.service_model = serviceModel;
    const kds = (0, db_1.getSettingValue)('kds_enabled');
    if (kds !== null)
        properties.kds_enabled = kds === 'true' || kds === '1';
    return properties;
}
/** Store configuration on the person, and the installation email at the `full` level only. */
function readPersonProperties() {
    const level = (0, posthog_identity_1.readProductAnalyticsLevel)();
    if (level === 'off')
        return undefined;
    const email = level === 'full' ? readInstallationEmail() : undefined;
    return {
        ...readStoreProperties(),
        ...readSuperProperties(),
        ...(email ? { email } : {}),
    };
}
function count(sql) {
    try {
        const row = (0, db_1.getDatabase)().prepare(sql).get();
        return typeof row?.n === 'number' ? row.n : undefined;
    }
    catch {
        return undefined;
    }
}
/** Counts only: how much this store used FloCafe in the last 24 hours, and how it is set up. */
function readDailyUsageSummary() {
    const day = "datetime('now', '-1 day')";
    const counts = {
        orders_24h: count(`SELECT COUNT(*) AS n FROM orders WHERE created_at >= ${day}`),
        orders_dine_in_24h: count(`SELECT COUNT(*) AS n FROM orders WHERE created_at >= ${day} AND type = 'dine_in'`),
        orders_takeaway_24h: count(`SELECT COUNT(*) AS n FROM orders WHERE created_at >= ${day} AND type = 'takeaway'`),
        orders_delivery_24h: count(`SELECT COUNT(*) AS n FROM orders WHERE created_at >= ${day} AND type = 'delivery'`),
        orders_online_24h: count(`SELECT COUNT(*) AS n FROM orders WHERE created_at >= ${day} AND type = 'online'`),
        orders_cancelled_24h: count(`SELECT COUNT(*) AS n FROM orders WHERE created_at >= ${day} AND status = 'cancelled'`),
        bills_paid_24h: count(`SELECT COUNT(*) AS n FROM bills WHERE paid_at >= ${day}`),
        staff_with_orders_24h: count(`SELECT COUNT(DISTINCT user_id) AS n FROM orders WHERE created_at >= ${day}`),
        active_staff_count: count('SELECT COUNT(*) AS n FROM users WHERE is_active = 1'),
        products_count: count('SELECT COUNT(*) AS n FROM products'),
        tables_count: count('SELECT COUNT(*) AS n FROM tables'),
        customers_count: count('SELECT COUNT(*) AS n FROM customers'),
        printers_count: count('SELECT COUNT(*) AS n FROM printers'),
        kitchen_stations_count: count('SELECT COUNT(*) AS n FROM kitchen_stations'),
    };
    const summary = {};
    for (const [key, value] of Object.entries(counts)) {
        if (value !== undefined)
            summary[key] = value;
    }
    return { ...summary, ...readStoreProperties() };
}
function createClient(token, host, abortSignal) {
    const { PostHog } = require('posthog-node');
    return new PostHog(token, {
        host,
        isServer: false,
        // Store-level location (country, city) for regional analysis; the SDK defaults it off.
        disableGeoip: false,
        enableLocalEvaluation: false,
        flushAt: 1,
        flushInterval: 0,
        fetch: async (url, options) => {
            if (abortSignal.aborted || (0, posthog_config_1.postHogNetworkSuppressed)()) {
                return new Response(null, { status: 204 });
            }
            const signals = [abortSignal, (0, offline_mode_1.getOfflineModeAbortSignal)()];
            if (options?.signal)
                signals.push(options.signal);
            try {
                return await globalThis.fetch(url, { ...options, signal: AbortSignal.any(signals) });
            }
            catch (error) {
                if (abortSignal.aborted || (0, posthog_config_1.postHogNetworkSuppressed)()) {
                    return new Response(null, { status: 204 });
                }
                throw error;
            }
        },
        before_send: (event) => {
            const { level, diagnosticsEnabled, environment } = getConsentState();
            if (abortSignal.aborted || environment === null)
                return null;
            return (0, posthog_scrub_1.scrubPostHogEvent)(event, {
                telemetryEnabled: level !== 'off',
                accountLinked: level === 'full',
                allowExceptions: diagnosticsEnabled,
            });
        },
    });
}
function activeClient() {
    const { config, level, diagnosticsEnabled, environment } = getConsentState();
    if (environment === null)
        return null;
    if (!config)
        return null;
    if (level === 'off' && !diagnosticsEnabled)
        return null;
    const key = `${config.host}\n${config.token}`;
    if (client && clientKey === key)
        return client;
    const previous = client;
    const previousAbort = clientAbort;
    const nextAbort = new AbortController();
    client = createClient(config.token, config.host, nextAbort.signal);
    clientKey = key;
    clientAbort = nextAbort;
    previousAbort?.abort();
    if (previous)
        void previous.shutdown(exports.POSTHOG_SHUTDOWN_TIMEOUT_MS).catch(() => { });
    return client;
}
/** The sharing level for Settings and the one-time question, asked only where PostHog can send. */
function readProductAnalyticsChoice() {
    invalidatePostHogConsentCache();
    return {
        level: (0, posthog_identity_1.readProductAnalyticsLevel)(),
        choice_pending: (0, posthog_identity_1.productAnalyticsChoicePending)() &&
            !(0, posthog_config_1.postHogNetworkSuppressed)() &&
            (0, posthog_config_1.readPostHogConfig)() !== null,
        email: readInstallationEmail() ?? null,
        diagnostics_enabled: (0, db_1.isDiagnosticsTransmissionEnabled)(),
    };
}
function readPostHogBootstrap() {
    invalidatePostHogConsentCache();
    if ((0, posthog_config_1.postHogNetworkSuppressed)())
        return { enabled: false };
    const config = (0, posthog_config_1.readPostHogConfig)();
    if (!config)
        return { enabled: false };
    const level = (0, posthog_identity_1.readProductAnalyticsLevel)();
    const telemetryEnabled = level !== 'off';
    const diagnosticsEnabled = (0, db_1.isDiagnosticsTransmissionEnabled)();
    if (!telemetryEnabled && !diagnosticsEnabled)
        return { enabled: false };
    const current = (0, posthog_identity_1.resolvePostHogIdentity)(level);
    return {
        enabled: true,
        distinctId: current.distinctId,
        // At `anonymous` main has created the device person, so renderer events join it.
        identified: current.identified || level === 'anonymous',
        token: config.token,
        host: config.host,
        telemetryEnabled,
        accountLinked: level === 'full',
        diagnosticsEnabled,
        superProperties: readSuperProperties(current),
    };
}
/**
 * Updates the person for the current level: the account with the device folded into it, or the
 * anonymous device. Safe to call when PostHog is not configured.
 */
function syncPostHogIdentity() {
    try {
        invalidatePostHogConsentCache();
        if ((0, posthog_config_1.postHogNetworkSuppressed)() || !(0, posthog_config_1.readPostHogConfig)()) {
            if (client)
                void stopPostHog({ flush: false });
            return;
        }
        if (!usageEnabled() && !getConsentState().diagnosticsEnabled) {
            void stopPostHog({ flush: false });
            return;
        }
        if (!usageEnabled())
            return;
        const current = activeClient();
        if (!current)
            return;
        const who = identity();
        const device = who.identified ? (0, posthog_identity_1.pendingAlias)(who) : null;
        if (device) {
            current.alias({ distinctId: who.distinctId, alias: device });
            (0, posthog_identity_1.markAliased)(who);
        }
        const person = readPersonProperties();
        current.capture({
            distinctId: who.distinctId,
            event: who.identified ? '$identify' : '$set',
            properties: person ? { $set: person } : {},
        });
    }
    catch {
        // A failed PostHog send is dropped. There is no outbox.
    }
}
/** Mirrors a usage event the collector also receives. Dropped at the `off` level. */
function capturePostHogUsage(event, properties) {
    try {
        if (!usageEnabled())
            return;
        const current = activeClient();
        if (!current)
            return;
        const who = identity();
        current.capture({
            distinctId: who.distinctId,
            event,
            properties: { ...readSuperProperties(who), ...(properties ?? {}) },
        });
    }
    catch {
        // A failed PostHog send is dropped. There is no outbox.
    }
}
const MILESTONES_SETTING = 'posthog_milestones_sent';
const MILESTONES_SINCE_SETTING = 'posthog_milestones_since';
const DAILY_PING_SETTING = 'posthog_last_daily_ping_at';
const DAILY_PING_MIN_GAP_MS = 24 * 60 * 60_000;
const MILESTONES = [
    { event: 'first_order_created', sql: 'SELECT MIN(created_at) AS at FROM orders' },
    { event: 'first_bill_paid', sql: 'SELECT MIN(paid_at) AS at FROM bills' },
];
function dbTimeMs(value) {
    return value ? Date.parse(`${value.replace(' ', 'T')}Z`) : NaN;
}
function hoursBetween(from, to) {
    const start = dbTimeMs(from);
    const end = dbTimeMs(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
        return undefined;
    return Math.round(((end - start) / 3_600_000) * 10) / 10;
}
/**
 * First order and first payment, once per installation, read from the database. Milestones older
 * than this check (upgraded stores) are tagged `backfilled` to keep them out of live funnels.
 */
function checkPostHogMilestones() {
    try {
        if (!usageEnabled() || !activeClient())
            return;
        const db = (0, db_1.getDatabase)();
        let since = (0, db_1.getSettingValue)(MILESTONES_SINCE_SETTING);
        if (!since) {
            since = (0, db_1.now)();
            (0, db_1.upsertSettings)({ [MILESTONES_SINCE_SETTING]: since });
        }
        const sent = new Set(((0, db_1.getSettingValue)(MILESTONES_SETTING) ?? '').split(',').filter(Boolean));
        const setupAt = db.prepare('SELECT created_at AS at FROM users ORDER BY rowid ASC LIMIT 1').get()?.at;
        for (const milestone of MILESTONES) {
            if (sent.has(milestone.event))
                continue;
            const at = db.prepare(milestone.sql).get()?.at;
            if (!at)
                continue;
            const hours = hoursBetween(setupAt, at);
            capturePostHogUsage(milestone.event, {
                ...(hours === undefined ? {} : { hours_since_setup: hours }),
                ...(dbTimeMs(at) < dbTimeMs(since) ? { backfilled: true } : {}),
            });
            sent.add(milestone.event);
            (0, db_1.upsertSettings)({ [MILESTONES_SETTING]: [...sent].join(',') });
        }
    }
    catch {
        // Milestones are best-effort.
    }
}
/**
 * The 24h usage summary, at most once a day and independent of the collector. Best effort:
 * a ping the SDK cannot deliver is not resent.
 */
function maybeSendPostHogDailyPing(nowMs = Date.now()) {
    try {
        if (!usageEnabled() || !activeClient())
            return;
        const last = dbTimeMs((0, db_1.getSettingValue)(DAILY_PING_SETTING));
        if (Number.isFinite(last) && nowMs - last < DAILY_PING_MIN_GAP_MS)
            return;
        capturePostHogUsage('daily_ping', readDailyUsageSummary());
        (0, db_1.upsertSettings)({ [DAILY_PING_SETTING]: (0, db_1.now)() });
    }
    catch {
        // The daily ping is best-effort.
    }
}
/** Runs from the telemetry service's hourly check. */
function runPostHogDailyChecks() {
    maybeSendPostHogDailyPing();
    checkPostHogMilestones();
}
function startPostHog() {
    syncPostHogIdentity();
}
async function stopPostHog(options) {
    invalidatePostHogConsentCache();
    const current = client;
    const currentAbort = clientAbort;
    client = null;
    clientKey = null;
    clientAbort = null;
    if (!current)
        return;
    const suppressFlush = options?.flush === false || (0, posthog_config_1.postHogNetworkSuppressed)();
    if (suppressFlush) {
        currentAbort?.abort();
        const internal = current;
        internal.disabled = true;
        if (Array.isArray(internal.queue))
            internal.queue.length = 0;
    }
    try {
        await current.shutdown(exports.POSTHOG_SHUTDOWN_TIMEOUT_MS);
    }
    catch {
        // Drop a failed flush.
    }
}
/** A copy of the error whose message is redacted and whose stack carries only frame lines. */
function scrubbedError(input) {
    const record = input instanceof Error
        ? { name: input.name, message: input.message, stack: input.stack }
        : input && typeof input === 'object'
            ? input
            : {};
    const stack = typeof record.stack === 'string' ? record.stack : undefined;
    const name = (0, posthog_scrub_1.sanitizeErrorName)(record.name, stack);
    const message = (0, posthog_scrub_1.redactExceptionMessage)(record.message);
    const error = new Error(message);
    error.name = name;
    error.stack = [message ? `${name}: ${message}` : name, ...(0, posthog_scrub_1.stackFrameLines)(stack)].join('\n');
    return error;
}
function capturePostHogException(capturePoint, input, properties) {
    try {
        if (!(0, posthog_scrub_1.isPostHogCapturePoint)(capturePoint))
            return;
        if (!getConsentState().diagnosticsEnabled)
            return;
        const current = activeClient();
        if (!current)
            return;
        const who = identity();
        current.captureException(scrubbedError(input), who.distinctId, {
            ...readSuperProperties(who),
            ...(who.identified || who.installRef ? {} : { $process_person_profile: false }),
            ...(properties ?? {}),
            capture_point: capturePoint,
        });
    }
    catch {
        // A failed PostHog send is dropped. There is no outbox.
    }
}
/**
 * The matched route pattern, such as `/api/orders/:id`. Express resets `baseUrl` once an error
 * leaves its router, so the mount prefix is recovered from the request path instead.
 */
function apiRoutePattern(originalUrl, routePath) {
    if (typeof routePath !== 'string' || /[*{(]/.test(routePath))
        return '<unmatched>';
    const pathSegments = originalUrl.split('?')[0].split('/').filter(Boolean);
    const routeSegments = routePath.split('/').filter(Boolean);
    if (routeSegments.length > pathSegments.length)
        return '<unmatched>';
    const prefix = pathSegments.slice(0, pathSegments.length - routeSegments.length);
    return `/${[...prefix, ...routeSegments].join('/')}`;
}
/** A 5xx from the local API, keyed by method and route pattern. No params, query, or body. */
function capturePostHogApiFailure(method, route, status) {
    const error = new Error(`${method} ${route}`);
    error.name = 'ApiServerError';
    error.stack = error.name;
    capturePostHogException('api-5xx', error, {
        http_method: method,
        http_route: route,
        http_status: status,
    });
}
/** Reports every 5xx the local API sends, including those from the global error handler. */
function postHogApiFailureMiddleware(req, res, next) {
    res.on('finish', () => {
        if (res.statusCode < 500)
            return;
        const route = req.route
            ? apiRoutePattern(req.originalUrl, req.route.path)
            : req.baseUrl || '<unmatched>';
        capturePostHogApiFailure(req.method, route, res.statusCode);
    });
    next();
}
//# sourceMappingURL=posthog.js.map