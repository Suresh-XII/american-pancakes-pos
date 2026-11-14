/**
 * PostHog identities per sharing level: `full` is the account (a hash of the store email),
 * `anonymous` is the device (a hash of a stored random seed), `off` is a random id per launch.
 */
export declare const PRODUCT_ANALYTICS_LEVEL_SETTING = "product_analytics_level";
export declare const PRODUCT_ANALYTICS_LEVELS: readonly ["full", "anonymous", "off"];
export type ProductAnalyticsLevel = (typeof PRODUCT_ANALYTICS_LEVELS)[number];
/** The device: a hash of a random seed generated once and kept in this database. */
export declare function readInstallRef(): string;
export declare function accountRefForEmail(email: string): string | undefined;
/**
 * The customer account, also used as `store_ref`. The first key this database derives is kept,
 * so editing the store email later does not split the person; a reinstall derives it again.
 */
export declare function readAccountRef(): string | undefined;
export interface PostHogIdentity {
    distinctId: string;
    /** True for the account; device and per-launch ids stay anonymous. */
    identified: boolean;
    installRef?: string;
    accountRef?: string;
}
export declare function parseProductAnalyticsLevel(value: unknown): ProductAnalyticsLevel | null;
/** Telemetry off wins. An onboarded store that has not chosen yet shares anonymously. */
export declare function readProductAnalyticsLevel(): ProductAnalyticsLevel;
/** The owner still has to answer the one-time sharing question. */
export declare function productAnalyticsChoicePending(): boolean;
export declare function resolvePostHogIdentity(level: ProductAnalyticsLevel): PostHogIdentity;
/** The device id still needs aliasing into this account. Each pair is aliased once. */
export declare function pendingAlias(identity: PostHogIdentity): string | null;
export declare function markAliased(identity: PostHogIdentity): void;
//# sourceMappingURL=posthog-identity.d.ts.map