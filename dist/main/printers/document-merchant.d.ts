/** Merchant template to classic thermal receipt renderer; resolves active template through PrintDocument pipeline. */
import { type PrintWarning } from './formatting-helpers';
import type { PrinterCutMode } from './profiles';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { RasterSemanticLineGroup } from '../../shared/print/raster';
export interface MerchantDocumentRenderResult {
    readonly data: Buffer;
    readonly lines: string[];
    readonly warnings: PrintWarning[];
    /** True when the stored payload failed validation and classic was used. */
    readonly fellBackToClassic: boolean;
    readonly rasterGroups: readonly RasterSemanticLineGroup[];
}
type RawPrintRecord = Record<string, unknown>;
/** Render bill through merchant template; falls back to classic if invalid. */
export declare function renderMerchantReceiptViaDocument(order: RawPrintRecord, bill: RawPrintRecord, business: RawPrintRecord, templateId: string, opts: {
    columns: number;
    language: string;
    /** Optional second receipt language from the resolved policy (max 2, v1). */
    additionalLanguage?: string;
    isReprint: boolean;
    useUnicode: boolean;
    arabicShaping: boolean;
    cutMode: PrinterCutMode;
    capabilities?: ThermalPrinterCapabilities;
}): MerchantDocumentRenderResult;
export {};
//# sourceMappingURL=document-merchant.d.ts.map