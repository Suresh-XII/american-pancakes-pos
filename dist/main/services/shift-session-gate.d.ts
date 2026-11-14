/**
 * Shift-session enforcement gate (issue #279). Leaf module: route modules
 * (bills, cash-closures, cash-sessions) import from here so no require
 * cycle exists between them.
 */
import { getDatabase } from '../db';
export interface CashSessionRow {
    id: number;
    opened_by: string;
    opened_by_name: string;
    opened_at: string;
    opening_float_cents: number;
    status: 'open' | 'closed';
    closed_at: string | null;
    closed_by: string | null;
    closure_id: number | null;
}
export declare const NO_CASH_SESSION_ID = 0;
export declare function isPerStaffShiftsEnabled(db?: ReturnType<typeof getDatabase>): boolean;
export declare function listOpenSessions(db: ReturnType<typeof getDatabase>): CashSessionRow[];
export declare function getOpenSession(db: ReturnType<typeof getDatabase>, userId?: string | null): CashSessionRow | undefined;
/**
 * Effective-method check mirroring preparePaymentBatch (bills.ts) resolution:
 * builtins pass through, `custom` lines resolve via payment_method_id, other
 * names resolve case-insensitively. Anything unresolvable is not cash here —
 * the payment pipeline itself rejects it with 400, so the gate never masks
 * a validation error.
 */
export declare function isCashTender(db: ReturnType<typeof getDatabase>, payment: unknown): boolean;
/**
 * When the owner opted into `require_open_shift`, cash touching the drawer
 * needs an open session. Non-cash tenders are never gated. Missing setting
 * rows (pre-v90 upgrades) read as off.
 */
export declare function requireOpenSessionForCash(db: ReturnType<typeof getDatabase>, userId?: string | null): void;
/**
 * Payment-line variant: gates when any line is effectively cash (see
 * isCashTender), so a custom method named "Cash" cannot bypass the gate.
 */
export declare function requireOpenSessionForCashTender(db: ReturnType<typeof getDatabase>, payments: unknown[], userId?: string | null): void;
//# sourceMappingURL=shift-session-gate.d.ts.map