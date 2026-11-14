"use strict";
/**
 * Unified charges & fees engine - shared contracts and pure calculation.
 *
 * One model covers service charges, packaging fees and arbitrary surcharges.
 * Definitions live in the `custom_charges` setting as JSON; the itemised result
 * is persisted per order/bill in `charges_breakdown`.
 *
 * All arithmetic happens in integer minor units derived from the tenant's own
 * fraction digits, so zero-decimal currencies (JPY/KRW/VND) and three-decimal
 * currencies (KWD/BHD) round and persist correctly. Nothing here assumes two
 * decimals.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChargeValidationError = exports.MAX_CHARGE_ORDER_TYPES = exports.MAX_PERCENTAGE = exports.MAX_CHARGE_NAME_LENGTH = exports.MAX_CHARGE_DEFINITIONS = exports.MAX_CHARGE_ID_LENGTH = exports.CHARGE_ID_PATTERN = exports.STANDARD_CHARGE_COLUMN_IDS = exports.VALID_CHARGE_ORDER_TYPES = void 0;
exports.normalizeChargeDefinitions = normalizeChargeDefinitions;
exports.parseStoredChargeDefinitions = parseStoredChargeDefinitions;
exports.normalizeCurrencyDecimals = normalizeCurrencyDecimals;
exports.calculateAppliedCharges = calculateAppliedCharges;
exports.toStandardChargeColumns = toStandardChargeColumns;
exports.parseAppliedCharges = parseAppliedCharges;
exports.serializeAppliedCharges = serializeAppliedCharges;
exports.receiptChargeLines = receiptChargeLines;
exports.totalAppliedCharges = totalAppliedCharges;
exports.VALID_CHARGE_ORDER_TYPES = ['dine_in', 'takeaway', 'delivery', 'online'];
/** Charge ids that mirror the dedicated orders/bills columns. */
exports.STANDARD_CHARGE_COLUMN_IDS = ['service_charge', 'packaging_charge'];
exports.CHARGE_ID_PATTERN = /^[a-z0-9_-]+$/;
exports.MAX_CHARGE_ID_LENGTH = 64;
exports.MAX_CHARGE_DEFINITIONS = 50;
exports.MAX_CHARGE_NAME_LENGTH = 80;
exports.MAX_PERCENTAGE = 100;
exports.MAX_CHARGE_ORDER_TYPES = exports.VALID_CHARGE_ORDER_TYPES.length;
class ChargeValidationError extends Error {
    statusCode = 400;
    constructor(message) {
        super(message);
        this.name = 'ChargeValidationError';
    }
}
exports.ChargeValidationError = ChargeValidationError;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function normalizeChargeId(raw) {
    if (typeof raw !== 'string')
        throw new ChargeValidationError('Charge id must be a string');
    const id = raw.trim().toLowerCase();
    if (!exports.CHARGE_ID_PATTERN.test(id)) {
        throw new ChargeValidationError(`Charge id must match ${exports.CHARGE_ID_PATTERN.source}`);
    }
    if (id.length > exports.MAX_CHARGE_ID_LENGTH) {
        throw new ChargeValidationError(`Charge id must be at most ${exports.MAX_CHARGE_ID_LENGTH} characters`);
    }
    return id;
}
function normalizeChargeName(raw) {
    if (typeof raw !== 'string')
        throw new ChargeValidationError('Charge name must be a string');
    const name = raw.trim();
    if (!name)
        throw new ChargeValidationError('Charge name is required');
    if (name.length > exports.MAX_CHARGE_NAME_LENGTH) {
        throw new ChargeValidationError(`Charge name must be at most ${exports.MAX_CHARGE_NAME_LENGTH} characters`);
    }
    return name;
}
function normalizeChargeValue(type, raw) {
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ChargeValidationError('Charge value must be a finite number');
    }
    if (value < 0)
        throw new ChargeValidationError('Charge value must be zero or greater');
    if (type === 'percentage' && value > exports.MAX_PERCENTAGE) {
        throw new ChargeValidationError(`Charge value must be between 0 and ${exports.MAX_PERCENTAGE}`);
    }
    return value;
}
function normalizeOrderTypes(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new ChargeValidationError('Charge must apply to at least one order type');
    }
    if (raw.length > exports.MAX_CHARGE_ORDER_TYPES) {
        throw new ChargeValidationError(`Charge cannot apply to more than ${exports.MAX_CHARGE_ORDER_TYPES} order types`);
    }
    const seen = new Set();
    for (const entry of raw) {
        if (typeof entry !== 'string' || !exports.VALID_CHARGE_ORDER_TYPES.includes(entry)) {
            throw new ChargeValidationError(`Charge order_types must be one of ${exports.VALID_CHARGE_ORDER_TYPES.join(', ')}`);
        }
        seen.add(entry);
    }
    return [...seen];
}
/**
 * Validates an untrusted payload into charge definitions. The first invalid
 * entry rejects the whole array, so a partial write never lands.
 */
