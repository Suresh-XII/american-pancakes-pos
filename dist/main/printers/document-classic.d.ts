/** PrintDocument v1 classic thermal receipt renderer; maps print blocks to ESC/POS token lines. */
import type { PrinterCutMode } from './profiles';
import { type ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import { type RasterSemanticLineGroup } from '../../shared/print/raster';
import { type PrintWarning } from './formatting-helpers';
import { type PrintContext, type PrintData, type PrintDocument, type TextDirection } from '../../shared/print';
/** Derive a language's base direction from its generated label strings. */
export declare function detectPrintLanguageDirection(lang: string): TextDirection;
/** Normalize raw bill/order/business rows into authoritative PrintData. */
export declare function buildBillPrintData(order: any, bill: any, business: any, isReprint: boolean): PrintData;
/** Build PrintContext for classic receipt: paper columns, languages, locale prefs. */
export declare function buildBillPrintContext(opts: {
    columns: number;
    /** Receipt language (already resolved from settings/policy by the caller). */
    language: string;
    /** Optional second receipt language from the resolved policy (max 2, v1). */
    additionalLanguage?: string;
    business: any;
}): PrintContext;
/** Renderer options: physical/locale presentation only, no business data. */
export interface ClassicDocumentRenderOptions {
    readonly columns: number;
    /** Primary receipt language for labels (resolved by the caller). */
    readonly language: string;
    readonly locale: string;
    readonly timezone?: string;
    /** Currency prefix preference (symbol + unicode mode). */
    readonly currency: string;
    readonly currencySymbol: string;
    readonly trimDecimals: boolean;
    readonly useUnicode: boolean;
    readonly arabicShaping: boolean;
    readonly preserveCurrencySymbol?: boolean;
    readonly cutMode: PrinterCutMode;
    readonly capabilities?: ThermalPrinterCapabilities;
    readonly maskCustomerPhone?: boolean;
    readonly rasterGroups?: RasterSemanticLineGroup[];
    readonly financialLineRanges?: Array<{
        lineIndex: number;
        lineCount: number;
    }>;
}
/** Map a PrintDocument onto classic token-line layout. */
export declare function renderBillDocumentToClassicLines(document: PrintDocument, options: ClassicDocumentRenderOptions): string[];
export interface ClassicDocumentPreviewResult {
    readonly document: PrintDocument;
    readonly lines: string[];
    readonly data: Buffer;
    readonly warnings: PrintWarning[];
    readonly rasterGroups: readonly RasterSemanticLineGroup[];
}
/** Full document-driven classic preview pipeline: data -> document -> lines -> bytes. */
export declare function renderClassicReceiptViaDocument(order: any, bill: any, business: any, opts: {
    columns: number;
    language: string;
    additionalLanguage?: string;
    isReprint: boolean;
    useUnicode: boolean;
    arabicShaping: boolean;
    cutMode: PrinterCutMode;
    capabilities?: import('../../shared/print/thermal-capabilities').ThermalPrinterCapabilities;
    maskCustomerPhone?: boolean;
    preserveCurrencySymbol?: boolean;
}): ClassicDocumentPreviewResult;
//# sourceMappingURL=document-classic.d.ts.map