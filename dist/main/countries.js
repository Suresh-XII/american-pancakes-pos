"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegionalNotConfiguredError = exports.DEFAULT_COUNTRY_PROFILE = exports.isValidTimeZone = exports.listTimeZones = exports.countryName = exports.formatDateForTenant = exports.formatNumberForTenant = exports.formatNumber = exports.formatCurrencyForTenant = exports.getCurrencyUnitAdapter = exports.formatMoney = exports.formatCurrency = exports.getCurrencySymbol = exports.getCountryByCode = exports.COUNTRIES = void 0;
exports.resolveTenantCurrency = resolveTenantCurrency;
exports.isLocalePreferenceKey = isLocalePreferenceKey;
exports.isLocalePreferenceSupported = isLocalePreferenceSupported;
exports.resolveStoredLocalePreference = resolveStoredLocalePreference;
exports.getCurrencyFractionDigits = getCurrencyFractionDigits;
exports.getCurrencyMinorUnitFactor = getCurrencyMinorUnitFactor;
exports.resolveRegionalSnapshot = resolveRegionalSnapshot;
exports.canonicalizeLocalizedAmount = canonicalizeLocalizedAmount;
exports.formatAmountForCsv = formatAmountForCsv;
const libphonenumber_js_1 = require("libphonenumber-js");
const currency_1 = require("../shared/print/currency");
const dn = new Intl.DisplayNames(['en'], { type: 'region' });
const SUPPORTED = {
    IN: { locale: 'en-IN', currency: 'INR', tz: 'Asia/Kolkata', taxIdLabel: 'GSTIN', taxName: 'GST',
        taxIdFormat: {
            pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$',
            description: '15 characters: 2-digit state code + 10-character PAN + entity code + "Z" + checksum (e.g. 29ABCDE1234F1Z5)',
        } },
    AR: { locale: 'es-AR', currency: 'ARS', tz: 'America/Argentina/Buenos_Aires', taxIdLabel: 'CUIT', taxName: 'IVA' },
    US: { locale: 'en-US', currency: 'USD', tz: 'America/New_York', taxIdLabel: 'EIN', taxName: 'Sales Tax' },
    CA: { locale: 'en-CA', currency: 'CAD', tz: 'America/Toronto', taxIdLabel: 'BN', taxName: 'GST/HST' },
    GB: { locale: 'en-GB', currency: 'GBP', tz: 'Europe/London', taxIdLabel: 'VAT', taxName: 'VAT' },
    TH: { locale: 'th-TH', currency: 'THB', tz: 'Asia/Bangkok', taxIdLabel: 'Tax ID', taxName: 'VAT' },
    SG: { locale: 'en-SG', currency: 'SGD', tz: 'Asia/Singapore', taxIdLabel: 'UEN', taxName: 'GST' },
    MY: { locale: 'ms-MY', currency: 'MYR', tz: 'Asia/Kuala_Lumpur', taxName: 'SST' },
    ID: { locale: 'id-ID', currency: 'IDR', tz: 'Asia/Jakarta', taxIdLabel: 'NPWP', taxName: 'VAT' },
    PH: { locale: 'en-PH', currency: 'PHP', tz: 'Asia/Manila', taxIdLabel: 'TIN', taxName: 'VAT' },
    VN: { locale: 'vi-VN', currency: 'VND', tz: 'Asia/Ho_Chi_Minh', taxIdLabel: 'MST', taxName: 'VAT' },
    AU: { locale: 'en-AU', currency: 'AUD', tz: 'Australia/Sydney', taxIdLabel: 'ABN', taxName: 'GST' },
    NZ: { locale: 'en-NZ', currency: 'NZD', tz: 'Pacific/Auckland', taxIdLabel: 'IRD', taxName: 'GST' },
    AE: { locale: 'ar-AE', currency: 'AED', tz: 'Asia/Dubai', taxIdLabel: 'TRN', taxName: 'VAT' },
    SA: { locale: 'ar-SA', currency: 'SAR', tz: 'Asia/Riyadh', taxIdLabel: 'VAT', taxName: 'VAT' },
    ZA: { locale: 'en-ZA', currency: 'ZAR', tz: 'Africa/Johannesburg', taxIdLabel: 'VAT', taxName: 'VAT' },
    MA: { locale: 'fr-MA', currency: 'MAD', tz: 'Africa/Casablanca', taxIdLabel: 'Tax ID', taxName: 'VAT' },
    KE: { locale: 'en-KE', currency: 'KES', tz: 'Africa/Nairobi', taxIdLabel: 'PIN', taxName: 'VAT' },
    NG: { locale: 'en-NG', currency: 'NGN', tz: 'Africa/Lagos', taxIdLabel: 'TIN', taxName: 'VAT' },
    BR: { locale: 'pt-BR', currency: 'BRL', tz: 'America/Sao_Paulo', taxIdLabel: 'CNPJ', taxName: 'ICMS' },
    MX: { locale: 'es-MX', currency: 'MXN', tz: 'America/Mexico_City', taxIdLabel: 'RFC', taxName: 'IVA' },
    CL: { locale: 'es-CL', currency: 'CLP', tz: 'America/Santiago', taxIdLabel: 'RUT', taxName: 'IVA' },
    UY: { locale: 'es-UY', currency: 'UYU', tz: 'America/Montevideo', taxIdLabel: 'RUT', taxName: 'IVA' },
    PY: { locale: 'es-PY', currency: 'PYG', tz: 'America/Asuncion', taxIdLabel: 'RUC', taxName: 'IVA' },
    JP: { locale: 'ja-JP', currency: 'JPY', tz: 'Asia/Tokyo', taxName: 'VAT' },
    KR: { locale: 'ko-KR', currency: 'KRW', tz: 'Asia/Seoul', taxIdLabel: 'BRN', taxName: 'VAT' },
    CN: { locale: 'zh-CN', currency: 'CNY', tz: 'Asia/Shanghai', taxIdLabel: 'USCC', taxName: 'VAT' },
    HK: { locale: 'zh-HK', currency: 'HKD', tz: 'Asia/Hong_Kong' },
    TW: { locale: 'zh-TW', currency: 'TWD', tz: 'Asia/Taipei', taxIdLabel: 'UBN', taxName: 'VAT' },
    PK: { locale: 'en-PK', currency: 'PKR', tz: 'Asia/Karachi', taxIdLabel: 'NTN', taxName: 'GST' },
    BD: { locale: 'bn-BD', currency: 'BDT', tz: 'Asia/Dhaka', taxIdLabel: 'TIN', taxName: 'VAT' },
    LK: { locale: 'en-LK', currency: 'LKR', tz: 'Asia/Colombo', taxIdLabel: 'TIN', taxName: 'VAT' },
    NP: { locale: 'ne-NP', currency: 'NPR', tz: 'Asia/Kathmandu', taxIdLabel: 'TIN', taxName: 'VAT' },
    EG: { locale: 'ar-EG', currency: 'EGP', tz: 'Africa/Cairo', taxIdLabel: 'TIN', taxName: 'VAT' },
    IL: { locale: 'he-IL', currency: 'ILS', tz: 'Asia/Jerusalem', taxName: 'VAT' },
    TR: { locale: 'tr-TR', currency: 'TRY', tz: 'Europe/Istanbul', taxIdLabel: 'VKN', taxName: 'KDV' },
    IR: { locale: 'fa-IR', currency: 'IRR', tz: 'Asia/Tehran', taxIdLabel: 'Economic Code', taxName: 'VAT',
        localeOptions: {
            currencyDisplay: ['rial', 'toman', 'toman_short'],
            digits: ['locale', 'latin'],
            calendar: ['locale', 'persian', 'gregorian'],
        } },
    // Eurozone
    DE: { locale: 'de-DE', currency: 'EUR', tz: 'Europe/Berlin', taxIdLabel: 'Steuernummer' },
    FR: { locale: 'fr-FR', currency: 'EUR', tz: 'Europe/Paris' },
    IT: { locale: 'it-IT', currency: 'EUR', tz: 'Europe/Rome' },
    ES: { locale: 'es-ES', currency: 'EUR', tz: 'Europe/Madrid' },
    PT: { locale: 'pt-PT', currency: 'EUR', tz: 'Europe/Lisbon' },
    NL: { locale: 'nl-NL', currency: 'EUR', tz: 'Europe/Amsterdam' },
    BE: { locale: 'nl-BE', currency: 'EUR', tz: 'Europe/Brussels' },
    IE: { locale: 'en-IE', currency: 'EUR', tz: 'Europe/Dublin' },
    AT: { locale: 'de-AT', currency: 'EUR', tz: 'Europe/Vienna' },
    GR: { locale: 'el-GR', currency: 'EUR', tz: 'Europe/Athens' },
    FI: { locale: 'fi-FI', currency: 'EUR', tz: 'Europe/Helsinki' },
    LU: { locale: 'fr-LU', currency: 'EUR', tz: 'Europe/Luxembourg' },
    MT: { locale: 'en-MT', currency: 'EUR', tz: 'Europe/Malta' },
    CY: { locale: 'el-CY', currency: 'EUR', tz: 'Asia/Nicosia' },
    SK: { locale: 'sk-SK', currency: 'EUR', tz: 'Europe/Bratislava' },
    SI: { locale: 'sl-SI', currency: 'EUR', tz: 'Europe/Ljubljana' },
    EE: { locale: 'et-EE', currency: 'EUR', tz: 'Europe/Tallinn' },
    LV: { locale: 'lv-LV', currency: 'EUR', tz: 'Europe/Riga' },
    LT: { locale: 'lt-LT', currency: 'EUR', tz: 'Europe/Vilnius' },
    HR: { locale: 'hr-HR', currency: 'EUR', tz: 'Europe/Zagreb' },
    // Europe (non-euro)
    CH: { locale: 'de-CH', currency: 'CHF', tz: 'Europe/Zurich' },
    SE: { locale: 'sv-SE', currency: 'SEK', tz: 'Europe/Stockholm' },
    NO: { locale: 'nb-NO', currency: 'NOK', tz: 'Europe/Oslo' },
    DK: { locale: 'da-DK', currency: 'DKK', tz: 'Europe/Copenhagen' },
    PL: { locale: 'pl-PL', currency: 'PLN', tz: 'Europe/Warsaw' },
    CZ: { locale: 'cs-CZ', currency: 'CZK', tz: 'Europe/Prague' },
    HU: { locale: 'hu-HU', currency: 'HUF', tz: 'Europe/Budapest' },
    RO: { locale: 'ro-RO', currency: 'RON', tz: 'Europe/Bucharest' },
    BG: { locale: 'bg-BG', currency: 'BGN', tz: 'Europe/Sofia' },
    IS: { locale: 'is-IS', currency: 'ISK', tz: 'Atlantic/Reykjavik' },
    RS: { locale: 'sr-RS', currency: 'RSD', tz: 'Europe/Belgrade' },
    UA: { locale: 'uk-UA', currency: 'UAH', tz: 'Europe/Kyiv' },
    AL: { locale: 'sq-AL', currency: 'ALL', tz: 'Europe/Tirane' },
    MK: { locale: 'mk-MK', currency: 'MKD', tz: 'Europe/Skopje' },
    BA: { locale: 'bs-BA', currency: 'BAM', tz: 'Europe/Sarajevo' },
    MD: { locale: 'ro-MD', currency: 'MDL', tz: 'Europe/Chisinau' },
    GE: { locale: 'ka-GE', currency: 'GEL', tz: 'Asia/Tbilisi' },
    AM: { locale: 'hy-AM', currency: 'AMD', tz: 'Asia/Yerevan' },
    AZ: { locale: 'az-AZ', currency: 'AZN', tz: 'Asia/Baku' },
    // Middle East (GCC & Levant)
    QA: { locale: 'ar-QA', currency: 'QAR', tz: 'Asia/Qatar' },
    KW: { locale: 'ar-KW', currency: 'KWD', tz: 'Asia/Kuwait' },
    BH: { locale: 'ar-BH', currency: 'BHD', tz: 'Asia/Bahrain' },
    OM: { locale: 'ar-OM', currency: 'OMR', tz: 'Asia/Muscat' },
    JO: { locale: 'ar-JO', currency: 'JOD', tz: 'Asia/Amman' },
    LB: { locale: 'ar-LB', currency: 'LBP', tz: 'Asia/Beirut' },
    IQ: { locale: 'ar-IQ', currency: 'IQD', tz: 'Asia/Baghdad' },
    YE: { locale: 'ar-YE', currency: 'YER', tz: 'Asia/Aden' },
    // Africa
    GH: { locale: 'en-GH', currency: 'GHS', tz: 'Africa/Accra' },
    TZ: { locale: 'en-TZ', currency: 'TZS', tz: 'Africa/Dar_es_Salaam' },
    UG: { locale: 'en-UG', currency: 'UGX', tz: 'Africa/Kampala' },
    ET: { locale: 'am-ET', currency: 'ETB', tz: 'Africa/Addis_Ababa' },
    RW: { locale: 'en-RW', currency: 'RWF', tz: 'Africa/Kigali' },
    CI: { locale: 'fr-CI', currency: 'XOF', tz: 'Africa/Abidjan' },
    SN: { locale: 'fr-SN', currency: 'XOF', tz: 'Africa/Dakar' },
    CM: { locale: 'fr-CM', currency: 'XAF', tz: 'Africa/Douala' },
    ZM: { locale: 'en-ZM', currency: 'ZMW', tz: 'Africa/Lusaka' },
    MU: { locale: 'en-MU', currency: 'MUR', tz: 'Indian/Mauritius' },
    TN: { locale: 'ar-TN', currency: 'TND', tz: 'Africa/Tunis' },
    DZ: { locale: 'ar-DZ', currency: 'DZD', tz: 'Africa/Algiers' },
    BW: { locale: 'en-BW', currency: 'BWP', tz: 'Africa/Gaborone' },
    NA: { locale: 'en-NA', currency: 'NAD', tz: 'Africa/Windhoek' },
    MZ: { locale: 'pt-MZ', currency: 'MZN', tz: 'Africa/Maputo' },
    AO: { locale: 'pt-AO', currency: 'AOA', tz: 'Africa/Luanda' },
    // Asia (remaining)
    KZ: { locale: 'kk-KZ', currency: 'KZT', tz: 'Asia/Almaty' },
    UZ: { locale: 'uz-UZ', currency: 'UZS', tz: 'Asia/Tashkent' },
    MN: { locale: 'mn-MN', currency: 'MNT', tz: 'Asia/Ulaanbaatar' },
    MM: { locale: 'my-MM', currency: 'MMK', tz: 'Asia/Yangon' },
    KH: { locale: 'km-KH', currency: 'KHR', tz: 'Asia/Phnom_Penh' },
    LA: { locale: 'lo-LA', currency: 'LAK', tz: 'Asia/Vientiane' },
    BN: { locale: 'ms-BN', currency: 'BND', tz: 'Asia/Brunei' },
    MO: { locale: 'zh-MO', currency: 'MOP', tz: 'Asia/Macau' },
    MV: { locale: 'dv-MV', currency: 'MVR', tz: 'Indian/Maldives' },
    BT: { locale: 'dz-BT', currency: 'BTN', tz: 'Asia/Thimphu' },
    AF: { locale: 'fa-AF', currency: 'AFN', tz: 'Asia/Kabul' },
    // Americas (remaining)
    GT: { locale: 'es-GT', currency: 'GTQ', tz: 'America/Guatemala' },
    CR: { locale: 'es-CR', currency: 'CRC', tz: 'America/Costa_Rica' },
    PA: { locale: 'es-PA', currency: 'PAB', tz: 'America/Panama' },
    DO: { locale: 'es-DO', currency: 'DOP', tz: 'America/Santo_Domingo' },
    HN: { locale: 'es-HN', currency: 'HNL', tz: 'America/Tegucigalpa' },
    SV: { locale: 'es-SV', currency: 'USD', tz: 'America/El_Salvador' },
    NI: { locale: 'es-NI', currency: 'NIO', tz: 'America/Managua' },
    BZ: { locale: 'en-BZ', currency: 'BZD', tz: 'America/Belize' },
    JM: { locale: 'en-JM', currency: 'JMD', tz: 'America/Jamaica' },
    TT: { locale: 'en-TT', currency: 'TTD', tz: 'America/Port_of_Spain' },
    BS: { locale: 'en-BS', currency: 'BSD', tz: 'America/Nassau' },
    BB: { locale: 'en-BB', currency: 'BBD', tz: 'America/Barbados' },
    HT: { locale: 'fr-HT', currency: 'HTG', tz: 'America/Port-au-Prince' },
    BO: { locale: 'es-BO', currency: 'BOB', tz: 'America/La_Paz' },
    EC: { locale: 'es-EC', currency: 'USD', tz: 'America/Guayaquil' },
    CO: { locale: 'es-CO', currency: 'COP', tz: 'America/Bogota' },
    PE: { locale: 'es-PE', currency: 'PEN', tz: 'America/Lima' },
    VE: { locale: 'es-VE', currency: 'VES', tz: 'America/Caracas' },
    // Oceania (remaining)
    FJ: { locale: 'en-FJ', currency: 'FJD', tz: 'Pacific/Fiji' },
    PG: { locale: 'en-PG', currency: 'PGK', tz: 'Pacific/Port_Moresby' },
};
function build(code) {
    const r = SUPPORTED[code];
    return {
        code,
        name: dn.of(code) ?? code,
        currency: r.currency,
        timezone: r.tz,
        dialCode: (() => { try {
            return `+${(0, libphonenumber_js_1.getCountryCallingCode)(code)}`;
        }
        catch {
            return '+1';
        } })(),
        locale: r.locale,
        taxIdLabel: r.taxIdLabel,
        taxName: r.taxName,
        taxIdFormat: r.taxIdFormat,
        localeOptions: r.localeOptions,
    };
}
exports.COUNTRIES = Object.keys(SUPPORTED)
    .map(build)
    .sort((a, b) => {
    if (a.code === 'IN')
        return -1;
    if (b.code === 'IN')
        return 1;
    if (a.code === 'AR')
        return -1;
    if (b.code === 'AR')
        return 1;
    return a.name.localeCompare(b.name);
});
const getCountryByCode = (code) => {
    if (!code)
        return undefined;
    return exports.COUNTRIES.find((c) => c.code === code.toUpperCase());
};
exports.getCountryByCode = getCountryByCode;
// countryCode is required: regional settings come from signup, never from a
// fallback (docs/reference/product-invariants.md). Every caller resolves this from an
// already-configured store's settings/tenant, so RegionalNotConfiguredError
// here indicates a real bug upstream, not a state to silently paper over.
function resolveTenantCurrency(currency, countryCode) {
    // The country must be real before an explicit currency is ever trusted —
    // otherwise a syntactically-valid-but-bogus currency (e.g. 'ZZZ') masks an
    // unresolvable country and this never throws, silently processing money
    // under invalid regional settings.
    const country = (0, exports.getCountryByCode)(countryCode);
    if (!country)
        throw new RegionalNotConfiguredError(countryCode);
    if (typeof currency === 'string') {
        const normalized = currency.trim().toUpperCase();
        if ((0, currency_1.isSyntacticallyValidCurrencyCode)(normalized))
            return normalized;
    }
    return country.currency;
}
// Neutral fallback preferences for locales without country-specific options.
const NEUTRAL_LOCALE_PREFERENCES = {
    currency_display: 'rial',
    number_digits: 'locale',
    calendar: 'locale',
};
const LOCALE_OPTION_FIELDS = {
    currency_display: 'currencyDisplay',
    number_digits: 'digits',
    calendar: 'calendar',
};
function isLocalePreferenceKey(key) {
    return key === 'currency_display' || key === 'number_digits' || key === 'calendar';
}
function isLocalePreferenceSupported(key, value, countryCode) {
    if (value === NEUTRAL_LOCALE_PREFERENCES[key])
        return true;
    const options = (0, exports.getCountryByCode)(countryCode)?.localeOptions?.[LOCALE_OPTION_FIELDS[key]];
    return Array.isArray(options) && options.includes(value);
}
function resolveStoredLocalePreference(key, stored, countryCode) {
    if (stored && isLocalePreferenceSupported(key, stored, countryCode))
        return stored;
    return NEUTRAL_LOCALE_PREFERENCES[key];
}
const getCurrencySymbol = (currency, locale = 'en-US') => {
    if (!currency)
        return currency;
    try {
        const symbol = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
            .formatToParts(0)
            .find((p) => p.type === 'currency')?.value;
        return symbol && symbol !== '¤' ? symbol : currency;
    }
    catch {
        return currency;
    }
};
exports.getCurrencySymbol = getCurrencySymbol;
const IRAN_CURRENCY = 'IRR';
const TOMAN_PER_RIAL = 10;
const normalizePreferences = (prefs) => ({
    currencyDisplay: prefs?.currencyDisplay ?? 'rial',
    digits: prefs?.digits ?? 'locale',
    calendar: prefs?.calendar ?? 'locale',
});
const formatCurrency = (amount, currency, locale = 'en-US') => {
    if (!currency)
        return amount.toFixed(2);
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(amount);
    }
    catch {
        return `${currency} ${amount.toFixed(2)}`;
    }
};
exports.formatCurrency = formatCurrency;
// Currency display with Iran currencyDisplay/digits preferences applied.
const formatMoney = (amount, currency, locale = 'en-US', prefs) => {
    const { currencyDisplay, digits } = normalizePreferences(prefs);
    const numberingSystem = digits === 'latin' ? 'latn' : undefined;
    if (currency === IRAN_CURRENCY && currencyDisplay !== 'rial') {
        // 1 Toman = 10 Rial; divide for display only, never for storage.
        const toman = amount / TOMAN_PER_RIAL;
        if (currencyDisplay === 'toman') {
            return `${(0, exports.formatNumber)(toman, locale, numberingSystem)} تومان`;
        }
        // toman_short — colloquial shorthand, Persian/Latin suffix by digit mode.
        return `${(0, exports.formatNumber)(toman, locale, numberingSystem)}${digits === 'latin' ? 'T' : 'ت'}`;
    }
    if (!currency)
        return (0, exports.formatNumber)(amount, locale, numberingSystem);
    try {
        // Rial display is whole-unit text even though IRR arithmetic retains 2 digits.
        const fractionDigits = currency === IRAN_CURRENCY ? 0 : getCurrencyFractionDigits(currency);
        const formatted = new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            currencyDisplay: 'narrowSymbol',
            numberingSystem,
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(amount);
        if (!formatted.includes('¤'))
            return formatted;
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            currencyDisplay: 'code',
            numberingSystem,
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(amount);
    }
    catch {
        return `${currency} ${(0, exports.formatNumber)(amount, locale, numberingSystem)}`;
    }
};
exports.formatMoney = formatMoney;
// Resolves ISO 4217 decimal fraction digits for a currency code, falling back to 2.
function getCurrencyFractionDigits(currency) {
    if (!currency || typeof currency !== 'string')
        return 2;
    // FloCafe treats COP as a whole-peso currency in tenant arithmetic and display.
    if (currency === 'COP')
        return 0;
    if (currency === 'IRR')
        return 2;
    try {
        const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
        return formatter.resolvedOptions().maximumFractionDigits ?? 2;
    }
    catch {
        return 2;
    }
}
// Resolves the minor-unit factor (e.g. 1 for JPY, 100 for USD) for currency arithmetic.
function getCurrencyMinorUnitFactor(currency) {
    return Math.pow(10, getCurrencyFractionDigits(currency));
}
// Centralized adapter for input/display conversions across currencies and display preferences.
const getCurrencyUnitAdapter = (currency, countryCode, prefs) => {
    const { currencyDisplay, digits } = normalizePreferences(prefs);
    if (currency === IRAN_CURRENCY && currencyDisplay !== 'rial') {
        const label = currencyDisplay === 'toman_short'
            ? (digits === 'latin' ? 'T' : 'ت')
            : 'تومان';
        return {
            scale: 0.1,
            label,
            step: '0.001',
            maxDecimals: 3,
            toDisplay: (storedAmount) => Number((storedAmount / TOMAN_PER_RIAL).toFixed(4)),
            toStored: (displayAmount) => Number((displayAmount * TOMAN_PER_RIAL).toFixed(2)),
            formatInput: (displayAmount) => String(Number(displayAmount.toFixed(3))),
        };
    }
    // Preserve existing Rial test invariant (step: '0.01', maxDecimals: 2)
    if (currency === IRAN_CURRENCY) {
        return {
            scale: 1,
            label: currency,
            step: '0.01',
            maxDecimals: 2,
            toDisplay: (storedAmount) => Number(storedAmount.toFixed(2)),
            toStored: (displayAmount) => Number(displayAmount.toFixed(2)),
            formatInput: (displayAmount) => String(Number(displayAmount.toFixed(2))),
        };
    }
    const decimals = getCurrencyFractionDigits(currency);
    const step = (10 ** -decimals).toFixed(decimals);
    return {
        scale: 1,
        label: currency,
        step,
        maxDecimals: decimals,
        toDisplay: (storedAmount) => Number(storedAmount.toFixed(decimals)),
        toStored: (displayAmount) => Number(displayAmount.toFixed(decimals)),
        formatInput: (displayAmount) => String(Number(displayAmount.toFixed(decimals))),
    };
};
exports.getCurrencyUnitAdapter = getCurrencyUnitAdapter;
const formatCurrencyForTenant = (amount, countryCode, currency, prefs) => (0, exports.formatMoney)(amount, currency, (0, exports.getCountryByCode)(countryCode)?.locale ?? 'en-US', prefs);
exports.formatCurrencyForTenant = formatCurrencyForTenant;
// Formats a plain number using the given locale's digits and grouping.
const formatNumber = (value, locale = 'en-US', numberingSystem) => {
    try {
        return new Intl.NumberFormat(locale, numberingSystem ? { numberingSystem } : undefined).format(value);
    }
    catch {
        return String(value);
    }
};
exports.formatNumber = formatNumber;
// Formats a plain number using tenant locale and digit preferences.
const formatNumberForTenant = (value, countryCode, prefs) => {
    const { digits } = normalizePreferences(prefs);
    return (0, exports.formatNumber)(value, (0, exports.getCountryByCode)(countryCode)?.locale ?? 'en-US', digits === 'latin' ? 'latn' : undefined);
};
exports.formatNumberForTenant = formatNumberForTenant;
function calendarOption(calendar) {
    if (calendar === 'gregorian')
        return 'gregory';
    if (calendar === 'persian')
        return 'persian';
    return undefined;
}
// Formats a date with tenant timezone, preferences, and optional UI locale override.
const formatDateForTenant = (date, countryCode, timezone, prefs, options = {}, localeOverride) => {
    const { digits, calendar } = normalizePreferences(prefs);
    const tenantLocale = (0, exports.getCountryByCode)(countryCode)?.locale || 'en-US';
    const locale = localeOverride || tenantLocale;
    try {
        // Tenant preferences belong to the tenant profile; resolve defaults before UI override.
        const tenantDateDefaults = new Intl.DateTimeFormat(tenantLocale).resolvedOptions();
        const tenantNumberDefaults = new Intl.NumberFormat(tenantLocale).resolvedOptions();
        const numberingSystem = digits === 'latin' ? 'latn' : tenantNumberDefaults.numberingSystem;
        const calendarValue = calendarOption(calendar) || tenantDateDefaults.calendar;
        return new Intl.DateTimeFormat(locale, {
            timeZone: timezone,
            ...(numberingSystem ? { numberingSystem } : {}),
            ...(calendarValue ? { calendar: calendarValue } : {}),
            ...options,
        }).format(date);
    }
    catch {
        return date.toISOString();
    }
};
exports.formatDateForTenant = formatDateForTenant;
const countryName = (code) => {
    try {
        return dn.of(code.toUpperCase()) ?? code;
    }
    catch {
        return code;
    }
};
exports.countryName = countryName;
// Sourced via native Intl API (offline-first, no bundled tz database).
const listTimeZones = () => {
    try {
        const zones = Intl.supportedValuesOf('timeZone');
        return Array.isArray(zones) ? zones.slice().sort() : [];
    }
    catch {
        // Degrade to empty list if unsupported; selected value remains rendered as fallback.
        return [];
    }
};
exports.listTimeZones = listTimeZones;
// Validates IANA timezone identifier using native Intl.DateTimeFormat (offline-first).
const isValidTimeZone = (value) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 100)
        return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
        return true;
    }
    catch {
        return false;
    }
};
exports.isValidTimeZone = isValidTimeZone;
exports.DEFAULT_COUNTRY_PROFILE = {
    dialCode: '+1',
    locale: 'en-US',
    taxIdLabel: 'Tax ID',
    taxName: 'Tax',
};
// ── Regional snapshot (docs/architecture/regional-settings.md) ───────────────────────────
//
// The country chosen at signup, and the ISO 4217 currency that follows from
// it, are the only source of a store's regional identity. Everything else
// here is derived from that pair via Intl/ISO/IANA conventions — there is no
// default country, and no per-store override of symbol, position, or
// separators. Timezone is the one exception: country.timezone is only the
// fallback, and a valid stored settings.timezone overrides it, for stores in
// multi-zone countries. See docs/reference/product-invariants.md, "Regional settings
// come from signup, never from a fallback".
/** Thrown when a store has no resolvable country or, via the optional `field`,
 * another required regional setting (e.g. timezone). Callers should surface
 * this as a 409, not substitute a default. statusCode lets the many existing
 * `error.statusCode || 500` route catch blocks map it correctly without each
 * needing an explicit instanceof check. */
