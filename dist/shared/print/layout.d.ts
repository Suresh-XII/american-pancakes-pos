import { type BilingualLabel } from './bilingual';
import type { ThermalPrinterCapabilities } from './thermal-capabilities';
import type { TextDirection, ResolvedPrintLanguages } from './types';
import type { PrintWarning } from './warnings';
export interface ThermalLayoutContext {
    readonly logicalColumns: number;
    readonly rasterWidthDots?: number;
    readonly direction: TextDirection;
    readonly languages: ResolvedPrintLanguages;
    readonly capabilities?: ThermalPrinterCapabilities;
    readonly locale?: string;
    readonly currency?: string;
    readonly currencySymbol?: string;
}
export type ThermalLayoutAlignment = 'left' | 'center' | 'right';
export interface StyledLayoutUnit {
    readonly text?: string;
    readonly label?: BilingualLabel;
    readonly alignment?: ThermalLayoutAlignment;
    readonly widthMultiplier?: 1 | 2;
    readonly field: string;
    readonly financial?: boolean;
}
export interface ThermalLayoutResult {
    readonly lines: readonly string[];
    readonly widthMultiplier: 1 | 2;
    readonly warnings: readonly PrintWarning[];
}
/**
 * Lay out one complete semantic unit before ESC/POS encoding. A style is
 * downgraded before text is wrapped, and text is never sliced to make a style
 * fit. This is intentionally pure so every transport can use the same rule.
 */
export declare function layoutStyledUnit(unit: StyledLayoutUnit, context: ThermalLayoutContext): ThermalLayoutResult;
/** Width-only invariant used by the ESC/POS safety layer after semantic layout. */
export declare function thermalDisplayWidth(text: string): number;
//# sourceMappingURL=layout.d.ts.map