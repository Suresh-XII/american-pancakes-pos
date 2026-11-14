import { PrinterCutMode, SupportedPrinterProfile, dotsForPaperWidth, capabilitiesForPrinter } from './profiles';
import { loadInstalledPrintTemplate } from '../services/print-templates';
import { type FloErrorCode } from '../errors';
import { type DeliverySlipItemRow, type DeliverySlipOrderRow } from './document-delivery-slip';
import { type MenuDocument } from './document-menu';
import type { DeliverySlipAddressSource } from '../../shared/print';
import { type ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { RasterSemanticLineGroup } from '../../shared/print/raster';
import type { PrintDocument } from '../../shared/print/document';
import { type PrinterTextSize } from '../../shared/print/text-size';
import { hasFinancialPrintWarning, makeFinancialPrintRefusalMessage } from '../../shared/print/warnings';
import { type PrintWarning, type RasterLineUnit, itemNameWidth, itemAmountWidth, itemRows, addonRows, financialRows, formatCurrency, rightAlign, truncate, truncateShapedLine, normalizePrintLanguage, wrapText, pushWrapped, pushCenteredWrapped, appendPoweredByFooter, normalizeThermalText, resolveCurrencyPrefix, appendCashDrawerPulse, buildEscPos } from './formatting-helpers';
export { type PrintWarning, type RasterLineUnit, itemNameWidth, itemAmountWidth, itemRows, addonRows, financialRows, formatCurrency, rightAlign, truncate, truncateShapedLine, normalizePrintLanguage, wrapText, pushWrapped, pushCenteredWrapped, appendPoweredByFooter, normalizeThermalText, resolveCurrencyPrefix, appendCashDrawerPulse, buildEscPos, };
export { hasFinancialPrintWarning, makeFinancialPrintRefusalMessage };
export type PrintResult = {
    ok: boolean;
    code?: FloErrorCode;
    correlationId: string;
    stage: 'prepare' | 'dispatch';
    detail?: string;
    failureClass?: PrintFailureClass;
    platformErrorCode?: number;
    jobId?: number;
    driverName?: string;
    printerStatus?: number;
    warnings?: PrintWarning[];
};
/** Low-level dispatch result — carries the actual OS/driver reason, not just ok/fail. */
export type DispatchResult = {
    ok: boolean;
    detail?: string;
    failureClass?: PrintFailureClass;
    platformErrorCode?: number;
    jobId?: number;
    driverName?: string;
    printerStatus?: number;
    warnings?: PrintWarning[];
    bytes?: number[] | Buffer;
    preview?: boolean;
    connection_type?: string;
};
export type PrintFailureClass = 'not_configured' | 'offline' | 'needs_attention' | 'queue_unavailable' | 'spooler_error' | 'driver_error' | 'permission_denied' | 'timeout' | 'write_error' | 'unsupported' | 'unknown';
/** Strips PowerShell CLIXML serialization envelopes and extracts clean error text. */
export declare function sanitizePowerShellStderr(stderr?: string): string;
/** Stable, privacy-safe classification for fleet telemetry. */
export declare function classifyPrintFailure(detail?: string): PrintFailureClass;
export declare function isMasRuntime(): boolean;
export type PrinterColumnWidth = 36 | 42 | 48;
export interface PrinterInfo {
    name: string;
    make: string;
    model: string;
    connectionType: 'usb' | 'network' | 'bluetooth';
    deviceUri: string;
    driver?: string;
    status: 'idle' | 'printing' | 'offline';
    isDefault: boolean;
    ipAddress?: string;
    port?: number;
    paperWidth?: string;
    profileId?: string;
}
export declare function detectConnectedPrinters(signal?: AbortSignal): Promise<PrinterInfo[]>;
export declare function initPrinter(): Promise<void>;
export declare function printReceipt(order: any, bill: any, business?: any, template?: string, useUnicode?: boolean, isReprint?: boolean, signal?: AbortSignal, arabicShapingOverride?: boolean, language?: string, additionalLanguage?: string): Promise<DispatchResult>;
export declare function printKOT(order: any, items: any[], stationName: string, useUnicode?: boolean, targetPrinter?: any, signal?: AbortSignal, arabicShapingOverride?: boolean, language?: string): Promise<DispatchResult>;
/** Dispatch a rendered delivery slip to the resolved printer. */
export declare function printDeliverySlip(order: DeliverySlipOrderRow, items: readonly DeliverySlipItemRow[], contact: {
    name?: string;
    phone?: string;
    address?: string;
    addressSource?: DeliverySlipAddressSource | null;
}, useUnicode?: boolean, targetPrinter?: {
    readonly id?: unknown;
    readonly name?: unknown;
    readonly connection_type?: string;
    readonly paper_width?: string;
    readonly profile_id?: string;
}, signal?: AbortSignal, arabicShapingOverride?: boolean, language?: string, showCustomerPhone?: boolean): Promise<DispatchResult>;
export declare function printDeliverySlipDetailed(...args: Parameters<typeof printDeliverySlip>): Promise<PrintResult>;
export declare function buildEscPosQrCode(payload: string): Buffer;
export interface PaymentTicketOrder {
    readonly id: number | string;
    readonly order_number: string;
    readonly type: string;
    readonly table_id?: number | string | null;
    readonly table_name?: string | null;
    readonly customer_name?: string | null;
    readonly total: number;
    readonly created_at?: string;
    readonly scheduled_for?: string | null;
}
export interface PaymentTicketItem {
    readonly product_name: string;
    readonly quantity: number;
    readonly unit_price?: number;
    readonly total?: number;
}
export declare function printPaymentTicket(order: PaymentTicketOrder, items: readonly PaymentTicketItem[], options?: {
    balance?: number;
    useUnicode?: boolean;
    targetPrinter?: any;
    signal?: AbortSignal;
    preview?: boolean;
}): Promise<DispatchResult>;
export type PaymentTicketPrintResult = PrintResult & {
    bytes?: number[] | Buffer;
    preview?: boolean;
    connection_type?: string;
};
export declare function printPaymentTicketDetailed(...args: Parameters<typeof printPaymentTicket>): Promise<PaymentTicketPrintResult>;
/** Typed adapters used by API callers while legacy boolean callers migrate. */
export declare function printReceiptDetailed(...args: Parameters<typeof printReceipt>): Promise<PrintResult>;
export declare function printKOTDetailed(...args: Parameters<typeof printKOT>): Promise<PrintResult>;
export declare function columnsForPaperWidth(paperWidth: string): number | null;
export { dotsForPaperWidth, capabilitiesForPrinter };
export interface PrinterContext {
    profile: SupportedPrinterProfile;
    columns: number;
    capabilities: ThermalPrinterCapabilities;
}
/**
 * Resolves profile, layout column count, and capabilities aligned with printer paper_width and
 * text_size. `columns` is the width document layout must target; extra large text halves it.
 */
export declare function resolvePrinterContext(printer: any, arabicShapingOverride?: boolean): PrinterContext;
export declare function printMenuDocument(document: MenuDocument, signal?: AbortSignal, targetPrinter?: unknown, language?: string): Promise<DispatchResult & {
    bytes?: Buffer;
    connection_type?: string;
}>;
export declare function prepareReceipt(order: any, bill: any, business?: any, template?: string, useUnicode?: boolean, isReprint?: boolean, arabicShapingOverride?: boolean, language?: string, additionalLanguage?: string): {
    printer: any;
    data: Buffer;
    warnings: PrintWarning[];
    columns: number;
};
type RasterDocumentLines = {
    lines: string[];
    warnings: PrintWarning[];
    rasterGroups?: readonly RasterSemanticLineGroup[];
    /** Width the lines were laid out for when it differs from the printer's. */
    columns?: number;
};
type RasterBusinessInput = Record<string, unknown> | null | undefined;
export declare function receiptDocumentLines(order: unknown, bill: unknown, business: RasterBusinessInput, template: string, columns: number, useUnicode: boolean, isReprint: boolean, arabicShaping: boolean, language: string, additionalLanguage: string | undefined, cutMode: PrinterCutMode, capabilities: ThermalPrinterCapabilities): RasterDocumentLines | null;
export declare function rasterizePrintDocumentForWebUsb(document: PrintDocument, template: 'classic' | 'compact', profileId: string, options: {
    columns: number;
    language: string;
    locale: string;
    currency: string;
    currencySymbol: string;
    trimDecimals: boolean;
    useUnicode: boolean;
    arabicShaping: boolean;
    timezone?: string;
}): Promise<{
    ok: true;
    data: Buffer;
    warnings: PrintWarning[];
    rasterSelected: boolean;
    rasterFailed: boolean;
} | {
    ok: false;
    error: string;
}>;
export declare function rasterizeKotDocumentForWebUsb(document: import('../../shared/print/document').KotDocument, profileId: string, options: {
    columns: number;
    language: string;
    locale: string;
    timezone?: string;
    useUnicode: boolean;
    arabicShaping: boolean;
}): Promise<{
    ok: true;
    data: Buffer;
    warnings: PrintWarning[];
    rasterSelected: boolean;
    rasterFailed: boolean;
} | {
    ok: false;
    error: string;
}>;
export declare function formatReceipt(order: any, bill: any, business?: any, template?: string, cols?: number, useUnicode?: boolean, isReprint?: boolean, cutMode?: PrinterCutMode, warnings?: PrintWarning[], arabicShaping?: boolean, language?: string, additionalLanguage?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
export declare function normalizeReceiptTemplate(template?: string): 'classic' | 'compact';
export declare function renderPluginReceipt(template: ReturnType<typeof loadInstalledPrintTemplate>, order: any, bill: any, biz: any, cols: number, useUnicode: boolean, isReprint: boolean, cutMode: PrinterCutMode, warnings?: PrintWarning[], arabicShaping?: boolean, lang?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
type PluginReceiptLines = {
    lines: string[];
    columns: number;
    financialLineRanges: Array<{
        lineIndex: number;
        lineCount: number;
    }>;
    rasterGroups: RasterSemanticLineGroup[];
};
export declare function pluginReceiptLines(template: NonNullable<ReturnType<typeof loadInstalledPrintTemplate>>, order: unknown, bill: unknown, biz: unknown, cols: number, useUnicode: boolean, isReprint: boolean, warnings?: PrintWarning[], arabicShaping?: boolean, lang?: string, capabilities?: ThermalPrinterCapabilities): PluginReceiptLines;
/**
 * Picks the pack width profile by physical paper width, then reflows its layout when enlarged text
 * narrows the target column count.
 */
export declare function selectTemplateRenderProfile(payload: any, layoutColumns: number, textSize: PrinterTextSize, warnings?: PrintWarning[]): {
    columns: number;
    layout: any;
};
/** Compact thermal receipt: builds PrintDocument and renders via document-compact pipeline. */
export declare function formatCompactReceipt(order: any, bill: any, biz: any, cols?: number, useUnicode?: boolean, isReprint?: boolean, cutMode?: PrinterCutMode, warnings?: PrintWarning[], arabicShaping?: boolean, lang?: string, additionalLanguage?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
/** Classic thermal receipt: builds PrintDocument and renders via document-classic pipeline. */
export declare function formatClassicReceipt(order: any, bill: any, biz: any, cols?: number, useUnicode?: boolean, isReprint?: boolean, cutMode?: PrinterCutMode, warnings?: PrintWarning[], arabicShaping?: boolean, lang?: string, additionalLanguage?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
/** Ported from web-print.ts (#440): known methods localize; unknown keep the capitalize fallback. */
export declare function resolvePaymentMethodLabel(method: string, lang: string): string;
/** pos.tableLabel carries an ICU {name} placeholder; backend rendering swaps it inline. */
export declare function formatTableLabel(tableName: string, lang: string): string;
/** Kitchen order ticket: builds KotDocument and renders via document-kot pipeline. */
export declare function formatKOT(order: any, items: any[], stationName: string, cols?: number, useUnicode?: boolean, cutMode?: PrinterCutMode, locale?: string, tzOptions?: any, warnings?: PrintWarning[], arabicShaping?: boolean, language?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
export declare function buildTestPage(paperWidth?: string, cutMode?: PrinterCutMode, language?: string, timezone?: string, capabilities?: ThermalPrinterCapabilities): Buffer;
/**
 * Build the ESC/POS bytes for a Z-report (cierre de caja) from a stored
 * `cash_closures` row. Day-close, no bill — sections in spec print order:
 * header → Z number + business date + period → opening float → cash
 * movements → sales by payment method → refunds → tax breakdown → staff
 * sales → expected / counted / variance (variance emphasized) → operator +
 * signature → footer.
 * The byte builder never touches the drawer pulse; that is appended by
 * `printZReport` (the route layer) so the byte form is reusable for the
 * WebUSB `bytes: number[]` branch where the renderer dispatches.
 */
export declare function buildZReportBody(z: any, language?: string, printer?: {
    columns?: number;
    capabilities?: ThermalPrinterCapabilities;
}, warnings?: PrintWarning[]): Buffer;
/**
 * Dispatch the Z report to the configured printer. The pulse is forced on Z
 * print (bypassing bill-bound `shouldPulseForPayment` and the
 * `cash_drawer_pulse_methods` filter): the Z is the document the merchant
 * prints while counting the drawer.
 */
export declare function printZReport(z: any, signal?: AbortSignal, targetPrinter?: any): Promise<DispatchResult & {
    bytes?: Buffer;
    connection_type?: string;
}>;
/** Convert the command subset emitted by buildEscPos() into a paperless text preview. */
export declare function escPosToText(data: Buffer | Uint8Array): string;
export declare const NETWORK_PRINT_CHUNK_SIZE = 4096;
export declare const NETWORK_PRINT_CHUNK_DELAY_MS = 10;
export declare function printViaNetwork(ip: string, port: number, data: Buffer, signal?: AbortSignal): Promise<DispatchResult>;
export declare function printViaUSB(data: Buffer, printerName?: string, signal?: AbortSignal): Promise<DispatchResult>;
/** Stable classification of a failed Windows PowerShell subprocess. */
export declare function describeWindowsPrintProcessFailure(error: unknown): string;
export declare function getPrinterStatus(): {
    connected: boolean;
    printer: any;
};
//# sourceMappingURL=thermal.d.ts.map