class RegionalNotConfiguredError extends Error {
    statusCode = 409;
    constructor(value, field = 'country') {
        super(`Regional settings are not configured (${field}: ${JSON.stringify(value)})`);
        this.name = 'RegionalNotConfiguredError';
    }
}
exports.RegionalNotConfiguredError = RegionalNotConfiguredError;
// Whether the currency symbol renders before or after the amount for this locale/currency pair.
function regionalCurrencyPosition(locale, currency) {
    try {
        const parts = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
            .formatToParts(1);
        return parts.findIndex((part) => part.type === 'currency') < parts.findIndex((part) => part.type === 'integer')
            ? 'prefix'
            : 'suffix';
    }
    catch {
        return 'prefix';
    }
}
// Decimal and thousands-group separators for this locale, per CLDR via Intl.
function regionalNumberSeparators(locale) {
    try {
        const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
        return {
            decimalSeparator: parts.find((part) => part.type === 'decimal')?.value ?? '.',
            groupSeparator: parts.find((part) => part.type === 'group')?.value ?? '',
        };
    }
    catch {
        return { decimalSeparator: '.', groupSeparator: ',' };
    }
}
/**
 * Resolves a store's regional identity from its settings. Pure: same
 * settings in, same snapshot out, no I/O. Throws RegionalNotConfiguredError
 * when the store has no resolvable country — callers must not substitute a
 * default rather than handling that.
 */
