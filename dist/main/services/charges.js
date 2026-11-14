"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOM_CHARGES_SETTING_KEY = exports.totalAppliedCharges = exports.toStandardChargeColumns = exports.serializeAppliedCharges = exports.parseStoredChargeDefinitions = exports.parseAppliedCharges = exports.normalizeChargeDefinitions = exports.calculateAppliedCharges = exports.VALID_CHARGE_ORDER_TYPES = exports.STANDARD_CHARGE_COLUMN_IDS = exports.MAX_PERCENTAGE = exports.MAX_CHARGE_ORDER_TYPES = exports.MAX_CHARGE_NAME_LENGTH = exports.MAX_CHARGE_ID_LENGTH = exports.MAX_CHARGE_DEFINITIONS = exports.ChargeValidationError = exports.CHARGE_ID_PATTERN = void 0;
exports.getChargeDefinitions = getChargeDefinitions;
exports.resolveOrderCharges = resolveOrderCharges;
exports.buildAppliedCharges = buildAppliedCharges;
exports.chargeIdsAfterToggle = chargeIdsAfterToggle;
/**
 * Backend entry point for the unified charges & fees engine.
 *
 * The contracts and pure calculation live in `shared/charges.ts` so the
 * POS cart preview and the authoritative backend totals cannot drift apart.
 */
const charges_1 = require("../../shared/charges");
const countries_1 = require("../countries");
const db_1 = require("../db");
var charges_2 = require("../../shared/charges");
Object.defineProperty(exports, "CHARGE_ID_PATTERN", { enumerable: true, get: function () { return charges_2.CHARGE_ID_PATTERN; } });
Object.defineProperty(exports, "ChargeValidationError", { enumerable: true, get: function () { return charges_2.ChargeValidationError; } });
Object.defineProperty(exports, "MAX_CHARGE_DEFINITIONS", { enumerable: true, get: function () { return charges_2.MAX_CHARGE_DEFINITIONS; } });
Object.defineProperty(exports, "MAX_CHARGE_ID_LENGTH", { enumerable: true, get: function () { return charges_2.MAX_CHARGE_ID_LENGTH; } });
Object.defineProperty(exports, "MAX_CHARGE_NAME_LENGTH", { enumerable: true, get: function () { return charges_2.MAX_CHARGE_NAME_LENGTH; } });
Object.defineProperty(exports, "MAX_CHARGE_ORDER_TYPES", { enumerable: true, get: function () { return charges_2.MAX_CHARGE_ORDER_TYPES; } });
Object.defineProperty(exports, "MAX_PERCENTAGE", { enumerable: true, get: function () { return charges_2.MAX_PERCENTAGE; } });
Object.defineProperty(exports, "STANDARD_CHARGE_COLUMN_IDS", { enumerable: true, get: function () { return charges_2.STANDARD_CHARGE_COLUMN_IDS; } });
Object.defineProperty(exports, "VALID_CHARGE_ORDER_TYPES", { enumerable: true, get: function () { return charges_2.VALID_CHARGE_ORDER_TYPES; } });
Object.defineProperty(exports, "calculateAppliedCharges", { enumerable: true, get: function () { return charges_2.calculateAppliedCharges; } });
Object.defineProperty(exports, "normalizeChargeDefinitions", { enumerable: true, get: function () { return charges_2.normalizeChargeDefinitions; } });
Object.defineProperty(exports, "parseAppliedCharges", { enumerable: true, get: function () { return charges_2.parseAppliedCharges; } });
Object.defineProperty(exports, "parseStoredChargeDefinitions", { enumerable: true, get: function () { return charges_2.parseStoredChargeDefinitions; } });
Object.defineProperty(exports, "serializeAppliedCharges", { enumerable: true, get: function () { return charges_2.serializeAppliedCharges; } });
Object.defineProperty(exports, "toStandardChargeColumns", { enumerable: true, get: function () { return charges_2.toStandardChargeColumns; } });
Object.defineProperty(exports, "totalAppliedCharges", { enumerable: true, get: function () { return charges_2.totalAppliedCharges; } });
exports.CUSTOM_CHARGES_SETTING_KEY = 'custom_charges';
/** Configured charges for the tenant; unreadable or malformed storage reads as none. */
function getChargeDefinitions() {
    const currencyDecimals = (0, countries_1.getCurrencyFractionDigits)((0, db_1.getSettingValue)('currency') || 'USD');
    return (0, charges_1.parseStoredChargeDefinitions)((0, db_1.getSettingValue)(exports.CUSTOM_CHARGES_SETTING_KEY), currencyDecimals);
}
/**
 * Resolves the charges to apply to an order at the tenant's own precision.
 *
 * Waivers recorded on the row are re-applied rather than reset, so a recompute
 * triggered by adding an item or changing a discount does not silently un-waive
 * a fee the cashier already removed. Optional charges the cashier opted into
 * stay applied for the same reason.
 */
