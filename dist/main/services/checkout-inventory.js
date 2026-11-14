"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeCheckoutInventory = consumeCheckoutInventory;
/** Authoritative v126 checkout-time inventory consumer. Call inside settlement's transaction. */
const crypto_1 = require("crypto");
const db_1 = require("../db");
const inventory_1 = require("./inventory");
const recipes_1 = require("./recipes");
const supplies_1 = require("./supplies");
function hasLedger(db, key) {
    return Boolean(db.prepare('SELECT 1 FROM order_inventory_consumptions WHERE idempotency_key=?').get(key));
}
function record(db, values) {
    db.prepare(`INSERT INTO order_inventory_consumptions
    (id,order_id,order_item_id,packaging_allocation_id,completion_reference,idempotency_key,consumption_kind,inventory_movement_id,supply_movement_id,created_at)
    VALUES (@id,@order_id,@order_item_id,@packaging_allocation_id,@completion_reference,@idempotency_key,@consumption_kind,@inventory_movement_id,@supply_movement_id,@created_at)`).run(values);
}
/** Consumes snapshots exactly once. Legacy rows are intentionally ignored. */
function consumeCheckoutInventory(db, orderId, actorUserId, completionReference) {
    const order = db.prepare('SELECT inventory_lifecycle,status FROM orders WHERE id=?').get(orderId);
    if (!order || order.inventory_lifecycle !== 'checkout_v1')
        return;
    if (order.status === 'cancelled')
        return;
    const timestamp = (0, db_1.now)();
    const items = db.prepare(`SELECT id, inventory_deducted_quantity, inventory_product_id, inventory_variant_id, recipe_snapshot FROM order_items WHERE order_id=? AND status NOT IN ('cancelled','voided','void_adjustment','refunded')`).all(orderId);
    for (const item of items) {
        const productKey = `v126:${orderId}:product:${item.id}`;
        if (!hasLedger(db, productKey) && Number(item.inventory_deducted_quantity) > 0 && item.inventory_product_id) {
            const movement = (0, inventory_1.adjustProductStock)(db, { productId: item.inventory_product_id, variantId: item.inventory_variant_id || null, quantityDelta: -Number(item.inventory_deducted_quantity), movementType: 'sale', actorUserId, referenceType: 'order_item', referenceId: item.id, createdAt: timestamp });
            record(db, { id: (0, crypto_1.randomUUID)(), order_id: orderId, order_item_id: item.id, packaging_allocation_id: null, completion_reference: completionReference, idempotency_key: productKey, consumption_kind: 'product', inventory_movement_id: movement.movementId, supply_movement_id: null, created_at: timestamp });
        }
        const addons = db.prepare('SELECT addon_id,inventory_deducted_quantity FROM order_item_addons WHERE order_item_id=?').all(item.id);
        for (const addon of addons) {
            const key = `v126:${orderId}:addon:${item.id}:${addon.addon_id}`;
            if (!hasLedger(db, key) && addon.addon_id && Number(addon.inventory_deducted_quantity) > 0) {
                const movement = (0, inventory_1.adjustProductStock)(db, { productId: null, addonId: addon.addon_id, quantityDelta: -Number(addon.inventory_deducted_quantity), movementType: 'sale', actorUserId, referenceType: 'order_item', referenceId: item.id, createdAt: timestamp });
                record(db, { id: (0, crypto_1.randomUUID)(), order_id: orderId, order_item_id: item.id, packaging_allocation_id: null, completion_reference: completionReference, idempotency_key: key, consumption_kind: 'addon', inventory_movement_id: movement.movementId, supply_movement_id: null, created_at: timestamp });
            }
        }
        const recipe = (0, recipes_1.parseRecipeSnapshot)(item.recipe_snapshot);
        for (const [index, component] of (recipe?.components || []).entries()) {
            const key = `v126:${orderId}:ingredient:${item.id}:${index}`;
            if (hasLedger(db, key))
                continue;
            const movement = (0, supplies_1.applySupplyStockChange)(db, { supplyId: component.supply_id, quantityDelta: -Math.abs(component.quantity), movementType: 'recipe_depletion', unit: component.base_unit, actorUserId, referenceType: 'order_item', referenceId: item.id, createdAt: timestamp });
            record(db, { id: (0, crypto_1.randomUUID)(), order_id: orderId, order_item_id: item.id, packaging_allocation_id: null, completion_reference: completionReference, idempotency_key: key, consumption_kind: 'ingredient', inventory_movement_id: null, supply_movement_id: movement.movementId, created_at: timestamp });
        }
    }
    const packaging = db.prepare(`SELECT p.id,p.supply_id_snapshot,p.quantity,COALESCE(p.unit_snapshot, 'each') AS unit_snapshot FROM order_item_packaging_allocations p JOIN order_item_serving_allocations s ON s.id=p.serving_allocation_id JOIN order_items i ON i.id=s.order_item_id WHERE i.order_id=? AND i.status NOT IN ('cancelled','voided','void_adjustment','refunded')`).all(orderId);
    for (const item of packaging) {
        const key = `v126:${orderId}:packaging:${item.id}`;
        if (hasLedger(db, key))
            continue;
        const movement = (0, supplies_1.applySupplyStockChange)(db, { supplyId: item.supply_id_snapshot, quantityDelta: -Math.abs(Number(item.quantity)), movementType: 'recipe_depletion', unit: item.unit_snapshot || 'each', actorUserId, referenceType: 'packaging_allocation', referenceId: item.id, createdAt: timestamp });
        record(db, { id: (0, crypto_1.randomUUID)(), order_id: orderId, order_item_id: null, packaging_allocation_id: item.id, completion_reference: completionReference, idempotency_key: key, consumption_kind: 'packaging', inventory_movement_id: null, supply_movement_id: movement.movementId, created_at: timestamp });
    }
}
//# sourceMappingURL=checkout-inventory.js.map