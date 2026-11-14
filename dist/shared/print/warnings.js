"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasFinancialPrintWarning = hasFinancialPrintWarning;
exports.makeFinancialPrintRefusalMessage = makeFinancialPrintRefusalMessage;
const RASTER_FAILURE_PREFIX = 'Raster rendering failed';
function hasFinancialPrintWarning(warnings) {
    return warnings.some((warning) => warning.kind === 'financial');
}
/** Fail-closed refusal: names the row, why neither text nor image output worked, and what to try. */
function makeFinancialPrintRefusalMessage(warnings) {
    const financial = warnings.filter((warning) => warning.kind === 'financial');
    const row = financial.find((warning) => warning.text.trim().length > 0);
    const rasterFailure = financial.find((warning) => warning.message.startsWith(RASTER_FAILURE_PREFIX));
    const rowText = row ? `: ${row.text.trim().replace(/\s*\n\s*/g, ' / ')}` : '';
    const cause = rasterFailure
        ? `The printer cannot print these characters as text, and printing them as an image failed (${rasterFailure.message}).`
        : 'The printer cannot print these characters as text, and no image fallback is available on this print path.';
    return `Receipt not printed: a financial row contains unsupported printer text${rowText}. ${cause} Nothing was printed, so no amount is missing. Try again, or use system/browser printing.`;
}
//# sourceMappingURL=warnings.js.map