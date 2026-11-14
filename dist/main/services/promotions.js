"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePromotionRow = parsePromotionRow;
exports.isProductEligibleForPromotion = isProductEligibleForPromotion;
exports.isPromotionActiveAndValid = isPromotionActiveAndValid;
exports.checkCustomerLoyaltyRewardEligibility = checkCustomerLoyaltyRewardEligibility;
exports.calculatePromotionDiscount = calculatePromotionDiscount;
exports.applyPromotionToOrder = applyPromotionToOrder;
exports.removePromotionFromOrder = removePromotionFromOrder;
exports.recordPromotionRedemptionOnCheckout = recordPromotionRedemptionOnCheckout;
exports.getPromotionReportsSummary = getPromotionReportsSummary;
const db_1 = require("../db");
const bills_1 = require("../routes/bills");
const countries_1 = require("../countries");
const orders_1 = require("./orders");
const orders_2 = require("../routes/orders");
const tax_1 = require("./tax");
const tax_engine_1 = require("./tax-engine");
const recipes_1 = require("./recipes");
const inventory_1 = require("./inventory");
const packaging_1 = require("./packaging");
const kds_1 = require("./kds");
function parsePromotionRow(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        discount_type: row.discount_type,
        target_type: row.target_type,
        target_category_id: row.target_category_id,
        discount_value: Number(row.discount_value || 0),
        bogo_buy_qty: Number(row.bogo_buy_qty || 1),
        bogo_get_qty: Number(row.bogo_get_qty || 1),
        bogo_pricing_rule: row.bogo_pricing_rule,
        is_loyalty_reward: Boolean(row.is_loyalty_reward),
        loyalty_qualifying_visits_required: Number(row.loyalty_qualifying_visits_required || 5),
        start_at: row.start_at,
        end_at: row.end_at,
        is_active: Boolean(row.is_active),
        is_automatic: Boolean(row.is_automatic),
        max_redemptions: row.max_redemptions !== null ? Number(row.max_redemptions) : null,
        current_redemptions_count: Number(row.current_redemptions_count || 0),
        created_by: row.created_by,
        updated_by: row.updated_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
/** Check if product qualifies for promotion */
function isProductEligibleForPromotion(db, promotion, productId, productName, categoryId) {
    if (promotion.target_type === 'all')
        return true;
    if (promotion.target_type === 'all_pancakes') {
        let catName = '';
        if (categoryId) {
            const cat = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId);
            catName = cat?.name || '';
        }
        else {
            const prod = db
                .prepare('SELECT p.name, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?')
                .get(productId);
            if (prod) {
                catName = prod.category_name || '';
                productName = productName || prod.name;
            }
        }
        const isCategoryPancake = /pancake/i.test(catName);
        const isNamePancake = productName ? /pancake/i.test(productName) : false;
        return isCategoryPancake || isNamePancake;
    }
    if (promotion.target_type === 'category') {
        if (!promotion.target_category_id)
            return false;
        if (categoryId)
            return categoryId === promotion.target_category_id;
        const prod = db.prepare('SELECT category_id FROM products WHERE id = ?').get(productId);
        return prod?.category_id === promotion.target_category_id;
    }
    if (promotion.target_type === 'products') {
        const exists = db
            .prepare('SELECT 1 FROM promotion_products WHERE promotion_id = ? AND product_id = ?')
            .get(promotion.id, productId);
        return Boolean(exists);
    }
    return false;
}
/** Check if promotion is active and within valid date window */
function isPromotionActiveAndValid(promotion, refDate = new Date()) {
    if (!promotion.is_active) {
        return { valid: false, reason: 'Promotion is inactive' };
    }
    const nowTime = refDate.getTime();
    if (promotion.start_at) {
        const startTime = new Date(promotion.start_at).getTime();
        if (nowTime < startTime) {
            return { valid: false, reason: 'Promotion has not started yet' };
        }
    }
    if (promotion.end_at) {
        const endTime = new Date(promotion.end_at).getTime();
        if (nowTime > endTime) {
            return { valid: false, reason: 'Promotion has expired' };
        }
    }
    if (promotion.max_redemptions !== null &&
        promotion.current_redemptions_count >= promotion.max_redemptions) {
        return { valid: false, reason: 'Promotion maximum redemptions reached' };
    }
    return { valid: true };
}
/**
 * Validates loyalty eligibility for 6th-visit BOGO reward.
 * Requires 5 qualifying paid visits since the last loyalty reward redemption.
 * A redeemed reward visit does NOT count as a qualifying paid visit.
 */
