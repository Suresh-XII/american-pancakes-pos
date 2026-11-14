import { type MixedPrintPart } from '../../shared/print/raster';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { PrinterCutMode } from './profiles';
/** Backend adapter kept transport-neutral for TCP, OS RAW, and WebUSB parity. */
export declare function buildBackendMixedRasterBytes(parts: readonly MixedPrintPart[], capabilities: ThermalPrinterCapabilities, cutMode: PrinterCutMode): Buffer;
//# sourceMappingURL=raster-output.d.ts.map