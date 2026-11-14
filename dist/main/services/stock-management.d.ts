import { getDatabase } from '../db';
import { type SupplyUnit } from './units';
type Database = ReturnType<typeof getDatabase>;
export type PurchaseUnit = SupplyUnit | 'piece' | 'pack';
export type PurchaseStatus = 'draft' | 'review' | 'received';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export declare class StockManagementError extends Error {
    readonly statusCode: number;
    constructor(statusCode: number, message: string);
}
export interface Supplier {
    id: string;
    name: string;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    is_active: number;
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
    purchase_count?: number;
}
export declare function listSuppliers(db: Database, includeInactive?: boolean): Supplier[];
export declare function createSupplier(db: Database, input: Omit<Supplier, 'id' | 'is_active' | 'deleted_at' | 'created_at' | 'updated_at'> & {
    isActive?: boolean;
}): Supplier;
export declare function getSupplier(db: Database, supplierId: string): Supplier;
export declare function updateSupplier(db: Database, supplierId: string, input: Partial<Omit<Supplier, 'id' | 'deleted_at' | 'created_at' | 'updated_at'>> & {
    isActive?: boolean;
}): Supplier;
export declare function deleteSupplier(db: Database, supplierId: string): void;
export interface PurchaseItemInput {
    supplyId: string;
    quantity: number;
    purchaseUnit: PurchaseUnit;
    packSizeInBase?: number | null;
    unitPrice: number;
}
export interface Purchase {
    id: string;
    supplier_id: string | null;
    supplier_name?: string | null;
    purchase_date: string;
    invoice_number: string | null;
    additional_expenses: number;
    payment_status: PaymentStatus;
    notes: string | null;
    status: PurchaseStatus;
    items_total: number;
    grand_total: number;
    received_at: string | null;
    received_by_user_id: string | null;
    created_by_user_id: string;
    created_at: string;
    updated_at: string;
    items?: PurchaseItem[];
}
export interface PurchaseItem {
    id: number;
    purchase_id: string;
    supply_id: string;
    supply_name_snapshot: string;
    supply_base_unit_snapshot: SupplyUnit;
    quantity: number;
    purchase_unit: PurchaseUnit;
    pack_size_in_base: number | null;
    quantity_in_base: number;
    unit_price: number;
    line_total: number;
}
declare function getPurchaseInternal(db: Database, purchaseId: string): Purchase;
export declare const getPurchase: typeof getPurchaseInternal;
export declare function listPurchases(db: Database, limit?: number): Purchase[];
export interface PurchaseInput {
    supplierId?: string | null;
    purchaseDate: string;
    invoiceNumber?: string | null;
    additionalExpenses?: number;
    paymentStatus?: PaymentStatus;
    notes?: string | null;
    items: PurchaseItemInput[];
    actorUserId: string;
}
export declare function createPurchase(db: Database, input: PurchaseInput): Purchase;
export declare function updatePurchase(db: Database, purchaseId: string, input: PurchaseInput): Purchase;
export declare function reviewPurchase(db: Database, purchaseId: string, actorUserId: string): Purchase;
export declare function receivePurchase(db: Database, purchaseId: string, actorUserId: string): Purchase;
export interface StockCount {
    id: string;
    status: 'draft' | 'review' | 'posted';
    notes: string | null;
    created_at: string;
    reviewed_at: string | null;
    posted_at: string | null;
    items?: StockCountItem[];
}
export interface StockCountItem {
    id: number;
    stock_count_id: string;
    supply_id: string;
    supply_name_snapshot: string;
    base_unit_snapshot: SupplyUnit;
    expected_quantity: number;
    observed_stock_quantity: number | null;
    observed_at: string | null;
    actual_quantity: number | null;
    unit_cost_snapshot: number | null;
    variance_quantity: number | null;
    variance_cost: number | null;
    reason: string | null;
    supply_movement_id: number | null;
}
declare function getStockCountInternal(db: Database, countId: string): StockCount;
export declare const getStockCount: typeof getStockCountInternal;
export declare function listStockCounts(db: Database, limit?: number): StockCount[];
export declare function startStockCount(db: Database, actorUserId: string, notes?: string | null): StockCount;
export declare function saveStockCount(db: Database, countId: string, items: Array<{
    supplyId: string;
    actualQuantity: number;
    reason?: string | null;
}>): StockCount;
export declare function reviewStockCount(db: Database, countId: string, actorUserId: string): StockCount;
export declare function postStockCount(db: Database, countId: string, actorUserId: string): StockCount;
export declare function recordWastage(db: Database, input: {
    supplyId: string;
    quantity: number;
    unit: SupplyUnit;
    wastageDate: string;
    reason: string;
    notes?: string | null;
    actorUserId: string;
}): {
    id: string;
    supply_movement_id: number | null;
};
export declare function stockDashboard(db: Database): Record<string, unknown>;
export {};
//# sourceMappingURL=stock-management.d.ts.map