function resolveRegionalSnapshot(settings) {
    const country = (0, exports.getCountryByCode)(settings.country ?? '');
    if (!country)
        throw new RegionalNotConfiguredError(settings.country);
    const currency = resolveTenantCurrency(settings.currency, country.code);
    const timezone = (0, exports.isValidTimeZone)(settings.timezone) ? settings.timezone : country.timezone;
    const { decimalSeparator, groupSeparator } = regionalNumberSeparators(country.locale);
    return {
        country: country.code,
        locale: country.locale,
        currency,
        currencySymbol: (0, exports.getCurrencySymbol)(currency, country.locale),
        currencyPosition: regionalCurrencyPosition(country.locale, currency),
        currencyFractionDigits: getCurrencyFractionDigits(currency),
        decimalSeparator,
        groupSeparator,
        timezone,
        preferences: {
            currencyDisplay: resolveStoredLocalePreference('currency_display', settings.currency_display, country.code),
            digits: resolveStoredLocalePreference('number_digits', settings.number_digits, country.code),
            calendar: resolveStoredLocalePreference('calendar', settings.calendar, country.code),
        },
    };
}
// True if `digits` either has no grouping at all, or its grouping exactly
// matches what Intl would produce for this locale — catching malformed
// grouping (e.g. "1,00" for en-US, a 2-digit trailing group) instead of
// silently stripping it into a wrong value. Locale-correct by construction
// (en-IN's 2-3-3 groups, not just Western 3s), not a hardcoded pattern.
function hasValidLocaleGrouping(digits, format) {
    if (!format.groupSeparator || !digits.includes(format.groupSeparator))
        return true;
    const rawDigits = digits.split(format.groupSeparator).join('');
    if (!/^\d+$/.test(rawDigits))
        return false;
    try {
        const regrouped = new Intl.NumberFormat(format.locale, { useGrouping: true, numberingSystem: 'latn' }).format(BigInt(rawDigits));
        return regrouped === digits;
    }
    catch {
        return false;
    }
}
/**
 * Reduces a locale-formatted amount (as typed, or as pasted from a
 * spreadsheet cell) to plain ASCII decimal-point notation, per the
 * snapshot's own separators — never a hardcoded '.'/','. Strips group
 * separators and one occurrence of the snapshot's own currency symbol;
 * swaps the decimal separator to '.'. Returns null for anything that
 * doesn't reduce to a plain number: unknown text, a repeated or
 * misplaced currency symbol, more than one decimal separator, or
 * grouping that doesn't match this locale's actual pattern.
 */
