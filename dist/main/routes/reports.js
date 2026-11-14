"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportRoutes = void 0;
const express_1 = require("express");
const cloud_sync_1 = require("../services/cloud-sync");
const operation_failure_1 = require("../lib/operation-failure");
const decimal_js_1 = __importDefault(require("decimal.js"));
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const shutdown_1 = require("../shutdown");
const whatsapp = __importStar(require("../services/whatsapp"));
const phone_1 = require("../lib/phone");
const bills_1 = require("./bills");
const item_price_override_1 = require("../services/item-price-override");
const tax_components_1 = require("../services/tax-components");
const refund_1 = require("../services/refund");
const countries_1 = require("../countries");
const cash_day_close_guards_1 = require("../services/cash-day-close-guards");
const cash_closures_1 = require("./cash-closures");
const countries_2 = require("../countries");
const supplies_1 = require("../services/supplies");
const profitability_1 = require("../services/profitability");
const daily_sales_export_1 = require("../services/daily-sales-export");
const daily_sales_export_files_1 = require("../services/daily-sales-export-files");
const daily_invoices_export_1 = require("../services/daily-invoices-export");
const customer_sales_export_1 = require("../services/customer-sales-export");
const cash_close_export_1 = require("../services/cash-close-export");
const expenses_1 = require("../services/expenses");
const sandbox_exclusion_1 = require("../services/sandbox-exclusion");
const router = (0, express_1.Router)();
function captureFinancialSummaryDateRangeRejection() {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.reports.financial_summary.date_range',
        outcome: 'not_applied',
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change report validation responses.
    }
}
function captureReportsDateRangeRejection(validationCode) {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.reports.date_range.invalid',
        outcome: 'not_applied',
        facts: { validation_code: validationCode },
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change report validation responses.
    }
}
const WEEKDAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
];
// Mirrors main/routes/tables.ts's ACTIVE_ORDER_STATUS_SQL — an order still
// "occupying" its table until it's completed or cancelled.
const ACTIVE_ORDER_STATUS_SQL = "o.status NOT IN ('completed', 'cancelled')";
// Resolves through the country profile when the stored timezone is missing
// or invalid, matching resolveRegionalSnapshot's own contract, instead of
// letting bucketByLocalHourAndWeekday()/dayBoundsInTimezone() silently fall
// back to UTC — reporting a tenant-local day or hour bucket in the wrong
// zone produces incorrect report data. Only throws RegionalNotConfiguredError
// when the country itself is unresolvable.
function tenantTimezone() {
    return (0, countries_1.resolveRegionalSnapshot)({
        country: (0, db_1.getSettingValue)('country') ?? undefined,
        currency: (0, db_1.getSettingValue)('currency') ?? undefined,
        timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
    }).timezone;
}
function tenantStartTime() {
    return (0, db_1.tenantBusinessDayStartTime)();
}
function reportToday() {
    return (0, db_1.localDateInTimezone)(new Date(), tenantTimezone(), tenantStartTime());
}
function reportDayBounds(date) {
    return (0, db_1.dayBoundsInTimezone)(date, tenantTimezone(), tenantStartTime());
}
function reportDate(value, fallback) {
    return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        (0, daily_sales_export_1.parseValidBusinessDate)(value) !== null
        ? value
        : fallback;
}
/**
 * Buckets order timestamps into local hour-of-day (0-23) and local
 * day-of-week (0=Sunday..6=Saturday), using the tenant's configured
 * timezone rather than server/UTC time — otherwise "busiest hour" would
 * reflect UTC, not when the restaurant is actually busy. SQLite has no
 * IANA timezone support (only fixed offsets), so this bucketing happens
 * in JS via Intl instead of in SQL.
 */
