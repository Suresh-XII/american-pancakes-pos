/** PostHog project configuration. Without a token the client sends nothing. */
export declare const POSTHOG_PROJECT_TOKEN_SETTING = "posthog_project_token";
export declare const POSTHOG_HOST_SETTING = "posthog_host";
export declare const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";
export interface PostHogConfig {
    token: string;
    host: string;
}
/** Accepts an http(s) origin. Credentials and any other scheme are rejected. */
export declare function parsePostHogConfig(token: string, host: string): PostHogConfig | null;
export type PostHogEnvironment = 'production' | 'development';
/**
 * `production` for release builds, `development` with FLO_POSTHOG_DEV=1, else null (no connection).
 * Test suites run as plain Node, so they never connect even with a stubbed isPackaged.
 */
export declare function postHogEnvironment(): PostHogEnvironment | null;
export declare function postHogNetworkSuppressed(): boolean;
/**
 * Token and host: FLO_POSTHOG_DEV_* in development, then the settings row, then
 * build-identity.json; the host defaults to EU Cloud.
 */
export declare function readPostHogConfig(): PostHogConfig | null;
/** Origin allowed on connect-src, or null when PostHog must not be contacted. */
export declare function postHogConnectOrigin(): string | null;
//# sourceMappingURL=posthog-config.d.ts.map