function checkCustomerLoyaltyRewardEligibility(db, customerId, targetOrderId) {
    if (!customerId) {
        return {
            eligible: false,
            reason: 'Customer required for loyalty reward',
            qualifyingPaidVisits: 0,
            visitsRequired: 5,
            visitsNeeded: 5,
            isSixthVisitReward: false,
        };
    }
    const lastRedemption = db
        .prepare(`SELECT MAX(created_at) as last_redeemed_at
       FROM promotion_redemptions
       WHERE customer_id = ? AND is_loyalty_reward = 1`)
        .get(customerId);
    const lastRedeemedAt = lastRedemption?.last_redeemed_at || null;
    let query = `
    SELECT COUNT(DISTINCT b.order_id) AS visit_count
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    WHERE COALESCE(b.customer_id, o.customer_id) = ?
      AND b.payment_status = 'paid'
      AND o.id NOT IN (
        SELECT order_id FROM promotion_redemptions
        WHERE is_loyalty_reward = 1 AND order_id IS NOT NULL
      )
  `;
    const params = [customerId];
    if (lastRedeemedAt) {
        query += ` AND b.created_at > ?`;
        params.push(lastRedeemedAt);
    }
    if (targetOrderId) {
        query += ` AND o.id != ?`;
        params.push(targetOrderId);
    }
    const result = db.prepare(query).get(...params);
    const qualifyingVisits = Number(result?.visit_count || 0);
    const visitsRequired = 5;
    const eligible = qualifyingVisits >= visitsRequired;
    const visitsNeeded = Math.max(0, visitsRequired - qualifyingVisits);
    return {
        eligible,
        reason: eligible
            ? undefined
            : `Requires 5 qualifying paid visits (currently ${qualifyingVisits}/${visitsRequired})`,
        qualifyingPaidVisits: qualifyingVisits,
        visitsRequired,
        visitsNeeded,
        isSixthVisitReward: eligible,
    };
}
/**
 * Calculates discount for an order or cart items based on promotion configuration.
 */
