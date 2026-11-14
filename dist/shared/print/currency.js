"use strict";
/**
 * Shared ASCII currency fallback policy for thermal text paths.
 *
 * Financial values stay numeric and unchanged. This map only replaces a
 * display token when a native ESC/POS path cannot represent it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENCY_CODE_PATTERN = exports.CURRENCY_TOKEN_PATTERN = exports.CURRENCY_ASCII_MAP = void 0;
exports.normalizeCurrencyToAscii = normalizeCurrencyToAscii;
exports.isSyntacticallyValidCurrencyCode = isSyntacticallyValidCurrencyCode;
/** Currency display tokens that have stable, bounded ASCII fallbacks. */
exports.CURRENCY_ASCII_MAP = Object.freeze({
    '₹': 'Rs',
    '₨': 'Rs',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'Yen',
    '₩': 'KRW',
    '₺': 'TRY',
    '₫': 'VND',
    '₪': 'ILS',
    '₽': 'RUB',
    '฿': 'THB',
    '₱': 'PHP',
    '₴': 'UAH',
    '₦': 'NGN',
    '₵': 'GHS',
    '₡': 'CRC',
    '₲': 'PYG',
    'د.إ': 'AED',
    '﷼': 'SAR',
    'ریال': 'IRR',
    '৳': 'BDT',
    'E£': 'EGP',
});
const CURRENCY_ASCII_ENTRIES = Object.entries(exports.CURRENCY_ASCII_MAP)
    .sort(([left], [right]) => right.length - left.length);
/** Replace known non-ASCII currency tokens without changing numeric values. */
function normalizeCurrencyToAscii(text) {
    return CURRENCY_ASCII_ENTRIES.reduce((value, [symbol, fallback]) => value.split(symbol).join(fallback), text);
}
/** Regex source for matching known currency tokens in thermal safety checks. */
exports.CURRENCY_TOKEN_PATTERN = CURRENCY_ASCII_ENTRIES
    .map(([symbol]) => symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
/** Canonical tenant currency storage contract. */
exports.CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
function isSyntacticallyValidCurrencyCode(value) {
    return typeof value === 'string' && exports.CURRENCY_CODE_PATTERN.test(value);
}
//# sourceMappingURL=currency.js.map