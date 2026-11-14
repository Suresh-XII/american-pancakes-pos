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
export declare function deliverySandboxExclusionSql(orderIdExpr?: string): string;
export declare function refundSandboxExclusionSql(billIdExpr?: string): string;
//# sourceMappingURL=sandbox-exclusion.d.ts.map