export declare const POPULAR_CURRENCY_CODES: readonly ["USD", "EUR", "GBP", "AED", "AUD", "CAD", "SGD", "JPY"];
export declare function listSupportedCurrencyCodes(): string[];
export declare function normalizeSupportedCurrencyCode(value: unknown): string | null;
export declare function isSupportedCurrencyCode(value: unknown): value is string;
export declare function getCurrencyDisplayName(code: string, locale: string): string;
//# sourceMappingURL=currencies.d.ts.map