import { getDatabase } from '../db';
import { checkPinRateLimit, isPinRateLimited, clearPinRateLimit, resetPinRateLimitForTests, withPinVerificationLock, PIN_MAX_ATTEMPTS, PIN_WINDOW_MS } from '../middleware/security';
export { checkPinRateLimit, isPinRateLimited, clearPinRateLimit, resetPinRateLimitForTests, withPinVerificationLock, PIN_MAX_ATTEMPTS, PIN_WINDOW_MS, };
export declare function preVerifyKitchenDeliveryPin(db: ReturnType<typeof getDatabase>, overridePin: unknown, clientIp?: string, approverId?: unknown): Promise<{
    id: string;
    verifiedPinHash: string;
} | null>;
export declare function checkKitchenDeliveryStatus(db: ReturnType<typeof getDatabase>, orderId: string | number, overridePin?: unknown, clientIp?: string, billId?: string | number, preVerifiedManager?: {
    id: string;
    verifiedPinHash: string;
} | null, approverId?: unknown): {
    allowed: boolean;
    count: number;
    items: string[];
    overridden?: boolean;
    managerUserId?: string;
};
export declare function getTenantCurrency(): string;
type BillLoyaltyRow = {
    [key: string]: unknown;
    id: number;
    customer_id?: number | string | null;
};
export declare function addBillLoyaltyFields(db: ReturnType<typeof getDatabase>, bill: BillLoyaltyRow | null | undefined): BillLoyaltyRow | null | undefined;
type ChildItemAllocation = {
    weights: number[];
    index: number;
};
export declare function projectOrderItems(order: any, rawItemRows: any[], allocations?: any[], childItemAllocations?: Map<number, ChildItemAllocation>, minorFactor?: number): any[];
export declare function getOrderWithItems(db: ReturnType<typeof getDatabase>, orderId: number, billId?: number): any;
export declare function getOrdersWithItemsForBills(db: ReturnType<typeof getDatabase>, bills: any[]): Map<number, any>;
export declare function createOrSyncBillForOrder(db: ReturnType<typeof getDatabase>, orderId: number | string): any;
export declare function allocateMinorUnits(sourceMinor: number, weights: number[]): number[];
export declare function allocateSignedMinorUnits(sourceMinor: number, weights: number[]): number[];
export declare function reconcileSnapshotAllocations(entries: Array<{
    allocations: number[];
}>, targets: number[]): void;
export declare function allocateTaxSnapshots(sourceRaw: unknown, weights: number[], snapshotWeights?: Array<number[] | null>, minorFactor?: number): (string | null)[];
interface OrderBillSyncValues {
    subtotal: number;
    taxAmount: number;
    taxBreakdown: string | null;
    taxSnapshot: string | null;
    discountAmount: number;
    deliveryCharge: number;
    packagingCharge: number;
    serviceCharge: number;
    /** Itemised engine charges; null leaves any bill breakdown untouched. */
    chargesBreakdown?: string | null;
    total: number;
}
export declare function syncUnpaidBillsForOrder(db: ReturnType<typeof getDatabase>, orderId: number | string, source: OrderBillSyncValues, country: string): void;
export declare function paymentAmountMinorUnits(value: unknown, currency: string, label?: string): number;
export declare function paymentAmountCents(value: unknown, label?: string): number;
export declare function flushPendingExactBalanceAutomations(): void;
export declare function handlePostPaymentRelease(db: ReturnType<typeof getDatabase>, orderId: string | number, actorUserId?: string | null): Promise<void>;
export declare function queuePostPaymentRelease(db: ReturnType<typeof getDatabase>, orderId: number | string, actorUserId?: string | null): void;
export declare function reconcileOrderSettlement(db: ReturnType<typeof getDatabase>, orderId: number | string, changedAt?: string, actorUserId?: string | null): {
    orderFullyPaid: boolean;
    orderRow: any;
};
export declare function completeExactBalanceSettlement(db: ReturnType<typeof getDatabase>, billId: string | number, newTotal: number, currency: string, changedAt?: string, overridePin?: unknown, clientIp?: string, preVerifiedManager?: {
    id: string;
    verifiedPinHash: string;
} | null, approverId?: unknown): any;
type CorrectionBill = Record<string, unknown> & {
    id: string;
    payment_status: string;
    payment_details: string | unknown[] | Record<string, unknown> | null;
    paid_at?: string | null;
    created_at?: string | null;
    split_group_id?: string | null;
};
export declare function paymentMethodCorrectionEligibility(db: ReturnType<typeof getDatabase>, bill: CorrectionBill): {
    correctable: boolean;
    reason: string | null;
    lines: {
        index: number;
        correctable: boolean;
        reason: string | null;
    }[];
};
export declare const billRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=bills.d.ts.map