/**
 * Unified charges & fees engine - shared contracts and pure calculation.
 *
 * One model covers service charges, packaging fees and arbitrary surcharges.
 * Definitions live in the `custom_charges` setting as JSON; the itemised result
 * is persisted per order/bill in `charges_breakdown`.
 *
 * All arithmetic happens in integer minor units derived from the tenant's own
 * fraction digits, so zero-decimal currencies (JPY/KRW/VND) and three-decimal
 * currencies (KWD/BHD) round and persist correctly. Nothing here assumes two
 * decimals.
 */
export declare const VALID_CHARGE_ORDER_TYPES: readonly ["dine_in", "takeaway", "delivery", "online"];
export type ChargeOrderType = (typeof VALID_CHARGE_ORDER_TYPES)[number];
export type ChargeType = 'percentage' | 'fixed';
export type ChargeCalculationBasis = 'net' | 'gross';
/** Charge ids that mirror the dedicated orders/bills columns. */
export declare const STANDARD_CHARGE_COLUMN_IDS: readonly ["service_charge", "packaging_charge"];
export type StandardChargeColumnId = (typeof STANDARD_CHARGE_COLUMN_IDS)[number];
export interface ChargeDefinition {
    id: string;
    name: string;
    type: ChargeType;
    /** Rate between 0 and 100 for percentage, otherwise a currency amount. */
    value: number;
    calculation_basis: ChargeCalculationBasis;
    order_types: ChargeOrderType[];
    /** Cashier may waive this charge in cart or checkout. */
    is_optional: boolean;
    is_default_active: boolean;
    tax_category_id?: string | null;
    is_active: boolean;
}
export interface AppliedCharge {
    id: string;
    name: string;
    type: ChargeType;
    /** Present for percentage charges; the configured rate. */
    rate?: number;
    amount: number;
    calculation_basis: ChargeCalculationBasis;
    /** Explicit waiver state. A waived charge keeps `amount: 0`. */
    waived: boolean;
    tax_category_id?: string | null;
}
export declare const CHARGE_ID_PATTERN: RegExp;
export declare const MAX_CHARGE_ID_LENGTH = 64;
export declare const MAX_CHARGE_DEFINITIONS = 50;
export declare const MAX_CHARGE_NAME_LENGTH = 80;
export declare const MAX_PERCENTAGE = 100;
export declare const MAX_CHARGE_ORDER_TYPES: 4;
export declare class ChargeValidationError extends Error {
    readonly statusCode = 400;
    constructor(message: string);
}
/**
 * Validates an untrusted payload into charge definitions. The first invalid
 * entry rejects the whole array, so a partial write never lands.
 */
export declare function normalizeChargeDefinitions(raw: unknown, currencyDecimals?: number): ChargeDefinition[];
/** Reads a stored definitions list for calculation, discarding anything invalid. */
export declare function parseStoredChargeDefinitions(raw: unknown, currencyDecimals?: number): ChargeDefinition[];
/** Clamps untrusted fraction digits to the range ISO 4217 can express. */
export declare function normalizeCurrencyDecimals(currencyDecimals: number): number;
export interface CalculateAppliedChargesInput {
    definitions: ChargeDefinition[];
    orderType: string;
    /** Raw subtotal before order-level discounts. */
    subtotal: number;
    discountAmount: number;
    /** Charge ids the cashier has waived. Honoured only for optional charges. */
    waivedIds?: Iterable<string>;
    /**
     * Charge ids the cashier explicitly opted into. A charge that is not
     * `is_default_active` is never applied unless it appears here, so "available"
     * charges stay out of the bill until they are added on purpose.
     */
    optedInIds?: Iterable<string>;
    /** Tenant currency fraction digits (0 for JPY/KRW/VND, 3 for KWD/BHD). */
    currencyDecimals: number;
}
/**
 * Applies the matching active charges to an order.
 *
 * `net` basis applies to the discounted subtotal, `gross` to the raw subtotal.
 * A waived charge records `amount: 0` with `waived: true`, so an audit can tell
 * a waived fee apart from a fee configured at zero.
 */
export declare function calculateAppliedCharges(input: CalculateAppliedChargesInput): AppliedCharge[];
export interface StandardChargeColumns {
    service_charge: number;
    packaging_charge: number;
    /** Sum of every non-standard charge, so totals still reconcile. */
    other_charges: number;
}
/**
 * Projects applied charges onto the legacy dedicated columns that daily
 * exports, the tax service and Z-reports already aggregate. Non-standard
 * charges are summed rather than dropped, so nothing is lost.
 */
export declare function toStandardChargeColumns(charges: AppliedCharge[], currencyDecimals: number): StandardChargeColumns;
/** Persisted `charges_breakdown` payload; null or unparseable reads as empty. */
export declare function parseAppliedCharges(raw: unknown): AppliedCharge[];
export declare function serializeAppliedCharges(charges: AppliedCharge[]): string;
export interface ReceiptChargeLine {
    id: string;
    name: string;
    amount: number;
    waived: boolean;
}
/**
 * Itemised charges to print on a receipt, from the engine's breakdown.
 *
 * Empty when the bill predates the engine, so the caller keeps rendering the
 * dedicated service_charge/packaging_charge columns. Only non-zero charges are
 * returned: a waived fee records amount 0 and must not be billed on the receipt.
 */
export declare function receiptChargeLines(raw: unknown): ReceiptChargeLine[];
/** Total of every non-waived applied charge. */
export declare function totalAppliedCharges(charges: AppliedCharge[], currencyDecimals?: number): number;
//# sourceMappingURL=charges.d.ts.map