function resolveOrderCharges(input) {
    const { definitions, orderType, subtotal, discountAmount, currency, existingBreakdown } = input;
    const existing = (0, charges_1.parseAppliedCharges)(existingBreakdown);
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const derivedWaivedIds = existing.filter((charge) => charge.waived).map((charge) => charge.id);
    const derivedOptedInIds = existing
        .filter((charge) => byId.get(charge.id)?.is_default_active === false)
        .map((charge) => charge.id);
    const waivedIds = input.waivedIds ?? derivedWaivedIds;
    const optedInIds = input.optedInIds ?? derivedOptedInIds;
    const activeCharges = (0, charges_1.calculateAppliedCharges)({
        definitions,
        orderType,
        subtotal,
        discountAmount,
        waivedIds,
        optedInIds,
        currencyDecimals: (0, countries_1.getCurrencyFractionDigits)(currency),
    });
    const retainedCharges = existing.filter((charge) => {
        const definition = byId.get(charge.id);
        return !definition?.is_active || !definition.order_types.includes(orderType);
    });
    const charges = [...activeCharges, ...retainedCharges];
    const columns = (0, charges_1.toStandardChargeColumns)(charges, (0, countries_1.getCurrencyFractionDigits)(currency));
    const ownsStandardColumn = (id) => charges.some((charge) => charge.id === id)
        || existing.some((charge) => charge.id === id)
        || definitions.some((definition) => definition.id === id
            && definition.is_active
            && definition.is_default_active
            && definition.order_types.includes(orderType));
    const configured = retainedCharges.length > 0 || definitions.some((definition) => definition.is_active
        && (definition.is_default_active || optedInIds.includes(definition.id))
        && definition.order_types.includes(orderType));
    return {
        charges,
        columns,
        configured,
        ownsServiceChargeColumn: ownsStandardColumn('service_charge'),
        ownsPackagingChargeColumn: ownsStandardColumn('packaging_charge'),
    };
}
/** Convenience wrapper that resolves charges from the tenant's stored definitions. */
function buildAppliedCharges(args) {
    return resolveOrderCharges({ definitions: getChargeDefinitions(), ...args });
}
/**
 * Waiver and opt-in id sets after a cashier toggle, starting from the state
 * already recorded on the row. Returned so the caller can re-run the
 * calculation rather than hand-editing an amount.
 */
function chargeIdsAfterToggle(args) {
    const existing = (0, charges_1.parseAppliedCharges)(args.existingBreakdown);
    const byId = new Map(args.definitions.map((definition) => [definition.id, definition]));
    let waivedIds = existing.filter((charge) => charge.waived).map((charge) => charge.id);
    let optedInIds = existing
        .filter((charge) => byId.get(charge.id)?.is_default_active === false)
        .map((charge) => charge.id);
    if (args.toggle.applied === false) {
        optedInIds = optedInIds.filter((id) => id !== args.toggle.chargeId);
        waivedIds = waivedIds.filter((id) => id !== args.toggle.chargeId);
    }
    else if (args.toggle.applied === true && !optedInIds.includes(args.toggle.chargeId)) {
        optedInIds.push(args.toggle.chargeId);
    }
    if (args.toggle.waived === true) {
        if (!waivedIds.includes(args.toggle.chargeId))
            waivedIds.push(args.toggle.chargeId);
    }
    else if (args.toggle.waived === false) {
        waivedIds = waivedIds.filter((id) => id !== args.toggle.chargeId);
    }
    return { waivedIds, optedInIds };
}
//# sourceMappingURL=charges.js.map