function calculatePromotionDiscount(db, promotion, items, customerId, currency = 'INR') {
    const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
    const validity = isPromotionActiveAndValid(promotion);
    if (!validity.valid) {
        return {
            eligible: false,
            ineligibleReason: validity.reason,
            promotion,
            pairs: 0,
            eligibleItemCount: 0,
            freeUnits: [],
            itemDiscountMap: {},
            totalDiscountAmount: 0,
            originalSubtotal: 0,
            discountedSubtotal: 0,
        };
    }
    if (promotion.is_loyalty_reward) {
        if (!customerId) {
            return {
                eligible: false,
                ineligibleReason: 'Customer must be selected to redeem loyalty reward',
                promotion,
                pairs: 0,
                eligibleItemCount: 0,
                freeUnits: [],
                itemDiscountMap: {},
                totalDiscountAmount: 0,
                originalSubtotal: 0,
                discountedSubtotal: 0,
            };
        }
        const loyaltyStatus = checkCustomerLoyaltyRewardEligibility(db, customerId);
        if (!loyaltyStatus.eligible) {
            return {
                eligible: false,
                ineligibleReason: loyaltyStatus.reason,
                promotion,
                pairs: 0,
                eligibleItemCount: 0,
                freeUnits: [],
                itemDiscountMap: {},
                totalDiscountAmount: 0,
                originalSubtotal: 0,
                discountedSubtotal: 0,
            };
        }
    }
    const eligibleUnits = [];
    let totalOrderSubtotal = 0;
    let eligibleSubtotal = 0;
    for (const item of items) {
        if (item.product_name && item.product_name.includes('(BOGO Free)')) {
            continue;
        }
        const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
        const price = Number(item.unit_price) || 0;
        const lineSubtotal = Number((price * qty).toFixed(decimals));
        totalOrderSubtotal += lineSubtotal;
        const isEligible = isProductEligibleForPromotion(db, promotion, item.product_id, item.product_name, item.category_id);
        if (isEligible) {
            eligibleSubtotal += lineSubtotal;
            for (let i = 0; i < qty; i++) {
                eligibleUnits.push({
                    orderItemId: item.id,
                    productId: item.product_id,
                    variantId: item.variant_id,
                    productName: item.product_name || 'Pancake',
                    unitPrice: price,
                    subtotal: price,
                });
            }
        }
    }
    if (eligibleUnits.length === 0) {
        return {
            eligible: false,
            ineligibleReason: 'No eligible items in order for this promotion',
            promotion,
            pairs: 0,
            eligibleItemCount: 0,
            freeUnits: [],
            itemDiscountMap: {},
            totalDiscountAmount: 0,
            originalSubtotal: totalOrderSubtotal,
            discountedSubtotal: totalOrderSubtotal,
        };
    }
    let totalDiscountAmount = 0;
    const freeUnits = [];
    const itemDiscountMap = {};
    let pairs = 0;
    if (promotion.discount_type === 'bogo') {
        const buyQty = Math.max(1, promotion.bogo_buy_qty || 1);
        const getQty = Math.max(1, promotion.bogo_get_qty || 1);
        pairs = Math.floor(eligibleUnits.length / buyQty);
        if (pairs === 0) {
            return {
                eligible: false,
                ineligibleReason: `At least ${buyQty} eligible pancake${buyQty > 1 ? 's' : ''} required for BOGO (found ${eligibleUnits.length})`,
                promotion,
                pairs: 0,
                eligibleItemCount: eligibleUnits.length,
                freeUnits: [],
                itemDiscountMap: {},
                totalDiscountAmount: 0,
                originalSubtotal: totalOrderSubtotal,
                discountedSubtotal: totalOrderSubtotal,
            };
        }
        if (promotion.bogo_pricing_rule === 'same_item' ||
            promotion.id === 'launch-bogo' ||
            promotion.id === 'manual-bogo' ||
            promotion.id === 'loyalty-visit6-bogo') {
            const unitsToPair = pairs * buyQty;
            for (let i = 0; i < unitsToPair; i++) {
                const free = eligibleUnits[i];
                freeUnits.push({
                    orderItemId: free.orderItemId,
                    productId: free.productId,
                    variantId: free.variantId,
                    productName: free.productName,
                    unitPrice: free.unitPrice,
                });
                totalDiscountAmount += free.unitPrice;
                if (free.orderItemId) {
                    const key = String(free.orderItemId);
                    itemDiscountMap[key] = Number(((itemDiscountMap[key] || 0) + free.unitPrice).toFixed(decimals));
                }
            }
        }
        else {
            const sortedUnits = [...eligibleUnits].sort((a, b) => a.unitPrice - b.unitPrice);
            const freeCount = pairs * getQty;
            const selectedFree = sortedUnits.slice(0, freeCount);
            for (const free of selectedFree) {
                freeUnits.push({
                    orderItemId: free.orderItemId,
                    productId: free.productId,
                    variantId: free.variantId,
                    productName: free.productName,
                    unitPrice: free.unitPrice,
                });
                totalDiscountAmount += free.unitPrice;
                if (free.orderItemId) {
                    const key = String(free.orderItemId);
                    itemDiscountMap[key] = Number(((itemDiscountMap[key] || 0) + free.unitPrice).toFixed(decimals));
                }
            }
        }
    }
    else if (promotion.discount_type === 'percentage') {
        const pct = Math.min(100, Math.max(0, promotion.discount_value));
        totalDiscountAmount = (eligibleSubtotal * pct) / 100;
    }
    else if (promotion.discount_type === 'fixed_amount') {
        totalDiscountAmount = Math.min(promotion.discount_value, eligibleSubtotal);
    }
    totalDiscountAmount = Number(Math.min(totalDiscountAmount, totalOrderSubtotal).toFixed(decimals));
    const discountedSubtotal = promotion.discount_type === 'bogo'
        ? totalOrderSubtotal
        : Number(Math.max(0, totalOrderSubtotal - totalDiscountAmount).toFixed(decimals));
    return {
        eligible: true,
        promotion,
        pairs,
        eligibleItemCount: eligibleUnits.length,
        freeUnits,
        itemDiscountMap,
        totalDiscountAmount,
        originalSubtotal: totalOrderSubtotal,
        discountedSubtotal,
    };
}
/**
 * Applies a promotion to an active order.
 */
