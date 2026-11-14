export type DiagnosticSignature = {
    /** Normalised error class, e.g. `SQLiteError`. Never raw user input. */
    error_class: string;
    /** Stable grouping key and machine-readable cause, e.g. `SQLiteError: no such table: orders`. */
    signature: string;
    /** Plain-language line for the operator, e.g. `The database rejected a request: no such table: orders.` */
    summary: string;
    /**
     * Whether the template still carries real words. A message that arrives as one
     * quoted span or a bare host leaves nothing an operator can act on.
     */
    is_informative: boolean;
};
/** The plain-language clause on its own, for a template with nothing readable in it. */
export declare function classClauseSummary(errorClass: unknown): string;
/** Reduces an exception message to a literal-free template. */
export declare function deriveDiagnosticTemplate(rawMessage: unknown): string;
export declare function deriveDiagnosticSignature(source: {
    errorClass?: unknown;
    message?: unknown;
} | null | undefined): DiagnosticSignature;
/** Class name of a thrown value, or `Error` when it is not an Error instance. */
export declare function errorClassOf(error: unknown): string;
//# sourceMappingURL=diagnostic-signature.d.ts.map