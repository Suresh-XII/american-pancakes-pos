export declare const SUPPLY_UNITS: readonly ["each", "g", "kg", "ml", "l"];
export type SupplyUnit = (typeof SUPPLY_UNITS)[number];
export type UnitConversionDiagnosticCode = 'unit_invalid' | 'quantity_invalid';
export declare const QUANTITY_PRECISION = 8;
export declare class UnitConversionError extends Error {
    readonly statusCode: number;
    readonly diagnosticCode: UnitConversionDiagnosticCode;
    constructor(statusCode: number, message: string, diagnosticCode: UnitConversionDiagnosticCode);
}
export declare function isSupplyUnit(value: unknown): value is SupplyUnit;
export declare function assertSupplyUnit(value: unknown, field?: string): SupplyUnit;
/** Round a quantity to the shared inventory precision. */
export declare function roundQuantity(value: number): number;
/**
 * Convert a quantity between units. Throws 400 when units are unknown or
 * belong to different dimensions (e.g. g → ml).
 */
export declare function convertQuantity(quantity: number, fromUnit: string, toUnit: string): number;
//# sourceMappingURL=units.d.ts.map