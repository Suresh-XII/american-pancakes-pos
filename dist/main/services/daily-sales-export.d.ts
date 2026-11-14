import type { Database } from 'better-sqlite3';
import { type LocalePreferences } from '../countries';
export declare const DAILY_SALES_EXPORT_MAX_RANGE_DAYS = 93;
export declare const DAILY_SALES_TAX_INCOMPLETE_WARNING = "Incomplete historical tax detail: rate or taxable base was not stored; tax_amount is included in reconciliation.";
export declare const DAILY_SALES_SUMMARY_TAX_WARNING = "Incomplete historical tax detail: one or more historical records lacked rate or taxable base breakdown; stored tax amounts are included in tax_total.";
export declare class DailySalesExportValidationError extends Error {
    readonly statusCode = 400;
    constructor(message: string);
}
export type DailySalesCostStatus = 'known' | 'partial' | 'unknown';
export type DailySalesExportItemRow = {
    product_id: string;
    product_name: string;
    product_sku: string | null;
    quantity: number;
    gross_item_sales: number;
    item_discounts: number;
    net_item_sales: number;
    tax_amount: number;
    ingredient_cost: number | null;
    packaging_cost: number | null;
    total_direct_cost: number | null;
    gross_contribution: number | null;
    gross_contribution_margin_percent: number | null;
    profit: number | null;
    margin_percent: number | null;
    cost_status: DailySalesCostStatus;
};
export type DailySalesExportPaymentRow = {
    method: string;
    total: number;
};
export type DailySalesExportPaymentLineRow = {
    bill_number: string;
    order_number: string;
    payment_time: string;
    method: string;
    amount: number;
    transaction_id: string;
};
export type DailySalesExportDayRow = {
    business_date: string;
    order_count: number;
    paid_bill_count: number;
    gross_collected: number;
    refunds_issued: number;
    net_collected: number;
    tax_total: number;
    discount_total: number;
    service_charge_total: number;
    packaging_charge_total: number;
    delivery_charge_total: number;
    known_cost_net_item_sales: number;
    ingredient_cost_total: number | null;
    packaging_cost_total: number | null;
    total_direct_cost: number | null;
    gross_contribution_total: number | null;
    gross_contribution_margin_percent: number | null;
    gross_profit_total: number | null;
    gross_margin_percent: number | null;
    cost_coverage_status: DailySalesCostStatus;
};
export type DailySalesExportTaxRow = {
    business_date: string;
    tax_name: string;
    tax_rate: number | null;
    taxable_base: number | null;
    tax_amount: number;
    gross_amount: number | null;
    shared_base: boolean;
    base_additive: boolean;
    incomplete_detail: boolean;
    warning: string;
};
export type DailySalesExportSummary = {
    business_date: string;
    from_date: string;
    to_date: string;
    day_count: number;
    timezone: string;
    business_day_start: string;
    currency: string;
    order_count: number;
    paid_bill_count: number;
    gross_collected: number;
    refunds_issued: number;
    net_collected: number;
    tax_total: number;
    discount_total: number;
    service_charge_total: number;
    packaging_charge_total: number;
    delivery_charge_total: number;
    known_cost_net_item_sales: number;
    ingredient_cost_total: number | null;
    packaging_cost_total: number | null;
    total_direct_cost: number | null;
    gross_contribution_total: number | null;
    gross_contribution_margin_percent: number | null;
    gross_profit_total: number | null;
    gross_margin_percent: number | null;
    cost_coverage_status: DailySalesCostStatus;
    tax_detail_complete: boolean;
    tax_detail_warning: string | null;
    payment_methods: DailySalesExportPaymentRow[];
};
export type DailySalesExportDataset = {
    summary: DailySalesExportSummary;
    daily: DailySalesExportDayRow[];
    taxes: DailySalesExportTaxRow[];
    items: DailySalesExportItemRow[];
    payments: DailySalesExportPaymentLineRow[];
};
export type DailySalesExportQueryInput = string | {
    date?: unknown;
    from?: unknown;
    to?: unknown;
    defaultDate?: string;
};
export type ResolvedDailySalesExportRange = {
    fromDate: string;
    toDate: string;
    dates: string[];
    isSingleDay: boolean;
};
export declare function parseValidBusinessDate(value: unknown): Date | null;
export declare function resolveDailySalesExportRange(input: DailySalesExportQueryInput, fallbackDate?: string, maxRangeDays?: number): ResolvedDailySalesExportRange;
export declare function resolveExportTimezone(): string;
/** Stable snake_case Summary key for a payment method (custom names may contain spaces). */
export declare function dailySalesPaymentMetricKey(method: string): string;
export declare function buildDailySalesExportDataset(input: DailySalesExportQueryInput, db?: Database, options?: {
    maxRangeDays?: number;
}): DailySalesExportDataset;
/** Flat metric/value rows for the Summary sheet / summary CSV (stable field order). */
export declare function dailySalesSummaryMetricRows(summary: DailySalesExportSummary): Array<{
    metric: string;
    value: string | number;
}>;
export declare const DAILY_SALES_DAILY_COLUMNS: readonly ["business_date", "order_count", "paid_bill_count", "gross_collected", "refunds_issued", "net_collected", "tax_total", "discount_total", "service_charge_total", "packaging_charge_total", "delivery_charge_total", "known_cost_net_item_sales", "ingredient_cost_total", "packaging_cost_total", "total_direct_cost", "gross_contribution_total", "gross_contribution_margin_percent", "gross_profit_total", "gross_margin_percent", "cost_coverage_status"];
export declare const DAILY_SALES_TAX_COLUMNS: readonly ["business_date", "tax_name", "tax_rate", "taxable_base", "tax_amount", "gross_amount", "shared_base", "base_additive", "incomplete_detail", "warning"];
export declare const DAILY_SALES_ITEM_COLUMNS: readonly ["product_id", "product_name", "product_sku", "quantity", "gross_item_sales", "item_discounts", "net_item_sales", "tax_amount", "ingredient_cost", "packaging_cost", "total_direct_cost", "gross_contribution", "gross_contribution_margin_percent", "profit", "margin_percent", "cost_status"];
export declare const DAILY_SALES_PAYMENT_COLUMNS: readonly ["bill_number", "order_number", "payment_time", "method", "amount", "transaction_id"];
export interface DailySalesHtmlOptions {
    businessName?: string;
    locale?: string;
    preferences?: LocalePreferences;
}
export declare const MAX_DAILY_SALES_HTML_BYTES: number;
export declare function serializeDailySalesExportHtml(dataset: DailySalesExportDataset, options?: DailySalesHtmlOptions): string;
export declare const DAILY_SALES_WHATSAPP_MAX_CHARS = 4096;
export type DailySalesWhatsAppOptions = {
    language?: string;
    locale?: string;
    preferences?: LocalePreferences;
    businessName?: string;
    maxChars?: number;
};
/**
 * Plain-text daily-sales summary for WhatsApp delivery. Uses store language,
 * regional money/number formatting, and progressive truncation so optional item
 * detail is shortened or dropped before financial totals are ever omitted.
 */
export declare function formatDailySalesWhatsAppMessage(dataset: DailySalesExportDataset, options?: DailySalesWhatsAppOptions): string;
//# sourceMappingURL=daily-sales-export.d.ts.map