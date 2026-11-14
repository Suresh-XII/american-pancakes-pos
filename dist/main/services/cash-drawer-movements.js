"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MOVEMENT_REASON_LENGTH = void 0;
exports.tenantTimezone = tenantTimezone;
exports.closedDayExists = closedDayExists;
exports.insertCashDrawerMovement = insertCashDrawerMovement;
/**
 * Cash drawer movement writes and closed-day / store-timezone helpers shared by
 * the standalone cash-closures routes, paid-bill payment-method corrections, and
 * the expense payment ledger. One place owns the closed-day rule, so a payment
 * or expense correction can never move money into a day the store already closed.
 *
 * Leaf module: route modules and services import from here, and nothing here
 * imports a route, so no require cycle exists. Callers open the transaction and
 * own their session gate — the standalone routes keep the configurable
 * `require_open_shift` behaviour, while expense cash entries require a real
 * open session unconditionally.
 */
const db_1 = require("../db");
const countries_1 = require("../countries");
exports.MAX_MOVEMENT_REASON_LENGTH = 500;
function movementError(message, statusCode, code = null) {
    return Object.assign(new Error(message), { statusCode, code });
}
/** Resolves the store's configured timezone through the country profile. */
function tenantTimezone() {
    return (0, countries_1.resolveRegionalSnapshot)({
        country: (0, db_1.getSettingValue)('country') ?? undefined,
        currency: (0, db_1.getSettingValue)('currency') ?? undefined,
        timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
    }).timezone;
}
/** A closed day refuses new drawer money even while a session is still open. */
function closedDayExists(db, businessDate) {
    return !!db
        .prepare(`SELECT id FROM cash_closures WHERE business_date = ? AND scope = 'day' LIMIT 1`)
        .get(businessDate);
}
/**
 * Inserts one drawer movement inside the caller's transaction. Amount and
 * session are validated by the caller; this owns the closed-day guard and the
 * shared reason bound.
 */
function insertCashDrawerMovement(db, input) {
    if (closedDayExists(db, input.businessDate)) {
        throw movementError('This day is already closed', 409, 'day_closed');
    }
    if (input.reason !== null && input.reason.length > exports.MAX_MOVEMENT_REASON_LENGTH) {
        throw movementError('reason is too long', 400);
    }
    const result = db
        .prepare(`
    INSERT INTO cash_drawer_movements (
      business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
        .run(input.businessDate, input.movementType, input.amountCents, input.reason, input.createdBy, (0, db_1.now)(), input.cashSessionId);
    return Number(result.lastInsertRowid);
}
//# sourceMappingURL=cash-drawer-movements.js.map