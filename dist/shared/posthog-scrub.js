"use strict";
/**
 * Allowlist for everything FloCafe sends to PostHog. Usage follows the sharing level, the email
 * only the `full` level, and exceptions follow diagnostics transmission.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.POSTHOG_STAFF_KEYS = exports.POSTHOG_SUPER_KEYS = exports.POSTHOG_PERSON_KEYS = exports.POSTHOG_USAGE_PROPERTY_KEYS = exports.POSTHOG_USAGE_EVENTS = exports.POSTHOG_CAPTURE_POINTS = void 0;
exports.isPostHogCapturePoint = isPostHogCapturePoint;
exports.sanitizeErrorName = sanitizeErrorName;
exports.redactExceptionMessage = redactExceptionMessage;
exports.projectRelativeFile = projectRelativeFile;
exports.stackFrameLines = stackFrameLines;
exports.scrubPathname = scrubPathname;
exports.scrubPostHogEvent = scrubPostHogEvent;
exports.POSTHOG_CAPTURE_POINTS = [
    'uncaughtException',
    'unhandledRejection',
    'renderer-autocapture',
    'react-error-boundary',
    'api-5xx',
];
exports.POSTHOG_USAGE_EVENTS = [
    'app_launch',
    'daily_ping',
    'feature_used',
    'setup_completed',
    'first_order_created',
    'first_bill_paid',
];
/** Every property a usage event may carry. Anything else is dropped. */
exports.POSTHOG_USAGE_PROPERTY_KEYS = [
    'feature',
    'action',
    'check_count',
    'setup_profile',
    'service_model',
    'business_type',
    'hours_since_setup',
    'backfilled',
    'country',
    'currency',
    'language',
    'kds_enabled',
    'orders_24h',
    'orders_dine_in_24h',
    'orders_takeaway_24h',
    'orders_delivery_24h',
    'orders_online_24h',
    'orders_cancelled_24h',
    'bills_paid_24h',
    'staff_with_orders_24h',
    'active_staff_count',
    'products_count',
    'tables_count',
    'customers_count',
    'printers_count',
    'kitchen_stations_count',
];
/** Store configuration kept on the person. None of it identifies a customer or an order. */
exports.POSTHOG_PERSON_KEYS = [
    'email',
    'country',
    'currency',
    'language',
    'service_model',
    'kds_enabled',
    'app_version',
    'platform',
    'run_mode',
    'install_source',
    'store_ref',
    'environment',
    'release_channel',
];
/** Sent with every event so error tracking and insights can filter by release and channel. */
exports.POSTHOG_SUPER_KEYS = [
    'app_version',
    'platform',
    'run_mode',
    'install_source',
    'store_ref',
    'environment',
    'release_channel',
    'install_ref',
];
/**
 * Who used the app, without saying who: the staff role and a per-installation hash of the
 * user id. One installation stays one person; staff are an event dimension, not persons.
 */
exports.POSTHOG_STAFF_KEYS = ['staff_role', 'staff_ref'];
/** Screen-level pageview fields: the route, the settings tab, and views folded into this one. */
const PAGEVIEW_KEYS = new Set(['screen', 'settings_tab', 'repeat_views']);
const CAPTURE_POINT_SET = new Set(exports.POSTHOG_CAPTURE_POINTS);
const USAGE_EVENT_SET = new Set(exports.POSTHOG_USAGE_EVENTS);
const PERSON_KEY_SET = new Set(exports.POSTHOG_PERSON_KEYS);
const USAGE_PROPERTY_KEY_SET = new Set(exports.POSTHOG_USAGE_PROPERTY_KEYS);
const ACCOUNT_KEYS = ['email', 'store_ref'];
const CONTEXT_KEYS = new Set([
    ...exports.POSTHOG_SUPER_KEYS,
    ...exports.POSTHOG_STAFF_KEYS,
    'token',
    'distinct_id',
    '$lib',
    '$lib_version',
    '$os',
    '$os_version',
    '$browser',
    '$browser_version',
    '$device_type',
    '$screen_height',
    '$screen_width',
    '$viewport_height',
    '$viewport_width',
    '$timezone',
    '$session_id',
    '$window_id',
    '$pageview_id',
    '$insert_id',
    '$geoip_disable',
    '$process_person_profile',
]);
const API_FAILURE_KEYS = new Set(['http_method', 'http_route', 'http_status']);
const PROJECT_MARKERS = [
    'frontend/src/',
    'frontend/',
    'dist/main/',
    'dist/',
    'main/',
    'shared/',
    'tests/',
];
const ERROR_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/;
const IDENTIFIER = /^[A-Za-z_$<][\w$.<>]{0,99}$/;
const CHUNK_ID = /^[\w-]{1,100}$/;
const OPAQUE_REF = /^[0-9a-f]{16}$/;
const OPAQUE_REF_KEYS = new Set(['store_ref', 'staff_ref', 'install_ref']);
/** The only distinct ids FloCafe creates: account, device, and per-launch. */
const FLO_DISTINCT_ID = /^(?:acct_[0-9a-f]{16}|inst_[0-9a-f]{16}|anon_[0-9a-f-]{36})$/;
const ACCOUNT_DISTINCT_ID = /^acct_/;
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;
const MAX_FRAMES = 50;
const MAX_MESSAGE = 300;
function isPostHogCapturePoint(value) {
    return typeof value === 'string' && CAPTURE_POINT_SET.has(value);
}
function sanitizeErrorName(name, stack) {
    if (typeof name === 'string' && ERROR_NAME.test(name))
        return name;
    if (typeof stack === 'string') {
        const first = stack.split('\n', 1)[0] ?? '';
        const token = first.split(':', 1)[0]?.trim() ?? '';
        if (ERROR_NAME.test(token))
            return token;
    }
    return 'Error';
}
/**
 * Removes emails, URLs, digit runs and quoted text from an error message. Identifier-like
 * quotes in engine messages, such as "(reading 'name')", are kept.
 */
