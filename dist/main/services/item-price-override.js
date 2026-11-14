"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.now = exports.MAX_PRICE_OVERRIDE_REASON_LENGTH = exports.ITEM_PRICE_OVERRIDE_PERMISSION = void 0;
exports.normalizeOverridePrice = normalizeOverridePrice;
exports.parsePriceOverrideInput = parsePriceOverrideInput;
exports.markItemPriceOverridden = markItemPriceOverridden;
exports.carryPriceOverride = carryPriceOverride;
exports.listPriceExceptions = listPriceExceptions;
exports.listShiftsOverlapping = listShiftsOverlapping;
exports.getShiftWindow = getShiftWindow;
const decimal_js_1 = __importDefault(require("decimal.js"));
const db_1 = require("../db");
Object.defineProperty(exports, "now", { enumerable: true, get: function () { return db_1.now; } });
exports.ITEM_PRICE_OVERRIDE_PERMISSION = 'orders.item.price_override';
exports.MAX_PRICE_OVERRIDE_REASON_LENGTH = 200;
/** Rounds a non-negative unit price to currency precision using half-up rounding. */
function normalizeOverridePrice(price, decimals) {
    return new decimal_js_1.default(price).toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP).toNumber();
}
/** Validates a client override: a finite non-negative price (0 allowed) and a required reason. */
function parsePriceOverrideInput(raw, decimals) {
    const input = (raw && typeof raw === 'object' ? raw : {});
    const price = typeof input.price === 'string' ? Number(input.price) : input.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
        throw Object.assign(new Error('price must be a non-negative number'), { statusCode: 400 });
    }
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length === 0) {
        throw Object.assign(new Error('A reason is required for a price override'), {
            statusCode: 400,
        });
    }
    if (reason.length > exports.MAX_PRICE_OVERRIDE_REASON_LENGTH) {
        throw Object.assign(new Error(`reason must be at most ${exports.MAX_PRICE_OVERRIDE_REASON_LENGTH} characters`), { statusCode: 400 });
    }
    return { price: normalizeOverridePrice(price, decimals), reason };
}
/** Flags an item as price-overridden, keeping the first menu price when overridden repeatedly. */
function markItemPriceOverridden(db, itemId, state) {
    db.prepare(`UPDATE order_items SET price_overridden = 1, original_unit_price = ?, price_override_reason = ?,
       price_overridden_by = ?, price_overridden_at = ? WHERE id = ?`).run(state.originalUnitPrice, state.reason, state.actorUserId, state.at, itemId);
}
/** Copies the override flag from a replaced line onto its same-product successor. */
function carryPriceOverride(db, fromItemId, toItemId) {
    db.prepare(`UPDATE order_items SET
       price_overridden = (SELECT price_overridden FROM order_items WHERE id = ?),
       original_unit_price = (SELECT original_unit_price FROM order_items WHERE id = ?),
       price_override_reason = (SELECT price_override_reason FROM order_items WHERE id = ?),
       price_overridden_by = (SELECT price_overridden_by FROM order_items WHERE id = ?),
       price_overridden_at = (SELECT price_overridden_at FROM order_items WHERE id = ?)
     WHERE id = ?`).run(fromItemId, fromItemId, fromItemId, fromItemId, fromItemId, toItemId);
}
/** Overridden, non-cancelled lines whose override time falls in [fromIso, toIso). */
function listPriceExceptions(db, fromIso, toIso) {
    return db
        .prepare(`SELECT oi.order_id AS order_id, o.order_number AS order_number, oi.id AS item_id,
              oi.product_name AS product_name, oi.quantity AS quantity,
              COALESCE(oi.original_unit_price, oi.unit_price) AS original_unit_price,
              oi.unit_price AS billed_unit_price,
              oi.unit_price - COALESCE(oi.original_unit_price, oi.unit_price) AS difference,
              oi.price_override_reason AS reason,
              oi.price_overridden_by AS changed_by_id, u.name AS changed_by_name,
              oi.price_overridden_at AS changed_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN users u ON u.id = oi.price_overridden_by
       WHERE oi.price_overridden = 1
         AND oi.status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')
         AND oi.price_overridden_at >= ? AND oi.price_overridden_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM delivery_order_tracking d_sb
           WHERE d_sb.internal_order_id = o.id AND d_sb.is_simulated = 1
         )
       ORDER BY oi.price_overridden_at ASC, oi.id ASC`)
        .all(fromIso, toIso);
}
function listShiftsOverlapping(db, fromIso, toIso) {
    return db
        .prepare(`SELECT id, opened_by_name, opened_at, closed_at
       FROM cash_sessions
       WHERE opened_at < ? AND COALESCE(closed_at, ?) >= ?
       ORDER BY opened_at DESC, id DESC
       LIMIT 20`)
        .all(toIso, toIso, fromIso);
}
function getShiftWindow(db, id) {
    return db
        .prepare('SELECT id, opened_by_name, opened_at, closed_at FROM cash_sessions WHERE id = ?')
        .get(id);
}
//# sourceMappingURL=item-price-override.js.map