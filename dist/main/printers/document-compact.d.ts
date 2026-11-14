/** PrintDocument v1 compact thermal receipt renderer; maps print blocks to ESC/POS token lines. */
import type { PrinterCutMode } from './profiles';
import { type ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { RasterSemanticLineGroup } from '../../shared/print/raster';
import { type PrintWarning } from './formatting-helpers';
import { type PrintDocument } from '../../shared/print';
/** Renderer options: physical/locale presentation only, no business data. */
export interface CompactDocumentRenderOptions {
    readonly columns: number;
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
/** Map a PrintDocument onto compact token-line layout. */
export declare function renderBillDocumentToCompactLines(document: PrintDocument, options: CompactDocumentRenderOptions): string[];
export interface CompactDocumentRenderResult {
    readonly document: PrintDocument;
    readonly lines: string[];
    readonly data: Buffer;
    readonly warnings: PrintWarning[];
    readonly rasterGroups: readonly RasterSemanticLineGroup[];
}
/** Full document-driven compact pipeline: data -> document -> lines -> bytes. */
export declare function renderCompactReceiptViaDocument(order: any, bill: any, business: any, opts: {
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
}): CompactDocumentRenderResult;
//# sourceMappingURL=document-compact.d.ts.map