/**
 * Pure image rasterization and dithering helpers for ESC/POS receipt logo printing.
 *
 * Adheres strictly to print kernel invariants: pure functions only, no DOM,
 * no Electron, no Node IO, no filesystem, no network.
 */
import { type RasterBand } from './raster';
export interface PackedLogoVariant {
    readonly width: number;
    readonly height: number;
    readonly dataBase64: string;
}
export interface ReceiptLogoData {
    readonly version: 1;
    readonly originalDataUrl: string;
    readonly variants: {
        readonly [widthDots: string]: PackedLogoVariant;
    };
}
export declare function parseReceiptLogoData(value: ReceiptLogoData | string): ReceiptLogoData | null;
/**
 * Pack a 1-bit row-major pixel array (1 = black, 0 = white) into MSB-first bytes
 * as required by ESC/POS GS v 0.
 */
export declare function pack1BitPixels(pixels: Uint8Array, width: number, height: number): Uint8Array;
/**
 * Unpack MSB-first bytes into a 1-byte-per-pixel array (1 = black, 0 = white).
 */
export declare function unpack1BitPixels(packed: Uint8Array, width: number, height: number): Uint8Array;
/**
 * Applies classic Floyd-Steinberg error-diffusion dithering to grayscale pixels.
 * Input: values 0..255 (0 = black, 255 = white).
 * Output: 1 for black (ink on thermal paper), 0 for white (no ink).
 */
export declare function ditherGrayscalePixels(grayscale: Float32Array, width: number, height: number): Uint8Array;
/**
 * Center a pixel bitmap horizontally within a target dot width by padding with 0s.
 */
export declare function centerPixels(sourcePixels: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidthDots: number): Uint8Array;
/**
 * Parse and resolve raster bands for the target printer width from stored logo data.
 */
export declare function getLogoRasterBands(storedLogoData: ReceiptLogoData | string | null | undefined, targetWidthDots: number, maxBandHeight?: number): RasterBand[];
//# sourceMappingURL=image-raster.d.ts.map