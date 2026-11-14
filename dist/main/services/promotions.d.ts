import { getDatabase } from '../db';
export type PromotionDiscountType = 'bogo' | 'percentage' | 'fixed_amount';
export type PromotionTargetType = 'all_pancakes' | 'category' | 'products' | 'all';
export type BogoPricingRule = 'cheapest_free' | 'same_item';
export interface Promotion {
    id: string;
    name: string;
    description: string | null;
    discount_type: PromotionDiscountType;
    target_type: PromotionTargetType;
    target_category_id: string | null;
    discount_value: number;
    bogo_buy_qty: number;
    bogo_get_qty: number;
    bogo_pricing_rule: BogoPricingRule;
    is_loyalty_reward: boolean;
    loyalty_qualifying_visits_required: number;
    start_at: string | null;
    end_at: string | null;
    is_active: boolean;
    is_automatic: boolean;
    max_redemptions: number | null;
    current_redemptions_count: number;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}
export interface PromotionDbRow {
    id: string;
    name: string;
    description: string | null;
    discount_type: string;
    target_type: string;
    target_category_id: string | null;
    discount_value: number;
    bogo_buy_qty: number;
    bogo_get_qty: number;
    bogo_pricing_rule: string;
    is_loyalty_reward: number;
    loyalty_qualifying_visits_required: number;
    start_at: string | null;
    end_at: string | null;
    is_active: number;
    is_automatic: number;
    max_redemptions: number | null;
    current_redemptions_count: number;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}
export declare function parsePromotionRow(row: PromotionDbRow): Promotion;
export interface OrderItemForDiscount {
    id?: number | string;
    product_id: string;
    product_name?: string;
    variant_id?: string | null;
    variant_selection?: string | null;
    quantity: number;
    unit_price: number;
    subtotal?: number;
    category_id?: string | null;
    category_name?: string | null;
}
export interface FreeUnitAllocation {
    orderItemId?: number | string;
    productId: string;
    variantId?: string | null;
    productName: string;
    unitPrice: number;
}
export interface PromotionCalculationResult {
    eligible: boolean;
    ineligibleReason?: string;
    promotion: Promotion;
    pairs: number;
    eligibleItemCount: number;
    freeUnits: FreeUnitAllocation[];
    itemDiscountMap: Record<string, number>;
    totalDiscountAmount: number;
    originalSubtotal: number;
    discountedSubtotal: number;
}
export interface LoyaltyEligibilityResult {
    eligible: boolean;
    reason?: string;
    qualifyingPaidVisits: number;
    visitsRequired: number;
    visitsNeeded: number;
    isSixthVisitReward: boolean;
}
type Database = ReturnType<typeof getDatabase>;
/** Check if product qualifies for promotion */
export declare function isProductEligibleForPromotion(db: Database, promotion: Promotion, productId: string, productName?: string, categoryId?: string | null): boolean;
/** Check if promotion is active and within valid date window */
export declare function isPromotionActiveAndValid(promotion: Promotion, refDate?: Date): {
    valid: boolean;
    reason?: string;
};
/**
 * Validates loyalty eligibility for 6th-visit BOGO reward.
 * Requires 5 qualifying paid visits since the last loyalty reward redemption.
 * A redeemed reward visit does NOT count as a qualifying paid visit.
 */
export declare function checkCustomerLoyaltyRewardEligibility(db: Database, customerId: string, targetOrderId?: number | string | null): LoyaltyEligibilityResult;
/**
 * Calculates discount for an order or cart items based on promotion configuration.
 */
export declare function calculatePromotionDiscount(db: Database, promotion: Promotion, items: OrderItemForDiscount[], customerId?: string | null, currency?: string): PromotionCalculationResult;
/**
 * Applies a promotion to an active order.
 */
export declare function applyPromotionToOrder(db: Database, orderId: number | string, promotionId: string, actorUserId: string, clientIp?: string): {
    order: unknown;
    bill?: unknown;
    calculation: PromotionCalculationResult;
};
/**
 * Removes active promotion from order and restores standard pricing.
 */
export declare function removePromotionFromOrder(db: Database, orderId: number | string, actorUserId: string): {
    order: unknown;
    bill?: unknown;
};
/**
 * Authoritative settlement-time promotion redemption recorder.
 */
export declare function recordPromotionRedemptionOnCheckout(db: Database, orderId: number | string, billId?: number | string | null, actorUserId?: string | null): void;
export interface PromotionReportsSummary {
    totalRedemptionsCount: number;
    totalDiscountAmount: number;
    bogoRedemptionsCount: number;
    bogoDiscountAmount: number;
    bogoPaidQuantity: number;
    bogoFreeQuantity: number;
    bogoPreparedQuantity: number;
    launchBogoRedemptionsCount: number;
    launchBogoDiscountAmount: number;
    manualBogoRedemptionsCount: number;
    manualBogoDiscountAmount: number;
    loyaltyRewardRedemptionsCount: number;
    loyaltyRewardDiscountAmount: number;
    redemptionsByCashier: Array<{
        cashierUserId: string | null;
        cashierName: string;
        redemptionCount: number;
        totalDiscount: number;
    }>;
    redemptionsByDate: Array<{
        date: string;
        redemptionCount: number;
        totalDiscount: number;
    }>;
}
/**
 * Reporting query for promotions & discounts.
 */
export declare function getPromotionReportsSummary(db: Database, startDate?: string | null, endDate?: string | null): PromotionReportsSummary;
export {};
//# sourceMappingURL=promotions.d.ts.map