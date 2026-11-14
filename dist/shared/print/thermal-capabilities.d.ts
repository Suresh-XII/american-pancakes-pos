import type { PrinterTextSize } from './text-size';
/**
 * Capability policy shared by the backend ESC/POS and WebUSB encoders.
 * Raster support is additive and remains profile-owned; locale never enables it.
 */
export type ThermalCodePage = 'ascii' | 'cp437' | 'cp850' | 'cp858' | 'windows1252';
export type ThermalScript = 'ascii' | 'latin' | 'arabic';
export type UnsupportedTextPolicy = 'skip';
export type FinancialTextPolicy = 'refuse';
export type OrderTypeFallbackPolicy = 'ascii';
export type ThermalRasterMode = 'mixed' | 'whole-receipt';
export interface ThermalRasterCapabilities {
    /** False unless this exact profile has been validated on real hardware. */
    readonly enabled: boolean;
    /** Printable head width in dots, supplied by the profile, not locale. */
    readonly widthDots: number;
    /** Maximum rows in one GS v 0 command. */
    readonly maxBandHeight: number;
    readonly modes: readonly ThermalRasterMode[];
    readonly font?: {
        readonly family: string;
        readonly dataUrl: string;
    };
}
export interface ThermalPrinterCapabilities {
    encoding: {
        codePages: readonly ThermalCodePage[];
        preferredCodePage: ThermalCodePage;
    };
    shaping: {
        arabic: boolean;
    };
    representability: {
        scripts: readonly ThermalScript[];
    };
    transliteration: {
        enabled: boolean;
    };
    warnings: {
        unsupportedText: UnsupportedTextPolicy;
        financialText: FinancialTextPolicy;
        orderTypeFallback: OrderTypeFallbackPolicy;
    };
    /** Additive raster contract; disabled for all unverified shipped profiles. */
    readonly raster: ThermalRasterCapabilities;
    /** Per-printer text enlargement; absent means normal. */
    readonly textSize?: PrinterTextSize;
}
export declare const GENERIC_THERMAL_CAPABILITIES: ThermalPrinterCapabilities;
export declare const LATIN_THERMAL_CAPABILITIES: ThermalPrinterCapabilities;
export declare function normalizeThermalText(text: string, capabilities: ThermalPrinterCapabilities): string;
export declare function hasArabicScript(text: string): boolean;
export declare function isArabicShapingSafeLine(text: string): boolean;
export declare function selectThermalCodePage(text: string, capabilities: ThermalPrinterCapabilities): ThermalCodePage | null;
export declare function isThermalTextRepresentable(text: string, capabilities: ThermalPrinterCapabilities): boolean;
export declare function thermalTextFallback(value: string, fallback: string, capabilities: ThermalPrinterCapabilities): string;
export declare function shouldUseOrderTypeFallback(localizedText: string, capabilities: ThermalPrinterCapabilities): boolean;
export declare function escPosCodePageId(codePage: ThermalCodePage): number;
export declare function mergeThermalCapabilities(capabilities: ThermalPrinterCapabilities | undefined, arabicShapingOverride?: boolean): ThermalPrinterCapabilities;
//# sourceMappingURL=thermal-capabilities.d.ts.map