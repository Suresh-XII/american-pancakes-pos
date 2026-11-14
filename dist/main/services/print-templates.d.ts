export declare const CORE_BILL_TEMPLATES: readonly ["classic", "compact"];
export type CoreBillTemplate = typeof CORE_BILL_TEMPLATES[number];
export interface InstalledPrintTemplate {
    template_id: string;
    pack_id: string;
    pack_version_id: string;
    country: string;
    jurisdiction: string;
    display_name: string;
    paper_widths_json: string;
    renderer_json: string;
    template_payload_json: string;
    status: string;
    created_at: string;
}
export declare function isCoreBillTemplate(value: string): value is CoreBillTemplate;
/** Structured bill-template selection persisted in settings as JSON. */
export type BillTemplateSource = 'core' | 'pack' | 'merchant';
export interface BillTemplateSelection {
    source: BillTemplateSource;
    id: string;
}
/** Resolves structured JSON or legacy string template representations into a BillTemplateSelection. */
export declare function parseBillTemplateSelection(rawValue: unknown): BillTemplateSelection | null;
/** Canonical persistence form for a selection (stored in settings). */
export declare function serializeBillTemplateSelection(selection: BillTemplateSelection): string;
/** Upgrades any resolvable template representation to its canonical JSON format. */
export declare function upgradeBillTemplateValue(rawValue: unknown): string | null;
export declare function listInstalledPrintTemplates(): InstalledPrintTemplate[];
export declare function loadInstalledPrintTemplate(templateId: string): InstalledPrintTemplate | null;
/** Checks if a template reference is available and currently active. */
export declare function isAvailableBillTemplate(value: unknown): boolean;
//# sourceMappingURL=print-templates.d.ts.map