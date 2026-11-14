/**
 * Cash sessions / shift lifecycle (issue #279, approach A).
 *
 * Open state lives in `cash_sessions`; closes persist as `cash_closures`
 * rows with scope='session' (the extension door documented in
 * main/routes/cash-closures.ts). Day close is untouched.
 *
 * Session expected cash prefers explicit cash_session_id ownership, with
 * timestamp windows only for legacy rows, so sessions crossing midnight work.
 * The opening float lives on the session
 * row and is mirrored as the day's opening_float movement (once per day, or
 * summed across per-staff shifts on that day)
 * so day close reconciles the same drawer; session math excludes in-window
 * float movements and cannot double-count.
 */
import { Request } from 'express';
export interface AuthedRequest extends Request {
    user?: {
        userId: string;
        role: string;
    };
}
export declare const cashSessionRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=cash-sessions.d.ts.map