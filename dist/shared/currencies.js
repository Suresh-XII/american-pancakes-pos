"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POPULAR_CURRENCY_CODES = void 0;
exports.listSupportedCurrencyCodes = listSupportedCurrencyCodes;
exports.normalizeSupportedCurrencyCode = normalizeSupportedCurrencyCode;
exports.isSupportedCurrencyCode = isSupportedCurrencyCode;
exports.getCurrencyDisplayName = getCurrencyDisplayName;
exports.POPULAR_CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY'];
const RESERVED_CURRENCY_CODES = new Set(['XXX', 'XTS']);
function listSupportedCurrencyCodes() {
    try {
        return Intl.supportedValuesOf('currency')
            .map((code) => code.toUpperCase())
            .filter((code) => /^[A-Z]{3}$/.test(code) && !RESERVED_CURRENCY_CODES.has(code));
    }
    catch {
        return [...exports.POPULAR_CURRENCY_CODES];
    }
}
function normalizeSupportedCurrencyCode(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim().toUpperCase();
    return listSupportedCurrencyCodes().includes(normalized) ? normalized : null;
}
function isSupportedCurrencyCode(value) {
    return normalizeSupportedCurrencyCode(value) !== null;
}
function getCurrencyDisplayName(code, locale) {
    try {
        return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) || code;
    }
    catch {
        return code;
    }
}
//# sourceMappingURL=currencies.js.map