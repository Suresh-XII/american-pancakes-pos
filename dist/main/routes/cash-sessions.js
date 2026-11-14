"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cashSessionRoutes = void 0;
/**
 * Cash sessions / shift lifecycle (issue #279, approach A).
 *
 * Open state lives in `cash_sessions`; closes persist as `cash_closures`
 * rows with scope='session' (the extension door documented in
 * main/routes/cash-closures.ts). Day close is untouched.
 *
 * Session expected cash prefers explicit cash_session_id ownership, with
 * timestamp windows only for legacy rows, so sessions crossing midnight work.
 * The opening float lives on the session
 * row and is mirrored as the day's opening_float movement (once per day, or
 * summed across per-staff shifts on that day)
 * so day close reconciles the same drawer; session math excludes in-window
 * float movements and cannot double-count.
 */
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const cash_drawer_movements_1 = require("../services/cash-drawer-movements");
const cash_day_close_guards_1 = require("../services/cash-day-close-guards");
const shift_session_gate_1 = require("../services/shift-session-gate");
const cash_closures_1 = require("./cash-closures");
const router = (0, express_1.Router)();
function httpError(message, statusCode, diagnosticCode) {
    return Object.assign(new Error(message), {
        statusCode,
        ...(diagnosticCode ? { diagnosticCode } : {}),
    });
}
function errorStatus(error) {
    if (typeof error !== 'object' || error === null || !('statusCode' in error))
        return 500;
    return typeof error.statusCode === 'number' ? error.statusCode || 500 : 500;
}
function errorMessage(error, fallback) {
    if (error instanceof Error)
        return error.message || fallback;
    if (typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string')
        return error.message || fallback;
    return fallback;
}
function validateCents(raw, field, diagnosticCode) {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        throw httpError(`${field} must be an integer number of cents >= 0`, 400, diagnosticCode);
    }
    return raw;
}
function actorId(req) {
    const id = String(req.user?.userId || '');
    if (!id)
        throw httpError('Authentication required', 401);
    return id;
}
function actorRole(req) {
    return String(req.user?.role || '');
}
function daysAgoUtc(days) {
    return new Date(Date.now() - days * 86400_000)
        .toISOString()
        .replace('T', ' ')
        .replace(/\..*$/, '');
}
/**
 * Shared close transaction used by the close endpoint and by stale
 * auto-close on open. Computes window aggregates, writes the
 * scope='session' closure row, and marks the session closed.
 * Open/unpaid orders stay open and carry over to the next shift while
 * expected cash reconciles only the cash lines collected during the shift.
 */
