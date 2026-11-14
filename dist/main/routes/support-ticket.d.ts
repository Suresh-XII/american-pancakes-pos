import { Request } from 'express';
/** Shared with the diagnostics screen so both surfaces classify a category identically. */
export declare function resolveCategory(value: unknown): string;
export declare function buildSystemDiagnostics(req: Request, category: string): {
    category: string;
    restaurant_name: string;
    country: string;
    timezone: string;
    app_version: any;
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
    device_name: string;
    schema_version: number;
    cloud: {
        registration_status: string;
        connected: boolean;
        relay_mode: "websocket" | "http_fallback" | "disconnected";
        last_error: string | null;
        pending_events: number;
        failed_events: number;
    };
    submitted_by_role: string;
};
export declare const supportTicketRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=support-ticket.d.ts.map