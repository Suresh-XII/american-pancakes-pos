"use strict";
/** Anonymous usage telemetry using a randomized local UUID, independent of cloud sync. */
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
exports.telemetry = exports.TELEMETRY_URL = void 0;
exports.linuxPackageFromOsRelease = linuxPackageFromOsRelease;
exports.getRunMode = getRunMode;
exports.getInstallSource = getInstallSource;
exports.isTelemetrySuppressed = isTelemetrySuppressed;
exports.sendEvent = sendEvent;
exports.sendAnonymousDiagnosticReport = sendAnonymousDiagnosticReport;
exports.isTelemetryDailyTimerActive = isTelemetryDailyTimerActive;
const fs = __importStar(require("fs"));
const country_provenance_1 = require("./country-provenance");
const electron_log_1 = __importDefault(require("electron-log"));
const db_1 = require("../db");
const currencies_1 = require("../../shared/currencies");
const operation_failure_1 = require("../lib/operation-failure");
const build_identity_1 = require("./build-identity");
const offline_mode_1 = require("./offline-mode");
const posthog_config_1 = require("./posthog-config");
exports.TELEMETRY_URL = 'https://telemetry.flopos.com/collect';
const REQUEST_TIMEOUT_MS = 8_000;
const DIAGNOSTIC_REPORT_KEYS = 'app_build,app_version,capture_point,classification,count,examples,facts,first_occurred_at,last_occurred_at,operation,outcome,platform,reason_code,report_id,schema_version,stage,window_start';
const DAILY_PING_INTERVAL_MS = 60 * 60_000; // check hourly, send at most once/24h
const DAILY_PING_MIN_GAP_MS = 24 * 60 * 60_000;
let dailyPingTimer = null;
let telemetryStopping = false;
let telemetryStopPromise = null;
const inFlightTelemetry = new Set();
(0, offline_mode_1.onOfflineModeEnabled)(() => {
    if (dailyPingTimer) {
        clearInterval(dailyPingTimer);
        dailyPingTimer = null;
    }
});
/**
 * Resolves Electron's `app` without assuming an Electron runtime. This module is
 * imported by unit tests and scripts where `electron` resolves to a path string
 * or is missing entirely, so an unguarded `app.isPackaged` would throw. Any
 * failure degrades to a dev-mode report instead of breaking the import.
 */
function electronApp() {
    try {
        const electronModule = require('electron');
        return electronModule?.app;
    }
    catch {
        return undefined;
    }
}
function isPackagedRun() {
    return electronApp()?.isPackaged === true;
}
function envFlag(name) {
    return String(process.env[name] ?? '').trim() !== '';
}
/** The distro families each native Linux package format belongs to. */
const DEBIAN_FAMILY = ['debian', 'ubuntu'];
const RPM_FAMILY = ['rhel', 'fedora', 'suse'];
/**
 * Maps `/etc/os-release` contents to a native Linux package format. `ID` is
 * authoritative; `ID_LIKE` carries the parent families, which is how a
 * derivative such as Rocky Linux or Linux Mint still resolves. Anything else
 * reports `linux_package` rather than a guess.
 */
