/**
 * Renderer/transport-neutral raster contract for ESC/POS thermal printing.
 *
 * This module is deliberately pure: it knows nothing about Electron, fonts,
 * printers, or transports. A profile must opt into raster explicitly before
 * callers may encode a band. Pixels are packed MSB-first as required by
 * ESC/POS GS v 0 (m=0).
 */
import type { ThermalPrinterCapabilities } from './thermal-capabilities';
export declare const DEFAULT_RASTER_MAX_BAND_HEIGHT = 200;
export declare const GS_V_0_MODE = 0;
export type RasterTextDirection = 'ltr' | 'rtl';
export type RasterStyle = 'normal' | 'bold' | 'double-height' | 'double-width' | 'font-b';
export type RasterLayoutKind = 'financial-summary' | 'financial-item';
export interface RasterTextLayout {
    readonly kind: RasterLayoutKind;
    readonly columns: readonly {
        readonly text: string;
        readonly align: 'left' | 'right';
        readonly widthRatio?: number;
    }[];
}
export interface RasterBand {
    readonly widthDots: number;
    readonly heightDots: number;
    /** One byte per pixel, row-major. Non-zero pixels are printed black. */
    readonly pixels: Uint8Array;
}
/** A complete semantic unit rendered as one or more bounded raster bands. */
export interface RasterSemanticUnit {
    readonly unitId: string;
    readonly financial: boolean;
    readonly complete: boolean;
    readonly bands: readonly RasterBand[];
}
export interface RasterSemanticLineGroup {
    readonly groupId: string;
    readonly lineIndex: number;
    readonly lineCount: number;
    readonly sourceLines?: readonly string[];
    readonly sourceControlLines?: readonly string[];
    readonly sourceLayouts?: readonly (RasterTextLayout | undefined)[];
    readonly financialSourceLines?: readonly boolean[];
    readonly financial?: boolean;
}
export interface RasterRenderRequest {
    readonly version: 1;
    readonly requestId: string;
    readonly text: string;
    readonly widthDots: number;
    readonly maxBandHeight: number;
    readonly direction: RasterTextDirection;
    readonly align?: 'left' | 'center';
    readonly layout?: RasterTextLayout;
    readonly style: RasterStyle;
    readonly styles?: readonly RasterStyle[];
    readonly financial: boolean;
    readonly maxLines: number;
    /** An optional data: URL for a font bundled by the application, never a network URL. */
    readonly bundledFont?: {
        readonly family: string;
        readonly dataUrl: string;
    };
}
export type RasterRenderResult = {
    readonly version: 1;
    readonly requestId: string;
    readonly ok: true;
    readonly unit: RasterSemanticUnit;
} | {
    readonly version: 1;
    readonly requestId: string;
    readonly ok: false;
    readonly code: 'invalid-request' | 'font-unavailable' | 'render-failed';
    readonly detail: string;
};
export interface RasterIpcRequestMessage {
    readonly version: 1;
    readonly request: RasterRenderRequest;
}
export interface RasterIpcResultMessage {
    readonly version: 1;
    readonly result: RasterRenderResult;
}
export declare function rasterCapabilityEnabled(capabilities: ThermalPrinterCapabilities | undefined, mode?: 'mixed' | 'whole-receipt'): boolean;
export declare function rasterWebUsbPathEnabled(capabilities: ThermalPrinterCapabilities | undefined, rendererAvailable: boolean, profileId: unknown): boolean;
export declare function validateRasterBand(band: RasterBand, maxBandHeight?: number): void;
/** Encode exactly one validated band using GS v 0, m=0 (normal density). */
export declare function encodeGsV0Band(band: RasterBand, maxBandHeight?: number): Uint8Array;
export declare function concatBytes(parts: readonly Uint8Array[]): Uint8Array;
/**
 * Encode complete semantic units in order. No partial unit is ever emitted;
 * this is the shared pre-transport guard used by backend and WebUSB callers.
 */
export declare function encodeRasterUnits(units: readonly RasterSemanticUnit[], capabilities: ThermalPrinterCapabilities, mode?: 'mixed' | 'whole-receipt'): Uint8Array;
/** Diagnostic bands used by the capability-gated printer test page. */
export declare function buildRasterDiagnosticBands(widthDots: number, maxBandHeight?: number): RasterBand[];
/** Tested compatibility path; callers must opt into the profile's whole-receipt mode. */
export declare function encodeWholeReceiptRaster(unit: RasterSemanticUnit, capabilities: ThermalPrinterCapabilities, cutMode: 'full' | 'partial'): Uint8Array;
export type MixedPrintPart = {
    readonly kind: 'native';
    readonly bytes: Uint8Array;
} | {
    readonly kind: 'raster';
    readonly unit: RasterSemanticUnit;
};
/**
 * Assemble transport-neutral mixed output. Native bytes are copied verbatim;
 * raster parts are encoded in order, so backend and WebUSB share this boundary.
 */
export declare function encodeMixedPrintParts(parts: readonly MixedPrintPart[], capabilities: ThermalPrinterCapabilities, cutMode: 'full' | 'partial'): Uint8Array;
/** Standard trailing feed and profile-selected cut used by all raw paths. */
export declare function encodeRasterFeedAndCut(cutMode: 'full' | 'partial', feedLines?: number): Uint8Array;
export declare function isBundledFontDataUrl(dataUrl: unknown): boolean;
export declare function isRasterRenderRequest(value: unknown): value is RasterRenderRequest;
export declare function isRasterRenderResult(value: unknown): value is RasterRenderResult;
//# sourceMappingURL=raster.d.ts.map