/** Canonical configured thermal layout widths shared by every renderer. */
export type PrintPaperWidth = '58mm' | '58mm-36' | '80mm-42' | '80mm' | `cols-${32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48}`;
export type ReceiptPaperSize = 58 | 80;
/** Keep script clusters together when the runtime supports Unicode segmentation. */
export declare function graphemeSegments(text: string): string[];
/** Measure text in monospaced thermal-printer display cells. */
export declare function displayCellWidth(text: string): number;
/** Pad text to a display-cell budget without splitting grapheme clusters. */
export declare function padToDisplayCells(text: string, columns: number, alignment?: 'left' | 'right' | 'center'): string;
/** Keep complete grapheme clusters that fit in a thermal display-cell budget. */
export declare function truncateToDisplayCells(text: string, columns: number): string;
/** Keep the suffix that fits in a thermal display-cell budget. */
export declare function truncateToDisplayCellsFromEnd(text: string, columns: number): string;
/** Wrap whitespace-delimited text without exceeding a thermal display-cell budget. */
export declare function wrapToDisplayCells(text: string, columns: number): string[];
/**
 * Resolve the configured logical columns used by browser/WebUSB receipt settings.
 *
 * 80 mm resolves to 42, the exact Font A capacity of a 512-dot (180 dpi) head, so
 * this equals `generic-escpos-80.fontAColumns` and `epson-tm-series` keeps its
 * 48 for 576-dot heads. This is the single source both render paths fall back to;
 * nothing else should restate the number.
 */
export declare function columnsForReceiptPaperSize(paperWidth: ReceiptPaperSize): number;
/** Resolve configured text columns independently of physical printer capability. */
export declare function columnsForPaperWidth(paperWidth: string | null | undefined): number | null;
/**
 * Resolve the columns one print path should render at: the exact count the
 * merchant configured for the printer row, when it names one, otherwise the
 * paper-size default. Every render path on a given printer goes through this,
 * so the receipt, the KOT, the tax bill, the raster document, and the browser
 * page cannot resolve to different numbers for the same printer.
 */
export declare function columnsForConfiguredPrinter(configuredPaperWidth: string | null | undefined, paperWidth: ReceiptPaperSize): number;
/** Keep a native ESC/POS text line inside its logical character budget. */
export declare function fitThermalLine(text: string, columns: number, doubleWidth?: boolean): string;
//# sourceMappingURL=width.d.ts.map