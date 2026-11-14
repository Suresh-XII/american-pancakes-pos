import { type CurrencyDisplay, type DigitMode } from '../countries';
import type { PrinterCutMode } from './profiles';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { RasterSemanticLineGroup } from '../../shared/print/raster';
import { type PrintWarning } from './formatting-helpers';
import { MAX_DELIVERY_SLIP_NOTE_CHARS, type DeliverySlipAddressSource, type DeliverySlipPaymentBill, type DeliverySlipDocument, type DeliverySlipPrintData, type PrintContext } from '../../shared/print';
export { MAX_DELIVERY_SLIP_NOTE_CHARS };
export declare const MAX_DELIVERY_SLIP_ADDRESS_CHARS = 300;
/** The order fields the slip reads. Rows arrive from SQLite, so all are optional. */
export interface DeliverySlipOrderRow {
    readonly order_number?: unknown;
    readonly created_at?: unknown;
    readonly type?: unknown;
    /** Address confirmed for this delivery; absent on every pre-column order. */
    readonly delivery_address?: unknown;
    /** Order-level note. Item-level instructions arrive on DeliverySlipItemRow. */
    readonly special_instructions?: unknown;
    /** Courier-only note; absent on every pre-column order. */
    readonly delivery_note?: unknown;
    /** Method expected at handover; NULL is unknown. Never a captured payment. */
    readonly expected_payment_method?: unknown;
    readonly expected_payment_method_id?: unknown;
    readonly total?: unknown;
    readonly bill?: {
        readonly payment_status?: unknown;
        readonly total?: unknown;
        readonly balance?: unknown;
        readonly payment_method?: unknown;
        readonly payment_details?: unknown;
    } | null;
    readonly bills?: readonly DeliverySlipPaymentBill[];
    readonly customer?: {
        readonly name?: unknown;
    } | null;
}
export interface DeliverySlipItemRow {
    readonly status?: unknown;
    readonly product_name?: unknown;
    readonly quantity?: unknown;
    readonly addons?: unknown;
    readonly special_instructions?: unknown;
}
export declare function buildDeliverySlipPrintData(order: DeliverySlipOrderRow, items: readonly DeliverySlipItemRow[], contact: {
    name?: string;
    phone?: string;
    address?: string;
    addressSource?: DeliverySlipAddressSource | null;
}, options?: {
    showCustomerPhone?: boolean;
    locale?: string;
    currency?: string;
    currencyDisplay?: CurrencyDisplay;
    digits?: DigitMode;
}): DeliverySlipPrintData;
export declare function buildDeliverySlipPrintContext(opts: {
    columns: number;
    language: string;
    locale?: string;
    currency?: string;
    currencySymbol?: string;
    timezone?: string;
}): PrintContext;
/** Renderer options: physical/locale presentation only, no business data. */
export interface DeliverySlipDocumentRenderOptions {
    readonly columns: number;
    readonly language: string;
    readonly locale?: string;
    readonly timezone?: string;
    readonly useUnicode: boolean;
    readonly arabicShaping: boolean;
    readonly cutMode: PrinterCutMode;
    readonly capabilities?: ThermalPrinterCapabilities;
    readonly rasterGroups?: RasterSemanticLineGroup[];
    readonly financialLineRanges?: Array<{
        lineIndex: number;
        lineCount: number;
    }>;
}
/** Map a DeliverySlipDocument onto the ESC/POS token-line layout. */
export declare function renderDeliverySlipDocumentToLines(document: DeliverySlipDocument, options: DeliverySlipDocumentRenderOptions): string[];
export interface DeliverySlipDocumentRenderResult {
    readonly document: DeliverySlipDocument;
    readonly lines: string[];
    readonly data: Buffer;
    readonly warnings: PrintWarning[];
    readonly rasterGroups: readonly RasterSemanticLineGroup[];
}
/** Full document-driven delivery slip pipeline: data -> document -> lines -> bytes. */
export declare function renderDeliverySlipViaDocument(order: DeliverySlipOrderRow, items: readonly DeliverySlipItemRow[], contact: {
    name?: string;
    phone?: string;
    address?: string;
    addressSource?: DeliverySlipAddressSource | null;
}, opts: {
    columns: number;
    language: string;
    locale?: string;
    currency?: string;
    currencySymbol?: string;
    currencyDisplay?: CurrencyDisplay;
    digits?: DigitMode;
    timezone?: string;
    useUnicode: boolean;
    arabicShaping: boolean;
    cutMode: PrinterCutMode;
    capabilities?: ThermalPrinterCapabilities;
    /** Merchant override for the delivery customer-number exception. Default on. */
    showCustomerPhone?: boolean;
}): DeliverySlipDocumentRenderResult;
//# sourceMappingURL=document-delivery-slip.d.ts.map