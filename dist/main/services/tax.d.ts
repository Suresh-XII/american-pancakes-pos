import Decimal from 'decimal.js';
import { type TaxIdFormat } from '../countries';
export declare function computeDiscountTaxRatio(discountedSubtotal: Decimal.Value, subtotal: Decimal.Value): Decimal;
export interface TenantInfo {
    country: string;
    business_type: string;
    state_code: string;
    currency?: string;
    taxes_enabled: boolean;
}
export interface Product {
    id?: string | number;
    name?: string;
    price?: string | number;
    tax_type: string;
    tax_rate: number;
    tax_category?: string;
    tax_category_id?: string;
    tax_behavior?: 'country_default' | 'inclusive' | 'exclusive' | 'exempt';
}
export interface Customer {
    taxRegistrationNumber?: string;
    tax_registration_number?: string;
    customer_state_code?: string;
}
export interface TaxResult {
    tax_amount: number;
    tax_breakdown: TaxBreakdown[];
    tax_type: string;
    tax_snapshot?: Record<string, unknown> | null;
}
export interface TaxBreakdown {
    title: string;
    rate: number;
    amount: number;
}
export type ChargeTaxKind = 'packaging' | 'delivery' | 'service_charge';
export interface ChargeTaxCategorySelection {
    categoryId: string;
    overrideId?: string;
}
export interface ChargeTaxContext {
    packaging_charge?: number | string | null;
    delivery_charge?: number | string | null;
    service_charge?: number | string | null;
    packaging_tax_category_id?: string | null;
    delivery_tax_category_id?: string | null;
    service_charge_tax_category_id?: string | null;
}
export interface ChargeTaxSummary {
    taxAmount: number;
    exclusiveTaxAmount: number;
    breakdowns: TaxBreakdown[][];
    snapshotJson: string[];
}
export interface TaxRollup {
    taxAmount: number;
    exclusiveTaxAmount: number;
    breakdowns: TaxBreakdown[][];
    snapshotJson: string | null;
}
import type { CountryPack } from '../tax-packs/types';
export declare function getActiveCountryPack(country: string): CountryPack;
export declare function getCountryPackByVersion(packId: string | null | undefined, version: string | null | undefined, fallbackCountryCode?: string): CountryPack;
export declare function isTaxModuleActiveForCountry(country: string): boolean;
export declare function resolveTaxIdFormat(country: string): TaxIdFormat | null;
export declare const MAX_TAX_ID_LENGTH = 24;
export declare function validateTaxRegistrationNumber(country: string, value: string): {
    valid: boolean;
    format: TaxIdFormat | null;
};
export declare function previewCategoryRate(pack: CountryPack, businessType: string, categoryId: string): {
    percent: number;
    label: string;
} | null;
export declare function hasConfiguredTaxCategories(pack: CountryPack, businessType: string): boolean;
export declare function getActiveTaxOverride(entityType: string, entityId: string | number, packId: string): {
    id: string;
    categoryId: string;
} | null;
export declare function getConfiguredChargeTaxCategories(country: string): Partial<Record<ChargeTaxKind, ChargeTaxCategorySelection>>;
export declare function normalizeChargeAmount(value: unknown, kind: ChargeTaxKind): number;
export interface DocumentTaxCalculationInput {
    items?: Array<{
        lineId?: string;
        product: Product;
        taxableAmount: number;
    }>;
    chargeContext?: ChargeTaxContext | null;
    customer?: Customer | null;
    packOverride?: CountryPack | null;
}
export interface DocumentTaxResult {
    itemResults: TaxResult[];
    chargeTaxes: ChargeTaxSummary;
}
/**
 * Evaluates document-scoped taxes across all items and configured charges in a
 * single TaxEngine.calculate invocation, preserving document remainder allocation.
 */
export declare function calculateDocumentTaxes(tenant: TenantInfo, input: DocumentTaxCalculationInput): DocumentTaxResult;
/** Evaluates taxes across multiple items, returning item tax results. */
export declare function calculateDocumentItemTaxes(tenant: TenantInfo, items: Array<{
    lineId?: string;
    product: Product;
    taxableAmount: number;
}>, customer?: Customer | null, chargeContext?: ChargeTaxContext | null, packOverride?: CountryPack | null): TaxResult[];
/** Single-item adapter for legacy callers evaluating an isolated item. */
export declare function calculateItemTax(tenant: TenantInfo, product: Product, taxableAmount: number, customer: Customer | null, packOverride?: CountryPack | null): TaxResult;
/** Adapter evaluating configured charges in isolation when no items are present. */
export declare function calculateConfiguredChargeTaxes(tenant: TenantInfo, context: ChargeTaxContext, customer?: Customer | null, packOverride?: CountryPack | null): ChargeTaxSummary;
export declare function aggregateTaxBreakdown(itemBreakdowns: TaxBreakdown[][], minorFactor?: number): TaxBreakdown[];
export declare function aggregateTaxSnapshots(itemSnapshotsJson: (string | null | undefined)[]): string | null;
export declare function invertTaxSnapshot(raw: string | null | undefined): string | null;
export declare function invertTaxBreakdown(raw: string | null | undefined): string | null;
export declare function scaleTaxBreakdowns(breakdowns: any[], ratio: Decimal.Value, targetTaxAmount: number, minorFactor?: number): any[];
export declare function scaleTaxSnapshots(snapshotsJson: (string | null | undefined)[], ratio: Decimal.Value, minorFactor?: number): string[];
export declare function combineItemAndChargeTaxes(args: {
    itemTaxAmount: number;
    itemExclusiveTaxAmount: number;
    itemBreakdowns: any[];
    itemSnapshots: (string | null | undefined)[];
    itemTaxRatio: Decimal.Value;
    chargeTaxes: ChargeTaxSummary;
    minorFactor?: number;
}): TaxRollup;
export interface DocumentTaxAllocationItemInput {
    snapshot: string | Record<string, unknown> | null | undefined;
    lineIdOverride?: string;
}
export interface DocumentTaxAllocationItemOutput {
    handled: boolean;
    taxAmount: number;
    breakdown: TaxBreakdown[];
    snapshotJson: string | null;
}
/** Scales raw item tax components before document-scope remainder allocation across items and charges. */
export declare function allocateDocumentTaxRounding(args: {
    items: DocumentTaxAllocationItemInput[];
    chargeTaxes: ChargeTaxSummary;
    currency: string;
    minorFactor?: number;
    itemTaxRatio?: Decimal;
}): {
    itemOutputs: DocumentTaxAllocationItemOutput[];
    chargeTaxes: ChargeTaxSummary;
};
export interface DiscountedTaxItemInput {
    taxAmount: number;
    taxType: string | null;
    breakdown: TaxBreakdown[] | null;
    snapshot: string | Record<string, unknown> | null;
    lineIdOverride?: string;
}
/** Rolls up item and charge taxes, scaling document-scoped raw item components before rounding. */
export declare function rollupOrderTaxes(args: {
    items: DiscountedTaxItemInput[];
    chargeTaxes: ChargeTaxSummary;
    currency: string;
    decimals: number;
    minorFactor: number;
    itemTaxRatio: Decimal;
    taxesEnabled: boolean;
}): {
    itemTaxAmount: number;
    itemExclusiveTaxAmount: number;
    taxRollup: TaxRollup;
};
export declare function calculateTaxPreview(req: any, res: any): Promise<void>;
//# sourceMappingURL=tax.d.ts.map