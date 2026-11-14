"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerSalesRangeError = exports.CUSTOMER_SALES_COLUMNS = exports.CUSTOMER_SALES_MAX_RANGE_DAYS = void 0;
exports.buildCustomerSalesDataset = buildCustomerSalesDataset;
exports.customerSalesExportFilename = customerSalesExportFilename;
exports.serializeCustomerSalesXlsx = serializeCustomerSalesXlsx;
exports.serializeCustomerSalesCsv = serializeCustomerSalesCsv;
const exceljs_1 = __importDefault(require("exceljs"));
const csv_1 = require("../lib/csv");
const db_1 = require("../db");
const countries_1 = require("../countries");
const refund_1 = require("./refund");
const daily_sales_export_1 = require("./daily-sales-export");
const sandbox_exclusion_1 = require("./sandbox-exclusion");
exports.CUSTOMER_SALES_MAX_RANGE_DAYS = 366;
exports.CUSTOMER_SALES_COLUMNS = [
    'business_date',
    'paid_at',
    'bill_number',
    'order_number',
    'order_type',
    'customer_name',
    'customer_country_code',
    'customer_phone',
    'customer_email',
    'product_name',
    'product_sku',
    'quantity',
    'gross_item_sales',
    'item_discounts',
    'net_item_sales',
    'tax_amount',
    'payment_methods',
    'bill_total',
];
class CustomerSalesRangeError extends Error {
}
exports.CustomerSalesRangeError = CustomerSalesRangeError;
function dayCount(startDate, endDate) {
    const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
    return Math.floor(ms / 86_400_000) + 1;
}
// `sv-SE` formats as `YYYY-MM-DD HH:MM:SS`, matching the stored timestamp shape.
function storeLocalTimestamp(stored, timezone) {
    const instant = (0, db_1.parseDbTimestamp)(stored);
    if (Number.isNaN(instant.getTime()))
        return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(instant);
}
function paymentMethodNames(paymentDetails, namesById) {
    if (typeof paymentDetails !== 'string' || !paymentDetails)
        return '';
    let parsed;
    try {
        parsed = JSON.parse(paymentDetails);
    }
    catch {
        return '';
    }
    const lines = Array.isArray(parsed) ? parsed : [parsed];
    const names = [];
    for (const line of lines) {
        if (!line || typeof line !== 'object')
            continue;
        const entry = line;
        const byId = namesById.get(Number(entry.payment_method_id));
        const name = byId || (typeof entry.method === 'string' ? entry.method : '');
        if (name && !names.includes(name))
            names.push(name);
    }
    return names.join('; ');
}
/**
 * One row per item sold on bills paid in [startDate, endDate] (tenant business days), with the
 * bill's customer repeated on every row. Item inclusion and split-bill apportioning match the
 * daily sales export Items query.
 */
