import { type LocalePreferences } from '../countries';
export interface CashClosePaymentExportRow {
    method: string;
    count: number;
    total: number;
}
export interface CashCloseStaffExportRow {
    name: string;
    role: string;
    orderCount: number;
    revenue: number;
}
export interface CashCloseTaxComponentExportRow {
    title: string;
    rate: number | null;
    amount: number;
}
interface CashCloseExportBase {
    businessDate: string;
    periodStart: string;
    periodEnd: string;
    grossSales: number;
    refunds: number;
    netCollections: number;
    billCount: number;
    expectedCash: number;
    openingFloat: number;
    payIn: number;
    payOut: number;
    safeDrops: number;
    paymentMethods: CashClosePaymentExportRow[];
    staffSales: CashCloseStaffExportRow[];
    taxComponents?: CashCloseTaxComponentExportRow[];
}
export interface CashCloseShiftExportMeta {
    id: number;
    openedByName: string;
}
export interface XReportExport extends CashCloseExportBase {
    session?: CashCloseShiftExportMeta | null;
}
export interface ZReportExport extends CashCloseExportBase {
    zNumber: number;
    closedAt: string;
    closedBy: string;
    notes: string | null;
    countedCash: number;
    cashVariance: number;
}
export interface CashCloseHtmlOptions {
    businessName?: string;
    currency?: string;
    locale?: string;
    timezone?: string;
    preferences?: LocalePreferences;
}
export declare function serializeXReportCsv(report: XReportExport): string;
export declare function serializeZReportCsv(report: ZReportExport): string;
export declare function serializeXReportXlsx(report: XReportExport): Promise<Buffer>;
export declare function serializeZReportXlsx(report: ZReportExport): Promise<Buffer>;
export declare function serializeXReportHtml(report: XReportExport, options?: CashCloseHtmlOptions): string;
export declare function serializeZReportHtml(report: ZReportExport, options?: CashCloseHtmlOptions): string;
export {};
//# sourceMappingURL=cash-close-export.d.ts.map