/**
 * Shared ASCII currency fallback policy for thermal text paths.
 *
 * Financial values stay numeric and unchanged. This map only replaces a
 * display token when a native ESC/POS path cannot represent it.
 */
/** Currency display tokens that have stable, bounded ASCII fallbacks. */
export declare const CURRENCY_ASCII_MAP: Readonly<Record<string, string>>;
/** Replace known non-ASCII currency tokens without changing numeric values. */
export declare function normalizeCurrencyToAscii(text: string): string;
/** Regex source for matching known currency tokens in thermal safety checks. */
export declare const CURRENCY_TOKEN_PATTERN: string;
/** Canonical tenant currency storage contract. */
export declare const CURRENCY_CODE_PATTERN: RegExp;
export declare function isSyntacticallyValidCurrencyCode(value: unknown): value is string;
//# sourceMappingURL=currency.d.ts.map