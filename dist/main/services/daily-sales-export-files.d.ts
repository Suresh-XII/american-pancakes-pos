import { serializeDailySalesExportHtml, type DailySalesExportDataset, type DailySalesHtmlOptions } from './daily-sales-export';
export { serializeDailySalesExportHtml, type DailySalesHtmlOptions };
export type DailySalesExportFormat = 'xlsx' | 'csv' | 'html';
export type DailySalesExportCsvPart = 'summary' | 'daily' | 'taxes' | 'items' | 'payments';
export declare const DAILY_SALES_CSV_PARTS: readonly DailySalesExportCsvPart[];
export declare function dailySalesExportFilename(period: string | {
    fromDate: string;
    toDate: string;
}, format: DailySalesExportFormat, part?: DailySalesExportCsvPart): string;
/**
 * Serializers only - no accounting math. All formats read the same dataset.
 * Values stay numeric in XLSX; CSV uses ASCII '.' decimals for stable Sheets import.
 */
export declare function serializeDailySalesExportXlsx(dataset: DailySalesExportDataset, options: {
    fractionDigits: number;
}): Promise<Buffer>;
export declare function serializeDailySalesExportCsv(dataset: DailySalesExportDataset, part: DailySalesExportCsvPart): string;
//# sourceMappingURL=daily-sales-export-files.d.ts.map