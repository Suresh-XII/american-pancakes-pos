/**
 * Order item status rules shared by backend and renderer: keeps tax-components
 * item exclusion aligned across print paths and derives KDS/board order status.
 */
/** Item statuses excluded from active order calculations and printed tax. */
export declare const TERMINAL_ITEM_STATUSES: string[];
export declare function isTerminalItemStatus(status: unknown): boolean;
/**
 * Item statuses excluded from printed bill item lists.
 * Cancelled, voided, and negative void_adjustment rows are excluded, while
 * refunded rows remain on historical bill copies whose stored totals include them.
 */
export declare function isExcludedFromBillReceipt(status: unknown): boolean;
export type DerivedOrderKdsStatus = 'pending' | 'preparing' | 'ready' | 'served';
export type CustomerDisplayProjectedStatus = 'pending' | 'preparing' | 'ready';
export interface OrderItemStatusLike {
    status?: unknown;
    quantity?: unknown;
}
export declare function deriveOrderStatusFromItems(items: readonly OrderItemStatusLike[] | null | undefined): DerivedOrderKdsStatus | null;
export declare function projectBoardStatusFromItems(items: readonly OrderItemStatusLike[] | null | undefined): CustomerDisplayProjectedStatus | null;
//# sourceMappingURL=order-item-status.d.ts.map