function applyPromotionToOrder(db, orderId, promotionId, actorUserId, clientIp = '127.0.0.1') {
    const promoRow = db.prepare('SELECT * FROM promotions WHERE id = ?').get(promotionId);
    if (!promoRow) {
        throw Object.assign(new Error(`Promotion with ID ${promotionId} not found`), { statusCode: 404 });
    }
    const promotion = parsePromotionRow(promoRow);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
        throw Object.assign(new Error(`Order with ID ${orderId} not found`), { statusCode: 404 });
    }
    if (['completed', 'cancelled'].includes(order.status)) {
        throw Object.assign(new Error('Cannot apply promotion to a completed or cancelled order'), {
            statusCode: 400,
            diagnosticCode: 'order_not_discountable',
        });
    }
    const splitBill = db
        .prepare('SELECT 1 FROM bills WHERE order_id = ? AND split_group_id IS NOT NULL LIMIT 1')
        .get(orderId);
    if (splitBill) {
        throw Object.assign(new Error('Promotions cannot be applied after a check has been split'), {
            statusCode: 409,
            diagnosticCode: 'split_check',
        });
    }
    const refundedBill = db
        .prepare("SELECT 1 FROM bills WHERE order_id = ? AND payment_status IN ('refunded', 'partially_refunded') LIMIT 1")
        .get(orderId);
    if (refundedBill) {
        throw Object.assign(new Error('Cannot apply promotion to a refunded bill'), {
            statusCode: 409,
            diagnosticCode: 'refunded',
        });
    }
    const existingPaidBill = db
        .prepare("SELECT 1 FROM bills WHERE order_id = ? AND payment_status = 'paid' LIMIT 1")
        .get(orderId);
    if (existingPaidBill) {
        throw Object.assign(new Error('Cannot apply promotion to an already paid order'), {
            statusCode: 409,
            diagnosticCode: 'paid',
        });
    }
    // 1. Clean up any previously auto-added BOGO items for idempotency
    const existingBogoItems = db
        .prepare(`SELECT id FROM order_items
       WHERE order_id = ?
         AND (
           json_extract(modifier_selection, '$.is_bogo_free') = 1
           OR json_extract(modifier_selection, '$.is_bogo_free') = true
           OR special_instructions LIKE '%BOGO Free%'
           OR product_name LIKE '%(BOGO Free)%'
         )`)
        .all(orderId);
    for (const bogoItem of existingBogoItems) {
        db.prepare(`DELETE FROM order_item_packaging_allocations
       WHERE serving_allocation_id IN (
         SELECT id FROM order_item_serving_allocations WHERE order_item_id = ?
       )`).run(bogoItem.id);
        db.prepare('DELETE FROM order_item_serving_allocations WHERE order_item_id = ?').run(bogoItem.id);
        db.prepare('DELETE FROM order_item_addons WHERE order_item_id = ?').run(bogoItem.id);
        db.prepare('DELETE FROM order_items WHERE id = ?').run(bogoItem.id);
    }
    db.prepare('UPDATE order_items SET discount_amount = 0, updated_at = ? WHERE order_id = ?').run((0, db_1.now)(), orderId);
    const items = db
        .prepare(`SELECT oi.id, oi.product_id, p.name as product_name, p.sku as product_sku,
              p.category_id, c.name as category_name,
              oi.variant_id, oi.quantity, oi.unit_price, oi.subtotal, oi.status,
              oi.variant_selection, oi.tax_type
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE oi.order_id = ? AND oi.status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')`)
        .all(orderId);
    if (items.length === 0) {
        throw Object.assign(new Error('Order contains no active items to discount'), { statusCode: 400 });
    }
    const currency = (0, bills_1.getTenantCurrency)();
    const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
    const calculation = calculatePromotionDiscount(db, promotion, items.map((i) => ({
        id: i.id,
        product_id: i.product_id,
        product_name: i.product_name,
        variant_id: i.variant_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
        category_id: i.category_id,
        category_name: i.category_name,
    })), order.customer_id, currency);
    if (!calculation.eligible) {
        throw Object.assign(new Error(calculation.ineligibleReason || 'Order does not meet promotion conditions'), { statusCode: 400 });
    }
    let bogoTotalDiscount = 0;
    if (promotion.discount_type === 'bogo') {
        const buyQty = Math.max(1, promotion.bogo_buy_qty || 1);
        const getQty = Math.max(1, promotion.bogo_get_qty || 1);
        const eligibleItems = items.filter((item) => isProductEligibleForPromotion(db, promotion, item.product_id, item.product_name, item.category_id));
        for (const paidItem of eligibleItems) {
            const freeQty = Math.floor(paidItem.quantity / buyQty) * getQty;
            if (freeQty <= 0)
                continue;
            const prodRow = db
                .prepare('SELECT id, track_inventory, inventory_product_id, inventory_deduction_quantity FROM products WHERE id = ?')
                .get(paidItem.product_id);
            const variantRow = paidItem.variant_id
                ? db
                    .prepare('SELECT id, recipe_multiplier, track_inventory, inventory_product_id, inventory_deduction_quantity FROM product_variants WHERE id = ?')
                    .get(paidItem.variant_id)
                : null;
            const multiplier = variantRow?.recipe_multiplier ?? 1;
            const recipeSnapshot = (0, recipes_1.buildRecipeSnapshot)(db, paidItem.product_id, freeQty, multiplier);
            const { ingredientCost, ingredientCostKnown } = (0, recipes_1.extractOrderItemCostFromSnapshot)(recipeSnapshot);
            const deduction = prodRow ? (0, inventory_1.resolveInventoryDeduction)(prodRow, freeQty, variantRow) : null;
            const invDeductedQty = deduction ? deduction.deductedQuantity : 0;
            const invProdId = deduction ? deduction.productId : null;
            const invVarId = deduction?.variantId ?? null;
            const lineSubtotal = Number((paidItem.unit_price * freeQty).toFixed(decimals));
            const lineDiscount = lineSubtotal;
            bogoTotalDiscount += lineDiscount;
            const insertStmt = db.prepare(`
        INSERT INTO order_items (
          order_id, product_id, variant_id, product_name, product_sku, unit_price, quantity,
          inventory_deducted_quantity, inventory_product_id, inventory_variant_id,
          subtotal, tax_amount, tax_breakdown, tax_snapshot, tax_type, discount_amount, total,
          variant_selection, modifier_selection, special_instructions,
          recipe_snapshot, ingredient_cost, ingredient_cost_known, status, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, 'pending', ?, ?
        )
      `);
            const freeProductName = `${paidItem.product_name} (BOGO Free)`;
            const bogoInstruction = promotion.is_loyalty_reward
                ? 'BOGO Free - Loyalty 6th Visit Reward'
                : (promotion.id === 'launch-bogo'
                    ? 'BOGO Free - Launch Offer'
                    : (promotion.id === 'manual-bogo'
                        ? 'BOGO Free - Manual BOGO'
                        : `BOGO Free - ${promotion.name}`));
            const insertResult = insertStmt.run(orderId, paidItem.product_id, paidItem.variant_id || null, freeProductName, paidItem.product_sku || null, paidItem.unit_price, freeQty, invDeductedQty, invProdId, invVarId, lineSubtotal, 0, '[]', null, paidItem.tax_type || 'exclusive', lineDiscount, 0, paidItem.variant_selection || null, JSON.stringify({ is_bogo_free: true, promotion_id: promotion.id, source_order_item_id: paidItem.id }), bogoInstruction, recipeSnapshot ? JSON.stringify(recipeSnapshot) : null, ingredientCost, ingredientCostKnown, (0, db_1.now)(), (0, db_1.now)());
            const freeItemId = insertResult.lastInsertRowid;
            const sourceAllocations = db
                .prepare('SELECT serving_type, quantity FROM order_item_serving_allocations WHERE order_item_id = ?')
                .all(paidItem.id);
            let freeAllocations = null;
            if (sourceAllocations.length > 0) {
                freeAllocations = sourceAllocations.map((a) => ({
                    serving_type: a.serving_type,
                    quantity: Number(((a.quantity * freeQty) / paidItem.quantity).toFixed(4)),
                }));
            }
            (0, packaging_1.persistItemServingAndPackaging)({
                db,
                orderItemId: freeItemId,
                itemQuantity: freeQty,
                allocations: freeAllocations,
                actorUserId,
                productId: paidItem.product_id,
                variantId: paidItem.variant_id || null,
            });
        }
    }
    else {
        for (const item of items) {
            const itemDiscount = calculation.itemDiscountMap[String(item.id)] || 0;
            db.prepare(`UPDATE order_items
         SET discount_amount = ?, updated_at = ?
         WHERE id = ?`).run(itemDiscount, (0, db_1.now)(), item.id);
        }
    }
    const countrySetting = db.prepare("SELECT value FROM settings WHERE key = 'country'").get();
    const taxesSetting = db.prepare("SELECT value FROM settings WHERE key = 'taxes_enabled'").get();
    const tenantInfo = {
        country: countrySetting?.value || '',
        business_type: 'restaurant',
        state_code: '',
        currency,
        taxes_enabled: taxesSetting?.value === 'true',
    };
    const customer = order.customer_id
        ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) ?? null)
        : null;
    const totals = (0, orders_1.calculateOrderTotals)(db, orderId);
    const discountAmount = promotion.discount_type === 'bogo'
        ? bogoTotalDiscount
        : calculation.totalDiscountAmount;
    const engineCharges = (0, orders_2.resolveEngineCharges)(order, totals.subtotal, discountAmount);
    const { taxRollup, total: newTotal, roundOff, } = (0, orders_1.recomputeOrderTotals)({
        tenantInfo,
        chargeContext: order,
        customer,
        totals,
        discountAmount,
        taxScaling: 'when-discounted',
        appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
        chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
    });
    const syncedServiceCharge = engineCharges
        ? engineCharges.columns.service_charge
        : order.service_charge || 0;
    const syncedPackagingCharge = engineCharges
        ? engineCharges.columns.packaging_charge
        : order.packaging_charge || 0;
    const syncedChargesJson = engineCharges
        ? engineCharges.chargesJson
        : order.charges_breakdown ?? null;
    db.prepare(`
    UPDATE orders
    SET promotion_id = ?,
        subtotal = ?,
        discount_amount = ?,
        discount_type = ?,
        discount_value = ?,
        discount_reason = ?,
        tax_amount = ?,
        tax_breakdown = ?,
        tax_snapshot = ?,
        total = ?,
        service_charge = ?,
        packaging_charge = ?,
        charges_breakdown = ?,
        round_off = ?,
        updated_at = ?
    WHERE id = ?
  `).run(promotion.id, totals.subtotal, discountAmount, promotion.discount_type, promotion.discount_value, promotion.name, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newTotal, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, (0, db_1.now)(), orderId);
    let updatedBill = undefined;
    const existingBill = db
        .prepare("SELECT * FROM bills WHERE order_id = ? AND payment_status != 'paid'")
        .get(orderId);
    if (existingBill) {
        const pack = (0, tax_1.getActiveCountryPack)(tenantInfo.country);
        const { total: billTotal, adjustment: billRoundOff } = (0, tax_engine_1.applyPayableRounding)(newTotal, pack, currency);
        const billPaidAmount = Number(existingBill.paid_amount || 0);
        const newBillBalance = Math.max(0, billTotal - billPaidAmount);
        db.prepare(`
      UPDATE bills
      SET promotion_id = ?,
          subtotal = ?,
          discount_amount = ?,
          discount_type = ?,
          discount_value = ?,
          discount_reason = ?,
          tax_amount = ?,
          tax_breakdown = ?,
          tax_snapshot = ?,
          total = ?,
          balance = ?,
          service_charge = ?,
          packaging_charge = ?,
          charges_breakdown = ?,
          round_off = ?,
          updated_at = ?
      WHERE id = ?
    `).run(promotion.id, totals.subtotal, discountAmount, promotion.discount_type, promotion.discount_value, promotion.name, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, billTotal, newBillBalance, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, billRoundOff, (0, db_1.now)(), existingBill.id);
        updatedBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(existingBill.id);
    }
    (0, db_1.recordOrderAudit)(db, {
        orderId: String(orderId),
        actorUserId,
        action: 'promotion_applied',
        details: {
            client_ip: clientIp,
            promotion_id: promotion.id,
            promotion_name: promotion.name,
            discount_type: promotion.discount_type,
            discount_amount: discountAmount,
            free_units_count: calculation.freeUnits.length,
            pairs: calculation.pairs,
        },
    });
    (0, kds_1.notifyKdsUpdate)();
    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    return { order: updatedOrder, bill: updatedBill, calculation };
}
/**
 * Removes active promotion from order and restores standard pricing.
 */
