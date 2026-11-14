/**
 * Backend entry point for the unified charges & fees engine.
 *
 * The contracts and pure calculation live in `shared/charges.ts` so the
 * POS cart preview and the authoritative backend totals cannot drift apart.
 */
import { type AppliedCharge, type ChargeDefinition, type StandardChargeColumns } from '../../shared/charges';
export { CHARGE_ID_PATTERN, ChargeValidationError, MAX_CHARGE_DEFINITIONS, MAX_CHARGE_ID_LENGTH, MAX_CHARGE_NAME_LENGTH, MAX_CHARGE_ORDER_TYPES, MAX_PERCENTAGE, STANDARD_CHARGE_COLUMN_IDS, VALID_CHARGE_ORDER_TYPES, calculateAppliedCharges, normalizeChargeDefinitions, parseAppliedCharges, parseStoredChargeDefinitions, serializeAppliedCharges, toStandardChargeColumns, totalAppliedCharges, } from '../../shared/charges';
export type { AppliedCharge, ChargeCalculationBasis, ChargeDefinition, ChargeOrderType, ChargeType, StandardChargeColumnId, StandardChargeColumns, } from '../../shared/charges';
export declare const CUSTOM_CHARGES_SETTING_KEY = "custom_charges";
/** Configured charges for the tenant; unreadable or malformed storage reads as none. */
export declare function getChargeDefinitions(): ChargeDefinition[];
export interface ResolveOrderChargesInput {
    definitions: ChargeDefinition[];
    orderType: string;
    subtotal: number;
    discountAmount: number;
    currency: string;
    /** Raw `charges_breakdown` already on the row, so waivers survive a recompute. */
    existingBreakdown?: unknown;
    /** Explicit waiver/opt-in ids; derived from the breakdown when omitted. */
    waivedIds?: string[];
    optedInIds?: string[];
}
export interface ResolvedOrderCharges {
    charges: AppliedCharge[];
    columns: StandardChargeColumns;
    ownsServiceChargeColumn: boolean;
    ownsPackagingChargeColumn: boolean;
    /**
     * True when the merchant configured a charge that matches this order. False
     * means the engine has nothing to say and the row keeps whatever charge
     * amounts it already carried.
     */
    configured: boolean;
}
/**
 * Resolves the charges to apply to an order at the tenant's own precision.
 *
 * Waivers recorded on the row are re-applied rather than reset, so a recompute
 * triggered by adding an item or changing a discount does not silently un-waive
 * a fee the cashier already removed. Optional charges the cashier opted into
 * stay applied for the same reason.
 */
export declare function resolveOrderCharges(input: ResolveOrderChargesInput): ResolvedOrderCharges;
/** Convenience wrapper that resolves charges from the tenant's stored definitions. */
export declare function buildAppliedCharges(args: {
    currency: string;
    orderType: string;
    subtotal: number;
    discountAmount: number;
    existingBreakdown?: unknown;
    /** Explicit cashier decisions; derived from the breakdown when omitted. */
    waivedIds?: string[];
    optedInIds?: string[];
}): ResolvedOrderCharges;
export interface ChargeToggle {
    chargeId: string;
    waived?: boolean;
    /** false removes an opt-in charge; true adds one. */
    applied?: boolean;
}
/**
 * Waiver and opt-in id sets after a cashier toggle, starting from the state
 * already recorded on the row. Returned so the caller can re-run the
 * calculation rather than hand-editing an amount.
 */
export declare function chargeIdsAfterToggle(args: {
    existingBreakdown?: unknown;
    definitions: ChargeDefinition[];
    toggle: ChargeToggle;
}): {
    waivedIds: string[];
    optedInIds: string[];
};
//# sourceMappingURL=charges.d.ts.map