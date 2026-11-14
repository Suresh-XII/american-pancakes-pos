"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.billRoutes = exports.PIN_WINDOW_MS = exports.PIN_MAX_ATTEMPTS = exports.withPinVerificationLock = exports.resetPinRateLimitForTests = exports.clearPinRateLimit = exports.isPinRateLimited = exports.checkPinRateLimit = void 0;
exports.preVerifyKitchenDeliveryPin = preVerifyKitchenDeliveryPin;
exports.checkKitchenDeliveryStatus = checkKitchenDeliveryStatus;
exports.getTenantCurrency = getTenantCurrency;
exports.addBillLoyaltyFields = addBillLoyaltyFields;
exports.projectOrderItems = projectOrderItems;
exports.getOrderWithItems = getOrderWithItems;
exports.getOrdersWithItemsForBills = getOrdersWithItemsForBills;
exports.createOrSyncBillForOrder = createOrSyncBillForOrder;
exports.allocateMinorUnits = allocateMinorUnits;
exports.allocateSignedMinorUnits = allocateSignedMinorUnits;
exports.reconcileSnapshotAllocations = reconcileSnapshotAllocations;
exports.allocateTaxSnapshots = allocateTaxSnapshots;
exports.syncUnpaidBillsForOrder = syncUnpaidBillsForOrder;
exports.paymentAmountMinorUnits = paymentAmountMinorUnits;
exports.paymentAmountCents = paymentAmountCents;
exports.flushPendingExactBalanceAutomations = flushPendingExactBalanceAutomations;
exports.handlePostPaymentRelease = handlePostPaymentRelease;
exports.queuePostPaymentRelease = queuePostPaymentRelease;
exports.reconcileOrderSettlement = reconcileOrderSettlement;
exports.completeExactBalanceSettlement = completeExactBalanceSettlement;
exports.paymentMethodCorrectionEligibility = paymentMethodCorrectionEligibility;
const crypto_1 = require("crypto");
const express_1 = require("express");
const db_1 = require("../db");
const async_handler_1 = require("../middleware/async-handler");
const kds_1 = require("../services/kds");
const receipt_1 = require("../services/receipt");
const checkout_inventory_1 = require("../services/checkout-inventory");
const promotions_1 = require("../services/promotions");
const cloud_sync_1 = require("../services/cloud-sync");
const whatsapp = __importStar(require("../services/whatsapp"));
const authorization_1 = require("../services/authorization");
const role_permissions_1 = require("../../shared/role-permissions");
const order_item_status_1 = require("../../shared/order-item-status");
const scheduled_orders_1 = require("../services/scheduled-orders");
const shift_session_gate_1 = require("../services/shift-session-gate");
const cash_drawer_movements_1 = require("../services/cash-drawer-movements");
const countries_1 = require("../countries");
const security_1 = require("../middleware/security");
Object.defineProperty(exports, "checkPinRateLimit", { enumerable: true, get: function () { return security_1.checkPinRateLimit; } });
Object.defineProperty(exports, "isPinRateLimited", { enumerable: true, get: function () { return security_1.isPinRateLimited; } });
Object.defineProperty(exports, "clearPinRateLimit", { enumerable: true, get: function () { return security_1.clearPinRateLimit; } });
Object.defineProperty(exports, "resetPinRateLimitForTests", { enumerable: true, get: function () { return security_1.resetPinRateLimitForTests; } });
Object.defineProperty(exports, "withPinVerificationLock", { enumerable: true, get: function () { return security_1.withPinVerificationLock; } });
Object.defineProperty(exports, "PIN_MAX_ATTEMPTS", { enumerable: true, get: function () { return security_1.PIN_MAX_ATTEMPTS; } });
Object.defineProperty(exports, "PIN_WINDOW_MS", { enumerable: true, get: function () { return security_1.PIN_WINDOW_MS; } });
const decimal_js_1 = __importDefault(require("decimal.js"));
const tax_1 = require("../services/tax");
const tax_engine_1 = require("../services/tax-engine");
const orders_1 = require("../services/orders");
const charges_1 = require("../services/charges");
const telemetry_1 = require("../services/telemetry");
const operation_failure_1 = require("../lib/operation-failure");
const countries_2 = require("../countries");
const router = (0, express_1.Router)();
function structuredBillFailure(req, capturePoint, error, displayCode, outcome = 'not_applied') {
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
        /* Diagnostics must not affect billing. */
    }
    const responseDisplayCode = capturePoint === 'fc.backend.payment.create.validation' &&
        displayCode === 'card_transaction_id_required'
        ? displayCode
        : failure.facts.display_code;
    return {
        error,
        reason_code: failure.reason_code,
        operation: failure.operation,
        stage: failure.stage,
        classification: failure.classification,
        outcome: failure.outcome,
        correlation_id: failure.correlation_id,
        ...(responseDisplayCode ? { display_code: responseDisplayCode } : {}),
    };
}
function paymentValidationError(message, displayCode, statusCode = 400) {
    return Object.assign(new Error(message), { statusCode, displayCode });
}
async function preVerifyKitchenDeliveryPin(db, overridePin, clientIp = 'unknown', approverId) {
    if (overridePin === undefined || overridePin === null || overridePin === '') {
        return null;
    }
    const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
    const rateLimitKey = `pin:${canonicalIp}:kitchen-delivery`;
    if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
        throw Object.assign(new Error('Too many PIN attempts. Try again in 15 minutes.'), {
            statusCode: 429,
        });
    }
    if (typeof overridePin !== 'string' || !/^\d{4,6}$/.test(overridePin)) {
        (0, security_1.checkPinRateLimit)(rateLimitKey);
        throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
    }
    const explicitApproverId = approverId !== undefined && approverId !== null && String(approverId).trim() !== ''
        ? String(approverId).trim()
        : null;
    return (0, security_1.withPinVerificationLock)(rateLimitKey, async () => {
        if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
            throw Object.assign(new Error('Too many PIN attempts. Try again in 15 minutes.'), {
                statusCode: 429,
            });
        }
        if (explicitApproverId) {
            const candidate = db
                .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager') AND is_active = 1 AND pin_hash IS NOT NULL")
                .get(explicitApproverId);
            if (!candidate ||
                candidate.is_active !== 1 ||
                !candidate.pin_hash ||
                !(0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) ||
                !(await (0, db_1.verifyPinAsync)(candidate.pin_hash, overridePin))) {
                (0, security_1.checkPinRateLimit)(rateLimitKey);
                throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
            }
            (0, security_1.clearPinRateLimit)(rateLimitKey);
            return { id: candidate.id, verifiedPinHash: candidate.pin_hash };
        }
        const managers = db
            .prepare("SELECT id, role, pin_hash FROM users WHERE role IN ('owner', 'manager') AND pin_hash IS NOT NULL AND is_active = 1")
            .all();
        for (const user of managers) {
            if ((0, role_permissions_1.hasRole)(user.role, role_permissions_1.ROLE_ACCESS.ownerManager)) {
                if (await (0, db_1.verifyPinAsync)(user.pin_hash, overridePin)) {
                    (0, security_1.clearPinRateLimit)(rateLimitKey);
                    return { id: user.id, verifiedPinHash: user.pin_hash };
                }
            }
        }
        (0, security_1.checkPinRateLimit)(rateLimitKey);
        throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
    });
}
function checkKitchenDeliveryStatus(db, orderId, overridePin, clientIp = 'unknown', billId, preVerifiedManager, approverId) {
    const setting = db
        .prepare("SELECT value FROM settings WHERE key = 'require_kitchen_delivered_before_settlement'")
        .get();
    const kdsEnabled = db.prepare("SELECT value FROM settings WHERE key = 'kds_enabled'").get();
    const billingType = db.prepare("SELECT value FROM settings WHERE key = 'billing_type'").get();
    if (setting?.value !== 'true' ||
        kdsEnabled?.value === 'false' ||
        billingType?.value === 'prepaid') {
        return { allowed: true, count: 0, items: [] };
    }
    const orderReleaseRow = db
        .prepare('SELECT release_status FROM orders WHERE id = ?')
        .get(orderId);
    if ((0, scheduled_orders_1.isUnreleasedOrderRow)(orderReleaseRow)) {
        return { allowed: true, count: 0, items: [] };
    }
    const hasBillItems = billId !== undefined &&
        db.prepare('SELECT 1 FROM bill_items WHERE bill_id = ? LIMIT 1').get(billId);
    const undeliveredItems = hasBillItems
        ? db
            .prepare(`
        SELECT oi.product_name FROM bill_items bi
        JOIN order_items oi ON oi.id = bi.order_item_id
        WHERE bi.bill_id = ? AND bi.quantity > 0 AND oi.order_id = ?
          AND oi.status IN ('pending', 'preparing', 'ready')
      `)
            .all(billId, orderId)
        : db
            .prepare(`
        SELECT product_name FROM order_items
        WHERE order_id = ? AND status IN ('pending', 'preparing', 'ready')
      `)
            .all(orderId);
    if (undeliveredItems.length === 0)
        return { allowed: true, count: 0, items: [] };
    const items = undeliveredItems.map((item) => item.product_name);
    if (overridePin === undefined || overridePin === null || overridePin === '') {
        return { allowed: false, count: items.length, items };
    }
    const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
    const rateLimitKey = `pin:${canonicalIp}:kitchen-delivery`;
    if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
        throw Object.assign(new Error('Too many PIN attempts. Try again in 15 minutes.'), {
            statusCode: 429,
        });
    }
    if (typeof overridePin !== 'string' || !/^\d{4,6}$/.test(overridePin)) {
        (0, security_1.checkPinRateLimit)(rateLimitKey);
        throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
    }
    const explicitApproverId = approverId !== undefined && approverId !== null && String(approverId).trim() !== ''
        ? String(approverId).trim()
        : null;
    let manager;
    if (preVerifiedManager) {
        if (!explicitApproverId || String(preVerifiedManager.id) === explicitApproverId) {
            const candidate = db
                .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager') AND is_active = 1 AND pin_hash IS NOT NULL")
                .get(preVerifiedManager.id);
            if (candidate &&
                candidate.is_active === 1 &&
                (0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                candidate.pin_hash === preVerifiedManager.verifiedPinHash) {
                manager = candidate;
            }
        }
    }
    else if (explicitApproverId) {
        const candidate = db
            .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager') AND is_active = 1 AND pin_hash IS NOT NULL")
            .get(explicitApproverId);
        if (candidate &&
            candidate.is_active === 1 &&
            (0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
            (0, db_1.verifyPin)(candidate.pin_hash, overridePin)) {
            manager = candidate;
        }
    }
    else {
        const managers = db
            .prepare("SELECT id, role, pin_hash FROM users WHERE role IN ('owner', 'manager') AND pin_hash IS NOT NULL AND is_active = 1")
            .all();
        manager = managers.find((user) => (0, role_permissions_1.hasRole)(user.role, role_permissions_1.ROLE_ACCESS.ownerManager) && (0, db_1.verifyPin)(user.pin_hash, overridePin));
    }
    if (!manager) {
        (0, security_1.checkPinRateLimit)(rateLimitKey);
        throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
    }
    (0, security_1.clearPinRateLimit)(rateLimitKey);
    return { allowed: true, count: items.length, items, overridden: true, managerUserId: manager.id };
}
function getTenantCurrency() {
    // '' rather than a default country code: resolveTenantCurrency throws
    // RegionalNotConfiguredError on an unresolvable country instead of
    // silently defaulting, which is what we want if this is ever actually null.
    return (0, countries_2.resolveTenantCurrency)((0, db_1.getSettingValue)('currency'), (0, db_1.getSettingValue)('country') || '');
}
function addBillLoyaltyFields(db, bill) {
    if (!bill?.customer_id)
        return bill;
    const earned = db
        .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger WHERE bill_id = ? AND type = 'credit'`)
        .get(bill.id);
    const redeemed = db
        .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger WHERE bill_id = ? AND type = 'debit'`)
        .get(bill.id);
    const loyaltyEnabled = ['true', '1'].includes((0, db_1.getSettingValue)('loyalty_enabled') || '');
    let pointsBalance = null;
    if (loyaltyEnabled) {
        const credits = db
            .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger WHERE customer_id = ? AND type = 'credit'`)
            .get(bill.customer_id);
        const debits = db
            .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger WHERE customer_id = ? AND type = 'debit'`)
            .get(bill.customer_id);
        pointsBalance = Math.max(0, Number(credits.total) - Number(debits.total));
    }
    return {
        ...bill,
        points_earned: Number(earned.total) || 0,
        points_redeemed: Number(redeemed.total) || 0,
        points_balance: pointsBalance,
    };
}
function scaleTaxBreakdown(raw, ratio, ownerWeights, childIndex = 0, sourceTaxMinor, minorFactor = 100) {
    if (ownerWeights && ownerWeights.length > 0) {
        return allocateTaxBreakdownForChild(raw, ownerWeights, childIndex, sourceTaxMinor, minorFactor);
    }
    const ratioDec = decimal_js_1.default.isDecimal(ratio) ? ratio : new decimal_js_1.default(ratio);
    if (raw === null || raw === undefined || ratioDec.eq(1))
        return raw;
    const wasString = typeof raw === 'string';
    let parsed = raw;
    if (wasString) {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return raw;
        }
    }
    const decimals = Math.log10(minorFactor);
    const scale = (value) => {
        if (Array.isArray(value))
            return value.map(scale);
        if (!value || typeof value !== 'object')
            return value;
        const result = { ...value };
        if (Object.prototype.hasOwnProperty.call(result, 'amount')) {
            const amount = Number(result.amount);
            if (Number.isFinite(amount)) {
                const scaled = new decimal_js_1.default(amount)
                    .mul(ratioDec)
                    .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP)
                    .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP)
                    .toNumber();
                result.amount = typeof value.amount === 'string' ? scaled.toFixed(decimals) : scaled;
            }
        }
        return result;
    };
    const scaled = scale(parsed);
    return wasString ? JSON.stringify(scaled) : scaled;
}
function getTaxDiscountRatioDecimal(subtotal, discountAmount) {
    const base = Number(subtotal || 0);
    if (!Number.isFinite(base) || base <= 0)
        return new decimal_js_1.default(1);
    const baseDec = new decimal_js_1.default((subtotal || 0));
    const rawDiscount = Number(discountAmount || 0);
    const discountDec = decimal_js_1.default.max(0, decimal_js_1.default.min(new decimal_js_1.default(Number.isFinite(rawDiscount) ? (discountAmount || 0) : 0), baseDec));
    return (0, tax_1.computeDiscountTaxRatio)(baseDec.minus(discountDec), baseDec);
}
function getTaxDiscountRatio(subtotal, discountAmount) {
    return getTaxDiscountRatioDecimal(subtotal, discountAmount).toNumber();
}
function projectOrderItems(order, rawItemRows, allocations = [], childItemAllocations = new Map(), minorFactor = 100) {
    const allocated = new Map(allocations.map((row) => [Number(row.order_item_id), Number(row.quantity)]));
    const taxDiscountRatioDec = getTaxDiscountRatioDecimal(order?.subtotal, order?.discount_amount);
    const decimals = Math.log10(minorFactor);
    const docOutputByItem = new Map();
    if (!taxDiscountRatioDec.eq(1)) {
        const parsedOrderSnap = parseTaxSnapshot(order?.tax_snapshot);
        const orderSnapEntries = Array.isArray(parsedOrderSnap)
            ? parsedOrderSnap
            : parsedOrderSnap
                ? [parsedOrderSnap]
                : [];
        const nonChargeSnapEntries = orderSnapEntries.filter((entry) => Boolean(entry) &&
            typeof entry === 'object' &&
            typeof entry.chargeKind !== 'string' &&
            Array.isArray(entry.lines) &&
            entry.lines.length > 0);
        const toSavedDocOutput = (snap) => {
            const lines = snap.lines;
            if (!Array.isArray(lines) || lines.length === 0) {
                return null;
            }
            const line = lines[0];
            const components = line?.components;
            if (!line || !Array.isArray(components))
                return null;
            const lineTax = components.reduce((sum, c) => sum.plus(new decimal_js_1.default(c.amount || 0)), new decimal_js_1.default(0));
            return {
                handled: true,
                taxAmount: lineTax.toNumber(),
                breakdown: components.map((c) => ({
                    title: String(c.label ?? c.title ?? c.name ?? ''),
                    rate: Number(c.rate ?? c.amountPer ?? 0),
                    amount: Number(c.amount || 0),
                })),
                snapshotJson: JSON.stringify(snap),
            };
        };
        const itemById = new Map(rawItemRows
            .filter((item) => item?.id !== undefined && item?.id !== null)
            .map((item) => [String(item.id), item]));
        for (const snap of nonChargeSnapEntries) {
            const lines = snap.lines;
            const lineId = String(lines?.[0]?.lineId || '');
            const idMatch = /^line-\d+:(.+)$/.exec(lineId);
            if (idMatch) {
                const matchedItem = itemById.get(idMatch[1]);
                const out = matchedItem ? toSavedDocOutput(snap) : null;
                if (matchedItem && out)
                    docOutputByItem.set(matchedItem, out);
            }
        }
        const billSnapshotItems = rawItemRows.filter((item) => !(0, order_item_status_1.isExcludedFromBillReceipt)(item?.status) && hasSnapshotLines(item?.tax_snapshot));
        if (docOutputByItem.size === 0 && nonChargeSnapEntries.length === billSnapshotItems.length) {
            billSnapshotItems.forEach((item, idx) => {
                const out = toSavedDocOutput(nonChargeSnapEntries[idx]);
                if (out)
                    docOutputByItem.set(item, out);
            });
        }
        if (docOutputByItem.size === 0 && nonChargeSnapEntries.length === 0) {
            const chargeSnapJson = orderSnapEntries
                .filter((entry) => entry &&
                typeof entry === 'object' &&
                typeof entry.chargeKind === 'string')
                .map((entry) => JSON.stringify(entry));
            const activeItems = rawItemRows.filter((item) => !(0, order_item_status_1.isExcludedFromBillReceipt)(item?.status));
            const docAllocated = (0, tax_1.allocateDocumentTaxRounding)({
                items: activeItems.map((item, idx) => ({
                    snapshot: item.tax_snapshot,
                    lineIdOverride: `line-${String(idx + 1).padStart(4, '0')}:${item.id}`,
                })),
                chargeTaxes: {
                    taxAmount: 0,
                    exclusiveTaxAmount: 0,
                    breakdowns: chargeSnapJson.map(() => []),
                    snapshotJson: chargeSnapJson,
                },
                currency: '',
                minorFactor,
                itemTaxRatio: taxDiscountRatioDec,
            });
            activeItems.forEach((item, idx) => {
                const out = docAllocated.itemOutputs[idx];
                if (out?.handled)
                    docOutputByItem.set(item, out);
            });
        }
    }
    return rawItemRows
        .filter((item) => allocations.length === 0 || allocated.has(Number(item.id)))
        .map((item) => {
        const quantity = allocated.get(Number(item.id));
        const originalQuantity = Number(item.quantity);
        const quantityRatio = quantity === undefined || originalQuantity <= 0 ? 1 : quantity / originalQuantity;
        const ownerAllocation = childItemAllocations.get(Number(item.id));
        const docOut = docOutputByItem.get(item);
        const sourceTaxMinor = docOut
            ? Math.round(docOut.taxAmount * minorFactor)
            : new decimal_js_1.default(item.tax_amount || 0)
                .mul(taxDiscountRatioDec)
                .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP)
                .mul(minorFactor)
                .toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP)
                .toNumber();
        const taxMinor = ownerAllocation
            ? allocateSignedMinorUnits(sourceTaxMinor, ownerAllocation.weights)[ownerAllocation.index]
            : Math.round(sourceTaxMinor * quantityRatio);
        const hasSnapshot = hasSnapshotLines(item.tax_snapshot);
        const scaledBreakdown = docOut
            ? typeof item.tax_breakdown === 'string'
                ? JSON.stringify(docOut.breakdown)
                : docOut.breakdown
            : hasSnapshot
                ? item.tax_breakdown
                : scaleTaxBreakdown(item.tax_breakdown, taxDiscountRatioDec, undefined, 0, undefined, minorFactor);
        const taxBreakdown = ownerAllocation
            ? scaleTaxBreakdown(scaledBreakdown, 1, ownerAllocation.weights, ownerAllocation.index, sourceTaxMinor, minorFactor)
            : scaleTaxBreakdown(scaledBreakdown, quantityRatio, undefined, 0, undefined, minorFactor);
        const discountedSnapshot = docOut
            ? typeof item.tax_snapshot === 'string'
                ? docOut.snapshotJson
                : docOut.snapshotJson
                    ? JSON.parse(docOut.snapshotJson)
                    : null
            : item.tax_snapshot;
        const taxSnapshot = ownerAllocation || !hasSnapshot || (taxDiscountRatioDec.eq(1) && quantityRatio === 1)
            ? item.tax_snapshot
            : docOut
                ? quantityRatio === 1
                    ? discountedSnapshot
                    : (0, tax_1.scaleTaxSnapshots)([docOut.snapshotJson], quantityRatio, minorFactor)[0] || null
                : (0, tax_1.scaleTaxSnapshots)([
                    typeof item.tax_snapshot === 'string'
                        ? item.tax_snapshot
                        : JSON.stringify(item.tax_snapshot),
                ], taxDiscountRatioDec.mul(quantityRatio), minorFactor)[0] || null;
        if (quantity === undefined && taxDiscountRatioDec.eq(1) && !ownerAllocation)
            return item;
        return {
            ...item,
            ...(quantity === undefined ? {} : { quantity }),
            subtotal: Number((Number(item.subtotal) * quantityRatio).toFixed(decimals)),
            tax_amount: taxMinor / minorFactor,
            tax_breakdown: taxBreakdown,
            tax_snapshot: taxSnapshot,
            total: Number((Number(item.total) * quantityRatio).toFixed(decimals)),
        };
    });
}
function childAllocationsForBills(bills, billItems, billId) {
    const childIds = bills.map((bill) => Number(bill.id));
    const childIdSet = new Set(childIds);
    const index = childIds.indexOf(billId);
    if (index === -1)
        return new Map();
    const quantities = new Map();
    for (const row of billItems.filter((row) => childIdSet.has(Number(row.bill_id)))) {
        const itemId = Number(row.order_item_id);
        const weights = quantities.get(itemId) || new Array(childIds.length).fill(0);
        weights[childIds.indexOf(Number(row.bill_id))] = Number(row.quantity);
        quantities.set(itemId, weights);
    }
    return new Map(Array.from(quantities.entries()).map(([itemId, weights]) => [itemId, { weights, index }]));
}
function getPersistedChildTaxBreakdowns(sourceRaw, sourceItems) {
    const parsed = parseTaxSnapshot(sourceRaw);
    if (!Array.isArray(parsed) || !Array.isArray(parsed[0]))
        return new Map();
    const result = new Map();
    let itemIndex = 0;
    for (const breakdown of parsed) {
        while (itemIndex < sourceItems.length) {
            const item = sourceItems[itemIndex++];
            if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(item.status))
                continue;
            const itemBreakdown = parseTaxSnapshot(item.tax_breakdown);
            if (!Array.isArray(itemBreakdown) || itemBreakdown.length === 0)
                continue;
            result.set(Number(item.id), breakdown);
            break;
        }
    }
    return result;
}
function taxBreakdownMinorTotal(raw, minorFactor = 100) {
    const parsed = parseTaxSnapshot(raw);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.reduce((sum, entry) => {
        if (Array.isArray(entry))
            return sum + taxBreakdownMinorTotal(entry, minorFactor);
        const amount = Number(entry?.amount);
        return Number.isFinite(amount) ? sum + Math.round(amount * minorFactor) : sum;
    }, 0);
}
function applyPersistedChildTaxBreakdowns(projectedItems, sourceItems, sourceRaw, minorFactor = 100) {
    const childBreakdowns = getPersistedChildTaxBreakdowns(sourceRaw, sourceItems);
    if (childBreakdowns.size === 0)
        return projectedItems;
    return projectedItems.map((item) => {
        if (hasSnapshotLines(item.tax_snapshot))
            return item;
        const breakdown = childBreakdowns.get(Number(item.id));
        if (breakdown === undefined)
            return item;
        return {
            ...item,
            tax_breakdown: [breakdown],
            tax_amount: taxBreakdownMinorTotal(breakdown, minorFactor) / minorFactor,
        };
    });
}
function selectRowsByIds(db, ids, queryForCount) {
    const rows = [];
    for (let offset = 0; offset < ids.length; offset += 400) {
        const chunk = ids.slice(offset, offset + 400);
        rows.push(...db.prepare(queryForCount(chunk.length)).all(...chunk));
    }
    return rows;
}
function getOrderWithItems(db, orderId, billId) {
    const order = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId));
    if (!order)
        return order;
    const allocations = billId === undefined
        ? []
        : db
            .prepare('SELECT order_item_id, quantity FROM bill_items WHERE bill_id = ?')
            .all(billId);
    let childItemAllocations = new Map();
    let persistedTaxBreakdown = null;
    if (billId !== undefined) {
        const bill = db
            .prepare('SELECT split_group_id, tax_breakdown FROM bills WHERE id = ?')
            .get(billId);
        persistedTaxBreakdown = bill?.tax_breakdown;
        if (bill?.split_group_id) {
            const childBills = db
                .prepare('SELECT id FROM bills WHERE split_group_id = ? ORDER BY id')
                .all(bill.split_group_id);
            const childIds = childBills.map((child) => Number(child.id));
            const childRows = childIds.length === 0
                ? []
                : db
                    .prepare(`SELECT bill_id, order_item_id, quantity FROM bill_items WHERE bill_id IN (${childIds.map(() => '?').join(',')})`)
                    .all(...childIds);
            childItemAllocations = childAllocationsForBills(childBills, childRows, Number(billId));
        }
    }
    const itemRows = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(getTenantCurrency());
    const projectedItems = projectOrderItems(order, itemRows, allocations, childItemAllocations, minorFactor);
    const childScopedItems = billId === undefined
        ? projectedItems
        : applyPersistedChildTaxBreakdowns(projectedItems, itemRows, persistedTaxBreakdown, minorFactor);
    const hydratedItems = (0, db_1.attachEffectiveAddons)(db, childScopedItems.map(db_1.parseItemJson)).map((item) => {
        const summary = db.prepare(`
      SELECT s.serving_type, COALESCE(SUM(p.quantity), 0) AS packaging_quantity
      FROM order_item_serving_allocations s
      LEFT JOIN order_item_packaging_allocations p ON p.serving_allocation_id = s.id
      WHERE s.order_item_id = ? GROUP BY s.serving_type
    `).all(item.id);
        if (summary.length === 0)
            return item;
        const text = summary.map((row) => row.serving_type === 'dine_in'
            ? `Dine-in / Regular — paper plates: ${row.packaging_quantity}`
            : `Parcel / Takeaway — parcel boxes: ${row.packaging_quantity}`).join('; ');
        return { ...item, serving_summary: text };
    });
    const table = order.table_id
        ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id)
        : null;
    return {
        ...order,
        items: hydratedItems,
        ...(table ? { table: { name: table.number } } : {}),
    };
}
function getOrdersWithItemsForBills(db, bills) {
    const result = new Map();
    if (bills.length === 0)
        return result;
    const orderIds = Array.from(new Set(bills.map((bill) => Number(bill.order_id))));
    const orderRows = selectRowsByIds(db, orderIds, (count) => `SELECT * FROM orders WHERE id IN (${new Array(count).fill('?').join(',')})`);
    const orders = new Map(orderRows.map((row) => [Number(row.id), (0, db_1.parseRowJson)(row)]));
    const itemRows = selectRowsByIds(db, orderIds, (count) => `SELECT * FROM order_items WHERE order_id IN (${new Array(count).fill('?').join(',')}) ORDER BY id`);
    const itemsByOrder = new Map();
    for (const item of itemRows) {
        const items = itemsByOrder.get(Number(item.order_id)) || [];
        items.push(item);
        itemsByOrder.set(Number(item.order_id), items);
    }
    const billIds = bills.map((bill) => Number(bill.id));
    const reportBillItems = selectRowsByIds(db, billIds, (count) => `SELECT bill_id, order_item_id, quantity FROM bill_items WHERE bill_id IN (${new Array(count).fill('?').join(',')})`);
    const splitGroupIds = Array.from(new Set(bills.map((bill) => bill.split_group_id).filter(Boolean)));
    const siblingBills = splitGroupIds.length === 0
        ? []
        : selectRowsByIds(db, splitGroupIds, (count) => `SELECT id, order_id, split_group_id FROM bills WHERE split_group_id IN (${new Array(count).fill('?').join(',')}) ORDER BY split_group_id, id`);
    const allBillIds = Array.from(new Set([...billIds, ...siblingBills.map((bill) => Number(bill.id))]));
    const allBillItems = selectRowsByIds(db, allBillIds, (count) => `SELECT bill_id, order_item_id, quantity FROM bill_items WHERE bill_id IN (${new Array(count).fill('?').join(',')})`);
    const billItemsByBill = new Map();
    for (const row of reportBillItems) {
        const rows = billItemsByBill.get(Number(row.bill_id)) || [];
        rows.push(row);
        billItemsByBill.set(Number(row.bill_id), rows);
    }
    const siblingsByGroup = new Map();
    for (const bill of siblingBills) {
        const groupBills = siblingsByGroup.get(String(bill.split_group_id)) || [];
        groupBills.push(bill);
        siblingsByGroup.set(String(bill.split_group_id), groupBills);
    }
    const projected = new Map();
    const addonItems = new Map();
    for (const bill of bills) {
        const order = orders.get(Number(bill.order_id));
        if (!order)
            continue;
        const groupBills = bill.split_group_id
            ? siblingsByGroup.get(String(bill.split_group_id)) || []
            : [];
        const allocations = billItemsByBill.get(Number(bill.id)) || [];
        const itemAllocations = groupBills.length > 0
            ? childAllocationsForBills(groupBills, allBillItems, Number(bill.id))
            : new Map();
        const rawItems = itemsByOrder.get(Number(bill.order_id)) || [];
        const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(getTenantCurrency());
        const projectedItems = projectOrderItems(order, rawItems, allocations, itemAllocations, minorFactor);
        const items = applyPersistedChildTaxBreakdowns(projectedItems, rawItems, bill.tax_breakdown, minorFactor).map(db_1.parseItemJson);
        items.forEach((item) => addonItems.set(Number(item.id), item));
        projected.set(Number(bill.id), { ...order, items });
    }
    const hydratedAddons = (0, db_1.attachEffectiveAddons)(db, Array.from(addonItems.values()));
    const addonsByItem = new Map(hydratedAddons.map((item) => [Number(item.id), item.addons]));
    for (const [billId, order] of projected) {
        order.items = order.items.map((item) => ({
            ...item,
            addons: addonsByItem.get(Number(item.id)) || [],
        }));
        result.set(billId, order);
    }
    return result;
}
// Loyalty points are 1:1 with currency units — earning and redemption both
// use this rate so a customer's point balance always equals its currency value.
const LOYALTY_REDEMPTION_RATE = 1;
function parsePaginationInteger(value, defaultValue) {
    if (value === undefined || value === null || value === '')
        return defaultValue;
    if (Array.isArray(value))
        return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed))
        return null;
    return parsed;
}
router.get('/', (0, authorization_1.requirePermission)('bills.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let query = 'SELECT * FROM bills WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as count FROM bills WHERE 1=1';
        const params = [];
        if (req.query.status) {
            query += ' AND payment_status = ?';
            countQuery += ' AND payment_status = ?';
            params.push(req.query.status);
        }
        if (req.query.order_id) {
            query += ' AND order_id = ?';
            countQuery += ' AND order_id = ?';
            params.push(req.query.order_id);
        }
        if (req.query.customer_id) {
            query += ' AND customer_id = ?';
            countQuery += ' AND customer_id = ?';
            params.push(req.query.customer_id);
        }
        if (req.query.today === 'true') {
            // #208: UTC-day range hits `idx_bills_created_at` instead of date() on every row.
            const [s, e] = (0, db_1.utcDayBounds)((0, db_1.utcTodayDate)());
            query += ' AND created_at >= ? AND created_at < ?';
            countQuery += ' AND created_at >= ? AND created_at < ?';
            params.push(s, e);
        }
        // Limit page size with a default of 50 and maximum cap of 500.
        const requestedLimit = parsePaginationInteger(req.query.per_page ?? req.query.limit, 50);
        if (requestedLimit === null || requestedLimit < 1) {
            return res.status(400).json({ error: 'per_page must be a positive integer' });
        }
        const limit = Math.min(requestedLimit, 500);
        const offset = parsePaginationInteger(req.query.offset, 0);
        if (offset === null || offset < 0) {
            return res.status(400).json({ error: 'offset must be a non-negative integer' });
        }
        query += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
        const pageParams = [...params, limit, offset];
        const bills = db
            .prepare(query)
            .all(...pageParams)
            .map(db_1.parseRowJson);
        const total = Number(db.prepare(countQuery).get(...params)?.count || 0);
        res.json({
            bills,
            pagination: {
                limit,
                per_page: limit,
                offset,
                total,
                next_offset: offset + bills.length < total ? offset + bills.length : null,
                has_more: offset + bills.length < total,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/:id', (0, authorization_1.requirePermission)('bills.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const bill = addBillLoyaltyFields(db, (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id)));
        if (!bill) {
            return res.status(404).json({ error: 'Bill not found' });
        }
        const order = getOrderWithItems(db, bill.order_id, Number(bill.id));
        const customer = bill.customer_id
            ? db.prepare('SELECT * FROM customers WHERE id = ?').get(bill.customer_id)
            : null;
        res.json({
            bill: {
                ...bill,
                order,
                customer,
                payment_method_correction: paymentMethodCorrectionEligibility(db, bill),
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get bill by order ID
router.get('/order/:orderId', (0, authorization_1.requirePermission)('bills.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const bill = addBillLoyaltyFields(db, (0, db_1.parseRowJson)(db
            .prepare('SELECT * FROM bills WHERE order_id = ? ORDER BY created_at DESC LIMIT 1')
            .get(req.params.orderId)));
        if (!bill) {
            return res.status(404).json({ error: 'Bill not found for this order' });
        }
        const order = getOrderWithItems(db, bill.order_id, Number(bill.id));
        const customer = bill.customer_id
            ? db.prepare('SELECT * FROM customers WHERE id = ?').get(bill.customer_id)
            : null;
        res.json({
            bill: {
                ...bill,
                order,
                customer,
                payment_method_correction: paymentMethodCorrectionEligibility(db, bill),
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/generate', (0, authorization_1.requirePermission)('bills.generate'), (req, res) => {
    let operationCommitted = false;
    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.generate.validation', 'Order ID is required'));
        }
        const db = (0, db_1.getDatabase)();
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
        if (!order) {
            return res
                .status(404)
                .json(structuredBillFailure(req, 'fc.backend.bill.generate.validation', 'Order not found'));
        }
        const result = (0, db_1.withTxn)(() => {
            const existingBill = db
                .prepare('SELECT * FROM bills WHERE order_id = ?')
                .get(order_id);
            if (existingBill) {
                if (existingBill.split_group_id)
                    return { bill: (0, db_1.parseRowJson)(existingBill), isNew: false };
                // Re-sync unpaid bill totals from order in case discount/adjustments changed.
                const orderSubtotal = order.subtotal || 0;
                const orderTaxAmount = order.tax_amount || 0;
                const orderDiscountAmt = order.discount_amount || 0;
                const orderDelivery = order.delivery_charge || 0;
                const orderPackaging = order.packaging_charge || 0;
                const orderService = order.service_charge || 0;
                const orderTotal = order.total || 0;
                const currency = getTenantCurrency();
                const pack = (0, tax_1.getActiveCountryPack)((0, db_1.getSettingValue)('country') || '');
                const { total: roundedOrderTotal, adjustment: orderRoundOff } = (0, tax_engine_1.applyPayableRounding)(orderTotal, pack, currency);
                const isSyncableStatus = ['unpaid', 'partial', 'partially_paid'].includes(existingBill.payment_status);
                const totalsChanged = isSyncableStatus &&
                    (existingBill.discount_amount !== orderDiscountAmt ||
                        existingBill.subtotal !== orderSubtotal ||
                        existingBill.tax_amount !== orderTaxAmount ||
                        existingBill.delivery_charge !== orderDelivery ||
                        existingBill.packaging_charge !== orderPackaging ||
                        existingBill.service_charge !== orderService ||
                        existingBill.charges_breakdown !== (order.charges_breakdown ?? null) ||
                        existingBill.total !== roundedOrderTotal);
                const paidAmount = Number(existingBill.paid_amount || 0);
                if (totalsChanged) {
                    const newBalance = Math.max(0, roundedOrderTotal - paidAmount);
                    db.prepare(`
            UPDATE bills
            SET subtotal       = ?,
                tax_amount     = ?,
                tax_breakdown  = ?,
                tax_snapshot   = ?,
                discount_amount= ?,
                discount_type  = ?,
                discount_value = ?,
                discount_reason= ?,
                delivery_charge= ?,
                packaging_charge= ?,
                service_charge = ?,
                charges_breakdown = ?,
                round_off      = ?,
                total          = ?,
                balance        = ?,
                updated_at     = ?
            WHERE id = ?
          `).run(orderSubtotal, orderTaxAmount, order.tax_breakdown, order.tax_snapshot, orderDiscountAmt, order.discount_type, order.discount_value, order.discount_reason, orderDelivery, orderPackaging, orderService, order.charges_breakdown ?? null, orderRoundOff, roundedOrderTotal, newBalance, (0, db_1.now)(), existingBill.id);
                    if (newBalance === 0 && paidAmount > 0 && roundedOrderTotal === paidAmount) {
                        const settled = completeExactBalanceSettlement(db, existingBill.id, roundedOrderTotal, currency, (0, db_1.now)());
                        if (settled)
                            return { bill: settled, isNew: false };
                    }
                    const updated = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(existingBill.id));
                    return { bill: updated, isNew: false };
                }
                if (isSyncableStatus &&
                    existingBill.payment_status !== 'unpaid' &&
                    paidAmount > 0 &&
                    roundedOrderTotal === paidAmount) {
                    const settled = completeExactBalanceSettlement(db, existingBill.id, roundedOrderTotal, currency, (0, db_1.now)());
                    if (settled)
                        return { bill: settled, isNew: false };
                }
                return { bill: (0, db_1.parseRowJson)(existingBill), isNew: false };
            }
            // Generate bill number inside transaction to prevent race conditions
            const billNumber = (0, db_1.generateBillNumber)();
            const subtotal = order.subtotal || 0;
            const taxAmount = order.tax_amount || 0;
            const discountAmount = order.discount_amount || 0;
            const deliveryCharge = order.delivery_charge || 0;
            const packagingCharge = order.packaging_charge || 0;
            const serviceCharge = order.service_charge || 0;
            const currency = getTenantCurrency();
            const pack = (0, tax_1.getActiveCountryPack)((0, db_1.getSettingValue)('country') || '');
            const { total, adjustment: roundOff } = (0, tax_engine_1.applyPayableRounding)(order.total || 0, pack, currency);
            const runResult = db
                .prepare(`
        INSERT INTO bills (bill_number, order_id, customer_id, subtotal, tax_amount, tax_breakdown, tax_snapshot,
          discount_amount, discount_type, discount_value, discount_reason,
          delivery_charge, packaging_charge, service_charge, charges_breakdown, round_off, total, paid_amount, balance, payment_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)
      `)
                .run(billNumber, order_id, order.customer_id, subtotal, taxAmount, order.tax_breakdown, order.tax_snapshot, discountAmount, order.discount_type, order.discount_value, order.discount_reason, deliveryCharge, packagingCharge, serviceCharge, order.charges_breakdown ?? null, roundOff, total, 0, total, (0, db_1.now)(), (0, db_1.now)());
            const newBill = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(runResult.lastInsertRowid));
            return { bill: newBill, isNew: true };
        });
        operationCommitted = true;
        flushPendingExactBalanceAutomations();
        (0, kds_1.notifyOrderUpdated)();
        const orderWithItems = getOrderWithItems(db, order_id, Number(result.bill.id));
        res.status(result.isNew ? 201 : 200).json({ bill: { ...result.bill, order: orderWithItems } });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        const statusCode = error.statusCode || 500;
        return res
            .status(statusCode)
            .json(structuredBillFailure(req, operationCommitted
            ? 'fc.backend.bill.generate.completion'
            : 'fc.backend.bill.generate.failure', error.statusCode ? error.message : 'Internal server error', undefined, operationCommitted ? 'applied' : 'unknown'));
    }
});
function createOrSyncBillForOrder(db, orderId) {
    const existingBill = db
        .prepare('SELECT * FROM bills WHERE order_id = ? ORDER BY id ASC LIMIT 1')
        .get(orderId);
    if (existingBill) {
        return (0, db_1.parseRowJson)(existingBill);
    }
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
        throw Object.assign(new Error(`Order ${orderId} not found`), { statusCode: 404 });
    }
    const billNumber = (0, db_1.generateBillNumber)();
    const subtotal = order.subtotal || 0;
    const taxAmount = order.tax_amount || 0;
    const discountAmount = order.discount_amount || 0;
    const deliveryCharge = order.delivery_charge || 0;
    const packagingCharge = order.packaging_charge || 0;
    const serviceCharge = order.service_charge || 0;
    const currency = getTenantCurrency();
    const pack = (0, tax_1.getActiveCountryPack)((0, db_1.getSettingValue)('country') || '');
    const { total, adjustment: roundOff } = (0, tax_engine_1.applyPayableRounding)(order.total || 0, pack, currency);
    const runResult = db
        .prepare(`
    INSERT INTO bills (bill_number, order_id, customer_id, subtotal, tax_amount, tax_breakdown, tax_snapshot,
      discount_amount, discount_type, discount_value, discount_reason,
      delivery_charge, packaging_charge, service_charge, charges_breakdown, round_off, total, paid_amount, balance, payment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)
  `)
        .run(billNumber, orderId, order.customer_id, subtotal, taxAmount, order.tax_breakdown, order.tax_snapshot, discountAmount, order.discount_type, order.discount_value, order.discount_reason, deliveryCharge, packagingCharge, serviceCharge, order.charges_breakdown ?? null, roundOff, total, 0, total, (0, db_1.now)(), (0, db_1.now)());
    return (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(runResult.lastInsertRowid));
}
function allocateMinorUnits(sourceMinor, weights) {
    const n = weights.length;
    if (n === 0)
        return [];
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const effectiveWeights = totalWeight === 0 ? Array(n).fill(1) : weights;
    const effectiveTotalWeight = effectiveWeights.reduce((sum, w) => sum + w, 0);
    const base = new Array(n);
    const remainders = new Array(n);
    let used = 0;
    for (let i = 0; i < n; i++) {
        const exact = (sourceMinor * effectiveWeights[i]) / effectiveTotalWeight;
        const b = Math.floor(exact);
        base[i] = b;
        used += b;
        remainders[i] = { index: i, remainder: exact - b };
    }
    let left = sourceMinor - used;
    remainders.sort((a, b) => {
        if (Math.abs(b.remainder - a.remainder) > 1e-9) {
            return b.remainder - a.remainder;
        }
        return a.index - b.index;
    });
    for (let i = 0; i < left; i++) {
        base[remainders[i].index] += 1;
    }
    return base;
}
// Allocate signed tax adjustments preserving sign with largest-remainder ordering.
function allocateSignedMinorUnits(sourceMinor, weights) {
    const sign = sourceMinor < 0 ? -1 : 1;
    return allocateMinorUnits(Math.abs(sourceMinor), weights).map((minor) => minor * sign);
}
const SPLIT_TAX_SNAPSHOT_VERSION = 'minor-unit-v1';
function parseTaxSnapshot(raw) {
    if (typeof raw !== 'string')
        return raw;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function snapshotMinorAmount(value, minorFactor = 100) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    const amount = Number(value);
    if (!Number.isFinite(amount))
        return null;
    return Math.round(amount * minorFactor);
}
function formatSnapshotMinorAmount(original, minor, minorFactor = 100) {
    const amount = minor / minorFactor;
    return typeof original === 'string' ? amount.toFixed(Math.log10(minorFactor)) : amount;
}
function reconcileSnapshotAllocations(entries, targets) {
    if (entries.length === 0 || targets.length === 0)
        return;
    const sums = targets.map((_, index) => entries.reduce((sum, entry) => sum + entry.allocations[index], 0));
    const deltas = targets.map((target, index) => target - sums[index]);
    while (true) {
        const deficitIndex = deltas.findIndex((delta) => delta > 0);
        const excessIndex = deltas.findIndex((delta) => delta < 0);
        if (deficitIndex === -1 || excessIndex === -1)
            return;
        const positiveEntry = entries.find((entry) => entry.allocations[excessIndex] > 0);
        if (positiveEntry) {
            positiveEntry.allocations[excessIndex] -= 1;
            positiveEntry.allocations[deficitIndex] += 1;
        }
        else {
            const negativeEntry = entries.find((entry) => entry.allocations[deficitIndex] < 0);
            if (!negativeEntry)
                return;
            negativeEntry.allocations[deficitIndex] += 1;
            negativeEntry.allocations[excessIndex] -= 1;
        }
        deltas[excessIndex] += 1;
        deltas[deficitIndex] -= 1;
    }
}
function allocateTaxBreakdownForChild(raw, weights, childIndex, sourceTaxMinor, minorFactor = 100) {
    const parsed = typeof raw === 'string'
        ? (() => {
            try {
                return JSON.parse(raw);
            }
            catch {
                return null;
            }
        })()
        : raw;
    if (!Array.isArray(parsed) || parsed.length === 0)
        return raw;
    const isNested = Array.isArray(parsed[0]);
    const entries = [];
    if (isNested) {
        parsed.forEach((outer, outerIndex) => {
            if (!Array.isArray(outer))
                return;
            outer.forEach((component, innerIndex) => {
                const amount = snapshotMinorAmount(component?.amount, minorFactor);
                if (amount !== null)
                    entries.push({
                        outerIndex,
                        innerIndex,
                        original: component.amount,
                        allocations: allocateSignedMinorUnits(amount, weights),
                    });
            });
        });
    }
    else {
        parsed.forEach((component, innerIndex) => {
            const amount = snapshotMinorAmount(component?.amount, minorFactor);
            if (amount !== null)
                entries.push({
                    innerIndex,
                    original: component.amount,
                    allocations: allocateSignedMinorUnits(amount, weights),
                });
        });
    }
    if (entries.length === 0)
        return raw;
    const target = sourceTaxMinor === undefined
        ? entries.reduce((sum, entry) => sum + snapshotMinorAmount(entry.original, minorFactor), 0)
        : sourceTaxMinor;
    reconcileSnapshotAllocations(entries, allocateSignedMinorUnits(target, weights));
    const cloned = JSON.parse(JSON.stringify(parsed));
    if (isNested) {
        cloned.forEach((outer, outerIndex) => {
            if (!Array.isArray(outer))
                return;
            outer.forEach((component, innerIndex) => {
                const entry = entries.find((candidate) => candidate.outerIndex === outerIndex && candidate.innerIndex === innerIndex);
                if (entry)
                    component.amount = formatSnapshotMinorAmount(entry.original, entry.allocations[childIndex], minorFactor);
            });
        });
    }
    else {
        cloned.forEach((component, innerIndex) => {
            const entry = entries.find((candidate) => candidate.outerIndex === undefined && candidate.innerIndex === innerIndex);
            if (entry)
                component.amount = formatSnapshotMinorAmount(entry.original, entry.allocations[childIndex], minorFactor);
        });
    }
    return typeof raw === 'string' ? JSON.stringify(cloned) : cloned;
}
function allocateTaxSnapshotsWithTax(sourceRaw, weights, snapshotWeights, snapshotExclusions, minorFactor = 100) {
    const parsed = parseTaxSnapshot(sourceRaw);
    const sourceText = typeof sourceRaw === 'string'
        ? sourceRaw
        : parsed === null || parsed === undefined
            ? null
            : JSON.stringify(parsed);
    const snapshots = Array.isArray(parsed) ? parsed : [parsed];
    const hasTaxSnapshots = snapshots.some((snapshot) => snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.lines));
    if (!hasTaxSnapshots) {
        return {
            snapshots: new Array(weights.length).fill(sourceText),
            taxMinors: null,
            exclusiveTaxMinors: null,
        };
    }
    const sourceSnapshots = Array.isArray(parsed) ? parsed : [parsed];
    const entryByKey = new Map();
    const snapshotTaxMinors = new Array(weights.length).fill(0);
    const exclusiveTaxMinors = new Array(weights.length).fill(0);
    sourceSnapshots.forEach((sourceSnapshot, snapshotIndex) => {
        if (!sourceSnapshot ||
            typeof sourceSnapshot !== 'object' ||
            !Array.isArray(sourceSnapshot.lines))
            return;
        if (snapshotExclusions?.[snapshotIndex])
            return;
        const candidateWeights = snapshotWeights?.[snapshotIndex];
        const localWeights = Array.isArray(candidateWeights) && candidateWeights.length === weights.length
            ? candidateWeights
            : weights;
        const snapshotEntries = [];
        sourceSnapshot.lines.forEach((sourceLine, lineIndex) => {
            if (!sourceLine || typeof sourceLine !== 'object')
                return;
            if (Array.isArray(sourceLine.components)) {
                const exclusive = sourceLine.taxBehavior !== 'inclusive' && sourceLine.taxBehavior !== 'exempt';
                sourceLine.components.forEach((sourceComponent, componentIndex) => {
                    if (!sourceComponent || typeof sourceComponent !== 'object')
                        return;
                    const sourceMinor = snapshotMinorAmount(sourceComponent.amount, minorFactor);
                    if (sourceMinor === null)
                        return;
                    const entry = {
                        original: sourceComponent.amount,
                        allocations: allocateSignedMinorUnits(sourceMinor, localWeights),
                        exclusive,
                    };
                    snapshotEntries.push(entry);
                    entryByKey.set(`${snapshotIndex}:${lineIndex}:${componentIndex}`, entry);
                });
            }
            else {
                const sourceMinor = snapshotMinorAmount(sourceLine.taxAmount, minorFactor);
                if (sourceMinor !== null) {
                    const entry = {
                        original: sourceLine.taxAmount,
                        allocations: allocateSignedMinorUnits(sourceMinor, localWeights),
                        exclusive: sourceLine.taxBehavior !== 'inclusive' && sourceLine.taxBehavior !== 'exempt',
                    };
                    snapshotEntries.push(entry);
                    entryByKey.set(`${snapshotIndex}:${lineIndex}:taxAmount`, entry);
                }
            }
        });
        if (snapshotEntries.length > 0) {
            const snapshotTotal = snapshotEntries.reduce((sum, entry) => sum + snapshotMinorAmount(entry.original, minorFactor), 0);
            reconcileSnapshotAllocations(snapshotEntries, allocateSignedMinorUnits(snapshotTotal, localWeights));
            for (let childIndex = 0; childIndex < weights.length; childIndex += 1) {
                snapshotTaxMinors[childIndex] += snapshotEntries.reduce((sum, entry) => sum + entry.allocations[childIndex], 0);
                exclusiveTaxMinors[childIndex] += snapshotEntries.reduce((sum, entry) => sum + (entry.exclusive ? entry.allocations[childIndex] : 0), 0);
            }
        }
    });
    const childSnapshots = weights.map((_, childIndex) => {
        const childResult = JSON.parse(JSON.stringify(parsed));
        const childResultSnapshots = Array.isArray(childResult) ? childResult : [childResult];
        sourceSnapshots.forEach((sourceSnapshot, snapshotIndex) => {
            if (snapshotExclusions?.[snapshotIndex]) {
                childResultSnapshots[snapshotIndex] = null;
                return;
            }
            const childSnapshot = childResultSnapshots[snapshotIndex];
            if (!sourceSnapshot || !childSnapshot || !Array.isArray(sourceSnapshot.lines))
                return;
            childSnapshot.splitAllocation = SPLIT_TAX_SNAPSHOT_VERSION;
            const candidateWeights = snapshotWeights?.[snapshotIndex];
            const localWeights = Array.isArray(candidateWeights) && candidateWeights.length === weights.length
                ? candidateWeights
                : weights;
            sourceSnapshot.lines.forEach((sourceLine, lineIndex) => {
                const line = childSnapshot.lines?.[lineIndex];
                if (!sourceLine || !line || typeof line !== 'object')
                    return;
                for (const field of ['grossAmount', 'taxableBase']) {
                    const sourceMinor = snapshotMinorAmount(sourceLine[field], minorFactor);
                    if (sourceMinor !== null) {
                        line[field] = formatSnapshotMinorAmount(sourceLine[field], allocateSignedMinorUnits(sourceMinor, localWeights)[childIndex], minorFactor);
                    }
                }
            });
        });
        sourceSnapshots.forEach((sourceSnapshot, snapshotIndex) => {
            if (!sourceSnapshot ||
                typeof sourceSnapshot !== 'object' ||
                !Array.isArray(sourceSnapshot.lines))
                return;
            const resultSnapshot = childResultSnapshots[snapshotIndex];
            sourceSnapshot.lines.forEach((sourceLine, lineIndex) => {
                const resultLine = resultSnapshot?.lines?.[lineIndex];
                if (!sourceLine || !resultLine || typeof resultLine !== 'object')
                    return;
                if (Array.isArray(sourceLine.components)) {
                    let componentTotal = 0;
                    let allComponentsAllocated = true;
                    sourceLine.components.forEach((sourceComponent, componentIndex) => {
                        const resultComponent = resultLine.components?.[componentIndex];
                        const entry = entryByKey.get(`${snapshotIndex}:${lineIndex}:${componentIndex}`);
                        if (!resultComponent || !entry) {
                            allComponentsAllocated = false;
                            return;
                        }
                        resultComponent.amount = formatSnapshotMinorAmount(entry.original, entry.allocations[childIndex], minorFactor);
                        componentTotal += entry.allocations[childIndex];
                    });
                    if (allComponentsAllocated) {
                        resultLine.taxAmount = formatSnapshotMinorAmount(sourceLine.taxAmount, componentTotal, minorFactor);
                    }
                }
                else {
                    const entry = entryByKey.get(`${snapshotIndex}:${lineIndex}:taxAmount`);
                    if (entry)
                        resultLine.taxAmount = formatSnapshotMinorAmount(entry.original, entry.allocations[childIndex], minorFactor);
                }
            });
        });
        return JSON.stringify(childResult);
    });
    return { snapshots: childSnapshots, taxMinors: snapshotTaxMinors, exclusiveTaxMinors };
}
function allocateTaxSnapshots(sourceRaw, weights, snapshotWeights, minorFactor = 100) {
    return allocateTaxSnapshotsWithTax(sourceRaw, weights, snapshotWeights, undefined, minorFactor)
        .snapshots;
}
function composeSplitTotals(allocations, exclusiveTaxMinors, otherChargeTotals, minorFactor = 100, decimals = 2) {
    const discountAmount = allocations.discount_amount ?? allocations.discountAmount;
    const deliveryCharge = allocations.delivery_charge ?? allocations.deliveryCharge;
    const packagingCharge = allocations.packaging_charge ?? allocations.packagingCharge;
    const serviceCharge = allocations.service_charge ?? allocations.serviceCharge;
    const roundOff = allocations.round_off ?? allocations.roundOff;
    return allocations.subtotal.map((subtotal, index) => Number((subtotal -
        discountAmount[index] +
        exclusiveTaxMinors[index] / minorFactor +
        deliveryCharge[index] +
        packagingCharge[index] +
        serviceCharge[index] +
        otherChargeTotals[index] +
        roundOff[index]).toFixed(decimals)));
}
function getAllocatedOtherChargeTotals(charges, allocatedChargeMinors, checkCount, minorFactor, decimals) {
    return Array.from({ length: checkCount }, (_, checkIndex) => (0, charges_1.toStandardChargeColumns)(charges.map((charge, chargeIndex) => ({
        ...charge,
        amount: allocatedChargeMinors[chargeIndex][checkIndex] / minorFactor,
    })), decimals).other_charges);
}
function allocateTaxBreakdown(sourceBreakdownRaw, checkTaxMinors, weights, componentWeights, minorFactor = 100) {
    const numChecks = weights.length;
    const parsed = typeof sourceBreakdownRaw === 'string'
        ? (() => {
            try {
                return JSON.parse(sourceBreakdownRaw);
            }
            catch {
                return null;
            }
        })()
        : sourceBreakdownRaw;
    if (!Array.isArray(parsed) || parsed.length === 0) {
        return new Array(numChecks).fill(typeof sourceBreakdownRaw === 'string'
            ? sourceBreakdownRaw
            : JSON.stringify(sourceBreakdownRaw || null));
    }
    const isNested = Array.isArray(parsed[0]);
    const components = [];
    if (isNested) {
        parsed.forEach((outer, outerIndex) => {
            if (Array.isArray(outer)) {
                outer.forEach((comp, innerIndex) => {
                    if (comp && typeof comp === 'object') {
                        components.push({
                            outerIndex,
                            innerIndex,
                            component: comp,
                            minorAmount: Math.round(Number(comp.amount || 0) * minorFactor),
                        });
                    }
                });
            }
        });
    }
    else {
        parsed.forEach((comp, innerIndex) => {
            if (comp && typeof comp === 'object') {
                components.push({
                    innerIndex,
                    component: comp,
                    minorAmount: Math.round(Number(comp.amount || 0) * minorFactor),
                });
            }
        });
    }
    if (components.length === 0) {
        return new Array(numChecks).fill(typeof sourceBreakdownRaw === 'string'
            ? sourceBreakdownRaw
            : JSON.stringify(sourceBreakdownRaw || null));
    }
    const ownerWeightsForComponent = (comp) => {
        const weightIndex = comp.outerIndex === undefined ? comp.innerIndex : comp.outerIndex;
        const candidate = componentWeights?.[weightIndex];
        return candidate &&
            candidate.length === weights.length &&
            candidate.some((weight) => weight > 0)
            ? candidate
            : null;
    };
    const compAllocations = components.map((comp) => {
        const ownerWeights = ownerWeightsForComponent(comp);
        const allocationWeights = ownerWeights &&
            ownerWeights.length === weights.length &&
            ownerWeights.some((weight) => weight > 0)
            ? ownerWeights
            : weights;
        return allocateSignedMinorUnits(comp.minorAmount, allocationWeights);
    });
    const allocationGroups = new Map();
    const flatOwnerAllocations = new Array(numChecks).fill(0);
    components.forEach((comp, index) => {
        const ownerWeights = ownerWeightsForComponent(comp);
        const allocationWeights = ownerWeights &&
            ownerWeights.length === weights.length &&
            ownerWeights.some((weight) => weight > 0)
            ? ownerWeights
            : weights;
        if (comp.outerIndex === undefined && ownerWeights) {
            for (let checkIndex = 0; checkIndex < numChecks; checkIndex += 1) {
                flatOwnerAllocations[checkIndex] += compAllocations[index][checkIndex];
            }
            return;
        }
        const groupKey = comp.outerIndex === undefined ? 'flat' : `outer:${comp.outerIndex}`;
        const group = allocationGroups.get(groupKey) || {
            entries: [],
            weights: allocationWeights,
            sourceMinor: 0,
        };
        group.entries.push({ allocations: compAllocations[index] });
        group.sourceMinor += comp.minorAmount;
        allocationGroups.set(groupKey, group);
    });
    for (const [groupKey, group] of allocationGroups) {
        const target = groupKey === 'flat'
            ? checkTaxMinors.map((targetMinor, index) => targetMinor - flatOwnerAllocations[index])
            : allocateSignedMinorUnits(group.sourceMinor, group.weights);
        reconcileSnapshotAllocations(group.entries, target);
    }
    const result = [];
    for (let k = 0; k < numChecks; k++) {
        if (isNested) {
            const clonedNested = parsed.map((outer, outerIdx) => {
                if (!Array.isArray(outer))
                    return outer;
                return outer.map((comp, innerIdx) => {
                    const compIdx = components.findIndex((c) => c.outerIndex === outerIdx && c.innerIndex === innerIdx);
                    const minor = compIdx !== -1
                        ? compAllocations[compIdx][k]
                        : Math.round(Number(comp?.amount || 0) * minorFactor);
                    return {
                        ...comp,
                        amount: minor / minorFactor,
                    };
                });
            });
            result.push(JSON.stringify(clonedNested));
        }
        else {
            const clonedFlat = parsed.map((comp, innerIdx) => {
                const compIdx = components.findIndex((c) => c.innerIndex === innerIdx);
                const minor = compIdx !== -1
                    ? compAllocations[compIdx][k]
                    : Math.round(Number(comp?.amount || 0) * minorFactor);
                return {
                    ...comp,
                    amount: minor / minorFactor,
                };
            });
            result.push(JSON.stringify(clonedFlat));
        }
    }
    return result;
}
function collectLegacyTaxContribution(items, weights, itemWeights, taxRatio, sourceBreakdownRaw, minorFactor = 100) {
    const taxWeights = new Array(weights.length).fill(0);
    const exclusiveWeights = new Array(weights.length).fill(0);
    const ownerTaxMinors = new Array(weights.length).fill(0);
    const ownerExclusiveTaxMinors = new Array(weights.length).fill(0);
    let ownerTaxSourceMinor = 0;
    let ownerExclusiveTaxSourceMinor = 0;
    let hasCompleteOwnerMinorAllocations = true;
    let exclusiveSourceMinor = 0;
    let allExclusive = true;
    let hasLegacyItems = false;
    const persistedBreakdowns = sourceBreakdownRaw === undefined
        ? new Map()
        : getPersistedChildTaxBreakdowns(sourceBreakdownRaw, items);
    for (const item of items) {
        if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(item.status) ||
            hasSnapshotLines(item.tax_snapshot))
            continue;
        const sourceCents = persistedBreakdowns.has(Number(item.id))
            ? taxBreakdownMinorTotal(persistedBreakdowns.get(Number(item.id)), minorFactor)
            : Number(item.tax_amount || 0) * taxRatio * minorFactor;
        if (!Number.isFinite(sourceCents) || sourceCents === 0)
            continue;
        const ownerWeights = itemWeights(item);
        const effectiveWeights = ownerWeights.some((weight) => weight > 0) ? ownerWeights : weights;
        const totalWeight = effectiveWeights.reduce((sum, weight) => sum + weight, 0);
        if (totalWeight <= 0)
            continue;
        const sourceMinor = Math.round(sourceCents);
        if (Number.isInteger(sourceMinor) && Math.abs(sourceCents - sourceMinor) < 1e-6) {
            const ownerAllocation = allocateSignedMinorUnits(sourceMinor, effectiveWeights);
            for (let index = 0; index < weights.length; index += 1) {
                ownerTaxMinors[index] += ownerAllocation[index];
                if (item.tax_type !== 'inclusive')
                    ownerExclusiveTaxMinors[index] += ownerAllocation[index];
            }
            ownerTaxSourceMinor += sourceMinor;
            if (item.tax_type !== 'inclusive')
                ownerExclusiveTaxSourceMinor += sourceMinor;
        }
        else {
            hasCompleteOwnerMinorAllocations = false;
        }
        const magnitude = Math.abs(sourceCents);
        for (let index = 0; index < weights.length; index += 1) {
            const contribution = (magnitude * effectiveWeights[index]) / totalWeight;
            taxWeights[index] += contribution;
            if (item.tax_type !== 'inclusive')
                exclusiveWeights[index] += contribution;
        }
        if (item.tax_type !== 'inclusive')
            exclusiveSourceMinor += sourceCents;
        else
            allExclusive = false;
        hasLegacyItems = true;
    }
    const hasDocumentLegacyTax = sourceBreakdownRaw !== undefined &&
        taxBreakdownMinorTotal(sourceBreakdownRaw, minorFactor) !== 0;
    return {
        taxWeights,
        exclusiveWeights,
        ownerTaxMinors: hasLegacyItems && hasCompleteOwnerMinorAllocations ? ownerTaxMinors : null,
        ownerExclusiveTaxMinors: hasLegacyItems && hasCompleteOwnerMinorAllocations ? ownerExclusiveTaxMinors : null,
        ownerTaxSourceMinor: hasLegacyItems && hasCompleteOwnerMinorAllocations ? ownerTaxSourceMinor : null,
        ownerExclusiveTaxSourceMinor: hasLegacyItems && hasCompleteOwnerMinorAllocations ? ownerExclusiveTaxSourceMinor : null,
        exclusiveSourceMinor: Math.round(exclusiveSourceMinor),
        allExclusive,
        hasLegacyTaxEvidence: hasLegacyItems || hasDocumentLegacyTax,
    };
}
function allocateLegacyTaxContribution(sourceTaxMinor, snapshotAllocation, contribution, fallbackWeights) {
    const snapshotSourceTaxMinor = snapshotAllocation.taxMinors === null
        ? 0
        : snapshotAllocation.taxMinors.reduce((sum, minor) => sum + minor, 0);
    const legacySourceTaxMinor = snapshotAllocation.taxMinors === null
        ? sourceTaxMinor
        : sourceTaxMinor - snapshotSourceTaxMinor;
    const taxWeights = contribution.taxWeights.some((weight) => weight > 0)
        ? contribution.taxWeights
        : fallbackWeights;
    const ownerTaxSourceMinor = contribution.ownerTaxSourceMinor;
    const ownerTaxFitsResidual = ownerTaxSourceMinor !== null &&
        (ownerTaxSourceMinor === 0 ||
            legacySourceTaxMinor === 0 ||
            Math.sign(ownerTaxSourceMinor) === Math.sign(legacySourceTaxMinor)) &&
        (ownerTaxSourceMinor === 0 || Math.abs(ownerTaxSourceMinor) <= Math.abs(legacySourceTaxMinor));
    const legacyTaxMinors = contribution.ownerTaxMinors !== null && ownerTaxFitsResidual
        ? contribution.ownerTaxMinors.map((minor, index) => minor +
            allocateSignedMinorUnits(legacySourceTaxMinor - ownerTaxSourceMinor, fallbackWeights)[index])
        : allocateSignedMinorUnits(legacySourceTaxMinor, taxWeights);
    const exclusiveSourceMinor = contribution.allExclusive
        ? legacySourceTaxMinor
        : contribution.exclusiveSourceMinor;
    const exclusiveWeights = contribution.exclusiveWeights.some((weight) => weight > 0)
        ? contribution.exclusiveWeights
        : fallbackWeights;
    const ownerExclusiveSourceMinor = contribution.ownerExclusiveTaxSourceMinor;
    const ownerExclusiveFitsResidual = ownerExclusiveSourceMinor !== null &&
        (ownerExclusiveSourceMinor === 0 ||
            exclusiveSourceMinor === 0 ||
            Math.sign(ownerExclusiveSourceMinor) === Math.sign(exclusiveSourceMinor)) &&
        (ownerExclusiveSourceMinor === 0 ||
            Math.abs(ownerExclusiveSourceMinor) <= Math.abs(exclusiveSourceMinor));
    const legacyExclusiveTaxMinors = contribution.hasLegacyTaxEvidence || legacySourceTaxMinor !== 0
        ? contribution.ownerExclusiveTaxMinors !== null && ownerExclusiveFitsResidual
            ? contribution.ownerExclusiveTaxMinors.map((minor, index) => minor +
                allocateSignedMinorUnits(exclusiveSourceMinor - ownerExclusiveSourceMinor, fallbackWeights)[index])
            : allocateSignedMinorUnits(exclusiveSourceMinor, exclusiveWeights)
        : new Array(fallbackWeights.length).fill(0);
    return { legacySourceTaxMinor, legacyTaxMinors, legacyExclusiveTaxMinors };
}
function hasSnapshotLines(raw) {
    const parsed = parseTaxSnapshot(raw);
    return (Array.isArray(parsed) ? parsed : [parsed]).some((snapshot) => snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.lines));
}
function getSplitBillAllocationWeights(db, orderId, bills, legacyTaxRatio = 1, legacyBreakdownRaw, minorFactor = 100) {
    const items = db
        .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
        .all(orderId);
    const billIds = bills.map((bill) => Number(bill.id));
    const billItems = billIds.length === 0
        ? []
        : db
            .prepare(`SELECT bill_id, order_item_id, quantity FROM bill_items WHERE bill_id IN (${billIds.map(() => '?').join(',')})`)
            .all(...billIds);
    const quantities = new Map();
    for (const row of billItems) {
        const byItem = quantities.get(Number(row.bill_id)) || new Map();
        byItem.set(Number(row.order_item_id), Number(row.quantity));
        quantities.set(Number(row.bill_id), byItem);
    }
    const weights = bills.map((bill) => {
        const byItem = quantities.get(Number(bill.id)) || new Map();
        return items
            .filter((item) => !['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(item.status))
            .reduce((sum, item) => {
            const quantity = byItem.get(Number(item.id)) || 0;
            if (quantity <= 0 || Number(item.quantity) <= 0)
                return sum;
            return sum + (Number(item.total || item.subtotal || 0) * quantity) / Number(item.quantity);
        }, 0);
    });
    const snapshotItems = items.filter((item) => !['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(item.status) &&
        hasSnapshotLines(item.tax_snapshot));
    const snapshotWeights = snapshotItems.map((item) => {
        if (['voided', 'void_adjustment'].includes(item.status))
            return null;
        const itemWeights = bills.map((bill) => quantities.get(Number(bill.id))?.get(Number(item.id)) || 0);
        return itemWeights.some((weight) => weight > 0) ? itemWeights : weights;
    });
    const snapshotExclusions = snapshotItems.map((item) => ['voided', 'void_adjustment'].includes(item.status));
    const legacyContribution = collectLegacyTaxContribution(items, weights, (item) => bills.map((bill) => quantities.get(Number(bill.id))?.get(Number(item.id)) || 0), legacyTaxRatio, legacyBreakdownRaw, minorFactor);
    return {
        weights,
        snapshotWeights,
        snapshotExclusions,
        legacyContribution,
    };
}
function getBillItemWeights(db, bills, itemId) {
    const billIds = bills.map((bill) => Number(bill.id));
    if (billIds.length === 0)
        return [];
    const rows = db
        .prepare(`SELECT bill_id, quantity FROM bill_items WHERE order_item_id = ? AND bill_id IN (${billIds.map(() => '?').join(',')})`)
        .all(itemId, ...billIds);
    const quantities = new Map(rows.map((row) => [Number(row.bill_id), Number(row.quantity)]));
    return bills.map((bill) => quantities.get(Number(bill.id)) || 0);
}
function resolveSplitTaxAllocations(sourceTaxMinor, fallbackTaxMinors, snapshotAllocation, legacySourceTaxMinor, legacyTaxMinors, legacyExclusiveTaxMinors) {
    const snapshotTaxMinors = snapshotAllocation.taxMinors;
    if (snapshotTaxMinors !== null) {
        const snapshotSourceTaxMinor = snapshotTaxMinors.reduce((sum, minor) => sum + minor, 0);
        const residualTaxMinor = sourceTaxMinor - snapshotSourceTaxMinor;
        if (residualTaxMinor === 0) {
            return {
                taxMinors: snapshotTaxMinors,
                exclusiveTaxMinors: snapshotAllocation.exclusiveTaxMinors,
            };
        }
        if (residualTaxMinor === legacySourceTaxMinor) {
            return {
                taxMinors: snapshotTaxMinors.map((minor, index) => minor + legacyTaxMinors[index]),
                exclusiveTaxMinors: snapshotAllocation.exclusiveTaxMinors
                    ? snapshotAllocation.exclusiveTaxMinors.map((minor, index) => minor + legacyExclusiveTaxMinors[index])
                    : null,
            };
        }
        return { taxMinors: fallbackTaxMinors, exclusiveTaxMinors: null };
    }
    if (legacySourceTaxMinor === sourceTaxMinor) {
        return { taxMinors: legacyTaxMinors, exclusiveTaxMinors: legacyExclusiveTaxMinors };
    }
    return { taxMinors: fallbackTaxMinors, exclusiveTaxMinors: null };
}
function getTaxBreakdownWeights(sourceRaw, items, itemWeights) {
    const parsed = parseTaxSnapshot(sourceRaw);
    if (!Array.isArray(parsed))
        return undefined;
    const componentKey = (component) => `${component?.title ?? component?.name ?? component?.label ?? ''}\u0000${component?.rate ?? ''}`;
    if (!Array.isArray(parsed[0])) {
        const ownerWeightsByKey = new Map();
        for (const item of items) {
            if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(item.status) ||
                hasSnapshotLines(item.tax_snapshot))
                continue;
            const itemBreakdown = parseTaxSnapshot(item.tax_breakdown);
            if (!Array.isArray(itemBreakdown))
                continue;
            const itemComponents = itemBreakdown.flatMap((entry) => Array.isArray(entry) ? entry : [entry]);
            const weights = itemWeights(item);
            if (!weights.some((weight) => weight > 0))
                continue;
            for (const component of itemComponents) {
                if (!component || typeof component !== 'object')
                    continue;
                const key = componentKey(component);
                const ownerWeights = ownerWeightsByKey.get(key) || new Array(weights.length).fill(0);
                for (let index = 0; index < weights.length; index += 1)
                    ownerWeights[index] += weights[index];
                ownerWeightsByKey.set(key, ownerWeights);
            }
        }
        return parsed.map((component) => component && typeof component === 'object'
            ? ownerWeightsByKey.get(componentKey(component)) || null
            : null);
    }
    let itemIndex = 0;
    return parsed.map(() => {
        while (itemIndex < items.length) {
            const item = items[itemIndex++];
            if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(item.status))
                continue;
            const breakdown = parseTaxSnapshot(item.tax_breakdown);
            if (Array.isArray(breakdown) && breakdown.length > 0) {
                return itemWeights(item);
            }
        }
        return null;
    });
}
function syncUnpaidBillsForOrder(db, orderId, source, country) {
    const bills = db
        .prepare('SELECT * FROM bills WHERE order_id = ? ORDER BY id')
        .all(orderId);
    const splitBills = bills.some((bill) => bill.split_group_id);
    const settledSplitBill = (bill) => Number(bill.paid_amount || 0) > 0 ||
        (bill.payment_status === 'paid' && Number(bill.total || 0) > 0) ||
        (bill.payment_status !== 'unpaid' && bill.payment_status !== 'paid');
    if (splitBills && bills.some(settledSplitBill)) {
        throw Object.assign(new Error('Cannot modify an order after a split check is paid'), {
            statusCode: 409,
        });
    }
    const unpaidBills = bills.filter((bill) => ['unpaid', 'partial', 'partially_paid'].includes(bill.payment_status));
    if (!splitBills && unpaidBills.length === 0)
        return;
    if (splitBills && bills.length === 0)
        return;
    const tenantCurrency = getTenantCurrency();
    const pack = (0, tax_1.getActiveCountryPack)(country);
    const { total: billTotal, adjustment: billRoundOff } = (0, tax_engine_1.applyPayableRounding)(source.total, pack, tenantCurrency);
    if (!splitBills) {
        const update = db.prepare(`
      UPDATE bills SET subtotal = ?, total = ?, balance = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?,
        discount_amount = ?, delivery_charge = ?, packaging_charge = ?, service_charge = ?,
        charges_breakdown = COALESCE(?, charges_breakdown), round_off = ?, updated_at = ?
      WHERE id = ?
    `);
        for (const bill of unpaidBills) {
            const paidAmount = Number(bill.paid_amount || 0);
            const newBalance = Math.max(0, billTotal - paidAmount);
            update.run(source.subtotal, billTotal, newBalance, source.taxAmount, source.taxBreakdown, source.taxSnapshot, source.discountAmount, source.deliveryCharge, source.packagingCharge, source.serviceCharge, source.chargesBreakdown ?? null, billRoundOff, (0, db_1.now)(), bill.id);
            if (newBalance === 0 &&
                paidAmount > 0 &&
                billTotal === paidAmount &&
                bill.payment_status !== 'paid') {
                completeExactBalanceSettlement(db, bill.id, billTotal, tenantCurrency, (0, db_1.now)());
            }
        }
        return;
    }
    const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(tenantCurrency);
    const decimals = (0, countries_2.getCurrencyFractionDigits)(tenantCurrency);
    const { weights, snapshotWeights, snapshotExclusions, legacyContribution } = getSplitBillAllocationWeights(db, orderId, bills, getTaxDiscountRatio(source.subtotal, source.discountAmount), source.taxBreakdown, minorFactor);
    const fields = {
        subtotal: Math.round(source.subtotal * minorFactor),
        taxAmount: Math.round(source.taxAmount * minorFactor),
        discountAmount: Math.round(source.discountAmount * minorFactor),
        deliveryCharge: Math.round(source.deliveryCharge * minorFactor),
        packagingCharge: Math.round(source.packagingCharge * minorFactor),
        serviceCharge: Math.round(source.serviceCharge * minorFactor),
        roundOff: Math.round(billRoundOff * minorFactor),
        total: Math.round(billTotal * minorFactor),
    };
    const allocations = Object.fromEntries(Object.entries(fields).map(([field, value]) => [
        field,
        (field === 'roundOff'
            ? allocateSignedMinorUnits(value, weights)
            : allocateMinorUnits(value, weights)).map((minor) => minor / minorFactor),
    ]));
    const allocatedTaxMinors = allocations.taxAmount.map((amount) => Math.round(amount * minorFactor));
    // Each guest check carries its own weighted share of the itemised engine
    // charges, so a split receipt shows the fees that belong to it, not the full set.
    const sourceCharges = (0, charges_1.parseAppliedCharges)(source.chargesBreakdown);
    const allocatedChargeMinors = sourceCharges.map((charge) => allocateMinorUnits(Math.round(charge.amount * minorFactor), weights));
    const allocatedOtherChargeTotals = getAllocatedOtherChargeTotals(sourceCharges, allocatedChargeMinors, weights.length, minorFactor, decimals);
    const chargesBreakdownByBill = sourceCharges.length === 0
        ? []
        : weights.map((_, billIndex) => JSON.stringify(sourceCharges.map((charge, chargeIndex) => ({
            ...charge,
            amount: allocatedChargeMinors[chargeIndex][billIndex] / minorFactor,
        }))));
    const snapshotAllocation = allocateTaxSnapshotsWithTax(source.taxSnapshot, weights, snapshotWeights, snapshotExclusions, minorFactor);
    const sourceTaxMinor = Math.round(Number(source.taxAmount || 0) * minorFactor);
    const legacyAllocation = allocateLegacyTaxContribution(sourceTaxMinor, snapshotAllocation, legacyContribution, weights);
    const resolvedTax = resolveSplitTaxAllocations(sourceTaxMinor, allocatedTaxMinors, snapshotAllocation, legacyAllocation.legacySourceTaxMinor, legacyAllocation.legacyTaxMinors, legacyAllocation.legacyExclusiveTaxMinors);
    const taxMinors = resolvedTax.taxMinors;
    if (resolvedTax.exclusiveTaxMinors) {
        allocations.taxAmount = taxMinors.map((minor) => minor / minorFactor);
        allocations.total = composeSplitTotals(allocations, resolvedTax.exclusiveTaxMinors, allocatedOtherChargeTotals, minorFactor, decimals);
    }
    const sourceItems = db
        .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
        .all(orderId);
    const breakdowns = allocateTaxBreakdown(source.taxBreakdown, taxMinors, weights, getTaxBreakdownWeights(source.taxBreakdown, sourceItems, (item) => getBillItemWeights(db, bills, Number(item.id))), minorFactor);
    const snapshots = snapshotAllocation.snapshots;
    const update = db.prepare(`
    UPDATE bills SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?,
      delivery_charge = ?, packaging_charge = ?, service_charge = ?, charges_breakdown = ?, round_off = ?,
      total = ?, balance = ?, updated_at = ?
    WHERE id = ?
  `);
    bills.forEach((bill, index) => {
        const total = allocations.total[index];
        const balance = Math.max(0, total - Number(bill.paid_amount || 0));
        const zeroClosed = bill.payment_status === 'paid' && Number(bill.paid_amount || 0) === 0;
        if (!['unpaid', 'partial', 'partially_paid'].includes(bill.payment_status) && !zeroClosed)
            return;
        update.run(allocations.subtotal[index], allocations.taxAmount[index], breakdowns[index], snapshots[index], allocations.discountAmount[index], allocations.deliveryCharge[index], allocations.packagingCharge[index], allocations.serviceCharge[index], chargesBreakdownByBill[index] ?? null, allocations.roundOff[index], total, balance, (0, db_1.now)(), bill.id);
        if (total <= 0 && balance <= 0) {
            if (bill.payment_status !== 'paid' &&
                checkKitchenDeliveryStatus(db, bill.order_id, undefined, 'unknown', bill.id).allowed) {
                db.prepare(`UPDATE bills SET payment_status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?`).run((0, db_1.now)(), (0, db_1.now)(), bill.id);
            }
        }
        else if (zeroClosed) {
            db.prepare(`UPDATE bills SET payment_status = 'unpaid', paid_at = NULL, updated_at = ? WHERE id = ?`).run((0, db_1.now)(), bill.id);
        }
    });
}
const SPLIT_CHECKS_MIN = 2;
const SPLIT_CHECKS_MAX = 20;
/** A check that cannot be divided again without inventing or double-counting a share. */
function splitSourceAllocationError() {
    return Object.assign(new Error('This check has no divisible item allocation'), {
        statusCode: 409,
    });
}
// Split an unpaid dine-in bill into independently payable guest checks. An
// untouched unpaid group child splits again; paid siblings are never the source.
router.post('/:id/split-check', (0, authorization_1.requirePermission)('bills.generate'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        if ((0, db_1.getSettingValue)('split_checks_enabled') !== 'true')
            return res.status(403).json({ error: 'Split checks are not enabled' });
        const checks = req.body?.checks;
        if (!Array.isArray(checks) ||
            checks.length < SPLIT_CHECKS_MIN ||
            checks.length > SPLIT_CHECKS_MAX)
            return res.status(400).json({ error: 'Create between 2 and 20 guest checks' });
        const result = (0, db_1.withTxn)(() => {
            const txnSource = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
            if (!txnSource)
                throw Object.assign(new Error('Bill not found'), { statusCode: 404 });
            const txnOrder = db
                .prepare('SELECT * FROM orders WHERE id = ?')
                .get(txnSource.order_id);
            if (txnOrder?.type !== 'dine_in')
                throw Object.assign(new Error('Only dine-in checks can be split'), { statusCode: 400 });
            if (txnSource.payment_status !== 'unpaid' ||
                Number(txnSource.paid_amount || 0) !== 0 ||
                txnSource.payment_details) {
                throw Object.assign(new Error('A check can only be split before any payment is recorded'), { statusCode: 409 });
            }
            // A group child may be divided again while untouched and unpaid; a second
            // bill outside a split group is legacy data and keeps the rejection.
            const sourceGroupId = txnSource.split_group_id ? String(txnSource.split_group_id) : null;
            if (!sourceGroupId &&
                Number(db
                    .prepare('SELECT COUNT(*) AS n FROM bills WHERE order_id = ?')
                    .get(txnSource.order_id).n) > 1) {
                throw Object.assign(new Error('This check has already been split'), { statusCode: 409 });
            }
            const tenantCurrency = getTenantCurrency();
            const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(tenantCurrency);
            const decimals = (0, countries_2.getCurrencyFractionDigits)(tenantCurrency);
            const sourceGroupBillIds = sourceGroupId
                ? db
                    .prepare('SELECT id FROM bills WHERE split_group_id = ? ORDER BY id')
                    .all(sourceGroupId).map((row) => Number(row.id))
                : [];
            // A first split divides the order's active items; a re-split divides the
            // source check's own allocation rows, so siblings' shares stay unclaimed.
            const txnSnapshotItems = db
                .prepare("SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled' ORDER BY id")
                .all(txnSource.order_id);
            let txnActiveItems;
            if (sourceGroupId) {
                const sourceAllocations = db
                    .prepare('SELECT order_item_id, quantity FROM bill_items WHERE bill_id = ? ORDER BY order_item_id')
                    .all(txnSource.id);
                const wellFormed = sourceAllocations.length > 0 &&
                    sourceAllocations.every((row) => Number.isSafeInteger(Number(row.order_item_id)) &&
                        Number.isSafeInteger(Number(row.quantity)) &&
                        Number(row.quantity) > 0);
                if (!wellFormed)
                    throw splitSourceAllocationError();
                const orderItemRows = db
                    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
                    .all(txnSource.order_id);
                if (sourceAllocations.some((row) => !orderItemRows.some((item) => Number(item.id) === Number(row.order_item_id)))) {
                    throw splitSourceAllocationError();
                }
                const childAllocationRows = db
                    .prepare(`SELECT bill_id, order_item_id, quantity FROM bill_items WHERE bill_id IN (${sourceGroupBillIds.map(() => '?').join(',')})`)
                    .all(...sourceGroupBillIds);
                const childItemAllocations = childAllocationsForBills(sourceGroupBillIds.map((id) => ({ id })), childAllocationRows, Number(txnSource.id));
                const projected = projectOrderItems(txnOrder, orderItemRows, sourceAllocations, childItemAllocations, minorFactor);
                const childScoped = applyPersistedChildTaxBreakdowns(projected, orderItemRows, txnSource.tax_breakdown, minorFactor);
                txnActiveItems = childScoped.filter((item) => !['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(item.status));
                if (txnActiveItems.length === 0)
                    throw splitSourceAllocationError();
            }
            else {
                txnActiveItems = db
                    .prepare("SELECT * FROM order_items WHERE order_id = ? AND status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded') ORDER BY id")
                    .all(txnSource.order_id);
            }
            const txnItemById = new Map(txnActiveItems.map((item) => [Number(item.id), item]));
            const txnAssigned = new Map();
            const txnNormalized = checks.map((check, index) => {
                const label = String(check?.label || `Guest ${index + 1}`)
                    .trim()
                    .slice(0, 40) || `Guest ${index + 1}`;
                if (!Array.isArray(check?.items) || check.items.length === 0)
                    throw Object.assign(new Error(`${label} must contain at least one item`), {
                        statusCode: 400,
                    });
                const seenItems = new Set();
                const items = check.items.map((entry) => {
                    const itemId = Number(entry?.order_item_id);
                    const quantity = Number(entry?.quantity);
                    const item = txnItemById.get(itemId);
                    if (!item || !Number.isSafeInteger(quantity) || quantity < 1)
                        throw Object.assign(new Error(`Invalid item allocation in ${label}`), {
                            statusCode: 400,
                        });
                    if (seenItems.has(itemId))
                        throw Object.assign(new Error(`${label} contains the same item more than once`), {
                            statusCode: 400,
                        });
                    seenItems.add(itemId);
                    txnAssigned.set(itemId, (txnAssigned.get(itemId) || 0) + quantity);
                    return { item, quantity };
                });
                return { label, items };
            });
            for (const item of txnActiveItems) {
                if ((txnAssigned.get(Number(item.id)) || 0) !== Number(item.quantity)) {
                    throw Object.assign(new Error(`Allocate all ${item.quantity} × ${item.product_name}`), {
                        statusCode: 400,
                    });
                }
            }
            const groupId = sourceGroupId || (0, crypto_1.randomUUID)();
            const weights = txnNormalized.map((check) => check.items.reduce((sum, entry) => sum +
                (Number(entry.item.total || entry.item.subtotal || 0) * entry.quantity) /
                    Number(entry.item.quantity), 0));
            const fields = [
                'subtotal',
                'tax_amount',
                'discount_amount',
                'delivery_charge',
                'packaging_charge',
                'service_charge',
                'round_off',
                'total',
            ];
            const allocations = {};
            for (const field of fields) {
                const totalMinor = Math.round(Number(txnSource[field] || 0) * minorFactor);
                const allocatedMinors = field === 'round_off'
                    ? allocateSignedMinorUnits(totalMinor, weights)
                    : allocateMinorUnits(totalMinor, weights);
                allocations[field] = allocatedMinors.map((minor) => minor / minorFactor);
            }
            const splitSourceCharges = (0, charges_1.parseAppliedCharges)(txnSource.charges_breakdown);
            const splitChargeMinors = splitSourceCharges.map((charge) => allocateMinorUnits(Math.round(charge.amount * minorFactor), weights));
            const allocatedOtherChargeTotals = getAllocatedOtherChargeTotals(splitSourceCharges, splitChargeMinors, weights.length, minorFactor, decimals);
            const checkTaxMinors = allocations.tax_amount.map((amt) => Math.round(amt * minorFactor));
            const snapshotItems = txnSnapshotItems.filter((item) => hasSnapshotLines(item.tax_snapshot));
            const snapshotWeights = snapshotItems.map((item) => {
                if (['voided', 'void_adjustment'].includes(item.status))
                    return null;
                return txnNormalized.map((check) => check.items.find((entry) => Number(entry.item.id) === Number(item.id))?.quantity || 0);
            });
            const snapshotExclusions = snapshotItems.map((item) => ['voided', 'void_adjustment'].includes(item.status));
            const snapshotAllocation = allocateTaxSnapshotsWithTax(txnSource.tax_snapshot, weights, snapshotWeights, snapshotExclusions, minorFactor);
            const sourceTaxMinor = Math.round(Number(txnSource.tax_amount || 0) * minorFactor);
            const legacyTaxRatio = getTaxDiscountRatio(txnSource.subtotal, txnSource.discount_amount);
            const legacyTaxItems = sourceGroupId ? txnActiveItems : txnSnapshotItems;
            const legacyContribution = collectLegacyTaxContribution(legacyTaxItems, weights, (item) => txnNormalized.map((check) => check.items.find((entry) => Number(entry.item.id) === Number(item.id))?.quantity ||
                0), legacyTaxRatio, txnSource.tax_breakdown, minorFactor);
            const legacyAllocation = allocateLegacyTaxContribution(sourceTaxMinor, snapshotAllocation, legacyContribution, weights);
            const resolvedTax = resolveSplitTaxAllocations(sourceTaxMinor, checkTaxMinors, snapshotAllocation, legacyAllocation.legacySourceTaxMinor, legacyAllocation.legacyTaxMinors, legacyAllocation.legacyExclusiveTaxMinors);
            const resolvedTaxMinors = resolvedTax.taxMinors;
            if (resolvedTax.exclusiveTaxMinors) {
                allocations.tax_amount = resolvedTaxMinors.map((minor) => minor / minorFactor);
                allocations.total = composeSplitTotals(allocations, resolvedTax.exclusiveTaxMinors, allocatedOtherChargeTotals, minorFactor, decimals);
            }
            const resolvedTaxBreakdowns = allocateTaxBreakdown(txnSource.tax_breakdown, resolvedTaxMinors, weights, getTaxBreakdownWeights(txnSource.tax_breakdown, legacyTaxItems, (item) => txnNormalized.map((check) => check.items.find((entry) => Number(entry.item.id) === Number(item.id))?.quantity ||
                0)), minorFactor);
            const checkTaxSnapshots = snapshotAllocation.snapshots;
            // Each guest check carries its weighted share of the itemised engine
            // charges, matching how the charge columns were allocated above.
            const splitChargesJson = splitSourceCharges.length === 0
                ? []
                : weights.map((_, billIndex) => JSON.stringify(splitSourceCharges.map((charge, chargeIndex) => ({
                    ...charge,
                    amount: splitChargeMinors[chargeIndex][billIndex] / minorFactor,
                }))));
            const billIds = [];
            txnNormalized.forEach((check, index) => {
                let billId;
                const splitBk = resolvedTaxBreakdowns[index];
                const splitSnapshot = checkTaxSnapshots[index];
                if (index === 0) {
                    db.prepare(`UPDATE bills SET split_group_id = ?, split_label = ?, subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, delivery_charge = ?, packaging_charge = ?, service_charge = ?, charges_breakdown = ?, round_off = ?, total = ?, balance = ?, updated_at = ? WHERE id = ?`).run(groupId, check.label, allocations.subtotal[index], allocations.tax_amount[index], splitBk, splitSnapshot, allocations.discount_amount[index], allocations.delivery_charge[index], allocations.packaging_charge[index], allocations.service_charge[index], splitChargesJson[index] ?? null, allocations.round_off[index], allocations.total[index], allocations.total[index], (0, db_1.now)(), txnSource.id);
                    billId = Number(txnSource.id);
                }
                else {
                    const inserted = db
                        .prepare(`
            INSERT INTO bills (bill_number, order_id, customer_id, subtotal, tax_amount, tax_breakdown, tax_snapshot,
              discount_amount, discount_type, discount_value, discount_reason, delivery_charge, packaging_charge,
              service_charge, charges_breakdown, round_off, total, paid_amount, balance, payment_status, split_group_id, split_label,
              created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?, ?)
          `)
                        .run((0, db_1.generateBillNumber)(), txnSource.order_id, txnSource.customer_id, allocations.subtotal[index], allocations.tax_amount[index], splitBk, splitSnapshot, allocations.discount_amount[index], txnSource.discount_type, txnSource.discount_value, txnSource.discount_reason, allocations.delivery_charge[index], allocations.packaging_charge[index], allocations.service_charge[index], splitChargesJson[index] ?? null, allocations.round_off[index], allocations.total[index], allocations.total[index], groupId, check.label, (0, db_1.now)(), (0, db_1.now)());
                    billId = Number(inserted.lastInsertRowid);
                }
                billIds.push(billId);
                // Only the source's allocation rows are replaced here, so sibling
                // shares survive a re-split untouched.
                db.prepare('DELETE FROM bill_items WHERE bill_id = ?').run(billId);
                const insertItem = db.prepare('INSERT INTO bill_items (bill_id, order_item_id, quantity) VALUES (?, ?, ?)');
                for (const entry of check.items)
                    insertItem.run(billId, entry.item.id, entry.quantity);
            });
            return billIds.map((id) => (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(id)));
        });
        void (0, telemetry_1.sendEvent)('feature_used', {
            feature: 'split_checks',
            action: 'created',
            check_count: result.length,
        });
        (0, kds_1.notifyOrderUpdated)();
        res.status(201).json({ bills: result });
    }
    catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || 'Unable to split check' });
    }
});
// A payment request is prepared and fully validated before any ledger or bill
// writes. Both endpoints use this one atomic path.
const PAYMENT_METHODS = new Set(['cash', 'card', 'upi', 'wallet']);
const MAX_PAYMENT_LINES = 100;
const MAX_PAYMENT_METADATA_BYTES = 8192;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
function canonicalizePaymentRequest(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalizePaymentRequest).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalizePaymentRequest(value[key])}`)
            .join(',')}}`;
    }
    if (value === undefined)
        return 'undefined';
    return JSON.stringify(value);
}
function paymentRequestHash(billId, payments, customerId) {
    return (0, crypto_1.createHash)('sha256')
        .update(canonicalizePaymentRequest({ billId, payments, customer_id: customerId }))
        .digest('hex');
}
function paymentIdempotencyKey(req) {
    const supplied = req.get('Idempotency-Key')?.trim();
    if (!supplied)
        return null;
    if (supplied.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(supplied)) {
        throw Object.assign(new Error('Idempotency-Key is invalid or too long'), { statusCode: 400 });
    }
    return supplied;
}
function paymentAmountMinorUnits(value, currency, label = 'Payment amount') {
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw Object.assign(new Error(`${label} must be a finite number greater than zero`), {
            statusCode: 400,
        });
    }
    const decimals = (0, countries_2.getCurrencyFractionDigits)(currency);
    const factor = (0, countries_2.getCurrencyMinorUnitFactor)(currency);
    const text = String(value).trim();
    const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
    if (!pattern.test(text)) {
        const decDesc = decimals === 0 ? 'without decimals' : `with at most ${decimals} decimal places`;
        throw Object.assign(new Error(`${label} must be a finite number greater than zero ${decDesc}`), { statusCode: 400 });
    }
    const parsed = Number(text);
    const minorUnits = Math.round(parsed * factor);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isSafeInteger(minorUnits)) {
        throw Object.assign(new Error(`${label} must be a finite number greater than zero`), {
            statusCode: 400,
        });
    }
    return minorUnits;
}
function paymentAmountCents(value, label = 'Payment amount') {
    return paymentAmountMinorUnits(value, 'USD', label);
}
function validatePaymentFields(payment, index, currency) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
        throw paymentValidationError(`Unsupported payment method at line ${index + 1}`, 'payment_input_invalid');
    }
    if (!payment.method)
        throw paymentValidationError('Payment method is required', 'payment_input_invalid');
    if (typeof payment.method !== 'string' || payment.method.length > 60)
        throw paymentValidationError(`Unsupported payment method at line ${index + 1}`, 'payment_input_invalid');
    if (payment.method === 'custom' && !Number.isSafeInteger(Number(payment.payment_method_id))) {
        throw paymentValidationError(`Custom payment method is required at line ${index + 1}`, 'payment_method_unavailable');
    }
    if (JSON.stringify(payment).length > MAX_PAYMENT_METADATA_BYTES) {
        throw paymentValidationError(`Payment metadata at line ${index + 1} is too large`, 'payment_input_invalid');
    }
    for (const [field, maxLength] of [
        ['transaction_id', 256],
        ['notes', 1024],
    ]) {
        const value = payment[field];
        if (value === undefined)
            continue;
        if (typeof value !== 'string' || value.length > maxLength) {
            throw paymentValidationError(`${field} is invalid or too long`, 'payment_input_invalid');
        }
        if (field === 'transaction_id' && value.trim() === '') {
            if (payment.method === 'card' && (0, db_1.getSettingValue)('card_transaction_id_required') === 'true') {
                throw paymentValidationError(`Card transaction_id is required at line ${index + 1}`, 'card_transaction_id_required');
            }
            throw paymentValidationError(`${field} is invalid or too long`, 'payment_input_invalid');
        }
    }
    if (payment.amount !== undefined &&
        payment.amount !== null &&
        payment.amount !== 0 &&
        payment.amount !== '0') {
        try {
            paymentAmountMinorUnits(payment.amount, currency);
        }
        catch (error) {
            throw paymentValidationError(error instanceof Error ? error.message : 'Payment amount is invalid', 'payment_input_invalid');
        }
    }
}
function paymentTransactionKey(payment) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment))
        return null;
    const candidate = payment;
    const methodKey = candidate.payment_method_id === undefined
        ? candidate.method
        : `custom:${candidate.payment_method_id}`;
    return typeof methodKey === 'string' && typeof candidate.transaction_id === 'string'
        ? JSON.stringify([methodKey, candidate.transaction_id])
        : null;
}
function transactionPaymentMatches(existing, candidate, currency, db) {
    if (!existing)
        return false;
    if (existing.method !== candidate.method || existing.transaction_id !== candidate.transaction_id)
        return false;
    if ((existing.notes ?? null) !== (candidate.notes ?? null))
        return false;
    const candidateOmitted = candidate.amount === undefined || candidate.amount === null;
    if (existing.amount_omitted !== undefined &&
        Boolean(existing.amount_omitted) !== candidateOmitted)
        return false;
    if (candidateOmitted)
        return true;
    const factor = (0, countries_2.getCurrencyMinorUnitFactor)(currency);
    const requestedMinorUnits = paymentAmountMinorUnits(candidate.amount, currency);
    const storedRequested = existing.requested_amount ??
        ((0, shift_session_gate_1.isCashTender)(db, existing) && existing.tendered_amount !== undefined
            ? existing.tendered_amount
            : existing.amount);
    return (typeof storedRequested === 'number' &&
        Math.round(storedRequested * factor) === requestedMinorUnits);
}
function preparePaymentBatch(db, billId, payments, bodyCustomerId, allowOmittedAmount = false) {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    if (!bill)
        throw Object.assign(new Error('Bill not found'), { statusCode: 404 });
    const isZeroDue = Number(bill.total || 0) <= 0 || Number(bill.balance || 0) <= 0;
    if (!Array.isArray(payments) || (payments.length === 0 && !isZeroDue))
        throw paymentValidationError('payments must be a non-empty array', 'payment_input_invalid');
    if (payments.length > MAX_PAYMENT_LINES)
        throw paymentValidationError(`A maximum of ${MAX_PAYMENT_LINES} payment lines is allowed`, 'payment_input_invalid');
    let existingPayments = [];
    if (bill.payment_details) {
        try {
            const parsed = JSON.parse(bill.payment_details);
            existingPayments = Array.isArray(parsed) ? parsed : [parsed];
        }
        catch {
            // Preserve settlement compatibility with legacy malformed JSON. The new
            // line is still appended in a recoverable JSON array below.
            existingPayments = [];
        }
    }
    const currency = getTenantCurrency();
    const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(currency);
    payments.forEach((payment, index) => validatePaymentFields(payment, index, currency));
    const resolvedPayments = payments.map((payment, index) => {
        const rawMethod = typeof payment.method === 'string' ? payment.method.trim() : '';
        const normalizedMethod = rawMethod.toLowerCase();
        if (PAYMENT_METHODS.has(normalizedMethod)) {
            if (normalizedMethod === 'upi') {
                const configured = db
                    .prepare("SELECT id, name FROM payment_methods WHERE lower(name) = 'upi' AND is_active = 1")
                    .get();
                if (configured) {
                    return { ...payment, method: configured.name, payment_method_id: Number(configured.id) };
                }
                if (payment.payment_method_id === undefined)
                    return { ...payment, method: 'UPI' };
                const copy = { ...payment, method: 'UPI' };
                delete copy.payment_method_id;
                return copy;
            }
            if (payment.payment_method_id === undefined)
                return payment;
            const copy = { ...payment };
            delete copy.payment_method_id;
            return copy;
        }
        const configured = payment.method === 'custom'
            ? db
                .prepare('SELECT id, name FROM payment_methods WHERE id = ? AND is_active = 1')
                .get(payment.payment_method_id)
            : db
                .prepare('SELECT id, name FROM payment_methods WHERE lower(name) = lower(?) AND is_active = 1')
                .get(payment.method);
        if (!configured)
            throw paymentValidationError(`Unsupported or inactive custom payment method at line ${index + 1}`, 'payment_method_unavailable');
        return { ...payment, method: configured.name, payment_method_id: Number(configured.id) };
    });
    const requestedCustomerId = bodyCustomerId === undefined || bodyCustomerId === null || bodyCustomerId === ''
        ? null
        : String(bodyCustomerId);
    const order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(bill.order_id);
    const associatedCustomerId = bill.customer_id || order?.customer_id || null;
    if (requestedCustomerId &&
        associatedCustomerId &&
        String(associatedCustomerId) !== requestedCustomerId) {
        throw paymentValidationError('Payment customer does not match the bill customer', 'customer_mismatch');
    }
    const usesWallet = resolvedPayments.some((payment) => payment.method === 'wallet');
    if (usesWallet && !associatedCustomerId) {
        throw paymentValidationError('Wallet payment requires a customer associated with the bill', 'wallet_customer_required');
    }
    const effectiveCustomerId = associatedCustomerId
        ? String(associatedCustomerId)
        : requestedCustomerId;
    if (effectiveCustomerId &&
        !db.prepare('SELECT id FROM customers WHERE id = ?').get(effectiveCustomerId)) {
        throw paymentValidationError('Customer not found', 'customer_unavailable');
    }
    const existingTransactionKeys = new Set(existingPayments.map(paymentTransactionKey).filter(Boolean));
    const existingTransactionPayments = new Map();
    for (const existing of existingPayments) {
        const transactionKey = paymentTransactionKey(existing);
        if (transactionKey)
            existingTransactionPayments.set(transactionKey, existing);
    }
    for (const payment of resolvedPayments) {
        const transactionKey = paymentTransactionKey(payment);
        if (!transactionKey)
            continue;
        const candidate = payment;
        const methodKey = candidate.payment_method_id === undefined
            ? candidate.method
            : `custom:${candidate.payment_method_id}`;
        const reference = db
            .prepare('SELECT bill_id FROM payment_transaction_refs WHERE method = ? AND transaction_id = ?')
            .get(methodKey, candidate.transaction_id);
        if (reference && String(reference.bill_id) !== String(billId)) {
            throw paymentValidationError('Payment transaction_id has already been used for another bill', 'transaction_reference_used', 409);
        }
        if (reference)
            existingTransactionKeys.add(transactionKey);
    }
    const requestTransactionKeys = resolvedPayments.map(paymentTransactionKey);
    const transactionMethods = new Map();
    for (const payment of resolvedPayments) {
        if (typeof payment.transaction_id !== 'string' || payment.transaction_id.trim() === '')
            continue;
        const methodKey = payment.payment_method_id === undefined
            ? payment.method
            : `custom:${payment.payment_method_id}`;
        const previousMethod = transactionMethods.get(payment.transaction_id);
        if (previousMethod && previousMethod !== methodKey) {
            throw paymentValidationError('A transaction_id cannot be reused across payment methods in one batch', 'transaction_reference_reused');
        }
        transactionMethods.set(payment.transaction_id, methodKey);
    }
    const replay = requestTransactionKeys.length > 0 &&
        requestTransactionKeys.every((key, index) => key !== null &&
            existingTransactionKeys.has(key) &&
            transactionPaymentMatches(existingTransactionPayments.get(key), resolvedPayments[index], currency, db));
    if (replay) {
        return { bill, prepared: [], existingPayments, effectiveCustomerId, idempotentReplay: true };
    }
    if ((0, db_1.getSettingValue)('card_transaction_id_required') === 'true') {
        resolvedPayments.forEach((payment, index) => {
            if (payment.method === 'card' &&
                payment.payment_method_id === undefined &&
                (typeof payment.transaction_id !== 'string' || payment.transaction_id.trim() === '')) {
                throw paymentValidationError(`Card transaction_id is required at line ${index + 1}`, 'card_transaction_id_required');
            }
        });
    }
    const seenTransactionKeys = new Set();
    for (const key of requestTransactionKeys) {
        if (key && (seenTransactionKeys.has(key) || existingTransactionKeys.has(key))) {
            throw paymentValidationError('Payment transaction_id has already been used for this bill', 'transaction_reference_reused', 409);
        }
        if (key)
            seenTransactionKeys.add(key);
    }
    if (bill.payment_status === 'refunded' || bill.payment_status === 'partially_refunded') {
        throw paymentValidationError('Cannot accept payment on a refunded bill', 'bill_refunded', 409);
    }
    const remainingCents = Math.max(0, Math.round((Number(bill.total) - Number(bill.paid_amount || 0)) * minorFactor));
    const hasPositiveAmount = resolvedPayments.some((p) => {
        if (p.amount === null || p.amount === undefined)
            return false;
        const num = Number(p.amount);
        return !Number.isNaN(num) && num > 0;
    });
    if (bill.payment_status === 'paid') {
        if (hasPositiveAmount) {
            throw paymentValidationError('Bill is already paid', 'bill_already_paid');
        }
        return { bill, prepared: [], existingPayments, effectiveCustomerId };
    }
    if (remainingCents <= 0) {
        if (hasPositiveAmount) {
            throw paymentValidationError('Payment exceeds remaining balance', 'payment_exceeds_balance');
        }
        return { bill, prepared: [], existingPayments, effectiveCustomerId };
    }
    const raw = resolvedPayments.map((payment) => {
        // Single-line payments may omit amount to pay remaining balance; multi-line requires explicit amounts.
        const supportsOmittedAmount = allowOmittedAmount || payments.length === 1;
        const amountValue = supportsOmittedAmount && payment.amount === null ? undefined : payment.amount;
        const amount = amountValue === undefined
            ? supportsOmittedAmount
                ? remainingCents
                : undefined
            : paymentAmountMinorUnits(amountValue, currency);
        if (amount === undefined)
            throw paymentValidationError('Payment amount is required for split payments', 'amount_required');
        const normalizedPayment = {
            method: String(payment.method),
            ...(payment.payment_method_id !== undefined
                ? { payment_method_id: payment.payment_method_id }
                : {}),
        };
        if (payment.transaction_id !== undefined)
            normalizedPayment.transaction_id = payment.transaction_id;
        if (payment.notes !== undefined)
            normalizedPayment.notes = payment.notes;
        return {
            payment: normalizedPayment,
            requestedCents: amount,
            amountOmitted: amountValue === undefined,
        };
    });
    const nonCashCents = raw
        .filter((line) => !(0, shift_session_gate_1.isCashTender)(db, line.payment))
        .reduce((sum, line) => sum + line.requestedCents, 0);
    if (nonCashCents > remainingCents)
        throw paymentValidationError('Non-cash payment exceeds the bill balance', 'non_cash_exceeds_balance');
    const cashRequiredCents = remainingCents - nonCashCents;
    // Partial payments remain supported. Cash is allocated up to the amount
    // needed after non-cash lines; a short tender simply leaves a partial bill.
    let cashLeft = cashRequiredCents;
    const prepared = raw
        .map((line) => {
        if (!(0, shift_session_gate_1.isCashTender)(db, line.payment))
            return {
                payment: line.payment,
                amountCents: line.requestedCents,
                amountOmitted: line.amountOmitted,
            };
        const applied = Math.min(line.requestedCents, cashLeft);
        cashLeft -= applied;
        if (applied === 0 && line.payment.transaction_id) {
            throw paymentValidationError('A zero-applied cash line cannot carry a transaction_id', 'cash_reference_zero_applied');
        }
        return {
            payment: line.payment,
            amountCents: applied,
            tenderedCents: line.requestedCents,
            changeCents: line.requestedCents - applied,
            amountOmitted: line.amountOmitted,
        };
    })
        .filter((line) => line.amountCents > 0);
    if (prepared.some((line) => line.payment.method === 'wallet')) {
        if (!effectiveCustomerId)
            throw paymentValidationError('Customer association is required for wallet payment', 'wallet_customer_required');
        const credits = db
            .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger WHERE customer_id = ? AND type = 'credit' AND (expires_at IS NULL OR expires_at > datetime('now'))`)
            .get(effectiveCustomerId);
        const debits = db
            .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger WHERE customer_id = ? AND type = 'debit'`)
            .get(effectiveCustomerId);
        const walletPoints = Math.max(0, Number(credits.total) - Number(debits.total));
        const pointsRequired = (prepared
            .filter((line) => line.payment.method === 'wallet')
            .reduce((sum, line) => sum + line.amountCents, 0) /
            minorFactor) *
            LOYALTY_REDEMPTION_RATE;
        if (walletPoints < pointsRequired)
            throw paymentValidationError(`Insufficient wallet balance. Available: ${walletPoints} points, Required: ${pointsRequired}`, 'wallet_insufficient');
    }
    return { bill, prepared, existingPayments, effectiveCustomerId };
}
function calculateCashback(db, bill, customerId) {
    if (!customerId)
        return 0;
    const enabled = db.prepare(`SELECT value FROM settings WHERE key = 'loyalty_enabled'`).get()?.value;
    if (enabled !== 'true' && enabled !== '1')
        return 0;
    const globalRate = parseFloat(db.prepare(`SELECT value FROM settings WHERE key = 'global_cashback_percent'`).get()
        ?.value || '0');
    const order = db
        .prepare('SELECT subtotal, discount_amount FROM orders WHERE id = ?')
        .get(bill.order_id);
    const items = db
        .prepare(`SELECT oi.subtotal, p.cb_percent FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? AND oi.status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')`)
        .all(bill.order_id);
    const fullOrderCashback = items.reduce((sum, item) => {
        const discountShare = order?.discount_amount > 0 && order?.subtotal > 0
            ? (order.discount_amount * item.subtotal) / order.subtotal
            : 0;
        const rate = item.cb_percent !== null ? item.cb_percent : globalRate;
        return (sum +
            (rate > 0
                ? Math.floor((Math.max(0, item.subtotal - discountShare) * rate) / 100) *
                    LOYALTY_REDEMPTION_RATE
                : 0));
    }, 0);
    const splitRatio = Number(order?.subtotal || 0) > 0 && bill.split_group_id
        ? Math.min(1, Number(bill.subtotal || 0) / Number(order.subtotal))
        : 1;
    return Math.floor(fullOrderCashback * splitRatio);
}
const pendingExactBalanceAutomations = new Map();
let exactBalanceFlushScheduled = false;
function flushPendingExactBalanceAutomations() {
    for (const [billId, entry] of pendingExactBalanceAutomations.entries()) {
        if (entry.db.inTransaction)
            continue;
        pendingExactBalanceAutomations.delete(billId);
        let isPaid = false;
        try {
            const current = entry.db
                .prepare('SELECT payment_status FROM bills WHERE id = ?')
                .get(billId);
            isPaid = current?.payment_status === 'paid';
        }
        catch {
            isPaid = false;
        }
        if (isPaid) {
            void whatsapp
                .triggerBillPaidAutomation(billId, { pointsEarned: entry.pointsEarned })
                .catch(() => { });
        }
    }
}
function queueExactBalanceAutomation(db, billId, pointsEarned) {
    if (!Number.isFinite(billId) || billId <= 0)
        return;
    pendingExactBalanceAutomations.set(billId, { db, pointsEarned });
    if (!db.inTransaction) {
        flushPendingExactBalanceAutomations();
        return;
    }
    if (!exactBalanceFlushScheduled) {
        exactBalanceFlushScheduled = true;
        queueMicrotask(() => {
            exactBalanceFlushScheduled = false;
            flushPendingExactBalanceAutomations();
        });
    }
}
async function handlePostPaymentRelease(db, orderId, actorUserId) {
    const order = db
        .prepare('SELECT id, release_status, dispatch_policy, checkout_stage, scheduled_for FROM orders WHERE id = ?')
        .get(orderId);
    if (!order || order.dispatch_policy !== 'on_payment' || order.checkout_stage !== 'paid') {
        return;
    }
    if (order.release_status !== 'scheduled') {
        return;
    }
    if (order.scheduled_for) {
        const scheduledTime = (0, db_1.parseDbTimestamp)(order.scheduled_for).getTime();
        if (scheduledTime > Date.now()) {
            return;
        }
    }
    try {
        await (0, scheduled_orders_1.releaseScheduledOrder)(db, order.id, {
            trigger: 'payment',
            actorUserId: actorUserId || null,
        });
    }
    catch (err) {
        console.error(`[MultiCounter] Post-payment release failed for order ${order.id}:`, err);
    }
}
function queuePostPaymentRelease(db, orderId, actorUserId) {
    if (!orderId)
        return;
    if (!db.inTransaction) {
        void handlePostPaymentRelease(db, orderId, actorUserId);
        return;
    }
    queueMicrotask(() => {
        try {
            void handlePostPaymentRelease(db, orderId, actorUserId);
        }
        catch (err) {
            console.error(`[MultiCounter] Queued post-payment release failed for order ${orderId}:`, err);
        }
    });
}
function reconcileOrderSettlement(db, orderId, changedAt = (0, db_1.now)(), actorUserId) {
    const orderRow = db
        .prepare('SELECT id, status, table_id, customer_id, release_status, dispatch_policy, checkout_stage, scheduled_for FROM orders WHERE id = ?')
        .get(orderId);
    if (!orderRow)
        return { orderFullyPaid: false, orderRow: null };
    let orderFullyPaid = false;
    if (orderRow.dispatch_policy === 'on_payment') {
        if ((0, db_1.isOrderSettledAndNonRefunded)(db, orderRow.id)) {
            orderFullyPaid = true;
            if (orderRow.checkout_stage === 'awaiting_payment') {
                db.prepare("UPDATE orders SET checkout_stage = 'paid', updated_at = ? WHERE id = ?").run(changedAt, orderRow.id);
                orderRow.checkout_stage = 'paid';
            }
            queuePostPaymentRelease(db, orderRow.id, actorUserId);
        }
    }
    else {
        const unpaidSibling = db
            .prepare(`SELECT 1 FROM bills WHERE order_id = ? AND payment_status NOT IN ('paid', 'refunded', 'partially_refunded') LIMIT 1`)
            .get(orderRow.id);
        orderFullyPaid = !unpaidSibling;
        if (orderFullyPaid) {
            if (orderRow.checkout_stage === 'awaiting_payment') {
                db.prepare("UPDATE orders SET checkout_stage = 'paid', updated_at = ? WHERE id = ?").run(changedAt, orderRow.id);
                orderRow.checkout_stage = 'paid';
            }
            const canComplete = !['cancelled', 'completed'].includes(orderRow.status) && !(0, scheduled_orders_1.isUnreleasedOrderRow)(orderRow);
            if (canComplete) {
                db.prepare("UPDATE orders SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(changedAt, changedAt, orderRow.id);
                if (orderRow.table_id) {
                    db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?").run(changedAt, orderRow.table_id);
                }
            }
        }
    }
    return { orderFullyPaid, orderRow };
}
function completeExactBalanceSettlement(db, billId, newTotal, currency, changedAt = (0, db_1.now)(), overridePin, clientIp = 'unknown', preVerifiedManager, approverId) {
    if (!db.inTransaction) {
        return db.transaction(() => completeExactBalanceSettlement(db, billId, newTotal, currency, changedAt, overridePin, clientIp, preVerifiedManager, approverId))();
    }
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    if (!bill)
        return null;
    const kitchenStatus = checkKitchenDeliveryStatus(db, bill.order_id, overridePin, clientIp, bill.id, preVerifiedManager, approverId);
    if (!kitchenStatus.allowed) {
        return (0, db_1.parseRowJson)(bill);
    }
    const orderBefore = db.prepare('SELECT status FROM orders WHERE id = ?').get(bill.order_id);
    const wasAlreadySettled = bill.payment_status === 'paid' && orderBefore?.status === 'completed';
    db.prepare(`UPDATE bills SET payment_status = 'paid', paid_at = COALESCE(paid_at, ?), balance = 0, updated_at = ? WHERE id = ?`).run(changedAt, changedAt, billId);
    // v126 rows consume immutable item, recipe, add-on, and packaging snapshots
    // in this same settlement transaction. Legacy rows remain on their historic path.
    // Movements require a real user for their audit trail.  A bill does not
    // reliably carry a user_id, so resolve the order owner when a manager did
    // not explicitly approve settlement.  Throwing here rolls the bill update
    // back with the enclosing settlement transaction instead of creating an
    // unauditable movement.
    const inventoryActor = approverId
        ? String(approverId)
        : String(db.prepare('SELECT user_id FROM orders WHERE id = ?').get(bill.order_id)?.user_id || '');
    if (!inventoryActor) {
        throw new Error('Cannot settle checkout inventory without an order user');
    }
    try {
        (0, checkout_inventory_1.consumeCheckoutInventory)(db, Number(bill.order_id), inventoryActor, `bill:${bill.id}`);
    }
    catch (err) {
        const order = db
            .prepare('SELECT dispatch_policy, release_status FROM orders WHERE id = ?')
            .get(bill.order_id);
        if (order &&
            (order.dispatch_policy === 'on_payment' || order.release_status === 'scheduled')) {
            const holdReason = err?.message || 'Insufficient stock';
            db.prepare(`UPDATE orders SET release_status = 'blocked', release_blocked_reason = ?, updated_at = ? WHERE id = ?`).run(holdReason, changedAt, bill.order_id);
        }
        else {
            throw err;
        }
    }
    (0, promotions_1.recordPromotionRedemptionOnCheckout)(db, Number(bill.order_id), Number(bill.id), inventoryActor);
    const updatedBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    if (!updatedBill)
        return null;
    const { orderRow } = reconcileOrderSettlement(db, bill.order_id, changedAt, approverId ? String(approverId) : undefined);
    const effectiveCustomerId = bill.customer_id || orderRow?.customer_id;
    const cashback = calculateCashback(db, bill, effectiveCustomerId);
    const alreadyCredited = db
        .prepare(`SELECT id FROM loyalty_ledger WHERE bill_id = ? AND type = 'credit'`)
        .get(bill.id);
    let loyaltyPointsEarned = 0;
    if (cashback > 0 && !alreadyCredited) {
        let existingPayments = [];
        try {
            existingPayments = JSON.parse(bill.payment_details || '[]');
        }
        catch {
            existingPayments = [];
        }
        const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(currency);
        const walletCents = existingPayments
            .filter((p) => p.method === 'wallet')
            .reduce((sum, p) => sum + Math.round(Number(p.amount || 0) * minorFactor), 0);
        const totalCents = Math.round(Number(newTotal) * minorFactor);
        const finalCashback = Math.floor(cashback * (1 - Math.min(1, walletCents / Math.max(1, totalCents))));
        if (finalCashback > 0) {
            loyaltyPointsEarned = finalCashback;
            db.prepare(`INSERT INTO loyalty_ledger (customer_id, bill_id, type, amount, description, created_at, updated_at) VALUES (?, ?, 'credit', ?, ?, ?, ?)`).run(effectiveCustomerId, bill.id, finalCashback, `Cashback on bill ${bill.bill_number}`, changedAt, changedAt);
        }
    }
    if (!wasAlreadySettled) {
        queueExactBalanceAutomation(db, Number(bill.id), loyaltyPointsEarned);
    }
    const resultBill = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(billId));
    if (resultBill && typeof resultBill === 'object') {
        resultBill.loyaltyPointsEarned = loyaltyPointsEarned;
    }
    return resultBill;
}
function applyPaymentBatch(db, billId, payments, bodyCustomerId, allowOmittedAmount = false, idempotencyKey, requestHash, idempotencyUserId, overridePin, clientIp = 'unknown', preVerifiedKitchenManager, approverId) {
    if (idempotencyKey && idempotencyUserId) {
        // Look up idempotency record scoped to user or legacy fallback.
        const prior = db
            .prepare(`
      SELECT bill_id, request_hash, response_json
      FROM payment_idempotency
      WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
      ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `)
            .get(idempotencyUserId, idempotencyKey, idempotencyUserId);
        if (prior) {
            if (String(prior.bill_id) !== String(billId) || prior.request_hash !== requestHash) {
                throw paymentValidationError('Idempotency-Key was already used for a different payment request', 'idempotency_conflict', 409);
            }
            try {
                return JSON.parse(prior.response_json);
            }
            catch {
                throw Object.assign(new Error('Stored payment response is invalid'), { statusCode: 500 });
            }
        }
    }
    const { bill, prepared, existingPayments, effectiveCustomerId, idempotentReplay } = preparePaymentBatch(db, billId, payments, bodyCustomerId, allowOmittedAmount);
    if (idempotentReplay) {
        return {
            bill: (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(billId)),
            walletDebited: false,
            loyaltyPointsEarned: 0,
        };
    }
    const wasAlreadyPaid = bill.payment_status === 'paid';
    if (wasAlreadyPaid && prepared.length === 0) {
        const result = {
            bill: (0, db_1.parseRowJson)(bill),
            walletDebited: false,
            loyaltyPointsEarned: 0,
        };
        if (idempotencyKey && requestHash && idempotencyUserId) {
            const existing = db
                .prepare('SELECT 1 FROM payment_idempotency WHERE user_id = ? AND idempotency_key = ?')
                .get(idempotencyUserId, idempotencyKey);
            if (!existing) {
                db.prepare('INSERT INTO payment_idempotency (user_id, idempotency_key, bill_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(idempotencyUserId, idempotencyKey, billId, requestHash, JSON.stringify(result), (0, db_1.now)());
            }
        }
        return result;
    }
    const kitchenStatus = checkKitchenDeliveryStatus(db, bill.order_id, overridePin, clientIp, bill.id, preVerifiedKitchenManager, approverId);
    if (!kitchenStatus.allowed) {
        throw Object.assign(new Error('Kitchen items must be delivered before billing'), {
            statusCode: 409,
            displayCode: 'kitchen_undelivered',
            code: 'KITCHEN_ITEMS_UNDELIVERED',
            undeliveredCount: kitchenStatus.count,
            undeliveredItems: kitchenStatus.items,
        });
    }
    if (kitchenStatus.overridden) {
        (0, db_1.recordOrderAudit)(db, {
            orderId: bill.order_id,
            actorUserId: String(idempotencyUserId),
            action: 'kitchen_delivery_override',
            details: {
                manager_user_id: kitchenStatus.managerUserId,
                undelivered_count: kitchenStatus.count,
            },
        });
    }
    if (prepared.length === 0) {
        const changedAt = (0, db_1.now)();
        if (!bill.customer_id && effectiveCustomerId) {
            db.prepare('UPDATE bills SET customer_id = ?, updated_at = ? WHERE id = ?').run(effectiveCustomerId, changedAt, billId);
        }
        if (bill.payment_status !== 'paid') {
            db.prepare(`UPDATE bills SET payment_status = 'paid', paid_at = COALESCE(paid_at, ?), balance = 0, updated_at = ? WHERE id = ?`).run(changedAt, changedAt, billId);
        }
        // The omitted-amount path can settle an existing exact balance. Route it
        // through the same authoritative completion boundary as every other paid
        // bill so checkout_v1 inventory is not skipped.
        const settledBill = completeExactBalanceSettlement(db, billId, Number(bill.total || 0), getTenantCurrency(), changedAt, overridePin, clientIp, preVerifiedKitchenManager, approverId);
        const settlementResult = reconcileOrderSettlement(db, bill.order_id, changedAt, idempotencyUserId);
        const orderFullyPaid = settlementResult.orderFullyPaid;
        const freshBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
        const effectiveCustId = freshBill.customer_id;
        const cashback = calculateCashback(db, freshBill, effectiveCustId);
        const alreadyCredited = db
            .prepare(`SELECT id, amount FROM loyalty_ledger WHERE bill_id = ? AND type = 'credit'`)
            .get(freshBill.id);
        let loyaltyPointsEarned = settledBill?.loyaltyPointsEarned !== undefined
            ? settledBill.loyaltyPointsEarned
            : alreadyCredited
                ? Number(alreadyCredited.amount)
                : 0;
        if (cashback > 0 && !alreadyCredited) {
            let existingList = [];
            try {
                existingList = JSON.parse(freshBill.payment_details || '[]');
            }
            catch {
                existingList = [];
            }
            const currency = getTenantCurrency();
            const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(currency);
            const totalCents = Math.round(Number(freshBill.total || 0) * minorFactor);
            const walletCents = existingList
                .filter((p) => p.method === 'wallet')
                .reduce((sum, p) => sum + Math.round(Number(p.amount || 0) * minorFactor), 0);
            const finalCashback = Math.floor(cashback * (1 - Math.min(1, walletCents / Math.max(1, totalCents))));
            if (finalCashback > 0) {
                db.prepare(`INSERT INTO loyalty_ledger (customer_id, bill_id, type, amount, description, created_at, updated_at) VALUES (?, ?, 'credit', ?, ?, ?, ?)`).run(effectiveCustId, freshBill.id, finalCashback, `Cashback on bill ${freshBill.bill_number}`, changedAt, changedAt);
                loyaltyPointsEarned = finalCashback;
            }
        }
        const result = {
            bill: (0, db_1.parseRowJson)(freshBill),
            walletDebited: false,
            loyaltyPointsEarned,
            orderFullyPaid,
            ...(kitchenStatus.overridden ? { kitchenDeliveryOverridden: true } : {}),
        };
        if (idempotencyKey && requestHash && idempotencyUserId) {
            db.prepare('INSERT INTO payment_idempotency (user_id, idempotency_key, bill_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(idempotencyUserId, idempotencyKey, billId, requestHash, JSON.stringify(result), changedAt);
        }
        return result;
    }
    // Shift enforcement (#279) runs after replay detection: retrying an already
    // recorded payment must succeed even if its shift has since closed.
    (0, shift_session_gate_1.requireOpenSessionForCashTender)(db, prepared.map((line) => line.payment), idempotencyUserId);
    const activeSessionId = (0, shift_session_gate_1.getOpenSession)(db, idempotencyUserId)?.id ?? shift_session_gate_1.NO_CASH_SESSION_ID;
    const currency = getTenantCurrency();
    const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(currency);
    const totalAppliedCents = prepared.reduce((sum, line) => sum + line.amountCents, 0);
    const oldPaidCents = Math.round(Number(bill.paid_amount || 0) * minorFactor);
    const totalCents = Math.round(Number(bill.total || 0) * minorFactor);
    const newPaidCents = oldPaidCents + totalAppliedCents;
    const newBalanceCents = Math.max(0, totalCents - newPaidCents);
    const paymentStatus = newBalanceCents === 0 ? 'paid' : 'partial';
    const newPayments = prepared.map((line) => ({
        ...line.payment,
        cash_session_id: activeSessionId,
        amount: line.amountCents / minorFactor,
        requested_amount: (line.tenderedCents || line.amountCents) / minorFactor,
        amount_omitted: Boolean(line.amountOmitted),
        ...((0, shift_session_gate_1.isCashTender)(db, line.payment)
            ? {
                tendered_amount: (line.tenderedCents || 0) / minorFactor,
                change_amount: (line.changeCents || 0) / minorFactor,
            }
            : {}),
        timestamp: (0, db_1.now)(),
    }));
    let walletDebited = false;
    for (const line of prepared) {
        if (line.payment.method !== 'wallet' || line.amountCents <= 0)
            continue;
        const pointsSpent = (line.amountCents / minorFactor) * LOYALTY_REDEMPTION_RATE;
        db.prepare(`INSERT INTO loyalty_ledger (customer_id, bill_id, type, amount, description, created_at, updated_at) VALUES (?, ?, 'debit', ?, ?, ?, ?)`).run(effectiveCustomerId, bill.id, pointsSpent, `Payment for bill ${bill.bill_number}`, (0, db_1.now)(), (0, db_1.now)());
        walletDebited = true;
    }
    const allPayments = existingPayments.concat(newPayments);
    const changedAt = (0, db_1.now)();
    const insertTransactionRef = db.prepare('INSERT INTO payment_transaction_refs (method, transaction_id, bill_id, created_at) VALUES (?, ?, ?, ?)');
    for (const line of prepared) {
        if (line.payment.transaction_id) {
            const methodKey = line.payment.payment_method_id === undefined
                ? line.payment.method
                : `custom:${line.payment.payment_method_id}`;
            insertTransactionRef.run(methodKey, line.payment.transaction_id, billId, changedAt);
        }
    }
    if (!bill.customer_id && effectiveCustomerId)
        db.prepare('UPDATE bills SET customer_id = ?, updated_at = ? WHERE id = ?').run(effectiveCustomerId, changedAt, billId);
    db.prepare(`UPDATE bills SET paid_amount = ?, balance = ?, payment_status = ?, payment_details = ?, paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END, updated_at = ? WHERE id = ?`).run(newPaidCents / minorFactor, newBalanceCents / minorFactor, paymentStatus, JSON.stringify(allPayments), paymentStatus, paymentStatus === 'paid' ? changedAt : null, changedAt, billId);
    let loyaltyPointsEarned = 0;
    let orderFullyPaid = false;
    if (paymentStatus === 'paid') {
        // Payment collection and checkout-time consumption must commit together.
        // `completeExactBalanceSettlement` joins this caller's transaction.
        const settledBill = completeExactBalanceSettlement(db, billId, Number(bill.total || 0), currency, changedAt, overridePin, clientIp, preVerifiedKitchenManager, approverId);
        orderFullyPaid = !db
            .prepare(`SELECT 1 FROM bills WHERE order_id = ? AND payment_status NOT IN ('paid', 'refunded', 'partially_refunded') LIMIT 1`)
            .get(bill.order_id);
        const cashback = calculateCashback(db, bill, effectiveCustomerId);
        const alreadyCredited = db
            .prepare(`SELECT id, amount FROM loyalty_ledger WHERE bill_id = ? AND type = 'credit'`)
            .get(bill.id);
        if (settledBill?.loyaltyPointsEarned !== undefined) {
            loyaltyPointsEarned = settledBill.loyaltyPointsEarned;
        }
        else if (alreadyCredited) {
            loyaltyPointsEarned = Number(alreadyCredited.amount);
        }
        if (cashback > 0 && !alreadyCredited) {
            const walletCents = allPayments
                .filter((p) => p.method === 'wallet')
                .reduce((sum, p) => sum + Math.round(Number(p.amount || 0) * minorFactor), 0);
            const finalCashback = Math.floor(cashback * (1 - Math.min(1, walletCents / Math.max(1, totalCents))));
            if (finalCashback > 0) {
                db.prepare(`INSERT INTO loyalty_ledger (customer_id, bill_id, type, amount, description, created_at, updated_at) VALUES (?, ?, 'credit', ?, ?, ?, ?)`).run(effectiveCustomerId, bill.id, finalCashback, `Cashback on bill ${bill.bill_number}`, changedAt, changedAt);
                loyaltyPointsEarned = finalCashback;
            }
        }
    }
    const rawBill = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(billId));
    const fullOrder = rawBill && rawBill.order_id
        ? getOrderWithItems(db, Number(rawBill.order_id), Number(rawBill.id))
        : null;
    const fullCustomer = rawBill?.customer_id
        ? db.prepare('SELECT * FROM customers WHERE id = ?').get(rawBill.customer_id)
        : null;
    const hydratedBill = rawBill
        ? {
            ...addBillLoyaltyFields(db, rawBill),
            order: fullOrder,
            customer: fullCustomer,
        }
        : null;
    const result = {
        bill: hydratedBill,
        walletDebited,
        loyaltyPointsEarned,
        orderFullyPaid,
        ...(kitchenStatus.overridden ? { kitchenDeliveryOverridden: true } : {}),
    };
    if (idempotencyKey && requestHash && idempotencyUserId) {
        db.prepare('INSERT INTO payment_idempotency (user_id, idempotency_key, bill_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(idempotencyUserId, idempotencyKey, billId, requestHash, JSON.stringify(result), changedAt);
    }
    return result;
}
const inFlightPaymentAttempts = new Map();
router.post('/:id/payment', (0, authorization_1.requirePermission)('payments.take'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    let operationCommitted = false;
    let inFlightKey = null;
    let resolveAttempt;
    let rejectAttempt;
    try {
        const payment = req.body;
        if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.payment.create.validation', 'Payment body must be an object', 'payment_input_invalid'));
        }
        const db = (0, db_1.getDatabase)();
        const { override_pin, ...paymentLine } = payment;
        const explicitApproverId = payment.approver_id ||
            payment.manager_id ||
            payment.user_id ||
            req.body.approver_id ||
            req.body.manager_id ||
            req.body.user_id;
        const billId = req.params.id;
        const idempotencyKey = paymentIdempotencyKey(req);
        const authUser = req.user;
        const idempotencyUserId = String(authUser?.userId || '');
        const requestHash = paymentRequestHash(billId, [paymentLine], paymentLine.customer_id);
        // Check idempotency prior to any PIN verification
        if (idempotencyKey && idempotencyUserId) {
            const inFlightAttemptKey = `${idempotencyUserId}:${idempotencyKey}`;
            const prior = db
                .prepare(`
          SELECT bill_id, request_hash, response_json
          FROM payment_idempotency
          WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
          ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
          LIMIT 1
        `)
                .get(idempotencyUserId, idempotencyKey, idempotencyUserId);
            if (prior) {
                if (String(prior.bill_id) !== String(billId) || prior.request_hash !== requestHash) {
                    throw paymentValidationError('Idempotency-Key was already used for a different payment request', 'idempotency_conflict', 409);
                }
                try {
                    return res.json(JSON.parse(prior.response_json));
                }
                catch {
                    throw Object.assign(new Error('Stored payment response is invalid'), {
                        statusCode: 500,
                    });
                }
            }
            while (true) {
                const existingInFlight = inFlightPaymentAttempts.get(inFlightAttemptKey);
                if (existingInFlight) {
                    if (existingInFlight.billId !== String(billId) ||
                        existingInFlight.requestHash !== requestHash) {
                        throw paymentValidationError('Idempotency-Key was already used for a different payment request', 'idempotency_conflict', 409);
                    }
                    try {
                        const sharedResult = await existingInFlight.promise;
                        return res.json(sharedResult);
                    }
                    catch {
                        const committed = db
                            .prepare(`
                SELECT bill_id, request_hash, response_json
                FROM payment_idempotency
                WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
                ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
                LIMIT 1
              `)
                            .get(idempotencyUserId, idempotencyKey, idempotencyUserId);
                        if (committed) {
                            if (String(committed.bill_id) !== String(billId) ||
                                committed.request_hash !== requestHash) {
                                throw paymentValidationError('Idempotency-Key was already used for a different payment request', 'idempotency_conflict', 409);
                            }
                            try {
                                return res.json(JSON.parse(committed.response_json));
                            }
                            catch {
                                throw Object.assign(new Error('Stored payment response is invalid'), {
                                    statusCode: 500,
                                });
                            }
                        }
                        // Payment was not committed by rejected attempt: loop to await newly claimed in-flight attempt or claim it
                        continue;
                    }
                }
                inFlightKey = inFlightAttemptKey;
                const attemptPromise = new Promise((resolve, reject) => {
                    resolveAttempt = resolve;
                    rejectAttempt = reject;
                });
                attemptPromise.catch(() => { });
                inFlightPaymentAttempts.set(inFlightKey, {
                    billId: String(billId),
                    requestHash,
                    promise: attemptPromise,
                });
                break;
            }
        }
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        let preVerifiedKitchenManager = null;
        const billRow = db
            .prepare('SELECT id, order_id, payment_status FROM bills WHERE id = ?')
            .get(billId);
        const isAlreadyPaidNoOp = billRow?.payment_status === 'paid' && Number(paymentLine.amount ?? 0) <= 0;
        const initialKitchenStatus = billRow && !isAlreadyPaidNoOp
            ? checkKitchenDeliveryStatus(db, billRow.order_id, undefined, clientIp, billRow.id)
            : { allowed: true, count: 0, items: [] };
        if (!initialKitchenStatus.allowed && override_pin) {
            try {
                preVerifiedKitchenManager = await preVerifyKitchenDeliveryPin(db, override_pin, clientIp, explicitApproverId);
            }
            catch (pinErr) {
                if (idempotencyKey && idempotencyUserId) {
                    const committed = db
                        .prepare(`
              SELECT bill_id, request_hash, response_json
              FROM payment_idempotency
              WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
              ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
              LIMIT 1
            `)
                        .get(idempotencyUserId, idempotencyKey, idempotencyUserId);
                    if (committed &&
                        String(committed.bill_id) === String(billId) &&
                        committed.request_hash === requestHash) {
                        const parsed = JSON.parse(committed.response_json);
                        resolveAttempt?.(parsed);
                        return res.json(parsed);
                    }
                }
                throw pinErr;
            }
        }
        const result = (0, db_1.withTxn)(() => applyPaymentBatch(db, billId, [paymentLine], paymentLine.customer_id, true, idempotencyKey, requestHash, idempotencyUserId, override_pin, clientIp, preVerifiedKitchenManager, explicitApproverId));
        operationCommitted = true;
        resolveAttempt?.(result);
        if (result.orderFullyPaid) {
            await handlePostPaymentRelease(db, result.bill.order_id, idempotencyUserId);
        }
        const billStatus = result.bill?.payment_status;
        if (billStatus === 'paid') {
            (0, kds_1.notifyKdsUpdate)();
            if (billRow?.payment_status !== 'paid') {
                void whatsapp
                    .triggerBillPaidAutomation(Number(billId), {
                    pointsEarned: result.loyaltyPointsEarned,
                })
                    .catch(() => { });
            }
        }
        else {
            (0, kds_1.notifyOrderUpdated)();
        }
        res.json(result);
    }
    catch (error) {
        rejectAttempt?.(error);
        const statusCode = error.statusCode || 500;
        console.error('[API] Bill payment failed:', error);
        return res.status(statusCode).json({
            ...structuredBillFailure(req, operationCommitted
                ? 'fc.backend.payment.create.completion'
                : statusCode >= 500
                    ? 'fc.backend.payment.create.persistence'
                    : 'fc.backend.payment.create.validation', statusCode >= 500 ? 'Bill payment failed' : error.message, statusCode >= 500 ? undefined : error.displayCode || error.diagnosticCode, operationCommitted ? 'applied' : 'not_applied'),
            ...(error.code
                ? {
                    code: error.code,
                    undeliveredCount: error.undeliveredCount,
                    undeliveredItems: error.undeliveredItems,
                }
                : {}),
        });
    }
    finally {
        if (inFlightKey) {
            inFlightPaymentAttempts.delete(inFlightKey);
        }
    }
}));
// Atomic split-payment batch endpoint applying payment lines in a single transaction.
router.post('/:id/payments', (0, authorization_1.requirePermission)('payments.take'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    let operationCommitted = false;
    let inFlightKey = null;
    let resolveAttempt;
    let rejectAttempt;
    try {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.payment.create.validation', 'Payment batch body must be an object', 'payment_input_invalid'));
        }
        const { payments, customer_id: bodyCustomerId, override_pin } = body;
        const explicitApproverId = body.approver_id ||
            body.manager_id ||
            body.user_id ||
            req.body.approver_id ||
            req.body.manager_id ||
            req.body.user_id;
        const db = (0, db_1.getDatabase)();
        const billId = req.params.id;
        const billCheck = db
            .prepare('SELECT id, order_id, total, balance, payment_status FROM bills WHERE id = ?')
            .get(billId);
        const isZeroDue = billCheck && (Number(billCheck.total || 0) <= 0 || Number(billCheck.balance || 0) <= 0);
        if (!Array.isArray(payments) || (payments.length === 0 && !isZeroDue)) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.payment.create.validation', 'payments must be a non-empty array', 'payment_input_invalid'));
        }
        const idempotencyKey = paymentIdempotencyKey(req);
        const authUser = req.user;
        const idempotencyUserId = String(authUser?.userId || '');
        const requestHash = paymentRequestHash(billId, payments, bodyCustomerId);
        // Check idempotency prior to any PIN verification
        if (idempotencyKey && idempotencyUserId) {
            const inFlightAttemptKey = `${idempotencyUserId}:${idempotencyKey}`;
            const prior = db
                .prepare(`
          SELECT bill_id, request_hash, response_json
          FROM payment_idempotency
          WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
          ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
          LIMIT 1
        `)
                .get(idempotencyUserId, idempotencyKey, idempotencyUserId);
            if (prior) {
                if (String(prior.bill_id) !== String(billId) || prior.request_hash !== requestHash) {
                    throw paymentValidationError('Idempotency-Key was already used for a different payment request', 'idempotency_conflict', 409);
                }
                try {
                    return res.json(JSON.parse(prior.response_json));
                }
                catch {
                    throw Object.assign(new Error('Stored payment response is invalid'), {
                        statusCode: 500,
                    });
                }
            }
            while (true) {
                const existingInFlight = inFlightPaymentAttempts.get(inFlightAttemptKey);
                if (existingInFlight) {
                    if (existingInFlight.billId !== String(billId) ||
                        existingInFlight.requestHash !== requestHash) {
                        throw paymentValidationError('Idempotency-Key was already used for a different payment request', 'idempotency_conflict', 409);
                    }
                    try {
                        const sharedResult = await existingInFlight.promise;
                        return res.json(sharedResult);
                    }
                    catch {
                        const committed = db
                            .prepare(`
                SELECT bill_id, request_hash, response_json
                FROM payment_idempotency
                WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
                ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
                LIMIT 1
              `)
                            .get(idempotencyUserId, idempotencyKey, idempotencyUserId);
                        if (committed) {
                            if (String(committed.bill_id) !== String(billId) ||
                                committed.request_hash !== requestHash) {
                                throw paymentValidationError('Idempotency-Key was already used for a different payment request', 'idempotency_conflict', 409);
                            }
                            try {
                                return res.json(JSON.parse(committed.response_json));
                            }
                            catch {
                                throw Object.assign(new Error('Stored payment response is invalid'), {
                                    statusCode: 500,
                                });
                            }
                        }
                        // Payment was not committed by rejected attempt: loop to await newly claimed in-flight attempt or claim it
                        continue;
                    }
                }
                inFlightKey = inFlightAttemptKey;
                const attemptPromise = new Promise((resolve, reject) => {
                    resolveAttempt = resolve;
                    rejectAttempt = reject;
                });
                attemptPromise.catch(() => { });
                inFlightPaymentAttempts.set(inFlightKey, {
                    billId: String(billId),
                    requestHash,
                    promise: attemptPromise,
                });
                break;
            }
        }
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        let preVerifiedKitchenManager = null;
        const billRow = db
            .prepare('SELECT id, order_id, payment_status FROM bills WHERE id = ?')
            .get(billId);
        const isAlreadyPaidNoOp = billRow?.payment_status === 'paid' && !payments.some((p) => Number(p?.amount ?? 0) > 0);
        const initialKitchenStatus = billRow && !isAlreadyPaidNoOp
            ? checkKitchenDeliveryStatus(db, billRow.order_id, undefined, clientIp, billRow.id)
            : { allowed: true, count: 0, items: [] };
        if (!initialKitchenStatus.allowed && override_pin) {
            try {
                preVerifiedKitchenManager = await preVerifyKitchenDeliveryPin(db, override_pin, clientIp, explicitApproverId);
            }
            catch (pinErr) {
                if (idempotencyKey && idempotencyUserId) {
                    const committed = db
                        .prepare(`
              SELECT bill_id, request_hash, response_json
              FROM payment_idempotency
              WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
              ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
              LIMIT 1
            `)
                        .get(idempotencyUserId, idempotencyKey, idempotencyUserId);
                    if (committed &&
                        String(committed.bill_id) === String(billId) &&
                        committed.request_hash === requestHash) {
                        const parsed = JSON.parse(committed.response_json);
                        resolveAttempt?.(parsed);
                        return res.json(parsed);
                    }
                }
                throw pinErr;
            }
        }
        const result = (0, db_1.withTxn)(() => applyPaymentBatch(db, billId, payments, bodyCustomerId, false, idempotencyKey, requestHash, idempotencyUserId, override_pin, clientIp, preVerifiedKitchenManager, explicitApproverId));
        operationCommitted = true;
        resolveAttempt?.(result);
        if (result.orderFullyPaid) {
            await handlePostPaymentRelease(db, result.bill.order_id, idempotencyUserId);
        }
        const billStatus = result.bill?.payment_status;
        if (billStatus === 'paid') {
            (0, kds_1.notifyKdsUpdate)();
            if (billRow?.payment_status !== 'paid') {
                void whatsapp
                    .triggerBillPaidAutomation(Number(billId), {
                    pointsEarned: result.loyaltyPointsEarned,
                })
                    .catch(() => { });
            }
        }
        else {
            (0, kds_1.notifyOrderUpdated)();
        }
        res.json(result);
    }
    catch (error) {
        rejectAttempt?.(error);
        const statusCode = error.statusCode || 500;
        console.error('[API] Batch bill payment failed:', error);
        return res.status(statusCode).json({
            ...structuredBillFailure(req, operationCommitted
                ? 'fc.backend.payment.create.completion'
                : statusCode >= 500
                    ? 'fc.backend.payment.create.persistence'
                    : 'fc.backend.payment.create.validation', statusCode >= 500 ? 'Bill payment failed' : error.message, statusCode >= 500 ? undefined : error.displayCode || error.diagnosticCode, operationCommitted ? 'applied' : 'not_applied'),
            ...(error.code
                ? {
                    code: error.code,
                    undeliveredCount: error.undeliveredCount,
                    undeliveredItems: error.undeliveredItems,
                }
                : {}),
        });
    }
    finally {
        if (inFlightKey) {
            inFlightPaymentAttempts.delete(inFlightKey);
        }
    }
}));
router.post(['/:id/applyDiscount', '/:id/discount'], (0, authorization_1.requirePermission)('bills.discount.apply'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    let operationCommitted = false;
    try {
        const { type, value, reason, override_pin, approver_id, user_id, manager_id } = req.body;
        const suppliedApproverIds = [approver_id, manager_id, user_id]
            .filter((val) => val !== undefined && val !== null && String(val).trim() !== '')
            .map((val) => String(val).trim());
        if (new Set(suppliedApproverIds).size > 1) {
            return res.status(400).json({ error: 'Conflicting approver identifiers' });
        }
        const explicitApproverId = suppliedApproverIds[0];
        if (!type || !['percentage', 'amount'].includes(type)) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Valid discount type is required (percentage, amount)', 'invalid_type'));
        }
        if (value === undefined ||
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Valid discount value is required', 'invalid_value'));
        }
        const db = (0, db_1.getDatabase)();
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
        if (!bill) {
            return res.status(404).json({ error: 'Bill not found' });
        }
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(bill.order_id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        if ((0, scheduled_orders_1.isScheduledOrderRow)(order) && (0, scheduled_orders_1.hasRecordedOrderPayment)(db, order.id)) {
            return res.status(409).json({
                ...structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Item and financial edits are locked after payment is recorded on a scheduled order. Use the refund or payment correction flow instead.', 'paid'),
                code: 'SCHEDULED_ORDER_PAID',
            });
        }
        if (bill.payment_status === 'refunded' || bill.payment_status === 'partially_refunded') {
            return res
                .status(409)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Cannot apply discount to a refunded bill', 'refunded'));
        }
        if (bill.payment_status === 'paid') {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Cannot apply discount to a paid bill', 'paid'));
        }
        if (bill.split_group_id) {
            return res
                .status(409)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Apply discounts before splitting a bill', 'split_check'));
        }
        if (['completed', 'cancelled'].includes(order.status)) {
            return res
                .status(409)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', `Discounts cannot be changed on a ${order.status} order`, 'order_not_discountable'));
        }
        // Check if approval is required
        let approvedByUserId;
        let preVerifiedPinHash;
        const requiresApproval = (0, db_1.getSettingValue)('discount_requires_approval') === 'true';
        if (requiresApproval && value > 0) {
            const { override_pin } = req.body;
            if (!override_pin) {
                return res
                    .status(403)
                    .json({ error: 'Manager PIN required for discounts', requiresApproval: true });
            }
            const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
            const rateLimitKey = `pin:${canonicalIp}:bill-discount`;
            if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (typeof override_pin !== 'string' || !/^\d{4,6}$/.test(override_pin)) {
                (0, security_1.checkPinRateLimit)(rateLimitKey);
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            const managerId = explicitApproverId;
            const verifiedResult = await (0, security_1.withPinVerificationLock)(rateLimitKey, async () => {
                if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                    return { rateLimited: true };
                }
                let user = null;
                if (managerId) {
                    const candidate = db
                        .prepare("SELECT id, role, pin_hash FROM users WHERE id = ? AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL AND is_active = 1")
                        .get(managerId);
                    if (candidate &&
                        (0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                        (0, authorization_1.hasPermission)(candidate.id, 'bills.discount.apply') &&
                        candidate.pin_hash &&
                        (await (0, db_1.verifyPinAsync)(candidate.pin_hash, override_pin))) {
                        user = candidate;
                    }
                }
                else {
                    const managers = db
                        .prepare("SELECT id, role, pin_hash FROM users WHERE role IN ('owner', 'manager') AND pin_hash IS NOT NULL AND is_active = 1")
                        .all();
                    for (const u of managers) {
                        if ((0, role_permissions_1.hasRole)(u.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                            (0, authorization_1.hasPermission)(u.id, 'bills.discount.apply') &&
                            u.pin_hash &&
                            (await (0, db_1.verifyPinAsync)(u.pin_hash, override_pin))) {
                            user = u;
                            break;
                        }
                    }
                }
                if (!user) {
                    (0, security_1.checkPinRateLimit)(rateLimitKey);
                    return { user: null };
                }
                (0, security_1.clearPinRateLimit)(rateLimitKey);
                return { user };
            });
            if (verifiedResult.rateLimited) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (!verifiedResult.user) {
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            approvedByUserId = verifiedResult.user.id;
            preVerifiedPinHash = verifiedResult.user.pin_hash ?? undefined;
        }
        let preVerifiedKitchenManager = null;
        if (approvedByUserId && preVerifiedPinHash) {
            preVerifiedKitchenManager = { id: approvedByUserId, verifiedPinHash: preVerifiedPinHash };
        }
        else if (override_pin) {
            const initialKitchenStatus = checkKitchenDeliveryStatus(db, bill.order_id, undefined, clientIp, bill.id);
            if (!initialKitchenStatus.allowed) {
                preVerifiedKitchenManager = await preVerifyKitchenDeliveryPin(db, override_pin, clientIp, explicitApproverId);
            }
        }
        // Check discount mode
        const discountMode = (0, db_1.getSettingValue)('discount_mode') || 'percentage';
        if (discountMode === 'none') {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Discounts are disabled', 'disabled'));
        }
        if (discountMode === 'flat' && type === 'percentage') {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Percentage discounts are disabled', 'type_disabled'));
        }
        if (discountMode === 'percentage' && type === 'amount') {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', 'Flat amount discounts are disabled', 'type_disabled'));
        }
        // Check against limits from settings (0 = no limit)
        if (type === 'percentage') {
            const maxPercentage = parseFloat((0, db_1.getSettingValue)('discount_max_percentage') || '25');
            if (maxPercentage > 0 && value > maxPercentage) {
                return res
                    .status(400)
                    .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', `discount value exceeds maximum percentage of ${maxPercentage}`, 'limit_exceeded'));
            }
        }
        else {
            const maxAmount = parseFloat((0, db_1.getSettingValue)('discount_max_amount') || '0');
            if (maxAmount > 0 && value > maxAmount) {
                return res
                    .status(400)
                    .json(structuredBillFailure(req, 'fc.backend.bill.discount.validation', `discount value exceeds maximum amount of ${maxAmount}`, 'limit_exceeded'));
            }
        }
        const currency = getTenantCurrency();
        const decimals = (0, countries_2.getCurrencyFractionDigits)(currency);
        const tenantInfo = {
            country: (0, db_1.getSettingValue)('country') || '',
            business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
            state_code: (0, db_1.getSettingValue)('state_code') || '',
            currency,
            taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
        };
        const pack = (0, tax_1.getActiveCountryPack)(tenantInfo.country);
        const updatedBill = (0, db_1.withTxn)(() => {
            if (approvedByUserId && preVerifiedPinHash) {
                const approver = db
                    .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager')")
                    .get(approvedByUserId);
                if (!approver ||
                    approver.is_active !== 1 ||
                    !(0, role_permissions_1.hasRole)(approver.role, role_permissions_1.ROLE_ACCESS.ownerManager) ||
                    !(0, authorization_1.hasPermission)(approver.id, 'bills.discount.apply') ||
                    approver.pin_hash !== preVerifiedPinHash) {
                    throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
                }
            }
            // Re-read current bill and order under transaction lock to prevent financial state races
            const currentBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
            if (!currentBill) {
                throw Object.assign(new Error('Bill not found'), { statusCode: 404 });
            }
            const currentOrder = db
                .prepare('SELECT * FROM orders WHERE id = ?')
                .get(currentBill.order_id);
            if (!currentOrder) {
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            }
            if ((0, scheduled_orders_1.isScheduledOrderRow)(currentOrder) && (0, scheduled_orders_1.hasRecordedOrderPayment)(db, currentOrder.id)) {
                throw Object.assign(new Error('Item and financial edits are locked after payment is recorded on a scheduled order. Use the refund or payment correction flow instead.'), {
                    statusCode: 409,
                    diagnosticCode: 'paid',
                    code: 'SCHEDULED_ORDER_PAID',
                });
            }
            if (currentBill.payment_status === 'refunded' ||
                currentBill.payment_status === 'partially_refunded') {
                throw Object.assign(new Error('Cannot apply discount to a refunded bill'), {
                    statusCode: 409,
                    diagnosticCode: 'refunded',
                });
            }
            if (currentBill.payment_status === 'paid') {
                throw Object.assign(new Error('Cannot apply discount to a paid bill'), {
                    statusCode: 400,
                    diagnosticCode: 'paid',
                });
            }
            if (currentBill.split_group_id) {
                throw Object.assign(new Error('Apply discounts before splitting a bill'), {
                    statusCode: 409,
                    diagnosticCode: 'split_check',
                });
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error(`Discounts cannot be changed on a ${currentOrder.status} order`), { statusCode: 409, diagnosticCode: 'order_not_discountable' });
            }
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, currentBill.order_id, currentOrder);
            const freshTotals = (0, orders_1.calculateOrderTotals)(db, currentBill.order_id);
            let freshDiscountAmount;
            if (type === 'percentage') {
                freshDiscountAmount = (freshTotals.subtotal * value) / 100;
            }
            else {
                freshDiscountAmount = Math.min(value, freshTotals.subtotal);
            }
            freshDiscountAmount = Number(freshDiscountAmount.toFixed(decimals));
            const freshCustomer = currentBill.customer_id
                ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(currentBill.customer_id) ?? null)
                : null;
            const freshResolvedCharges = (0, charges_1.resolveOrderCharges)({
                definitions: (0, charges_1.getChargeDefinitions)(),
                orderType: currentOrder.type,
                subtotal: freshTotals.subtotal,
                discountAmount: freshDiscountAmount,
                currency,
                existingBreakdown: currentBill.charges_breakdown ?? currentOrder.charges_breakdown,
            });
            const freshAppliedCharges = freshResolvedCharges.configured
                ? freshResolvedCharges.charges
                : undefined;
            const freshServiceCharge = freshResolvedCharges.ownsServiceChargeColumn
                ? freshResolvedCharges.columns.service_charge
                : Number(currentBill.service_charge) || 0;
            const freshPackagingCharge = freshResolvedCharges.ownsPackagingChargeColumn
                ? freshResolvedCharges.columns.packaging_charge
                : Number(currentBill.packaging_charge) || 0;
            const freshChargesBreakdown = freshResolvedCharges.configured
                ? (0, charges_1.serializeAppliedCharges)(freshResolvedCharges.charges)
                : (currentBill.charges_breakdown ?? currentOrder.charges_breakdown ?? null);
            const { taxRollup: freshTaxRollup, total: freshExactTotal } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: {
                    ...currentOrder,
                    packaging_charge: freshPackagingCharge,
                    delivery_charge: currentBill.delivery_charge || 0,
                    service_charge: freshServiceCharge,
                },
                customer: freshCustomer,
                totals: freshTotals,
                discountAmount: freshDiscountAmount,
                taxScaling: 'always',
                appliedCharges: freshAppliedCharges,
            });
            const freshTaxBreakdownJson = JSON.stringify(freshTaxRollup.breakdowns);
            const { total: freshNewTotal, adjustment: freshNewRoundOff } = (0, tax_engine_1.applyPayableRounding)(freshExactTotal, pack, currency);
            const freshPaidAmount = Number(currentBill.paid_amount || 0);
            if (freshPaidAmount > 0 && freshNewTotal < freshPaidAmount) {
                throw Object.assign(new Error('Discount cannot reduce bill total below collected payments'), { statusCode: 409, diagnosticCode: 'below_collected_funds' });
            }
            const freshNewBalance = Math.max(0, freshNewTotal - freshPaidAmount);
            const kitchenStatus = checkKitchenDeliveryStatus(db, currentBill.order_id, override_pin, clientIp, currentBill.id, preVerifiedKitchenManager, explicitApproverId);
            const isNowPaid = freshPaidAmount > 0 && freshNewBalance === 0 && kitchenStatus.allowed;
            db.prepare(`
        UPDATE bills SET subtotal = ?, discount_amount = ?, discount_type = ?, discount_value = ?,
          discount_reason = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?,
          service_charge = ?, packaging_charge = ?, charges_breakdown = ?,
          total = ?, round_off = ?, balance = ?,
          payment_status = CASE WHEN ? = 1 THEN 'paid' ELSE payment_status END,
          paid_at = CASE WHEN ? = 1 THEN COALESCE(paid_at, ?) ELSE paid_at END,
          updated_at = ?
        WHERE id = ?
      `).run(freshTotals.subtotal, freshDiscountAmount, type, value, reason || null, freshTaxRollup.taxAmount, freshTaxBreakdownJson, freshTaxRollup.snapshotJson, freshServiceCharge, freshPackagingCharge, freshChargesBreakdown, freshNewTotal, freshNewRoundOff, freshNewBalance, isNowPaid ? 1 : 0, isNowPaid ? 1 : 0, (0, db_1.now)(), (0, db_1.now)(), req.params.id);
            // orders.total stays the exact, unrounded amount — only the bill (the
            // settlement boundary) holds the pack-rounded payable total (#170).
            db.prepare(`
        UPDATE orders SET subtotal = ?, discount_amount = ?, discount_type = ?, discount_value = ?,
          discount_reason = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?,
          service_charge = ?, packaging_charge = ?, charges_breakdown = ?,
          total = ?, round_off = ?, updated_at = ?
        WHERE id = ?
      `).run(freshTotals.subtotal, freshDiscountAmount, type, value, reason || null, freshTaxRollup.taxAmount, freshTaxBreakdownJson, freshTaxRollup.snapshotJson, freshServiceCharge, freshPackagingCharge, freshChargesBreakdown, freshExactTotal, 0, (0, db_1.now)(), currentBill.order_id);
            if (isNowPaid) {
                completeExactBalanceSettlement(db, String(req.params.id), freshNewTotal, currency, (0, db_1.now)(), override_pin, clientIp, preVerifiedKitchenManager, explicitApproverId);
            }
            if (kitchenStatus.overridden && isNowPaid) {
                (0, db_1.recordOrderAudit)(db, {
                    orderId: String(currentBill.order_id),
                    actorUserId: String(req.user?.userId || ''),
                    action: 'kitchen_delivery_override',
                    details: {
                        manager_user_id: kitchenStatus.managerUserId,
                        undelivered_count: kitchenStatus.count,
                    },
                });
            }
            (0, db_1.recordOrderAudit)(db, {
                orderId: String(currentBill.order_id),
                actorUserId: String(req.user?.userId || ''),
                action: 'order_discount_applied',
                details: {
                    discount_type: type,
                    discount_value: value,
                    ...(approvedByUserId && { approved_by: approvedByUserId }),
                },
            });
            return (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id));
        });
        operationCommitted = true;
        flushPendingExactBalanceAutomations();
        (0, kds_1.notifyOrderUpdated)();
        res.json({ bill: updatedBill });
    }
    catch (error) {
        const statusCode = error.statusCode || 500;
        console.error('[API] Bill discount failed:', error);
        const message = statusCode >= 500 ? 'Internal server error' : error.message;
        if (statusCode === 404 && !operationCommitted)
            return res.status(statusCode).json({ error: message });
        const point = operationCommitted
            ? 'fc.backend.bill.discount.completion'
            : statusCode >= 500
                ? 'fc.backend.bill.discount.persistence'
                : 'fc.backend.bill.discount.validation';
        return res.status(statusCode).json({
            ...structuredBillFailure(req, point, message, operationCommitted ? undefined : error.diagnosticCode, operationCommitted ? 'applied' : 'not_applied'),
            ...(error.code ? { code: error.code } : {}),
        });
    }
}));
/**
 * Cashier waiver / opt-in toggle for one charge on an unpaid, unsplit bill.
 *
 * The waiver is persisted as an explicit `waived` flag rather than being
 * inferred from a zero amount, so an audit can tell a waived fee apart from a
 * fee configured at zero. Split checks are refused: their charges are already
 * allocated proportionally, so mutating one sibling would silently desync the
 * others.
 */
