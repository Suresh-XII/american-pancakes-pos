"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDER_ITEM_PACKAGING_COST_CTE = void 0;
exports.deriveDirectCostMetrics = deriveDirectCostMetrics;
const decimal_js_1 = __importDefault(require("decimal.js"));
const supplies_1 = require("./supplies");
/**
 * Per-item packaging cost is deliberately sourced only from the immutable v125
 * allocation snapshots. A missing or incomplete checkout_v1 snapshot is
 * unknown; callers must never substitute the present-day supply cost for
 * historical reporting. Pre-v125 legacy items with no serving allocation keep
 * their established ingredient-only profitability baseline (zero recorded
 * packaging cost), rather than being repriced from a current supply record.
 */
exports.ORDER_ITEM_PACKAGING_COST_CTE = `
item_packaging_costs AS (
  SELECT
    item.id AS order_item_id,
    CASE
      WHEN (COUNT(DISTINCT serving.id) > 0
        AND COUNT(DISTINCT CASE WHEN packaging.id IS NOT NULL THEN serving.id END) = COUNT(DISTINCT serving.id)
        AND SUM(CASE
          WHEN packaging.cost_known = 1
           AND packaging.total_cost_snapshot IS NOT NULL THEN 0
          ELSE 1
        END) = 0)
       OR (COALESCE(order_row.inventory_lifecycle, 'legacy') = 'legacy'
         AND COUNT(serving.id) = 0)
      THEN 1 ELSE 0
    END AS packaging_cost_known,
    COALESCE(SUM(CASE
      WHEN packaging.cost_known = 1
       AND packaging.total_cost_snapshot IS NOT NULL
      THEN packaging.total_cost_snapshot ELSE 0
    END), 0) AS packaging_cost
  FROM order_items item
  JOIN orders order_row ON order_row.id = item.order_id
  LEFT JOIN order_item_serving_allocations serving ON serving.order_item_id = item.id
  LEFT JOIN order_item_packaging_allocations packaging
    ON packaging.serving_allocation_id = serving.id
  GROUP BY item.id
)`;
function deriveDirectCostMetrics(row, fractionDigits) {
    const knownQty = Number(row.known_cost_quantity || 0);
    const unknownQty = Number(row.unknown_cost_quantity || 0);
    const costStatus = knownQty > 0 ? (unknownQty === 0 ? 'known' : 'partial') : 'unknown';
    const knownCostRevenue = (0, supplies_1.roundCurrencyCost)(Number(row.known_cost_revenue || 0), fractionDigits);
    if (knownQty <= 0) {
        return {
            known_cost_revenue: knownCostRevenue,
            known_cost_quantity: 0,
            unknown_cost_quantity: unknownQty,
            cost_status: costStatus,
            ingredient_cost: null,
            packaging_cost: null,
            total_direct_cost: null,
            gross_contribution: null,
            gross_contribution_margin_percent: null,
            profit: null,
            margin_percent: null,
        };
    }
    const ingredientCost = (0, supplies_1.roundCurrencyCost)(Number(row.known_ingredient_cost || 0), fractionDigits);
    const packagingCost = (0, supplies_1.roundCurrencyCost)(Number(row.known_packaging_cost || 0), fractionDigits);
    const totalDirectCost = (0, supplies_1.roundCurrencyCost)(new decimal_js_1.default(ingredientCost).plus(packagingCost), fractionDigits);
    const grossContribution = (0, supplies_1.roundCurrencyCost)(new decimal_js_1.default(knownCostRevenue).minus(totalDirectCost), fractionDigits);
    const grossContributionMarginPercent = knownCostRevenue > 0
        ? new decimal_js_1.default(grossContribution)
            .div(knownCostRevenue)
            .mul(100)
            .toDecimalPlaces(2, decimal_js_1.default.ROUND_HALF_UP)
            .toNumber()
        : null;
    return {
        known_cost_revenue: knownCostRevenue,
        known_cost_quantity: knownQty,
        unknown_cost_quantity: unknownQty,
        cost_status: costStatus,
        ingredient_cost: ingredientCost,
        packaging_cost: packagingCost,
        total_direct_cost: totalDirectCost,
        gross_contribution: grossContribution,
        gross_contribution_margin_percent: grossContributionMarginPercent,
        profit: grossContribution,
        margin_percent: grossContributionMarginPercent,
    };
}
//# sourceMappingURL=profitability.js.map