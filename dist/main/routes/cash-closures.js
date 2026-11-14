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
exports.cashClosureRoutes = exports.tenantTimezone = void 0;
exports.cashOperationFailurePayload = cashOperationFailurePayload;
exports.listCashDrawerMovementsForSession = listCashDrawerMovementsForSession;
exports.paymentMethodBreakdown = paymentMethodBreakdown;
exports.computeDayAggregates = computeDayAggregates;
exports.expectedCashFromAggregates = expectedCashFromAggregates;
exports.cashDrawerSalesAndRefunds = cashDrawerSalesAndRefunds;
exports.sumCashMovements = sumCashMovements;
exports.sessionExpectedCash = sessionExpectedCash;
exports.sessionFinancialTotals = sessionFinancialTotals;
exports.computeSessionAggregates = computeSessionAggregates;
exports.computePeriodAggregates = computePeriodAggregates;
/**
 * Day-close (cierre de caja, issue #649).
 *
 * One close per store per tenant business day. POST /api/cash-closures:
 *  - Owner-only (manager/cashier/server are 403).
 *  - Validates: YYYY-MM-DD format, not in the future, integer cents >= 0.
 *  - Recomputes the day's aggregates server-side (never trusts client totals)
 *    using the verbatim financial-summary template (main/routes/reports.ts)
 *    for display totals, plus the drawer-reality rules:
 *      * `expected_cash_cents`: opening float plus active Pay In, Pay Out, and
 *        Safe Drop movements, cash sales from each cash line's timestamp
 *        (includes partial tenders), and cash refunds by `refunds.created_at`
 *        (the day the cash left the drawer, not the day the original bill was
 *        paid).
 *      * `tax_components_json`: aggregated via `aggregateTaxComponents`
 *        against the spec's DisplayTaxComponent[] shape, so Z rows carry the
 *        same tax components the live report endpoint returns.
 *      * payment-method lines keyed by `b.paid_at` (not per-line timestamps)
 *        so an installment-paid bill lands whole on its settlement day,
 *        reconciling with gross/staff/tax; live reports keep per-line keys.
 *  - Snapshots the result with the operator's counted cash and stores one
 *    immutable row in `cash_closures`. Duplicate POST against the same
 *    `business_date` (scope='day') is rejected with 409 via SELECT-then-INSERT
 *    inside `withTxn`; the partial index `cash_closures_one_day` is the
 *    concurrency safety net.
 *
 * Sales flow is deliberately untouched: `createRefund`, `shift_id`, and
 * `refunds.shift_id` are unchanged — the drawer-reality attribution
 * (cash refunds by `refunds.created_at`) is read straight from the existing
 * `refunds` table without backfilling any column. The `scope='session'`
 * extension door is intentionally unused by this endpoint; session-style
 * closes arrive as separate rows with a different `scope` value.
 */
const crypto_1 = require("crypto");
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const whatsapp = __importStar(require("../services/whatsapp"));
const db_2 = require("../db");
const refund_1 = require("../services/refund");
const cash_day_close_guards_1 = require("../services/cash-day-close-guards");
const shift_session_gate_1 = require("../services/shift-session-gate");
const cash_drawer_movements_1 = require("../services/cash-drawer-movements");
Object.defineProperty(exports, "tenantTimezone", { enumerable: true, get: function () { return cash_drawer_movements_1.tenantTimezone; } });
const decimal_js_1 = __importDefault(require("decimal.js"));
const countries_1 = require("../countries");
const bills_1 = require("./bills");
const shutdown_1 = require("../shutdown");
const tax_components_1 = require("../services/tax-components");
const print_language_settings_1 = require("../lib/print-language-settings");
const sandbox_exclusion_1 = require("../services/sandbox-exclusion");
const print_1 = require("../../shared/print");
const operation_failure_1 = require("../lib/operation-failure");
const cloud_sync_1 = require("../services/cloud-sync");
const router = (0, express_1.Router)();
exports.cashClosureRoutes = router;
const MAX_NOTES_LENGTH = 500;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function cashOperationFailurePayload(req, errorMessage, capturePoint, outcome, displayCode) {
    const header = req.get('x-operation-id');
    const correlationId = (0, operation_failure_1.isOperationReference)(header) ? header : (0, crypto_1.randomUUID)();
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: capturePoint,
        outcome,
        correlation_id: correlationId,
        ...(displayCode ? { facts: { display_code: displayCode } } : {}),
    });
    if (!failure)
        return { error: errorMessage };
    req.diagnosticsCaptured = true;
    try {
        cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        /* Diagnostics must not affect cash handling. */
    }
    return {
        error: errorMessage,
        reason_code: failure.reason_code,
        operation: failure.operation,
        stage: failure.stage,
        classification: failure.classification,
        outcome: failure.outcome,
        correlation_id: failure.correlation_id,
        ...(failure.facts.display_code ? { display_code: failure.facts.display_code } : {}),
    };
}
function httpError(message, statusCode, diagnosticCode) {
    return Object.assign(new Error(message), {
        statusCode,
        ...(diagnosticCode ? { diagnosticCode } : {}),
    });
}
function tenantStartTime(db) {
    return (0, db_1.tenantBusinessDayStartTime)(db);
}
function validateBusinessDate(raw) {
    if (typeof raw !== 'string' || !ISO_DATE_RE.test(raw)) {
        throw httpError('business_date must use YYYY-MM-DD format', 400, 'business_date_invalid');
    }
    // Real-calendar-date guard: `Date.UTC(2026, 1, 30)` silently rolls over
    // into March, so a regex match is not enough. Round-trip the parsed
    // year/month/day and confirm the calendar matches the input.
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(5, 7));
    const day = Number(raw.slice(8, 10));
    const roundTrip = new Date(Date.UTC(year, month - 1, day));
    if (roundTrip.getUTCFullYear() !== year ||
        roundTrip.getUTCMonth() + 1 !== month ||
        roundTrip.getUTCDate() !== day) {
        throw httpError('business_date is not a real calendar date', 400, 'business_date_invalid');
    }
    // Tenant-local business date, not the host UTC clock: a date that is
    // "today" in the store's configured timezone and cutoff must never be
    // rejected as future even when the host's UTC clock is still on yesterday.
    // ISO date arithmetic on the YYYY-MM-DD string is timezone-safe.
    const todayLocal = (0, db_1.localDateInTimezone)(new Date(), (0, cash_drawer_movements_1.tenantTimezone)(), tenantStartTime());
    if (raw > todayLocal) {
        throw httpError('business_date cannot be in the future', 400, 'future_business_date');
    }
    return raw;
}
function validateCents(raw, field, allowZero = true) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
        throw httpError(`${field} must be an integer`, 400, 'amount_invalid');
    }
    if (raw < 0 || (!allowZero && raw === 0)) {
        throw httpError(`${field} must be >= ${allowZero ? 0 : 1}`, 400, 'amount_invalid');
    }
    if (!Number.isSafeInteger(raw)) {
        throw httpError(`${field} is out of range`, 400, 'amount_invalid');
    }
    return raw;
}
function validateMovementType(raw) {
    if (raw !== 'opening_float' && raw !== 'pay_in' && raw !== 'pay_out' && raw !== 'safe_drop') {
        throw httpError('movement_type is invalid', 400, 'movement_type_invalid');
    }
    return raw;
}
function validateMovementReason(raw, required) {
    if (raw === undefined || raw === null) {
        if (required)
            throw httpError('reason is required', 400, 'reason_required');
        return null;
    }
    if (typeof raw !== 'string')
        throw httpError('reason must be a string', 400, 'reason_invalid');
    const reason = raw.trim();
    if (required && reason.length === 0)
        throw httpError('reason is required', 400, 'reason_required');
    if (reason.length > cash_drawer_movements_1.MAX_MOVEMENT_REASON_LENGTH)
        throw httpError('reason is too long', 400, 'reason_too_long');
    return reason || null;
}
function listCashDrawerMovements(db, businessDate, includeVoided = true) {
    return db
        .prepare(`
    SELECT m.*, created_user.name AS created_by_name, voided_user.name AS voided_by_name
    FROM cash_drawer_movements m
    LEFT JOIN users created_user ON created_user.id = m.created_by
    LEFT JOIN users voided_user ON voided_user.id = m.voided_by
    WHERE m.business_date = ? ${includeVoided ? '' : 'AND m.voided_at IS NULL'}
    ORDER BY m.created_at DESC, m.id DESC
  `)
        .all(businessDate);
}
// Session movements prefer their recorded owner; only pre-v91 NULL-owner
// rows use the timestamp window.
function listCashDrawerMovementsForSession(db, sessionId, start, end, includeVoided = true) {
    return db
        .prepare(`
    SELECT m.*, created_user.name AS created_by_name, voided_user.name AS voided_by_name
    FROM cash_drawer_movements m
    LEFT JOIN users created_user ON created_user.id = m.created_by
    LEFT JOIN users voided_user ON voided_user.id = m.voided_by
    WHERE (m.cash_session_id = ? OR (m.cash_session_id IS NULL AND m.created_at >= ? AND m.created_at < ?))
      ${includeVoided ? '' : 'AND m.voided_at IS NULL'}
    ORDER BY m.created_at DESC, m.id DESC
  `)
        .all(sessionId, start, end);
}
function activeOpeningFloatCents(db, businessDate) {
    const row = db
        .prepare(`
    SELECT amount_cents
    FROM cash_drawer_movements
    WHERE business_date = ? AND movement_type = 'opening_float' AND voided_at IS NULL
    LIMIT 1
  `)
        .get(businessDate);
    return row ? Number(row.amount_cents) : null;
}
/**
 * Shape a stored `cash_closures` row into the snapshot the print primitive
 * consume. Single source of truth so the print body and the on-screen
 * Z share shape — the operator sees in the modal exactly what the printer
 * receives.
 * the operator's screen byte for byte:
 *  - `closed_by_name` resolves the operator's `users.name`, falling back
 *    to the raw id when the row was orphaned (staff deletion, etc.).
 *  - JSON columns (`payment_methods_json`, `staff_sales_json`,
 *    `tax_components_json`, `cash_movements_json`) are parsed into typed arrays;
 *    malformed snapshot data fails the print rather than omitting sections.
 *  - `__isReprint` is the synthetic flag the body builder uses to add
 *    the localized reprint marker; caller passes `true` for reprints.
 */