function buildCustomerSalesDataset(startDate, endDate, db = (0, db_1.getDatabase)()) {
    if (startDate > endDate) {
        throw new CustomerSalesRangeError('start_date must not be after end_date');
    }
    if (dayCount(startDate, endDate) > exports.CUSTOMER_SALES_MAX_RANGE_DAYS) {
        throw new CustomerSalesRangeError(`Date range must not exceed ${exports.CUSTOMER_SALES_MAX_RANGE_DAYS} days`);
    }
    const timezone = (0, daily_sales_export_1.resolveExportTimezone)();
    const businessDayStart = (0, db_1.tenantBusinessDayStartTime)(db);
    const [start] = (0, db_1.dayBoundsInTimezone)(startDate, timezone, businessDayStart);
    const [, end] = (0, db_1.dayBoundsInTimezone)(endDate, timezone, businessDayStart);
    const currency = (0, refund_1.getTenantCurrency)(db);
    const methodNames = new Map();
    for (const pm of db.prepare('SELECT id, name FROM payment_methods').all()) {
        methodNames.set(Number(pm.id), String(pm.name));
    }
    const lineRows = db
        .prepare(`
    SELECT
      b.id AS bill_id,
      b.bill_number AS bill_number,
      b.paid_at AS paid_at,
      b.total AS bill_total,
      b.payment_details AS payment_details,
      o.order_number AS order_number,
      o.type AS order_type,
      c.name AS customer_name,
      c.country_code AS customer_country_code,
      c.phone AS customer_phone,
      c.email AS customer_email,
      oi.product_name AS product_name,
      oi.product_sku AS product_sku,
      CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
           THEN oi.quantity ELSE bi.quantity END AS quantity,
      CASE
           WHEN json_extract(oi.modifier_selection, '$.is_bogo_free') = 1
             OR json_extract(oi.modifier_selection, '$.is_bogo_free') = true
             OR oi.product_name LIKE '%(BOGO Free)%'
             OR (oi.discount_amount >= oi.subtotal AND oi.subtotal > 0 AND COALESCE(oi.total, 0) = 0)
           THEN (CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
                      THEN oi.subtotal
                      ELSE oi.subtotal * bi.quantity / NULLIF(oi.quantity, 0) END)
           ELSE (CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
                      THEN oi.subtotal + COALESCE(oi.discount_amount, 0)
                      ELSE (oi.subtotal + COALESCE(oi.discount_amount, 0)) * bi.quantity / NULLIF(oi.quantity, 0) END)
      END AS gross_item_sales,
      CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
           THEN COALESCE(oi.discount_amount, 0)
           ELSE COALESCE(oi.discount_amount, 0) * bi.quantity / NULLIF(oi.quantity, 0)
      END AS item_discounts,
      CASE
           WHEN json_extract(oi.modifier_selection, '$.is_bogo_free') = 1
             OR json_extract(oi.modifier_selection, '$.is_bogo_free') = true
             OR oi.product_name LIKE '%(BOGO Free)%'
             OR (oi.discount_amount >= oi.subtotal AND oi.subtotal > 0 AND COALESCE(oi.total, 0) = 0)
           THEN 0
           ELSE (CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
                      THEN oi.subtotal
                      ELSE oi.subtotal * bi.quantity / NULLIF(oi.quantity, 0) END)
      END AS net_item_sales,
      CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
           THEN COALESCE(oi.tax_amount, 0)
           ELSE COALESCE(oi.tax_amount, 0) * bi.quantity / NULLIF(oi.quantity, 0)
      END AS tax_amount
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN bill_items bi ON bi.bill_id = b.id AND bi.order_item_id = oi.id
    LEFT JOIN customers c ON c.id = COALESCE(NULLIF(b.customer_id, ''), NULLIF(o.customer_id, ''))
    WHERE b.paid_at >= ? AND b.paid_at < ?
      AND (oi.status IS NULL OR oi.status NOT IN ('cancelled', 'voided', 'void_adjustment'))
      AND (b.split_group_id IS NULL OR b.split_group_id = '' OR bi.bill_id IS NOT NULL)
      AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
    ORDER BY b.paid_at, b.id, oi.id
  `)
        .all(start, end);
    const methodsByBill = new Map();
    const seenBills = new Set();
    const rows = lineRows.map((row) => {
        const firstOfBill = !seenBills.has(row.bill_id);
        seenBills.add(row.bill_id);
        if (firstOfBill) {
            methodsByBill.set(row.bill_id, paymentMethodNames(row.payment_details, methodNames));
        }
        return {
            business_date: (0, db_1.localDateInTimezone)((0, db_1.parseDbTimestamp)(row.paid_at), timezone, businessDayStart),
            paid_at: storeLocalTimestamp(row.paid_at, timezone),
            bill_number: String(row.bill_number),
            order_number: String(row.order_number ?? ''),
            order_type: String(row.order_type ?? ''),
            customer_name: row.customer_name ?? '',
            customer_country_code: String(row.customer_country_code ?? '').replace(/^\+/, ''),
            customer_phone: row.customer_phone ?? '',
            customer_email: row.customer_email ?? '',
            product_name: String(row.product_name),
            product_sku: row.product_sku ?? '',
            quantity: Number(row.quantity || 0),
            gross_item_sales: Number(row.gross_item_sales || 0),
            item_discounts: Number(row.item_discounts || 0),
            net_item_sales: Number(row.net_item_sales || 0),
            tax_amount: Number(row.tax_amount || 0),
            payment_methods: methodsByBill.get(row.bill_id) ?? '',
            bill_total: firstOfBill ? Number(row.bill_total || 0) : null,
        };
    });
    return { start_date: startDate, end_date: endDate, currency, rows };
}
function customerSalesExportFilename(startDate, endDate, format) {
    const span = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
    return `customer-sales-${span}.${format}`;
}
const MONEY_COLUMNS = new Set([
    'gross_item_sales',
    'item_discounts',
    'net_item_sales',
    'tax_amount',
    'bill_total',
]);
async function serializeCustomerSalesXlsx(dataset) {
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(dataset.currency);
    const moneyFmt = fractionDigits > 0 ? `#,##0.${'0'.repeat(fractionDigits)}` : '#,##0';
    const workbook = new exceljs_1.default.Workbook();
    const sheet = workbook.addWorksheet('Customer sales');
    sheet.columns = exports.CUSTOMER_SALES_COLUMNS.map((key) => ({
        header: key,
        key,
        width: key.includes('name') || key === 'payment_methods' ? 28 : 16,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: exports.CUSTOMER_SALES_COLUMNS.length },
    };
    for (const row of dataset.rows) {
        const entry = sheet.addRow({ ...row, bill_total: row.bill_total ?? '' });
        entry.getCell('quantity').numFmt = '#,##0.###';
        for (const key of MONEY_COLUMNS) {
            if (typeof entry.getCell(key).value === 'number')
                entry.getCell(key).numFmt = moneyFmt;
        }
        // Phone and SKU are identifiers; keep them as text so Excel does not drop leading zeros.
        entry.getCell('customer_phone').numFmt = '@';
        entry.getCell('customer_country_code').numFmt = '@';
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
function serializeCustomerSalesCsv(dataset) {
    const lines = [(0, csv_1.toCsvRow)([...exports.CUSTOMER_SALES_COLUMNS])];
    for (const row of dataset.rows) {
        lines.push((0, csv_1.toCsvRow)(exports.CUSTOMER_SALES_COLUMNS.map((column) => row[column])));
    }
    return lines.join('\n') + '\n';
}
//# sourceMappingURL=customer-sales-export.js.map