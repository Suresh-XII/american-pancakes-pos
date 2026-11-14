/** Tracks whether store country was user-chosen or defaulted, with OS locale signals. */
export type CountrySource = 'user' | 'default';
export interface CountryProvenance {
    /** The configured country, or null when nobody has confirmed one. */
    country: string | null;
    countrySource: CountrySource;
    osCountry: string | null;
    osLocale: string | null;
    osTimezone: string | null;
}
/** Returns true if a user has explicitly confirmed or changed the store's country. */
export declare function isCountryConfirmed(): boolean;
export declare function readCountryProvenance(): CountryProvenance;
/** Generates a settings patch stamping country confirmation if explicitly chosen or changed. */
export declare function countryConfirmationPatch(submitted: unknown, stored: string | null | undefined, explicit?: unknown): Record<string, string>;
//# sourceMappingURL=country-provenance.d.ts.map