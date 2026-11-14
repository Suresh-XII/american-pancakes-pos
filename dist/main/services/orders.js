"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPLETED_KDS_PROJECTION_WINDOW_MS = void 0;
exports.calculateOrderTotals = calculateOrderTotals;
exports.recomputeOrderTotals = recomputeOrderTotals;
exports.completedKdsProjectionCutoff = completedKdsProjectionCutoff;
exports.reconcileActiveOrderStatusFromItems = reconcileActiveOrderStatusFromItems;
const decimal_js_1 = __importDefault(require("decimal.js"));
const db_1 = require("../db");
const countries_1 = require("../countries");
const tax_1 = require("./tax");
const order_item_status_1 = require("../../shared/order-item-status");
const charges_1 = require("../../shared/charges");
function calculateOrderTotals(db, orderId) {
    const allItems = db
        .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC`)
        .all(orderId);
    const activeItems = allItems.filter((item) => item.status === null || item.status === undefined || !(0, order_item_status_1.isTerminalItemStatus)(item.status));
    let subtotalDec = new decimal_js_1.default(0);
    let totalTaxDec = new decimal_js_1.default(0);
    let exclusiveTaxDec = new decimal_js_1.default(0);
    const allTaxBreakdowns = [];
    const allTaxSnapshots = [];
    for (const item of activeItems) {
        subtotalDec = subtotalDec.plus(item.subtotal || 0);
        totalTaxDec = totalTaxDec.plus(item.tax_amount || 0);
        if (item.tax_type !== 'inclusive') {
            exclusiveTaxDec = exclusiveTaxDec.plus(item.tax_amount || 0);
        }
        if (item.tax_breakdown) {
            try {
                const breakdown = JSON.parse(item.tax_breakdown);
                if (Array.isArray(breakdown))
                    allTaxBreakdowns.push(breakdown);
            }
            catch { }
        }
        allTaxSnapshots.push(item.tax_snapshot || null);
    }
    return {
        subtotal: subtotalDec.toNumber(),
        totalTax: totalTaxDec.toNumber(),
        exclusiveTax: exclusiveTaxDec.toNumber(),
        allTaxBreakdowns,
        allTaxSnapshots,
        activeItems,
        db,
    };
}
/** Recomputes document taxes, discounts, charges, and totals for order mutations. */
function recomputeOrderTotals(input) {
    const { tenantInfo, chargeContext, customer, totals, discountAmount, taxScaling } = input;
    const decimals = (0, countries_1.getCurrencyFractionDigits)(tenantInfo.currency || '');
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(tenantInfo.currency || '');
    // Engine charges own the standard columns only for ids the merchant actually
    // configured; a manually entered service charge survives when there is no
    // engine charge behind that id.
    const hasAppliedCharges = Array.isArray(input.appliedCharges);
    const appliedCharges = hasAppliedCharges ? input.appliedCharges : [];
    const chargeColumns = hasAppliedCharges
        ? (0, charges_1.toStandardChargeColumns)(appliedCharges, decimals)
        : null;
    const engineOwns = (id) => appliedCharges.some((charge) => charge.id === id);
    // Only non-standard charges are added here: the standard ids are already
    // summed through effectiveChargeContext, so adding them again would double count.
    const otherCharges = chargeColumns ? chargeColumns.other_charges : 0;
    const effectiveChargeContext = {
        ...chargeContext,
        packaging_charge: input.chargeColumnOverrides?.packaging_charge ??
            (engineOwns('packaging_charge')
                ? chargeColumns.packaging_charge
                : chargeContext.packaging_charge),
        service_charge: input.chargeColumnOverrides?.service_charge ??
            (engineOwns('service_charge') ? chargeColumns.service_charge : chargeContext.service_charge),
    };
    const subtotal = totals.subtotal;
    const subtotalDec = new decimal_js_1.default(subtotal);
    // The discount can never exceed the subtotal it is deducted from, so a
    // caller-supplied figure cannot drive the discounted share outside 0..1.
    const effectiveDiscountDec = decimal_js_1.default.max(0, decimal_js_1.default.min(new decimal_js_1.default(discountAmount || 0), subtotalDec));
    const discountedSubtotalDec = decimal_js_1.default.max(0, subtotalDec.minus(effectiveDiscountDec));
    const discountedSubtotal = discountedSubtotalDec.toNumber();
    let chargeTaxes = {
        taxAmount: 0,
        exclusiveTaxAmount: 0,
        breakdowns: [],
        snapshotJson: [],
    };
    if (tenantInfo.taxes_enabled) {
        chargeTaxes = (0, tax_1.calculateConfiguredChargeTaxes)(tenantInfo, effectiveChargeContext, customer);
        const activeItems = totals.activeItems || [];
        const undiscountedAlloc = (0, tax_1.allocateDocumentTaxRounding)({
            items: activeItems.map((item, idx) => ({
                snapshot: item.tax_snapshot,
                lineIdOverride: `line-${String(idx + 1).padStart(4, '0')}:${item.id}`,
            })),
            chargeTaxes,
            currency: tenantInfo.currency || '',
        });
        chargeTaxes = undiscountedAlloc.chargeTaxes;
        activeItems.forEach((item, idx) => {
            const out = undiscountedAlloc.itemOutputs[idx];
            if (!out?.handled)
                return;
            const itemSub = Number(item.subtotal || 0);
            const lineTaxNum = out.taxAmount;
            const newSnapshotJson = out.snapshotJson;
            const newBreakdownJson = JSON.stringify(out.breakdown);
            const newItemTotal = Number((itemSub + (item.tax_type === 'inclusive' ? 0 : lineTaxNum)).toFixed(decimals));
            if (item.tax_amount !== lineTaxNum ||
                item.total !== newItemTotal ||
                item.tax_snapshot !== newSnapshotJson ||
                item.tax_breakdown !== newBreakdownJson) {
                if (totals.db && item.id) {
                    totals.db
                        .prepare(`UPDATE order_items
               SET tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, tax_type = ?, total = ?, updated_at = ?
               WHERE id = ?`)
                        .run(lineTaxNum, newBreakdownJson, newSnapshotJson, item.tax_type, newItemTotal, (0, db_1.now)(), item.id);
                }
                item.tax_amount = lineTaxNum;
                item.tax_breakdown = newBreakdownJson;
                item.tax_snapshot = newSnapshotJson;
                item.total = newItemTotal;
            }
        });
    }
    const applyDiscountScaling = taxScaling === 'always' || (effectiveDiscountDec.gt(0) && subtotalDec.gt(0));
    const taxRatioDec = applyDiscountScaling && subtotalDec.gt(0)
        ? (0, tax_1.computeDiscountTaxRatio)(discountedSubtotalDec, subtotalDec)
        : new decimal_js_1.default(1);
    const taxRatio = taxRatioDec.toNumber();
    let taxAmount;
    let exclusiveTaxAmount;
    let taxRollup;
    if (totals.activeItems && totals.activeItems.length > 0) {
        const rolled = (0, tax_1.rollupOrderTaxes)({
            items: totals.activeItems.map((item, idx) => {
                let parsedBreakdown = null;
                if (item.tax_breakdown) {
                    try {
                        const b = JSON.parse(item.tax_breakdown);
                        if (Array.isArray(b) && b.length > 0)
                            parsedBreakdown = b;
                    }
                    catch { }
                }
                return {
                    taxAmount: item.tax_amount || 0,
                    taxType: item.tax_type,
                    breakdown: parsedBreakdown,
                    snapshot: item.tax_snapshot || null,
                    lineIdOverride: `line-${String(idx + 1).padStart(4, '0')}:${item.id}`,
                };
            }),
            chargeTaxes,
            currency: tenantInfo.currency || '',
            decimals,
            minorFactor,
            itemTaxRatio: taxRatioDec,
            taxesEnabled: tenantInfo.taxes_enabled,
        });
        taxAmount = rolled.itemTaxAmount;
        exclusiveTaxAmount = rolled.itemExclusiveTaxAmount;
        taxRollup = rolled.taxRollup;
    }
    else {
        taxAmount = applyDiscountScaling
            ? new decimal_js_1.default(totals.totalTax)
                .mul(taxRatioDec)
                .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP)
                .toNumber()
            : totals.totalTax;
        exclusiveTaxAmount = applyDiscountScaling
            ? new decimal_js_1.default(totals.exclusiveTax)
                .mul(taxRatioDec)
                .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP)
                .toNumber()
            : totals.exclusiveTax;
        taxRollup = (0, tax_1.combineItemAndChargeTaxes)({
            itemTaxAmount: taxAmount,
            itemExclusiveTaxAmount: exclusiveTaxAmount,
            itemBreakdowns: totals.allTaxBreakdowns,
            itemSnapshots: totals.allTaxSnapshots,
            itemTaxRatio: taxRatioDec,
            chargeTaxes,
            minorFactor,
        });
    }
    const preRoundTotal = discountedSubtotalDec
        .plus(taxRollup.exclusiveTaxAmount)
        .plus(effectiveChargeContext.delivery_charge || 0)
        .plus(effectiveChargeContext.packaging_charge || 0)
        .plus(effectiveChargeContext.service_charge || 0)
        .plus(otherCharges);
    const total = preRoundTotal.toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP).toNumber();
    if (!Number.isSafeInteger(Math.round(total * minorFactor))) {
        throw new charges_1.ChargeValidationError('Order total exceeds the supported currency precision');
    }
    return {
        subtotal,
        discountedSubtotal,
        taxRatio,
        taxAmount,
        exclusiveTaxAmount,
        taxRollup,
        total,
        roundOff: 0,
        appliedCharges: hasAppliedCharges ? appliedCharges : null,
        chargeColumns: chargeColumns
            ? {
                service_charge: chargeColumns.service_charge,
                packaging_charge: chargeColumns.packaging_charge,
            }
            : null,
    };
}
const RECONCILABLE_ORDER_STATUSES = new Set(['pending', 'preparing', 'ready', 'served']);
const RECONCILABLE_ORDER_TYPES = new Set(['dine_in', 'takeaway', 'delivery', 'online']);
exports.COMPLETED_KDS_PROJECTION_WINDOW_MS = 24 * 60 * 60 * 1000;
function completedKdsProjectionCutoff(nowMs = Date.now()) {
    return new Date(nowMs - exports.COMPLETED_KDS_PROJECTION_WINDOW_MS)
        .toISOString()
        .replace('T', ' ')
        .replace(/\..*$/, '');
}
function reconcileActiveOrderStatusFromItems(db, orderId, actorUserId) {
    const order = db.prepare('SELECT id, type, status FROM orders WHERE id = ?').get(orderId);
    if (!order) {
        return { changed: false, previousStatus: null, status: null };
    }
    if (!(0, db_1.isKdsEnabled)() ||
        !RECONCILABLE_ORDER_STATUSES.has(order.status) ||
        !RECONCILABLE_ORDER_TYPES.has(order.type)) {
        return { changed: false, previousStatus: order.status, status: order.status };
    }
    const items = db
        .prepare('SELECT status, quantity FROM order_items WHERE order_id = ?')
        .all(orderId);
    const derived = (0, order_item_status_1.deriveOrderStatusFromItems)(items);
    if (derived === null) {
        return { changed: false, previousStatus: order.status, status: order.status };
    }
    const nowStr = (0, db_1.now)();
    let nextStatus = null;
    if (derived === 'served') {
        if (order.status !== 'served') {
            nextStatus = 'served';
            db.prepare('UPDATE orders SET status = ?, served_at = COALESCE(served_at, ?), updated_at = ? WHERE id = ?').run(nextStatus, nowStr, nowStr, orderId);
        }
    }
    else if (derived === 'ready') {
        if (order.status !== 'ready') {
            nextStatus = 'ready';
            db.prepare('UPDATE orders SET status = ?, ready_at = ?, served_at = NULL, updated_at = ? WHERE id = ?').run(nextStatus, nowStr, nowStr, orderId);
        }
    }
    else if (derived === 'preparing') {
        if (order.status !== 'preparing') {
            nextStatus = 'preparing';
            db.prepare('UPDATE orders SET status = ?, cooking_started_at = COALESCE(cooking_started_at, ?), ready_at = NULL, served_at = NULL, updated_at = ? WHERE id = ?').run(nextStatus, nowStr, nowStr, orderId);
        }
    }
    else if (derived === 'pending') {
        if (order.status === 'ready' || order.status === 'served') {
            nextStatus = 'preparing';
            db.prepare('UPDATE orders SET status = ?, cooking_started_at = COALESCE(cooking_started_at, ?), ready_at = NULL, served_at = NULL, updated_at = ? WHERE id = ?').run(nextStatus, nowStr, nowStr, orderId);
        }
    }
    if (nextStatus === null) {
        return { changed: false, previousStatus: order.status, status: order.status };
    }
    (0, db_1.recordOrderAudit)(db, {
        orderId,
        actorUserId,
        action: 'status_changed',
        details: {
            from: order.status,
            to: nextStatus,
            source: 'kds_reconciliation',
        },
    });
    return {
        changed: true,
        previousStatus: order.status,
        status: nextStatus,
    };
}
//# sourceMappingURL=orders.js.map