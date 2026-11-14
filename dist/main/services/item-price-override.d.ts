import { getDatabase, now } from '../db';
type Database = ReturnType<typeof getDatabase>;
export declare const ITEM_PRICE_OVERRIDE_PERMISSION = "orders.item.price_override";
export declare const MAX_PRICE_OVERRIDE_REASON_LENGTH = 200;
export interface PriceOverrideInput {
    price: number;
    reason: string;
}
export interface PriceOverrideState {
    originalUnitPrice: number;
    reason: string;
    actorUserId: string;
    at: string;
}
/** Rounds a non-negative unit price to currency precision using half-up rounding. */
export declare function normalizeOverridePrice(price: number, decimals: number): number;
/** Validates a client override: a finite non-negative price (0 allowed) and a required reason. */
export declare function parsePriceOverrideInput(raw: unknown, decimals: number): PriceOverrideInput;
/** Flags an item as price-overridden, keeping the first menu price when overridden repeatedly. */
export declare function markItemPriceOverridden(db: Database, itemId: number | bigint | string, state: PriceOverrideState): void;
/** Copies the override flag from a replaced line onto its same-product successor. */
export declare function carryPriceOverride(db: Database, fromItemId: number | bigint | string, toItemId: number | bigint | string): void;
export interface PriceExceptionRow {
    order_id: number;
    order_number: string;
    item_id: number;
    product_name: string;
    quantity: number;
    original_unit_price: number;
    billed_unit_price: number;
    difference: number;
    reason: string | null;
    changed_by_id: string | null;
    changed_by_name: string | null;
    changed_at: string;
}
/** Overridden, non-cancelled lines whose override time falls in [fromIso, toIso). */
export declare function listPriceExceptions(db: Database, fromIso: string, toIso: string): PriceExceptionRow[];
export interface ShiftWindow {
    id: number;
    opened_by_name: string;
    opened_at: string;
    closed_at: string | null;
}
export declare function listShiftsOverlapping(db: Database, fromIso: string, toIso: string): ShiftWindow[];
export declare function getShiftWindow(db: Database, id: number): ShiftWindow | undefined;
export { now };
//# sourceMappingURL=item-price-override.d.ts.map