router.patch('/:id/charges', (0, authorization_1.requirePermission)('bills.discount.apply'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    let operationCommitted = false;
    let transactionBodyCompleted = false;
    try {
        const chargeId = String((req.body || {}).charge_id || '')
            .trim()
            .toLowerCase();
        if (!chargeId) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'charge_id is required', 'charge_required'));
        }
        const db = (0, db_1.getDatabase)();
        const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
        if (!bill) {
            return res
                .status(404)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Bill not found', 'bill_not_found'));
        }
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(bill.order_id);
        if (!order) {
            return res
                .status(404)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Order not found', 'order_not_found'));
        }
        if ((0, scheduled_orders_1.isScheduledOrderRow)(order) && (0, scheduled_orders_1.hasRecordedOrderPayment)(db, order.id)) {
            return res.status(409).json({
                ...structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Item and financial edits are locked after payment is recorded on a scheduled order. Use the refund or payment correction flow instead.', 'bill_paid'),
                code: 'SCHEDULED_ORDER_PAID',
            });
        }
        if (bill.split_group_id) {
            return res
                .status(409)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Charges on a split check cannot be changed', 'split_check'));
        }
        if (bill.payment_status === 'paid' || Number(bill.paid_amount || 0) > 0) {
            return res
                .status(409)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Charges cannot be changed on a paid bill', 'bill_paid'));
        }
        if (bill.payment_status === 'refunded' || bill.payment_status === 'partially_refunded') {
            return res
                .status(409)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Charges cannot be changed on a refunded bill', 'bill_refunded'));
        }
        if (order.status === 'cancelled') {
            return res
                .status(409)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Charges cannot be changed on a cancelled order', 'order_cancelled'));
        }
        const definitions = (0, charges_1.getChargeDefinitions)();
        const definition = definitions.find((candidate) => candidate.id === chargeId);
        if (!definition || !definition.is_active) {
            return res
                .status(404)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Charge not found', 'charge_unavailable'));
        }
        if (!definition.order_types.includes(order.type)) {
            return res
                .status(409)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'Charge does not apply to this order type', 'order_type_unsupported'));
        }
        const waivedRequested = (req.body || {}).waived;
        const appliedRequested = (req.body || {}).applied;
        if (waivedRequested === undefined && appliedRequested === undefined) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'waived or applied is required', 'change_required'));
        }
        if (waivedRequested !== undefined && typeof waivedRequested !== 'boolean') {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'waived must be a boolean', 'invalid_change_type'));
        }
        if (appliedRequested !== undefined && typeof appliedRequested !== 'boolean') {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'applied must be a boolean', 'invalid_change_type'));
        }
        if (waivedRequested === true && !definition.is_optional) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'This charge cannot be waived', 'charge_not_waivable'));
        }
        if (appliedRequested === false && definition.is_default_active) {
            return res
                .status(400)
                .json(structuredBillFailure(req, 'fc.backend.bill.charge.validation', 'This charge is applied automatically', 'charge_always_applied'));
        }
        const { override_pin, approver_id, manager_id, user_id } = req.body || {};
        const suppliedApproverIds = [approver_id, manager_id, user_id]
            .filter((val) => val !== undefined && val !== null && String(val).trim() !== '')
            .map((val) => String(val).trim());
        if (new Set(suppliedApproverIds).size > 1) {
            return res.status(400).json({ error: 'Conflicting approver identifiers' });
        }
        const explicitApproverId = suppliedApproverIds[0];
        const callerRole = String(req.user?.role || '');
        const requiresChargeApproval = override_pin !== undefined ||
            (waivedRequested === true && !(0, role_permissions_1.hasRole)(callerRole, role_permissions_1.ROLE_ACCESS.ownerManager));
        let approvedByUserId;
        let preVerifiedChargePinHash;
        if (requiresChargeApproval) {
            if (!override_pin) {
                return res
                    .status(403)
                    .json({ error: 'Manager PIN required to waive charges', requiresApproval: true });
            }
            const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
            const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
            const rateLimitKey = `pin:${canonicalIp}:bill-charge-waiver`;
            if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (typeof override_pin !== 'string' || !/^\d{4,6}$/.test(override_pin)) {
                (0, security_1.checkPinRateLimit)(rateLimitKey);
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            const verifiedResult = await (0, security_1.withPinVerificationLock)(rateLimitKey, async () => {
                if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                    return { rateLimited: true };
                }
                let user = null;
                if (explicitApproverId) {
                    const candidate = db
                        .prepare("SELECT id, role, pin_hash FROM users WHERE id = ? AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL AND is_active = 1")
                        .get(explicitApproverId);
                    if (candidate &&
                        (0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                        (0, authorization_1.hasPermission)(candidate.id, 'bills.discount.apply') &&
                        candidate.pin_hash &&
                        (await (0, db_1.verifyPinAsync)(candidate.pin_hash, override_pin))) {
                        user = candidate;
                    }
                }
                else {
                    const managers = db
                        .prepare("SELECT id, role, pin_hash FROM users WHERE role IN ('owner', 'manager') AND pin_hash IS NOT NULL AND is_active = 1")
                        .all();
                    for (const u of managers) {
                        if ((0, role_permissions_1.hasRole)(u.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                            (0, authorization_1.hasPermission)(u.id, 'bills.discount.apply') &&
                            u.pin_hash &&
                            (await (0, db_1.verifyPinAsync)(u.pin_hash, override_pin))) {
                            user = u;
                            break;
                        }
                    }
                }
                if (!user) {
                    (0, security_1.checkPinRateLimit)(rateLimitKey);
                    return { user: null };
                }
                (0, security_1.clearPinRateLimit)(rateLimitKey);
                return { user };
            });
            if (verifiedResult.rateLimited) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (!verifiedResult.user) {
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            approvedByUserId = verifiedResult.user.id;
            preVerifiedChargePinHash = verifiedResult.user.pin_hash ?? undefined;
        }
        const updated = (0, db_1.withTxn)(() => {
            if (approvedByUserId && preVerifiedChargePinHash) {
                const approver = db
                    .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager')")
                    .get(approvedByUserId);
                if (!approver ||
                    approver.is_active !== 1 ||
                    !(0, role_permissions_1.hasRole)(approver.role, role_permissions_1.ROLE_ACCESS.ownerManager) ||
                    !(0, authorization_1.hasPermission)(approver.id, 'bills.discount.apply') ||
                    approver.pin_hash !== preVerifiedChargePinHash) {
                    throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
                }
            }
            const currentBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id);
            if (!currentBill) {
                throw Object.assign(new Error('Bill not found'), {
                    statusCode: 404,
                    diagnosticCode: 'bill_not_found',
                });
            }
            const currentOrder = db
                .prepare('SELECT * FROM orders WHERE id = ?')
                .get(currentBill.order_id);
            if (!currentOrder) {
                throw Object.assign(new Error('Order not found'), {
                    statusCode: 404,
                    diagnosticCode: 'order_not_found',
                });
            }
            if ((0, scheduled_orders_1.isScheduledOrderRow)(currentOrder) && (0, scheduled_orders_1.hasRecordedOrderPayment)(db, currentOrder.id)) {
                throw Object.assign(new Error('Item and financial edits are locked after payment is recorded on a scheduled order. Use the refund or payment correction flow instead.'), {
                    statusCode: 409,
                    diagnosticCode: 'bill_paid',
                    code: 'SCHEDULED_ORDER_PAID',
                });
            }
            if (currentBill.split_group_id) {
                throw Object.assign(new Error('Charges on a split check cannot be changed'), {
                    statusCode: 409,
                    diagnosticCode: 'split_check',
                });
            }
            if (currentBill.payment_status === 'paid' || Number(currentBill.paid_amount || 0) > 0) {
                throw Object.assign(new Error('Charges cannot be changed on a paid bill'), {
                    statusCode: 409,
                    diagnosticCode: 'bill_paid',
                });
            }
            if (currentBill.payment_status === 'refunded' ||
                currentBill.payment_status === 'partially_refunded') {
                throw Object.assign(new Error('Charges cannot be changed on a refunded bill'), {
                    statusCode: 409,
                    diagnosticCode: 'bill_refunded',
                });
            }
            if (currentOrder.status === 'cancelled') {
                throw Object.assign(new Error('Charges cannot be changed on a cancelled order'), {
                    statusCode: 409,
                    diagnosticCode: 'order_cancelled',
                });
            }
            if (!definition.order_types.includes(currentOrder.type)) {
                throw Object.assign(new Error('Charge does not apply to this order type'), {
                    statusCode: 409,
                    diagnosticCode: 'order_type_unsupported',
                });
            }
            const totals = (0, orders_1.calculateOrderTotals)(db, currentOrder.id);
            const existingBreakdown = currentBill.charges_breakdown ?? currentOrder.charges_breakdown;
            const toggleIds = (0, charges_1.chargeIdsAfterToggle)({
                existingBreakdown,
                definitions,
                toggle: {
                    chargeId,
                    waived: waivedRequested,
                    applied: appliedRequested,
                },
            });
            const resolved = (0, charges_1.resolveOrderCharges)({
                definitions,
                orderType: currentOrder.type,
                subtotal: totals.subtotal,
                discountAmount: currentOrder.discount_amount || 0,
                currency: getTenantCurrency(),
                existingBreakdown,
                waivedIds: toggleIds.waivedIds,
                optedInIds: toggleIds.optedInIds,
            });
            const nextCharges = resolved.charges;
            const decimals = (0, countries_2.getCurrencyFractionDigits)(getTenantCurrency());
            const rawColumns = (0, charges_1.toStandardChargeColumns)(nextCharges, decimals);
            const serviceCharge = resolved.ownsServiceChargeColumn
                ? rawColumns.service_charge
                : Number(currentOrder.service_charge || 0);
            const packagingCharge = resolved.ownsPackagingChargeColumn
                ? rawColumns.packaging_charge
                : Number(currentOrder.packaging_charge || 0);
            const chargesJson = (0, charges_1.serializeAppliedCharges)(nextCharges);
            const customer = currentOrder.customer_id
                ? db
                    .prepare('SELECT * FROM customers WHERE id = ?')
                    .get(currentOrder.customer_id)
                : null;
            const { taxRollup, total } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo: {
                    country: (0, db_1.getSettingValue)('country') || '',
                    business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
                    state_code: (0, db_1.getSettingValue)('state_code') || '',
                    currency: getTenantCurrency(),
                    taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
                },
                chargeContext: {
                    ...currentOrder,
                    service_charge: serviceCharge,
                    packaging_charge: packagingCharge,
                },
                customer,
                totals,
                discountAmount: currentOrder.discount_amount || 0,
                taxScaling: 'when-discounted',
                appliedCharges: nextCharges,
            });
            // The order owns the authoritative breakdown; a bill that never carried one
            // inherits it so the two cannot disagree.
            db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?,
          service_charge = ?, packaging_charge = ?, charges_breakdown = ?, total = ?, updated_at = ? WHERE id = ?
      `).run(totals.subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, currentOrder.discount_amount || 0, serviceCharge, packagingCharge, chargesJson, total, (0, db_1.now)(), currentOrder.id);
            (0, db_1.recordOrderAudit)(db, {
                orderId: String(currentOrder.id),
                actorUserId: String(req.user?.userId || ''),
                action: 'order_charge_updated',
                details: {
                    charge_id: chargeId,
                    waived: waivedRequested,
                    applied: appliedRequested,
                    ...(approvedByUserId ? { approved_by_user_id: approvedByUserId } : {}),
                },
            });
            syncUnpaidBillsForOrder(db, currentOrder.id, {
                subtotal: totals.subtotal,
                taxAmount: taxRollup.taxAmount,
                taxBreakdown: JSON.stringify(taxRollup.breakdowns),
                taxSnapshot: taxRollup.snapshotJson,
                discountAmount: currentOrder.discount_amount || 0,
                deliveryCharge: currentOrder.delivery_charge || 0,
                packagingCharge,
                serviceCharge,
                chargesBreakdown: chargesJson,
                total,
            }, (0, db_1.getSettingValue)('country') || '');
            const updatedBill = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(currentBill.id));
            transactionBodyCompleted = true;
            return updatedBill;
        });
        operationCommitted = true;
        flushPendingExactBalanceAutomations();
        (0, kds_1.notifyOrderUpdated)();
        res.json({ bill: updated });
    }
    catch (error) {
        const statusCode = error.statusCode || 500;
        const diagnosticCode = error.diagnosticCode;
        if (statusCode === 403 && !diagnosticCode) {
            return res.status(403).json({ error: error.message });
        }
        console.error('[API] Bill charge update failed:', error);
        const outcome = operationCommitted
            ? 'applied'
            : transactionBodyCompleted
                ? 'unknown'
                : 'not_applied';
        const capturePoint = diagnosticCode
            ? 'fc.backend.bill.charge.validation'
            : operationCommitted
                ? 'fc.backend.bill.charge.completion'
                : 'fc.backend.bill.charge.persistence';
        res.status(statusCode).json({
            ...structuredBillFailure(req, capturePoint, statusCode >= 500 ? 'Internal server error' : error.message, diagnosticCode, outcome),
            ...(error?.code ? { code: error.code } : {}),
        });
    }
}));
router.post('/:id/markPrinted', (0, authorization_1.requirePermission)('bills.print'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
        if (!bill) {
            return res.status(404).json({ error: 'Bill not found' });
        }
        db.prepare('UPDATE bills SET printed_at = ?, updated_at = ? WHERE id = ?').run((0, db_1.now)(), (0, db_1.now)(), req.params.id);
        const updatedBill = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id));
        res.json({ bill: updatedBill });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/bills/:id/print - Print or reprint bill
router.post('/:id/print', (0, authorization_1.requirePermission)('printing.execute'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const { print_type } = req.body;
        if (!print_type || !['receipt', 'reprint'].includes(print_type)) {
            return res.status(400).json({ error: 'print_type must be receipt or reprint' });
        }
        // User ID is set by the requireAuth middleware after JWT verification
        const userId = req.user?.userId || req.user?.id || 'unknown';
        const result = await (0, receipt_1.printReceipt)(parseInt(req.params.id), userId, print_type);
        res.json(result);
    }
    catch (error) {
        // Return 404 for "Bill not found", 500 for other errors
        const statusCode = error.message?.includes('Bill not found') ? 404 : 500;
        console.error('[API] Receipt printing failed:', error);
        res
            .status(statusCode)
            .json({ error: statusCode >= 500 ? 'Receipt printing failed' : 'Bill not found' });
    }
}));
// GET /api/bills/:id/print-history - Get print history for bill
router.get('/:id/print-history', (0, authorization_1.requirePermission)('bills.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const prints = db
            .prepare(`
      SELECT pl.*, u.name as user_name
      FROM print_logs pl
      LEFT JOIN users u ON pl.user_id = u.id
      WHERE pl.bill_id = ?
      ORDER BY pl.printed_at DESC
    `)
            .all(req.params.id);
        res.json({ prints });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
function resolveBillBusinessDate(db, timestampRaw) {
    let tz = 'UTC';
    try {
        tz = (0, cash_drawer_movements_1.tenantTimezone)();
    }
    catch (error) {
        if (error instanceof countries_1.RegionalNotConfiguredError) {
            tz = (0, db_1.getSettingValue)('timezone') || 'UTC';
        }
        else {
            throw error;
        }
    }
    const startTime = (0, db_1.tenantBusinessDayStartTime)(db);
    if (typeof timestampRaw === 'string' && timestampRaw.trim()) {
        const parsed = (0, db_1.parseDbTimestamp)(timestampRaw);
        if (Number.isFinite(parsed.getTime())) {
            return (0, db_1.localDateInTimezone)(parsed, tz, startTime);
        }
    }
    return (0, db_1.localDateInTimezone)(new Date(), tz, startTime);
}
function correctionPayments(value) {
    if (!value)
        return [];
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return (Array.isArray(parsed) ? parsed : [parsed]);
    }
    catch {
        return [];
    }
}
function paymentMethodCorrectionEligibility(db, bill) {
    const payments = correctionPayments(bill.payment_details);
    if (bill.payment_status !== 'paid') {
        const reason = bill.payment_status === 'refunded' || bill.payment_status === 'partially_refunded'
            ? 'bill_refunded'
            : 'bill_not_paid';
        return {
            correctable: false,
            reason,
            lines: payments.map((_, index) => ({ index, correctable: false, reason })),
        };
    }
    const hasRefund = Boolean(db.prepare('SELECT 1 FROM refunds WHERE bill_id = ? LIMIT 1').get(bill.id));
    if (hasRefund) {
        return {
            correctable: false,
            reason: 'bill_refunded',
            lines: payments.map((_, index) => ({ index, correctable: false, reason: 'bill_refunded' })),
        };
    }
    const siblings = bill.split_group_id
        ? db
            .prepare(`SELECT bills.*, EXISTS(SELECT 1 FROM refunds WHERE refunds.bill_id = bills.id) AS has_refund
                  FROM bills WHERE split_group_id = ? AND id != ?`)
            .all(bill.split_group_id, bill.id)
        : [];
    const siblingLines = siblings.map((sibling) => ({
        sibling,
        lines: correctionPayments(sibling.payment_details),
    }));
    const sessionIds = Array.from(new Set([...payments, ...siblingLines.flatMap((entry) => entry.lines)]
        .filter((line) => line && typeof line === 'object')
        .map((line) => Number(line.cash_session_id))
        .filter((id) => Number.isInteger(id) && id > 0)));
    const sessions = sessionIds.length
        ? db
            .prepare(`SELECT id, status FROM cash_sessions WHERE id IN (${sessionIds.map(() => '?').join(',')})`)
            .all(...sessionIds)
        : [];
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const perStaff = (0, shift_session_gate_1.isPerStaffShiftsEnabled)(db);
    const openSession = perStaff ? undefined : (0, shift_session_gate_1.getOpenSession)(db);
    const today = resolveBillBusinessDate(db);
    const closedDates = new Map();
    const isClosed = (date) => {
        if (!closedDates.has(date))
            closedDates.set(date, (0, cash_drawer_movements_1.closedDayExists)(db, date));
        return closedDates.get(date);
    };
    const lines = payments.map((line, index) => {
        if (!line || typeof line !== 'object') {
            return { index, correctable: false, reason: 'payment_line_not_found' };
        }
        let reason = null;
        if (line.refunded === true || line.status === 'refunded')
            reason = 'payment_line_refunded';
        if (!reason &&
            (isClosed(resolveBillBusinessDate(db, line.timestamp || bill.paid_at || bill.created_at)) ||
                isClosed(today)))
            reason = 'day_closed';
        const sessionId = Number(line?.cash_session_id);
        const session = sessionsById.get(sessionId);
        if (!reason &&
            (!Number.isInteger(sessionId) ||
                sessionId <= 0 ||
                !session ||
                session.status !== 'open' ||
                (!perStaff && session.id !== openSession?.id)))
            reason = 'shift_closed';
        if (!reason) {
            for (const entry of siblingLines) {
                if (entry.sibling.payment_status === 'refunded' ||
                    entry.sibling.payment_status === 'partially_refunded' ||
                    entry.sibling.has_refund) {
                    reason = 'split_sibling_refunded';
                    break;
                }
                for (const item of entry.lines) {
                    if (!item || typeof item !== 'object')
                        continue;
                    if (item.refunded === true || item.status === 'refunded') {
                        reason = 'split_sibling_refunded';
                        break;
                    }
                    const id = Number(item.cash_session_id);
                    const siblingSession = sessionsById.get(id);
                    if (!Number.isInteger(id) ||
                        id <= 0 ||
                        !siblingSession ||
                        siblingSession.status !== 'open' ||
                        id !== sessionId) {
                        reason = 'split_sibling_shift_closed';
                        break;
                    }
                }
                if (reason)
                    break;
            }
        }
        if (!reason && String(line.method || '').toLowerCase() === 'wallet')
            reason = 'wallet_method_immutable';
        return { index, correctable: !reason, reason };
    });
    const correctable = lines.some((line) => line.correctable);
    return {
        correctable,
        reason: correctable ? null : lines[0]?.reason || 'payment_line_not_found',
        lines,
    };
}
// PATCH /api/bills/:id/payments/:index/method - Correct payment method on a paid bill while its shift is open
router.patch('/:id/payments/:index/method', (0, authorization_1.requirePermission)('payments.take'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const callerUser = req.user;
        const rawActorUserId = String(callerUser?.userId || callerUser?.id || '').trim();
        const callerRow = rawActorUserId
            ? db
                .prepare("SELECT id, role, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager') AND is_active = 1")
                .get(rawActorUserId)
            : undefined;
        if (!callerRow ||
            callerRow.is_active !== 1 ||
            !(0, role_permissions_1.hasRole)(callerRow.role, role_permissions_1.ROLE_ACCESS.ownerManager) ||
            (callerUser?.role !== undefined && !(0, role_permissions_1.hasRole)(callerUser.role, role_permissions_1.ROLE_ACCESS.ownerManager))) {
            return res.status(403).json({
                error: 'Only owners and managers can correct payment methods',
                reason: 'insufficient_role_permissions',
                code: 'insufficient_role_permissions',
            });
        }
        const billId = String(req.params.id);
        const indexRaw = String(req.params.index ?? '').trim();
        if (!/^\d+$/.test(indexRaw)) {
            return res.status(400).json({
                error: 'Invalid payment line index',
                reason: 'invalid_payment_index',
                code: 'invalid_payment_index',
            });
        }
        const paymentIndex = Number(indexRaw);
        if (!Number.isSafeInteger(paymentIndex) || paymentIndex < 0) {
            return res.status(400).json({
                error: 'Invalid payment line index',
                reason: 'invalid_payment_index',
                code: 'invalid_payment_index',
            });
        }
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({
                error: 'Request body must be a JSON object',
                reason: 'payment_input_invalid',
                code: 'payment_input_invalid',
            });
        }
        const idempotencyKey = paymentIdempotencyKey(req);
        const { method, payment_method_id, transaction_id, reason, override_pin, approver_id, manager_id, user_id, amount: requestedAmount, } = req.body;
        const suppliedApproverIds = [approver_id, manager_id, user_id]
            .filter((val) => val !== undefined && val !== null && String(val).trim() !== '')
            .map((val) => String(val).trim());
        if (new Set(suppliedApproverIds).size > 1) {
            return res.status(400).json({
                error: 'Conflicting approver identifiers',
                reason: 'conflicting_approver_ids',
                code: 'conflicting_approver_ids',
            });
        }
        const explicitApproverId = suppliedApproverIds[0];
        if (reason !== undefined && reason !== null) {
            if (typeof reason !== 'string' || reason.trim().length > 500) {
                return res.status(400).json({
                    error: 'Reason must be a string up to 500 characters',
                    reason: 'invalid_reason',
                    code: 'invalid_reason',
                });
            }
        }
        const normalizedReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
        if (typeof override_pin !== 'string' || !/^\d{4,6}$/.test(override_pin)) {
            return res.status(403).json({
                error: 'Owner or manager approval PIN is required',
                reason: 'pin_required',
                code: 'pin_required',
            });
        }
        const clientIp = req.ip ||
            req.headers['x-forwarded-for'] ||
            req.socket.remoteAddress ||
            'unknown';
        const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
        const rateLimitKey = `pin:${canonicalIp}:payment-method-correction`;
        if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
            return res.status(429).json({
                error: 'Too many PIN attempts. Try again in 15 minutes.',
                reason: 'pin_rate_limited',
                code: 'pin_rate_limited',
            });
        }
        const preVerifiedResult = await (0, security_1.withPinVerificationLock)(rateLimitKey, async () => {
            if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                return { rateLimited: true };
            }
            const candidates = explicitApproverId
                ? db
                    .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager') AND is_active = 1 AND pin_hash IS NOT NULL")
                    .all(explicitApproverId)
                : db
                    .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE role IN ('owner', 'manager') AND is_active = 1 AND pin_hash IS NOT NULL")
                    .all();
            for (const candidate of candidates) {
                if (candidate.is_active === 1 &&
                    (0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                    candidate.pin_hash &&
                    (await (0, db_1.verifyPinAsync)(candidate.pin_hash, override_pin))) {
                    (0, security_1.clearPinRateLimit)(rateLimitKey);
                    return {
                        approver: { id: candidate.id, verifiedPinHash: candidate.pin_hash },
                    };
                }
            }
            (0, security_1.checkPinRateLimit)(rateLimitKey);
            return { approver: null };
        });
        if ('rateLimited' in preVerifiedResult && preVerifiedResult.rateLimited) {
            return res.status(429).json({
                error: 'Too many PIN attempts. Try again in 15 minutes.',
                reason: 'pin_rate_limited',
                code: 'pin_rate_limited',
            });
        }
        if (!preVerifiedResult.approver) {
            return res.status(403).json({
                error: 'Invalid manager or owner approval PIN',
                reason: 'invalid_pin',
                code: 'invalid_pin',
            });
        }
        const preVerifiedApprover = preVerifiedResult.approver;
        const result = (0, db_1.withTxn)(() => {
            const liveCaller = db
                .prepare("SELECT id, role, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager') AND is_active = 1")
                .get(rawActorUserId);
            if (!liveCaller ||
                liveCaller.is_active !== 1 ||
                !(0, role_permissions_1.hasRole)(liveCaller.role, role_permissions_1.ROLE_ACCESS.ownerManager) ||
                !(0, authorization_1.hasPermission)(liveCaller.id, 'payments.take')) {
                throw paymentValidationError('Only owners and managers can correct payment methods', 'insufficient_role_permissions', 403);
            }
            const verifiedApprover = db
                .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager') AND is_active = 1 AND pin_hash IS NOT NULL")
                .get(preVerifiedApprover.id);
            if (!verifiedApprover ||
                verifiedApprover.is_active !== 1 ||
                !(0, role_permissions_1.hasRole)(verifiedApprover.role, role_permissions_1.ROLE_ACCESS.ownerManager) ||
                verifiedApprover.pin_hash !== preVerifiedApprover.verifiedPinHash) {
                throw paymentValidationError('Invalid manager or owner approval PIN', 'invalid_pin', 403);
            }
            const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
            if (!bill) {
                throw paymentValidationError('Bill not found', 'bill_not_found', 404);
            }
            const effectiveActorUserId = liveCaller.id;
            const idempotencyUserId = liveCaller.id;
            const normalizedReqMethod = typeof method === 'string' ? method.trim().toLowerCase() : '';
            const normalizedReqPaymentMethodId = payment_method_id !== undefined &&
                payment_method_id !== null &&
                Number.isSafeInteger(Number(payment_method_id))
                ? Number(payment_method_id)
                : null;
            const normalizedReqTxId = typeof transaction_id === 'string' && transaction_id.trim() !== ''
                ? transaction_id.trim()
                : null;
            const requestHash = idempotencyKey
                ? (0, crypto_1.createHash)('sha256')
                    .update(canonicalizePaymentRequest({
                    action: 'bill.payment_method.corrected',
                    billId: String(bill.id),
                    paymentIndex,
                    method: normalizedReqMethod,
                    payment_method_id: normalizedReqPaymentMethodId,
                    transaction_id: normalizedReqTxId,
                    reason: normalizedReason,
                }))
                    .digest('hex')
                : null;
            if (idempotencyKey && requestHash) {
                const existingIdem = db
                    .prepare('SELECT bill_id, request_hash, response_json FROM payment_idempotency WHERE user_id = ? AND idempotency_key = ?')
                    .get(idempotencyUserId, idempotencyKey);
                if (existingIdem) {
                    if (String(existingIdem.bill_id) !== String(bill.id) ||
                        existingIdem.request_hash !== requestHash) {
                        throw paymentValidationError('Idempotency-Key has already been used for a different payment request', 'idempotency_key_conflict', 409);
                    }
                    const cached = JSON.parse(existingIdem.response_json);
                    return { ...cached, idempotentReplay: true };
                }
            }
            const existingPayments = correctionPayments(bill.payment_details);
            const eligibility = paymentMethodCorrectionEligibility(db, bill);
            const lineEligibility = eligibility.lines[paymentIndex];
            const earlyReason = eligibility.reason === 'bill_refunded' || eligibility.reason === 'bill_not_paid'
                ? eligibility.reason
                : !lineEligibility
                    ? 'payment_line_not_found'
                    : lineEligibility.reason === 'payment_line_refunded' ||
                        lineEligibility.reason === 'payment_line_not_found'
                        ? lineEligibility.reason
                        : null;
            const correctionErrors = {
                bill_refunded: ['Cannot correct payment method on a refunded bill', 409],
                bill_not_paid: ['Payment method can only be corrected on a paid bill', 409],
                payment_line_not_found: ['Payment line not found', 404],
                payment_line_refunded: ['Cannot correct payment method on a refunded payment line', 409],
                day_closed: ['Cannot correct payment method: business day is already closed', 409],
                shift_closed: [
                    'Cannot correct payment method: the shift for this payment is closed',
                    409,
                ],
                split_sibling_refunded: [
                    'Cannot correct payment method: a split sibling check has been refunded',
                    409,
                ],
                split_sibling_shift_closed: [
                    'Cannot correct payment method: a split sibling check was settled in a closed or different shift',
                    409,
                ],
                wallet_method_immutable: ['Cannot correct payment method on a wallet payment line', 409],
            };
            const rejectCorrection = (reason) => {
                const [message, status] = correctionErrors[reason];
                throw paymentValidationError(message, reason, status);
            };
            if (earlyReason)
                rejectCorrection(earlyReason);
            const targetLine = existingPayments[paymentIndex];
            if (requestedAmount !== undefined && requestedAmount !== null) {
                const currency = getTenantCurrency();
                const minorFactor = (0, countries_2.getCurrencyMinorUnitFactor)(currency);
                const reqNum = Number(requestedAmount);
                const lineCents = Math.round(Number(targetLine.amount || 0) * minorFactor);
                const reqCents = Math.round(reqNum * minorFactor);
                if (!Number.isFinite(reqNum) || reqCents !== lineCents) {
                    throw paymentValidationError('Payment amount cannot be changed when correcting payment method', 'amount_immutable', 400);
                }
            }
            if (lineEligibility.reason)
                rejectCorrection(lineEligibility.reason);
            const effectiveSessionId = Number(targetLine.cash_session_id);
            const rawMethod = typeof method === 'string' ? method.trim() : '';
            if (!rawMethod || rawMethod.length > 60) {
                throw paymentValidationError('Payment method is required', 'payment_input_invalid', 400);
            }
            if (rawMethod.toLowerCase() === 'wallet') {
                throw paymentValidationError('Cannot change payment method to wallet', 'wallet_method_immutable', 400);
            }
            let resolvedMethod;
            let resolvedPaymentMethodId;
            if ((rawMethod === 'cash' || rawMethod === 'card') &&
                (payment_method_id === undefined || payment_method_id === null)) {
                resolvedMethod = rawMethod;
                resolvedPaymentMethodId = undefined;
            }
            else if (rawMethod.toLowerCase() === 'upi' &&
                (payment_method_id === undefined || payment_method_id === null)) {
                const configured = db
                    .prepare("SELECT id, name, is_active FROM payment_methods WHERE lower(name) = 'upi' AND is_active = 1")
                    .get();
                if (configured) {
                    resolvedMethod = configured.name;
                    resolvedPaymentMethodId = Number(configured.id);
                }
                else {
                    resolvedMethod = 'UPI';
                    resolvedPaymentMethodId = undefined;
                }
            }
            else if (rawMethod === 'custom') {
                if (payment_method_id === undefined ||
                    payment_method_id === null ||
                    !Number.isSafeInteger(Number(payment_method_id))) {
                    throw paymentValidationError('Custom payment method id is required', 'payment_method_unavailable', 400);
                }
                const configured = db
                    .prepare('SELECT id, name, is_active FROM payment_methods WHERE id = ?')
                    .get(Number(payment_method_id));
                if (!configured) {
                    throw paymentValidationError('Unsupported custom payment method', 'payment_method_unavailable', 400);
                }
                if (configured.is_active !== 1) {
                    throw paymentValidationError('Custom payment method is inactive', 'payment_method_inactive', 409);
                }
                resolvedMethod = configured.name;
                resolvedPaymentMethodId = Number(configured.id);
            }
            else if (payment_method_id !== undefined && payment_method_id !== null) {
                if (!Number.isSafeInteger(Number(payment_method_id))) {
                    throw paymentValidationError('Invalid custom payment method id', 'payment_method_unavailable', 400);
                }
                const configured = db
                    .prepare('SELECT id, name, is_active FROM payment_methods WHERE id = ?')
                    .get(Number(payment_method_id));
                if (!configured || configured.name.toLowerCase() !== rawMethod.toLowerCase()) {
                    throw paymentValidationError('Unsupported custom payment method', 'payment_method_unavailable', 400);
                }
                if (configured.is_active !== 1) {
                    throw paymentValidationError('Custom payment method is inactive', 'payment_method_inactive', 409);
                }
                resolvedMethod = configured.name;
                resolvedPaymentMethodId = Number(configured.id);
            }
            else {
                const configured = db
                    .prepare('SELECT id, name, is_active FROM payment_methods WHERE lower(name) = lower(?)')
                    .get(rawMethod);
                if (!configured) {
                    throw paymentValidationError('Unsupported payment method', 'payment_method_unavailable', 400);
                }
                if (configured.is_active !== 1) {
                    throw paymentValidationError('Custom payment method is inactive', 'payment_method_inactive', 409);
                }
                resolvedMethod = configured.name;
                resolvedPaymentMethodId = Number(configured.id);
            }
            let newTxId;
            if (transaction_id !== undefined && transaction_id !== null) {
                if (typeof transaction_id !== 'string' || transaction_id.length > 256) {
                    throw paymentValidationError('transaction_id is invalid or too long', 'payment_input_invalid', 400);
                }
                const trimmed = transaction_id.trim();
                if (trimmed.length > 0) {
                    newTxId = trimmed;
                }
            }
            if (resolvedMethod === 'card' &&
                resolvedPaymentMethodId === undefined &&
                (0, db_1.getSettingValue)('card_transaction_id_required') === 'true' &&
                !newTxId) {
                throw paymentValidationError('Card transaction_id is required', 'card_transaction_id_required', 400);
            }
            const oldMethod = String(targetLine.method || '');
            const oldPaymentMethodId = targetLine.payment_method_id !== undefined && targetLine.payment_method_id !== null
                ? Number(targetLine.payment_method_id)
                : undefined;
            const oldTxId = typeof targetLine.transaction_id === 'string' && targetLine.transaction_id.trim() !== ''
                ? targetLine.transaction_id.trim()
                : undefined;
            const isSameMethod = oldMethod === resolvedMethod &&
                (oldPaymentMethodId ?? null) === (resolvedPaymentMethodId ?? null) &&
                (oldTxId ?? null) === (newTxId ?? null);
            if (isSameMethod) {
                const latestAuditRow = db
                    .prepare(`SELECT id, actor_user_id, action, details_json, created_at
               FROM order_audit_log
               WHERE order_id = ?
                 AND action = 'bill.payment_method.corrected'
                 AND json_extract(details_json, '$.bill_id') = ?
                 AND json_extract(details_json, '$.payment_index') = ?
               ORDER BY id DESC
               LIMIT 1`)
                    .get(bill.order_id, bill.id, paymentIndex);
                let parsedAuditDetails = {};
                if (latestAuditRow?.details_json) {
                    try {
                        parsedAuditDetails = JSON.parse(latestAuditRow.details_json);
                    }
                    catch {
                        parsedAuditDetails = {};
                    }
                }
                const replayPayload = {
                    bill: (0, db_1.parseRowJson)(bill),
                    audit: latestAuditRow
                        ? {
                            id: latestAuditRow.id,
                            order_id: bill.order_id,
                            bill_id: bill.id,
                            actor_user_id: latestAuditRow.actor_user_id,
                            action: latestAuditRow.action,
                            ...parsedAuditDetails,
                            created_at: latestAuditRow.created_at,
                        }
                        : null,
                    idempotentReplay: true,
                };
                if (idempotencyKey && requestHash) {
                    db.prepare('INSERT INTO payment_idempotency (user_id, idempotency_key, bill_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(idempotencyUserId, idempotencyKey, String(bill.id), requestHash, JSON.stringify(replayPayload), (0, db_1.now)());
                }
                return replayPayload;
            }
            const oldMethodKey = oldPaymentMethodId === undefined ? oldMethod : `custom:${oldPaymentMethodId}`;
            const newMethodKey = resolvedPaymentMethodId === undefined
                ? resolvedMethod
                : `custom:${resolvedPaymentMethodId}`;
            if (newTxId) {
                const existingRef = db
                    .prepare('SELECT bill_id FROM payment_transaction_refs WHERE method = ? AND transaction_id = ?')
                    .get(newMethodKey, newTxId);
                if (existingRef && String(existingRef.bill_id) !== String(bill.id)) {
                    throw paymentValidationError('Payment transaction_id has already been used for another bill', 'transaction_reference_used', 409);
                }
                const duplicateOnSameBill = existingPayments.some((line, idx) => {
                    if (idx === paymentIndex || !line || typeof line !== 'object')
                        return false;
                    const lineMethodKey = line.payment_method_id === undefined || line.payment_method_id === null
                        ? String(line.method || '')
                        : `custom:${Number(line.payment_method_id)}`;
                    return lineMethodKey === newMethodKey && line.transaction_id === newTxId;
                });
                if (duplicateOnSameBill) {
                    throw paymentValidationError('Payment transaction_id has already been used for this bill', 'transaction_reference_reused', 409);
                }
            }
            const changedAt = (0, db_1.now)();
            const updatedLine = {
                ...targetLine,
                method: resolvedMethod,
                cash_session_id: effectiveSessionId,
            };
            if (resolvedPaymentMethodId !== undefined) {
                updatedLine.payment_method_id = resolvedPaymentMethodId;
            }
            else {
                delete updatedLine.payment_method_id;
            }
            if (newTxId !== undefined) {
                updatedLine.transaction_id = newTxId;
            }
            else {
                delete updatedLine.transaction_id;
            }
            const newIsCash = (0, shift_session_gate_1.isCashTender)(db, {
                method: resolvedMethod,
                payment_method_id: resolvedPaymentMethodId,
            });
            if (newIsCash) {
                updatedLine.tendered_amount = Number(targetLine.amount);
                updatedLine.change_amount = 0;
                updatedLine.requested_amount = Number(targetLine.amount);
            }
            else {
                delete updatedLine.tendered_amount;
                delete updatedLine.change_amount;
                updatedLine.requested_amount = Number(targetLine.amount);
            }
            const updatedPayments = existingPayments.map((line, idx) => idx === paymentIndex ? updatedLine : line);
            if (oldTxId) {
                const stillUsedOnSameBill = updatedPayments.some((line, idx) => {
                    if (idx === paymentIndex || !line || typeof line !== 'object')
                        return false;
                    const lineMethodKey = line.payment_method_id === undefined || line.payment_method_id === null
                        ? String(line.method || '')
                        : `custom:${Number(line.payment_method_id)}`;
                    return lineMethodKey === oldMethodKey && line.transaction_id === oldTxId;
                });
                if (!stillUsedOnSameBill) {
                    db.prepare('DELETE FROM payment_transaction_refs WHERE method = ? AND transaction_id = ? AND bill_id = ?').run(oldMethodKey, oldTxId, String(bill.id));
                }
            }
            if (newTxId) {
                db.prepare('INSERT OR REPLACE INTO payment_transaction_refs (method, transaction_id, bill_id, created_at) VALUES (?, ?, ?, ?)').run(newMethodKey, newTxId, String(bill.id), changedAt);
            }
            db.prepare('UPDATE bills SET payment_details = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(updatedPayments), changedAt, bill.id);
            const auditDetails = {
                bill_id: bill.id,
                bill_number: bill.bill_number,
                order_id: bill.order_id,
                payment_index: paymentIndex,
                amount: Number(targetLine.amount),
                old_method: oldMethod,
                old_payment_method_id: oldPaymentMethodId ?? null,
                old_transaction_id: oldTxId ?? null,
                new_method: resolvedMethod,
                new_payment_method_id: resolvedPaymentMethodId ?? null,
                new_transaction_id: newTxId ?? null,
                actor_id: rawActorUserId || effectiveActorUserId,
                approver_id: verifiedApprover.id,
                approved_by: verifiedApprover.id,
                reason: normalizedReason,
                cash_session_id: effectiveSessionId,
                idempotency_key: idempotencyKey ?? null,
                timestamp: changedAt,
            };
            (0, db_1.recordOrderAudit)(db, {
                orderId: bill.order_id,
                actorUserId: effectiveActorUserId,
                action: 'bill.payment_method.corrected',
                details: auditDetails,
            });
            const insertedAudit = db
                .prepare(`SELECT id, created_at FROM order_audit_log WHERE order_id = ? AND action = 'bill.payment_method.corrected' ORDER BY id DESC LIMIT 1`)
                .get(bill.order_id);
            const updatedBill = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id));
            const responsePayload = {
                bill: updatedBill,
                audit: {
                    id: insertedAudit?.id ?? null,
                    actor_user_id: effectiveActorUserId,
                    action: 'bill.payment_method.corrected',
                    ...auditDetails,
                    created_at: insertedAudit?.created_at ?? changedAt,
                },
            };
            if (idempotencyKey && requestHash) {
                db.prepare('INSERT INTO payment_idempotency (user_id, idempotency_key, bill_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(idempotencyUserId, idempotencyKey, String(bill.id), requestHash, JSON.stringify(responsePayload), changedAt);
            }
            return responsePayload;
        });
        (0, kds_1.notifyOrderUpdated)();
        return res.json(result);
    }
    catch (error) {
        const err = error;
        const statusCode = typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
            ? err.statusCode
            : 500;
        const reasonCode = typeof err?.displayCode === 'string' && err.displayCode
            ? err.displayCode
            : statusCode >= 500
                ? 'internal_error'
                : 'validation_failed';
        if (statusCode >= 500) {
            console.error('[API] Payment method correction failed:', error);
        }
        return res.status(statusCode).json({
            error: statusCode >= 500 ? 'Internal server error' : String(err?.message ?? ''),
            reason: reasonCode,
            code: reasonCode,
        });
    }
}));
exports.billRoutes = router;
//# sourceMappingURL=bills.js.map