function redactExceptionMessage(message) {
    if (typeof message !== 'string')
        return '';
    let text = message.split('\n', 1)[0] ?? '';
    text = text.replace(EMAIL, '<email>');
    text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>');
    text = text.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, '"<redacted>"');
    text = text.replace(/'([^']*)'/g, (match, inner) => /^[A-Za-z_$][\w$.]{0,60}$/.test(inner) ? match : "'<redacted>'");
    text = text.replace(/\+?\d[\d\s().-]{1,}\d/g, (match) => match.replace(/\D/g, '').length >= 3 ? '<n>' : match);
    text = text.trim();
    return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}
/** Project-relative path, or null when the frame is outside this repo. */
function projectRelativeFile(raw) {
    let file = raw.trim();
    if (!file || file.startsWith('node:') || file === 'native' || file.includes('<anonymous>')) {
        return null;
    }
    if (file.includes('node_modules') || file.includes('electron/js2c'))
        return null;
    const served = /^https?:\/\/[^/]+\/(_next\/[^?#]+)/.exec(file);
    if (served)
        return safeRelative(served[1]);
    const webpack = /^(?:rsc:\/\/React\/[^/]+\/)?webpack-internal:\/\/\/(?:\([\w-]+\)\/)?\.\/(.+)$/.exec(file);
    if (webpack) {
        const rel = webpack[1].replace(/\\/g, '/').split('?')[0].split('#')[0];
        if (rel.startsWith('src/'))
            return safeRelative(`frontend/${rel}`);
        if (rel.startsWith('frontend/'))
            return safeRelative(rel);
        return null;
    }
    file = file.replace(/^file:\/\//, '').replace(/\\/g, '/');
    const asar = file.lastIndexOf('app.asar/');
    if (asar !== -1)
        file = file.slice(asar + 'app.asar/'.length);
    let chosen = null;
    for (const marker of PROJECT_MARKERS) {
        const at = file.lastIndexOf(`/${marker}`);
        if (at < 0)
            continue;
        const start = at + 1;
        if (!chosen ||
            start > chosen.at ||
            (start === chosen.at && marker.length > chosen.marker.length)) {
            chosen = { at: start, marker };
        }
    }
    if (!chosen) {
        if (PROJECT_MARKERS.some((marker) => file.startsWith(marker)))
            return safeRelative(file);
        return null;
    }
    return safeRelative(file.slice(chosen.at).split('?')[0].split('#')[0]);
}
function safeRelative(file) {
    if (!file || file.includes('..') || file.startsWith('/') || /^[A-Za-z]:/.test(file))
        return null;
    if (!/^[\w./()[\]@+~-]+$/.test(file))
        return null;
    return file;
}
/** Keeps only the stack lines of an error, so the message never rides along in the stack. */
function stackFrameLines(stack) {
    if (typeof stack !== 'string')
        return [];
    return stack
        .split('\n')
        .filter((line) => line.trim().startsWith('at '))
        .slice(0, MAX_FRAMES);
}
function positiveInteger(value) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(number) && number > 0 && number <= 10_000_000 ? number : null;
}
function scrubFrame(frame) {
    if (!frame || typeof frame !== 'object')
        return null;
    const item = frame;
    const filename = typeof item.filename === 'string' ? projectRelativeFile(item.filename) : null;
    const lineno = positiveInteger(item.lineno);
    if (!filename || lineno === null)
        return null;
    const next = { filename, lineno };
    const colno = positiveInteger(item.colno);
    if (colno !== null)
        next.colno = colno;
    if (typeof item.function === 'string' && IDENTIFIER.test(item.function)) {
        next.function = item.function;
    }
    if (typeof item.in_app === 'boolean')
        next.in_app = item.in_app;
    if (typeof item.platform === 'string' && /^[\w:]{1,40}$/.test(item.platform)) {
        next.platform = item.platform;
    }
    if (typeof item.chunk_id === 'string' && CHUNK_ID.test(item.chunk_id)) {
        next.chunk_id = item.chunk_id;
    }
    return next;
}
function scrubMechanism(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const record = value;
    const next = {};
    if (typeof record.handled === 'boolean')
        next.handled = record.handled;
    if (typeof record.synthetic === 'boolean')
        next.synthetic = record.synthetic;
    if (typeof record.type === 'string' && /^[\w-]{1,40}$/.test(record.type))
        next.type = record.type;
    return Object.keys(next).length > 0 ? next : undefined;
}
function scrubExceptionList(value) {
    const entries = Array.isArray(value) && value.length > 0 ? value.slice(0, 5) : [{}];
    return entries.map((entry) => {
        const record = entry && typeof entry === 'object' ? entry : {};
        const stacktrace = record.stacktrace && typeof record.stacktrace === 'object'
            ? record.stacktrace
            : {};
        const rawFrames = Array.isArray(stacktrace.frames) ? stacktrace.frames : [];
        const frames = rawFrames
            .map(scrubFrame)
            .filter((frame) => frame !== null)
            .slice(-MAX_FRAMES);
        const next = {
            type: sanitizeErrorName(record.type),
            stacktrace: { type: 'raw', frames },
        };
        const message = redactExceptionMessage(record.value);
        if (message)
            next.value = message;
        const mechanism = scrubMechanism(record.mechanism);
        if (mechanism)
            next.mechanism = mechanism;
        return next;
    });
}
function emailField(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 320 || /[\s\r\n]/.test(trimmed) || !trimmed.includes('@')) {
        return undefined;
    }
    return trimmed;
}
function opaqueRef(value) {
    return typeof value === 'string' && OPAQUE_REF.test(value) ? value : undefined;
}
function plainValue(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 80 || trimmed.includes('@') || /\d{6,}/.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}
function personProperties(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const record = value;
    const next = {};
    for (const key of PERSON_KEY_SET) {
        const field = key === 'email'
            ? emailField(record[key])
            : OPAQUE_REF_KEYS.has(key)
                ? opaqueRef(record[key])
                : plainValue(record[key]);
        if (field !== undefined)
            next[key] = field;
    }
    return Object.keys(next).length > 0 ? next : undefined;
}
function contextProperties(source) {
    const next = {};
    for (const key of CONTEXT_KEYS) {
        const value = source[key];
        if (OPAQUE_REF_KEYS.has(key)) {
            if (typeof value === 'string' && OPAQUE_REF.test(value))
                next[key] = value;
        }
        else if (key === 'distinct_id' || key === 'token' || key.startsWith('$')) {
            if (typeof value === 'string' && value.length > 0 && value.length <= 200)
                next[key] = value;
            else if (typeof value === 'number' || typeof value === 'boolean')
                next[key] = value;
        }
        else {
            const plain = plainValue(value);
            if (plain !== undefined)
                next[key] = plain;
        }
    }
    return next;
}
/** Route path with query, hash, and id-like segments removed. */
function scrubPathname(value) {
    if (typeof value !== 'string')
        return null;
    let path = value.trim();
    const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(path);
    if (absolute)
        path = absolute[1] ?? '/';
    path = path.split('?')[0].split('#')[0];
    if (!path.startsWith('/'))
        return null;
    const segments = path
        .split('/')
        .map((segment) => (/\d{3,}|^[0-9a-f-]{16,}$|@/i.test(segment) ? ':id' : segment));
    const scrubbed = segments.join('/');
    return /^[\w/().:~-]{1,200}$/.test(scrubbed) ? scrubbed : null;
}
function withoutPersonOperators(event) {
    const rest = { ...event };
    delete rest.$set;
    delete rest.$set_once;
    delete rest.$unset;
    return rest;
}
function withoutAccountKeys(properties) {
    if (!properties)
        return;
    for (const key of ACCOUNT_KEYS)
        delete properties[key];
    if (properties.$set && typeof properties.$set === 'object') {
        for (const key of ACCOUNT_KEYS)
            delete properties.$set[key];
    }
}
function sentByAccount(event) {
    return [event.distinctId, event.distinct_id, event.properties?.distinct_id].some((id) => typeof id === 'string' && ACCOUNT_DISTINCT_ID.test(id));
}
function scrubIdentify(event, telemetryEnabled) {
    const source = event.properties ?? {};
    const properties = {};
    for (const key of ['distinct_id', 'token']) {
        if (typeof source[key] === 'string' && source[key])
            properties[key] = source[key];
    }
    if (source.$geoip_disable === true)
        properties.$geoip_disable = true;
    if (telemetryEnabled) {
        const set = {
            ...(personProperties(source.$set) ?? {}),
            ...(personProperties(event.$set) ?? {}),
        };
        if (Object.keys(set).length > 0)
            properties.$set = set;
    }
    return { ...withoutPersonOperators(event), properties };
}
function scrubUsage(event) {
    const source = event.properties ?? {};
    const properties = contextProperties(source);
    for (const key of USAGE_PROPERTY_KEY_SET) {
        if (key in properties)
            continue;
        const plain = plainValue(source[key]);
        if (plain !== undefined)
            properties[key] = plain;
    }
    return { ...withoutPersonOperators(event), properties };
}
function scrubPageview(event) {
    const source = event.properties ?? {};
    const pathname = scrubPathname(source.$pathname ?? source.$current_url);
    if (!pathname)
        return null;
    const properties = contextProperties(source);
    properties.$pathname = pathname;
    properties.$current_url = pathname;
    for (const key of PAGEVIEW_KEYS) {
        const plain = key === 'screen' ? scrubPathname(source[key]) : plainValue(source[key]);
        if (plain !== undefined && plain !== null)
            properties[key] = plain;
    }
    return { ...withoutPersonOperators(event), properties };
}
function scrubException(event, defaultCapturePoint) {
    const source = event.properties ?? {};
    const capturePoint = source.capture_point ?? defaultCapturePoint;
    if (!isPostHogCapturePoint(capturePoint))
        return null;
    const list = scrubExceptionList(source.$exception_list);
    const properties = {
        ...contextProperties(source),
        capture_point: capturePoint,
        $exception_list: list,
    };
    const first = list[0];
    if (typeof first?.type === 'string')
        properties.$exception_type = first.type;
    if (typeof first?.value === 'string')
        properties.$exception_message = first.value;
    if (typeof source.$exception_level === 'string' &&
        /^[a-z]{1,10}$/.test(source.$exception_level)) {
        properties.$exception_level = source.$exception_level;
    }
    if (capturePoint === 'api-5xx') {
        for (const key of API_FAILURE_KEYS) {
            const plain = plainValue(source[key]);
            if (plain !== undefined)
                properties[key] = plain;
        }
    }
    return { ...withoutPersonOperators(event), properties };
}
/**
 * Returns the event as it may leave the machine, or null when it must not.
 * `defaultCapturePoint` tags exceptions an SDK captured on its own (renderer autocapture).
 */
function scrubPostHogEvent(event, options) {
    if (!event || typeof event.event !== 'string')
        return null;
    const named = event;
    if (options.accountLinked)
        return scrubAllowed(named, options);
    if (named.event === '$create_alias' || sentByAccount(named))
        return null;
    const scrubbed = scrubAllowed(named, options);
    withoutAccountKeys(scrubbed?.properties);
    return scrubbed;
}
function scrubAllowed(event, options) {
    if (event.event === '$create_alias') {
        if (!options.telemetryEnabled)
            return null;
        const source = event.properties ?? {};
        if (!FLO_DISTINCT_ID.test(String(source.distinct_id)) ||
            !FLO_DISTINCT_ID.test(String(source.alias))) {
            return null;
        }
        const properties = {
            distinct_id: source.distinct_id,
            alias: source.alias,
        };
        if (typeof source.token === 'string')
            properties.token = source.token;
        return { ...withoutPersonOperators(event), properties };
    }
    if (event.event === '$identify' || event.event === '$set') {
        return scrubIdentify(event, options.telemetryEnabled);
    }
    if (event.event === '$exception') {
        if (!options.allowExceptions)
            return null;
        const scrubbed = scrubException(event, options.defaultCapturePoint);
        // With telemetry off nothing may link an exception to the device, the store, or a staff member.
        if (scrubbed && !options.telemetryEnabled) {
            for (const key of ['install_ref', 'store_ref', 'staff_ref'])
                delete scrubbed.properties?.[key];
        }
        return scrubbed;
    }
    if (!options.telemetryEnabled)
        return null;
    if (event.event === '$pageview')
        return scrubPageview(event);
    if (USAGE_EVENT_SET.has(event.event))
        return scrubUsage(event);
    return null;
}
//# sourceMappingURL=posthog-scrub.js.map