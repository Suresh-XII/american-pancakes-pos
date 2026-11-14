import { getDatabase } from '../db';
export type InventoryMovementType = 'sale' | 'cancel_restore' | 'adjustment';
export declare class InventoryServiceError extends Error {
    readonly statusCode: number;
    constructor(statusCode: number, message: string);
}
export interface StockChangeOptions {
    /** Null when the delta moves an add-on pool, which has no owning product. */
    productId: string | number | null;
    variantId?: string | null;
    addonId?: string | null;
    quantityDelta: number;
    movementType: InventoryMovementType;
    actorUserId: string;
    referenceType?: string | null;
    referenceId?: string | number | bigint | null;
    reason?: string | null;
    createdAt?: string;
}
export interface InventoryMovementFilters {
    productId?: string;
    addonId?: string;
    movementType?: InventoryMovementType;
    referenceType?: string;
    referenceId?: string;
    beforeId?: number;
    perPage?: number;
}
export interface InventoryMovement {
    id: number;
    product_id: string | null;
    product_name: string | null;
    variant_id: string | null;
    addon_id: string | null;
    addon_name: string | null;
    quantity_delta: number;
    movement_type: InventoryMovementType;
    reference_type: string | null;
    reference_id: string | null;
    reason: string | null;
    actor_user_id: string;
    actor_name: string | null;
    stock_after: number;
    created_at: string;
    imported_by_user_id: string | null;
    import_batch_id: string | null;
    source_actor_user_id: string | null;
    source_reference_type: string | null;
    source_reference_id: string | null;
    source_reason: string | null;
    source_created_at: string | null;
}
export interface InventoryMovementPage {
    movements: InventoryMovement[];
    nextCursor: number | null;
}
/** Apply a stock delta and append its ledger row. Callers must provide the transaction boundary. */
export interface InventoryDeduction {
    productId: string;
    deductedQuantity: number;
    /** Set when the delta moves a variant's own stock pool rather than the product's. */
    variantId?: string;
}
export interface InventoryProductLike {
    id: string | number;
    track_inventory?: number | boolean | null;
    inventory_product_id?: string | null;
    inventory_deduction_quantity?: number | null;
}
/**
 * Resolve which stock a sale quantity consumes.
 *
 * A variant decides first: a recipe link depletes the base ingredient by a
 * multiplier, otherwise a tracked variant depletes its own stock pool. With no
 * variant the product's own link/track_inventory rules apply, so existing
 * callers keep their behaviour.
 */
export declare function resolveInventoryDeduction(product: InventoryProductLike, quantity: number, variant?: InventoryProductLike | null): InventoryDeduction | null;
export declare function adjustProductStock(db: ReturnType<typeof getDatabase>, options: StockChangeOptions): {
    stockBefore: number;
    stockAfter: number;
    movementId: number;
};
export declare function listInventoryMovements(db: ReturnType<typeof getDatabase>, filters?: InventoryMovementFilters): InventoryMovementPage;
//# sourceMappingURL=inventory.d.ts.map