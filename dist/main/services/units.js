"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnitConversionError = exports.QUANTITY_PRECISION = exports.SUPPLY_UNITS = void 0;
exports.isSupplyUnit = isSupplyUnit;
exports.assertSupplyUnit = assertSupplyUnit;
exports.roundQuantity = roundQuantity;
exports.convertQuantity = convertQuantity;
exports.SUPPLY_UNITS = ['each', 'g', 'kg', 'ml', 'l'];
exports.QUANTITY_PRECISION = 8;
const QUANTITY_TOLERANCE = 1e-8;
class UnitConversionError extends Error {
    statusCode;
    diagnosticCode;
    constructor(statusCode, message, diagnosticCode) {
        super(message);
        this.name = 'UnitConversionError';
        this.statusCode = statusCode;
        this.diagnosticCode = diagnosticCode;
    }
}
exports.UnitConversionError = UnitConversionError;
const UNIT_DIMENSIONS = {
    each: 'count',
    g: 'mass',
    kg: 'mass',
    ml: 'volume',
    l: 'volume',
};
// Multiplier to convert 1 of the unit into the dimension's base unit.
const TO_BASE = {
    each: 1,
    g: 1,
    kg: 1000,
    ml: 1,
    l: 1000,
};
function isSupplyUnit(value) {
    return typeof value === 'string' && exports.SUPPLY_UNITS.includes(value);
}
function assertSupplyUnit(value, field = 'unit') {
    if (!isSupplyUnit(value)) {
        throw new UnitConversionError(400, `${field} must be one of: ${exports.SUPPLY_UNITS.join(', ')}`, 'unit_invalid');
    }
    return value;
}
/** Round a quantity to the shared inventory precision. */
function roundQuantity(value) {
    if (!Number.isFinite(value)) {
        throw new UnitConversionError(400, 'quantity must be a finite number', 'quantity_invalid');
    }
    const rounded = Number(value.toFixed(exports.QUANTITY_PRECISION));
    return Math.abs(rounded) < QUANTITY_TOLERANCE ? 0 : rounded;
}
/**
 * Convert a quantity between units. Throws 400 when units are unknown or
 * belong to different dimensions (e.g. g → ml).
 */
function convertQuantity(quantity, fromUnit, toUnit) {
    const from = assertSupplyUnit(fromUnit, 'from_unit');
    const to = assertSupplyUnit(toUnit, 'to_unit');
    if (!Number.isFinite(quantity)) {
        throw new UnitConversionError(400, 'quantity must be a finite number', 'quantity_invalid');
    }
    if (UNIT_DIMENSIONS[from] !== UNIT_DIMENSIONS[to]) {
        throw new UnitConversionError(400, `Cannot convert between units of different dimensions (${from} → ${to})`, 'unit_invalid');
    }
    if (from === to)
        return roundQuantity(quantity);
    const inBase = quantity * TO_BASE[from];
    return roundQuantity(inBase / TO_BASE[to]);
}
//# sourceMappingURL=units.js.map