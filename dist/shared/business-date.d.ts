/**
 * The business-day rule: which day an instant belongs to, for a tenant timezone
 * and a configured `business_day_start_time`.
 *
 * The backend resolves it through main/db.ts and the renderer imports this module
 * directly, so a report and the screen that shows it cannot name different days
 * for the same store. The rule works from the instant rather than from wall-clock
 * minutes: across a daylight-saving transition the local wall clock skips or
 * repeats, and only the instant comparison knows whether a repeated hour is the
 * first pass or the second.
 *
 * `businessDateForInstant` takes named arguments on purpose. Its two historical
 * callers passed the same three values in opposite orders, and because a Date and
 * a string are each valid in either position a swapped call typechecked and
 * silently moved money between days.
 */
export interface BusinessDateInput {
    /** The moment being bucketed. */
    instant: Date;
    /** IANA timezone of the tenant, e.g. `Europe/Madrid`. */
    timezone: string;
    /** `business_day_start_time` as `HH:MM`; anything unset or out of contract means midnight. */
    startTime?: string;
}
/**
 * The tenant's start-time contract: `00:00` to `11:59`, and midnight for anything
 * else. This is the range the settings endpoint accepts, so it is the range a
 * stored value can legitimately hold. Anything wider would make the renderer
 * honour an afternoon cutoff the backend's own read path normalises away, and the
 * two would then name different days for the same store.
 */
export declare function normalizeBusinessDayStartTime(startTime: string | null | undefined): string;
/** Business date of an instant: the tenant-local calendar day, rolled back one day when
 *  the instant is still inside the previous business day's window. The configured start
 *  time is held to the tenant contract first, so this answers exactly what the
 *  backend's own settings read path answers. */
export declare function businessDateForInstant({ instant, timezone, startTime }: BusinessDateInput): string;
/** Half-open UTC ranges `[start, end)` for one date in the tenant timezone with an optional day start offset. */
export declare function dayBoundsInTimezone(date: string, timezone: string, startTime?: string): [string, string];
/** Half-open UTC range strings `[start, end)` for a UTC calendar date with an optional day start offset. */
export declare function utcDayBounds(date: string, startTime?: string): [string, string];
//# sourceMappingURL=business-date.d.ts.map