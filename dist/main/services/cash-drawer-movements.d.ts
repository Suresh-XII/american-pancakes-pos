/**
 * Cash drawer movement writes and closed-day / store-timezone helpers shared by
 * the standalone cash-closures routes, paid-bill payment-method corrections, and
 * the expense payment ledger. One place owns the closed-day rule, so a payment
 * or expense correction can never move money into a day the store already closed.
 *
 * Leaf module: route modules and services import from here, and nothing here
 * imports a route, so no require cycle exists. Callers open the transaction and
 * own their session gate — the standalone routes keep the configurable
 * `require_open_shift` behaviour, while expense cash entries require a real
 * open session unconditionally.
 */
import { getDatabase } from '../db';
type CashDrawerDb = ReturnType<typeof getDatabase>;
export type CashDrawerMovementType = 'opening_float' | 'pay_in' | 'pay_out' | 'safe_drop';
export declare const MAX_MOVEMENT_REASON_LENGTH = 500;
/** Resolves the store's configured timezone through the country profile. */
export declare function tenantTimezone(): string;
/** A closed day refuses new drawer money even while a session is still open. */
export declare function closedDayExists(db: CashDrawerDb, businessDate: string): boolean;
export interface CashDrawerMovementInput {
    businessDate: string;
    movementType: CashDrawerMovementType;
    amountCents: number;
    reason: string | null;
    createdBy: string;
    cashSessionId: number;
}
/**
 * Inserts one drawer movement inside the caller's transaction. Amount and
 * session are validated by the caller; this owns the closed-day guard and the
 * shared reason bound.
 */
export declare function insertCashDrawerMovement(db: CashDrawerDb, input: CashDrawerMovementInput): number;
export {};
//# sourceMappingURL=cash-drawer-movements.d.ts.map