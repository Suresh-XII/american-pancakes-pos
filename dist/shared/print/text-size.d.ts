export type PrinterTextSize = 'normal' | 'large' | 'extra_large';
export declare const PRINTER_TEXT_SIZES: readonly PrinterTextSize[];
export declare function normalizePrinterTextSize(value: unknown): PrinterTextSize;
/** Characters per line available to layout code once the printer text size is applied. */
export declare function layoutColumnsForTextSize(columns: number, textSize: PrinterTextSize): number;
/** Characters per physical line for a layout width produced by layoutColumnsForTextSize. */
export declare function physicalColumnsForTextSize(layoutColumns: number, textSize: PrinterTextSize): number;
/**
 * Enlarges one text line: large doubles the height, extra large also doubles the width
 * (layout columns are halved separately). Idempotent; control, raw and blank lines pass through.
 */
export declare function applyTextSizeToLine(line: string, textSize: PrinterTextSize): string;
export declare function applyTextSizeToLines(lines: string[], textSize: PrinterTextSize): string[];
//# sourceMappingURL=text-size.d.ts.map