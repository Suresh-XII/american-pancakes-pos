/** Bill-level cash-back and item-level refund processing for paid bills. */
import { getDatabase } from '../db';
type Database = ReturnType<typeof getDatabase>;
export declare function getTenantCurrency(db?: Database): string;
export interface PreVerifiedRefundApprover {
    id: string;
    verifiedPinHash: string;
    lateRefund: boolean;
}
export interface RefundRequest {
    billId: string | number;
    orderItemId?: number | null;
    amountCents?: number;
    method?: string;
    reason?: string | null;
    shiftId?: string | null;
    overridePin?: string;
    approverId?: string | null;
    createdByUserId: string;
    clientIp: string;
    checkPinRateLimit: (key: string) => boolean;
    isPinRateLimited: (key: string) => boolean;
    clearPinRateLimit: (key: string) => void;
    idempotencyKey?: string | null;
    requestHash?: string;
    preVerifiedApprover?: PreVerifiedRefundApprover | null;
}
export interface RefundResult {
    refund: any;
    bill: any;
}
/** Returns the refundable balance for a bill in integer minor units. */
export declare function getRefundableBalance(db: Database, billId: string | number, currency?: string): {
    paidCents: number;
    refundedCents: number;
    refundableCents: number;
};
export interface RefundBillRecord {
    id: string | number;
    order_id: string | number;
    customer_id?: string | null;
    bill_number?: string | null;
    split_group_id?: string | null;
    payment_status?: string | null;
    [key: string]: unknown;
}
export interface RefundOrderItemRecord {
    id: string | number;
    order_id: string | number;
    product_id?: string | number | null;
    product_name?: string | null;
    product_sku?: string | null;
    unit_price: number;
    quantity: number;
    subtotal: number;
    tax_amount?: number | null;
    tax_breakdown?: string | null;
    tax_snapshot?: string | null;
    tax_type?: string | null;
    discount_amount?: number | null;
    total: number;
    variant_selection?: string | null;
    modifier_selection?: string | null;
    status: string;
    [key: string]: unknown;
}
export interface ValidatedRefundPreconditions {
    lateRefund: boolean;
    bill: RefundBillRecord;
    item: RefundOrderItemRecord | null;
    amountCents: number;
    currency: string;
}
/** Check whether a bill/order is in late refund status or expired. */
export declare function checkIsLateRefund(db: Database, billId: string | number, nowMs?: number): {
    lateRefund: boolean;
    bill: RefundBillRecord;
};
/** Validates refund preconditions before PIN verification and write transaction. */
export declare function validateRefundPreconditions(db: Database, req: {
    billId: string | number;
    method?: string;
    amountCents?: number;
    orderItemId?: number | null;
    createdByUserId?: string;
}, nowMs?: number): ValidatedRefundPreconditions;
/** Validates, authorizes, and persists a refund inside an active transaction. */
export declare function createRefund(db: Database, req: RefundRequest): RefundResult;
export {};
//# sourceMappingURL=refund.d.ts.map