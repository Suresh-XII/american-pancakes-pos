import Decimal from 'decimal.js';
import { getDatabase } from '../db';
import { SupplyUnit } from './units';
export declare const COST_PRECISION = 10;
export declare function roundUnitCost(value: number | Decimal): number;
export declare function roundCurrencyCost(value: number | Decimal, fractionDigits: number): number;
export declare function resolveDbCurrencyFractionDigits(db: ReturnType<typeof getDatabase>): number;
export type SupplyMovementType = 'receive' | 'count' | 'adjustment' | 'waste' | 'recipe_depletion' | 'recipe_restore';
export type SupplyServiceDiagnosticCode = 'recipe_linked' | 'name_required' | 'name_too_long' | 'quantity_invalid' | 'unit_invalid' | 'threshold_invalid' | 'cost_invalid' | 'movement_reason_required' | 'movement_reason_too_long' | 'movement_quantity_invalid' | 'movement_zero' | 'movement_negative';
export declare class SupplyServiceError extends Error {
    readonly statusCode: number;
    readonly diagnosticCode?: SupplyServiceDiagnosticCode;
    constructor(statusCode: number, message: string, diagnosticCode?: SupplyServiceDiagnosticCode);
}
export interface SupplyRecord {
    id: string;
    name: string;
    base_unit: SupplyUnit;
    stock_quantity: number;
    low_stock_threshold: number | null;
    unit_cost: number | null;
    is_active: number;
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
    is_low_stock?: number;
}
export interface SupplyMovement {
    id: number;
    supply_id: string;
    supply_name: string | null;
    quantity_delta: number;
    movement_type: SupplyMovementType;
    unit: SupplyUnit;
    stock_after: number;
    unit_cost: number | null;
    total_cost: number | null;
    unit_cost_after: number | null;
    reason: string | null;
    actor_user_id: string;
    actor_name: string | null;
    reference_type: string | null;
    reference_id: string | null;
    created_at: string;
}
export interface CreateSupplyInput {
    id?: string;
    name: string;
    baseUnit: string;
    stockQuantity?: number;
    lowStockThreshold?: number | null;
    unitCost?: number | null;
    unitCostUnit?: string;
    isActive?: boolean;
    actorUserId?: string;
}
export interface RecordMovementInput {
    supplyId: string;
    movementType: 'receive' | 'count' | 'adjustment' | 'waste';
    quantity: number;
    unit?: string;
    unitCost?: number | null;
    totalCost?: number | null;
    reason?: string | null;
    actorUserId: string;
    referenceType?: string | null;
    referenceId?: string | number | null;
    createdAt?: string;
}
export declare function getSupply(db: ReturnType<typeof getDatabase>, id: string): SupplyRecord;
export declare function listSupplies(db: ReturnType<typeof getDatabase>, filters?: {
    includeInactive?: boolean;
    search?: string;
    lowStockOnly?: boolean;
}): SupplyRecord[];
export declare function createSupply(db: ReturnType<typeof getDatabase>, input: CreateSupplyInput): SupplyRecord;
export declare function updateSupply(db: ReturnType<typeof getDatabase>, id: string, input: {
    name?: string;
    isActive?: boolean;
    lowStockThreshold?: number | null;
    unitCost?: number | null;
    unitCostUnit?: string;
}): SupplyRecord;
export declare function softDeleteSupply(db: ReturnType<typeof getDatabase>, id: string): void;
export declare function applySupplyStockChange(db: ReturnType<typeof getDatabase>, options: {
    supplyId: string;
    quantityDelta: number;
    movementType: SupplyMovementType;
    unit?: string;
    unitCost?: number | null;
    totalCost?: number | null;
    unitCostAfter?: number | null;
    reason?: string | null;
    actorUserId: string;
    referenceType?: string | null;
    referenceId?: string | number | null;
    createdAt?: string;
}): {
    stockBefore: number;
    stockAfter: number;
    movementId: number;
};
export declare function recordSupplyMovement(db: ReturnType<typeof getDatabase>, input: RecordMovementInput): SupplyMovement | null;
export declare function listSupplyMovements(db: ReturnType<typeof getDatabase>, filters?: {
    supplyId?: string;
    movementType?: SupplyMovementType;
    search?: string;
    beforeId?: number;
    perPage?: number;
}): {
    movements: SupplyMovement[];
    nextCursor: number | null;
};
//# sourceMappingURL=supplies.d.ts.map