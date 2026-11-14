"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadProductVariant = loadProductVariant;
exports.resolveOrderItemVariant = resolveOrderItemVariant;
exports.variantUnitPrice = variantUnitPrice;
const VARIANT_COLUMNS = 'id, product_id, name, sku, price, online_price, track_inventory, inventory_product_id, inventory_deduction_quantity, recipe_multiplier, is_active';
function loadProductVariant(db, variantId) {
    return db
        .prepare(`SELECT ${VARIANT_COLUMNS} FROM product_variants WHERE id = ?`)
        .get(variantId);
}
/**
 * Resolves the catalog variant an order line names. A missing, foreign, or
 * inactive variant is rejected rather than silently sold at the base price.
 * Every pricing surface calls this so a quote and the order it becomes cannot
 * disagree about what the customer is buying.
 */
function resolveOrderItemVariant(db, product, item, isOnlineOrder, options) {
    const supplied = item.variant_id;
    if (supplied !== undefined && supplied !== null && typeof supplied !== 'string') {
        throw Object.assign(new Error('variant_id must be a string'), { statusCode: 400 });
    }
    const variantId = typeof supplied === 'string' ? supplied.trim() : '';
    if (!variantId) {
        const hasVariants = db
            .prepare('SELECT 1 FROM product_variants WHERE product_id = ? AND is_active = 1 LIMIT 1')
            .get(product.id);
        if (hasVariants && !options?.allowUnselected) {
            throw Object.assign(new Error(`A variant must be selected for ${product.name || product.id}`), { statusCode: 400 });
        }
        return null;
    }
    const variant = loadProductVariant(db, variantId);
    if (!variant) {
        throw Object.assign(new Error(`Variant ${variantId} was not found`), { statusCode: 400 });
    }
    if (variant.product_id !== product.id) {
        throw Object.assign(new Error(`Variant "${variant.name}" is not an option for ${product.name || product.id}`), { statusCode: 400 });
    }
    if (Number(variant.is_active) !== 1 && !options?.allowInactive) {
        throw Object.assign(new Error(`Variant "${variant.name}" is not available`), {
            statusCode: 400,
        });
    }
    return variant;
}
/** Backend-authoritative sell price for a variant; online orders may carry a platform price. */
function variantUnitPrice(variant, isOnlineOrder) {
    const platformPrice = variant.online_price;
    if (isOnlineOrder && platformPrice !== null && platformPrice !== undefined) {
        return Number(platformPrice);
    }
    return Number(variant.price);
}
//# sourceMappingURL=product-variants.js.map