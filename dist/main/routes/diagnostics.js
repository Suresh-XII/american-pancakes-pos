"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.diagnosticsRoutes = void 0;
exports.buildDiagnosticEvent = buildDiagnosticEvent;
const express_1 = require("express");
const crypto_1 = require("crypto");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const authorization_1 = require("../services/authorization");
const security_1 = require("../middleware/security");
const cloud_sync_1 = require("../services/cloud-sync");
const operation_failure_1 = require("../lib/operation-failure");
const support_ticket_1 = require("./support-ticket");
const router = (0, express_1.Router)();
const diagnosticsWriteRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => (0, security_1.isAllowedPrivateIp)(req.ip || req.socket.remoteAddress || ''),
});
const EVENT_CODE_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ALLOWED_SEVERITIES = new Set(['debug', 'info', 'warn', 'error', 'critical']);
const MAX_EVENT_CODE_CHARS = 64;
const MAX_SEVERITY_CHARS = 8;
const MAX_MESSAGE_CHARS = 300;
const MAX_CORRELATION_ID_CHARS = 64;
const MAX_METADATA_JSON_BYTES = 4096;
const MAX_METADATA_DEPTH = 3;
const MAX_METADATA_ENTRIES = 40;
const MAX_METADATA_STRING_CHARS = 300;
const FRONTEND_CAPTURE_POINTS = new Set([
    'fc.frontend.pos.order.create.transport',
    'fc.frontend.pos.order.create.recovery',
    'fc.frontend.pos.payment.create.transport',
    'fc.frontend.pos.payment.create.recovery',
    'fc.frontend.pos.order.create.retry_storage',
    'fc.frontend.pos.order.create.retry_cleanup',
    'fc.client.order.create.retry_state_update',
    'fc.client.payment.create.retry_state_update',
    'fc.client.bill.generate.retry_state_update',
    'fc.frontend.pos.payment.create.retry_storage',
    'fc.frontend.pos.payment.create.retry_cleanup',
    'fc.frontend.pos.order.create.held_cleanup',
    'fc.frontend.pos.payment.create.held_cleanup',
    'fc.frontend.pos.order.append.transport',
    'fc.frontend.pos.order.append.recovery',
    'fc.frontend.pos.order.append.retry_storage',
    'fc.frontend.pos.order.append.retry_cleanup',
]);
const MAX_CAPTURE_POINT_CHARS = Math.max(...Array.from(FRONTEND_CAPTURE_POINTS, (point) => point.length));
const MAX_CAPTURE_FIELD_NAME_CHARS = 'capture_point'.length;
const MAX_CAPTURE_OUTCOME_CHARS = 16;
const MAX_CAPTURE_FACTS = 1;
const MAX_CAPTURE_FACT_KEY_CHARS = 'failure_class'.length;
const MAX_CAPTURE_FACT_VALUE_CHARS = 64;
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Depth-clamps, key-limits, and string-trims client metadata without PII-shaped passthrough. */
function sanitizeDiagnosticMetadata(value, depth, budget) {
    if (depth > MAX_METADATA_DEPTH)
        return undefined;
    if (typeof value === 'string')
        return value.slice(0, MAX_METADATA_STRING_CHARS);
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value)) {
        const out = [];
        for (let index = 0; index < value.length && budget.remaining > 0; index += 1) {
            budget.remaining -= 1;
            const child = sanitizeDiagnosticMetadata(value[index], depth + 1, budget);
            if (child !== undefined)
                out.push(child);
        }
        return out;
    }
    const objectValue = value;
    const out = {};
    for (const key in objectValue) {
        if (!Object.prototype.hasOwnProperty.call(objectValue, key))
            continue;
        if (budget.remaining <= 0)
            break;
        budget.remaining -= 1;
        // Assignment would trigger the Object.prototype __proto__ setter and swap
        // the result's prototype instead of defining an own property.
        if (key === '__proto__')
            continue;
        const child = sanitizeDiagnosticMetadata(objectValue[key], depth + 1, budget);
        if (child !== undefined) {
            out[key.slice(0, 100)] = child;
        }
    }
    return out;
}
/** Validates and normalizes a client-submitted diagnostic event; null when the payload is unacceptable. */
function buildDiagnosticEvent(body) {
    const raw = body && typeof body === 'object' && !Array.isArray(body)
        ? body
        : {};
    const eventCode = typeof raw.event_code === 'string' && raw.event_code.length <= MAX_EVENT_CODE_CHARS
        ? raw.event_code.trim()
        : '';
    if (!EVENT_CODE_RE.test(eventCode) || !(0, cloud_sync_1.isAllowedDiagnosticEventCode)(eventCode))
        return null;
    const severity = typeof raw.severity === 'string' && raw.severity.length <= MAX_SEVERITY_CHARS
        ? raw.severity
        : '';
    if (!ALLOWED_SEVERITIES.has(severity))
        return null;
    if (raw.metadata !== undefined && raw.metadata !== null && !isPlainObject(raw.metadata))
        return null;
    const metadata = isPlainObject(raw.metadata)
        ? sanitizeDiagnosticMetadata(raw.metadata, 0, { remaining: MAX_METADATA_ENTRIES })
        : undefined;
    if (metadata !== undefined && JSON.stringify(metadata).length > MAX_METADATA_JSON_BYTES)
        return null;
    const correlationId = typeof raw.correlation_id === 'string'
        ? raw.correlation_id
            .slice(0, MAX_CORRELATION_ID_CHARS)
            .trim()
            .slice(0, MAX_CORRELATION_ID_CHARS)
        : undefined;
    const message = typeof raw.message === 'string'
        ? raw.message.slice(0, MAX_MESSAGE_CHARS).trim().slice(0, MAX_MESSAGE_CHARS)
        : undefined;
    return {
        event_id: (0, crypto_1.randomUUID)(),
        event_code: eventCode,
        severity: severity,
        correlation_id: correlationId || undefined,
        message: message || undefined,
        metadata,
        occurred_at: new Date().toISOString(),
    };
}
router.post('/event', (0, authorization_1.requirePermission)('support.use'), diagnosticsWriteRateLimit, (req, res) => {
    const event = buildDiagnosticEvent(req.body);
    if (!event)
        return res.status(400).json({ error: 'Invalid diagnostic event' });
    try {
        // Consent-gated, fire-and-forget: a rejected enqueue must never fail the request.
        cloud_sync_1.cloudSync.reportDiagnostic(event);
    }
    catch {
        /* diagnostics must never mask the original failure */
    }
    res.status(202).json({ queued: true });
});
// Cashier transport/recovery events are client-owned. Backend write failures are
// captured at their authoritative boundary and must not be reported here again.
router.post('/capture', diagnosticsWriteRateLimit, (req, res) => {
    const raw = isPlainObject(req.body) ? req.body : {};
    const capturePoint = raw.capture_point;
    const hasFacts = Object.hasOwn(raw, 'facts');
    let fieldCount = 0;
    for (const key in raw) {
        if (!Object.prototype.hasOwnProperty.call(raw, key))
            continue;
        if (key.length > MAX_CAPTURE_FIELD_NAME_CHARS ||
            (key !== 'capture_point' && key !== 'facts' && key !== 'operation_id' && key !== 'outcome')) {
            return res.status(400).json({ error: 'Invalid diagnostic capture' });
        }
        fieldCount += 1;
        if (fieldCount > 4)
            return res.status(400).json({ error: 'Invalid diagnostic capture' });
    }
    if (fieldCount !== (hasFacts ? 4 : 3) ||
        typeof capturePoint !== 'string' ||
        capturePoint.length > MAX_CAPTURE_POINT_CHARS ||
        !FRONTEND_CAPTURE_POINTS.has(capturePoint) ||
        typeof raw.outcome !== 'string' ||
        raw.outcome.length > MAX_CAPTURE_OUTCOME_CHARS ||
        typeof raw.operation_id !== 'string' ||
        raw.operation_id.length !== 36 ||
        !(0, operation_failure_1.isOperationReference)(raw.operation_id)) {
        return res.status(400).json({ error: 'Invalid diagnostic capture' });
    }
    if (hasFacts) {
        if (!isPlainObject(raw.facts))
            return res.status(400).json({ error: 'Invalid diagnostic capture' });
        let factCount = 0;
        for (const key in raw.facts) {
            if (!Object.prototype.hasOwnProperty.call(raw.facts, key))
                continue;
            factCount += 1;
            if (factCount > MAX_CAPTURE_FACTS || key.length > MAX_CAPTURE_FACT_KEY_CHARS)
                return res.status(400).json({ error: 'Invalid diagnostic capture' });
            const value = raw.facts[key];
            if (typeof value === 'string' && value.length > MAX_CAPTURE_FACT_VALUE_CHARS)
                return res.status(400).json({ error: 'Invalid diagnostic capture' });
        }
    }
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: capturePoint,
        outcome: raw.outcome,
        correlation_id: raw.operation_id,
        ...(hasFacts ? { facts: raw.facts } : {}),
    });
    if (!failure)
        return res.status(400).json({ error: 'Invalid diagnostic capture' });
    cloud_sync_1.cloudSync.captureOperationFailure({
        capture_point: failure.capture_point,
        outcome: failure.outcome,
        correlation_id: failure.correlation_id,
        facts: failure.facts,
    });
    return res.status(202).json({
        captured: true,
        reason_code: failure.reason_code,
        operation: failure.operation,
        stage: failure.stage,
        classification: failure.classification,
        outcome: failure.outcome,
        correlation_id: failure.correlation_id,
    });
});
router.get('/health', (0, authorization_1.requirePermission)('support.use'), (_req, res) => {
    res.json(cloud_sync_1.cloudSync.listDiagnosticDeliveryHealth());
});
// Local read for the diagnostics screen; nothing here is transmitted.
router.get('/recent', (0, authorization_1.requirePermission)('support.use'), (req, res) => {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, cloud_sync_1.DIAGNOSTIC_LOG_MAX_ROWS)
        : 50;
    res.json({ failures: cloud_sync_1.cloudSync.listLocalDiagnostics(limit) });
});
// Erasing the evidence is destructive, so it takes the same permission as
// changing the transmission setting rather than the read path's support.use.
router.delete('/recent', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    res.json({ removed: cloud_sync_1.cloudSync.clearLocalDiagnostics() });
});
// The raw log tail is deliberately absent: it can carry order and customer
// detail, so the operator adds it on the screen after seeing what it is.
router.get('/support-bundle', (0, authorization_1.requirePermission)('support.use'), (req, res) => {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, cloud_sync_1.DIAGNOSTIC_LOG_MAX_ROWS)
        : 50;
    const failures = cloud_sync_1.cloudSync.listLocalDiagnostics(limit);
    res.json({
        bundle: {
            system: (0, support_ticket_1.buildSystemDiagnostics)(req, (0, support_ticket_1.resolveCategory)(req.query.category)),
            recent_failures: failures.map((failure) => ({
                occurred_at: failure.occurred_at,
                event_code: failure.event_code,
                severity: failure.severity,
                signature: failure.signature,
                summary: failure.summary,
                ...(failure.metadata ? { metadata: failure.metadata } : {}),
            })),
        },
    });
});
exports.diagnosticsRoutes = router;
//# sourceMappingURL=diagnostics.js.map