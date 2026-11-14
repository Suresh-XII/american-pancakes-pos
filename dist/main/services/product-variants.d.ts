import { getDatabase } from '../db';
export interface ProductVariant {
    id: string;
    product_id: string;
    name: string;
    sku: string | null;
    price: number;
    online_price: number | null;
    track_inventory: number;
    inventory_product_id: string | null;
    inventory_deduction_quantity: number | null;
    /** Portions of this product's own ingredient recipe the variant consumes. */
    recipe_multiplier: number;
    is_active: number;
}
export declare function loadProductVariant(db: ReturnType<typeof getDatabase>, variantId: string): ProductVariant | undefined;
/**
 * Resolves the catalog variant an order line names. A missing, foreign, or
 * inactive variant is rejected rather than silently sold at the base price.
 * Every pricing surface calls this so a quote and the order it becomes cannot
 * disagree about what the customer is buying.
 */
export declare function resolveOrderItemVariant(db: ReturnType<typeof getDatabase>, product: {
    id: string;
    name?: string;
}, item: {
    variant_id?: unknown;
}, isOnlineOrder: boolean, options?: {
    allowInactive?: boolean;
    allowUnselected?: boolean;
}): ProductVariant | null;
/** Backend-authoritative sell price for a variant; online orders may carry a platform price. */
export declare function variantUnitPrice(variant: ProductVariant, isOnlineOrder: boolean): number;
//# sourceMappingURL=product-variants.d.ts.map