function shapeZReportSnapshot(db, row, isReprint) {
    const userRow = db.prepare(`SELECT name FROM users WHERE id = ?`).get(row.closed_by);
    const safeJson = (raw, field) => {
        if (typeof raw !== 'string')
            throw new Error(`Stored cash closure ${field} is missing`);
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed))
                throw new Error('expected an array');
            return parsed;
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : 'invalid JSON';
            console.error(`[CashClosures] Invalid stored ${field}:`, detail);
            throw new Error(`Stored cash closure ${field} is invalid`);
        }
    };
    return {
        ...row,
        closed_by_name: userRow?.name ?? row.closed_by,
        payment_methods: safeJson(row.payment_methods_json, 'payment_methods_json'),
        staff_sales: safeJson(row.staff_sales_json, 'staff_sales_json'),
        tax_components: safeJson(row.tax_components_json, 'tax_components_json'),
        cash_movements: safeJson(row.cash_movements_json, 'cash_movements_json'),
        __isReprint: isReprint,
    };
}
function paymentMethodBreakdown(db, opts) {
    const { startDate = '', endDate, paidOnly = false, excludeCancelledOrders = false, attributeRefundsToBillDate = false, keyByPaidAt = false, explicitWindow, } = opts;
    if (!explicitWindow && !startDate) {
        throw new Error('paymentMethodBreakdown requires startDate or explicitWindow');
    }
    const resolvedEndDate = endDate ?? startDate;
    const startTime = tenantStartTime(db);
    const [start, end] = explicitWindow ?? [
        (0, db_1.dayBoundsInTimezone)(startDate, (0, cash_drawer_movements_1.tenantTimezone)(), startTime)[0],
        (0, db_1.dayBoundsInTimezone)(resolvedEndDate, (0, cash_drawer_movements_1.tenantTimezone)(), startTime)[1],
    ];
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
    return db
        .prepare(`
    WITH payment_lines AS (
      SELECT b.paid_at, b.created_at, je.value AS line
      FROM bills b
      LEFT JOIN orders o ON o.id = b.order_id
      JOIN json_each(CASE
        WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array'
          THEN b.payment_details
        WHEN json_valid(b.payment_details)
          THEN json_array(b.payment_details)
        ELSE '[]'
      END) je
      WHERE b.payment_details IS NOT NULL
        AND b.created_at < ?
        AND (b.paid_at IS NULL OR b.paid_at >= ?)
        AND (? = 0 OR b.paid_at IS NOT NULL)
        AND (? = 0 OR COALESCE(o.status, '') != 'cancelled')
        AND json_type(je.value) = 'object'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    ), normalized AS (
      SELECT
        COALESCE(NULLIF(json_extract(line, '$.method'), ''), 'unknown') AS method,
        CAST(json_extract(line, '$.payment_method_id') AS INTEGER) AS payment_method_id,
        json_extract(line, '$.amount') AS amount,
        COALESCE(
          datetime(NULLIF(CASE WHEN ? = 1 THEN NULL ELSE json_extract(line, '$.timestamp') END, '')),
          datetime(NULLIF(paid_at, '')),
          datetime(NULLIF(created_at, ''))
        ) AS payment_time
      FROM payment_lines
      UNION ALL
      SELECT r.method, NULL, -(CAST(r.amount_cents AS REAL) / ?),
        datetime(CASE WHEN ? = 1 THEN b.paid_at ELSE r.created_at END)
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
      LEFT JOIN orders o ON o.id = b.order_id
      WHERE (? = 0 OR COALESCE(o.status, '') != 'cancelled')
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    )
    SELECT COALESCE(pm.name, normalized.method) AS method, COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN typeof(amount) IN ('integer', 'real') THEN amount ELSE 0 END), 0) AS total
    FROM normalized LEFT JOIN payment_methods pm ON pm.id = normalized.payment_method_id
    WHERE payment_time >= datetime(?) AND payment_time < datetime(?)
    GROUP BY COALESCE(pm.name, normalized.method)
    ORDER BY total DESC
  `)
        .all(end, start, paidOnly ? 1 : 0, excludeCancelledOrders ? 1 : 0, keyByPaidAt ? 1 : 0, minorFactor, attributeRefundsToBillDate ? 1 : 0, excludeCancelledOrders ? 1 : 0, start, end);
}
/**
 * Recompute every snapshot field for one tenant-local business_date.
 *
 * Display totals deliberately include cancelled-order bills: a paid bill's
 * cash already left the drawer and remains there until counted, regardless
 * of the order's later status. `financial-summary` does not apply a
 * cancelled-order filter either — this snapshot matches its display
 * totals by construction. The drawer-reality inputs (active movement totals,
 * the `expected_cash_cents` cash-only raw filter, and refunds-by-created_at)
 * are applied separately so the rest of the snapshot reconciles with
 * financial-summary.
 *
 * Exported so Wave 3 (the live X-report) can reuse this pipeline without
 * duplicating the template or the tax-components hydration. Returns a
 * plain `DayAggregates` shape already converted to INTEGER minor units.
 */
function computeDayAggregates(db, businessDate) {
    const [start, end] = (0, db_1.dayBoundsInTimezone)(businessDate, (0, cash_drawer_movements_1.tenantTimezone)(), tenantStartTime(db));
    return computePeriodAggregates(db, start, end, listCashDrawerMovements(db, businessDate, false), null);
}
/**
 * Single home for the expected-cash formula shared by day close, session
 * close, and the live session snapshot (#279): opening float plus active
 * movements plus cash sales minus cash refunds (drawer reality).
 */
