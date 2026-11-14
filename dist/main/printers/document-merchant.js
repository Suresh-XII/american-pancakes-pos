"use strict";
/** Merchant template to classic thermal receipt renderer; resolves active template through PrintDocument pipeline. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMerchantReceiptViaDocument = renderMerchantReceiptViaDocument;
const merchant_print_templates_1 = require("../services/merchant-print-templates");
const print_1 = require("../../shared/print");
const print_2 = require("../../shared/print");
const document_classic_1 = require("./document-classic");
const formatting_helpers_1 = require("./formatting-helpers");
/** Render bill through merchant template; falls back to classic if invalid. */
function renderMerchantReceiptViaDocument(order, bill, business, templateId, opts) {
    const warnings = [];
    const printContext = (0, document_classic_1.buildBillPrintContext)({
        columns: opts.columns,
        language: opts.language,
        ...(opts.additionalLanguage !== undefined
            ? { additionalLanguage: opts.additionalLanguage }
            : {}),
        business,
    });
    const baseOptions = {
        columns: opts.columns,
        language: printContext.languages[0],
        locale: printContext.locale,
        ...(printContext.timezone !== undefined ? { timezone: printContext.timezone } : {}),
        currency: printContext.currency,
        currencySymbol: printContext.currencySymbol,
        trimDecimals: printContext.trimDecimals,
        useUnicode: opts.useUnicode,
        arabicShaping: opts.arabicShaping,
        cutMode: opts.cutMode,
        capabilities: opts.capabilities,
    };
    const renderDocument = (document) => {
        const rasterGroups = [];
        const financialLineRanges = [];
        const lines = (0, document_classic_1.renderBillDocumentToClassicLines)(document, {
            ...baseOptions,
            rasterGroups,
            financialLineRanges,
        });
        return { lines, rasterGroups, financialLineRanges };
    };
    const finish = (rendered, fellBackToClassic) => {
        const data = (0, formatting_helpers_1.buildEscPos)(rendered.lines, opts.useUnicode, {
            cutMode: opts.cutMode,
            arabicShaping: opts.arabicShaping,
            columns: opts.columns,
            language: opts.language,
            capabilities: opts.capabilities,
            financialLineRanges: rendered.financialLineRanges,
        }, warnings);
        return {
            data,
            lines: rendered.lines,
            warnings,
            fellBackToClassic,
            rasterGroups: rendered.rasterGroups,
        };
    };
    const row = (0, merchant_print_templates_1.loadActiveMerchantPrintTemplate)(templateId);
    if (!row) {
        warnings.push({
            field: 'bill_template',
            text: templateId,
            message: `Merchant template ${templateId} is not active; rendered with the classic layout.`,
        });
        return finish(renderDocument((0, print_2.buildBillDocument)((0, document_classic_1.buildBillPrintData)(order, bill, business, opts.isReprint), printContext)), true);
    }
    let parsed;
    try {
        parsed = JSON.parse(row.payload_json);
    }
    catch {
        parsed = null;
    }
    const validation = (0, print_1.validateMerchantTemplate)(parsed);
    const printData = (0, document_classic_1.buildBillPrintData)(order, bill, business, opts.isReprint);
    if (!validation.ok) {
        // Fail closed: unknown future schema or corrupt payload must never reach
        // a renderer. Warn loudly and fall back to the unmodified classic doc.
        warnings.push({
            field: 'bill_template',
            text: templateId,
            message: `Merchant template ${templateId} failed validation (${validation.errors[0]}); rendered with the classic layout.`,
        });
        return finish(renderDocument((0, print_2.buildBillDocument)(printData, printContext)), true);
    }
    const document = (0, print_2.applyMerchantTemplate)((0, print_2.buildBillDocument)(printData, printContext), validation.payload);
    return finish(renderDocument(document), false);
}
//# sourceMappingURL=document-merchant.js.map