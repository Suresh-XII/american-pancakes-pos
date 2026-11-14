"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRINTER_TEXT_SIZES = void 0;
exports.normalizePrinterTextSize = normalizePrinterTextSize;
exports.layoutColumnsForTextSize = layoutColumnsForTextSize;
exports.physicalColumnsForTextSize = physicalColumnsForTextSize;
exports.applyTextSizeToLine = applyTextSizeToLine;
exports.applyTextSizeToLines = applyTextSizeToLines;
exports.PRINTER_TEXT_SIZES = ['normal', 'large', 'extra_large'];
function normalizePrinterTextSize(value) {
    return value === 'large' || value === 'extra_large' ? value : 'normal';
}
/** Characters per line available to layout code once the printer text size is applied. */
function layoutColumnsForTextSize(columns, textSize) {
    return textSize === 'extra_large' ? Math.max(1, Math.floor(columns / 2)) : columns;
}
/** Characters per physical line for a layout width produced by layoutColumnsForTextSize. */
function physicalColumnsForTextSize(layoutColumns, textSize) {
    return textSize === 'extra_large' ? layoutColumns * 2 : layoutColumns;
}
const LEADING_LINE_TOKENS_RE = /^(?:\{(?:STORE_NAME|FINANCIAL|CENTER)\})*/;
const FONT_B_TOKEN_RE = /\{\/?FONT_B\}/g;
const ANY_TOKEN_RE = /\{\/?(?:CENTER|BOLD|DOUBLE_HEIGHT|DOUBLE_WIDTH|FONT_B)\}|\{(?:CUT|FEED|INIT|STORE_NAME|FINANCIAL)\}/g;
/**
 * Enlarges one text line: large doubles the height, extra large also doubles the width
 * (layout columns are halved separately). Idempotent; control, raw and blank lines pass through.
 */
function applyTextSizeToLine(line, textSize) {
    if (textSize === 'normal')
        return line;
    if (line.startsWith('{RAW_BYTES:'))
        return line;
    if (line.replace(ANY_TOKEN_RE, '').trim() === '')
        return line;
    const body = line.replace(FONT_B_TOKEN_RE, '');
    const prefix = LEADING_LINE_TOKENS_RE.exec(body)?.[0] ?? '';
    const rest = body.slice(prefix.length);
    const wantWidth = textSize === 'extra_large';
    const open = (rest.includes('{DOUBLE_HEIGHT}') ? '' : '{DOUBLE_HEIGHT}') +
        (wantWidth && !rest.includes('{DOUBLE_WIDTH}') ? '{DOUBLE_WIDTH}' : '');
    const close = (open.includes('{DOUBLE_WIDTH}') ? '{/DOUBLE_WIDTH}' : '') +
        (open.includes('{DOUBLE_HEIGHT}') ? '{/DOUBLE_HEIGHT}' : '');
    return prefix + open + rest + close;
}
function applyTextSizeToLines(lines, textSize) {
    return textSize === 'normal' ? lines : lines.map((line) => applyTextSizeToLine(line, textSize));
}
//# sourceMappingURL=text-size.js.map