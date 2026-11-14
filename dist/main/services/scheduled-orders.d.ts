/**
 * Scheduled orders release service and server-owned due sweep.
 *
 * Scheduled orders persist quoted items, prices, discounts, charges, taxes, and
 * totals immediately without touching product/variant/add-on/recipe stock or
 * notifying KDS/KOT. Inventory deduction, recipe depletion snapshots, KDS
 * broadcasts, and automatic KOT printing occur atomically at kitchen release.
 */
import { getDatabase } from '../db';
export type OrderReleaseStatus = 'scheduled' | 'released' | 'blocked';
export type ReleaseTrigger = 'sweep' | 'startup' | 'resume' | 'manual' | 'payment';
export type CheckoutStage = 'building' | 'awaiting_payment' | 'paid';
export type DispatchPolicy = 'immediate' | 'on_payment';
export declare const SCHEDULED_SWEEP_INTERVAL_MS = 10000;
export declare const ALLOWED_SCHEDULED_ORDER_TYPES: Set<string>;
export declare class ScheduledOrderError extends Error {
    readonly statusCode: number;
    readonly code: string;
    constructor(statusCode: number, message: string, code: string);
}
export interface ScheduledOrderDbRow {
    id: number;
    order_number: string;
    user_id: string | null;
    type: string;
    status: string;
    scheduled_for: string | null;
    release_status: OrderReleaseStatus;
    released_at: string | null;
    release_blocked_reason: string | null;
    checkout_stage?: CheckoutStage | null;
    dispatch_policy?: DispatchPolicy | null;
    inventory_lifecycle?: string | null;
    [key: string]: unknown;
}
export interface ReleasePreconditionContext {
    db: ReturnType<typeof getDatabase>;
    order: ScheduledOrderDbRow;
    trigger: ReleaseTrigger;
    nowIso: string;
}
export interface ReleasePreconditionDecision {
    allow: boolean;
    holdReason?: string;
    markBlocked?: boolean;
}
export interface ReleaseScheduledOrderOptions {
    trigger: ReleaseTrigger;
    actorUserId?: string | null;
    nowDate?: Date;
    autoPrintKot?: boolean;
    /** Extension hook so multi-counter checkout can gate release on payment stage. */
    checkPreconditions?: (ctx: ReleasePreconditionContext) => ReleasePreconditionDecision;
}
export interface ReleaseScheduledOrderResult {
    outcome: 'released' | 'already_released' | 'blocked' | 'skipped';
    order: ScheduledOrderDbRow;
    reason?: string;
    kotAutoPrinted: boolean;
}
export interface ScheduledSweepSummary {
    checkedCount: number;
    releasedIds: number[];
    blockedIds: number[];
    skippedIds: number[];
}
export declare function isScheduledOrderRow(order: {
    scheduled_for?: unknown;
    release_status?: unknown;
} | null | undefined): boolean;
export declare function isUnreleasedOrderRow(order: {
    release_status?: unknown;
} | null | undefined): boolean;
export declare function resolveStoreTimezone(db?: ReturnType<typeof getDatabase>): string;
export declare function validateScheduledOrderRequest(db: ReturnType<typeof getDatabase>, params: {
    orderType: unknown;
    scheduledForInput: unknown;
    nowMs?: number;
}): {
    scheduledForUtc: string;
    timezone: string;
} | null;
/**
 * True once any payment has been recorded against any bill on the order,
 * including partial payments or payments later refunded.
 */
export declare function hasRecordedOrderPayment(db: ReturnType<typeof getDatabase>, orderId: string | number): boolean;
/**
 * Scheduled orders allow item and financial edits only before the first
 * payment is recorded. Afterwards, staff must use correction or refund flows.
 */
export declare function assertScheduledOrderUnpaidForEdit(db: ReturnType<typeof getDatabase>, orderId: string | number, order: {
    scheduled_for?: string | null;
    release_status?: string | null;
    dispatch_policy?: string | null;
    checkout_stage?: string | null;
} | null | undefined): void;
/**
 * Shared, transactional release operation for scheduled orders.
 *
 * - Runs inside a SQLite transaction with compare-and-check on `release_status`
 *   so concurrent due sweeps and manual retries never deduct stock twice.
 * - Uses a nested savepoint so any stock shortfall or unusable catalog item
 *   rolls back partial item deductions while committing `release_status = 'blocked'`
 *   and `release_blocked_reason` on the whole order.
 * - Preserves saved prices, discounts, charges, taxes, and totals without repricing.
 */
export declare function releaseScheduledOrder(db: ReturnType<typeof getDatabase>, orderId: string | number, options: ReleaseScheduledOrderOptions): Promise<ReleaseScheduledOrderResult>;
/**
 * Releases all due scheduled orders (`release_status = 'scheduled'` and
 * `scheduled_for <= now`). Orders already in `release_status = 'blocked'` are
 * intentionally excluded and require an explicit staff retry.
 */
export declare function sweepDueScheduledOrders(db: ReturnType<typeof getDatabase>, options?: {
    trigger?: Exclude<ReleaseTrigger, 'manual'>;
    nowDate?: Date;
    autoPrintKot?: boolean;
    checkPreconditions?: (ctx: ReleasePreconditionContext) => ReleasePreconditionDecision;
}): Promise<ScheduledSweepSummary>;
export declare function triggerScheduledOrderSweep(trigger?: Exclude<ReleaseTrigger, 'manual'>, nowDate?: Date): Promise<ScheduledSweepSummary>;
export declare function startScheduledOrderSweep(intervalMs?: number): void;
export declare function stopScheduledOrderSweep(): void;
export interface ScheduledOrdersCursor {
    rank: number;
    scheduled_for: string;
    id: number;
}
export declare function encodeScheduledOrdersCursor(cursor: ScheduledOrdersCursor): string;
export declare function decodeScheduledOrdersCursor(raw: string): ScheduledOrdersCursor | null;
//# sourceMappingURL=scheduled-orders.d.ts.map