function canonicalizeLocalizedAmount(raw, format) {
    let cleaned = String(raw ?? '').trim();
    if (!cleaned)
        return null;
    if (format.currencySymbol) {
        const symbolCount = cleaned.split(format.currencySymbol).length - 1;
        if (symbolCount > 1)
            return null;
        if (symbolCount === 1) {
            if (!cleaned.startsWith(format.currencySymbol) && !cleaned.endsWith(format.currencySymbol))
                return null;
            cleaned = cleaned.split(format.currencySymbol).join('').trim();
        }
    }
    const sign = /^[+-]/.test(cleaned) ? cleaned[0] : '';
    if (sign)
        cleaned = cleaned.slice(1);
    const decimalParts = format.decimalSeparator ? cleaned.split(format.decimalSeparator) : [cleaned];
    if (decimalParts.length > 2)
        return null;
    const [integerPart, fractionPart] = decimalParts;
    if (!hasValidLocaleGrouping(integerPart, format))
        return null;
    const normalizedInteger = format.groupSeparator ? integerPart.split(format.groupSeparator).join('') : integerPart;
    const normalized = fractionPart !== undefined ? `${normalizedInteger}.${fractionPart}` : normalizedInteger;
    if (!normalized || !/^\d*\.?\d*$/.test(normalized))
        return null;
    return sign + normalized;
}
/**
 * Formats an amount for a CSV cell using the snapshot's decimal separator,
 * with ASCII digits and no grouping — CSV numeric fields are not grouped,
 * so canonicalizeLocalizedAmount can read the value straight back. Preserves
 * the value's own precision rather than rounding to currencyFractionDigits:
 * a stored price can carry more precision than its currency's nominal
 * fraction digits (nothing currently enforces that at write time), and
 * rounding on export would silently change the stored value on re-import.
 */
function formatAmountForCsv(value, snapshot) {
    const plain = String(value);
    return snapshot.decimalSeparator === '.' ? plain : plain.replace('.', snapshot.decimalSeparator);
}
//# sourceMappingURL=countries.js.map