function expectedCashFromAggregates(aggregates) {
    return (aggregates.openingFloatCents +
        aggregates.cashSalesCents +
        aggregates.payInCents -
        aggregates.payOutCents -
        aggregates.safeDropCents -
        aggregates.cashRefundsByCreatedAtCents);
}
// `b.paid_at` represents a timestamp-less line only when it is the single/final settling
// line; earlier pre-settlement installments stay anchored to `b.created_at`.
const LEGACY_STABLE_PAYMENT_LINE_TIME_SQL = `(
  CASE
    WHEN json_valid(b.payment_details)
      AND json_type(b.payment_details) = 'array'
      AND CAST(je.key AS INTEGER) < json_array_length(b.payment_details) - 1
    THEN COALESCE(
      datetime(NULLIF(json_extract(je.value, '$.timestamp'), '')),
      datetime(NULLIF(b.created_at, ''))
    )
    ELSE COALESCE(
      datetime(NULLIF(json_extract(je.value, '$.timestamp'), '')),
      datetime(NULLIF(b.paid_at, '')),
      datetime(NULLIF(b.created_at, ''))
    )
  END
)`;
/**
 * Drawer-reality cash inputs for one raw timestamp window: cash sales by each
 * payment line's timestamp (includes partial tenders before `paid_at` is set)
 * and cash refunds by created_at (the day the cash left the drawer). Display
 * gross/staff/tax still use `paid_at`; only expected-cash drawer math uses
 * this path. Shared by the full aggregate pipeline and session snapshots.
 */
function cashDrawerSalesAndRefunds(db, start, end, minorFactor) {
    const row = db
        .prepare(`
    WITH cash_named_custom_methods AS (
      SELECT id FROM payment_methods WHERE lower(trim(name)) = 'cash'
    ),
    payment_lines AS (
      SELECT
        CAST(json_extract(je.value, '$.amount') AS REAL) AS amount,
        COALESCE(NULLIF(json_extract(je.value, '$.method'), ''), '') AS method,
        CAST(json_extract(je.value, '$.payment_method_id') AS INTEGER) AS payment_method_id,
        ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} AS line_time
      FROM bills b
      JOIN json_each(
        CASE
          WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array'
            THEN b.payment_details
          WHEN json_valid(b.payment_details)
            THEN json_array(b.payment_details)
          ELSE '[]'
        END
      ) je
      WHERE b.created_at < datetime(?)
        AND (b.paid_at IS NULL OR b.paid_at >= datetime(?, '-1 day'))
        AND json_type(je.value) = 'object'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    ),
    cash_sales AS (
      SELECT COALESCE(SUM(pl.amount * ?), 0) AS sales_cents
      FROM payment_lines pl
      LEFT JOIN cash_named_custom_methods pm ON pm.id = pl.payment_method_id
      WHERE pl.line_time >= datetime(?) AND pl.line_time < datetime(?)
        AND (lower(trim(pl.method)) = 'cash' OR pm.id IS NOT NULL)
    ), cash_refunds AS (
      SELECT COALESCE(SUM(r.amount_cents), 0) AS refunds_cents
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
      WHERE lower(r.method) = 'cash'
        AND r.created_at >= ? AND r.created_at < ?
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    )
    SELECT
      (SELECT sales_cents FROM cash_sales) AS sales_cents,
      (SELECT refunds_cents FROM cash_refunds) AS refunds_cents
  `)
        .get(end, start, minorFactor, start, end, start, end);
    return {
        salesCents: Math.round(Number(row.sales_cents || 0)),
        refundsCents: Number(row.refunds_cents || 0),
    };
}
/**
 * Signed movement totals. Sessions carry the float on the session row, so
 * callers pass excludeOpeningFloat=true to avoid double-counting an
 * in-window opening_float movement; day close passes false.
 */
function sumCashMovements(movements, excludeOpeningFloat) {
    return movements.reduce((totals, movement) => {
        if (movement.movement_type === 'opening_float') {
            if (!excludeOpeningFloat)
                totals.openingFloatCents += movement.amount_cents;
        }
        if (movement.movement_type === 'pay_in')
            totals.payInCents += movement.amount_cents;
        if (movement.movement_type === 'pay_out')
            totals.payOutCents += movement.amount_cents;
        if (movement.movement_type === 'safe_drop')
            totals.safeDropCents += movement.amount_cents;
        return totals;
    }, { openingFloatCents: 0, payInCents: 0, payOutCents: 0, safeDropCents: 0 });
}
/**
 * Session-scoped expected cash: float + drawer movements + cash sales − cash
 * refunds. Attribution is ownership-first: rows carrying this session's
 * cash_session_id count regardless of timestamp because they were created
 * while it was open; pre-v91 NULL-owner rows fall back to opened_at→end.
 * opening_float movements are not summed here because
 * the float lives on the session row.
 *
 * Session and day expected cash share the same drawer classifier: built-in
 * cash plus configured payment methods whose name resolves to Cash (via
 * payment_method_id). The JSON scan is correctness-first; use an event ledger
 * if bill volume makes session polling hot.
 */
