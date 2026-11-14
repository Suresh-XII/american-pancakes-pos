/**
 * Store-timezone parsing, daylight-saving validation, and wall-clock formatting
 * for scheduled order kitchen release times ("Send to kitchen at").
 *
 * Scheduled instants are entered and displayed in the configured store timezone
 * and persisted as canonical UTC ISO-8601 strings (`YYYY-MM-DDTHH:MM:SS.sssZ`),
 * so changing the store timezone setting later preserves the saved instant.
 */
export type ScheduledTimeValidationCode = 'INVALID_FORMAT' | 'INVALID_TIMEZONE' | 'INVALID_CALENDAR_DATE' | 'DST_NONEXISTENT_TIME' | 'DST_AMBIGUOUS_TIME' | 'PAST_SCHEDULED_TIME';
export interface ScheduledTimeParseSuccess {
    ok: true;
    isoUtc: string;
    instantMs: number;
}
export interface ScheduledTimeParseFailure {
    ok: false;
    code: ScheduledTimeValidationCode;
    message: string;
}
export type ScheduledTimeParseResult = ScheduledTimeParseSuccess | ScheduledTimeParseFailure;
export interface ParseScheduledForOptions {
    input: unknown;
    timezone: string;
    nowMs?: number;
}
/**
 * Parses a "Send to kitchen at" value into a canonical UTC ISO instant.
 *
 * - Wall-clock inputs (`YYYY-MM-DDTHH:MM` or `YYYY-MM-DD HH:MM[:SS]`) are
 *   interpreted in `timezone`, rejecting nonexistent (skipped spring-forward)
 *   and ambiguous (repeated fall-back) daylight-saving times with a clear
 *   explanation.
 * - Past or current instants (`<= nowMs`) are rejected.
 */
export declare function parseScheduledForInput(options: ParseScheduledForOptions): ScheduledTimeParseResult;
/**
 * Formats an instant (Date or stored UTC timestamp) into `YYYY-MM-DDTHH:MM` in
 * the given IANA timezone for `<input type="datetime-local" />` controls.
 */
export declare function formatInstantForDateTimeInput(instant: Date | string | null | undefined, timezone: string): string;
/**
 * Formats an instant for human display in the configured store timezone.
 */
export declare function formatScheduledInstantForDisplay(instant: Date | string | null | undefined, timezone: string, locale?: string): string;
/**
 * Computes a sensible default future wall-clock value (`YYYY-MM-DDTHH:MM`) in
 * the store timezone, advancing past any ambiguous fall-back DST hour.
 */
export declare function suggestFutureScheduleWallClock(timezone: string, nowMs?: number, minutesAhead?: number): string;
//# sourceMappingURL=scheduled-time.d.ts.map