function normalizeChargeDefinitions(raw, currencyDecimals = 2) {
    if (typeof raw === 'string') {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            throw new ChargeValidationError('Charges must be valid JSON');
        }
        return normalizeChargeDefinitions(parsed, currencyDecimals);
    }
    if (!Array.isArray(raw))
        throw new ChargeValidationError('Charges must be an array');
    if (raw.length > exports.MAX_CHARGE_DEFINITIONS) {
        throw new ChargeValidationError(`At most ${exports.MAX_CHARGE_DEFINITIONS} charges may be configured`);
    }
    const definitions = [];
    const seenIds = new Set();
    for (const entry of raw) {
        if (!isRecord(entry))
            throw new ChargeValidationError('Each charge must be an object');
        const id = normalizeChargeId(entry.id);
        if (seenIds.has(id))
            throw new ChargeValidationError(`Duplicate charge id: ${id}`);
        seenIds.add(id);
        const type = entry.type;
        if (type !== 'percentage' && type !== 'fixed') {
            throw new ChargeValidationError('Charge type must be percentage or fixed');
        }
        const basis = entry.calculation_basis;
        if (basis !== 'net' && basis !== 'gross') {
            throw new ChargeValidationError('Charge calculation_basis must be net or gross');
        }
        const value = normalizeChargeValue(type, entry.value);
        if (type === 'fixed')
            toMinorUnits(value, Math.pow(10, normalizeCurrencyDecimals(currencyDecimals)));
        definitions.push({
            id,
            name: normalizeChargeName(entry.name),
            type,
            value,
            calculation_basis: basis,
            order_types: normalizeOrderTypes(entry.order_types),
            is_optional: entry.is_optional === true,
            is_default_active: entry.is_default_active !== false,
            tax_category_id: typeof entry.tax_category_id === 'string' && entry.tax_category_id.trim()
                ? entry.tax_category_id.trim()
                : null,
            is_active: entry.is_active !== false,
        });
    }
    return definitions;
}
/** Reads a stored definitions list for calculation, discarding anything invalid. */
function parseStoredChargeDefinitions(raw, currencyDecimals = 2) {
    try {
        return normalizeChargeDefinitions(raw, currencyDecimals);
    }
    catch {
        return [];
    }
}
/** Clamps untrusted fraction digits to the range ISO 4217 can express. */
function normalizeCurrencyDecimals(currencyDecimals) {
    return Number.isInteger(currencyDecimals) && currencyDecimals >= 0 && currencyDecimals <= 4
        ? currencyDecimals
        : 2;
}
function toMinorUnits(amount, factor) {
    if (!Number.isFinite(amount)) {
        throw new ChargeValidationError('Charge amount must be a finite number');
    }
    const minorUnits = Math.round(amount * factor);
    if (!Number.isSafeInteger(minorUnits)) {
        throw new ChargeValidationError('Charge amount exceeds the supported currency precision');
    }
    return minorUnits;
}
function addMinorUnits(total, amount) {
    const sum = total + amount;
    if (!Number.isSafeInteger(sum)) {
        throw new ChargeValidationError('Combined charge amounts exceed the supported currency precision');
    }
    return sum;
}
function percentageMinorUnits(basisMinor, percentage) {
    const [coefficient, exponentText] = percentage.toString().toLowerCase().split('e');
    const exponent = exponentText ? Number(exponentText) : 0;
    const [whole, fraction = ''] = coefficient.split('.');
    let numerator = BigInt(`${whole}${fraction}`);
    const decimalPlaces = fraction.length - exponent;
    const ten = BigInt(10);
    const denominator = decimalPlaces > 0 ? ten ** BigInt(decimalPlaces) : BigInt(1);
    if (decimalPlaces < 0)
        numerator *= ten ** BigInt(-decimalPlaces);
    const divisor = denominator * BigInt(100);
    const rounded = (BigInt(basisMinor) * numerator + divisor / BigInt(2)) / divisor;
    if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ChargeValidationError('Charge amount exceeds the supported currency precision');
    }
    return Number(rounded);
}
/**
 * Applies the matching active charges to an order.
 *
 * `net` basis applies to the discounted subtotal, `gross` to the raw subtotal.
 * A waived charge records `amount: 0` with `waived: true`, so an audit can tell
 * a waived fee apart from a fee configured at zero.
 */
