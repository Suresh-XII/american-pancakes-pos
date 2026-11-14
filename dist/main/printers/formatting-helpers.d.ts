/** Thermal receipt formatting helpers and ESC/POS builder. Pure leaf module with no dependencies on document formatters. */
import { type ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import { type PrintWarning } from '../../shared/print';
import { type RasterSemanticUnit } from '../../shared/print/raster';
import type { PrinterCutMode } from './profiles';
export type { PrintWarning };
/** Keep catalog text from being interpreted as an ESC/POS line token. */
export declare function safePrinterText(text: string): string;
export declare function itemNameWidth(cols: number, amtLen: number): number;
export declare function itemAmountWidth(order: {
    items?: Array<{
        status?: unknown;
        total?: number;
        addons?: unknown;
    }>;
} | null | undefined, prefix: string, locale: string, trimDecimals: boolean, cols: number, fractionDigits?: number): number;
export declare function assertFinancialValueFitsColumns(value: string, cols: number, field?: string): void;
export declare function itemRows(item: any, nameLen: number, amtLen: number, cols: number, prefix: string, locale?: string, trimDecimals?: boolean, _language?: string, fractionDigits?: number, capabilities?: ThermalPrinterCapabilities): string[];
export declare function addonRows(addon: any, nameLen: number, amtLen: number, cols: number, prefix: string, locale?: string, trimDecimals?: boolean, _language?: string, fractionDigits?: number, capabilities?: ThermalPrinterCapabilities): string[];
export declare function financialRows(label: string, value: string, cols: number, _language?: string, capabilities?: ThermalPrinterCapabilities): string[];
export declare function taxBreakdownRows(title: string, rate: number | string | null | undefined, value: string, cols: number, language?: string, capabilities?: ThermalPrinterCapabilities): string[];
export declare function parseAddons(addons: any): any[];
/** The variant a sold order item was resolved from, as persisted on the item. */
export interface ItemVariantSelection {
    name?: string | null;
    sku?: string | null;
}
/** Read an order item's variant snapshot, stored either as JSON text or an object. */
export declare function parseVariantSelection(value: unknown): ItemVariantSelection | null;
/** Item heading that always names the variant sold. An item without a variant
 * prints exactly its product name, so existing receipts are unchanged. */
export declare function formatVariantItemHeading(productName: string, variant: ItemVariantSelection | null): string;
export declare function formatCurrency(amount: number, prefix: string, locale?: string, trimDecimals?: boolean, fractionDigits?: number): string;
export declare function rightAlign(text: string, width?: number): string;
export declare function truncate(text: string, length: number, _language?: string, capabilities?: ThermalPrinterCapabilities): string;
export declare function truncateShapedLine(text: string, length: number, arabicShaping: boolean, language?: string, capabilities?: ThermalPrinterCapabilities): string;
export declare function normalizePrintLanguage(language?: string): string;
export declare function wrapText(text: string, cols: number): string[];
export declare function pushWrapped(lines: string[], text: string, cols: number, _language?: string, capabilities?: ThermalPrinterCapabilities): void;
/** Centred counterpart of {@link pushWrapped}. */
export declare function pushCenteredWrapped(lines: string[], text: string, cols: number, _language?: string, capabilities?: ThermalPrinterCapabilities): void;
export declare function appendPoweredByFooter(lines: string[], cols?: number): void;
export declare function normalizeThermalText(text: string, capabilities?: ThermalPrinterCapabilities): string;
export declare function maskPhoneOnReceipt(phone: string): string;
export declare function resolveCurrencyPrefix(symbol: string, useUnicode: boolean, capabilities?: ThermalPrinterCapabilities, preserveConfiguredSymbol?: boolean, currencyCode?: string): string;
export declare function appendCashDrawerPulse(data: Buffer): Buffer;
export interface RasterLineUnit {
    readonly lineIndex: number;
    readonly lineCount?: number;
    readonly unit: RasterSemanticUnit;
}
export declare function buildEscPos(lines: string[], _useUnicode?: boolean, options?: {
    cutMode?: PrinterCutMode;
    arabicShaping?: boolean;
    columns?: number;
    language?: string;
    capabilities?: ThermalPrinterCapabilities;
    rasterUnits?: readonly RasterLineUnit[];
    rasterFailures?: readonly {
        lineIndex: number;
        lineCount: number;
        financial: boolean;
    }[];
    financialLineRanges?: readonly {
        lineIndex: number;
        lineCount: number;
    }[];
}, warnings?: PrintWarning[]): Buffer<ArrayBuffer>;
//# sourceMappingURL=formatting-helpers.d.ts.map