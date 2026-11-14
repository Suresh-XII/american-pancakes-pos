"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundRoutes = void 0;
exports.withRefundPinLock = withRefundPinLock;
exports.resetRefundPinLocksForTests = resetRefundPinLocksForTests;
const crypto_1 = require("crypto");
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const role_permissions_1 = require("../../shared/role-permissions");
const orders_1 = require("./orders");
const refund_1 = require("../services/refund");
const countries_1 = require("../countries");
const cloud_sync_1 = require("../services/cloud-sync");
const kds_1 = require("../services/kds");
const operation_failure_1 = require("../lib/operation-failure");
const router = (0, express_1.Router)();
exports.refundRoutes = router;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_REASON_LENGTH = 500;
const refundPinLocks = new Map();
async function withRefundPinLock(key, fn) {
    const previous = refundPinLocks.get(key) || Promise.resolve();
    let resolveCurrent;
    const current = new Promise((resolve) => {
        resolveCurrent = resolve;
    });
    refundPinLocks.set(key, current);
    try {
        await previous.catch(() => { });
        return await fn();
    }
    finally {
        resolveCurrent();
        if (refundPinLocks.get(key) === current) {
            refundPinLocks.delete(key);
        }
    }
}
function resetRefundPinLocksForTests() {
    refundPinLocks.clear();
}
function refundIdempotencyKey(req) {
    const supplied = req.get('Idempotency-Key')?.trim();
    if (!supplied)
        return null;
    if (supplied.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(supplied)) {
        throw Object.assign(new Error('Idempotency-Key is invalid or too long'), {
            statusCode: 400,
            diagnosticCode: 'idempotency_key_invalid',
        });
    }
    return supplied;
}
function refundRequestHash(billId, body, approverId) {
    return (0, crypto_1.createHash)('sha256')
        .update(JSON.stringify({
        billId,
        order_item_id: body.order_item_id ?? null,
        amount: body.amount ?? null,
        method: body.method ?? null,
        reason: body.reason ?? null,
        shift_id: body.shift_id ?? null,
        approver_id: approverId,
    }))
        .digest('hex');
}
function refundAmountMinorUnits(value, currency) {
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw Object.assign(new Error('Refund amount must be a finite number greater than zero'), {
            statusCode: 400,
            diagnosticCode: 'amount_invalid',
        });
    }
    const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
    const factor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
    const text = String(value).trim();
    const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
    if (!pattern.test(text)) {
        const decDesc = decimals === 0 ? 'without decimals' : `with at most ${decimals} decimal places`;
        throw Object.assign(new Error(`Refund amount must be a finite number greater than zero ${decDesc}`), { statusCode: 400, diagnosticCode: 'amount_invalid' });
    }
    const parsed = Number(text);
    const minorUnits = Math.round(parsed * factor);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isSafeInteger(minorUnits)) {
        throw Object.assign(new Error('Refund amount must be a finite number greater than zero'), {
            statusCode: 400,
            diagnosticCode: 'amount_invalid',
        });
    }
    return minorUnits;
}
function structuredRefundFailure(req, error, capturePoint, displayCode, outcome = 'not_applied') {
    const header = req.get('x-operation-id');
    const correlationId = (0, operation_failure_1.isOperationReference)(header) ? header : (0, crypto_1.randomUUID)();
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: capturePoint,
        outcome,
        correlation_id: correlationId,
        ...(displayCode ? { facts: { display_code: displayCode } } : {}),
    });
    if (!failure)
        return { error };
    req.diagnosticsCaptured = true;
    try {
        cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        /* Diagnostics must not affect refunds. */
    }
    return {
        error,
        reason_code: failure.reason_code,
        operation: failure.operation,
        stage: failure.stage,
        classification: failure.classification,
        outcome: failure.outcome,
        correlation_id: failure.correlation_id,
        ...(failure.facts.display_code ? { display_code: failure.facts.display_code } : {}),
    };
}
router.post('/', (0, authorization_1.requirePermission)('refunds.initiate'), async (req, res) => {
    let operationCommitted = false;
    let transactionBodyCompleted = false;
    try {
        const body = req.body || {};
        const billId = body.bill_id;
        if (billId === undefined || billId === null || billId === '') {
            return res
                .status(400)
                .json(structuredRefundFailure(req, 'bill_id is required', 'fc.backend.payment.refund.validation', 'bill_id_required'));
        }
        const orderItemId = body.order_item_id !== undefined && body.order_item_id !== null
            ? Number(body.order_item_id)
            : null;
        if (orderItemId !== null && !Number.isSafeInteger(orderItemId)) {
            return res
                .status(400)
                .json(structuredRefundFailure(req, 'order_item_id must be an integer', 'fc.backend.payment.refund.validation', 'order_item_id_invalid'));
        }
        const db = (0, db_1.getDatabase)();
        const currency = (0, refund_1.getTenantCurrency)(db);
        let amountCents;
        if (body.amount !== undefined && body.amount !== null) {
            amountCents = refundAmountMinorUnits(body.amount, currency);
        }
        else if (orderItemId === null) {
            return res
                .status(400)
                .json(structuredRefundFailure(req, 'amount is required unless order_item_id is given', 'fc.backend.payment.refund.validation', 'amount_required'));
        }
        if (typeof body.reason === 'string' && body.reason.length > MAX_REASON_LENGTH) {
            return res
                .status(400)
                .json(structuredRefundFailure(req, 'reason is too long', 'fc.backend.payment.refund.validation', 'reason_too_long'));
        }
        const approverId = body.approver_id !== undefined && body.approver_id !== null
            ? String(body.approver_id).trim()
            : '';
        const managerId = body.manager_id !== undefined && body.manager_id !== null
            ? String(body.manager_id).trim()
            : '';
        if (!approverId && !managerId) {
            return res.status(400).json({
                ...structuredRefundFailure(req, 'approver_id is required', 'fc.backend.payment.refund.validation', 'approver_required'),
                code: 'APPROVER_REQUIRED',
            });
        }
        if (approverId && managerId && approverId !== managerId) {
            return res.status(400).json({
                ...structuredRefundFailure(req, 'approver_id and manager_id must identify the same approver', 'fc.backend.payment.refund.validation', 'approver_conflict'),
                code: 'APPROVER_CONFLICT',
            });
        }
        const selectedApproverId = approverId || managerId;
        const idempotencyKey = refundIdempotencyKey(req);
        const requestHash = idempotencyKey
            ? refundRequestHash(String(billId), body, selectedApproverId)
            : undefined;
        const userId = String(req.user.userId);
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        const checkIdempotencyReplay = () => {
            if (!idempotencyKey)
                return null;
            const prior = db
                .prepare(`
        SELECT bill_id, request_hash, response_json
        FROM refund_idempotency
        WHERE user_id = ? AND idempotency_key = ?
      `)
                .get(userId, idempotencyKey);
            if (!prior)
                return null;
            if (String(prior.bill_id) !== String(billId) || prior.request_hash !== requestHash) {
                throw Object.assign(new Error('Idempotency-Key was already used for a different refund request'), { statusCode: 409, diagnosticCode: 'idempotency_conflict' });
            }
            try {
                return JSON.parse(prior.response_json);
            }
            catch {
                throw Object.assign(new Error('Stored refund response is invalid'), {
                    statusCode: 500,
                });
            }
        };
        // 1. Check idempotency replay outside withTxn
        const initialReplay = checkIdempotencyReplay();
        if (initialReplay) {
            return res.status(201).json(initialReplay);
        }
        // 2. Pre-validate preconditions (business-day window, order item, amounts, session, etc.) before checking PIN
        const { lateRefund } = (0, refund_1.validateRefundPreconditions)(db, {
            billId,
            method: body.method,
            amountCents,
            orderItemId,
            createdByUserId: userId,
        });
        const overridePin = body.override_pin;
        // 3. Rate-limited async PIN verification outside withTxn
        const rateLimitKey = `pin:${clientIp}:refund`;
        let preVerifiedApprover = null;
        let idempotencyReplay = null;
        await withRefundPinLock(rateLimitKey, async () => {
            idempotencyReplay = checkIdempotencyReplay();
            if (idempotencyReplay) {
                return;
            }
            if (!overridePin) {
                throw Object.assign(new Error(lateRefund
                    ? 'Owner PIN required to process a refund on a completed order'
                    : 'Manager PIN required to process a refund'), { statusCode: 400, diagnosticCode: 'approver_pin_required' });
            }
            if ((0, orders_1.isPinRateLimited)(rateLimitKey)) {
                throw Object.assign(new Error('Too many PIN attempts. Try again in 15 minutes.'), {
                    statusCode: 429,
                    diagnosticCode: 'pin_rate_limited',
                });
            }
            const allowedRoles = lateRefund ? role_permissions_1.ROLE_ACCESS.owner : role_permissions_1.ROLE_ACCESS.ownerManager;
            const placeholders = allowedRoles.map(() => '?').join(', ');
            const candidate = db
                .prepare(`SELECT id, pin_hash, role, is_active FROM users WHERE id = ? AND pin_hash IS NOT NULL AND role IN (${placeholders}) AND is_active = 1`)
                .get(selectedApproverId, ...allowedRoles);
            let pinMatches = false;
            if (candidate) {
                pinMatches = await (0, db_1.verifyPinAsync)(candidate.pin_hash, overridePin);
            }
            if (!candidate || !pinMatches) {
                idempotencyReplay = checkIdempotencyReplay();
                if (idempotencyReplay) {
                    return;
                }
                (0, orders_1.checkPinRateLimit)(rateLimitKey);
                throw Object.assign(new Error(lateRefund ? 'Invalid owner PIN' : 'Invalid manager PIN'), {
                    statusCode: 403,
                    diagnosticCode: 'approver_pin_invalid',
                });
            }
            preVerifiedApprover = {
                id: candidate.id,
                verifiedPinHash: candidate.pin_hash,
                lateRefund,
            };
        });
        if (idempotencyReplay) {
            return res.status(201).json(idempotencyReplay);
        }
        const refundRequest = {
            billId,
            orderItemId,
            amountCents,
            method: body.method,
            reason: body.reason ?? null,
            shiftId: body.shift_id ?? null,
            overridePin: body.override_pin,
            approverId: selectedApproverId,
            createdByUserId: userId,
            clientIp,
            checkPinRateLimit: orders_1.checkPinRateLimit,
            isPinRateLimited: orders_1.isPinRateLimited,
            clearPinRateLimit: orders_1.clearPinRateLimit,
            idempotencyKey,
            requestHash,
            preVerifiedApprover,
        };
        let changedOrderEvent = null;
        const result = (0, db_1.withTxn)(() => {
            const wasReplay = Boolean(checkIdempotencyReplay());
            let beforeOrderStatus = null;
            if (!wasReplay && orderItemId !== null) {
                const beforeRow = db
                    .prepare('SELECT o.status FROM orders o JOIN bills b ON b.order_id = o.id WHERE b.id = ?')
                    .get(billId);
                beforeOrderStatus = beforeRow?.status ?? null;
            }
            const refundResult = (0, refund_1.createRefund)(db, refundRequest);
            if (!wasReplay && orderItemId !== null && refundResult.bill?.order_id != null) {
                const orderId = String(refundResult.bill.order_id);
                const afterRow = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
                const afterOrderStatus = afterRow?.status ?? null;
                const eventType = afterOrderStatus && afterOrderStatus !== beforeOrderStatus
                    ? `order.${afterOrderStatus}`
                    : 'order.item_refunded';
                changedOrderEvent = { orderId, eventType };
            }
            transactionBodyCompleted = true;
            return refundResult;
        });
        (0, orders_1.clearPinRateLimit)(rateLimitKey);
        operationCommitted = true;
        if (changedOrderEvent) {
            const { orderId, eventType } = changedOrderEvent;
            try {
                cloud_sync_1.cloudSync.recordOrderChanged(orderId, eventType);
            }
            catch { }
            (0, kds_1.notifyKdsUpdate)();
        }
        res.status(201).json(result);
    }
    catch (error) {
        const status = error.statusCode || 500;
        const outcome = operationCommitted
            ? 'applied'
            : transactionBodyCompleted
                ? 'unknown'
                : 'not_applied';
        const capturePoint = operationCommitted
            ? 'fc.backend.payment.refund.completion'
            : status >= 500
                ? 'fc.backend.payment.refund.persistence'
                : 'fc.backend.payment.refund.validation';
        const displayCode = status < 500 ? error.diagnosticCode : undefined;
        const payload = status >= 500 || displayCode
            ? structuredRefundFailure(req, error.message || 'Unable to process refund', capturePoint, displayCode, outcome)
            : { error: error.message || 'Unable to process refund' };
        res.status(status).json(payload);
    }
});
router.get('/', (0, authorization_1.requirePermission)('refunds.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let query = 'SELECT * FROM refunds WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as count FROM refunds WHERE 1=1';
        const params = [];
        if (req.query.bill_id) {
            query += ' AND bill_id = ?';
            countQuery += ' AND bill_id = ?';
            params.push(req.query.bill_id);
        }
        const requestedLimit = req.query.limit !== undefined ? Number(req.query.limit) : 50;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            return res.status(400).json({ error: 'limit must be a positive integer' });
        }
        const limit = Math.min(requestedLimit, 500);
        const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
        if (!Number.isInteger(offset) || offset < 0) {
            return res.status(400).json({ error: 'offset must be a non-negative integer' });
        }
        query += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
        const pageParams = [...params, limit, offset];
        const refunds = db.prepare(query).all(...pageParams);
        const total = Number(db.prepare(countQuery).get(...params)?.count || 0);
        res.json({
            refunds,
            pagination: {
                limit,
                per_page: limit,
                offset,
                total,
                next_offset: offset + refunds.length < total ? offset + refunds.length : null,
                has_more: offset + refunds.length < total,
            },
        });
    }
    catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Unable to list refunds' });
    }
});
//# sourceMappingURL=refunds.js.map