function bucketByLocalHourAndWeekday(timestamps, timeZone, startTime) {
    const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    const hourCounts = new Array(24).fill(0);
    const dayCounts = new Array(7).fill(0);
    for (const ts of timestamps) {
        const d = (0, db_1.parseDbTimestamp)(ts);
        if (isNaN(d.getTime()))
            continue;
        const hour = parseInt(hourFmt.format(d), 10);
        if (hour >= 0 && hour <= 23)
            hourCounts[hour]++;
        const businessDate = (0, db_1.localDateInTimezone)(d, timeZone, startTime);
        const dayIdx = new Date(`${businessDate}T12:00:00Z`).getUTCDay();
        if (dayIdx >= 0 && dayIdx < 7)
            dayCounts[dayIdx]++;
    }
    return { hourCounts, dayCounts };
}
/** argmax/argmin over counts, restricted to indices where include(count) is true. Returns null if nothing qualifies. */
function pickExtreme(counts, mode, include) {
    let best = null;
    counts.forEach((count, index) => {
        if (!include(count))
            return;
        if (!best || (mode === 'max' ? count > best.count : count < best.count)) {
            best = { index, count };
        }
    });
    return best;
}
router.get('/daily-stats', (0, authorization_1.requireAnyPermission)('reports.view', 'dashboard.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
        const today = reportToday();
        const [start, end] = reportDayBounds(today);
        const salesToday = db
            .prepare(`
      SELECT
        COALESCE((SELECT SUM(paid_amount) FROM bills WHERE paid_at >= ? AND paid_at < ?
          AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('bills.order_id')}), 0)
        - COALESCE((SELECT SUM(CAST(amount_cents AS REAL)) / ? FROM refunds WHERE created_at >= ? AND created_at < ?
          AND ${(0, sandbox_exclusion_1.refundSandboxExclusionSql)('refunds.bill_id')}), 0) AS sales
    `)
            .get(start, end, minorFactor, start, end);
        const paymentMethodsToday = (0, cash_closures_1.paymentMethodBreakdown)(db, { startDate: today });
        const runningOrders = db
            .prepare(`
      SELECT COUNT(*) as count FROM orders
      WHERE release_status = 'released' AND status IN ('pending', 'preparing')
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}
    `)
            .get();
        const pendingOrders = db
            .prepare(`
      SELECT COUNT(*) as count FROM orders
      WHERE release_status = 'released' AND status = 'pending'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}
    `)
            .get();
        const tablesOccupied = db
            .prepare(`
      SELECT COUNT(*) as count FROM tables WHERE status = 'occupied'
    `)
            .get();
        // Avg Table Turn: how long dine-in tables took to turn over today, for
        // orders that finished today (mirrors /insights' avgPrepTimeMinutes idiom).
        const tableTurn = db
            .prepare(`
      SELECT AVG((julianday(completed_at) - julianday(created_at)) * 24 * 60) as avgMinutes,
        COUNT(*) as sampleSize
      FROM orders
      WHERE type = 'dine_in' AND status = 'completed' AND completed_at IS NOT NULL
        AND completed_at >= ? AND completed_at < ?
    `)
            .get(start, end);
        // Avg Current Occupancy: how long tables occupied right now have been seated.
        const currentOccupancy = db
            .prepare(`
      SELECT AVG((julianday('now') - julianday(o.created_at)) * 24 * 60) as avgMinutes,
        COUNT(*) as sampleSize
      FROM tables t
      JOIN orders o ON o.table_id = t.id AND ${ACTIVE_ORDER_STATUS_SQL}
      WHERE t.status = 'occupied'
    `)
            .get();
        res.json({
            sales: salesToday.sales,
            runningOrders: runningOrders.count,
            pendingOrders: pendingOrders.count,
            tablesOccupied: tablesOccupied.count,
            avgTableTurnMinutes: tableTurn.sampleSize > 0 && tableTurn.avgMinutes !== null
                ? Math.round(tableTurn.avgMinutes)
                : null,
            avgCurrentOccupancyMinutes: currentOccupancy.sampleSize > 0 && currentOccupancy.avgMinutes !== null
                ? Math.round(currentOccupancy.avgMinutes)
                : null,
            paymentMethods: paymentMethodsToday,
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
router.get('/summary', (0, authorization_1.requireAnyPermission)('reports.view', 'dashboard.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
        // #208: an explicit date param is a tenant-local `YYYY-MM-DD`; resolve
        // it to the corresponding half-open UTC range. `reportDate` validates the param shape.
        const date = reportDate(req.query.date, reportToday());
        const [start, end] = reportDayBounds(date);
        const ordersToday = db
            .prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM orders WHERE created_at >= ? AND created_at < ? AND status != 'cancelled'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}
    `)
            .get(start, end);
        const billsToday = db
            .prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(b.total), 0) as total,
        COALESCE((
          SELECT SUM(b2.paid_amount)
          FROM bills b2
          JOIN orders o2 ON o2.id = b2.order_id
          WHERE b2.paid_at >= ? AND b2.paid_at < ? AND o2.status != 'cancelled'
            AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o2.id')}
        ), 0)
        - COALESCE((
          SELECT SUM(CAST(r.amount_cents AS REAL)) / ?
          FROM refunds r
          JOIN bills b3 ON b3.id = r.bill_id
          JOIN orders o3 ON o3.id = b3.order_id
          WHERE r.created_at >= ? AND r.created_at < ? AND o3.status != 'cancelled'
            AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o3.id')}
        ), 0) as collected
      FROM bills b
      JOIN orders o ON o.id = b.order_id
      WHERE b.created_at >= ? AND b.created_at < ? AND o.status != 'cancelled'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
    `)
            .get(start, end, minorFactor, start, end, start, end);
        const paymentMethodsToday = (0, cash_closures_1.paymentMethodBreakdown)(db, {
            startDate: date,
            excludeCancelledOrders: true,
        });
        const customersToday = db
            .prepare(`
      SELECT COUNT(*) as count FROM customers WHERE created_at >= ? AND created_at < ?
    `)
            .get(start, end);
        const ordersByStatus = db
            .prepare(`
      SELECT status, COUNT(*) as count FROM orders
      WHERE created_at >= ? AND created_at < ?
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}
      GROUP BY status
    `)
            .all(start, end);
        res.json({
            summary: {
                date,
                orders: { count: ordersToday.count, total: ordersToday.total },
                bills: {
                    count: billsToday.count,
                    total: billsToday.total,
                    collected: billsToday.collected,
                },
                customers: { new: customersToday.count },
                ordersByStatus,
                paymentMethods: paymentMethodsToday,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
router.get('/financial-summary', (0, authorization_1.requirePermission)('reports.financial.view'), (req, res) => {
    try {
        const today = reportToday();
        const startDate = reportDate(req.query.start_date, today);
        const endDate = reportDate(req.query.end_date, startDate);
        if ((req.query.start_date !== undefined && reportDate(req.query.start_date, '') === '') ||
            (req.query.end_date !== undefined && reportDate(req.query.end_date, '') === '')) {
            captureFinancialSummaryDateRangeRejection();
            return res
                .status(400)
                .json({ error: 'start_date and end_date must use YYYY-MM-DD format' });
        }
        if (startDate > endDate) {
            captureFinancialSummaryDateRangeRejection();
            return res.status(400).json({ error: 'start_date must be on or before end_date' });
        }
        const [start] = reportDayBounds(startDate);
        const [, end] = reportDayBounds(endDate);
        const db = (0, db_1.getDatabase)();
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
        const collections = db
            .prepare(`
      SELECT COUNT(*) AS bill_count, COALESCE(SUM(paid_amount), 0) AS gross_collected
      FROM bills WHERE paid_at >= ? AND paid_at < ?
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('bills.order_id')}
    `)
            .get(start, end);
        const refundTotals = db
            .prepare(`
      SELECT COUNT(*) AS refund_count, COALESCE(SUM(CAST(r.amount_cents AS REAL)) / ?, 0) AS refunded
      FROM refunds r JOIN bills b ON b.id = r.bill_id
      WHERE b.paid_at >= ? AND b.paid_at < ?
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    `)
            .get(minorFactor, start, end);
        const refunds = db
            .prepare(`
      SELECT r.id, CAST(r.amount_cents AS REAL) / ? AS amount, r.method, r.reason,
        r.created_at, b.bill_number, b.paid_at, o.order_number,
        COALESCE(approver.name, creator.name, 'Unknown') AS approved_by_name
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
      JOIN orders o ON o.id = b.order_id
      LEFT JOIN users approver ON approver.id = r.approved_by
      LEFT JOIN users creator ON creator.id = r.created_by
      WHERE b.paid_at >= ? AND b.paid_at < ?
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 50
    `)
            .all(minorFactor, start, end);
        const grossCollected = Number(collections.gross_collected || 0);
        const refunded = Number(refundTotals.refunded || 0);
        const fractionDigits = (0, countries_2.getCurrencyFractionDigits)((0, refund_1.getTenantCurrency)(db));
        const profitability = computeSettledProfitabilitySummary(db, start, end, fractionDigits);
        let totalExpenses = 0;
        let expenseCount = 0;
        try {
            const expenseSummary = (0, expenses_1.summarizeExpenses)(db, {
                from: startDate,
                to: endDate,
                status: 'active',
            });
            for (const total of expenseSummary.totals) {
                totalExpenses += Number(total.incurred_minor || 0) / minorFactor;
                expenseCount += Number(total.expense_count || 0);
            }
        }
        catch {
            // Safe fallback if expenses are unavailable
        }
        const operatingExpenses = (0, supplies_1.roundCurrencyCost)(totalExpenses, fractionDigits);
        const grossProfit = profitability.profit;
        const operatingProfit = grossProfit !== null
            ? (0, supplies_1.roundCurrencyCost)(grossProfit - operatingExpenses, fractionDigits)
            : null;
        res.json({
            financialSummary: {
                startDate,
                endDate,
                grossCollected,
                refunded,
                netCollected: grossCollected - refunded,
                billCount: Number(collections.bill_count || 0),
                refundCount: Number(refundTotals.refund_count || 0),
                averageOrderValue: collections.bill_count
                    ? (grossCollected - refunded) / collections.bill_count
                    : 0,
                paymentMethods: (0, cash_closures_1.paymentMethodBreakdown)(db, {
                    startDate,
                    endDate,
                    paidOnly: true,
                    attributeRefundsToBillDate: true,
                }),
                refunds,
                profitability,
                operatingExpenses,
                grossProfit,
                operatingProfit,
                expenseCount,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
// Dynamic tax-component report for receipt/report consumers. Components are
// derived item by item so mixed legacy + categorized bills cannot double-count
// the categorized portion already present in the bill-level tax_breakdown.
router.get('/tax-components', (0, authorization_1.requirePermission)('reports.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const today = reportToday();
        const startDate = reportDate(req.query.start_date, today);
        const endDate = reportDate(req.query.end_date, today);
        if (startDate > endDate) {
            captureReportsDateRangeRejection('reversed_range');
            return res.status(400).json({ error: 'start_date must be on or before end_date' });
        }
        const windowStart = reportDayBounds(startDate)[0];
        const windowEnd = reportDayBounds(endDate)[1];
        const bills = db
            .prepare(`
      SELECT b.*
      FROM bills b
      JOIN orders o ON o.id = b.order_id
      WHERE b.created_at >= ? AND b.created_at < ?
        AND o.status != 'cancelled'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
      ORDER BY b.created_at, b.id
    `)
            .all(windowStart, windowEnd);
        const orders = (0, bills_1.getOrdersWithItemsForBills)(db, bills);
        const documents = bills.map((bill) => ({
            tax_amount: bill.tax_amount,
            tax_snapshot: bill.tax_snapshot,
            tax_breakdown: bill.tax_breakdown,
            items: orders.get(Number(bill.id))?.items || [],
        }));
        const taxAmount = bills.reduce((sum, bill) => sum.plus(bill.tax_amount || 0), new decimal_js_1.default(0));
        res.json({
            taxComponents: {
                startDate,
                endDate,
                billCount: bills.length,
                taxAmount: taxAmount.toDecimalPlaces(6).toNumber(),
                components: (0, tax_components_1.aggregateTaxComponents)(documents),
            },
        });
    }
    catch (error) {
        console.error('[API] Tax component report failed:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
router.get('/price-exceptions', (0, authorization_1.requirePermission)('reports.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const today = reportToday();
        const startDate = reportDate(req.query.start_date, today);
        const endDate = reportDate(req.query.end_date, today);
        if (startDate > endDate) {
            captureReportsDateRangeRejection('reversed_range');
            return res.status(400).json({ error: 'start_date must be on or before end_date' });
        }
        const rangeStart = reportDayBounds(startDate)[0];
        const rangeEnd = reportDayBounds(endDate)[1];
        const shifts = (0, item_price_override_1.listShiftsOverlapping)(db, rangeStart, rangeEnd);
        let fromIso = rangeStart;
        let toIso = rangeEnd;
        let shiftId = null;
        if (req.query.shift_id !== undefined && req.query.shift_id !== '') {
            const requested = Number(req.query.shift_id);
            const shift = Number.isInteger(requested) ? (0, item_price_override_1.getShiftWindow)(db, requested) : undefined;
            if (!shift)
                return res.status(404).json({ error: 'Shift not found' });
            shiftId = shift.id;
            fromIso = shift.opened_at;
            toIso = shift.closed_at ?? '9999-12-31 23:59:59';
        }
        const rows = (0, item_price_override_1.listPriceExceptions)(db, fromIso, toIso);
        const complimentary = rows.filter((row) => row.billed_unit_price === 0).length;
        const totalDifference = rows.reduce((sum, row) => sum.plus(row.difference * row.quantity), new decimal_js_1.default(0));
        res.json({
            priceExceptions: {
                startDate,
                endDate,
                shiftId,
                shifts,
                count: rows.length,
                complimentaryCount: complimentary,
                totalDifference: totalDifference.toDecimalPlaces(6).toNumber(),
                rows,
            },
        });
    }
    catch (error) {
        console.error('[API] Price exceptions report failed:', error);
        const failure = error;
        res
            .status(failure.statusCode || 500)
            .json({ error: failure.statusCode ? failure.message : 'Internal server error' });
    }
});
router.get('/sales', (0, authorization_1.requirePermission)('reports.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const today = reportToday();
        const startDate = reportDate(req.query.start_date, today);
        const endDate = reportDate(req.query.end_date, today);
        if (startDate > endDate) {
            captureReportsDateRangeRejection('reversed_range');
            return res.status(400).json({ error: 'start_date must be on or before end_date' });
        }
        // #208: half-open UTC ranges so the orders/bills indexes apply instead
        // of `date(...)` on every row. The bounds represent tenant business days.
        const windowStart = reportDayBounds(startDate)[0];
        const windowEnd = reportDayBounds(endDate)[1];
        // Daily series is grouped by the tenant business date rather than
        // the UTC date stored in SQLite. Only completed/settled orders are included.
        const dailyRows = db
            .prepare(`
      SELECT created_at, total
      FROM orders
      WHERE created_at >= ? AND created_at < ?
        AND (status IN ('completed', 'settled') OR EXISTS (SELECT 1 FROM bills b WHERE b.order_id = orders.id AND b.payment_status IN ('paid', 'partially_refunded', 'refunded')))
        AND status != 'cancelled'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}
    `)
            .all(windowStart, windowEnd);
        const dailyByDate = new Map();
        const timeZone = tenantTimezone();
        const startTime = tenantStartTime();
        for (const row of dailyRows) {
            const date = (0, db_1.localDateInTimezone)((0, db_1.parseDbTimestamp)(row.created_at), timeZone, startTime);
            const bucket = dailyByDate.get(date) || { orders: 0, sales: 0 };
            bucket.orders += 1;
            bucket.sales += Number(row.total || 0);
            dailyByDate.set(date, bucket);
        }
        const dailySales = [...dailyByDate.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([date, totals]) => ({ date, ...totals }));
        const byPaymentMethod = (0, cash_closures_1.paymentMethodBreakdown)(db, {
            startDate,
            endDate,
            paidOnly: true,
            excludeCancelledOrders: true,
        });
        const byOrderType = db
            .prepare(`
      SELECT type, COUNT(*) as count, SUM(total) as total
      FROM orders
      WHERE created_at >= ? AND created_at < ?
        AND (status IN ('completed', 'settled') OR EXISTS (SELECT 1 FROM bills b WHERE b.order_id = orders.id AND b.payment_status IN ('paid', 'partially_refunded', 'refunded')))
        AND status != 'cancelled'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}
      GROUP BY type
    `)
            .all(windowStart, windowEnd);
        res.json({
            sales: {
                startDate,
                endDate,
                dailySales,
                byPaymentMethod,
                byOrderType,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
function deriveProfitabilityMetrics(row, fractionDigits) {
    const netRevenue = (0, supplies_1.roundCurrencyCost)(Number(row.ex_tax_revenue || 0), fractionDigits);
    return {
        net_revenue: netRevenue,
        ...(0, profitability_1.deriveDirectCostMetrics)(row, fractionDigits),
    };
}
function computePeriodProfitabilitySummary(db, windowStart, windowEnd, fractionDigits) {
    const row = db
        .prepare(`
      WITH ${profitability_1.ORDER_ITEM_PACKAGING_COST_CTE}
      SELECT
        COALESCE(SUM(oi.quantity), 0) as total_quantity,
        COALESCE(SUM(oi.subtotal - CASE WHEN oi.tax_type = 'inclusive' THEN COALESCE(oi.tax_amount, 0) ELSE 0 END), 0) as ex_tax_revenue,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1 THEN oi.quantity ELSE 0 END), 0) as known_cost_quantity,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1 THEN 0 ELSE oi.quantity END), 0) as unknown_cost_quantity,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1
                          THEN (oi.subtotal - CASE WHEN oi.tax_type = 'inclusive' THEN COALESCE(oi.tax_amount, 0) ELSE 0 END)
                          ELSE 0 END), 0) as known_cost_revenue,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1 THEN oi.ingredient_cost ELSE 0 END), 0) as known_ingredient_cost,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1 THEN packaging.packaging_cost ELSE 0 END), 0) as known_packaging_cost
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN item_packaging_costs packaging ON packaging.order_item_id = oi.id
      WHERE o.created_at >= ? AND o.created_at < ?
        AND o.status != 'cancelled'
        AND COALESCE(oi.status, 'active') NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
    `)
        .get(windowStart, windowEnd);
    return {
        total_quantity: Number(row.total_quantity || 0),
        ...deriveProfitabilityMetrics(row, fractionDigits),
    };
}
function computeSettledProfitabilitySummary(db, windowStart, windowEnd, fractionDigits) {
    const row = db
        .prepare(`
      WITH ${profitability_1.ORDER_ITEM_PACKAGING_COST_CTE}
      SELECT
        COALESCE(SUM(CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
                          THEN oi.quantity ELSE bi.quantity END), 0) as total_quantity,
        COALESCE(SUM(CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
                          THEN (oi.subtotal - CASE WHEN oi.tax_type = 'inclusive' THEN COALESCE(oi.tax_amount, 0) ELSE 0 END)
                          ELSE (oi.subtotal - CASE WHEN oi.tax_type = 'inclusive' THEN COALESCE(oi.tax_amount, 0) ELSE 0 END) * bi.quantity / NULLIF(oi.quantity, 0)
                     END), 0) as ex_tax_revenue,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1
                          THEN (CASE WHEN b.split_group_id IS NULL OR b.split_group_id = '' THEN oi.quantity ELSE bi.quantity END)
                          ELSE 0
                     END), 0) as known_cost_quantity,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1
                          THEN 0
                          ELSE (CASE WHEN b.split_group_id IS NULL OR b.split_group_id = '' THEN oi.quantity ELSE bi.quantity END)
                     END), 0) as unknown_cost_quantity,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1
                          THEN (CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
                                     THEN (oi.subtotal - CASE WHEN oi.tax_type = 'inclusive' THEN COALESCE(oi.tax_amount, 0) ELSE 0 END)
                                     ELSE (oi.subtotal - CASE WHEN oi.tax_type = 'inclusive' THEN COALESCE(oi.tax_amount, 0) ELSE 0 END) * bi.quantity / NULLIF(oi.quantity, 0)
                                END)
                          ELSE 0
                     END), 0) as known_cost_revenue,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1
                          THEN (CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
                                     THEN oi.ingredient_cost
                                     ELSE oi.ingredient_cost * bi.quantity / NULLIF(oi.quantity, 0)
                                END)
                          ELSE 0
                     END), 0) as known_ingredient_cost,
        COALESCE(SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1
                          THEN (CASE WHEN b.split_group_id IS NULL OR b.split_group_id = ''
                                     THEN packaging.packaging_cost
                                     ELSE packaging.packaging_cost * bi.quantity / NULLIF(oi.quantity, 0)
                                END)
                          ELSE 0
                     END), 0) as known_packaging_cost
      FROM bills b
      JOIN orders o ON o.id = b.order_id
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN bill_items bi ON bi.bill_id = b.id AND bi.order_item_id = oi.id
      LEFT JOIN item_packaging_costs packaging ON packaging.order_item_id = oi.id
      WHERE b.paid_at >= ? AND b.paid_at < ?
        AND (oi.status IS NULL OR oi.status NOT IN ('cancelled', 'voided', 'void_adjustment'))
        AND (b.split_group_id IS NULL OR b.split_group_id = '' OR bi.bill_id IS NOT NULL)
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
    `)
        .get(windowStart, windowEnd);
    return {
        total_quantity: Number(row.total_quantity || 0),
        ...deriveProfitabilityMetrics(row, fractionDigits),
    };
}
router.get('/topProducts', (0, authorization_1.requireAnyPermission)('reports.view', 'dashboard.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const today = reportToday();
        const startDate = reportDate(req.query.start_date, today);
        const endDate = reportDate(req.query.end_date, today);
        if (startDate > endDate) {
            captureReportsDateRangeRejection('reversed_range');
            return res.status(400).json({ error: 'start_date must be on or before end_date' });
        }
        const requestedLimit = Number(req.query.limit);
        const limit = Number.isInteger(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), 100)
            : 10;
        const windowStart = reportDayBounds(startDate)[0];
        const windowEnd = reportDayBounds(endDate)[1];
        const userId = String(req.user?.userId || '');
        const canViewFinancials = userId ? (0, authorization_1.hasPermission)(userId, 'reports.financial.view') : false;
        const fractionDigits = (0, countries_2.getCurrencyFractionDigits)((0, refund_1.getTenantCurrency)(db));
        const rawTopProducts = db
            .prepare(`
      WITH ${profitability_1.ORDER_ITEM_PACKAGING_COST_CTE}
      SELECT oi.product_id,
        COALESCE(p.name, REPLACE(oi.product_name, ' (BOGO Free)', '')) as product_name,
        SUM(oi.quantity) as total_quantity,
        SUM(CASE WHEN json_extract(oi.modifier_selection, '$.is_bogo_free') = 1 OR json_extract(oi.modifier_selection, '$.is_bogo_free') = true OR oi.product_name LIKE '%(BOGO Free)%' OR (oi.discount_amount >= oi.subtotal AND oi.subtotal > 0) THEN 0 ELSE oi.quantity END) as paid_quantity,
        SUM(CASE WHEN json_extract(oi.modifier_selection, '$.is_bogo_free') = 1 OR json_extract(oi.modifier_selection, '$.is_bogo_free') = true OR oi.product_name LIKE '%(BOGO Free)%' OR (oi.discount_amount >= oi.subtotal AND oi.subtotal > 0) THEN oi.quantity ELSE 0 END) as free_quantity,
        SUM(oi.subtotal) as gross_sales,
        SUM(COALESCE(oi.discount_amount, 0)) as discount_amount,
        SUM(oi.subtotal - COALESCE(oi.discount_amount, 0)) as total_revenue,
        COUNT(DISTINCT oi.order_id) as order_count,
        SUM((oi.subtotal - COALESCE(oi.discount_amount, 0)) - CASE WHEN oi.tax_type = 'inclusive' THEN COALESCE(oi.tax_amount, 0) ELSE 0 END) as ex_tax_revenue,
        SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1 THEN oi.quantity ELSE 0 END) as known_cost_quantity,
        SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1 THEN 0 ELSE oi.quantity END) as unknown_cost_quantity,
        SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1
                 THEN ((oi.subtotal - COALESCE(oi.discount_amount, 0)) - CASE WHEN oi.tax_type = 'inclusive' THEN COALESCE(oi.tax_amount, 0) ELSE 0 END)
                 ELSE 0 END) as known_cost_revenue,
        SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1 THEN oi.ingredient_cost ELSE 0 END) as known_ingredient_cost,
        SUM(CASE WHEN oi.ingredient_cost_known = 1 AND oi.ingredient_cost IS NOT NULL AND COALESCE(packaging.packaging_cost_known, 0) = 1 THEN packaging.packaging_cost ELSE 0 END) as known_packaging_cost
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN item_packaging_costs packaging ON packaging.order_item_id = oi.id
      WHERE o.created_at >= ? AND o.created_at < ?
        AND o.status != 'cancelled'
        AND COALESCE(oi.status, 'active') NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
      GROUP BY oi.product_id
      ORDER BY total_quantity DESC
      LIMIT ?
    `)
            .all(windowStart, windowEnd, limit);
        const topProducts = rawTopProducts.map((row) => {
            const base = {
                product_id: row.product_id,
                product_name: row.product_name,
                total_quantity: Number(row.total_quantity || 0),
                prepared_quantity: Number(row.total_quantity || 0),
                paid_quantity: Number(row.paid_quantity || 0),
                free_quantity: Number(row.free_quantity || 0),
                gross_sales: Number(row.gross_sales || 0),
                discount_amount: Number(row.discount_amount || 0),
                total_revenue: Number(row.total_revenue || 0),
                net_revenue: Number(row.total_revenue || 0),
                order_count: Number(row.order_count || 0),
            };
            if (!canViewFinancials)
                return base;
            return {
                ...base,
                ...deriveProfitabilityMetrics(row, fractionDigits),
            };
        });
        if (canViewFinancials) {
            const profitability = computePeriodProfitabilitySummary(db, windowStart, windowEnd, fractionDigits);
            return res.json({ topProducts, profitability });
        }
        res.json({ topProducts });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
router.get('/recentOrders', (0, authorization_1.requireAnyPermission)('reports.view', 'dashboard.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const requestedLimit = Number(req.query.limit);
        const limit = Number.isInteger(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), 100)
            : 20;
        const date = req.query.date === undefined ? undefined : reportDate(req.query.date, '');
        const startDate = req.query.start_date === undefined ? undefined : reportDate(req.query.start_date, '');
        const endDate = req.query.end_date === undefined ? undefined : reportDate(req.query.end_date, '');
        if (req.query.date !== undefined && !date) {
            captureReportsDateRangeRejection('invalid_format');
            return res.status(400).json({ error: 'date must use YYYY-MM-DD format' });
        }
        if ((req.query.start_date !== undefined && !startDate) ||
            (req.query.end_date !== undefined && !endDate)) {
            captureReportsDateRangeRejection('invalid_format');
            return res.status(400).json({ error: 'start_date and end_date must use YYYY-MM-DD format' });
        }
        if (date && (startDate || endDate)) {
            captureReportsDateRangeRejection('date_and_range_conflict');
            return res.status(400).json({ error: 'date cannot be combined with start_date or end_date' });
        }
        if (startDate && endDate && startDate > endDate) {
            captureReportsDateRangeRejection('reversed_range');
            return res.status(400).json({ error: 'start_date must be on or before end_date' });
        }
        // Without a date, "most recent overall" (dashboard live view). With one,
        // scoped to that day — lets the dashboard show a past day's orders
        // instead of always the latest regardless of which date is selected.
        // #208: range filter hits idx_orders_created_at instead of full scan.
        const sandboxExclusion = (0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id');
        const params = [];
        let where = `WHERE ${sandboxExclusion}`;
        if (date) {
            const [s, e] = reportDayBounds(date);
            where = `WHERE o.created_at >= ? AND o.created_at < ? AND ${sandboxExclusion}`;
            params.push(s, e);
        }
        else if (startDate || endDate) {
            const effectiveStart = startDate || endDate;
            const effectiveEnd = endDate || startDate;
            const [s] = reportDayBounds(effectiveStart);
            const [, e] = reportDayBounds(effectiveEnd);
            where = `WHERE o.created_at >= ? AND o.created_at < ? AND ${sandboxExclusion}`;
            params.push(s, e);
        }
        const recentOrders = db
            .prepare(`
      SELECT o.*, t.number as table_name, c.name as customer_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      ${where}
      ORDER BY o.created_at DESC
      LIMIT ?
    `)
            .all(...params, limit);
        // #208: batch all items in one IN() query instead of per-order N+1.
        const orderIds = recentOrders.map((o) => o.id);
        const itemsByOrder = new Map();
        if (orderIds.length > 0) {
            const placeholders = orderIds.map(() => '?').join(',');
            const items = db
                .prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id, id`)
                .all(...orderIds);
            for (const item of items) {
                const list = itemsByOrder.get(item.order_id) || [];
                list.push(item);
                itemsByOrder.set(item.order_id, list);
            }
        }
        const ordersWithItems = recentOrders.map((order) => ({
            ...order,
            items: itemsByOrder.get(order.id) || [],
        }));
        res.json({ recentOrders: ordersWithItems });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
router.get('/tables', (0, authorization_1.requirePermission)('reports.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const [start, end] = reportDayBounds(reportToday());
        const tableStats = db
            .prepare(`
      SELECT t.*,
        COUNT(DISTINCT o.id) as total_orders,
        COALESCE(SUM(o.total), 0) as total_revenue,
        MAX(o.created_at) as last_order_at
      FROM tables t
      LEFT JOIN orders o ON t.id = o.table_id
        AND o.created_at >= ? AND o.created_at < ?
        AND o.status != 'cancelled'
      GROUP BY t.id
    `)
            .all(start, end);
        const tableUtilization = db
            .prepare(`
      SELECT
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved,
        SUM(CASE WHEN status = 'cleaning' THEN 1 ELSE 0 END) as cleaning,
        COUNT(*) as total
      FROM tables
    `)
            .get();
        res.json({
            tableStats,
            tableUtilization,
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
// ── GET /insights - dashboard metrics beyond today's snapshot ──────────────
// AOV, top staff, top categories, busiest/idlest hour & day-of-week, and
// average kitchen prep time, aggregated over an explicit `[start_date, end_date]`
// business-date range (up to 365 days) or a trailing `days` window (default 30).
router.get('/insights', (0, authorization_1.requireAnyPermission)('reports.view', 'dashboard.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
        const startDateParam = req.query.start_date === undefined ? undefined : reportDate(req.query.start_date, '');
        const endDateParam = req.query.end_date === undefined ? undefined : reportDate(req.query.end_date, '');
        if ((req.query.start_date !== undefined && !startDateParam) ||
            (req.query.end_date !== undefined && !endDateParam)) {
            captureReportsDateRangeRejection('invalid_format');
            return res.status(400).json({ error: 'start_date and end_date must use YYYY-MM-DD format' });
        }
        const timeZone = tenantTimezone();
        let windowStart;
        let windowEnd = null;
        let days;
        if (startDateParam || endDateParam) {
            const effectiveStart = startDateParam || endDateParam;
            const effectiveEnd = endDateParam || startDateParam;
            if (effectiveStart > effectiveEnd) {
                captureReportsDateRangeRejection('reversed_range');
                return res.status(400).json({ error: 'start_date must be on or before end_date' });
            }
            windowStart = reportDayBounds(effectiveStart)[0];
            windowEnd = reportDayBounds(effectiveEnd)[1];
            days = Math.max(1, Math.round((new Date(`${effectiveEnd}T00:00:00Z`).getTime() -
                new Date(`${effectiveStart}T00:00:00Z`).getTime()) /
                86_400_000) + 1);
            if (days > 365) {
                captureReportsDateRangeRejection('invalid_format');
                return res
                    .status(400)
                    .json({ error: 'start_date and end_date range must not exceed 365 days' });
            }
        }
        else {
            days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
            // #208: "N days back" in the tenant's local calendar, with a UTC range
            // so the window filters on the index. The same timezone drives the
            // hour/day-of-week bucketing below.
            const today = reportToday();
            const startDateValue = new Date(`${today}T00:00:00Z`);
            startDateValue.setUTCDate(startDateValue.getUTCDate() - days);
            const startDate = startDateValue.toISOString().slice(0, 10);
            [windowStart] = reportDayBounds(startDate);
        }
        // AOV — same revenue basis ("paid bills") as the existing daily-stats tile.
        const revenue = (windowEnd
            ? db
                .prepare(`
          SELECT COUNT(*) as billCount,
            COALESCE(SUM(paid_amount), 0)
            - COALESCE((SELECT SUM(CAST(amount_cents AS REAL)) / ? FROM refunds WHERE created_at >= ? AND created_at < ?
              AND ${(0, sandbox_exclusion_1.refundSandboxExclusionSql)('refunds.bill_id')}), 0) as total
          FROM bills
          WHERE paid_at >= ? AND paid_at < ?
            AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('bills.order_id')}
        `)
                .get(minorFactor, windowStart, windowEnd, windowStart, windowEnd)
            : db
                .prepare(`
          SELECT COUNT(*) as billCount,
            COALESCE(SUM(paid_amount), 0)
            - COALESCE((SELECT SUM(CAST(amount_cents AS REAL)) / ? FROM refunds WHERE created_at >= ?
              AND ${(0, sandbox_exclusion_1.refundSandboxExclusionSql)('refunds.bill_id')}), 0) as total
          FROM bills
          WHERE paid_at >= ?
            AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('bills.order_id')}
        `)
                .get(minorFactor, windowStart, windowStart));
        const aov = revenue.billCount > 0 ? revenue.total / revenue.billCount : 0;
        // Kitchen velocity — substitutes for "best cook", which isn't derivable:
        // order_items has no per-chef attribution (marking an item ready doesn't
        // record who did it), so there's no data to rank individual cooks by.
        // Average prep time is the closest real signal for kitchen performance.
        const prepTime = (windowEnd
            ? db
                .prepare(`
          SELECT AVG((julianday(ready_at) - julianday(cooking_started_at)) * 24 * 60) as avgMinutes,
            COUNT(*) as sampleSize
          FROM orders
          WHERE cooking_started_at IS NOT NULL AND ready_at IS NOT NULL
            AND created_at >= ? AND created_at < ? AND status != 'cancelled'
            AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}
        `)
                .get(windowStart, windowEnd)
            : db
                .prepare(`
          SELECT AVG((julianday(ready_at) - julianday(cooking_started_at)) * 24 * 60) as avgMinutes,
            COUNT(*) as sampleSize
          FROM orders
          WHERE cooking_started_at IS NOT NULL AND ready_at IS NOT NULL
            AND created_at >= ? AND status != 'cancelled'
            AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}
        `)
                .get(windowStart));
        // Top staff by revenue — covers whoever creates orders (owner/manager/
        // cashier/server, per POST /orders' own role gate), i.e. "best cashier".
        const topStaff = windowEnd
            ? db
                .prepare(`
        SELECT u.id as user_id, u.name, u.role,
          COALESCE(SUM(o.total), 0) as revenue,
          COUNT(o.id) as orderCount
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled'
          AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
        GROUP BY u.id
        ORDER BY revenue DESC
        LIMIT 5
      `)
                .all(windowStart, windowEnd)
            : db
                .prepare(`
        SELECT u.id as user_id, u.name, u.role,
          COALESCE(SUM(o.total), 0) as revenue,
          COUNT(o.id) as orderCount
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.created_at >= ? AND o.status != 'cancelled'
          AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
        GROUP BY u.id
        ORDER BY revenue DESC
        LIMIT 5
      `)
                .all(windowStart);
        // Top categories by revenue.
        const topCategories = windowEnd
            ? db
                .prepare(`
        SELECT c.id as category_id, COALESCE(c.name, 'Uncategorized') as name,
          COALESCE(SUM(oi.quantity), 0) as quantity,
          COALESCE(SUM(oi.subtotal - COALESCE(oi.discount_amount, 0)), 0) as revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE o.created_at >= ? AND o.created_at < ? AND oi.status != 'cancelled'
          AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
        GROUP BY c.id
        ORDER BY revenue DESC
        LIMIT 5
      `)
                .all(windowStart, windowEnd)
            : db
                .prepare(`
        SELECT c.id as category_id, COALESCE(c.name, 'Uncategorized') as name,
          COALESCE(SUM(oi.quantity), 0) as quantity,
          COALESCE(SUM(oi.subtotal - COALESCE(oi.discount_amount, 0)), 0) as revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE o.created_at >= ? AND oi.status != 'cancelled'
          AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('o.id')}
        GROUP BY c.id
        ORDER BY revenue DESC
        LIMIT 5
      `)
                .all(windowStart);
        // Busiest/idlest hour & day-of-week, bucketed in the tenant's local timezone.
        const orderTimestamps = (windowEnd
            ? db
                .prepare(`SELECT created_at FROM orders WHERE created_at >= ? AND created_at < ? AND status != 'cancelled' AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}`)
                .all(windowStart, windowEnd)
            : db
                .prepare(`SELECT created_at FROM orders WHERE created_at >= ? AND status != 'cancelled' AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('orders.id')}`)
                .all(windowStart)).map((r) => r.created_at);
        const { hourCounts, dayCounts } = bucketByLocalHourAndWeekday(orderTimestamps, timeZone, tenantStartTime());
        // Hours with zero orders are excluded from busiest/idlest — almost
        // certainly "closed overnight" rather than a meaningful idle signal,
        // and would otherwise trivially always "win" idlest hour.
        const busiestHour = pickExtreme(hourCounts, 'max', (c) => c > 0);
        const idlestHour = pickExtreme(hourCounts, 'min', (c) => c > 0);
        // Day-of-week zero counts ARE kept — "closed Mondays" is a real,
        // useful signal, unlike an overnight hour with no foot traffic.
        const busiestDay = pickExtreme(dayCounts, 'max', () => true);
        const idlestDay = pickExtreme(dayCounts, 'min', () => true);
        res.json({
            windowDays: days,
            aov,
            ordersAnalyzed: orderTimestamps.length,
            avgPrepTimeMinutes: prepTime.sampleSize > 0 && prepTime.avgMinutes !== null
                ? Math.round(prepTime.avgMinutes)
                : null,
            topStaff,
            topCategories,
            busiestHour: busiestHour ? { hour: busiestHour.index, orderCount: busiestHour.count } : null,
            idlestHour: idlestHour ? { hour: idlestHour.index, orderCount: idlestHour.count } : null,
            busiestDayOfWeek: busiestDay
                ? { dayIndex: busiestDay.index, orderCount: busiestDay.count }
                : null,
            idlestDayOfWeek: idlestDay
                ? { dayIndex: idlestDay.index, orderCount: idlestDay.count }
                : null,
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
// ── GET /x-report — live day report (cierre de caja, issue #649) ──────
// Reuses the snapshot pipeline from `cash-closures.ts` so the X read and
// the stored Z snapshot never drift apart. Same role gate as the other
// owner/manager reports. Refund attribution matches financial-summary
// (paid_at) for display totals; the cash-only expected figure includes active
// movements and uses refunds by `refunds.created_at` for drawer reality. The
// opening float is reported separately and intentionally excluded from X's
// expected figure.
//
// UNIT CONVENTIONS for the X envelope (do not rename fields):
//   * grossCollected, refunded, netCollected, paymentMethods[].total,
//     staffSales[].revenue, taxComponents are DISPLAY MAJOR UNITS
//     (minorFactor-divided, matching financial-summary / tax-components).
//   * expectedCashCents is INTEGER CENTS (drawer math; the consuming
//     client must convert the counted input to cents before subtracting).
//
// X vs Z expected (deliberate gap, not a bug):
//   X's expectedCashCents excludes the opening float, which is reported
//   separately. Same-day X and Z expected values therefore differ by exactly
//   opening_float_cents. Consumers must not compare them directly; X is the
//   live drawer expectation, Z is the point-in-time snapshot that bakes in the
//   float.
function resolveRequestedCashSession(db, req, res) {
    if (req.query.session_id === undefined || String(req.query.session_id).trim() === '') {
        return null;
    }
    const sessionId = Number(req.query.session_id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        res.status(400).json({ error: 'Invalid session_id', code: 'session_id_invalid' });
        return 'responded';
    }
    const session = db
        .prepare(`SELECT id, opened_by, opened_by_name, opened_at, opening_float_cents, status, closed_at, closed_by, closure_id
       FROM cash_sessions WHERE id = ?`)
        .get(sessionId);
    if (!session) {
        res.status(404).json({ error: 'Shift not found', code: 'session_unavailable' });
        return 'responded';
    }
    const actor = req.user;
    const actorRole = String(actor?.role || '');
    const actorUserId = String(actor?.userId || '');
    if (actorRole !== 'owner' &&
        actorRole !== 'manager' &&
        String(session.opened_by) !== actorUserId) {
        res.status(403).json({
            error: "Only owners and managers can view another staff member's shift report",
            code: 'shift_access_forbidden',
        });
        return 'responded';
    }
    return session;
}
router.get('/x-report', (0, authorization_1.requirePermission)('reports.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
        const session = resolveRequestedCashSession(db, req, res);
        if (session === 'responded')
            return;
        if (session) {
            const shiftDate = (0, cash_day_close_guards_1.sessionBusinessDate)(db, session);
            const sessionClosedRow = session.closure_id != null
                ? db
                    .prepare(`SELECT z_number FROM cash_closures WHERE id = ? AND scope = 'session' LIMIT 1`)
                    .get(session.closure_id)
                : undefined;
            const sessionPriorRow = db
                .prepare(`SELECT business_date, counted_cash_cents FROM cash_closures
           WHERE business_date < ? AND scope = 'day'
           ORDER BY business_date DESC LIMIT 1`)
                .get(shiftDate);
            const sessionBlockingSessions = (0, cash_day_close_guards_1.openSessionsBlockingDayClose)(db, shiftDate);
            const sessionBlocking = sessionBlockingSessions[0];
            const sessionOpenShifts = sessionBlockingSessions.map((s) => ({
                id: s.id,
                opened_by: s.opened_by,
                opened_by_name: s.opened_by_name,
                opened_at: s.opened_at,
            }));
            const sessionEnd = session.closed_at || (0, db_1.now)();
            const openingFloatCents = Number(session.opening_float_cents || 0);
            const sessionAggregates = (0, cash_closures_1.computeSessionAggregates)(db, session, sessionEnd);
            const totalExpectedCashCents = (0, cash_closures_1.sessionExpectedCash)(db, session, sessionEnd, sessionAggregates.cashMovements);
            return res.json({
                xReport: {
                    businessDate: shiftDate,
                    periodStart: session.opened_at,
                    periodEnd: sessionEnd,
                    grossCollected: sessionAggregates.grossCollectedCents / minorFactor,
                    refunded: sessionAggregates.refundedCents / minorFactor,
                    netCollected: sessionAggregates.netCollectedCents / minorFactor,
                    billCount: sessionAggregates.billCount,
                    refundCount: sessionAggregates.refundCount,
                    paymentMethods: sessionAggregates.paymentMethods.map((row) => ({
                        method: row.method,
                        count: row.count,
                        total: row.total_cents / minorFactor,
                    })),
                    staffSales: sessionAggregates.staffSales.map((row) => ({
                        user_id: row.user_id,
                        name: row.name,
                        role: row.role,
                        revenue: row.revenue_cents / minorFactor,
                        orderCount: row.orderCount,
                    })),
                    taxComponents: sessionAggregates.taxComponents,
                    openingFloatCents,
                    payInCents: sessionAggregates.payInCents,
                    payOutCents: sessionAggregates.payOutCents,
                    safeDropCents: sessionAggregates.safeDropCents,
                    cashMovements: sessionAggregates.cashMovements,
                    expectedCashCents: totalExpectedCashCents - openingFloatCents,
                    priorClosedCashCents: sessionPriorRow?.counted_cash_cents ?? null,
                    priorBusinessDate: sessionPriorRow?.business_date ?? null,
                    alreadyClosed: session.status === 'closed' || !!sessionClosedRow,
                    zNumber: sessionClosedRow?.z_number,
                    session: {
                        id: session.id,
                        opened_by: session.opened_by,
                        opened_by_name: session.opened_by_name,
                        opened_at: session.opened_at,
                        closed_at: session.closed_at,
                        status: session.status,
                        closure_id: session.closure_id,
                        opening_float_cents: openingFloatCents,
                        expected_cash_cents: totalExpectedCashCents,
                    },
                    openShifts: sessionOpenShifts,
                    blockingOpenShift: sessionBlocking
                        ? {
                            id: sessionBlocking.id,
                            opened_by_name: sessionBlocking.opened_by_name,
                            opened_at: sessionBlocking.opened_at,
                        }
                        : null,
                },
            });
        }
        const today = reportToday();
        const date = reportDate(req.query.date, today);
        const [periodStart, periodEnd] = reportDayBounds(date);
        const aggregates = (0, cash_closures_1.computeDayAggregates)(db, date);
        const closedRow = db
            .prepare(`SELECT z_number FROM cash_closures WHERE business_date = ? AND scope = 'day' LIMIT 1`)
            .get(date);
        // F3: most recent prior closed day for this business date, used by the
        // modal to prefill the opening float (server-side one-shot query; the
        // frontend no longer walks back day-by-day).
        const priorRow = db
            .prepare(`SELECT business_date, counted_cash_cents FROM cash_closures
         WHERE business_date < ? AND scope = 'day'
         ORDER BY business_date DESC LIMIT 1`)
            .get(date);
        const blockingSessions = (0, cash_day_close_guards_1.openSessionsBlockingDayClose)(db, date);
        const blockingSession = blockingSessions[0];
        const openShifts = blockingSessions.map((s) => ({
            id: s.id,
            opened_by: s.opened_by,
            opened_by_name: s.opened_by_name,
            opened_at: s.opened_at,
        }));
        res.json({
            xReport: {
                businessDate: date,
                periodStart,
                periodEnd,
                grossCollected: aggregates.grossCollectedCents / minorFactor,
                refunded: aggregates.refundedCents / minorFactor,
                netCollected: aggregates.netCollectedCents / minorFactor,
                billCount: aggregates.billCount,
                refundCount: aggregates.refundCount,
                paymentMethods: aggregates.paymentMethods.map((row) => ({
                    method: row.method,
                    count: row.count,
                    total: row.total_cents / minorFactor,
                })),
                staffSales: aggregates.staffSales.map((row) => ({
                    user_id: row.user_id,
                    name: row.name,
                    role: row.role,
                    revenue: row.revenue_cents / minorFactor,
                    orderCount: row.orderCount,
                })),
                taxComponents: aggregates.taxComponents,
                openingFloatCents: aggregates.cashMovements.find((movement) => movement.movement_type === 'opening_float')
                    ?.amount_cents ?? null,
                payInCents: aggregates.payInCents,
                payOutCents: aggregates.payOutCents,
                safeDropCents: aggregates.safeDropCents,
                cashMovements: aggregates.cashMovements,
                expectedCashCents: aggregates.cashSalesCents +
                    aggregates.payInCents -
                    aggregates.payOutCents -
                    aggregates.safeDropCents -
                    aggregates.cashRefundsByCreatedAtCents,
                // F3: server-resolved prior close; null fields when no prior close
                // exists. The frontend only shows the "no prior close" hint when
                // this is genuinely null (never on transport error).
                priorClosedCashCents: priorRow?.counted_cash_cents ?? null,
                priorBusinessDate: priorRow?.business_date ?? null,
                alreadyClosed: !!closedRow,
                zNumber: closedRow?.z_number,
                session: null,
                openShifts,
                blockingOpenShift: blockingSession
                    ? {
                        id: blockingSession.id,
                        opened_by_name: blockingSession.opened_by_name,
                        opened_at: blockingSession.opened_at,
                    }
                    : null,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
// ── GET /z-report — stored day-close snapshot (cierre de caja, issue #649) ──────
// Reads the immutable `cash_closures` row for the requested business date.
// 404 with `{ alreadyClosed: false }` when no day-close row exists yet.
// Same role gate as /x-report.
router.get('/z-report', (0, authorization_1.requirePermission)('reports.view'), (req, res) => {
    try {
        const today = reportToday();
        const date = reportDate(req.query.date, today);
        const db = (0, db_1.getDatabase)();
        const row = db
            .prepare(`SELECT * FROM cash_closures WHERE business_date = ? AND scope = 'day' LIMIT 1`)
            .get(date);
        if (!row) {
            return res
                .status(404)
                .json({ error: 'Day not closed', alreadyClosed: false, businessDate: date });
        }
        // F6: resolve the operator's display name (id -> name) for the response.
        // Falls back to the raw id when the user row is missing.
        const userRow = db.prepare(`SELECT name FROM users WHERE id = ?`).get(row.closed_by);
        res.json({
            zReport: {
                id: row.id,
                scope: row.scope,
                business_date: row.business_date,
                period_start: row.period_start,
                period_end: row.period_end,
                opening_float_cents: row.opening_float_cents,
                expected_cash_cents: row.expected_cash_cents,
                counted_cash_cents: row.counted_cash_cents,
                variance_cents: row.variance_cents,
                pay_in_cents: row.pay_in_cents,
                pay_out_cents: row.pay_out_cents,
                safe_drop_cents: row.safe_drop_cents,
                gross_collected_cents: row.gross_collected_cents,
                refunded_cents: row.refunded_cents,
                net_collected_cents: row.net_collected_cents,
                bill_count: row.bill_count,
                refund_count: row.refund_count,
                payment_methods: JSON.parse(row.payment_methods_json || '[]'),
                staff_sales: JSON.parse(row.staff_sales_json || '[]'),
                tax_components: JSON.parse(row.tax_components_json || '[]'),
                cash_movements: JSON.parse(row.cash_movements_json || '[]'),
                z_number: row.z_number,
                closed_by: row.closed_by,
                closed_by_name: userRow?.name ?? row.closed_by,
                notes: row.notes,
                created_at: row.created_at,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
});
function resolveCashCloseHtmlOptions(db) {
    const currency = (0, refund_1.getTenantCurrency)(db);
    const businessName = (0, db_1.getSettingValue)('business_name') ?? undefined;
    try {
        const snapshot = (0, countries_1.resolveRegionalSnapshot)({
            country: (0, db_1.getSettingValue)('country') ?? undefined,
            currency,
            timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
            currency_display: (0, db_1.getSettingValue)('currency_display') ?? undefined,
            number_digits: (0, db_1.getSettingValue)('number_digits') ?? undefined,
            calendar: (0, db_1.getSettingValue)('calendar') ?? undefined,
        });
        return {
            businessName,
            currency: snapshot.currency,
            locale: snapshot.locale,
            timezone: snapshot.timezone,
            preferences: snapshot.preferences,
        };
    }
    catch {
        return {
            businessName,
            currency,
        };
    }
}
router.get('/x-report/export', (0, authorization_1.requirePermission)('reports.view'), async (req, res) => {
    try {
        const format = req.query.format === 'csv'
            ? 'csv'
            : req.query.format === 'xlsx'
                ? 'xlsx'
                : req.query.format === 'html'
                    ? 'html'
                    : null;
        if (!format)
            return res.status(400).json({ error: 'format must be xlsx, csv, or html' });
        const db = (0, db_1.getDatabase)();
        const session = resolveRequestedCashSession(db, req, res);
        if (session === 'responded')
            return;
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
        let report;
        let filename;
        if (session) {
            const shiftDate = (0, cash_day_close_guards_1.sessionBusinessDate)(db, session);
            const sessionEnd = session.closed_at || (0, db_1.now)();
            const openingFloatCents = Number(session.opening_float_cents || 0);
            const sessionAggregates = (0, cash_closures_1.computeSessionAggregates)(db, session, sessionEnd);
            const totalExpectedCashCents = (0, cash_closures_1.sessionExpectedCash)(db, session, sessionEnd, sessionAggregates.cashMovements);
            report = {
                businessDate: shiftDate,
                periodStart: session.opened_at,
                periodEnd: sessionEnd,
                grossSales: sessionAggregates.grossCollectedCents / minorFactor,
                refunds: sessionAggregates.refundedCents / minorFactor,
                netCollections: sessionAggregates.netCollectedCents / minorFactor,
                billCount: sessionAggregates.billCount,
                expectedCash: totalExpectedCashCents / minorFactor,
                openingFloat: openingFloatCents / minorFactor,
                payIn: sessionAggregates.payInCents / minorFactor,
                payOut: sessionAggregates.payOutCents / minorFactor,
                safeDrops: sessionAggregates.safeDropCents / minorFactor,
                paymentMethods: sessionAggregates.paymentMethods.map((row) => ({
                    method: row.method,
                    count: row.count,
                    total: row.total_cents / minorFactor,
                })),
                staffSales: sessionAggregates.staffSales.map((row) => ({
                    name: row.name,
                    role: row.role,
                    orderCount: row.orderCount,
                    revenue: row.revenue_cents / minorFactor,
                })),
                taxComponents: sessionAggregates.taxComponents.map((comp) => ({
                    title: comp.title,
                    rate: comp.rate,
                    amount: comp.amount,
                })),
                session: {
                    id: session.id,
                    openedByName: session.opened_by_name || session.opened_by,
                },
            };
            filename = `x-report-${shiftDate}-shift-${session.id}.${format}`;
        }
        else {
            const date = reportDate(req.query.date, reportToday());
            const [periodStart, periodEnd] = reportDayBounds(date);
            const aggregates = (0, cash_closures_1.computeDayAggregates)(db, date);
            report = {
                businessDate: date,
                periodStart,
                periodEnd,
                grossSales: aggregates.grossCollectedCents / minorFactor,
                refunds: aggregates.refundedCents / minorFactor,
                netCollections: aggregates.netCollectedCents / minorFactor,
                billCount: aggregates.billCount,
                expectedCash: (0, cash_closures_1.expectedCashFromAggregates)(aggregates) / minorFactor,
                openingFloat: aggregates.openingFloatCents / minorFactor,
                payIn: aggregates.payInCents / minorFactor,
                payOut: aggregates.payOutCents / minorFactor,
                safeDrops: aggregates.safeDropCents / minorFactor,
                paymentMethods: aggregates.paymentMethods.map((row) => ({
                    method: row.method,
                    count: row.count,
                    total: row.total_cents / minorFactor,
                })),
                staffSales: aggregates.staffSales.map((row) => ({
                    name: row.name,
                    role: row.role,
                    orderCount: row.orderCount,
                    revenue: row.revenue_cents / minorFactor,
                })),
                taxComponents: aggregates.taxComponents.map((comp) => ({
                    title: comp.title,
                    rate: comp.rate,
                    amount: comp.amount,
                })),
            };
            filename = `x-report-${date}.${format}`;
        }
        if (format === 'xlsx') {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(await (0, cash_close_export_1.serializeXReportXlsx)(report));
        }
        if (format === 'html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send((0, cash_close_export_1.serializeXReportHtml)(report, resolveCashCloseHtmlOptions(db)));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send((0, cash_close_export_1.serializeXReportCsv)(report));
    }
    catch (error) {
        console.error('[API] X report export error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/z-report/export', (0, authorization_1.requirePermission)('reports.view'), async (req, res) => {
    try {
        const date = reportDate(req.query.date, reportToday());
        const format = req.query.format === 'csv'
            ? 'csv'
            : req.query.format === 'xlsx'
                ? 'xlsx'
                : req.query.format === 'html'
                    ? 'html'
                    : null;
        if (!format)
            return res.status(400).json({ error: 'format must be xlsx, csv, or html' });
        const db = (0, db_1.getDatabase)();
        const row = db
            .prepare(`SELECT * FROM cash_closures WHERE business_date = ? AND scope = 'day' LIMIT 1`)
            .get(date);
        if (!row)
            return res.status(404).json({ error: 'Day not closed' });
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
        const userRow = db.prepare('SELECT name FROM users WHERE id = ?').get(row.closed_by);
        const report = {
            businessDate: row.business_date,
            periodStart: row.period_start,
            periodEnd: row.period_end,
            grossSales: row.gross_collected_cents / minorFactor,
            refunds: row.refunded_cents / minorFactor,
            netCollections: row.net_collected_cents / minorFactor,
            billCount: row.bill_count,
            expectedCash: row.expected_cash_cents / minorFactor,
            openingFloat: row.opening_float_cents / minorFactor,
            payIn: row.pay_in_cents / minorFactor,
            payOut: row.pay_out_cents / minorFactor,
            safeDrops: row.safe_drop_cents / minorFactor,
            paymentMethods: JSON.parse(row.payment_methods_json || '[]').map((payment) => ({
                method: payment.method,
                count: payment.count,
                total: payment.total_cents / minorFactor,
            })),
            staffSales: JSON.parse(row.staff_sales_json || '[]').map((staff) => ({
                name: staff.name,
                role: staff.role,
                orderCount: staff.orderCount,
                revenue: staff.revenue_cents / minorFactor,
            })),
            taxComponents: JSON.parse(row.tax_components_json || '[]').map((comp) => ({
                title: String(comp.title ?? 'Tax'),
                rate: typeof comp.rate === 'number' ? comp.rate : null,
                amount: Number(comp.amount ?? 0),
            })),
            zNumber: row.z_number,
            closedAt: row.created_at,
            closedBy: userRow?.name ?? row.closed_by,
            notes: row.notes,
            countedCash: row.counted_cash_cents / minorFactor,
            cashVariance: row.variance_cents / minorFactor,
        };
        const filename = `z-report-Z${row.z_number}-${date}.${format}`;
        if (format === 'xlsx') {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(await (0, cash_close_export_1.serializeZReportXlsx)(report));
        }
        if (format === 'html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send((0, cash_close_export_1.serializeZReportHtml)(report, resolveCashCloseHtmlOptions(db)));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send((0, cash_close_export_1.serializeZReportCsv)(report));
    }
    catch (error) {
        console.error('[API] Z report export error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/cash-closes/:id/whatsapp', (0, authorization_1.requirePermission)('reports.view'), (0, authorization_1.requirePermission)('whatsapp.use'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ error: 'Invalid cash close id' });
    }
    const { phone_e164: phoneE164, body } = req.body ?? {};
    if (typeof phoneE164 !== 'string' || !phoneE164) {
        return res.status(400).json({ error: 'phone_e164 required', reason: 'phone_required' });
    }
    const parsedPhone = (0, phone_1.parsePhoneE164)(phoneE164, (0, db_1.getSettingValue)('country') || '');
    if (!parsedPhone) {
        return res.status(400).json({ error: 'Valid phone_e164 required', reason: 'invalid_phone' });
    }
    if (typeof body !== 'string' || !body.trim() || body.length > 4096) {
        return res.status(400).json({
            error: 'body must be a non-empty string of at most 4096 characters',
            reason: 'invalid_body',
        });
    }
    const db = (0, db_1.getDatabase)();
    const close = db.prepare("SELECT id FROM cash_closures WHERE id = ? AND scope = 'day'").get(id);
    if (!close)
        return res.status(404).json({ error: 'Cash close not found' });
    const userId = req.user?.userId ?? null;
    const result = await (0, shutdown_1.trackHttpRequestWork)(req, whatsapp.sendMessage({
        phoneE164: parsedPhone.e164,
        body,
        billId: null,
        customerId: null,
        kind: 'z_report',
        userId,
        signal: (0, shutdown_1.getHttpRequestSignal)(req),
    }));
    if (!result.ok) {
        if (result.reason === 'not_connected') {
            return res.json({ fallback: true, reason: 'not_connected' });
        }
        const status = result.reason === 'cooldown' || result.reason === 'rate_limited' ? 429 : 400;
        return res.status(status).json({ error: result.error, reason: result.reason });
    }
    return res.json({ success: true, messageId: result.messageId });
});
router.post('/daily-sales/whatsapp', (0, authorization_1.requirePermission)('reports.view'), (0, authorization_1.requirePermission)('reports.daily-sales.export'), (0, authorization_1.requirePermission)('whatsapp.use'), async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        const phoneE164 = payload.phone_e164;
        if (typeof phoneE164 !== 'string' || !phoneE164.trim()) {
            return res.status(400).json({ error: 'phone_e164 required', reason: 'phone_required' });
        }
        const parsedPhone = (0, phone_1.parsePhoneE164)(phoneE164.trim(), (0, db_1.getSettingValue)('country') || '');
        if (!parsedPhone) {
            return res
                .status(400)
                .json({ error: 'Valid phone_e164 required', reason: 'invalid_phone' });
        }
        const range = (0, daily_sales_export_1.resolveDailySalesExportRange)({
            date: payload.date,
            from: payload.from,
            to: payload.to,
            defaultDate: reportToday(),
        }, reportToday());
        const dataset = (0, daily_sales_export_1.buildDailySalesExportDataset)({
            from: range.fromDate,
            to: range.toDate,
        });
        const body = (0, daily_sales_export_1.formatDailySalesWhatsAppMessage)(dataset, {
            maxChars: whatsapp.MAX_BODY_CHARS,
        });
        const userId = req.user?.userId ?? null;
        const result = await (0, shutdown_1.trackHttpRequestWork)(req, whatsapp.sendMessage({
            phoneE164: parsedPhone.e164,
            body,
            billId: null,
            customerId: null,
            kind: 'daily_sales_report',
            userId,
            signal: (0, shutdown_1.getHttpRequestSignal)(req),
        }));
        if (!result.ok) {
            if (result.reason === 'not_connected') {
                return res.json({ fallback: true, reason: 'not_connected', body });
            }
            const status = result.reason === 'cooldown' || result.reason === 'rate_limited' ? 429 : 400;
            return res.status(status).json({ error: result.error, reason: result.reason });
        }
        const deliveryStatus = typeof whatsapp.waitForMessageAck === 'function' && result.messageId != null
            ? await (0, shutdown_1.trackHttpRequestWork)(req, whatsapp.waitForMessageAck(result.messageId, 1500, (0, shutdown_1.getHttpRequestSignal)(req)))
            : result.deliveryStatus ===
                'sent' || result.acknowledged === true
                ? 'sent'
                : 'submitted';
        return res.json({ success: true, deliveryStatus, messageId: result.messageId, body });
    }
    catch (error) {
        if (error instanceof daily_sales_export_1.DailySalesExportValidationError) {
            return res.status(400).json({ error: error.message, reason: 'invalid_range' });
        }
        const statusCode = typeof error === 'object' && error !== null
            ? error.statusCode
            : undefined;
        const message = error instanceof Error ? error.message : 'Internal server error';
        if (statusCode === 400) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'Invalid export request',
                reason: 'invalid_range',
            });
        }
        if (statusCode === 409) {
            return res.status(409).json({ error: message });
        }
        console.error('[API] Daily sales WhatsApp send error:', error);
        return res
            .status(statusCode || 500)
            .json({ error: statusCode ? message : 'Internal server error' });
    }
});
// Owner-only daily sales export (xlsx workbook, CSV parts, or print-styled HTML across 1..93 business days).
// Accounting lives in buildDailySalesExportDataset; serializers only encode.
router.get('/daily-sales/export', (0, authorization_1.requirePermission)('reports.daily-sales.export'), async (req, res) => {
    try {
        const range = (0, daily_sales_export_1.resolveDailySalesExportRange)({
            date: req.query.date,
            from: req.query.from,
            to: req.query.to,
            defaultDate: reportToday(),
        }, reportToday());
        const format = req.query.format === 'csv'
            ? 'csv'
            : req.query.format === 'xlsx'
                ? 'xlsx'
                : req.query.format === 'html'
                    ? 'html'
                    : null;
        if (!format) {
            return res.status(400).json({ error: 'format must be xlsx, csv, or html' });
        }
        const part = req.query.part === 'summary' ||
            req.query.part === 'daily' ||
            req.query.part === 'taxes' ||
            req.query.part === 'items' ||
            req.query.part === 'payments'
            ? req.query.part
            : undefined;
        if (format === 'csv' && !part) {
            return res.status(400).json({
                error: 'CSV export requires part=summary, part=daily, part=taxes, part=items or part=payments',
            });
        }
        const dataset = (0, daily_sales_export_1.buildDailySalesExportDataset)({
            from: range.fromDate,
            to: range.toDate,
        });
        const filename = (0, daily_sales_export_files_1.dailySalesExportFilename)({ fromDate: range.fromDate, toDate: range.toDate }, format, part);
        if (format === 'xlsx') {
            const buffer = await (0, daily_sales_export_files_1.serializeDailySalesExportXlsx)(dataset, {
                fractionDigits: (0, countries_2.getCurrencyFractionDigits)(dataset.summary.currency),
            });
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(buffer);
        }
        if (format === 'html') {
            const html = (0, daily_sales_export_files_1.serializeDailySalesExportHtml)(dataset, {
                businessName: (0, db_1.getSettingValue)('business_name') ?? undefined,
            });
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(html);
        }
        const csv = (0, daily_sales_export_files_1.serializeDailySalesExportCsv)(dataset, part);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csv);
    }
    catch (error) {
        if (error instanceof daily_sales_export_1.DailySalesExportValidationError) {
            return res.status(400).json({ error: error.message });
        }
        const statusCode = typeof error === 'object' && error !== null
            ? error.statusCode
            : undefined;
        const message = error instanceof Error ? error.message : 'Internal server error';
        if (statusCode === 400) {
            return res.status(400).json({ error: message });
        }
        if (statusCode === 409) {
            return res.status(409).json({ error: message });
        }
        console.error('[API] Daily sales export error:', error);
        res.status(statusCode || 500).json({ error: statusCode ? message : 'Internal server error' });
    }
});
// Owner-only compiled daily invoices export (print-styled A4 HTML for PDF/browser print across 1..366 business days).
router.get('/daily-invoices/export', (0, authorization_1.requirePermission)('reports.daily-sales.export'), async (req, res) => {
    try {
        const rawFormat = req.query.format === undefined || req.query.format === '' ? 'html' : req.query.format;
        if (rawFormat !== 'html') {
            return res.status(400).json({ error: 'format must be html' });
        }
        const range = (0, daily_sales_export_1.resolveDailySalesExportRange)({
            date: req.query.date,
            from: req.query.from,
            to: req.query.to,
            defaultDate: reportToday(),
        }, reportToday(), daily_invoices_export_1.DAILY_INVOICES_EXPORT_MAX_RANGE_DAYS);
        const dataset = (0, daily_invoices_export_1.buildDailyInvoicesExportDataset)({
            from: range.fromDate,
            to: range.toDate,
        });
        const html = (0, daily_invoices_export_1.serializeDailyInvoicesExportHtml)(dataset);
        const filename = (0, daily_invoices_export_1.dailyInvoicesExportFilename)({ fromDate: range.fromDate, toDate: range.toDate }, 'html');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(html);
    }
    catch (error) {
        if (error instanceof daily_sales_export_1.DailySalesExportValidationError) {
            return res.status(400).json({ error: error.message });
        }
        const statusCode = typeof error === 'object' && error !== null
            ? error.statusCode
            : undefined;
        const message = error instanceof Error ? error.message : 'Internal server error';
        if (statusCode === 400) {
            return res.status(400).json({ error: message });
        }
        if (statusCode === 409) {
            return res.status(409).json({ error: message });
        }
        console.error('[API] Daily invoices export error:', error);
        res.status(statusCode || 500).json({ error: statusCode ? message : 'Internal server error' });
    }
});
// Owner-only: one row per item sold with the bill's customer details (PII).
router.get('/customer-sales/export', (0, authorization_1.requirePermission)('reports.customer-sales.export'), async (req, res) => {
    try {
        const format = req.query.format === 'csv' ? 'csv' : req.query.format === 'xlsx' ? 'xlsx' : null;
        if (!format) {
            return res.status(400).json({ error: 'format must be xlsx or csv' });
        }
        const today = reportToday();
        const startDate = reportDate(req.query.start_date, today);
        const endDate = reportDate(req.query.end_date, startDate);
        const dataset = (0, customer_sales_export_1.buildCustomerSalesDataset)(startDate, endDate);
        const filename = (0, customer_sales_export_1.customerSalesExportFilename)(startDate, endDate, format);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        if (format === 'xlsx') {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(await (0, customer_sales_export_1.serializeCustomerSalesXlsx)(dataset));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        return res.send((0, customer_sales_export_1.serializeCustomerSalesCsv)(dataset));
    }
    catch (error) {
        if (error instanceof customer_sales_export_1.CustomerSalesRangeError) {
            return res.status(400).json({ error: error.message });
        }
        console.error('[API] Customer sales export error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.reportRoutes = router;
//# sourceMappingURL=reports.js.map