function removePromotionFromOrder(db, orderId, actorUserId) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
        throw Object.assign(new Error(`Order with ID ${orderId} not found`), { statusCode: 404 });
    }
    if (['completed', 'cancelled'].includes(order.status)) {
        throw Object.assign(new Error('Cannot modify promotions on completed or cancelled order'), {
            statusCode: 400,
        });
    }
    // Find and remove any auto-added BOGO free items
    const bogoFreeItems = db
        .prepare(`SELECT id FROM order_items
       WHERE order_id = ?
         AND (
           json_extract(modifier_selection, '$.is_bogo_free') = 1
           OR json_extract(modifier_selection, '$.is_bogo_free') = true
           OR special_instructions LIKE '%BOGO Free%'
           OR product_name LIKE '%(BOGO Free)%'
         )`)
        .all(orderId);
    for (const item of bogoFreeItems) {
        db.prepare(`DELETE FROM order_item_packaging_allocations
       WHERE serving_allocation_id IN (
         SELECT id FROM order_item_serving_allocations WHERE order_item_id = ?
       )`).run(item.id);
        db.prepare('DELETE FROM order_item_serving_allocations WHERE order_item_id = ?').run(item.id);
        db.prepare('DELETE FROM order_item_addons WHERE order_item_id = ?').run(item.id);
        db.prepare('DELETE FROM order_items WHERE id = ?').run(item.id);
    }
    db.prepare(`UPDATE order_items SET discount_amount = 0, updated_at = ? WHERE order_id = ?`).run((0, db_1.now)(), orderId);
    const currency = (0, bills_1.getTenantCurrency)();
    const countrySetting = db.prepare("SELECT value FROM settings WHERE key = 'country'").get();
    const taxesSetting = db.prepare("SELECT value FROM settings WHERE key = 'taxes_enabled'").get();
    const tenantInfo = {
        country: countrySetting?.value || '',
        business_type: 'restaurant',
        state_code: '',
        currency,
        taxes_enabled: taxesSetting?.value === 'true',
    };
    const customer = order.customer_id
        ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) ?? null)
        : null;
    const totals = (0, orders_1.calculateOrderTotals)(db, orderId);
    const engineCharges = (0, orders_2.resolveEngineCharges)(order, totals.subtotal, 0);
    const { taxRollup, total: newTotal, roundOff, } = (0, orders_1.recomputeOrderTotals)({
        tenantInfo,
        chargeContext: order,
        customer,
        totals,
        discountAmount: 0,
        taxScaling: 'when-discounted',
        appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
        chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
    });
    const syncedServiceCharge = engineCharges
        ? engineCharges.columns.service_charge
        : order.service_charge || 0;
    const syncedPackagingCharge = engineCharges
        ? engineCharges.columns.packaging_charge
        : order.packaging_charge || 0;
    const syncedChargesJson = engineCharges
        ? engineCharges.chargesJson
        : order.charges_breakdown ?? null;
    db.prepare(`
    UPDATE orders
    SET promotion_id = NULL,
        subtotal = ?,
        discount_amount = 0,
        discount_type = NULL,
        discount_value = NULL,
        discount_reason = NULL,
        tax_amount = ?,
        tax_breakdown = ?,
        tax_snapshot = ?,
        total = ?,
        service_charge = ?,
        packaging_charge = ?,
        charges_breakdown = ?,
        round_off = ?,
        updated_at = ?
    WHERE id = ?
  `).run(totals.subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newTotal, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, (0, db_1.now)(), orderId);
    let updatedBill = undefined;
    const existingBill = db
        .prepare("SELECT * FROM bills WHERE order_id = ? AND payment_status != 'paid'")
        .get(orderId);
    if (existingBill) {
        const pack = (0, tax_1.getActiveCountryPack)(tenantInfo.country);
        const { total: billTotal, adjustment: billRoundOff } = (0, tax_engine_1.applyPayableRounding)(newTotal, pack, currency);
        const billPaidAmount = Number(existingBill.paid_amount || 0);
        const newBillBalance = Math.max(0, billTotal - billPaidAmount);
        db.prepare(`
      UPDATE bills
      SET promotion_id = NULL,
          subtotal = ?,
          discount_amount = 0,
          discount_type = NULL,
          discount_value = NULL,
          discount_reason = NULL,
          tax_amount = ?,
          tax_breakdown = ?,
          tax_snapshot = ?,
          total = ?,
          balance = ?,
          service_charge = ?,
          packaging_charge = ?,
          charges_breakdown = ?,
          round_off = ?,
          updated_at = ?
      WHERE id = ?
    `).run(totals.subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, billTotal, newBillBalance, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, billRoundOff, (0, db_1.now)(), existingBill.id);
        updatedBill = db.prepare('SELECT * FROM bills WHERE id = ?').get(existingBill.id);
    }
    (0, db_1.recordOrderAudit)(db, {
        orderId: String(orderId),
        actorUserId,
        action: 'promotion_removed',
        details: { previous_promotion_id: order.promotion_id },
    });
    (0, kds_1.notifyKdsUpdate)();
    return {
        order: db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId),
        bill: updatedBill,
    };
}
/**
 * Authoritative settlement-time promotion redemption recorder.
 */
