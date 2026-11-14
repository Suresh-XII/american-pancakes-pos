/**
 * Per-item packaging cost is deliberately sourced only from the immutable v125
 * allocation snapshots. A missing or incomplete checkout_v1 snapshot is
 * unknown; callers must never substitute the present-day supply cost for
 * historical reporting. Pre-v125 legacy items with no serving allocation keep
 * their established ingredient-only profitability baseline (zero recorded
 * packaging cost), rather than being repriced from a current supply record.
 */
export declare const ORDER_ITEM_PACKAGING_COST_CTE = "\nitem_packaging_costs AS (\n  SELECT\n    item.id AS order_item_id,\n    CASE\n      WHEN (COUNT(DISTINCT serving.id) > 0\n        AND COUNT(DISTINCT CASE WHEN packaging.id IS NOT NULL THEN serving.id END) = COUNT(DISTINCT serving.id)\n        AND SUM(CASE\n          WHEN packaging.cost_known = 1\n           AND packaging.total_cost_snapshot IS NOT NULL THEN 0\n          ELSE 1\n        END) = 0)\n       OR (COALESCE(order_row.inventory_lifecycle, 'legacy') = 'legacy'\n         AND COUNT(serving.id) = 0)\n      THEN 1 ELSE 0\n    END AS packaging_cost_known,\n    COALESCE(SUM(CASE\n      WHEN packaging.cost_known = 1\n       AND packaging.total_cost_snapshot IS NOT NULL\n      THEN packaging.total_cost_snapshot ELSE 0\n    END), 0) AS packaging_cost\n  FROM order_items item\n  JOIN orders order_row ON order_row.id = item.order_id\n  LEFT JOIN order_item_serving_allocations serving ON serving.order_item_id = item.id\n  LEFT JOIN order_item_packaging_allocations packaging\n    ON packaging.serving_allocation_id = serving.id\n  GROUP BY item.id\n)";
export type DirectCostAggregate = {
    known_cost_quantity: number;
    unknown_cost_quantity: number;
    known_cost_revenue: number;
    known_ingredient_cost: number;
    known_packaging_cost: number;
};
export type DirectCostMetrics = {
    known_cost_revenue: number;
    known_cost_quantity: number;
    unknown_cost_quantity: number;
    cost_status: 'known' | 'partial' | 'unknown';
    ingredient_cost: number | null;
    packaging_cost: number | null;
    total_direct_cost: number | null;
    gross_contribution: number | null;
    gross_contribution_margin_percent: number | null;
    /** Backwards-compatible aliases for the former ingredient-only fields. */
    profit: number | null;
    margin_percent: number | null;
};
export declare function deriveDirectCostMetrics(row: DirectCostAggregate, fractionDigits: number): DirectCostMetrics;
//# sourceMappingURL=profitability.d.ts.map