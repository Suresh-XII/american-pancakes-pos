/**
 * Allowlist for everything FloCafe sends to PostHog. Usage follows the sharing level, the email
 * only the `full` level, and exceptions follow diagnostics transmission.
 */
export declare const POSTHOG_CAPTURE_POINTS: readonly ["uncaughtException", "unhandledRejection", "renderer-autocapture", "react-error-boundary", "api-5xx"];
export type PostHogCapturePoint = (typeof POSTHOG_CAPTURE_POINTS)[number];
export declare const POSTHOG_USAGE_EVENTS: readonly ["app_launch", "daily_ping", "feature_used", "setup_completed", "first_order_created", "first_bill_paid"];
export type PostHogUsageEvent = (typeof POSTHOG_USAGE_EVENTS)[number];
/** Every property a usage event may carry. Anything else is dropped. */
export declare const POSTHOG_USAGE_PROPERTY_KEYS: readonly ["feature", "action", "check_count", "setup_profile", "service_model", "business_type", "hours_since_setup", "backfilled", "country", "currency", "language", "kds_enabled", "orders_24h", "orders_dine_in_24h", "orders_takeaway_24h", "orders_delivery_24h", "orders_online_24h", "orders_cancelled_24h", "bills_paid_24h", "staff_with_orders_24h", "active_staff_count", "products_count", "tables_count", "customers_count", "printers_count", "kitchen_stations_count"];
/** Store configuration kept on the person. None of it identifies a customer or an order. */
export declare const POSTHOG_PERSON_KEYS: readonly ["email", "country", "currency", "language", "service_model", "kds_enabled", "app_version", "platform", "run_mode", "install_source", "store_ref", "environment", "release_channel"];
/** Sent with every event so error tracking and insights can filter by release and channel. */
export declare const POSTHOG_SUPER_KEYS: readonly ["app_version", "platform", "run_mode", "install_source", "store_ref", "environment", "release_channel", "install_ref"];
/**
 * Who used the app, without saying who: the staff role and a per-installation hash of the
 * user id. One installation stays one person; staff are an event dimension, not persons.
 */
export declare const POSTHOG_STAFF_KEYS: readonly ["staff_role", "staff_ref"];
export interface ScrubbableEvent {
    event?: string;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
}
export interface PostHogScrubOptions {
    /** Usage events, pageviews, and person properties: the `full` or `anonymous` level. */
    telemetryEnabled: boolean;
    /** The email, `store_ref`, and account ids: the `full` level only. */
    accountLinked: boolean;
    /** Exceptions. Follows diagnostics transmission. */
    allowExceptions: boolean;
}
export declare function isPostHogCapturePoint(value: unknown): value is PostHogCapturePoint;
export declare function sanitizeErrorName(name: unknown, stack?: string): string;
/**
 * Removes emails, URLs, digit runs and quoted text from an error message. Identifier-like
 * quotes in engine messages, such as "(reading 'name')", are kept.
 */
export declare function redactExceptionMessage(message: unknown): string;
/** Project-relative path, or null when the frame is outside this repo. */
export declare function projectRelativeFile(raw: string): string | null;
/** Keeps only the stack lines of an error, so the message never rides along in the stack. */
export declare function stackFrameLines(stack: unknown): string[];
/** Route path with query, hash, and id-like segments removed. */
export declare function scrubPathname(value: unknown): string | null;
/**
 * Returns the event as it may leave the machine, or null when it must not.
 * `defaultCapturePoint` tags exceptions an SDK captured on its own (renderer autocapture).
 */
export declare function scrubPostHogEvent(event: ScrubbableEvent | null, options: PostHogScrubOptions & {
    defaultCapturePoint?: PostHogCapturePoint;
}): ScrubbableEvent | null;
//# sourceMappingURL=posthog-scrub.d.ts.map