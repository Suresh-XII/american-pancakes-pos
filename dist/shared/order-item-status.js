"use strict";
/**
 * Order item status rules shared by backend and renderer: keeps tax-components
 * item exclusion aligned across print paths and derives KDS/board order status.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_ITEM_STATUSES = void 0;
exports.isTerminalItemStatus = isTerminalItemStatus;
exports.isExcludedFromBillReceipt = isExcludedFromBillReceipt;
exports.deriveOrderStatusFromItems = deriveOrderStatusFromItems;
exports.projectBoardStatusFromItems = projectBoardStatusFromItems;
/** Item statuses excluded from active order calculations and printed tax. */
exports.TERMINAL_ITEM_STATUSES = [
    'cancelled',
    'voided',
    'void_adjustment',
    'refunded',
];
function isTerminalItemStatus(status) {
    return typeof status === 'string' && exports.TERMINAL_ITEM_STATUSES.includes(status);
}
/**
 * Item statuses excluded from printed bill item lists.
 * Cancelled, voided, and negative void_adjustment rows are excluded, while
 * refunded rows remain on historical bill copies whose stored totals include them.
 */
function isExcludedFromBillReceipt(status) {
    return status !== 'refunded' && isTerminalItemStatus(status);
}
const DELIVERED_ITEM_STATUSES = new Set(['served', 'completed']);
const READY_OR_DELIVERED_ITEM_STATUSES = new Set(['ready', 'served', 'completed']);
const STARTED_ITEM_STATUSES = new Set(['preparing', 'ready', 'served', 'completed']);
function deriveOrderStatusFromItems(items) {
    if (!Array.isArray(items) || items.length === 0)
        return null;
    const liveItems = items.filter((item) => item != null && !isTerminalItemStatus(item.status) && Number(item.quantity) > 0);
    if (liveItems.length === 0)
        return null;
    if (liveItems.every((item) => typeof item.status === 'string' && DELIVERED_ITEM_STATUSES.has(item.status))) {
        return 'served';
    }
    if (liveItems.every((item) => typeof item.status === 'string' && READY_OR_DELIVERED_ITEM_STATUSES.has(item.status)) &&
        liveItems.some((item) => item.status === 'ready')) {
        return 'ready';
    }
    if (liveItems.some((item) => typeof item.status === 'string' && STARTED_ITEM_STATUSES.has(item.status))) {
        return 'preparing';
    }
    return 'pending';
}
function projectBoardStatusFromItems(items) {
    const derived = deriveOrderStatusFromItems(items);
    if (derived === null || derived === 'served')
        return null;
    return derived;
}
//# sourceMappingURL=order-item-status.js.map