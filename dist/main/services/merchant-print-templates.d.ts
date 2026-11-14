/** Lifecycle, CRUD, and offline transfer for tenant-owned semantic receipt templates. */
export interface MerchantPrintTemplateRow {
    id: string;
    business_id: string;
    name: string;
    origin: 'created' | 'imported' | 'cloned';
    derived_from: string | null;
    document_type: string;
    schema_version: number;
    payload_json: string;
    status: 'draft' | 'active' | 'archived';
    previous_payload_json: string | null;
    checksum: string;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}
/** Structured provenance reference (stored as JSON in derived_from). */
export interface DerivedFromRef {
    /** Provenance class of the source. Compliance clones stay informational.
     *  `offline-import` (#448) records a portable transfer file as the source. */
    type: 'compliance-pack-template' | 'merchant-template' | 'offline-import';
    /** For offline imports: sha256 hex of the EXACT imported envelope text —
     *  a stable identity of the source artifact (not of any tenant row). */
    templateId: string;
    /** For offline imports only: sanitized source file name, informational. */
    fileName?: string;
}
export declare class MerchantTemplateError extends Error {
    readonly statusCode: number;
    readonly details?: readonly string[];
    constructor(message: string, statusCode?: number, details?: readonly string[]);
}
export declare function listMerchantPrintTemplates(): MerchantPrintTemplateRow[];
export declare function loadMerchantPrintTemplateRow(id: string): MerchantPrintTemplateRow | null;
/** Active template payload for the render path, or null when unavailable. */
export declare function loadActiveMerchantPrintTemplate(id: string): MerchantPrintTemplateRow | null;
export declare function createMerchantPrintTemplate(input: {
    name: unknown;
    payload: unknown;
    origin?: unknown;
    derivedFrom?: unknown;
}, actorId: string | null): MerchantPrintTemplateRow;
/** Updates name or payload; active rows snapshot current payload for rollback. */
export declare function updateMerchantPrintTemplate(id: string, input: {
    name?: unknown;
    payload?: unknown;
}, actorId: string | null): MerchantPrintTemplateRow;
export declare function activateMerchantPrintTemplate(id: string, actorId: string | null): MerchantPrintTemplateRow;
export declare function archiveMerchantPrintTemplate(id: string, actorId: string | null): MerchantPrintTemplateRow;
/** Restores previous_payload_json after verifying checksum and validating content. */
export declare function rollbackMerchantPrintTemplate(id: string, actorId: string | null): MerchantPrintTemplateRow;
export interface MerchantTemplateExportFile {
    /** Sanitized, traversal-proof download filename. */
    fileName: string;
    /** Envelope JSON text (pretty-printed for human inspection). */
    json: string;
}
/** Builds portable transfer envelope for active or archived templates with checksum verification. */
export declare function exportMerchantPrintTemplateFile(id: string): MerchantTemplateExportFile;
/** Imports a transfer file as a new draft template with verified checksum provenance. */
export declare function importMerchantPrintTemplateFile(input: {
    file?: unknown;
    name?: unknown;
    fileName?: unknown;
}, actorId: string | null): MerchantPrintTemplateRow;
//# sourceMappingURL=merchant-print-templates.d.ts.map