function sessionExpectedCash(db, session, end, movements) {
    const start = session.opened_at ?? end;
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
    const movementTotals = sumCashMovements(movements ?? listCashDrawerMovementsForSession(db, session.id, start, end, false), true);
    const eventTotals = db
        .prepare(`
    WITH payment_lines AS (
      SELECT
        CAST(json_extract(je.value, '$.amount') AS REAL) AS amount,
        COALESCE(NULLIF(json_extract(je.value, '$.method'), ''), '') AS method,
        CAST(json_extract(je.value, '$.payment_method_id') AS INTEGER) AS payment_method_id,
        CAST(json_extract(je.value, '$.cash_session_id') AS INTEGER) AS line_session,
        ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} AS line_time
      FROM bills b
      JOIN json_each(
        CASE
          WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array'
            THEN b.payment_details
          WHEN json_valid(b.payment_details)
            THEN json_array(b.payment_details)
          ELSE '[]'
        END
      ) je
      WHERE json_type(je.value) = 'object'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    ),
    cash_sales AS (
      SELECT COALESCE(SUM(pl.amount * ?), 0) AS sales_cents
      FROM payment_lines pl
      LEFT JOIN payment_methods pm ON pm.id = pl.payment_method_id AND lower(pm.name) = 'cash'
      WHERE (
          pl.line_session = ?
          OR (pl.line_session IS NULL AND pl.line_time >= datetime(?) AND pl.line_time < datetime(?))
        )
        AND (lower(pl.method) = 'cash' OR pm.id IS NOT NULL)
    ),
    cash_refunds AS (
      SELECT COALESCE(SUM(r.amount_cents), 0) AS refunds_cents
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
      WHERE lower(r.method) = 'cash'
        AND (
          r.cash_session_id = ?
          OR (r.cash_session_id IS NULL AND r.created_at >= ? AND r.created_at < ?)
        )
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    )
    SELECT
      (SELECT sales_cents FROM cash_sales) AS sales_cents,
      (SELECT refunds_cents FROM cash_refunds) AS refunds_cents
  `)
        .get(minorFactor, session.id, start, end, session.id, start, end);
    return (Number(session.opening_float_cents || 0) +
        Math.round(Number(eventTotals.sales_cents || 0)) +
        movementTotals.payInCents -
        movementTotals.payOutCents -
        movementTotals.safeDropCents -
        Number(eventTotals.refunds_cents || 0));
}
/** Sales and refunds attributed to a session for shift X/Z reports. */
function sessionFinancialTotals(db, session, end) {
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
    const row = db
        .prepare(`
    WITH payment_lines AS (
      SELECT b.id AS bill_id,
        CAST(ROUND(CAST(json_extract(je.value, '$.amount') AS REAL) * ?) AS INTEGER) AS amount_cents,
        COALESCE(NULLIF(json_extract(je.value, '$.method'), ''), 'unknown') AS method,
        CAST(json_extract(je.value, '$.cash_session_id') AS INTEGER) AS line_session,
        ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} AS line_time
      FROM bills b
      JOIN json_each(CASE
        WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array' THEN b.payment_details
        WHEN json_valid(b.payment_details) THEN json_array(b.payment_details)
        ELSE '[]' END) je
      WHERE json_type(je.value) = 'object'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    ),
    owned_payments AS (
      SELECT bill_id, amount_cents, method FROM payment_lines
      WHERE line_session = ?
        OR (line_session IS NULL AND line_time >= datetime(?) AND line_time < datetime(?))
    ),
    owned_refunds AS (
      SELECT r.amount_cents, r.method
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
      WHERE (
          r.cash_session_id = ?
          OR (r.cash_session_id IS NULL AND r.created_at >= ? AND r.created_at < ?)
        )
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    ),
    method_totals AS (
      SELECT method, COUNT(*) AS count, SUM(amount_cents) AS total_cents
      FROM (
        SELECT method, amount_cents FROM owned_payments
        UNION ALL
        SELECT method, -amount_cents FROM owned_refunds
      ) GROUP BY method
    )
    SELECT
      (SELECT COUNT(DISTINCT bill_id) FROM owned_payments) AS bill_count,
      (SELECT COUNT(*) FROM owned_refunds) AS refund_count,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM owned_payments) AS gross_cents,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM owned_refunds) AS refund_cents,
      (SELECT COALESCE(json_group_array(json_object(
        'method', method, 'count', count, 'total_cents', total_cents)), '[]')
        FROM method_totals) AS methods_json
  `)
        .get(minorFactor, session.id, session.opened_at, end, session.id, session.opened_at, end);
    const grossCollectedCents = Number(row.gross_cents || 0);
    const refundedCents = Number(row.refund_cents || 0);
    return {
        billCount: Number(row.bill_count || 0),
        refundCount: Number(row.refund_count || 0),
        grossCollectedCents,
        refundedCents,
        netCollectedCents: grossCollectedCents - refundedCents,
        paymentMethods: JSON.parse(row.methods_json),
    };
}
function roundComponentsToMinorUnits(components, minorFactor) {
    const exactMinors = components.map((comp) => new decimal_js_1.default(comp.amount).times(minorFactor));
    if (exactMinors.every((m) => m.isInteger())) {
        const compMinors = exactMinors.map((m) => m.toNumber());
        return {
            compMinors,
            totalMinor: compMinors.reduce((sum, minor) => sum + minor, 0),
        };
    }
    const totalExact = exactMinors.reduce((sum, m) => sum.plus(m), new decimal_js_1.default(0));
    const totalMinor = totalExact.toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP).toNumber();
    const compMinors = exactMinors.map((m) => m.isNegative() ? m.ceil().toNumber() : m.floor().toNumber());
    const delta = totalMinor - compMinors.reduce((sum, minor) => sum + minor, 0);
    if (delta !== 0 && compMinors.length > 0) {
        const sign = delta > 0 ? 1 : -1;
        const ranked = exactMinors
            .map((m, index) => ({
            index,
            remainder: sign > 0
                ? m.minus(compMinors[index]).toNumber()
                : new decimal_js_1.default(compMinors[index]).minus(m).toNumber(),
        }))
            .sort((a, b) => Math.abs(b.remainder - a.remainder) > 1e-9 ? b.remainder - a.remainder : a.index - b.index);
        for (let i = 0; i < Math.abs(delta); i++) {
            compMinors[ranked[i % ranked.length].index] += sign;
        }
    }
    return { compMinors, totalMinor };
}
function computeSessionAggregates(db, session, end) {
    const sessionMovements = listCashDrawerMovementsForSession(db, session.id, session.opened_at, end, false);
    const openingFloatCents = Number(session.opening_float_cents || 0);
    return {
        ...computePeriodAggregates(db, session.opened_at, end, sessionMovements, openingFloatCents, session),
        ...sessionFinancialTotals(db, session, end),
    };
}
/**
 * Window-based aggregation shared by day close and session close (#279).
 * Same queries as the day pipeline, parameterized by raw timestamp window
 * so session windows (opened_at → now, possibly crossing midnight) work
 * without touching day-close behavior.
 */
