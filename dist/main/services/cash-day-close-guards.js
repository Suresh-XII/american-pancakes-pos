"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionBusinessDate = sessionBusinessDate;
exports.openSessionsBlockingDayClose = openSessionsBlockingDayClose;
exports.openSessionBlockingDayClose = openSessionBlockingDayClose;
exports.shiftUnpaidBillsInWindow = shiftUnpaidBillsInWindow;
exports.findUnpaidInShiftOrders = findUnpaidInShiftOrders;
/**
 * Day-close guards and shared shift-close unpaid queries. Leaf module: no
 * route imports, so cash-closures and cash-sessions can both depend on it.
 */
const db_1 = require("../db");
const countries_1 = require("../countries");
const refund_1 = require("./refund");
const shift_session_gate_1 = require("./shift-session-gate");
function tenantTimezone() {
    return (0, countries_1.resolveRegionalSnapshot)({
        country: (0, db_1.getSettingValue)('country') ?? undefined,
        currency: (0, db_1.getSettingValue)('currency') ?? undefined,
        timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
    }).timezone;
}
/** Tenant-local business date when the shift was opened. */
function sessionBusinessDate(db, session) {
    return (0, db_1.localDateInTimezone)((0, db_1.parseDbTimestamp)(session.opened_at), tenantTimezone(), (0, db_1.tenantBusinessDayStartTime)(db));
}
/** All open shifts that must close before day-close for `businessDate`. */
function openSessionsBlockingDayClose(db, businessDate) {
    return (0, shift_session_gate_1.listOpenSessions)(db).filter((session) => sessionBusinessDate(db, session) <= businessDate);
}
/** Open shift that must close before day-close for `businessDate`, if any. */
function openSessionBlockingDayClose(db, businessDate) {
    return openSessionsBlockingDayClose(db, businessDate)[0];
}
/**
 * Unpaid or partially-paid bills created during [openedAt, end] - informational
 * carry-over preview for shift close. Cancelled orders are excluded.
 */
function shiftUnpaidBillsInWindow(db, openedAt, end) {
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
    const row = db
        .prepare(`
    SELECT
      COUNT(*) AS bill_count,
      COALESCE(SUM(CAST(ROUND(COALESCE(b.balance, b.total, 0) * ?) AS INTEGER)), 0) AS pending_cents
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    WHERE b.payment_status NOT IN ('paid', 'refunded', 'partially_refunded')
      AND o.status != 'cancelled'
      AND COALESCE(b.balance, b.total, 0) > 0
      AND b.created_at >= ? AND b.created_at <= ?
  `)
        .get(minorFactor, openedAt, end);
    const sampleRows = db
        .prepare(`
    SELECT
      o.id AS order_id,
      o.order_number AS order_number,
      b.id AS bill_id,
      b.bill_number AS bill_number,
      o.status AS status,
      b.payment_status AS payment_status,
      COALESCE(b.total, 0) AS total,
      COALESCE(b.balance, b.total, 0) AS balance,
      CAST(ROUND(COALESCE(b.balance, b.total, 0) * ?) AS INTEGER) AS balance_cents,
      b.created_at AS created_at
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    WHERE b.payment_status NOT IN ('paid', 'refunded', 'partially_refunded')
      AND o.status != 'cancelled'
      AND COALESCE(b.balance, b.total, 0) > 0
      AND b.created_at >= ? AND b.created_at <= ?
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT 5
  `)
        .all(minorFactor, openedAt, end);
    const count = Number(row.bill_count || 0);
    return {
        count,
        bill_count: count,
        pending_cents: Number(row.pending_cents || 0),
        sample: sampleRows.map((item) => ({
            order_id: Number(item.order_id),
            order_number: String(item.order_number || ''),
            bill_id: Number(item.bill_id),
            bill_number: String(item.bill_number || ''),
            status: String(item.status || ''),
            payment_status: String(item.payment_status || ''),
            total: Number(item.total || 0),
            balance: Number(item.balance || 0),
            balance_cents: Number(item.balance_cents || 0),
            created_at: String(item.created_at || ''),
        })),
    };
}
function findUnpaidInShiftOrders(db, session, asOf) {
    return shiftUnpaidBillsInWindow(db, session.opened_at, asOf);
}
//# sourceMappingURL=cash-day-close-guards.js.map