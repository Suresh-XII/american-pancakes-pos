import { getDatabase } from '../db';
import { SupplyUnit } from './units';
export type RecipeValidationCode = 'product_missing' | 'items_missing' | 'supply_id_missing' | 'duplicate_supply' | 'supply_missing' | 'quantity_invalid' | 'unit_invalid' | 'yield_invalid';
export declare class RecipeServiceError extends Error {
    readonly statusCode: number;
    readonly diagnosticCode?: RecipeValidationCode;
    constructor(statusCode: number, message: string, diagnosticCode?: RecipeValidationCode);
}
export interface RecipeComponent {
    supply_id: string;
    supply_name: string;
    base_unit: SupplyUnit;
    quantity: number;
    unit: SupplyUnit;
    quantity_in_base: number;
    supply_unit_cost: number | null;
    component_cost: number | null;
}
export interface RecipeSnapshotComponent {
    supply_id: string;
    supply_name: string;
    base_unit: SupplyUnit;
    quantity: number;
    unit_cost?: number | null;
    line_cost?: number | null;
}
export interface RecipeSnapshot {
    recipe_id: string;
    product_id: string;
    yield_quantity: number;
    cost_known?: boolean;
    total_ingredient_cost?: number | null;
    /** Scaled amounts for this order item quantity, already in each supply's base unit. */
    components: RecipeSnapshotComponent[];
}
export interface RecipeRecord {
    id: string;
    product_id: string;
    product_name: string | null;
    yield_quantity: number;
    is_active: number;
    created_at: string;
    updated_at: string;
    cost_known: boolean;
    total_cost: number | null;
    unit_cost: number | null;
    items: RecipeComponent[];
}
export interface SaveRecipeInput {
    productId: string;
    yieldQuantity?: number;
    isActive?: boolean;
    items: {
        supplyId?: string;
        supply_id?: string;
        quantity: number;
        unit: string;
    }[];
}
export declare function getRecipeByProduct(db: ReturnType<typeof getDatabase>, productId: string): RecipeRecord | null;
export declare function getRecipe(db: ReturnType<typeof getDatabase>, id: string): RecipeRecord | null;
export declare function listRecipes(db: ReturnType<typeof getDatabase>): RecipeRecord[];
export declare function saveRecipe(db: ReturnType<typeof getDatabase>, input: SaveRecipeInput): RecipeRecord;
export declare function deleteRecipe(db: ReturnType<typeof getDatabase>, productId: string): void;
/**
 * Build an immutable per-order-item snapshot of the recipe scaled to the
 * ordered quantity and to the ordered variant's portion. `recipeMultiplier`
 * is how many base recipe portions the variant consumes and comes from the
 * resolved catalog variant, never from the client. Returns null when the
 * product has no active recipe, in which case a portion has no effect.
 */
export declare function buildRecipeSnapshot(db: ReturnType<typeof getDatabase>, productId: string, orderQuantity: number, recipeMultiplier?: number): RecipeSnapshot | null;
export declare function scaleRecipeSnapshot(snapshot: RecipeSnapshot, ratio: number, fractionDigits: number): RecipeSnapshot;
export declare function extractOrderItemCostFromSnapshot(snapshot: RecipeSnapshot | null | undefined): {
    ingredientCost: number | null;
    ingredientCostKnown: 0 | 1;
};
export declare function parseRecipeSnapshot(raw: unknown): RecipeSnapshot | null;
/**
 * Apply snapshot component deltas to supply stock. Positive deltas restore,
 * negative deltas deplete. Callers must already be inside a transaction.
 */
export declare function applyRecipeSnapshot(db: ReturnType<typeof getDatabase>, snapshot: RecipeSnapshot, options: {
    direction: 'deplete' | 'restore';
    actorUserId: string;
    referenceId: string | number;
    createdAt?: string;
}): void;
//# sourceMappingURL=recipes.d.ts.map