function computePeriodAggregates(db, start, end, movements, openingFloatOverride, session) {
    // Display gross — `SUM(paid_amount)` over the paid_at day window (NOT
    // SUM(total) over created_at). This matches financial-summary so display
    // totals reconcile with the existing report endpoint for the same day.
    const billRow = db
        .prepare(`
    SELECT
      COUNT(*) AS bill_count,
      COALESCE(SUM(b.paid_amount), 0) AS gross_collected
    FROM bills b
    WHERE b.paid_at >= ? AND b.paid_at < ?
      AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
  `)
        .get(start, end);
    // Display refunds — paid_at attribution, same as financial-summary.
    // Stored as INTEGER cents to match the `refunded_cents` column type and the
    // schema convention (`bills.paid_amount`, `refunds.amount_cents`). Display
    // / response-edge conversion happens only at the { zReport } boundary, never
    // in storage or in the storage-time net subtraction.
    const refundRow = db
        .prepare(`
    SELECT
      COUNT(*) AS refund_count,
      COALESCE(SUM(r.amount_cents), 0) AS refunded_cents
    FROM refunds r
    JOIN bills b ON b.id = r.bill_id
    WHERE b.paid_at >= ? AND b.paid_at < ?
      AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
  `)
        .get(start, end);
    // cash sales (drawer-reality side of the split): raw pre-join `method='cash'`
    // filter, paid_at window, no `payment_methods` name join. Reads amount via
    // json_extract on the line object (the same scalar format used elsewhere).
    // Cash refunds by `created_at` (drawer reality: cash left the drawer on
    // the day the refund was issued, not the day the original bill was paid).
    // `minorFactor` is bound as a SQL parameter (matching the refund CTE
    // pattern immediately below) so non-100 currencies (KWD factor 1000,
    // JPY factor 1) round-trip exactly.
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)((0, refund_1.getTenantCurrency)(db));
    const { salesCents, refundsCents } = cashDrawerSalesAndRefunds(db, start, end, minorFactor);
    const cashMovements = movements;
    const movementTotals = sumCashMovements(cashMovements, openingFloatOverride !== null);
    // Display payment-method totals — reuse paymentMethodBreakdown so display
    // numbers reconcile with the live financial-summary endpoint for the same day.
    // Keyed by paid_at (not per-line timestamps) so installment payments
    // land on the settlement day alongside gross/staff/tax (see B1 above).
    // Window attribution via explicitWindow; no date fields needed.
    const paymentMethodsRows = paymentMethodBreakdown(db, {
        paidOnly: true,
        attributeRefundsToBillDate: true,
        keyByPaidAt: true,
        explicitWindow: [start, end],
    });
    // Per-staff sales — same window as the bill count, keyed by paid_at so a
    // cross-midnight bill (created day-1, paid day-2) rolls into day-2's Z
    // (matches the gross/payment/expected windows above; cancels the prior
    // creation-time key, which produced a non-reconciling Z with respect to
    // the rest of the snapshot). Unpaid orders drop out: uncollected money
    // is not staff revenue for the day it was created.
    const staffSalesRows = session
        ? db
            .prepare(`
    WITH payment_lines AS (
      SELECT b.id AS bill_id,
        CAST(json_extract(je.value, '$.amount') AS REAL) AS amount,
        CAST(json_extract(je.value, '$.cash_session_id') AS INTEGER) AS line_session,
        ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} AS line_time
      FROM bills b
      JOIN json_each(CASE
        WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array' THEN b.payment_details
        WHEN json_valid(b.payment_details) THEN json_array(b.payment_details)
        ELSE '[]' END) je
      WHERE b.paid_at IS NOT NULL AND json_type(je.value) = 'object'
        AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    ),
    owned_bill_totals AS (
      SELECT bill_id, SUM(amount) AS session_paid_amount
      FROM payment_lines
      WHERE line_session = ?
        OR (line_session IS NULL AND line_time >= datetime(?) AND line_time < datetime(?))
      GROUP BY bill_id
    )
    SELECT u.id AS user_id, u.name AS name, u.role AS role,
      COALESCE(SUM(obt.session_paid_amount), 0) AS revenue,
      COUNT(b.id) AS orderCount
    FROM owned_bill_totals obt
    JOIN bills b ON b.id = obt.bill_id
    JOIN orders o ON o.id = b.order_id
    JOIN users u ON u.id = o.user_id
    GROUP BY u.id
    ORDER BY revenue DESC
    LIMIT 20
  `)
            .all(session.id, session.opened_at, end)
        : db
            .prepare(`
    SELECT u.id AS user_id, u.name AS name, u.role AS role,
      COALESCE(SUM(b.paid_amount), 0) AS revenue,
      COUNT(b.id) AS orderCount
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    JOIN users u ON u.id = o.user_id
    WHERE b.paid_at >= ? AND b.paid_at < ?
      AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    GROUP BY u.id
    ORDER BY revenue DESC
    LIMIT 20
  `)
            .all(start, end);
    const bills = session
        ? db
            .prepare(`
    SELECT b.id, b.order_id, b.split_group_id, b.total, b.paid_at, b.tax_amount, b.tax_snapshot, b.tax_breakdown
    FROM bills b
    LEFT JOIN orders o ON o.id = b.order_id
    WHERE b.payment_details IS NOT NULL
      AND (
        NULLIF(TRIM(b.paid_at), '') IS NOT NULL
        OR (o.id IS NOT NULL AND COALESCE(o.status, '') != 'cancelled')
      )
      AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
      AND EXISTS (
        SELECT 1
        FROM json_each(CASE
          WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array' THEN b.payment_details
          WHEN json_valid(b.payment_details) THEN json_array(b.payment_details)
          ELSE '[]' END) je
        WHERE json_type(je.value) = 'object'
          AND (
            (
              NULLIF(json_extract(je.value, '$.cash_session_id'), '') IS NOT NULL
              AND CAST(json_extract(je.value, '$.cash_session_id') AS INTEGER) = ?
            )
            OR (
              NULLIF(json_extract(je.value, '$.cash_session_id'), '') IS NULL
              AND ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} >= datetime(?)
              AND ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} < datetime(?)
              AND COALESCE(
                (
                  SELECT cs.id
                  FROM cash_sessions cs
                  WHERE ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} >= datetime(cs.opened_at)
                    AND (
                      cs.closed_at IS NULL
                      OR ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} < datetime(cs.closed_at)
                    )
                  ORDER BY datetime(cs.opened_at) DESC, cs.id DESC
                  LIMIT 1
                ),
                ?
              ) = ?
            )
          )
      )
    ORDER BY COALESCE(b.paid_at, b.created_at), b.id
  `)
            .all(session.id, session.opened_at, end, shift_session_gate_1.NO_CASH_SESSION_ID, session.id)
        : db
            .prepare(`
    SELECT b.id, b.order_id, b.split_group_id, b.total, b.paid_at, b.tax_amount, b.tax_snapshot, b.tax_breakdown
    FROM bills b
    WHERE b.paid_at >= ? AND b.paid_at < ?
      AND ${(0, sandbox_exclusion_1.deliverySandboxExclusionSql)('b.order_id')}
    ORDER BY b.paid_at, b.id
  `)
            .all(start, end);
    const orders = (0, bills_1.getOrdersWithItemsForBills)(db, bills);
    const taxDocuments = bills.map((bill) => ({
        tax_amount: bill.tax_amount,
        tax_snapshot: bill.tax_snapshot,
        tax_breakdown: bill.tax_breakdown,
        items: orders.get(Number(bill.id))?.items || [],
    }));
    let taxComponents;
    if (!session) {
        taxComponents = (0, tax_components_1.aggregateTaxComponents)(taxDocuments);
    }
    else {
        const billPaymentLinesStmt = db.prepare(`
      WITH lines AS (
        SELECT
          CAST(je.key AS INTEGER) AS line_index,
          json_extract(je.value, '$.amount') AS raw_amount,
          NULLIF(json_extract(je.value, '$.cash_session_id'), '') AS raw_session_id,
          ${LEGACY_STABLE_PAYMENT_LINE_TIME_SQL} AS line_time
        FROM bills b
        JOIN json_each(CASE
          WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array' THEN b.payment_details
          WHEN json_valid(b.payment_details) THEN json_array(b.payment_details)
          ELSE '[]'
        END) je
        WHERE b.id = ? AND json_type(je.value) = 'object'
      )
      SELECT
        raw_amount,
        CASE
          WHEN raw_session_id IS NOT NULL THEN
            CASE WHEN CAST(raw_session_id AS INTEGER) = ? THEN 1 ELSE 0 END
          WHEN line_time >= datetime(?) AND line_time < datetime(?) THEN
            CASE
              WHEN COALESCE(
                (
                  SELECT cs.id
                  FROM cash_sessions cs
                  WHERE line_time >= datetime(cs.opened_at)
                    AND (cs.closed_at IS NULL OR line_time < datetime(cs.closed_at))
                  ORDER BY datetime(cs.opened_at) DESC, cs.id DESC
                  LIMIT 1
                ),
                ?
              ) = ? THEN 1
              ELSE 0
            END
          ELSE 0
        END AS owned_within_end
      FROM lines
      ORDER BY line_index ASC
    `);
        const perBillComponents = bills.map((bill, billIndex) => {
            const doc = taxDocuments[billIndex];
            const rawLines = billPaymentLinesStmt.all(bill.id, session.id, session.opened_at, end, shift_session_gate_1.NO_CASH_SESSION_ID, session.id);
            const paymentLines = rawLines.map((line) => {
                let amountMinor = 0;
                if (typeof line.raw_amount === 'number' || typeof line.raw_amount === 'string') {
                    try {
                        const dec = new decimal_js_1.default(line.raw_amount);
                        if (dec.isFinite() && dec.gt(0)) {
                            amountMinor = dec
                                .times(minorFactor)
                                .toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP)
                                .toNumber();
                        }
                    }
                    catch {
                        amountMinor = 0;
                    }
                }
                return {
                    amountMinor,
                    ownedWithinEnd: Number(line.owned_within_end) === 1,
                };
            });
            const ownedWithinEndLines = paymentLines.filter((line) => line.ownedWithinEnd);
            if (ownedWithinEndLines.length === 0)
                return [];
            const sumAllLineMinors = paymentLines.reduce((sum, line) => sum + line.amountMinor, 0);
            let billTotalFromCol = 0;
            if (bill.total !== null && bill.total !== undefined) {
                try {
                    const totalDec = new decimal_js_1.default(bill.total);
                    if (totalDec.isFinite() && totalDec.gt(0)) {
                        billTotalFromCol = totalDec
                            .times(minorFactor)
                            .toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP)
                            .toNumber();
                    }
                }
                catch {
                    billTotalFromCol = 0;
                }
            }
            const isSettled = bill.paid_at !== null && String(bill.paid_at).trim() !== '';
            const billTotalMinor = isSettled
                ? sumAllLineMinors
                : Math.max(billTotalFromCol, sumAllLineMinors);
            const ownedMinorSum = ownedWithinEndLines.reduce((sum, line) => sum + line.amountMinor, 0);
            if (paymentLines.length > 0 &&
                ownedWithinEndLines.length === paymentLines.length &&
                (isSettled || (billTotalMinor > 0 && ownedMinorSum >= billTotalMinor))) {
                return (0, tax_components_1.resolveTaxComponents)(doc);
            }
            const docComponents = (0, tax_components_1.resolveTaxComponents)(doc);
            if (docComponents.length === 0)
                return [];
            const { compMinors, totalMinor } = roundComponentsToMinorUnits(docComponents, minorFactor);
            let remainingPoolMinor = billTotalMinor;
            let remainingCompMinors = [...compMinors];
            let remainingTotalMinor = totalMinor;
            const sessionCompMinors = new Array(docComponents.length).fill(0);
            for (const line of paymentLines) {
                const lineMinor = line.amountMinor;
                let lineShares;
                if (lineMinor <= 0 && remainingPoolMinor > 0) {
                    lineShares = new Array(docComponents.length).fill(0);
                }
                else if (remainingPoolMinor - lineMinor <= 0) {
                    lineShares = [...remainingCompMinors];
                    remainingCompMinors = new Array(docComponents.length).fill(0);
                    remainingTotalMinor = 0;
                    remainingPoolMinor = 0;
                }
                else {
                    const pairWeights = [lineMinor, remainingPoolMinor - lineMinor];
                    const entries = remainingCompMinors.map((minor) => ({
                        allocations: (0, bills_1.allocateSignedMinorUnits)(minor, pairWeights),
                    }));
                    if (entries.length > 1) {
                        const targetPair = (0, bills_1.allocateSignedMinorUnits)(remainingTotalMinor, pairWeights);
                        (0, bills_1.reconcileSnapshotAllocations)(entries, targetPair);
                    }
                    lineShares = entries.map((entry) => entry.allocations[0]);
                    remainingCompMinors = entries.map((entry) => entry.allocations[1]);
                    remainingTotalMinor = remainingCompMinors.reduce((sum, minor) => sum + minor, 0);
                    remainingPoolMinor -= lineMinor;
                }
                if (line.ownedWithinEnd) {
                    for (let i = 0; i < docComponents.length; i++) {
                        sessionCompMinors[i] += lineShares[i];
                    }
                }
            }
            const allocated = [];
            for (let i = 0; i < docComponents.length; i++) {
                const minorShare = sessionCompMinors[i];
                if (minorShare === 0 && compMinors[i] !== 0)
                    continue;
                allocated.push({
                    title: docComponents[i].title,
                    rate: docComponents[i].rate,
                    amount: new decimal_js_1.default(minorShare).dividedBy(minorFactor).toDecimalPlaces(6).toNumber(),
                });
            }
            return allocated;
        });
        taxComponents = (0, tax_components_1.mergeDisplayTaxComponents)(perBillComponents);
    }
    const grossCollectedCents = Math.round(Number(billRow.gross_collected || 0) * minorFactor);
    const refundedCents = Number(refundRow.refunded_cents || 0);
    return {
        billCount: Number(billRow.bill_count || 0),
        refundCount: Number(refundRow.refund_count || 0),
        grossCollectedCents,
        refundedCents,
        netCollectedCents: grossCollectedCents - refundedCents,
        cashSalesCents: salesCents,
        cashRefundsByCreatedAtCents: refundsCents,
        openingFloatCents: openingFloatOverride ?? movementTotals.openingFloatCents,
        payInCents: movementTotals.payInCents,
        payOutCents: movementTotals.payOutCents,
        safeDropCents: movementTotals.safeDropCents,
        cashMovements,
        paymentMethods: paymentMethodsRows.map((row) => ({
            method: row.method,
            count: Number(row.count || 0),
            total_cents: Math.round(Number(row.total || 0) * minorFactor),
        })),
        staffSales: staffSalesRows.map((row) => ({
            user_id: row.user_id,
            name: row.name,
            role: row.role,
            revenue_cents: Math.round(Number(row.revenue || 0) * minorFactor),
            orderCount: Number(row.orderCount || 0),
        })),
        taxComponents,
    };
}
router.get('/movements', (0, authorization_1.requirePermission)('cash.movements.manage'), (req, res) => {
    try {
        const businessDate = validateBusinessDate(req.query.business_date);
        res.json({
            businessDate,
            movements: listCashDrawerMovements((0, db_1.getDatabase)(), businessDate),
        });
    }
    catch (error) {
        const status = error.statusCode || 500;
        if (status === 500)
            console.error('[CashClosures] Movement list error:', error);
        res.status(status).json({
            error: status === 500 ? 'Internal server error' : error.message || 'Internal server error',
        });
    }
});
router.post('/movements', (0, authorization_1.requirePermission)('cash.movements.manage'), (req, res) => {
    let operationCommitted = false;
    let transactionBodyCompleted = false;
    try {
        const body = req.body || {};
        const businessDate = validateBusinessDate(body.business_date);
        const movementType = validateMovementType(body.movement_type);
        const amountCents = validateCents(body.amount_cents, 'amount_cents', movementType === 'opening_float');
        const reason = validateMovementReason(body.reason, movementType !== 'opening_float');
        const createdBy = String(req.user?.userId || '');
        const role = String(req.user?.role || '');
        if (!createdBy)
            throw httpError('Authentication required', 401);
        const db = (0, db_1.getDatabase)();
        const id = (0, db_1.withTxn)(() => {
            let targetSessionId;
            if (body.cash_session_id !== undefined && body.cash_session_id !== null) {
                const requestedSessionId = Number(body.cash_session_id);
                if (!Number.isInteger(requestedSessionId) || requestedSessionId <= 0) {
                    throw httpError('cash_session_id must be a positive integer', 400);
                }
                const targetSession = db
                    .prepare(`SELECT id, opened_by, status FROM cash_sessions WHERE id = ?`)
                    .get(requestedSessionId);
                if (!targetSession) {
                    throw httpError('Open shift not found', 404, 'cash_session_not_found');
                }
                if (targetSession.status !== 'open') {
                    throw httpError('Shift is already closed', 409, 'session_already_closed');
                }
                if (role !== 'owner' && role !== 'manager' && targetSession.opened_by !== createdBy) {
                    throw httpError('Only an owner or manager can record movements for another staff shift', 403, 'session_owner_required');
                }
                targetSessionId = targetSession.id;
            }
            else {
                // Shift enforcement (#279): every movement touches the drawer.
                (0, shift_session_gate_1.requireOpenSessionForCash)(db, createdBy);
                targetSessionId = (0, shift_session_gate_1.getOpenSession)(db, createdBy)?.id ?? shift_session_gate_1.NO_CASH_SESSION_ID;
            }
            let movementId;
            try {
                movementId = (0, cash_drawer_movements_1.insertCashDrawerMovement)(db, {
                    businessDate,
                    movementType,
                    amountCents,
                    reason,
                    createdBy,
                    cashSessionId: targetSessionId,
                });
            }
            catch (error) {
                if (error.code === 'day_closed') {
                    throw httpError('This day is already closed', 409, 'day_already_closed');
                }
                if (String(error?.message || '').includes('cash_drawer_one_opening_float') ||
                    (movementType === 'opening_float' &&
                        String(error?.message || '').includes('cash_drawer_movements.business_date'))) {
                    throw httpError('An opening float is already recorded for this day', 409, 'opening_float_exists');
                }
                throw error;
            }
            transactionBodyCompleted = true;
            return movementId;
        });
        operationCommitted = true;
        const movement = db
            .prepare(`
      SELECT m.*, created_user.name AS created_by_name, voided_user.name AS voided_by_name
      FROM cash_drawer_movements m
      LEFT JOIN users created_user ON created_user.id = m.created_by
      LEFT JOIN users voided_user ON voided_user.id = m.voided_by
      WHERE m.id = ?
    `)
            .get(id);
        res.status(201).json({ movement });
    }
    catch (error) {
        const status = error.statusCode || 500;
        if (status === 500)
            console.error('[CashClosures] Movement create error:', error);
        const safeMessage = status === 500 ? 'Internal server error' : error.message || 'Internal server error';
        const payload = operationCommitted
            ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.movement.create.completion', 'applied')
            : status >= 500
                ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.movement.create.persistence', transactionBodyCompleted ? 'unknown' : 'not_applied')
                : error.diagnosticCode
                    ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.movement.create.validation', 'not_applied', error.diagnosticCode)
                    : { error: safeMessage };
        res.status(status).json(payload);
    }
});
router.post('/movements/:id/void', (0, authorization_1.requirePermission)('cash.movements.void'), (req, res) => {
    let operationCommitted = false;
    let transactionBodyCompleted = false;
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0)
            throw httpError('id must be a positive integer', 400, 'movement_id_invalid');
        const reason = validateMovementReason(req.body?.reason, true);
        const voidedBy = String(req.user?.userId || '');
        if (!voidedBy)
            throw httpError('Authentication required', 401);
        const db = (0, db_1.getDatabase)();
        (0, db_1.withTxn)(() => {
            const movement = db.prepare(`SELECT * FROM cash_drawer_movements WHERE id = ?`).get(id);
            if (!movement)
                throw httpError('Cash movement not found', 404, 'movement_unavailable');
            if (movement.voided_at)
                throw httpError('Cash movement is already voided', 409, 'movement_already_voided');
            if ((0, cash_drawer_movements_1.closedDayExists)(db, movement.business_date))
                throw httpError('This day is already closed', 409, 'day_already_closed');
            // Money moved by an expense entry is corrected through the expense
            // ledger: the reversal writes the offsetting row and keeps this link.
            if (db.prepare('SELECT id FROM expense_payments WHERE cash_movement_id = ? LIMIT 1').get(id)) {
                throw httpError('This movement belongs to an expense payment; reverse the payment from the expense ledger instead', 409);
            }
            db.prepare(`
        UPDATE cash_drawer_movements
        SET voided_at = ?, voided_by = ?, void_reason = ?
        WHERE id = ? AND voided_at IS NULL
      `).run((0, db_1.now)(), voidedBy, reason, id);
            transactionBodyCompleted = true;
        });
        operationCommitted = true;
        const movement = db
            .prepare(`
      SELECT m.*, created_user.name AS created_by_name, voided_user.name AS voided_by_name
      FROM cash_drawer_movements m
      LEFT JOIN users created_user ON created_user.id = m.created_by
      LEFT JOIN users voided_user ON voided_user.id = m.voided_by
      WHERE m.id = ?
    `)
            .get(id);
        res.json({ movement });
    }
    catch (error) {
        const status = error.statusCode || 500;
        if (status === 500)
            console.error('[CashClosures] Movement void error:', error);
        const safeMessage = status === 500 ? 'Internal server error' : error.message || 'Internal server error';
        const payload = operationCommitted
            ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.movement.void.completion', 'applied')
            : status >= 500
                ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.movement.void.persistence', transactionBodyCompleted ? 'unknown' : 'not_applied')
                : error.diagnosticCode
                    ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.movement.void.validation', 'not_applied', error.diagnosticCode)
                    : { error: safeMessage };
        res.status(status).json(payload);
    }
});
router.post('/', (0, authorization_1.requirePermission)('cash.day-close'), (req, res) => {
    let operationCommitted = false;
    let transactionBodyCompleted = false;
    let claimedZReport = null;
    try {
        const body = req.body || {};
        const businessDate = validateBusinessDate(body.business_date);
        const requestedOpeningFloatCents = validateCents(body.opening_float_cents, 'opening_float_cents');
        const countedCashCents = validateCents(body.counted_cash_cents, 'counted_cash_cents');
        if (typeof body.notes === 'string' && body.notes.length > MAX_NOTES_LENGTH) {
            throw httpError('notes is too long', 400, 'notes_too_long');
        }
        const notes = typeof body.notes === 'string' ? body.notes : null;
        const closedBy = String(req.user?.userId || '');
        if (!closedBy)
            throw httpError('Authentication required', 401);
        const db = (0, db_1.getDatabase)();
        const blockingSessions = (0, cash_day_close_guards_1.openSessionsBlockingDayClose)(db, businessDate);
        const blockingSession = blockingSessions[0];
        if (blockingSession) {
            throw Object.assign(httpError(`Close open shift #${blockingSession.id} (${blockingSession.opened_by_name}) before closing business day ${businessDate}`, 409, 'open_shift_blocks_day_close'), {
                blockingShift: {
                    id: blockingSession.id,
                    opened_by_name: blockingSession.opened_by_name,
                    opened_at: blockingSession.opened_at,
                },
                blockingShifts: blockingSessions.map((s) => ({
                    id: s.id,
                    opened_by: s.opened_by,
                    opened_by_name: s.opened_by_name,
                    opened_at: s.opened_at,
                })),
            });
        }
        const [periodStart, periodEnd] = (0, db_1.dayBoundsInTimezone)(businessDate, (0, cash_drawer_movements_1.tenantTimezone)(), tenantStartTime(db));
        // SELECT-then-INSERT inside withTxn matches the customers.ts uniqueness
        // pattern; the partial index `cash_closures_one_day ... WHERE scope='day'`
        // is the concurrency safety net (a concurrent winner sees 409 here, a
        // race that slips past SELECT hits SQLITE_CONSTRAINT, mapped below).
        const result = (0, db_1.withTxn)(() => {
            const existing = db
                .prepare(`SELECT id FROM cash_closures WHERE business_date = ? AND scope = 'day' LIMIT 1`)
                .get(businessDate);
            if (existing) {
                throw httpError('This day is already closed', 409, 'day_already_closed');
            }
            const recordedOpeningFloatCents = activeOpeningFloatCents(db, businessDate);
            if (recordedOpeningFloatCents !== null &&
                recordedOpeningFloatCents !== requestedOpeningFloatCents) {
                throw httpError('The opening float already recorded for this day does not match', 409, 'opening_float_mismatch');
            }
            if (recordedOpeningFloatCents === null) {
                db.prepare(`
          INSERT INTO cash_drawer_movements (
            business_date, movement_type, amount_cents, reason, created_by, created_at
          ) VALUES (?, 'opening_float', ?, 'Opening float', ?, ?)
        `).run(businessDate, requestedOpeningFloatCents, closedBy, (0, db_1.now)());
            }
            const aggregates = computeDayAggregates(db, businessDate);
            // Snapshot math keeps every cash movement explicit (see
            // expectedCashFromAggregates); variance = counted − expected
            const expectedCashCents = expectedCashFromAggregates(aggregates);
            const varianceCents = countedCashCents - expectedCashCents;
            let zNumber;
            try {
                zNumber = (0, db_2.nextZNumber)();
            }
            catch (err) {
                throw httpError(`Could not allocate Z number: ${err?.message || 'sequence failure'}`, 500);
            }
            const createdAt = (0, db_1.now)();
            try {
                db.prepare(`
          INSERT INTO cash_closures (
            scope, business_date, period_start, period_end,
            opening_float_cents, expected_cash_cents, counted_cash_cents, variance_cents,
            gross_collected_cents, refunded_cents, net_collected_cents,
            bill_count, refund_count,
            payment_methods_json, staff_sales_json, tax_components_json,
            pay_in_cents, pay_out_cents, safe_drop_cents, cash_movements_json,
            z_number, closed_by, notes, created_at
          ) VALUES (
            'day', ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?
          )
        `).run(businessDate, periodStart, periodEnd, aggregates.openingFloatCents, expectedCashCents, countedCashCents, varianceCents, aggregates.grossCollectedCents, aggregates.refundedCents, aggregates.netCollectedCents, aggregates.billCount, aggregates.refundCount, JSON.stringify(aggregates.paymentMethods), JSON.stringify(aggregates.staffSales), JSON.stringify(aggregates.taxComponents), aggregates.payInCents, aggregates.payOutCents, aggregates.safeDropCents, JSON.stringify(aggregates.cashMovements), zNumber, closedBy, notes, createdAt);
            }
            catch (err) {
                // Race: another writer slipped through between the SELECT and this
                // INSERT — the partial index turns this into a clean 409.
                const msg = String(err?.message || '');
                if (msg.includes('UNIQUE') || msg.includes('cash_closures_one_day')) {
                    throw httpError('This day is already closed', 409, 'day_already_closed');
                }
                throw err;
            }
            const id = Number(db
                .prepare(`SELECT id FROM cash_closures WHERE business_date = ? AND scope = 'day'`)
                .get(businessDate).id);
            claimedZReport = null;
            if (typeof whatsapp.claimDayCloseZReportAttempt === 'function') {
                db.exec('SAVEPOINT z_report_claim');
                try {
                    claimedZReport = whatsapp.claimDayCloseZReportAttempt(id);
                    db.exec('RELEASE SAVEPOINT z_report_claim');
                }
                catch (claimErr) {
                    try {
                        db.exec('ROLLBACK TO SAVEPOINT z_report_claim');
                        db.exec('RELEASE SAVEPOINT z_report_claim');
                    }
                    catch {
                        /* ignore */
                    }
                    whatsapp.releaseClaimedDayCloseZReportAttempt?.(claimedZReport?.messageId);
                    claimedZReport = null;
                    console.warn('[CashClosures] Automatic Z-report claim skipped after error:', claimErr);
                }
            }
            transactionBodyCompleted = true;
            return {
                id,
                scope: 'day',
                business_date: businessDate,
                period_start: periodStart,
                period_end: periodEnd,
                opening_float_cents: aggregates.openingFloatCents,
                expected_cash_cents: expectedCashCents,
                counted_cash_cents: countedCashCents,
                variance_cents: varianceCents,
                gross_collected_cents: aggregates.grossCollectedCents,
                refunded_cents: aggregates.refundedCents,
                net_collected_cents: aggregates.netCollectedCents,
                bill_count: aggregates.billCount,
                refund_count: aggregates.refundCount,
                payment_methods: aggregates.paymentMethods,
                staff_sales: aggregates.staffSales,
                tax_components: aggregates.taxComponents,
                pay_in_cents: aggregates.payInCents,
                pay_out_cents: aggregates.payOutCents,
                safe_drop_cents: aggregates.safeDropCents,
                cash_movements: aggregates.cashMovements,
                z_number: zNumber,
                closed_by: closedBy,
                notes,
                created_at: createdAt,
            };
        });
        operationCommitted = true;
        res.status(201).json({ zReport: result });
        const activeClaim = claimedZReport;
        const preclaimedMessageId = activeClaim?.messageId;
        try {
            void whatsapp.triggerDayCloseZReport(result.id, preclaimedMessageId).catch((err) => {
                whatsapp.releaseClaimedDayCloseZReportAttempt?.(preclaimedMessageId);
                console.warn('[CashClosures] Automatic Z-report WhatsApp dispatch error:', err);
            });
        }
        catch (err) {
            whatsapp.releaseClaimedDayCloseZReportAttempt?.(preclaimedMessageId);
            console.warn('[CashClosures] Automatic Z-report WhatsApp dispatch error:', err);
        }
    }
    catch (error) {
        const uncommittedClaim = claimedZReport;
        if (!operationCommitted && uncommittedClaim) {
            whatsapp.releaseClaimedDayCloseZReportAttempt?.(uncommittedClaim.messageId);
            claimedZReport = null;
        }
        const status = error.statusCode || 500;
        if (status === 500)
            console.error('[CashClosures] Internal error:', error);
        const safeMessage = status === 500 ? 'Internal server error' : error.message || 'Internal server error';
        const payload = operationCommitted
            ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.day.close.completion', 'applied')
            : status >= 500
                ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.day.close.persistence', transactionBodyCompleted ? 'unknown' : 'not_applied')
                : error.diagnosticCode
                    ? cashOperationFailurePayload(req, safeMessage, 'fc.backend.cash.day.close.validation', 'not_applied', error.diagnosticCode)
                    : { error: safeMessage };
        if (error?.blockingShift) {
            payload.blocking_shift = error.blockingShift;
        }
        if (error?.blockingShifts) {
            payload.blocking_shifts = error.blockingShifts;
        }
        res.status(status).json(payload);
    }
});
// ── POST /:id/print — dispatch the stored Z to the default printer ──────────
// Owner/manager/cashier may print; day-close rows additionally require the
// owner role (checked after the row loads). The forced drawer pulse is appended by `printZReport` itself
// (bypassing bill-bound `shouldPulseForPayment`, spec #649). WebUSB printers
// return `{ bytes: number[] }` for the frontend to dispatch; network/usb
// printers go through the backend socket. The Z row is never mutated.
router.post('/:id/print', (0, authorization_1.requirePermission)('printing.execute'), async (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'id must be a positive integer' });
        }
        const row = db.prepare(`SELECT * FROM cash_closures WHERE id = ?`).get(id);
        if (!row)
            return res.status(404).json({ error: 'Cash closure not found' });
        // Session Z rows print for the shift roles; day-close Z stays owner-only.
        if (row.scope !== 'session' && req.user?.role !== 'owner') {
            return res.status(403).json({ error: 'Only owners can print day-close reports' });
        }
        const isReprint = req.body && req.body.isReprint === true;
        // F6: resolve the operator's display name via users(id → name) so the
        // printed Z shows the operator (not the raw user id). Falls back to the
        // id string when the user row is missing (e.g. historical data after a
        // staff deletion).
        const snapshot = shapeZReportSnapshot(db, row, isReprint);
        const languageRow = db.prepare(`SELECT value FROM settings WHERE key = 'language'`).get();
        const zPolicy = (0, print_language_settings_1.parseStoredLanguagePolicy)(print_language_settings_1.Z_REPORT_LANGUAGE_POLICY_KEY, db
            .prepare('SELECT value FROM settings WHERE key = ?')
            .get(print_language_settings_1.Z_REPORT_LANGUAGE_POLICY_KEY)?.value);
        const zLanguages = (0, print_1.resolveReceiptLanguages)(zPolicy, languageRow?.value || 'en');
        snapshot.__language = zLanguages[0];
        if (zLanguages[1])
            snapshot.__additionalLanguage = zLanguages[1];
        // Resolve the default receipt printer server-side so the WebUSB branch
        // is reachable end-to-end (mirrors `main/routes/printers.ts:304-339`,
        // bytes branch `:329-331`). `getPrinterConfig()` inside the helper
        // excludes webusb; selecting it here closes that gap.
        const printer = db.prepare(`SELECT * FROM printers WHERE is_default = 1`).get();
        if (!printer)
            return res.status(409).json({ error: 'No default printer configured' });
        const { printZReport } = require('../printers/thermal');
        // Thread request cancellation through the print job. The resolved Z
        // language policy is carried only in this print snapshot.
        const result = await printZReport(snapshot, (0, shutdown_1.getHttpRequestSignal)(req), printer);
        if (printer.connection_type === 'webusb' && result?.bytes) {
            // Return the FULL bytes including the forced drawer pulse; the renderer
            // dispatches them over WebUSB exactly as the test-page endpoint does.
            return res.json({
                success: true,
                webusb: true,
                isReprint,
                bytes: Array.from(result.bytes),
                warnings: result.warnings || [],
            });
        }
        if (!result.ok) {
            return res.status(502).json({
                error: result.detail || 'Printer did not respond or print failed',
                detail: result.detail,
                warnings: result.warnings || [],
            });
        }
        res.json({ success: true, isReprint, warnings: result.warnings || [] });
    }
    catch (error) {
        console.error('[CashClosures] Print error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
//# sourceMappingURL=cash-closures.js.map