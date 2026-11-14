"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.layoutStyledUnit = layoutStyledUnit;
exports.thermalDisplayWidth = thermalDisplayWidth;
const bilingual_1 = require("./bilingual");
const width_1 = require("./width");
function displayWidth(text) {
    return (0, width_1.displayCellWidth)(text);
}
function warningFor(unit, message) {
    return {
        field: unit.field,
        text: unit.text ?? unit.label?.primary ?? '',
        message,
        kind: unit.financial ? 'financial' : 'line',
    };
}
/**
 * Lay out one complete semantic unit before ESC/POS encoding. A style is
 * downgraded before text is wrapped, and text is never sliced to make a style
 * fit. This is intentionally pure so every transport can use the same rule.
 */
function layoutStyledUnit(unit, context) {
    const columns = Math.max(1, Math.floor(context.logicalColumns));
    const requestedMultiplier = unit.widthMultiplier ?? 1;
    const styleColumns = requestedMultiplier === 2 ? Math.max(1, Math.floor(columns / 2)) : columns;
    const label = unit.label ?? { primary: unit.text ?? '' };
    const bilingualStrategy = (0, bilingual_1.selectBilingualFit)(label, styleColumns);
    const variants = (0, bilingual_1.bilingualLabelLines)(label, bilingualStrategy);
    const warnings = [];
    let multiplier = requestedMultiplier;
    let available = styleColumns;
    const longestVariant = Math.max(0, ...variants.map(displayWidth));
    if (requestedMultiplier === 2 && longestVariant > styleColumns && longestVariant <= columns) {
        multiplier = 1;
        available = columns;
        warnings.push(warningFor(unit, 'Double-width style was downgraded so the complete text remains printable.'));
    }
    else if (requestedMultiplier === 2 && longestVariant > styleColumns) {
        multiplier = 1;
        available = columns;
        warnings.push(warningFor(unit, 'Double-width style was downgraded and the complete text was wrapped.'));
    }
    const lines = variants.flatMap((variant) => (0, width_1.wrapToDisplayCells)(variant, available));
    if (lines.length > variants.length) {
        warnings.push(warningFor(unit, 'Text was wrapped to the printer width without truncation.'));
    }
    return Object.freeze({ lines: Object.freeze(lines), widthMultiplier: multiplier, warnings: Object.freeze(warnings) });
}
/** Width-only invariant used by the ESC/POS safety layer after semantic layout. */
function thermalDisplayWidth(text) {
    return displayWidth(String(text));
}
//# sourceMappingURL=layout.js.map