import { BrowserWindow } from 'electron';
import { type RasterRenderRequest, type RasterRenderResult, type RasterSemanticUnit, type RasterSemanticLineGroup } from '../../shared/print/raster';
import { type PrinterTextSize } from '../../shared/print/text-size';
import { type ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
/** Self-contained page with no navigation, network access, or Node integration. */
export declare function rasterRendererHtml(): string;
type RasterSurface = Pick<BrowserWindow, 'isDestroyed' | 'close' | 'on' | 'removeListener' | 'webContents'>;
export interface RasterRendererOptions {
    readonly preloadPath?: string;
    readonly windowFactory?: (options: Electron.BrowserWindowConstructorOptions) => RasterSurface;
    readonly ipc?: Pick<Electron.IpcMain, 'on' | 'removeListener'>;
    readonly timeoutMs?: number;
    readonly onActivity?: () => void;
}
/** Main-process owner for the dedicated, hidden Chromium raster surface. */
export declare class ChromiumRasterRenderer {
    private readonly surface;
    private readonly timeoutMs;
    private readonly ipc;
    private readonly onActivity?;
    private readonly pending;
    private ready;
    private readyResolve;
    private readyTimer;
    private readySettled;
    private readyError;
    private destroyed;
    private readonly onResult;
    private readonly onReady;
    private readonly onLoadFailure;
    private readonly onSurfaceClosed;
    private readonly onRenderProcessGone;
    constructor(options?: RasterRendererOptions);
    private isSurfaceSender;
    private settleReady;
    private failSurface;
    render(request: unknown): Promise<RasterRenderResult>;
    isDestroyed(): boolean;
    destroy(): void;
}
export declare const DEFAULT_RASTER_IDLE_TIMEOUT_MS = 300000;
/** Wait for Electron readiness, since a BrowserWindow cannot exist before it. */
export declare function whenRasterRendererReady(targetApp?: Partial<Pick<Electron.App, 'isReady' | 'whenReady'>> | undefined): Promise<void>;
/** Obtain the warm shared Chromium raster singleton, recreating if needed. */
export declare function getSharedRasterRenderer(options?: RasterRendererOptions & {
    idleTimeoutMs?: number;
}): ChromiumRasterRenderer;
/** Teardown the shared raster singleton if active. */
export declare function destroySharedRasterRenderer(): void;
/** Attach the semantic financial boundary only after a successful full render. */
export declare function renderRasterSemanticUnit(renderer: Pick<ChromiumRasterRenderer, 'render'>, request: RasterRenderRequest, financial: boolean): Promise<{
    ok: true;
    unit: RasterSemanticUnit;
} | {
    ok: false;
    code: string;
    detail: string;
    financial: boolean;
}>;
export interface RasterLineRenderFailure {
    readonly lineIndex: number;
    readonly lineCount: number;
    readonly text: string;
    readonly financial: boolean;
    readonly code: string;
    readonly detail: string;
}
/** Enlarges raster input lines and the control lines that group metadata matches against. */
export declare function applyTextSizeToRasterInput(lines: readonly string[], groups: readonly RasterSemanticLineGroup[] | undefined, textSize: PrinterTextSize): {
    lines: readonly string[];
    groups: readonly RasterSemanticLineGroup[] | undefined;
};
export declare function renderUnsupportedRasterLines(renderer: Pick<ChromiumRasterRenderer, 'render'>, lines: readonly string[], capabilities: ThermalPrinterCapabilities, requestPrefix: string, rasterGroups?: readonly RasterSemanticLineGroup[]): Promise<{
    units: Array<{
        lineIndex: number;
        lineCount: number;
        unit: RasterSemanticUnit;
    }>;
    failures: RasterLineRenderFailure[];
}>;
export {};
//# sourceMappingURL=raster-renderer.d.ts.map