function linuxPackageFromOsRelease(contents) {
    const fields = new Map();
    for (const line of contents.split('\n')) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/m.exec(line.trim());
        if (match)
            fields.set(match[1].toLowerCase(), match[2].trim().replace(/^"(.*)"$/, '$1'));
    }
    const families = [fields.get('id'), ...String(fields.get('id_like') ?? '').split(/\s+/)]
        .map((value) => String(value ?? '')
        .trim()
        .toLowerCase())
        .filter(Boolean);
    if (families.some((id) => DEBIAN_FAMILY.includes(id)))
        return 'deb';
    if (families.some((id) => RPM_FAMILY.includes(id)))
        return 'rpm';
    return 'linux_package';
}
function linuxPackageFormat() {
    try {
        return linuxPackageFromOsRelease(fs.readFileSync('/etc/os-release', 'utf8'));
    }
    catch {
        return 'linux_package';
    }
}
/** `packaged` for a real merchant install, `dev` for `npm run dev` and non-Electron hosts. */
function getRunMode() {
    return isPackagedRun() ? 'packaged' : 'dev';
}
/** Classifies the distribution channel the running binary was installed from. */
function getInstallSource() {
    if (!isPackagedRun())
        return 'dev';
    if (process.windowsStore)
        return 'ms_store';
    if (process.mas)
        return 'mac_app_store';
    if (envFlag('SNAP'))
        return 'snap';
    if (envFlag('APPIMAGE'))
        return 'appimage';
    if (envFlag('FLATPAK_ID'))
        return 'flatpak';
    if (process.platform === 'win32' || process.platform === 'darwin')
        return 'github';
    return linuxPackageFormat();
}
function isTelemetrySuppressed() {
    if ((0, offline_mode_1.isOfflineMode)())
        return true;
    if (process.env.FLO_MATRIX_OFFLINE === '1' ||
        Boolean(process.env.E2E_TASK_LOCAL_PORTS) ||
        process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK === '1') {
        return true;
    }
    if (process.env.FLO_TELEMETRY_DEV === '1') {
        return false;
    }
    if (process.env.NODE_ENV === 'test' || Boolean(process.env.CI)) {
        return true;
    }
    const version = electronApp()?.getVersion?.() ?? '0.0.0';
    if (version === '1.0.0-test' ||
        version === 'test' ||
        version === 'e2e' ||
        /(?:^|[-.])(?:test|e2e)(?:[-.]|$)/i.test(version)) {
        return true;
    }
    const isDev = !electronApp()?.isPackaged || (0, build_identity_1.getBuildIdentity)() === 'dev';
    if (isDev)
        return true;
    return false;
}
function matrixOffline() {
    return isTelemetrySuppressed();
}
function trackTelemetry(operation) {
    inFlightTelemetry.add(operation);
    void operation.finally(() => inFlightTelemetry.delete(operation)).catch(() => { });
    return operation;
}
async function sendEventImpl(eventType, payload) {
    if (matrixOffline() || !(0, db_1.isTelemetryEnabled)())
        return false;
    try {
        const offlineSignal = (0, offline_mode_1.getOfflineModeAbortSignal)();
        const anonId = (0, db_1.ensureTelemetryAnonId)();
        // Report only user-confirmed country so FloAdmin IP geolocation fallback can operate.
        const provenance = (0, country_provenance_1.readCountryProvenance)();
        const country = provenance.country ?? undefined;
        const currency = (0, currencies_1.normalizeSupportedCurrencyCode)((0, db_1.getSettingValue)('currency')) ?? undefined;
        const response = await fetch(exports.TELEMETRY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anon_id: anonId,
                app: 'flocafe',
                app_version: electronApp()?.getVersion?.() ?? '0.0.0',
                event_type: eventType,
                platform: process.platform,
                run_mode: getRunMode(),
                install_source: getInstallSource(),
                ...(country ? { country } : {}),
                ...(currency ? { currency } : {}),
                ...(payload ? { payload } : {}),
            }),
            signal: AbortSignal.any([offlineSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        if (matrixOffline() || offlineSignal.aborted) {
            await response.body?.cancel().catch(() => { });
            return false;
        }
        const ok = response.ok;
        if (!ok) {
            electron_log_1.default.debug(`[Flo] telemetry rejected with HTTP ${response.status}`);
        }
        await response.body?.cancel().catch(() => { });
        return ok;
    }
    catch (e) {
        // Telemetry must never disrupt the app or surface to the user.
        electron_log_1.default.debug('[Flo] telemetry send failed (non-fatal):', e);
        return false;
    }
}
/** PostHog receives the same usage events; required lazily because posthog.ts imports this module. */
function mirrorToPostHog(eventType, payload) {
    if (eventType !== 'app_launch' && eventType !== 'feature_used')
        return;
    try {
        require('./posthog').capturePostHogUsage(eventType, payload);
    }
    catch {
        // PostHog is optional and never disrupts the collector.
    }
}
/** PostHog's daily ping and milestones run on this timer but never wait on the collector. */
function runPostHogDailyChecks() {
    if (telemetryStopping || !(0, db_1.isTelemetryEnabled)())
        return;
    try {
        require('./posthog').runPostHogDailyChecks();
    }
    catch {
        // PostHog is optional.
    }
}
function sendEvent(eventType, payload) {
    if (telemetryStopping)
        return Promise.resolve(false);
    mirrorToPostHog(eventType, payload);
    if (matrixOffline())
        return Promise.resolve(false);
    return trackTelemetry(sendEventImpl(eventType, payload));
}
function anonymousRetryAfterMs(value) {
    if (!value)
        return undefined;
    const seconds = Number(value.trim());
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - Date.now();
    return Number.isFinite(delay) && delay >= 0 ? Math.min(60 * 60_000, delay) : undefined;
}
function safeAnonymousDiagnosticProjection(report) {
    if (Object.keys(report).sort().join(',') !== DIAGNOSTIC_REPORT_KEYS ||
        report.schema_version !== 2 ||
        !(0, operation_failure_1.isOperationReference)(report.report_id) ||
        !Number.isSafeInteger(report.count) ||
        report.count < 1 ||
        report.count > 100_000 ||
        !Array.isArray(report.examples) ||
        report.examples.length > 3 ||
        report.examples.some((value) => !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            Object.keys(value).join(',') !== 'correlation_id' ||
            !(0, operation_failure_1.isOperationReference)(value.correlation_id)))
        return null;
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: report.capture_point,
        outcome: report.outcome,
        facts: report.facts,
    });
    if (!failure ||
        failure.reason_code !== report.reason_code ||
        failure.classification !== report.classification ||
        failure.operation !== report.operation ||
        failure.stage !== report.stage)
        return null;
    const timestamp = (value) => typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
        Number.isFinite(Date.parse(value));
    if (!timestamp(report.window_start) ||
        !timestamp(report.first_occurred_at) ||
        !timestamp(report.last_occurred_at))
        return null;
    const window = Date.parse(report.window_start);
    const first = Date.parse(report.first_occurred_at);
    const last = Date.parse(report.last_occurred_at);
    if (new Date(window).toISOString().replace(/\.\d{3}Z$/, 'Z') !== report.window_start ||
        new Date(window).getUTCMinutes() !== 0 ||
        new Date(window).getUTCSeconds() !== 0 ||
        Math.floor(first / 3_600_000) !== Math.floor(window / 3_600_000) ||
        Math.floor(last / 3_600_000) !== Math.floor(window / 3_600_000) ||
        first > last)
        return null;
    for (const key of ['app_version', 'app_build']) {
        if (typeof report[key] !== 'string' || !/^[A-Za-z0-9._:+-]{1,64}$/.test(report[key]))
            return null;
    }
    if (typeof report.platform !== 'string' ||
        !['win32', 'darwin', 'linux', 'unknown'].includes(report.platform))
        return null;
    return {
        schema_version: 2,
        report_id: report.report_id,
        reason_code: failure.reason_code,
        classification: failure.classification,
        operation: failure.operation,
        stage: failure.stage,
        outcome: failure.outcome,
        capture_point: failure.capture_point,
        count: report.count,
        window_start: report.window_start,
        first_occurred_at: report.first_occurred_at,
        last_occurred_at: report.last_occurred_at,
        app_version: report.app_version,
        app_build: report.app_build,
        platform: report.platform,
        facts: failure.facts,
    };
}
/** Sends a store-unlinked count report through the existing anonymous collector. */
async function sendAnonymousDiagnosticReport(report) {
    if (matrixOffline() ||
        telemetryStopping ||
        !(0, db_1.isTelemetryEnabled)() ||
        !(0, db_1.isDiagnosticsConsentEnabled)() ||
        !(0, db_1.isDiagnosticsTransmissionEnabled)())
        return { disposition: 'network_error' };
    const safeReport = safeAnonymousDiagnosticProjection(report);
    if (!safeReport)
        return { disposition: 'invalid_ack' };
    try {
        const offlineSignal = (0, offline_mode_1.getOfflineModeAbortSignal)();
        const anonId = (0, db_1.ensureTelemetryAnonId)();
        const build = (0, build_identity_1.getBuildIdentity)();
        const response = await fetch(exports.TELEMETRY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anon_id: anonId,
                app: 'flocafe',
                app_version: electronApp()?.getVersion?.() ?? '0.0.0',
                app_build: build,
                event_type: 'diagnostic_counts',
                platform: process.platform,
                run_mode: getRunMode(),
                install_source: getInstallSource(),
                payload: { schema_version: 2, report: safeReport },
            }),
            signal: AbortSignal.any([offlineSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        if (matrixOffline() || offlineSignal.aborted) {
            await response.body?.cancel().catch(() => { });
            return { disposition: 'network_error' };
        }
        const ack = (await response.json().catch(() => null));
        await response.body?.cancel().catch(() => { });
        if (matrixOffline() || offlineSignal.aborted) {
            return { disposition: 'network_error' };
        }
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
            return {
                disposition: 'network_error',
                retry_after_ms: anonymousRetryAfterMs(response.headers.get('retry-after')),
            };
        }
        const reportId = safeReport.report_id;
        if (ack && (0, operation_failure_1.isOperationReference)(ack.report_id) && ack.report_id !== reportId)
            return { disposition: 'report_id_mismatch' };
        if (!ack ||
            Object.keys(ack).sort().join(',') !== 'disposition,report_id,schema_version' ||
            ack.schema_version !== 2 ||
            !(0, operation_failure_1.isOperationReference)(ack.report_id) ||
            ack.report_id !== reportId)
            return { disposition: 'invalid_ack' };
        if (response.ok && (ack.disposition === 'accepted' || ack.disposition === 'duplicate'))
            return { disposition: ack.disposition };
        if (response.status === 422 && ack.disposition === 'rejected')
            return { disposition: 'rejected' };
        return { disposition: 'invalid_ack' };
    }
    catch {
        return { disposition: 'network_error' };
    }
}
function maybeSendDailyPing() {
    if (matrixOffline() || telemetryStopping)
        return;
    if (!(0, db_1.isTelemetryEnabled)())
        return;
    const lastPingAt = (0, db_1.getSettingValue)('telemetry_last_ping_at');
    const lastPingMs = lastPingAt ? (0, db_1.parseDbTimestamp)(lastPingAt).getTime() : NaN;
    const elapsed = isNaN(lastPingMs) ? Infinity : Date.now() - lastPingMs;
    if (elapsed < DAILY_PING_MIN_GAP_MS)
        return;
    const operation = sendEvent('daily_ping').then((sent) => {
        if (sent && !matrixOffline())
            (0, db_1.upsertTelemetryLastPing)();
    });
    trackTelemetry(operation);
}
function isTelemetryDailyTimerActive() {
    return dailyPingTimer !== null;
}
function armDailyChecks() {
    if (telemetryStopping)
        return;
    if (dailyPingTimer) {
        clearInterval(dailyPingTimer);
        dailyPingTimer = null;
    }
    if (matrixOffline() && (0, posthog_config_1.postHogNetworkSuppressed)())
        return;
    if (!matrixOffline())
        maybeSendDailyPing();
    runPostHogDailyChecks();
    if (!matrixOffline() || !(0, posthog_config_1.postHogNetworkSuppressed)()) {
        dailyPingTimer = setInterval(() => {
            if (!matrixOffline())
                maybeSendDailyPing();
            runPostHogDailyChecks();
        }, DAILY_PING_INTERVAL_MS);
    }
}
exports.telemetry = {
    start() {
        telemetryStopping = false;
        telemetryStopPromise = null;
        try {
            require('./posthog').invalidatePostHogConsentCache();
        }
        catch { }
        if (dailyPingTimer) {
            clearInterval(dailyPingTimer);
            dailyPingTimer = null;
        }
        if (matrixOffline() && (0, posthog_config_1.postHogNetworkSuppressed)())
            return;
        void sendEvent('app_launch');
        armDailyChecks();
    },
    resumeDailyChecks() {
        telemetryStopping = false;
        telemetryStopPromise = null;
        try {
            require('./posthog').invalidatePostHogConsentCache();
        }
        catch { }
        armDailyChecks();
    },
    stop() {
        if (telemetryStopPromise)
            return telemetryStopPromise;
        telemetryStopping = true;
        try {
            require('./posthog').invalidatePostHogConsentCache();
        }
        catch { }
        if (dailyPingTimer) {
            clearInterval(dailyPingTimer);
            dailyPingTimer = null;
        }
        telemetryStopPromise = Promise.allSettled([...inFlightTelemetry]).then(() => undefined);
        return telemetryStopPromise;
    },
};
//# sourceMappingURL=telemetry.js.map