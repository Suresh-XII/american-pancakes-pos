export interface TaxIdFormat {
    pattern: string;
    description: string;
}
export interface CountryLocaleOptions {
    currencyDisplay?: ('rial' | 'toman' | 'toman_short')[];
    digits?: ('locale' | 'latin')[];
    calendar?: ('locale' | 'persian' | 'gregorian')[];
}
export interface Country {
    code: string;
    name: string;
    currency: string;
    timezone: string;
    dialCode: string;
    locale: string;
    taxIdLabel?: string;
    taxName?: string;
    taxIdFormat?: TaxIdFormat;
    localeOptions?: CountryLocaleOptions;
}
export declare const COUNTRIES: Country[];
export declare const getCountryByCode: (code: string) => Country | undefined;
export declare function resolveTenantCurrency(currency: unknown, countryCode: string): string;
declare const NEUTRAL_LOCALE_PREFERENCES: {
    readonly currency_display: "rial";
    readonly number_digits: "locale";
    readonly calendar: "locale";
};
export type LocalePreferenceKey = keyof typeof NEUTRAL_LOCALE_PREFERENCES;
export declare function isLocalePreferenceKey(key: string): key is LocalePreferenceKey;
export declare function isLocalePreferenceSupported(key: LocalePreferenceKey, value: string, countryCode: string): boolean;
export declare function resolveStoredLocalePreference(key: LocalePreferenceKey, stored: string | undefined, countryCode: string): string;
export declare const getCurrencySymbol: (currency: string, locale?: string) => string;
export type CurrencyDisplay = 'rial' | 'toman' | 'toman_short';
export type DigitMode = 'locale' | 'latin';
export type CalendarMode = 'locale' | 'persian' | 'gregorian';
export interface LocalePreferences {
    currencyDisplay?: CurrencyDisplay;
    digits?: DigitMode;
    calendar?: CalendarMode;
}
export declare const formatCurrency: (amount: number, currency: string, locale?: string) => string;
export declare const formatMoney: (amount: number, currency: string, locale?: string, prefs?: LocalePreferences) => string;
export interface CurrencyUnitAdapter {
    scale: number;
    label: string;
    step: string;
    maxDecimals: number;
    toDisplay: (storedAmount: number) => number;
    toStored: (displayAmount: number) => number;
    formatInput: (displayAmount: number) => string;
}
export declare function getCurrencyFractionDigits(currency: string): number;
export declare function getCurrencyMinorUnitFactor(currency: string): number;
export declare const getCurrencyUnitAdapter: (currency: string, countryCode?: string, prefs?: LocalePreferences) => CurrencyUnitAdapter;
export declare const formatCurrencyForTenant: (amount: number, countryCode: string, currency: string, prefs?: LocalePreferences) => string;
export declare const formatNumber: (value: number, locale?: string, numberingSystem?: string) => string;
export declare const formatNumberForTenant: (value: number, countryCode: string, prefs?: LocalePreferences) => string;
export declare const formatDateForTenant: (date: Date, countryCode: string, timezone: string, prefs?: LocalePreferences, options?: Intl.DateTimeFormatOptions, localeOverride?: string) => string;
export declare const countryName: (code: string) => string;
export declare const listTimeZones: () => string[];
export declare const isValidTimeZone: (value: unknown) => boolean;
export declare const DEFAULT_COUNTRY_PROFILE: {
    readonly dialCode: "+1";
    readonly locale: "en-US";
    readonly taxIdLabel: "Tax ID";
    readonly taxName: "Tax";
};
/** Thrown when a store has no resolvable country or, via the optional `field`,
 * another required regional setting (e.g. timezone). Callers should surface
 * this as a 409, not substitute a default. statusCode lets the many existing
 * `error.statusCode || 500` route catch blocks map it correctly without each
 * needing an explicit instanceof check. */
export declare class RegionalNotConfiguredError extends Error {
    readonly statusCode = 409;
    constructor(value: unknown, field?: string);
}
export interface RegionalSnapshot {
    country: string;
    locale: string;
    currency: string;
    currencySymbol: string;
    currencyPosition: 'prefix' | 'suffix';
    currencyFractionDigits: number;
    decimalSeparator: string;
    groupSeparator: string;
    timezone: string;
    preferences: {
        currencyDisplay: CurrencyDisplay;
        digits: DigitMode;
        calendar: CalendarMode;
    };
}
/**
 * Resolves a store's regional identity from its settings. Pure: same
 * settings in, same snapshot out, no I/O. Throws RegionalNotConfiguredError
 * when the store has no resolvable country — callers must not substitute a
 * default rather than handling that.
 */
export declare function resolveRegionalSnapshot(settings: Record<string, string | undefined>): RegionalSnapshot;
type AmountFormat = Pick<RegionalSnapshot, 'decimalSeparator' | 'groupSeparator' | 'currencySymbol' | 'locale'>;
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
export declare function canonicalizeLocalizedAmount(raw: string, format: AmountFormat): string | null;
/**
 * Formats an amount for a CSV cell using the snapshot's decimal separator,
 * with ASCII digits and no grouping — CSV numeric fields are not grouped,
 * so canonicalizeLocalizedAmount can read the value straight back. Preserves
 * the value's own precision rather than rounding to currencyFractionDigits:
 * a stored price can carry more precision than its currency's nominal
 * fraction digits (nothing currently enforces that at write time), and
 * rounding on export would silently change the stored value on re-import.
 */
export declare function formatAmountForCsv(value: number, snapshot: Pick<RegionalSnapshot, 'decimalSeparator'>): string;
export {};
//# sourceMappingURL=countries.d.ts.map