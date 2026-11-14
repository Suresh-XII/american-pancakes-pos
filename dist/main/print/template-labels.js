"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATE_LABELS_MAX_VALUE_LENGTH = exports.TEMPLATE_LABELS_MAX_ENTRIES = exports.TEMPLATE_CHARGE_ROW_IDS = exports.TEMPLATE_LABEL_IDS = void 0;
exports.sanitizeTemplateLabelText = sanitizeTemplateLabelText;
exports.fitTemplateLabel = fitTemplateLabel;
exports.validateTemplateChargeRows = validateTemplateChargeRows;
exports.declaredTemplateChargeRows = declaredTemplateChargeRows;
exports.validateTemplateLabelsMap = validateTemplateLabelsMap;
exports.resolveTemplateLabel = resolveTemplateLabel;
const print_labels_generated_1 = require("./print-labels.generated");
/** Semantic label IDs for compliance templates, mapping to concepts in the print-labels catalog. */
exports.TEMPLATE_LABEL_IDS = {
    /** Receipt title when no tax applies. */
    invoice: 'print.invoiceTitle',
    /** Receipt title when tax applies (compliance "tax invoice"). */
    taxInvoice: 'print.taxInvoiceTitle',
    subtotal: 'pos.subtotal',
    discount: 'pos.discount',
    tax: 'pos.tax',
    /** Bold grand-total row label. */
    total: 'print.grandTotal',
    /** Persisted service-charge row label. */
    serviceCharge: 'receipt.serviceCharge',
    /** Persisted delivery-charge row label. */
    deliveryCharge: 'pos.delivery',
    /** Persisted packaging-charge row label. */
    packagingCharge: 'pos.packaging',
    /** Tax-inclusive pricing note (reserved; mapped to receipt.taxIncluded). */
    taxIncluded: 'receipt.taxIncluded',
    /** Default footer message when no configured footer note applies. */
    footerThanks: 'print.thankYouShort',
};
/** Explicit charge-row capabilities in the v1 country-pack template contract. */
exports.TEMPLATE_CHARGE_ROW_IDS = ['serviceCharge', 'deliveryCharge', 'packagingCharge'];
/** Install-time caps for the `labels` map (#445): fail closed on misuse. */
exports.TEMPLATE_LABELS_MAX_ENTRIES = 64;
exports.TEMPLATE_LABELS_MAX_VALUE_LENGTH = 120;
/** Printer control grammar recognized by receipt builder; stripped from untrusted labels. */
const PRINTER_TOKEN_PATTERN = /\{[A-Z_/]+\}/g;
/** Strip reserved printer tokens from template label text. */
function sanitizeTemplateLabelText(text) {
    return String(text ?? '').replace(PRINTER_TOKEN_PATTERN, '');
}
/** Sanitize a template label and clamp it to the printable column count. */
function fitTemplateLabel(text, columns) {
    const clean = sanitizeTemplateLabelText(text);
    if (!Number.isInteger(columns) || columns < 1 || clean.length <= columns)
        return clean;
    return columns <= 3 ? clean.slice(0, columns) : clean.slice(0, columns - 2) + '..';
}
/** Validate optional totals.chargeRows capability declaration at install time. */
function validateTemplateChargeRows(rows) {
    if (rows === undefined || rows === null)
        return;
    if (!Array.isArray(rows)) {
        throw new Error('Print template totals.chargeRows must be an array of supported charge-row ids');
    }
    const seen = new Set();
    for (const row of rows) {
        if (typeof row !== 'string' || !exports.TEMPLATE_CHARGE_ROW_IDS.includes(row)) {
            throw new Error(`Unknown print template charge row "${String(row)}". Supported ids: ${exports.TEMPLATE_CHARGE_ROW_IDS.join(', ')}`);
        }
        if (seen.has(row))
            throw new Error(`Duplicate print template charge row "${row}"`);
        seen.add(row);
    }
}
/** Resolve declared rows in the contract's stable legal order. */
function declaredTemplateChargeRows(rows) {
    if (!Array.isArray(rows))
        return [];
    const declared = new Set(rows);
    return exports.TEMPLATE_CHARGE_ROW_IDS.filter((row) => declared.has(row));
}
/** Validate optional payload-root labels map of a template payload at install time. */
function validateTemplateLabelsMap(labels) {
    if (labels === undefined || labels === null)
        return;
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
        throw new Error('Print template labels must be an object mapping semantic label ids to strings');
    }
    const entries = Object.entries(labels);
    if (entries.length > exports.TEMPLATE_LABELS_MAX_ENTRIES) {
        throw new Error(`Print template labels exceed the maximum of ${exports.TEMPLATE_LABELS_MAX_ENTRIES} entries`);
    }
    for (const [key, value] of entries) {
        if (!Object.prototype.hasOwnProperty.call(exports.TEMPLATE_LABEL_IDS, key)) {
            throw new Error(`Unknown print template label id "${key}". Supported ids: ${Object.keys(exports.TEMPLATE_LABEL_IDS).join(', ')}`);
        }
        if (typeof value !== 'string' || value.length < 1 || value.length > exports.TEMPLATE_LABELS_MAX_VALUE_LENGTH) {
            throw new Error(`Print template label "${key}" must be a non-empty string of at most ${exports.TEMPLATE_LABELS_MAX_VALUE_LENGTH} characters`);
        }
    }
}
/** Resolve one template label at render time, falling back to built-in catalog. */
function resolveTemplateLabel(labels, id, lang, columns) {
    const override = labels && typeof labels === 'object' && !Array.isArray(labels)
        ? labels[id]
        : undefined;
    let resolved = typeof override === 'string' && override.length > 0
        ? sanitizeTemplateLabelText(override)
        : '';
    if (!resolved)
        resolved = (0, print_labels_generated_1.printLabel)(lang, exports.TEMPLATE_LABEL_IDS[id]);
    return columns === undefined ? resolved : fitTemplateLabel(resolved, columns);
}
//# sourceMappingURL=template-labels.js.map