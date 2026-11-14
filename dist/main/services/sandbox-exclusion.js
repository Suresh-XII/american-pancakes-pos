"use strict";
/**
 * Delivery sandbox order exclusion SQL helpers.
 *
 * Stage 7.1: Delivery Sandbox Order Isolation.
 * Excludes simulated delivery orders (delivery_order_tracking.is_simulated = 1)
 * from all business reporting, financial accounting, exports, and cash drawer reconciliations.
 *
 * Genuine delivery orders (is_simulated = 0) and in-store orders (dine-in / takeaway)
 * remain fully included in reporting.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverySandboxExclusionSql = deliverySandboxExclusionSql;
exports.refundSandboxExclusionSql = refundSandboxExclusionSql;
function deliverySandboxExclusionSql(orderIdExpr = 'o.id') {
    return `NOT EXISTS (
    SELECT 1
    FROM delivery_order_tracking d_sb
    WHERE d_sb.internal_order_id = ${orderIdExpr}
      AND d_sb.is_simulated = 1
  )`;
}
function refundSandboxExclusionSql(billIdExpr = 'r.bill_id') {
    return `NOT EXISTS (
    SELECT 1
    FROM bills b_sb
    JOIN delivery_order_tracking d_sb ON d_sb.internal_order_id = b_sb.order_id
    WHERE b_sb.id = ${billIdExpr}
      AND d_sb.is_simulated = 1
  )`;
}
//# sourceMappingURL=sandbox-exclusion.js.map