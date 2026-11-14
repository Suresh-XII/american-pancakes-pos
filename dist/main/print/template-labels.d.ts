/** Semantic label IDs for compliance templates, mapping to concepts in the print-labels catalog. */
export declare const TEMPLATE_LABEL_IDS: {
    /** Receipt title when no tax applies. */
    readonly invoice: "print.invoiceTitle";
    /** Receipt title when tax applies (compliance "tax invoice"). */
    readonly taxInvoice: "print.taxInvoiceTitle";
    readonly subtotal: "pos.subtotal";
    readonly discount: "pos.discount";
    readonly tax: "pos.tax";
    /** Bold grand-total row label. */
    readonly total: "print.grandTotal";
    /** Persisted service-charge row label. */
    readonly serviceCharge: "receipt.serviceCharge";
    /** Persisted delivery-charge row label. */
    readonly deliveryCharge: "pos.delivery";
    /** Persisted packaging-charge row label. */
    readonly packagingCharge: "pos.packaging";
    /** Tax-inclusive pricing note (reserved; mapped to receipt.taxIncluded). */
    readonly taxIncluded: "receipt.taxIncluded";
    /** Default footer message when no configured footer note applies. */
    readonly footerThanks: "print.thankYouShort";
};
export type TemplateLabelId = keyof typeof TEMPLATE_LABEL_IDS;
/** Explicit charge-row capabilities in the v1 country-pack template contract. */
export declare const TEMPLATE_CHARGE_ROW_IDS: readonly ["serviceCharge", "deliveryCharge", "packagingCharge"];
export type TemplateChargeRowId = typeof TEMPLATE_CHARGE_ROW_IDS[number];
/** Install-time caps for the `labels` map (#445): fail closed on misuse. */
export declare const TEMPLATE_LABELS_MAX_ENTRIES = 64;
export declare const TEMPLATE_LABELS_MAX_VALUE_LENGTH = 120;
/** Strip reserved printer tokens from template label text. */
export declare function sanitizeTemplateLabelText(text: string): string;
/** Sanitize a template label and clamp it to the printable column count. */
export declare function fitTemplateLabel(text: string, columns: number): string;
/** Validate optional totals.chargeRows capability declaration at install time. */
export declare function validateTemplateChargeRows(rows: unknown): void;
/** Resolve declared rows in the contract's stable legal order. */
export declare function declaredTemplateChargeRows(rows: unknown): TemplateChargeRowId[];
/** Validate optional payload-root labels map of a template payload at install time. */
export declare function validateTemplateLabelsMap(labels: unknown): void;
/** Resolve one template label at render time, falling back to built-in catalog. */
export declare function resolveTemplateLabel(labels: unknown, id: TemplateLabelId, lang: string, columns?: number): string;
//# sourceMappingURL=template-labels.d.ts.map