function calculateAppliedCharges(input) {
    const { definitions, orderType, subtotal, discountAmount, waivedIds, optedInIds } = input;
    const decimals = normalizeCurrencyDecimals(input.currencyDecimals);
    const factor = Math.pow(10, decimals);
    const waived = new Set(waivedIds ?? []);
    const optedIn = new Set(optedInIds ?? []);
    const grossMinor = Math.max(0, toMinorUnits(subtotal, factor));
    const discountMinor = Math.max(0, toMinorUnits(discountAmount, factor));
    const netMinor = Math.max(0, grossMinor - discountMinor);
    const applied = [];
    for (const definition of definitions) {
        if (!definition.is_active)
            continue;
        if (!definition.is_default_active && !optedIn.has(definition.id))
            continue;
        if (!definition.order_types.includes(orderType))
            continue;
        // Only optional charges are waivable, so a stray waiver id for a mandatory
        // charge cannot zero it out.
        const isWaived = definition.is_optional && waived.has(definition.id);
        const basisMinor = definition.calculation_basis === 'net' ? netMinor : grossMinor;
        const amountMinor = isWaived
            ? 0
            : definition.type === 'percentage'
                ? // Integer minor units keep the percentage exact at the tenant's precision.
                    percentageMinorUnits(basisMinor, definition.value)
                : Math.max(0, toMinorUnits(definition.value, factor));
        const charge = {
            id: definition.id,
            name: definition.name,
            type: definition.type,
            amount: amountMinor / factor,
            calculation_basis: definition.calculation_basis,
            waived: isWaived,
            tax_category_id: definition.tax_category_id ?? null,
        };
        if (definition.type === 'percentage')
            charge.rate = definition.value;
        applied.push(charge);
    }
    return applied;
}
/**
 * Projects applied charges onto the legacy dedicated columns that daily
 * exports, the tax service and Z-reports already aggregate. Non-standard
 * charges are summed rather than dropped, so nothing is lost.
 */
function toStandardChargeColumns(charges, currencyDecimals) {
    const factor = Math.pow(10, normalizeCurrencyDecimals(currencyDecimals));
    let serviceMinor = 0;
    let packagingMinor = 0;
    let otherMinor = 0;
    for (const charge of charges) {
        const amountMinor = Math.max(0, toMinorUnits(charge.amount, factor));
        if (charge.id === 'service_charge')
            serviceMinor = addMinorUnits(serviceMinor, amountMinor);
        else if (charge.id === 'packaging_charge')
            packagingMinor = addMinorUnits(packagingMinor, amountMinor);
        else
            otherMinor = addMinorUnits(otherMinor, amountMinor);
    }
    return {
        service_charge: serviceMinor / factor,
        packaging_charge: packagingMinor / factor,
        other_charges: otherMinor / factor,
    };
}
/** Persisted `charges_breakdown` payload; null or unparseable reads as empty. */
function parseAppliedCharges(raw) {
    if (!raw)
        return [];
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(parsed))
        return [];
    return parsed.filter((entry) => isRecord(entry) &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string' &&
        (entry.type === 'percentage' || entry.type === 'fixed') &&
        typeof entry.amount === 'number' &&
        Number.isFinite(entry.amount) &&
        (entry.calculation_basis === 'net' || entry.calculation_basis === 'gross'));
}
function serializeAppliedCharges(charges) {
    return JSON.stringify(charges);
}
/**
 * Itemised charges to print on a receipt, from the engine's breakdown.
 *
 * Empty when the bill predates the engine, so the caller keeps rendering the
 * dedicated service_charge/packaging_charge columns. Only non-zero charges are
 * returned: a waived fee records amount 0 and must not be billed on the receipt.
 */
function receiptChargeLines(raw) {
    return parseAppliedCharges(raw)
        .filter((charge) => charge.amount !== 0)
        .map((charge) => ({
        id: charge.id,
        name: charge.name,
        amount: charge.amount,
        waived: charge.waived,
    }));
}
/** Total of every non-waived applied charge. */
function totalAppliedCharges(charges, currencyDecimals = 2) {
    const factor = Math.pow(10, normalizeCurrencyDecimals(currencyDecimals));
    let totalMinor = 0;
    for (const charge of charges) {
        if (charge.waived)
            continue;
        totalMinor = addMinorUnits(totalMinor, toMinorUnits(charge.amount, factor));
    }
    return totalMinor / factor;
}
//# sourceMappingURL=charges.js.map