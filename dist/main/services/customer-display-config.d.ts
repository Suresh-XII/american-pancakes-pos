export declare const CUSTOMER_DISPLAY_KEY = "customer_display";
export declare const CUSTOMER_DISPLAY_STATUSES: readonly ["pending", "preparing", "ready"];
export interface CustomerDisplayConfig {
    statuses: Array<(typeof CUSTOMER_DISPLAY_STATUSES)[number]>;
    refresh_seconds: number;
    show_updated: boolean;
}
export declare const CUSTOMER_DISPLAY_DEFAULTS: CustomerDisplayConfig;
/** Returns the normalized config, or null when the payload is malformed. */
export declare function parseCustomerDisplayConfig(value: unknown): CustomerDisplayConfig | null;
/** Parses a stored settings value, falling back to defaults when absent or invalid. */
export declare function readStoredCustomerDisplayConfig(raw: string | undefined): CustomerDisplayConfig;
//# sourceMappingURL=customer-display-config.d.ts.map