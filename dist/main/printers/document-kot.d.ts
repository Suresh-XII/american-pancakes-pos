/** PrintDocument v1 kitchen order ticket renderer; maps KotDocument onto ESC/POS token-line layout. */
import type { PrinterCutMode } from './profiles';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { RasterSemanticLineGroup } from '../../shared/print/raster';
import { type PrintWarning } from './formatting-helpers';
import { type KotDocument, type KotPrintData, type PrintContext } from '../../shared/print';
/** Normalize raw order/items/station rows into an authoritative KOT snapshot. */
export declare function buildKotPrintData(order: any, items: any[], stationName: string): KotPrintData;
/** Build PrintContext for a kitchen ticket using pre-resolved language policy. */
export declare function buildKotPrintContext(opts: {
    columns: number;
    /** KOT label language (already resolved from the kitchen policy). */
    language: string;
    /** Store timezone for business-local ticket time formatting. */
    timezone?: string;
}): PrintContext;
/** Renderer options: physical/locale presentation only, no business data. */
export interface KotDocumentRenderOptions {
    readonly columns: number;
    readonly language: string;
    readonly locale?: string;
    readonly timezone?: string;
    readonly useUnicode: boolean;
    readonly arabicShaping: boolean;
    readonly cutMode: PrinterCutMode;
    readonly capabilities?: ThermalPrinterCapabilities;
    readonly rasterGroups?: RasterSemanticLineGroup[];
}
/** Map a KotDocument onto the legacy KOT token-line layout. */
export declare function renderKotDocumentToLines(document: KotDocument, options: KotDocumentRenderOptions): string[];
export interface KotDocumentRenderResult {
    readonly document: KotDocument;
    readonly lines: string[];
    readonly data: Buffer;
    readonly warnings: PrintWarning[];
    readonly rasterGroups: readonly RasterSemanticLineGroup[];
}
/** Full document-driven KOT pipeline: data -> document -> lines -> bytes. */
export declare function renderKotViaDocument(order: any, items: any[], stationName: string, opts: {
    columns: number;
    /** KOT label language, resolved from `kot_language_policy` by the caller. */
    language: string;
    locale?: string;
    timezone?: string;
    useUnicode: boolean;
    arabicShaping: boolean;
    cutMode: PrinterCutMode;
    capabilities?: import('../../shared/print/thermal-capabilities').ThermalPrinterCapabilities;
}): KotDocumentRenderResult;
//# sourceMappingURL=document-kot.d.ts.map