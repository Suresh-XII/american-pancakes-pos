import { getDatabase } from '../db';
import { type ChargeTaxContext, type Customer, type TaxBreakdown, type TaxRollup, type TenantInfo } from './tax';
import { type AppliedCharge } from '../../shared/charges';
type Database = ReturnType<typeof getDatabase>;
type OrderItemRow = {
    id?: number | string;
    order_id?: number | string;
    product_id?: number | string | null;
    product_name?: string | null;
    unit_price?: number | string | null;
    quantity?: number | null;
    subtotal: number | null;
    tax_amount: number | null;
    tax_type: string | null;
    tax_breakdown: string | null;
    tax_snapshot: string | null;
    total?: number | null;
    status?: string | null;
};
export interface OrderTotals {
    subtotal: number;
    totalTax: number;
    exclusiveTax: number;
    allTaxBreakdowns: TaxBreakdown[][];
    allTaxSnapshots: (string | null)[];
    activeItems: OrderItemRow[];
    db?: Database;
}
export declare function calculateOrderTotals(db: Database, orderId: string | number): OrderTotals;
export type RecomputeOrderTotalsInput = {
    tenantInfo: TenantInfo;
    /** Row the packaging/delivery/service charges are read from, for charge tax and the total. */
    chargeContext: ChargeTaxContext;
    customer: Customer | null;
    /**
     * Fresh per-item sums from `calculateOrderTotals`. Its `subtotal` is the only
     * basis the discount and the rescaling are computed from: the tax being
     * rescaled is a sum over these same items, so a basis describing any other set
     * of items produces a ratio that is not defensible.
     */
    totals: OrderTotals;
    /** Effective order-level discount, already resolved by the caller. */
    discountAmount: number;
    /**
     * `when-discounted` rescale and round item tax only when a discount applies;
     * `always` rescale and round it regardless. The order sites use the former and
     * the bill discount site the latter, which is why the flag exists.
     */
    taxScaling: 'when-discounted' | 'always';
    /**
     * Charges the unified engine resolved for this order. When present, the
     * standard ids are projected onto the dedicated charge columns instead of the
     * row's own amounts, and non-standard charges are added to the total so
     * nothing is dropped from what the customer owes.
     */
    appliedCharges?: AppliedCharge[] | null;
    /** Standard columns resolved from current definitions and retained snapshots. */
    chargeColumnOverrides?: {
        service_charge?: number;
        packaging_charge?: number;
    };
};
export interface RecomputedOrderTotals {
    /** The subtotal the discount was deducted from: always the fresh item sum. */
    subtotal: number;
    discountedSubtotal: number;
    taxRatio: number;
    /** Item tax after the discount share is applied. */
    taxAmount: number;
    exclusiveTaxAmount: number;
    taxRollup: TaxRollup;
    /** Exact total, before any payable (settlement) rounding. */
    total: number;
    roundOff: 0;
    /** Charges the engine applied; null when the merchant configured none. */
    appliedCharges: AppliedCharge[] | null;
    /** Charge amounts projected onto the dedicated columns. */
    chargeColumns: {
        service_charge: number;
        packaging_charge: number;
    } | null;
}
/** Recomputes document taxes, discounts, charges, and totals for order mutations. */
export declare function recomputeOrderTotals(input: RecomputeOrderTotalsInput): RecomputedOrderTotals;
export declare const COMPLETED_KDS_PROJECTION_WINDOW_MS: number;
export declare function completedKdsProjectionCutoff(nowMs?: number): string;
export interface ReconciledOrderStatusResult {
    changed: boolean;
    previousStatus: string | null;
    status: string | null;
}
export declare function reconcileActiveOrderStatusFromItems(db: Database, orderId: number | string, actorUserId: string): ReconciledOrderStatusResult;
export {};
//# sourceMappingURL=orders.d.ts.map