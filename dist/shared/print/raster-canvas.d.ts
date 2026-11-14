/**
 * Canvas painter for raster render requests, shared by the Electron raster surface
 * and the browser WebUSB path so both produce the same bands.
 *
 * The function is serialized into the Electron surface page, so it must stay
 * self-contained: no references to imports or module-level values.
 */
import type { RasterRenderRequest, RasterRenderResult } from './raster';
/** Structural 2D context so the kernel needs no DOM typings. */
export interface RasterCanvasContext {
    font: string;
    textBaseline: string;
    direction: string;
    textAlign: string;
    fillStyle: unknown;
    measureText(text: string): {
        width: number;
    };
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    fillRect(x: number, y: number, width: number, height: number): void;
    fillText(text: string, x: number, y: number): void;
    getImageData(x: number, y: number, width: number, height: number): {
        readonly data: ArrayLike<number>;
    };
}
export interface RasterCanvas {
    width: number;
    height: number;
    getContext(contextId: '2d', options?: {
        alpha?: boolean;
    }): RasterCanvasContext | null;
}
export declare function paintRasterRequest(request: RasterRenderRequest, createCanvas: () => RasterCanvas): RasterRenderResult;
//# sourceMappingURL=raster-canvas.d.ts.map