function closeSessionTxn(db, session, countedCashCents, closerId, notes) {
    const closedAt = (0, db_1.now)();
    const aggregates = (0, cash_closures_1.computeSessionAggregates)(db, session, closedAt);
    const expectedCashCents = (0, cash_closures_1.sessionExpectedCash)(db, session, closedAt, aggregates.cashMovements);
    const varianceCents = countedCashCents - expectedCashCents;
    let zNumber;
    try {
        zNumber = (0, db_1.nextZNumber)();
    }
    catch (err) {
        throw httpError(`Could not allocate Z number: ${errorMessage(err, 'sequence failure')}`, 500);
    }
    const businessDate = (0, cash_day_close_guards_1.sessionBusinessDate)(db, session);
    const insert = db
        .prepare(`
    INSERT INTO cash_closures (
      scope, business_date, period_start, period_end,
      opening_float_cents, expected_cash_cents, counted_cash_cents, variance_cents,
      gross_collected_cents, refunded_cents, net_collected_cents,
      bill_count, refund_count,
      payment_methods_json, staff_sales_json, tax_components_json,
      pay_in_cents, pay_out_cents, safe_drop_cents, cash_movements_json,
      z_number, closed_by, notes, created_at
    ) VALUES (
      'session', ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `)
        .run(businessDate, session.opened_at, closedAt, Number(session.opening_float_cents || 0), expectedCashCents, countedCashCents, varianceCents, aggregates.grossCollectedCents, aggregates.refundedCents, aggregates.netCollectedCents, aggregates.billCount, aggregates.refundCount, JSON.stringify(aggregates.paymentMethods), JSON.stringify(aggregates.staffSales), JSON.stringify(aggregates.taxComponents), aggregates.payInCents, aggregates.payOutCents, aggregates.safeDropCents, JSON.stringify(aggregates.cashMovements), zNumber, closerId, notes, closedAt);
    const closureId = Number(insert.lastInsertRowid);
    db.prepare(`UPDATE cash_sessions SET status = 'closed', closed_at = ?, closed_by = ?, closure_id = ? WHERE id = ?`).run(closedAt, closerId, closureId, session.id);
    return {
        closure_id: closureId,
        variance_cents: varianceCents,
        expected_cash_cents: expectedCashCents,
        counted_cash_cents: countedCashCents,
    };
}
router.post('/open', (0, authorization_1.requirePermission)('cash.shifts.open'), (req, res) => {
    let operationCommitted = false;
    let transactionBodyCompleted = false;
    try {
        const openingFloatCents = validateCents((req.body || {}).opening_float_cents ?? 0, 'opening_float_cents', 'opening_float_invalid');
        const db = (0, db_1.getDatabase)();
        const openedBy = actorId(req);
        const openedByRow = db.prepare(`SELECT name FROM users WHERE id = ?`).get(openedBy);
        const result = (0, db_1.withTxn)(() => {
            // Stale auto-close: an open session older than the threshold with no
            // store activity since is system-closed (zero count, flagged) so a new
            // shift can open. Matches Square's stale-drawer rule.
            const thresholdDays = Math.max(1, parseInt((0, db_1.getSettingValue)('stale_session_days') || '7', 10) || 7);
            const cutoff = daysAgoUtc(thresholdDays);
            const stale = db
                .prepare(`SELECT * FROM cash_sessions WHERE status = 'open' AND opened_at < ?`)
                .all(cutoff);
            if (stale.length > 0) {
                const activity = db
                    .prepare(`
          SELECT
            EXISTS(SELECT 1 FROM bills WHERE paid_at >= ?)
            OR EXISTS(
              SELECT 1 FROM bills b
              JOIN json_each(CASE
                WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array' THEN b.payment_details
                WHEN json_valid(b.payment_details) THEN json_array(b.payment_details)
                ELSE '[]'
              END) je
              WHERE json_type(je.value) = 'object'
                AND datetime(COALESCE(NULLIF(json_extract(je.value, '$.timestamp'), ''), b.paid_at, b.created_at)) >= datetime(?)
            )
            OR EXISTS(SELECT 1 FROM cash_drawer_movements WHERE created_at >= ?)
            OR EXISTS(SELECT 1 FROM refunds WHERE created_at >= ?) AS active
        `)
                    .get(cutoff, cutoff, cutoff, cutoff);
                if (!activity.active) {
                    for (const s of stale) {
                        closeSessionTxn(db, s, 0, openedBy, 'System auto-close: stale session, flagged for manager review');
                    }
                }
            }
            const perStaffShifts = (0, shift_session_gate_1.isPerStaffShiftsEnabled)(db);
            if (perStaffShifts) {
                if ((0, shift_session_gate_1.getOpenSession)(db, openedBy)) {
                    throw httpError('You already have an open shift', 409, 'session_already_open');
                }
            }
            else if ((0, shift_session_gate_1.listOpenSessions)(db).length > 0) {
                throw httpError('A shift is already open', 409, 'session_already_open');
            }
            const openBusinessDate = (0, db_1.localDateInTimezone)(new Date(), (0, cash_closures_1.tenantTimezone)(), (0, db_1.tenantBusinessDayStartTime)(db));
            if ((0, cash_drawer_movements_1.closedDayExists)(db, openBusinessDate))
                throw httpError('This day is already closed', 409, 'day_already_closed');
            const openedAt = (0, db_1.now)();
            const insert = db
                .prepare(`
        INSERT INTO cash_sessions (opened_by, opened_by_name, opened_at, opening_float_cents, status)
        VALUES (?, ?, ?, ?, 'open')
      `)
                .run(openedBy, openedByRow?.name ?? openedBy, openedAt, openingFloatCents);
            const sessionId = Number(insert.lastInsertRowid);
            // Keep day close reconciling the same physical drawer: mirror the
            // float as the day's opening_float movement. Session math ignores
            // in-window float movements (openingFloatOverride), so this cannot
            // double-count there. When per-staff shifts are enabled, concurrent
            // shifts on the same business date sum their opening floats into the
            // day's opening_float row so day close equals the sum of all shifts.
            if (openingFloatCents > 0) {
                const existingFloat = db
                    .prepare(`SELECT id FROM cash_drawer_movements WHERE business_date = ? AND movement_type = 'opening_float' AND voided_at IS NULL LIMIT 1`)
                    .get(openBusinessDate);
                if (!existingFloat) {
                    db.prepare(`
            INSERT INTO cash_drawer_movements (
              business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
            ) VALUES (?, 'opening_float', ?, 'Shift opening float', ?, ?, ?)
          `).run(openBusinessDate, openingFloatCents, openedBy, openedAt, sessionId);
                }
                else if (perStaffShifts) {
                    db.prepare(`UPDATE cash_drawer_movements SET amount_cents = amount_cents + ? WHERE id = ?`).run(openingFloatCents, existingFloat.id);
                }
            }
            const openedSession = db.prepare(`SELECT * FROM cash_sessions WHERE id = ?`).get(sessionId);
            transactionBodyCompleted = true;
            return openedSession;
        });
        operationCommitted = true;
        res.json(result);
    }
    catch (error) {
        const status = errorStatus(error);
        const safeMessage = status >= 500 ? 'Failed to open shift' : errorMessage(error, 'Failed to open shift');
        const diagnosticCode = typeof error === 'object' && error !== null && 'diagnosticCode' in error
            ? String(error.diagnosticCode)
            : undefined;
        const payload = operationCommitted
            ? (0, cash_closures_1.cashOperationFailurePayload)(req, safeMessage, 'fc.backend.cash.session.open.completion', 'applied')
            : status >= 500
                ? (0, cash_closures_1.cashOperationFailurePayload)(req, safeMessage, 'fc.backend.cash.session.open.persistence', transactionBodyCompleted ? 'unknown' : 'not_applied')
                : diagnosticCode
                    ? (0, cash_closures_1.cashOperationFailurePayload)(req, safeMessage, 'fc.backend.cash.session.open.validation', 'not_applied', diagnosticCode)
                    : { error: safeMessage };
        res.status(status).json(payload);
    }
});
router.get('/open', (0, authorization_1.requirePermission)('cash.shifts.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const asOf = (0, db_1.now)();
        const role = actorRole(req);
        const callerId = actorId(req);
        const allOpen = (0, shift_session_gate_1.listOpenSessions)(db);
        const visible = role === 'owner' || role === 'manager'
            ? allOpen
            : allOpen.filter((s) => s.opened_by === callerId);
        res.json({
            sessions: visible.map((session) => ({
                ...session,
                expected_cash_cents: (0, cash_closures_1.sessionExpectedCash)(db, session, asOf),
            })),
            one_shift_per_staff: (0, shift_session_gate_1.isPerStaffShiftsEnabled)(db),
        });
    }
    catch (error) {
        const status = errorStatus(error);
        res.status(status).json({
            error: status >= 500
                ? 'Failed to list open shifts'
                : errorMessage(error, 'Failed to list open shifts'),
        });
    }
});
router.get('/current/close-preview', (0, authorization_1.requirePermission)('cash.shifts.close'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const callerId = actorId(req);
        const role = actorRole(req);
        let session;
        if (req.query.session_id !== undefined && String(req.query.session_id).trim() !== '') {
            const requestedId = Number(req.query.session_id);
            if (!Number.isInteger(requestedId) || requestedId <= 0) {
                throw httpError('Invalid session id', 400, 'session_id_invalid');
            }
            session = db
                .prepare(`SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'`)
                .get(requestedId);
        }
        else {
            session = (0, shift_session_gate_1.getOpenSession)(db, callerId);
        }
        if (!session) {
            return res.status(404).json({
                error: 'No open shift',
                display_code: 'session_unavailable',
            });
        }
        if (role !== 'owner' && role !== 'manager' && session.opened_by !== callerId) {
            return res.status(403).json({
                error: 'Cashiers can only close their own shift',
                code: 'session_owner_required',
                display_code: 'session_owner_required',
            });
        }
        const asOf = (0, db_1.now)();
        const unpaid = (0, cash_day_close_guards_1.findUnpaidInShiftOrders)(db, session, asOf);
        res.json({
            session_id: session.id,
            opened_by_name: session.opened_by_name,
            opened_at: session.opened_at,
            unpaid_in_shift: unpaid,
            would_block_close: false,
        });
    }
    catch (error) {
        const status = errorStatus(error);
        res.status(status).json({
            error: status >= 500
                ? 'Failed to load shift close preview'
                : errorMessage(error, 'Failed to load shift close preview'),
        });
    }
});
router.get('/current', (0, authorization_1.requirePermission)('cash.shifts.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const callerId = actorId(req);
        const role = actorRole(req);
        let session;
        if (req.query.session_id !== undefined && String(req.query.session_id).trim() !== '') {
            const requestedId = Number(req.query.session_id);
            if (!Number.isInteger(requestedId) || requestedId <= 0) {
                throw httpError('Invalid session id', 400, 'session_id_invalid');
            }
            session = db
                .prepare(`SELECT * FROM cash_sessions WHERE id = ? AND status = 'open'`)
                .get(requestedId);
            if (session && role !== 'owner' && role !== 'manager' && session.opened_by !== callerId) {
                return res.status(403).json({
                    error: 'Cashiers can only view their own shift',
                    code: 'session_owner_required',
                });
            }
        }
        else if (typeof req.query.user_id === 'string' && req.query.user_id.trim() !== '') {
            const requestedUserId = req.query.user_id.trim();
            if (role !== 'owner' && role !== 'manager' && requestedUserId !== callerId) {
                return res.status(403).json({
                    error: 'Cashiers can only view their own shift',
                    code: 'session_owner_required',
                });
            }
            session = (0, shift_session_gate_1.getOpenSession)(db, requestedUserId);
        }
        else {
            session = (0, shift_session_gate_1.getOpenSession)(db, callerId);
        }
        // Documented contract (docs/reference/api.md): 200 with `null` when no
        // shift is open. A 404 here logged a failed request on every POS mount.
        if (!session)
            return res.json(null);
        // Single timestamp for the whole snapshot: now() has second granularity,
        // so two evaluations could straddle a second boundary and disagree.
        // Lightweight path: the snapshot only needs expected cash, none of the
        // display sections (payment breakdown, staff sales, tax hydration).
        const asOf = (0, db_1.now)();
        const expectedCashCents = (0, cash_closures_1.sessionExpectedCash)(db, session, asOf);
        res.json({ ...session, expected_cash_cents: expectedCashCents });
    }
    catch (error) {
        const status = errorStatus(error);
        res.status(status).json({
            error: status >= 500
                ? 'Failed to read current shift'
                : errorMessage(error, 'Failed to read current shift'),
        });
    }
});
router.post('/:id/close', (0, authorization_1.requirePermission)('cash.shifts.close'), (req, res) => {
    let operationCommitted = false;
    let transactionBodyCompleted = false;
    try {
        const sessionId = Number(req.params.id);
        if (!Number.isInteger(sessionId))
            throw httpError('Invalid session id', 400, 'session_id_invalid');
        const countedCashCents = validateCents((req.body || {}).counted_cash_cents, 'counted_cash_cents', 'counted_cash_invalid');
        const notes = typeof (req.body || {}).notes === 'string' ? req.body.notes.slice(0, 500) : null;
        const db = (0, db_1.getDatabase)();
        const closer = actorId(req);
        const role = actorRole(req);
        const result = (0, db_1.withTxn)(() => {
            const session = db.prepare(`SELECT * FROM cash_sessions WHERE id = ?`).get(sessionId);
            if (!session)
                throw httpError('Shift not found', 404, 'session_unavailable');
            if (session.status !== 'open')
                throw httpError('Shift is already closed', 409, 'session_already_closed');
            // Own-session rule: non-owner/manager roles close only the shift they opened;
            // manager/owner may close anyone's (recorded via closed_by).
            if (role !== 'owner' && role !== 'manager' && session.opened_by !== closer) {
                throw httpError('Cashiers can only close their own shift', 403, 'session_owner_required');
            }
            const closedSession = closeSessionTxn(db, session, countedCashCents, closer, notes);
            transactionBodyCompleted = true;
            return closedSession;
        });
        operationCommitted = true;
        res.json(result);
    }
    catch (error) {
        const status = errorStatus(error);
        const safeMessage = status >= 500 ? 'Failed to close shift' : errorMessage(error, 'Failed to close shift');
        const diagnosticCode = typeof error === 'object' && error !== null && 'diagnosticCode' in error
            ? String(error.diagnosticCode)
            : undefined;
        const payload = operationCommitted
            ? (0, cash_closures_1.cashOperationFailurePayload)(req, safeMessage, 'fc.backend.cash.session.close.completion', 'applied')
            : status >= 500
                ? (0, cash_closures_1.cashOperationFailurePayload)(req, safeMessage, 'fc.backend.cash.session.close.persistence', transactionBodyCompleted ? 'unknown' : 'not_applied')
                : diagnosticCode
                    ? (0, cash_closures_1.cashOperationFailurePayload)(req, safeMessage, 'fc.backend.cash.session.close.validation', 'not_applied', diagnosticCode)
                    : { error: safeMessage };
        res.status(status).json(payload);
    }
});
exports.cashSessionRoutes = router;
//# sourceMappingURL=cash-sessions.js.map