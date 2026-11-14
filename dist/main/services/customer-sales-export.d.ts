import type { Database } from 'better-sqlite3';
export declare const CUSTOMER_SALES_MAX_RANGE_DAYS = 366;
export declare const CUSTOMER_SALES_COLUMNS: readonly ["business_date", "paid_at", "bill_number", "order_number", "order_type", "customer_name", "customer_country_code", "customer_phone", "customer_email", "product_name", "product_sku", "quantity", "gross_item_sales", "item_discounts", "net_item_sales", "tax_amount", "payment_methods", "bill_total"];
export type CustomerSalesRow = {
    business_date: string;
    paid_at: string;
    bill_number: string;
    order_number: string;
    order_type: string;
    customer_name: string;
    customer_country_code: string;
    customer_phone: string;
    customer_email: string;
    product_name: string;
    product_sku: string;
    quantity: number;
    gross_item_sales: number;
    item_discounts: number;
    net_item_sales: number;
    tax_amount: number;
    payment_methods: string;
    /** Set on the first item row of each bill only, so a column SUM equals bill totals. */
    bill_total: number | null;
};
export type CustomerSalesDataset = {
    start_date: string;
    end_date: string;
    currency: string;
    rows: CustomerSalesRow[];
};
export declare class CustomerSalesRangeError extends Error {
}
/**
 * One row per item sold on bills paid in [startDate, endDate] (tenant business days), with the
 * bill's customer repeated on every row. Item inclusion and split-bill apportioning match the
 * daily sales export Items query.
 */
export declare function buildCustomerSalesDataset(startDate: string, endDate: string, db?: Database): CustomerSalesDataset;
export type CustomerSalesExportFormat = 'xlsx' | 'csv';
export declare function customerSalesExportFilename(startDate: string, endDate: string, format: CustomerSalesExportFormat): string;
export declare function serializeCustomerSalesXlsx(dataset: CustomerSalesDataset): Promise<Buffer>;
export declare function serializeCustomerSalesCsv(dataset: CustomerSalesDataset): string;
//# sourceMappingURL=customer-sales-export.d.ts.map