function recordPromotionRedemptionOnCheckout(db, orderId, billId, actorUserId) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || !order.promotion_id)
        return;
    const promoRow = db.prepare('SELECT * FROM promotions WHERE id = ?').get(order.promotion_id);
    if (!promoRow)
        return;
    const promotion = parsePromotionRow(promoRow);
    const existingRedemption = db
        .prepare('SELECT id FROM promotion_redemptions WHERE order_id = ? AND promotion_id = ?')
        .get(orderId, promotion.id);
    if (existingRedemption)
        return;
    const discountAmount = Number(order.discount_amount || 0);
    const isLoyaltyReward = promotion.is_loyalty_reward ? 1 : 0;
    db.prepare(`
    INSERT INTO promotion_redemptions (
      promotion_id, order_id, bill_id, customer_id, cashier_user_id,
      discount_amount, is_loyalty_reward, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(promotion.id, orderId, billId || null, order.customer_id || null, actorUserId || null, discountAmount, isLoyaltyReward, JSON.stringify({
        promotion_name: promotion.name,
        discount_type: promotion.discount_type,
        bogo_pricing_rule: promotion.bogo_pricing_rule,
        discount_amount: discountAmount,
        total_before_discount: Number(order.subtotal || 0),
    }), (0, db_1.now)());
    db.prepare(`UPDATE promotions
     SET current_redemptions_count = current_redemptions_count + 1,
         updated_at = ?
     WHERE id = ?`).run((0, db_1.now)(), promotion.id);
}
/**
 * Reporting query for promotions & discounts.
 */
function getPromotionReportsSummary(db, startDate, endDate) {
    let dateFilter = '';
    const params = [];
    if (startDate) {
        dateFilter += ' AND pr.created_at >= ?';
        params.push(startDate);
    }
    if (endDate) {
        dateFilter += ' AND pr.created_at <= ?';
        params.push(endDate);
    }
    const baseWhere = `
    WHERE (
      pr.order_id IS NULL OR pr.order_id NOT IN (
        SELECT internal_order_id FROM delivery_order_tracking WHERE is_simulated = 1
      )
    )
    ${dateFilter}
  `;
    const overallStats = db
        .prepare(`SELECT
         COUNT(*) as total_count,
         COALESCE(SUM(pr.discount_amount), 0) as total_discount,
         COALESCE(SUM(CASE WHEN p.discount_type = 'bogo' THEN 1 ELSE 0 END), 0) as bogo_count,
         COALESCE(SUM(CASE WHEN p.discount_type = 'bogo' THEN pr.discount_amount ELSE 0 END), 0) as bogo_discount,
         COALESCE(SUM(CASE WHEN pr.promotion_id = 'launch-bogo' THEN 1 ELSE 0 END), 0) as launch_count,
         COALESCE(SUM(CASE WHEN pr.promotion_id = 'launch-bogo' THEN pr.discount_amount ELSE 0 END), 0) as launch_discount,
         COALESCE(SUM(CASE WHEN pr.promotion_id = 'manual-bogo' THEN 1 ELSE 0 END), 0) as manual_count,
         COALESCE(SUM(CASE WHEN pr.promotion_id = 'manual-bogo' THEN pr.discount_amount ELSE 0 END), 0) as manual_discount,
         COALESCE(SUM(CASE WHEN pr.is_loyalty_reward = 1 THEN 1 ELSE 0 END), 0) as loyalty_count,
         COALESCE(SUM(CASE WHEN pr.is_loyalty_reward = 1 THEN pr.discount_amount ELSE 0 END), 0) as loyalty_discount
       FROM promotion_redemptions pr
       JOIN promotions p ON p.id = pr.promotion_id
       ${baseWhere}`)
        .get(...params);
    const byCashier = db
        .prepare(`SELECT
         pr.cashier_user_id,
         COALESCE(u.name, 'System') as cashier_name,
         COUNT(*) as redemption_count,
         COALESCE(SUM(pr.discount_amount), 0) as total_discount
       FROM promotion_redemptions pr
       JOIN promotions p ON p.id = pr.promotion_id
       LEFT JOIN users u ON u.id = pr.cashier_user_id
       ${baseWhere}
       GROUP BY pr.cashier_user_id, cashier_name
       ORDER BY total_discount DESC`)
        .all(...params);
    const byDate = db
        .prepare(`SELECT
         DATE(pr.created_at) as date_day,
         COUNT(*) as redemption_count,
         COALESCE(SUM(pr.discount_amount), 0) as total_discount
       FROM promotion_redemptions pr
       JOIN promotions p ON p.id = pr.promotion_id
       ${baseWhere}
       GROUP BY date_day
       ORDER BY date_day ASC`)
        .all(...params);
    let bogoDateFilter = '';
    const bogoParams = [];
    if (startDate) {
        bogoDateFilter += ' AND o.created_at >= ?';
        bogoParams.push(startDate);
    }
    if (endDate) {
        bogoDateFilter += ' AND o.created_at <= ?';
        bogoParams.push(endDate);
    }
    const bogoQtyStats = db
        .prepare(`SELECT
         COALESCE(SUM(CASE WHEN json_extract(oi.modifier_selection, '$.is_bogo_free') = 1 OR json_extract(oi.modifier_selection, '$.is_bogo_free') = true OR oi.product_name LIKE '%(BOGO Free)%' OR (oi.discount_amount >= oi.subtotal AND oi.subtotal > 0) THEN oi.quantity ELSE 0 END), 0) as free_quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE (oi.status IS NULL OR oi.status NOT IN ('cancelled', 'voided', 'void_adjustment'))
         AND o.status != 'cancelled'
         AND (
           o.id IS NULL OR o.id NOT IN (
             SELECT internal_order_id FROM delivery_order_tracking WHERE is_simulated = 1
           )
         )
         ${bogoDateFilter}`)
        .get(...bogoParams);
    const bogoFreeQuantity = Number(bogoQtyStats?.free_quantity || 0);
    const bogoPaidQuantity = bogoFreeQuantity;
    const bogoPreparedQuantity = bogoFreeQuantity + bogoPaidQuantity;
    return {
        totalRedemptionsCount: Number(overallStats?.total_count || 0),
        totalDiscountAmount: Number(overallStats?.total_discount || 0),
        bogoRedemptionsCount: Number(overallStats?.bogo_count || 0),
        bogoDiscountAmount: Number(overallStats?.bogo_discount || 0),
        bogoPaidQuantity,
        bogoFreeQuantity,
        bogoPreparedQuantity,
        launchBogoRedemptionsCount: Number(overallStats?.launch_count || 0),
        launchBogoDiscountAmount: Number(overallStats?.launch_discount || 0),
        manualBogoRedemptionsCount: Number(overallStats?.manual_count || 0),
        manualBogoDiscountAmount: Number(overallStats?.manual_discount || 0),
        loyaltyRewardRedemptionsCount: Number(overallStats?.loyalty_count || 0),
        loyaltyRewardDiscountAmount: Number(overallStats?.loyalty_discount || 0),
        redemptionsByCashier: byCashier.map((c) => ({
            cashierUserId: c.cashier_user_id,
            cashierName: c.cashier_name,
            redemptionCount: Number(c.redemption_count || 0),
            totalDiscount: Number(c.total_discount || 0),
        })),
        redemptionsByDate: byDate.map((d) => ({
            date: d.date_day,
            redemptionCount: Number(d.redemption_count || 0),
            totalDiscount: Number(d.total_discount || 0),
        })),
    };
}
//# sourceMappingURL=promotions.js.map