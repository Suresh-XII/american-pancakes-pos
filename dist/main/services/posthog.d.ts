/**
 * PostHog beside the existing collector. Usage follows the sharing level in posthog-identity.ts;
 * nothing is sent without a project token (posthog-config.ts) or outside official releases.
 */
import type { NextFunction, Request, Response } from 'express';
import { type PostHogIdentity } from './posthog-identity';
import { type PostHogCapturePoint, type PostHogUsageEvent } from '../../shared/posthog-scrub';
export declare const POSTHOG_SHUTDOWN_TIMEOUT_MS = 2000;
export interface SuperProperties {
    app_version: string;
    platform: string;
    run_mode: string;
    install_source: string;
    environment: string;
    release_channel: string;
    install_ref?: string;
    store_ref?: string;
}
export interface PostHogBootstrap {
    enabled: false;
}
export interface PostHogBootstrapReady {
    enabled: true;
    distinctId: string;
    identified: boolean;
    token: string;
    host: string;
    telemetryEnabled: boolean;
    accountLinked: boolean;
    diagnosticsEnabled: boolean;
    superProperties: SuperProperties;
}
export declare function invalidatePostHogConsentCache(): void;
/** Release and channel, plus the device and, at the `full` level, the account (`store_ref`). */
export declare function readSuperProperties(current?: PostHogIdentity): SuperProperties;
/**
 * The store email cloud registration already sends, falling back to the account setup created.
 * Names are never sent.
 */
export declare function readInstallationEmail(): string | undefined;
/** Store configuration on the person, and the installation email at the `full` level only. */
export declare function readPersonProperties(): Record<string, string | boolean> | undefined;
/** Counts only: how much this store used FloCafe in the last 24 hours, and how it is set up. */
export declare function readDailyUsageSummary(): Record<string, number | boolean | string>;
/** The sharing level for Settings and the one-time question, asked only where PostHog can send. */
export declare function readProductAnalyticsChoice(): {
    level: "off" | "full" | "anonymous";
    choice_pending: boolean;
    email: string | null;
    diagnostics_enabled: boolean;
};
export declare function readPostHogBootstrap(): PostHogBootstrap | PostHogBootstrapReady;
/**
 * Updates the person for the current level: the account with the device folded into it, or the
 * anonymous device. Safe to call when PostHog is not configured.
 */
export declare function syncPostHogIdentity(): void;
/** Mirrors a usage event the collector also receives. Dropped at the `off` level. */
export declare function capturePostHogUsage(event: PostHogUsageEvent, properties?: Record<string, unknown>): void;
/**
 * First order and first payment, once per installation, read from the database. Milestones older
 * than this check (upgraded stores) are tagged `backfilled` to keep them out of live funnels.
 */
export declare function checkPostHogMilestones(): void;
/**
 * The 24h usage summary, at most once a day and independent of the collector. Best effort:
 * a ping the SDK cannot deliver is not resent.
 */
export declare function maybeSendPostHogDailyPing(nowMs?: number): void;
/** Runs from the telemetry service's hourly check. */
export declare function runPostHogDailyChecks(): void;
export declare function startPostHog(): void;
export declare function stopPostHog(options?: {
    flush?: boolean;
}): Promise<void>;
export declare function capturePostHogException(capturePoint: PostHogCapturePoint, input: unknown, properties?: Record<string, unknown>): void;
/**
 * The matched route pattern, such as `/api/orders/:id`. Express resets `baseUrl` once an error
 * leaves its router, so the mount prefix is recovered from the request path instead.
 */
export declare function apiRoutePattern(originalUrl: string, routePath: unknown): string;
/** A 5xx from the local API, keyed by method and route pattern. No params, query, or body. */
export declare function capturePostHogApiFailure(method: string, route: string, status: number): void;
/** Reports every 5xx the local API sends, including those from the global error handler. */
export declare function postHogApiFailureMiddleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=posthog.d.ts.map