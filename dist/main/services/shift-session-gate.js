"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_CASH_SESSION_ID = void 0;
exports.isPerStaffShiftsEnabled = isPerStaffShiftsEnabled;
exports.listOpenSessions = listOpenSessions;
exports.getOpenSession = getOpenSession;
exports.isCashTender = isCashTender;
exports.requireOpenSessionForCash = requireOpenSessionForCash;
exports.requireOpenSessionForCashTender = requireOpenSessionForCashTender;
/**
 * Shift-session enforcement gate (issue #279). Leaf module: route modules
 * (bills, cash-closures, cash-sessions) import from here so no require
 * cycle exists between them.
 */
const db_1 = require("../db");
function httpError(message, statusCode, diagnosticCode) {
    return Object.assign(new Error(message), {
        statusCode,
        ...(diagnosticCode ? { diagnosticCode } : {}),
    });
}
// NULL is reserved for rows written before session ownership was recorded.
// New cash activity outside a shift uses 0 so it cannot enter a later shift
// through the legacy timestamp fallback.
exports.NO_CASH_SESSION_ID = 0;
function isPerStaffShiftsEnabled(db) {
    if (db) {
        const row = db.prepare(`SELECT value FROM settings WHERE key = 'one_shift_per_staff'`).get();
        return row?.value === 'true';
    }
    return (0, db_1.getSettingValue)('one_shift_per_staff') === 'true';
}
function listOpenSessions(db) {
    return db
        .prepare(`SELECT * FROM cash_sessions WHERE status = 'open' ORDER BY opened_at ASC, id ASC`)
        .all();
}
function getOpenSession(db, userId) {
    if (!isPerStaffShiftsEnabled(db)) {
        return db.prepare(`SELECT * FROM cash_sessions WHERE status = 'open' LIMIT 1`).get();
    }
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId)
        return undefined;
    return db
        .prepare(`SELECT * FROM cash_sessions WHERE status = 'open' AND opened_by = ? LIMIT 1`)
        .get(normalizedUserId);
}
const BUILT_IN_PAYMENT_METHODS = new Set(['cash', 'card', 'upi', 'wallet']);
/**
 * Effective-method check mirroring preparePaymentBatch (bills.ts) resolution:
 * builtins pass through, `custom` lines resolve via payment_method_id, other
 * names resolve case-insensitively. Anything unresolvable is not cash here —
 * the payment pipeline itself rejects it with 400, so the gate never masks
 * a validation error.
 */
function isCashTender(db, payment) {
    const method = payment?.method;
    if (typeof method !== 'string')
        return false;
    const normalized = method.toLowerCase();
    if (BUILT_IN_PAYMENT_METHODS.has(normalized))
        return normalized === 'cash';
    const row = (method === 'custom'
        ? db
            .prepare('SELECT name FROM payment_methods WHERE id = ? AND is_active = 1')
            .get(payment.payment_method_id)
        : db
            .prepare('SELECT name FROM payment_methods WHERE lower(name) = lower(?) AND is_active = 1')
            .get(method));
    return typeof row?.name === 'string' && row.name.toLowerCase() === 'cash';
}
/**
 * When the owner opted into `require_open_shift`, cash touching the drawer
 * needs an open session. Non-cash tenders are never gated. Missing setting
 * rows (pre-v90 upgrades) read as off.
 */
function requireOpenSessionForCash(db, userId) {
    if ((0, db_1.getSettingValue)('require_open_shift') !== 'true')
        return;
    if (!getOpenSession(db, userId)) {
        throw httpError('No open shift: open a shift before taking cash', 409, 'cash_session_required');
    }
}
/**
 * Payment-line variant: gates when any line is effectively cash (see
 * isCashTender), so a custom method named "Cash" cannot bypass the gate.
 */
function requireOpenSessionForCashTender(db, payments, userId) {
    if ((0, db_1.getSettingValue)('require_open_shift') !== 'true')
        return;
    if (payments.some((line) => isCashTender(db, line)) && !getOpenSession(db, userId)) {
        throw httpError('No open shift: open a shift before taking cash', 409, 'cash_session_required');
    }
}
//# sourceMappingURL=shift-session-gate.js.map