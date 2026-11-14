import { DiagnosticEventInput } from '../services/cloud-sync';
/** Validates and normalizes a client-submitted diagnostic event; null when the payload is unacceptable. */
export declare function buildDiagnosticEvent(body: unknown): DiagnosticEventInput | null;
export declare const diagnosticsRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=diagnostics.d.ts.map