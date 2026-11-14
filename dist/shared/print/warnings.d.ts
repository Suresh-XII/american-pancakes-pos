/** Common warning contract shared by native, WebUSB, and browser print adapters. */
export type PrintWarningKind = 'line' | 'financial' | 'configuration' | 'locale';
export interface PrintWarning {
    field: string;
    text: string;
    message: string;
    kind?: PrintWarningKind;
}
export declare function hasFinancialPrintWarning(warnings: readonly PrintWarning[]): boolean;
/** Fail-closed refusal: names the row, why neither text nor image output worked, and what to try. */
export declare function makeFinancialPrintRefusalMessage(warnings: readonly PrintWarning[]): string;
//# sourceMappingURL=warnings.d.ts.map