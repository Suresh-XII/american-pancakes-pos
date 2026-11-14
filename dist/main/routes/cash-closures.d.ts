import { Request } from 'express';
import { getDatabase } from '../db';
import { tenantTimezone, type CashDrawerMovementType } from '../services/cash-drawer-movements';
import { DisplayTaxComponent } from '../services/tax-components';
declare const router: import("express-serve-static-core").Router;
export declare function cashOperationFailurePayload(req: Request, errorMessage: string, capturePoint: string, outcome: 'not_applied' | 'applied' | 'unknown', displayCode?: string): Record<string, unknown>;
interface CashDrawerMovementRow {
    id: number;
    business_date: string;
    movement_type: CashDrawerMovementType;
    amount_cents: number;
    reason: string | null;
    created_by: string;
    created_by_name: string;
    created_at: string;
    voided_at: string | null;
    voided_by: string | null;
    voided_by_name: string | null;
    void_reason: string | null;
}
export { tenantTimezone };
export declare function listCashDrawerMovementsForSession(db: ReturnType<typeof getDatabase>, sessionId: number, start: string, end: string, includeVoided?: boolean): CashDrawerMovementRow[];
interface PaymentMethodRow {
    method: string;
    count: number;
    total: number;
}
export interface DayAggregates {
    billCount: number;
    refundCount: number;
    grossCollectedCents: number;
    refundedCents: number;
    netCollectedCents: number;
    cashSalesCents: number;
    cashRefundsByCreatedAtCents: number;
    openingFloatCents: number;
    payInCents: number;
    payOutCents: number;
    safeDropCents: number;
    cashMovements: CashDrawerMovementRow[];
    paymentMethods: {
        method: string;
        count: number;
        total_cents: number;
    }[];
    staffSales: {
        user_id: string;
        name: string;
        role: string;
        revenue_cents: number;
        orderCount: number;
    }[];
    taxComponents: DisplayTaxComponent[];
}
/**
 * Shared by reports (financial-summary, summary, sales, daily-stats, daily-sales-export)
 * and cash-closure snapshots; boolean flags default to false.
 *
 * `keyByPaidAt` is true only for the day-close snapshot: a bill paid in
 * installments carries one `timestamp` per payment line, so keying lines
 * by their own timestamp would scatter one bill's cash across several
 * business days while gross/staff/tax (all keyed by `b.paid_at`) land on
 * the settlement day. Keying by `paid_at` keeps every Z section on the
 * same day so the immutable snapshot reconciles with itself. Live reports
 * keep the default: a partial payment belongs to the day it was taken.
 */
export interface PaymentMethodBreakdownOptions {
    /** Day-based calls: tenant-local business date(s). Ignored when explicitWindow is set. */
    startDate?: string;
    endDate?: string;
    paidOnly?: boolean;
    excludeCancelledOrders?: boolean;
    attributeRefundsToBillDate?: boolean;
    keyByPaidAt?: boolean;
    /** Raw timestamp window for session attribution (#279). */
    explicitWindow?: [string, string];
}
export declare function paymentMethodBreakdown(db: ReturnType<typeof getDatabase>, opts: PaymentMethodBreakdownOptions): PaymentMethodRow[];
/**
 * Recompute every snapshot field for one tenant-local business_date.
 *
 * Display totals deliberately include cancelled-order bills: a paid bill's
 * cash already left the drawer and remains there until counted, regardless
 * of the order's later status. `financial-summary` does not apply a
 * cancelled-order filter either — this snapshot matches its display
 * totals by construction. The drawer-reality inputs (active movement totals,
 * the `expected_cash_cents` cash-only raw filter, and refunds-by-created_at)
 * are applied separately so the rest of the snapshot reconciles with
 * financial-summary.
 *
 * Exported so Wave 3 (the live X-report) can reuse this pipeline without
 * duplicating the template or the tax-components hydration. Returns a
 * plain `DayAggregates` shape already converted to INTEGER minor units.
 */
export declare function computeDayAggregates(db: ReturnType<typeof getDatabase>, businessDate: string): DayAggregates;
/**
 * Single home for the expected-cash formula shared by day close, session
 * close, and the live session snapshot (#279): opening float plus active
 * movements plus cash sales minus cash refunds (drawer reality).
 */
export declare function expectedCashFromAggregates(aggregates: Pick<DayAggregates, 'openingFloatCents' | 'cashSalesCents' | 'payInCents' | 'payOutCents' | 'safeDropCents' | 'cashRefundsByCreatedAtCents'>): number;
/**
 * Drawer-reality cash inputs for one raw timestamp window: cash sales by each
 * payment line's timestamp (includes partial tenders before `paid_at` is set)
 * and cash refunds by created_at (the day the cash left the drawer). Display
 * gross/staff/tax still use `paid_at`; only expected-cash drawer math uses
 * this path. Shared by the full aggregate pipeline and session snapshots.
 */
export declare function cashDrawerSalesAndRefunds(db: ReturnType<typeof getDatabase>, start: string, end: string, minorFactor: number): {
    salesCents: number;
    refundsCents: number;
};
export interface CashMovementTotals {
    openingFloatCents: number;
    payInCents: number;
    payOutCents: number;
    safeDropCents: number;
}
/**
 * Signed movement totals. Sessions carry the float on the session row, so
 * callers pass excludeOpeningFloat=true to avoid double-counting an
 * in-window opening_float movement; day close passes false.
 */
export declare function sumCashMovements(movements: CashDrawerMovementRow[], excludeOpeningFloat: boolean): CashMovementTotals;
/**
 * Session-scoped expected cash: float + drawer movements + cash sales − cash
 * refunds. Attribution is ownership-first: rows carrying this session's
 * cash_session_id count regardless of timestamp because they were created
 * while it was open; pre-v91 NULL-owner rows fall back to opened_at→end.
 * opening_float movements are not summed here because
 * the float lives on the session row.
 *
 * Session and day expected cash share the same drawer classifier: built-in
 * cash plus configured payment methods whose name resolves to Cash (via
 * payment_method_id). The JSON scan is correctness-first; use an event ledger
 * if bill volume makes session polling hot.
 */
export declare function sessionExpectedCash(db: ReturnType<typeof getDatabase>, session: {
    id: number;
    opening_float_cents: number;
    opened_at?: string;
}, end: string, movements?: CashDrawerMovementRow[]): number;
/** Sales and refunds attributed to a session for shift X/Z reports. */
export declare function sessionFinancialTotals(db: ReturnType<typeof getDatabase>, session: {
    id: number;
    opened_at: string;
}, end: string): Pick<DayAggregates, 'billCount' | 'refundCount' | 'grossCollectedCents' | 'refundedCents' | 'netCollectedCents' | 'paymentMethods'>;
export declare function computeSessionAggregates(db: ReturnType<typeof getDatabase>, session: {
    id: number;
    opened_at: string;
    opening_float_cents: number;
}, end: string): DayAggregates;
/**
 * Window-based aggregation shared by day close and session close (#279).
 * Same queries as the day pipeline, parameterized by raw timestamp window
 * so session windows (opened_at → now, possibly crossing midnight) work
 * without touching day-close behavior.
 */
export declare function computePeriodAggregates(db: ReturnType<typeof getDatabase>, start: string, end: string, movements: CashDrawerMovementRow[], openingFloatOverride: number | null, session?: {
    id: number;
    opened_at: string;
}): DayAggregates;
export { router as cashClosureRoutes };
//# sourceMappingURL=cash-closures.d.ts.map