"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTenantCurrency = getTenantCurrency;
exports.getRefundableBalance = getRefundableBalance;
exports.checkIsLateRefund = checkIsLateRefund;
exports.validateRefundPreconditions = validateRefundPreconditions;
exports.createRefund = createRefund;
/** Bill-level cash-back and item-level refund processing for paid bills. */
const db_1 = require("../db");
const tax_1 = require("./tax");
const inventory_1 = require("./inventory");
const orders_1 = require("./orders");
const shift_session_gate_1 = require("./shift-session-gate");
const role_permissions_1 = require("../../shared/role-permissions");
const countries_1 = require("../countries");
// Kept in sync with the 1:1 rate in main/routes/bills.ts — loyalty points equal currency units.
const LOYALTY_REDEMPTION_RATE = 1;
// Items already served/completed become refundable once an order is past the short window below.
const REFUND_ITEM_ELIGIBLE_STATUSES = ['preparing', 'ready', 'served', 'completed'];
const REFUND_WINDOW_MS = 60 * 60 * 1000;
function getTenantCurrency(db) {
    const explicit = db
        ? db.prepare("SELECT value FROM settings WHERE key = 'currency'").get()?.value
        : (0, db_1.getSettingValue)('currency');
    const country = db
        ? db.prepare("SELECT value FROM settings WHERE key = 'country'").get()?.value
        : (0, db_1.getSettingValue)('country');
    return (0, countries_1.resolveTenantCurrency)(explicit, country || '');
}
function httpError(message, statusCode, diagnosticCode) {
    return Object.assign(new Error(message), {
        statusCode,
        ...(diagnosticCode ? { diagnosticCode } : {}),
    });
}
/** Returns the refundable balance for a bill in integer minor units. */
function getRefundableBalance(db, billId, currency) {
    const effectiveCurrency = currency || getTenantCurrency(db);
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(effectiveCurrency);
    const bill = db.prepare('SELECT paid_amount FROM bills WHERE id = ?').get(billId);
    const paidCents = Math.round(Number(bill?.paid_amount || 0) * minorFactor);
    const refundedRow = db
        .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE bill_id = ?')
        .get(billId);
    const refundedCents = Number(refundedRow.total || 0);
    return { paidCents, refundedCents, refundableCents: paidCents - refundedCents };
}
/** `ownerOnly` narrows the approving PIN to owner accounts — used once a refund falls outside the short in-progress window. */
function resolveRefundApprover(db, overridePin, approverId, ownerOnly) {
    const allowedRoles = ownerOnly ? role_permissions_1.ROLE_ACCESS.owner : role_permissions_1.ROLE_ACCESS.ownerManager;
    const placeholders = allowedRoles.map(() => '?').join(', ');
    if (!approverId)
        return null;
    const candidate = db
        .prepare(`SELECT * FROM users WHERE id = ? AND pin_hash IS NOT NULL AND role IN (${placeholders}) AND is_active = 1`)
        .get(approverId, ...allowedRoles);
    return candidate && (0, db_1.verifyPin)(candidate.pin_hash, overridePin) ? candidate : null;
}
/** Check whether a bill/order is in late refund status or expired. */
function checkIsLateRefund(db, billId, nowMs = Date.now()) {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    if (!bill)
        throw httpError('Bill not found', 404, 'bill_unavailable');
    const order = db
        .prepare('SELECT created_at, release_status, released_at FROM orders WHERE id = ?')
        .get(bill.order_id);
    if (!order)
        throw httpError('Order not found', 404, 'order_unavailable');
    if (order.release_status && order.release_status !== 'released') {
        return { lateRefund: false, bill };
    }
    const anchorTimestamp = order.released_at || order.created_at;
    const orderAnchorMs = (0, db_1.parseDbTimestamp)(anchorTimestamp).getTime();
    if (!Number.isFinite(orderAnchorMs))
        throw httpError('Order creation time is invalid', 500);
    if (nowMs - orderAnchorMs > REFUND_WINDOW_MS) {
        const timezone = (0, countries_1.resolveRegionalSnapshot)({
            country: (0, db_1.getSettingValue)('country') ?? undefined,
            currency: (0, db_1.getSettingValue)('currency') ?? undefined,
            timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
        }).timezone;
        const startTime = (0, db_1.tenantBusinessDayStartTime)(db);
        const orderBusinessDate = (0, db_1.localDateInTimezone)(new Date(orderAnchorMs), timezone, startTime);
        const [, businessDayEnd] = (0, db_1.dayBoundsInTimezone)(orderBusinessDate, timezone, startTime);
        if (nowMs >= (0, db_1.parseDbTimestamp)(businessDayEnd).getTime()) {
            throw httpError('Refund window has expired. Completed orders can only be refunded within the same business day.', 409, 'refund_window_expired');
        }
        return { lateRefund: true, bill };
    }
    return { lateRefund: false, bill };
}
/** Validates refund preconditions before PIN verification and write transaction. */
function validateRefundPreconditions(db, req, nowMs = Date.now()) {
    (0, shift_session_gate_1.requireOpenSessionForCashTender)(db, [{ method: req.method }], req.createdByUserId);
    const { lateRefund, bill } = checkIsLateRefund(db, req.billId, nowMs);
    const currency = getTenantCurrency(db);
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
    let amountCents = req.amountCents;
    let item = null;
    if (req.orderItemId != null) {
        item =
            db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.orderItemId) ?? null;
        if (!item)
            throw httpError('Order item not found', 404, 'item_unavailable');
        if (String(item.order_id) !== String(bill.order_id)) {
            throw httpError("Item does not belong to this bill's order", 400, 'item_bill_mismatch');
        }
        if (bill.split_group_id) {
            const allocation = db
                .prepare(`
        SELECT quantity FROM bill_items WHERE bill_id = ? AND order_item_id = ?
      `)
                .get(bill.id, item.id);
            if (!allocation) {
                throw httpError('Item is not allocated to this split bill', 400, 'split_item_unallocated');
            }
            if (Number(allocation.quantity) !== Number(item.quantity)) {
                throw httpError('Partially allocated split items cannot be refunded as a whole item', 409, 'split_item_partial');
            }
        }
        if (!REFUND_ITEM_ELIGIBLE_STATUSES.includes(item.status)) {
            throw httpError('Item is not eligible for refund', 409, 'item_status_ineligible');
        }
        const itemAmountCents = Math.round(Number(item.total) * minorFactor);
        if (amountCents !== undefined && amountCents !== itemAmountCents) {
            throw httpError("Refund amount does not match the item's refundable total", 400, 'item_amount_mismatch');
        }
        amountCents = itemAmountCents;
    }
    if (amountCents === undefined || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw httpError('Refund amount is required', 400, 'amount_required');
    }
    if (!req.method || typeof req.method !== 'string' || req.method.length > 60) {
        throw httpError('Refund method is required', 400, 'method_required');
    }
    const isStoreCreditRefund = req.method === 'wallet';
    if (isStoreCreditRefund) {
        const loyaltyEnabled = ['true', '1'].includes((0, db_1.getSettingValue)('loyalty_enabled') || '');
        if (!loyaltyEnabled)
            throw httpError('Store credit is not enabled', 400, 'wallet_disabled');
        if (!bill.customer_id)
            throw httpError('Customer association is required for a store-credit refund', 400, 'wallet_customer_required');
    }
    const { refundableCents } = getRefundableBalance(db, req.billId, currency);
    if (refundableCents <= 0)
        throw httpError('Bill has nothing left to refund', 400, 'nothing_to_refund');
    if (amountCents > refundableCents)
        throw httpError('Refund amount exceeds the refundable balance', 400, 'amount_exceeds_refundable');
    return { lateRefund, bill, item, amountCents, currency };
}
/** Validates, authorizes, and persists a refund inside an active transaction. */
function createRefund(db, req) {
    if (req.idempotencyKey) {
        const prior = db
            .prepare(`
      SELECT bill_id, request_hash, response_json
      FROM refund_idempotency
      WHERE user_id = ? AND idempotency_key = ?
    `)
            .get(req.createdByUserId, req.idempotencyKey);
        if (prior) {
            if (String(prior.bill_id) !== String(req.billId) || prior.request_hash !== req.requestHash) {
                throw httpError('Idempotency-Key was already used for a different refund request', 409, 'idempotency_conflict');
            }
            try {
                return JSON.parse(prior.response_json);
            }
            catch {
                throw httpError('Stored refund response is invalid', 500);
            }
        }
    }
    const nowMs = Date.now();
    const { lateRefund, bill, item, amountCents, currency } = validateRefundPreconditions(db, req, nowMs);
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
    const isStoreCreditRefund = req.method === 'wallet';
    const { paidCents, refundedCents } = getRefundableBalance(db, req.billId, currency);
    let approver = null;
    if (req.preVerifiedApprover) {
        if (req.preVerifiedApprover.id !== req.approverId) {
            throw httpError('Pre-verified approver mismatch', 403, 'approver_pin_invalid');
        }
        if (lateRefund && !req.preVerifiedApprover.lateRefund) {
            throw httpError('Owner PIN required to process a refund on a completed order', 403, 'approver_pin_invalid');
        }
        const allowedRoles = lateRefund ? role_permissions_1.ROLE_ACCESS.owner : role_permissions_1.ROLE_ACCESS.ownerManager;
        const placeholders = allowedRoles.map(() => '?').join(', ');
        const candidate = db
            .prepare(`SELECT id, pin_hash, role, is_active FROM users WHERE id = ? AND pin_hash IS NOT NULL AND role IN (${placeholders}) AND is_active = 1`)
            .get(req.preVerifiedApprover.id, ...allowedRoles);
        if (!candidate || candidate.pin_hash !== req.preVerifiedApprover.verifiedPinHash) {
            throw httpError(lateRefund ? 'Invalid owner PIN' : 'Invalid manager PIN', 403, 'approver_pin_invalid');
        }
        approver = candidate;
    }
    else {
        if (!req.overridePin) {
            throw httpError(lateRefund
                ? 'Owner PIN required to process a refund on a completed order'
                : 'Manager PIN required to process a refund', 400, 'approver_pin_required');
        }
        const rateLimitKey = `pin:${req.clientIp}:refund`;
        if (req.isPinRateLimited(rateLimitKey)) {
            throw httpError('Too many PIN attempts. Try again in 15 minutes.', 429, 'pin_rate_limited');
        }
        approver = resolveRefundApprover(db, req.overridePin, req.approverId, lateRefund);
        if (!approver) {
            req.checkPinRateLimit(rateLimitKey);
            throw httpError(lateRefund ? 'Invalid owner PIN' : 'Invalid manager PIN', 403, 'approver_pin_invalid');
        }
        req.clearPinRateLimit(rateLimitKey);
    }
    if (!approver) {
        throw httpError(lateRefund ? 'Invalid owner PIN' : 'Invalid manager PIN', 403, 'approver_pin_invalid');
    }
    const timestamp = (0, db_1.now)();
    if (item) {
        // Insert negative void_adjustment row to reverse item cost while preserving audit trail.
        const reversedIngredientCost = Number(item.ingredient_cost_known) === 1 &&
            typeof item.ingredient_cost === 'number' &&
            Number.isFinite(item.ingredient_cost)
            ? item.ingredient_cost === 0
                ? 0
                : -item.ingredient_cost
            : null;
        const reversedIngredientCostKnown = reversedIngredientCost !== null ? 1 : 0;
        const adjustmentResult = db
            .prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, product_sku, unit_price, quantity,
        subtotal, tax_amount, tax_breakdown, tax_snapshot, tax_type, discount_amount, total,
        variant_selection, modifier_selection, ingredient_cost, ingredient_cost_known, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'void_adjustment', ?, ?)
    `)
            .run(item.order_id, item.product_id, `Refund: ${item.product_name}`, item.product_sku, -item.unit_price, item.quantity, -item.subtotal, -(item.tax_amount || 0), (0, tax_1.invertTaxBreakdown)(item.tax_breakdown), (0, tax_1.invertTaxSnapshot)(item.tax_snapshot), item.tax_type, -(item.discount_amount || 0), -item.total, item.variant_selection, item.modifier_selection, reversedIngredientCost, reversedIngredientCostKnown, timestamp, timestamp);
        if (bill.split_group_id) {
            db.prepare('INSERT INTO bill_items (bill_id, order_item_id, quantity) VALUES (?, ?, ?)').run(bill.id, adjustmentResult.lastInsertRowid, item.quantity);
        }
        db.prepare("UPDATE order_items SET status = 'refunded', voided_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, item.id);
        const lifecycle = db.prepare('SELECT inventory_lifecycle FROM orders WHERE id = ?').get(item.order_id);
        // Financial refunds do not restore physical stock for checkout-time orders.
        // Legacy rows retain their historical behavior.
        const addonDeductions = lifecycle?.inventory_lifecycle === 'checkout_v1' ? [] : db
            .prepare(`
        SELECT addon_id, addon_name, inventory_deducted_quantity
        FROM order_item_addons
        WHERE order_item_id = ? AND inventory_deducted_quantity > 0
      `)
            .all(item.id);
        for (const addon of addonDeductions) {
            const quantity = Number(addon.inventory_deducted_quantity) || 0;
            const addonId = addon.addon_id ? String(addon.addon_id) : null;
            if (quantity <= 0 || !addonId)
                continue;
            const catalogAddon = db.prepare('SELECT id FROM addons WHERE id = ?').get(addonId);
            if (!catalogAddon)
                continue;
            (0, inventory_1.adjustProductStock)(db, {
                productId: null,
                addonId: catalogAddon.id,
                quantityDelta: quantity,
                movementType: 'cancel_restore',
                referenceType: 'order_item',
                referenceId: `${item.id}:${timestamp}`,
                reason: req.reason || 'Item refunded',
                actorUserId: req.createdByUserId,
                createdAt: timestamp,
            });
        }
    }
    const cashSessionId = (0, shift_session_gate_1.getOpenSession)(db, req.createdByUserId)?.id ?? shift_session_gate_1.NO_CASH_SESSION_ID;
    const insertResult = db
        .prepare(`
    INSERT INTO refunds (bill_id, order_item_id, amount_cents, method, reason, shift_id, approved_by, created_by, created_at, cash_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
        .run(req.billId, req.orderItemId ?? null, amountCents, req.method, req.reason ?? null, req.shiftId ?? null, approver.id, req.createdByUserId, timestamp, cashSessionId);
    const newRefundedCents = refundedCents + amountCents;
    const paymentStatus = newRefundedCents >= paidCents ? 'refunded' : 'partially_refunded';
    db.prepare('UPDATE bills SET payment_status = ?, updated_at = ? WHERE id = ?').run(paymentStatus, timestamp, req.billId);
    if (isStoreCreditRefund) {
        // A plain 'credit' row — wallet-funded spend is already excluded from the cashback base.
        const creditAmount = (amountCents / minorFactor) * LOYALTY_REDEMPTION_RATE;
        db.prepare(`
      INSERT INTO loyalty_ledger (customer_id, bill_id, type, amount, description, created_at, updated_at)
      VALUES (?, ?, 'credit', ?, ?, ?, ?)
    `).run(bill.customer_id, req.billId, creditAmount, `Refund credit for bill ${bill.bill_number}`, timestamp, timestamp);
    }
    (0, db_1.recordOrderAudit)(db, {
        orderId: bill.order_id,
        orderItemId: req.orderItemId ?? null,
        actorUserId: req.createdByUserId,
        action: 'refund_issued',
        details: {
            refundId: insertResult.lastInsertRowid,
            billId: req.billId,
            amountCents,
            method: req.method,
            lateRefund,
            approvedBy: approver.id,
            reason: req.reason ?? null,
        },
    });
    if (item) {
        (0, orders_1.reconcileActiveOrderStatusFromItems)(db, bill.order_id, req.createdByUserId);
    }
    const refund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(insertResult.lastInsertRowid);
    const freshBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.billId);
    const result = { refund, bill: freshBill };
    if (req.idempotencyKey && req.requestHash) {
        db.prepare('INSERT INTO refund_idempotency (user_id, idempotency_key, bill_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.createdByUserId, req.idempotencyKey, String(req.billId), req.requestHash, JSON.stringify(result), timestamp);
    }
    return result;
}
//# sourceMappingURL=refund.js.map