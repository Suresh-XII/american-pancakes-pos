/**
 * Day-close guards and shared shift-close unpaid queries. Leaf module: no
 * route imports, so cash-closures and cash-sessions can both depend on it.
 */
import { getDatabase } from '../db';
import { type CashSessionRow } from './shift-session-gate';
/** Tenant-local business date when the shift was opened. */
export declare function sessionBusinessDate(db: ReturnType<typeof getDatabase>, session: Pick<CashSessionRow, 'opened_at'>): string;
/** All open shifts that must close before day-close for `businessDate`. */
export declare function openSessionsBlockingDayClose(db: ReturnType<typeof getDatabase>, businessDate: string): CashSessionRow[];
/** Open shift that must close before day-close for `businessDate`, if any. */
export declare function openSessionBlockingDayClose(db: ReturnType<typeof getDatabase>, businessDate: string): CashSessionRow | undefined;
export interface ShiftUnpaidOrderSample {
    order_id: number;
    order_number: string;
    bill_id: number;
    bill_number: string;
    status: string;
    payment_status: string;
    total: number;
    balance: number;
    balance_cents: number;
    created_at: string;
}
export interface ShiftUnpaidInWindowSummary {
    count: number;
    bill_count: number;
    pending_cents: number;
    sample: ShiftUnpaidOrderSample[];
}
/**
 * Unpaid or partially-paid bills created during [openedAt, end] - informational
 * carry-over preview for shift close. Cancelled orders are excluded.
 */
export declare function shiftUnpaidBillsInWindow(db: ReturnType<typeof getDatabase>, openedAt: string, end: string): ShiftUnpaidInWindowSummary;
export declare function findUnpaidInShiftOrders(db: ReturnType<typeof getDatabase>, session: Pick<CashSessionRow, 'opened_at'>, asOf: string): ShiftUnpaidInWindowSummary;
//# sourceMappingURL=cash-day-close-guards.d.ts.map