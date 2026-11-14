"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpenseServiceError = exports.EXPENSE_CATEGORY_LIST_LIMIT = exports.EXPENSE_LIST_MAX_LIMIT = exports.EXPENSE_LIST_DEFAULT_LIMIT = exports.EXPENSE_STATUS_FILTERS = void 0;
exports.normalizeIdempotencyKey = normalizeIdempotencyKey;
exports.canonicalizeExpenseRequest = canonicalizeExpenseRequest;
exports.expenseRequestHash = expenseRequestHash;
exports.isValidBusinessDate = isValidBusinessDate;
exports.requireBusinessDate = requireBusinessDate;
exports.currentBusinessDate = currentBusinessDate;
exports.listExpenseCategories = listExpenseCategories;
exports.getExpenseCategory = getExpenseCategory;
exports.createExpenseCategory = createExpenseCategory;
exports.updateExpenseCategory = updateExpenseCategory;
exports.normalizeExpenseLimit = normalizeExpenseLimit;
exports.listExpenses = listExpenses;
exports.getExpense = getExpense;
exports.listExpensePayments = listExpensePayments;
exports.summarizeExpenses = summarizeExpenses;
exports.createExpense = createExpense;
exports.voidExpense = voidExpense;
exports.replaceExpense = replaceExpense;
exports.normalizeExpensePaymentMethod = normalizeExpensePaymentMethod;
exports.getExpensePayment = getExpensePayment;
exports.recordExpensePayment = recordExpensePayment;
exports.reverseExpensePayment = reverseExpensePayment;
exports.getExpenseContext = getExpenseContext;
/**
 * Expense records: categories, immutable expenses, the payment/reversal
 * ledger, and the idempotent mutation contract behind them.
 *
 * Money lives in integer minor units with a currency snapshot on the expense;
 * nothing here converts currencies or infers an amount from a display string.
 * Net paid is derived from the ledger (payments minus reversals), and a cash
 * payment or reversal writes exactly one linked drawer movement inside the
 * same transaction.
 */
const crypto_1 = require("crypto");
const db_1 = require("../db");
const countries_1 = require("../countries");
const shift_session_gate_1 = require("./shift-session-gate");
const cash_drawer_movements_1 = require("./cash-drawer-movements");
exports.EXPENSE_STATUS_FILTERS = [
    'active',
    'voided',
    'replaced',
    'all',
];
exports.EXPENSE_LIST_DEFAULT_LIMIT = 50;
exports.EXPENSE_LIST_MAX_LIMIT = 100;
exports.EXPENSE_CATEGORY_LIST_LIMIT = 500;
const CATEGORY_NAME_LIMIT = 80;
const DESCRIPTION_LIMIT = 200;
const PAYEE_LIMIT = 200;
const NOTES_LIMIT = 500;
const REASON_LIMIT = 500;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DB_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
class ExpenseServiceError extends Error {
    statusCode;
    code;
    constructor(statusCode, message, code = null) {
        super(message);
        this.name = 'ExpenseServiceError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
exports.ExpenseServiceError = ExpenseServiceError;
// ── Validation primitives ────────────────────────────────────────────────────
function badRequest(message, code = null) {
    return new ExpenseServiceError(400, message, code);
}
function conflict(message, code = null) {
    return new ExpenseServiceError(409, message, code);
}
function normalizeIdempotencyKey(value) {
    if (value === undefined || value === null)
        return null;
    const key = String(value).trim();
    if (!key)
        return null;
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
        throw badRequest('Idempotency-Key is invalid or too long', 'invalid_idempotency_key');
    }
    return key;
}
/** Stable JSON for hashing: object keys sorted, arrays kept in order. */
function canonicalizeExpenseRequest(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalizeExpenseRequest).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalizeExpenseRequest(value[key])}`);
        return `{${entries.join(',')}}`;
    }
    if (value === undefined)
        return 'undefined';
    return JSON.stringify(value);
}
function expenseRequestHash(operation, resourceId, fields) {
    return (0, crypto_1.createHash)('sha256')
        .update(canonicalizeExpenseRequest({ operation, resource_id: resourceId, fields }))
        .digest('hex');
}
function requireTrimmedText(value, field, maxLength) {
    if (typeof value !== 'string')
        throw badRequest(`${field} must be a string`);
    const text = value.trim();
    if (!text)
        throw badRequest(`${field} is required`);
    if (text.length > maxLength)
        throw badRequest(`${field} must be at most ${maxLength} characters`);
    return text;
}
function optionalTrimmedText(value, field, maxLength) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'string')
        throw badRequest(`${field} must be a string`);
    const text = value.trim();
    if (!text)
        return null;
    if (text.length > maxLength)
        throw badRequest(`${field} must be at most ${maxLength} characters`);
    return text;
}
function requirePositiveMinorUnits(value, field) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw badRequest(`${field} must be a positive integer number of minor units`);
    }
    return value;
}
function requireBoolean(value, field) {
    if (typeof value !== 'boolean')
        throw badRequest(`${field} must be true or false`);
    return value;
}
/** Gregorian calendar validation: the date shape alone would accept 2026-02-30. */
function isValidBusinessDate(value) {
    if (!BUSINESS_DATE_PATTERN.test(value))
        return false;
    const [year, month, day] = value.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1)
        return false;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day);
}
function requireBusinessDate(value, field) {
    if (typeof value !== 'string' || !isValidBusinessDate(value)) {
        throw badRequest(`${field} must be a valid YYYY-MM-DD date`);
    }
    return value;
}
function requireCurrencyCode(value) {
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value.trim().toUpperCase())) {
        throw badRequest('currency_code must be a three-letter currency code');
    }
    return value.trim().toUpperCase();
}
function tenantRegionalSnapshot() {
    const snapshot = (0, countries_1.resolveRegionalSnapshot)({
        country: (0, db_1.getSettingValue)('country') ?? undefined,
        currency: (0, db_1.getSettingValue)('currency') ?? undefined,
        timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
    });
    return { currency: snapshot.currency, timezone: snapshot.timezone };
}
/** Store-local business date, so an expense can be dated to a closed trading day. */
function currentBusinessDate() {
    const regional = tenantRegionalSnapshot();
    return (0, db_1.localDateInTimezone)(new Date(), regional.timezone, (0, db_1.tenantBusinessDayStartTime)());
}
const MAX_SAFE_TOTAL = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_TOTAL = BigInt(Number.MIN_SAFE_INTEGER);
function unsupportedAmountRange(label) {
    return new ExpenseServiceError(422, `${label} exceeds the supported amount range`, 'amount_range_exceeded');
}
function isSqliteIntegerOverflow(error) {
    if (typeof error !== 'object' || error === null)
        return false;
    return /integer overflow/i.test(String(error.message || ''));
}
function runAggregateQuery(query, label) {
    try {
        return query();
    }
    catch (error) {
        if (isSqliteIntegerOverflow(error))
            throw unsupportedAmountRange(label);
        throw error;
    }
}
function toBigIntTotal(value, label) {
    if (typeof value === 'bigint')
        return value;
    if (!Number.isSafeInteger(value))
        throw unsupportedAmountRange(label);
    return BigInt(value);
}
function isSafeTotal(value) {
    return value >= MIN_SAFE_TOTAL && value <= MAX_SAFE_TOTAL;
}
function requireSafeTotal(value, label) {
    const total = toBigIntTotal(value, label);
    if (!isSafeTotal(total)) {
        throw unsupportedAmountRange(label);
    }
    return Number(total);
}
// ── Cursors ──────────────────────────────────────────────────────────────────
function encodeCursor(parts) {
    return Buffer.from(parts.join('|'), 'utf8').toString('base64url');
}
function decodeCursor(cursor, expectedParts) {
    const decoded = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const parts = decoded.split('|');
    if (parts.length !== expectedParts || parts.some((part) => part.length === 0)) {
        throw badRequest('cursor is invalid');
    }
    return parts;
}
// ── Categories ───────────────────────────────────────────────────────────────
function normalizeCategoryName(value) {
    const name = requireTrimmedText(value, 'name', CATEGORY_NAME_LIMIT);
    return { name, nameKey: name.toLowerCase() };
}
function listExpenseCategories(db, filters = {}) {
    const rows = db
        .prepare(`
    SELECT * FROM expense_categories
    ${filters.includeInactive ? '' : 'WHERE is_active = 1'}
    ORDER BY is_active DESC, name COLLATE NOCASE, id
    LIMIT ?
  `)
        .all(exports.EXPENSE_CATEGORY_LIST_LIMIT + 1);
    const truncated = rows.length > exports.EXPENSE_CATEGORY_LIST_LIMIT;
    return { categories: truncated ? rows.slice(0, exports.EXPENSE_CATEGORY_LIST_LIMIT) : rows, truncated };
}
function getExpenseCategory(db, id) {
    const row = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
    if (!row)
        throw new ExpenseServiceError(404, 'Expense category not found');
    return row;
}
function isCategoryNameConflict(error) {
    return (typeof error === 'object' &&
        error !== null &&
        String(error.code || '').includes('CONSTRAINT') &&
        String(error.message || '').includes('expense_categories.name_key'));
}
function createExpenseCategory(db, input) {
    const { name, nameKey } = normalizeCategoryName(input.name);
    const isActive = input.is_active === undefined ? true : requireBoolean(input.is_active, 'is_active');
    const id = `expcat_${(0, crypto_1.randomUUID)()}`;
    return (0, db_1.withTxn)(() => runExpenseMutation(db, {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        operation: 'create_expense_category',
        resourceId: '',
        fields: { name: nameKey, is_active: isActive ? 1 : 0 },
    }, () => {
        const timestamp = (0, db_1.now)();
        try {
            db.prepare(`
          INSERT INTO expense_categories (id, name, name_key, is_active, created_by, updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, name, nameKey, isActive ? 1 : 0, input.actorUserId, input.actorUserId, timestamp, timestamp);
        }
        catch (error) {
            if (isCategoryNameConflict(error))
                throw conflict('An expense category with this name already exists', 'category_name_taken');
            throw error;
        }
        return { status: 201, body: { category: getExpenseCategory(db, id) } };
    }));
}
function updateExpenseCategory(db, id, input) {
    if (input.name === undefined && input.is_active === undefined) {
        throw badRequest('name or is_active is required');
    }
    const namePatch = input.name === undefined ? null : normalizeCategoryName(input.name);
    const isActivePatch = input.is_active === undefined ? null : requireBoolean(input.is_active, 'is_active');
    return (0, db_1.withTxn)(() => runExpenseMutation(db, {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        operation: 'update_expense_category',
        resourceId: id,
        fields: {
            name: namePatch ? namePatch.nameKey : null,
            is_active: isActivePatch === null ? null : isActivePatch ? 1 : 0,
        },
    }, () => {
        const category = getExpenseCategory(db, id);
        const nextName = namePatch ? namePatch.name : category.name;
        const nextActive = isActivePatch === null ? category.is_active : isActivePatch ? 1 : 0;
        try {
            if (namePatch) {
                db.prepare(`
            UPDATE expense_categories SET name = ?, name_key = ?, is_active = ?, updated_by = ?, updated_at = ?
            WHERE id = ?
          `).run(nextName, namePatch.nameKey, nextActive, input.actorUserId, (0, db_1.now)(), id);
            }
            else {
                db.prepare(`
            UPDATE expense_categories SET is_active = ?, updated_by = ?, updated_at = ? WHERE id = ?
          `).run(nextActive, input.actorUserId, (0, db_1.now)(), id);
            }
        }
        catch (error) {
            if (isCategoryNameConflict(error))
                throw conflict('An expense category with this name already exists', 'category_name_taken');
            throw error;
        }
        return { status: 200, body: { category: getExpenseCategory(db, id) } };
    }));
}
// ── Expense reads ────────────────────────────────────────────────────────────
const EXPENSE_PROJECTION = `
  e.*,
  CASE
    WHEN e.voided_at IS NULL THEN 'active'
    WHEN EXISTS (SELECT 1 FROM expenses r WHERE r.replaces_expense_id = e.id) THEN 'replaced'
    ELSE 'voided'
  END AS status,
  COALESCE((
    SELECT SUM(CASE WHEN p.reversal_of IS NULL THEN p.amount_minor ELSE -p.amount_minor END)
    FROM expense_payments p WHERE p.expense_id = e.id
  ), 0) AS net_paid_minor
`;
function projectExpenseRow(row) {
    const amountRaw = toBigIntTotal(row.amount_minor, 'Expense amount');
    const paidRaw = toBigIntTotal(row.net_paid_minor, 'Expense paid total');
    const paidMinor = requireSafeTotal(paidRaw, 'Expense paid total');
    const dueRaw = amountRaw - paidRaw;
    const amountMinor = isSafeTotal(amountRaw) ? requireSafeTotal(amountRaw, 'Expense amount') : null;
    const dueMinor = amountMinor !== null && isSafeTotal(dueRaw)
        ? requireSafeTotal(dueRaw, 'Expense due total')
        : null;
    return {
        id: row.id,
        category_id: row.category_id,
        category_name: row.category_name,
        description: row.description,
        payee: row.payee,
        notes: row.notes,
        amount_minor: amountMinor,
        currency_code: row.currency_code,
        incurred_on: row.incurred_on,
        created_by: row.created_by,
        created_at: row.created_at,
        replaces_expense_id: row.replaces_expense_id,
        voided_at: row.voided_at,
        voided_by: row.voided_by,
        void_reason: row.void_reason,
        status: row.status,
        paid_minor: paidMinor,
        due_minor: dueMinor,
    };
}
function buildExpenseFilterSql(filters) {
    const conditions = [];
    const params = [];
    const from = filters.from === undefined || filters.from === null
        ? null
        : requireBusinessDate(filters.from, 'from');
    const to = filters.to === undefined || filters.to === null ? null : requireBusinessDate(filters.to, 'to');
    if (from && to && from > to)
        throw badRequest('from must not be after to');
    if (from) {
        conditions.push('e.incurred_on >= ?');
        params.push(from);
    }
    if (to) {
        conditions.push('e.incurred_on <= ?');
        params.push(to);
    }
    const categoryId = filters.categoryId ? String(filters.categoryId) : null;
    if (categoryId) {
        conditions.push('e.category_id = ?');
        params.push(categoryId);
    }
    const currencyCode = filters.currencyCode ? requireCurrencyCode(filters.currencyCode) : null;
    if (currencyCode) {
        conditions.push('e.currency_code = ?');
        params.push(currencyCode);
    }
    const status = filters.status ?? 'active';
    if (!exports.EXPENSE_STATUS_FILTERS.includes(status)) {
        throw badRequest(`status must be one of: ${exports.EXPENSE_STATUS_FILTERS.join(', ')}`);
    }
    if (status === 'active')
        conditions.push('e.voided_at IS NULL');
    else if (status === 'voided') {
        conditions.push('e.voided_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM expenses r WHERE r.replaces_expense_id = e.id)');
    }
    else if (status === 'replaced') {
        conditions.push('e.voided_at IS NOT NULL AND EXISTS (SELECT 1 FROM expenses r WHERE r.replaces_expense_id = e.id)');
    }
    return {
        whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
        params,
        applied: { from, to, category_id: categoryId, currency_code: currencyCode, status },
    };
}
function normalizeExpenseLimit(value, fallback = exports.EXPENSE_LIST_DEFAULT_LIMIT) {
    if (value === undefined || value === null || value === '')
        return fallback;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0)
        throw badRequest('limit must be a positive integer');
    return Math.min(parsed, exports.EXPENSE_LIST_MAX_LIMIT);
}
function listExpenses(db, filters = {}) {
    const { whereSql, params } = buildExpenseFilterSql(filters);
    const limit = normalizeExpenseLimit(filters.limit);
    const cursor = filters.cursor ? decodeCursor(String(filters.cursor), 2) : null;
    if (cursor && !isValidBusinessDate(cursor[0]))
        throw badRequest('cursor is invalid');
    const cursorSql = cursor ? `${whereSql ? 'AND' : 'WHERE'} (e.incurred_on, e.id) < (?, ?)` : '';
    const rows = runAggregateQuery(() => db
        .prepare(`
      SELECT ${EXPENSE_PROJECTION}
      FROM expenses e
      ${whereSql}
      ${cursorSql}
      ORDER BY e.incurred_on DESC, e.id DESC
      LIMIT ?
    `)
        .safeIntegers(true)
        .all(...params, ...(cursor ? [cursor[0], cursor[1]] : []), limit + 1), 'Expense paid total');
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
        expenses: page.map(projectExpenseRow),
        nextCursor: hasMore && last ? encodeCursor([last.incurred_on, last.id]) : null,
        limit,
    };
}
function getExpense(db, id) {
    const row = runAggregateQuery(() => db
        .prepare(`SELECT ${EXPENSE_PROJECTION} FROM expenses e WHERE e.id = ?`)
        .safeIntegers(true)
        .get(id), 'Expense paid total');
    if (!row)
        throw new ExpenseServiceError(404, 'Expense not found');
    return projectExpenseRow(row);
}
/** Payment history, newest first; reversals stay in the ledger as their own entries. */
function listExpensePayments(db, expenseId, options = {}) {
    const limit = normalizeExpenseLimit(options.limit);
    const cursor = options.cursor ? decodeCursor(String(options.cursor), 2) : null;
    if (cursor && !DB_TIMESTAMP_PATTERN.test(cursor[0]))
        throw badRequest('cursor is invalid');
    const rows = db
        .prepare(`
    SELECT * FROM expense_payments p
    ${cursor ? 'WHERE p.expense_id = ? AND (p.created_at, p.id) < (?, ?)' : 'WHERE p.expense_id = ?'}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ?
  `)
        .all(...(cursor ? [expenseId, cursor[0], cursor[1]] : [expenseId]), limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
        payments: page,
        nextCursor: hasMore && last ? encodeCursor([last.created_at, last.id]) : null,
    };
}
function aggregateExpenses(db, filter, grouped) {
    return runAggregateQuery(() => db
        .prepare(`
      SELECT
        e.currency_code AS currency_code,
        ${grouped ? 'e.category_id AS category_id, MAX(COALESCE(c.name, e.category_name)) AS category_name,' : ''}
        COUNT(*) AS expense_count,
        COALESCE(SUM(e.amount_minor), 0) AS incurred_minor,
        COALESCE(SUM(COALESCE((
          SELECT SUM(CASE WHEN p.reversal_of IS NULL THEN p.amount_minor ELSE -p.amount_minor END)
          FROM expense_payments p WHERE p.expense_id = e.id
        ), 0)), 0) AS net_paid_minor
      FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      ${filter.whereSql}
      GROUP BY e.currency_code${grouped ? ', e.category_id' : ''}
      ORDER BY e.currency_code${grouped ? ', MAX(COALESCE(c.name, e.category_name)) COLLATE NOCASE' : ''}
    `)
        .safeIntegers(true)
        .all(...filter.params), 'Expense incurred total');
}
/**
 * Current net paid/due against the active expenses incurred in the filter
 * range — not payments made in the period, and never subtracted from sales.
 */
function summarizeExpenses(db, filters = {}) {
    const filter = buildExpenseFilterSql({ ...filters, status: 'active' });
    const groups = aggregateExpenses(db, filter, true).map((row) => {
        const expenseCount = requireSafeTotal(row.expense_count, 'Expense count');
        const incurredRaw = toBigIntTotal(row.incurred_minor, 'Expense incurred total');
        const netPaidRaw = toBigIntTotal(row.net_paid_minor, 'Expense paid total');
        const incurredMinor = requireSafeTotal(incurredRaw, 'Expense incurred total');
        const netPaidMinor = requireSafeTotal(netPaidRaw, 'Expense paid total');
        return {
            currency_code: row.currency_code,
            category_id: String(row.category_id),
            category_name: String(row.category_name),
            expense_count: expenseCount,
            incurred_minor: incurredMinor,
            net_paid_minor: netPaidMinor,
            due_minor: requireSafeTotal(incurredRaw - netPaidRaw, 'Expense due total'),
        };
    });
    const totals = aggregateExpenses(db, filter, false).map((row) => {
        const expenseCount = requireSafeTotal(row.expense_count, 'Expense count');
        const incurredRaw = toBigIntTotal(row.incurred_minor, 'Expense incurred total');
        const netPaidRaw = toBigIntTotal(row.net_paid_minor, 'Expense paid total');
        const incurredMinor = requireSafeTotal(incurredRaw, 'Expense incurred total');
        const netPaidMinor = requireSafeTotal(netPaidRaw, 'Expense paid total');
        return {
            currency_code: row.currency_code,
            expense_count: expenseCount,
            incurred_minor: incurredMinor,
            net_paid_minor: netPaidMinor,
            due_minor: requireSafeTotal(incurredRaw - netPaidRaw, 'Expense due total'),
        };
    });
    return {
        basis: 'active_expenses_incurred_in_range_paid_to_date',
        filters: {
            from: filter.applied.from,
            to: filter.applied.to,
            category_id: filter.applied.category_id,
            currency_code: filter.applied.currency_code,
            status: 'active',
        },
        groups,
        totals,
    };
}
// ── Mutations ────────────────────────────────────────────────────────────────
/**
 * Actor-scoped idempotency: a committed mutation is replayed from its stored
 * receipt when the same key arrives with the same normalized request, and is a
 * conflict otherwise. Callers open the transaction, so the receipt and the
 * write commit together — a rolled-back attempt is never recorded.
 */
function runExpenseMutation(db, input, work) {
    const key = input.idempotencyKey;
    const requestHash = (body) => {
        const currency = body.expense?.currency_code;
        const fields = input.fields.currency_code === null && currency
            ? { ...input.fields, currency_code: currency }
            : input.fields;
        return expenseRequestHash(input.operation, input.resourceId, fields);
    };
    if (key) {
        const existing = db
            .prepare(`
      SELECT operation, resource_id, request_hash, response_json
      FROM expense_mutations WHERE actor_user_id = ? AND idempotency_key = ?
    `)
            .get(input.actorUserId, key);
        if (existing) {
            const stored = JSON.parse(existing.response_json);
            if (existing.operation !== input.operation ||
                existing.resource_id !== input.resourceId ||
                existing.request_hash !== requestHash(stored.body)) {
                throw conflict('Idempotency-Key was already used for a different expense request', 'idempotency_conflict');
            }
            return { status: stored.status, body: stored.body, replayed: true };
        }
    }
    const outcome = work();
    if (key) {
        db.prepare(`
      INSERT INTO expense_mutations (actor_user_id, idempotency_key, operation, resource_id, request_hash, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.actorUserId, key, input.operation, input.resourceId, requestHash(outcome.body), JSON.stringify({ status: outcome.status, body: outcome.body }), (0, db_1.now)());
    }
    return { ...outcome, replayed: false };
}
function requireActiveCategory(db, categoryId) {
    const category = getExpenseCategory(db, categoryId);
    if (category.is_active !== 1)
        throw conflict('Expense category is inactive', 'category_inactive');
    return category;
}
/** The store currency at creation time; expenses never carry a foreign snapshot. */
function resolveExpenseCurrency(currencyCode) {
    const storeCurrency = tenantRegionalSnapshot().currency;
    if (currencyCode === undefined || currencyCode === null || currencyCode === '')
        return storeCurrency;
    const requested = requireCurrencyCode(currencyCode);
    if (requested !== storeCurrency) {
        throw badRequest(`currency_code must match the store currency (${storeCurrency})`);
    }
    return storeCurrency;
}
function validateExpenseFields(db, input) {
    const categoryId = requireTrimmedText(input.category_id, 'category_id', 128);
    const category = requireActiveCategory(db, categoryId);
    const description = requireTrimmedText(input.description, 'description', DESCRIPTION_LIMIT);
    const amountMinor = requirePositiveMinorUnits(input.amount_minor, 'amount_minor');
    const currencyCode = resolveExpenseCurrency(input.currency_code);
    const incurredOn = requireBusinessDate(input.incurred_on, 'incurred_on');
    if (incurredOn > currentBusinessDate())
        throw badRequest('incurred_on cannot be in the future');
    return {
        categoryId,
        categoryName: category.name,
        description,
        amountMinor,
        currencyCode,
        incurredOn,
        payee: optionalTrimmedText(input.payee, 'payee', PAYEE_LIMIT),
        notes: optionalTrimmedText(input.notes, 'notes', NOTES_LIMIT),
    };
}
function insertExpense(db, fields, actorUserId, replacesExpenseId) {
    const id = `exp_${(0, crypto_1.randomUUID)()}`;
    db.prepare(`
    INSERT INTO expenses (
      id, category_id, category_name, description, payee, notes, amount_minor,
      currency_code, incurred_on, created_by, created_at, replaces_expense_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, fields.categoryId, fields.categoryName, fields.description, fields.payee, fields.notes, fields.amountMinor, fields.currencyCode, fields.incurredOn, actorUserId, (0, db_1.now)(), replacesExpenseId);
    return id;
}
/** Net paid across the immutable ledger: payments minus their reversals. */
function netPaidMinor(db, expenseId) {
    const row = runAggregateQuery(() => db
        .prepare(`
      SELECT COALESCE(SUM(CASE WHEN reversal_of IS NULL THEN amount_minor ELSE -amount_minor END), 0) AS net_paid
      FROM expense_payments WHERE expense_id = ?
    `)
        .safeIntegers(true)
        .get(expenseId), 'Expense paid total');
    return requireSafeTotal(row.net_paid, 'Expense paid total');
}
/** Only an open (not voided, not replaced) expense may change its ledger. */
function requireActiveExpense(db, id) {
    const expense = getExpense(db, id);
    if (expense.status === 'replaced')
        throw conflict('Expense was already replaced', 'expense_replaced');
    if (expense.voided_at)
        throw conflict('Expense is already voided', 'expense_voided');
    return expense;
}
function requireUnpaidOpenExpense(db, id) {
    const row = db
        .prepare(`
    SELECT
      e.id,
      e.amount_minor,
      e.currency_code,
      e.voided_at,
      CASE
        WHEN e.voided_at IS NULL THEN 'active'
        WHEN EXISTS (SELECT 1 FROM expenses r WHERE r.replaces_expense_id = e.id) THEN 'replaced'
        ELSE 'voided'
      END AS status
    FROM expenses e
    WHERE e.id = ?
  `)
        .safeIntegers(true)
        .get(id);
    if (!row)
        throw new ExpenseServiceError(404, 'Expense not found');
    if (row.status === 'replaced')
        throw conflict('Expense was already replaced', 'expense_replaced');
    if (row.voided_at)
        throw conflict('Expense is already voided', 'expense_voided');
    if (netPaidMinor(db, id) !== 0) {
        throw conflict('Expense has recorded payments; reverse them before voiding or replacing', 'expense_has_payments');
    }
    return {
        id: row.id,
        amount_minor: toBigIntTotal(row.amount_minor, 'Expense amount'),
        currency_code: row.currency_code,
    };
}
function ensureSupportedActiveCurrencyTotal(db, currencyCode, amountMinor, replaced) {
    const replacedMinor = replaced && replaced.currency_code === currencyCode ? replaced.amount_minor : 0n;
    let currentActiveMinor;
    try {
        const row = db
            .prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) AS incurred_minor
      FROM expenses
      WHERE voided_at IS NULL AND currency_code = ?
    `)
            .safeIntegers(true)
            .get(currencyCode);
        currentActiveMinor =
            toBigIntTotal(row.incurred_minor, 'Expense incurred total') - replacedMinor;
    }
    catch (error) {
        if (isSqliteIntegerOverflow(error) && replaced && replaced.currency_code === currencyCode) {
            const row = runAggregateQuery(() => db
                .prepare(`
          SELECT COALESCE(SUM(amount_minor), 0) AS incurred_minor
          FROM expenses
          WHERE voided_at IS NULL AND currency_code = ? AND id != ?
        `)
                .safeIntegers(true)
                .get(currencyCode, replaced.id), 'Expense incurred total');
            currentActiveMinor = toBigIntTotal(row.incurred_minor, 'Expense incurred total');
        }
        else if (isSqliteIntegerOverflow(error)) {
            throw unsupportedAmountRange('Expense incurred total');
        }
        else {
            throw error;
        }
    }
    const nextActiveMinor = currentActiveMinor + BigInt(amountMinor);
    requireSafeTotal(nextActiveMinor, 'Expense incurred total');
}
function requireReason(value) {
    return requireTrimmedText(value, 'reason', REASON_LIMIT);
}
function expenseMutationFields(input) {
    const normalizeText = (value) => (typeof value === 'string' ? value.trim() : value);
    const normalizeOptionalText = (value) => {
        if (value === undefined || value === null)
            return null;
        const normalized = normalizeText(value);
        return normalized === '' ? null : normalized;
    };
    const rawCurrency = typeof input.currency_code === 'string'
        ? input.currency_code.trim().toUpperCase()
        : input.currency_code;
    const canonicalCurrency = rawCurrency === undefined || rawCurrency === null || rawCurrency === '' ? null : rawCurrency;
    return {
        category_id: normalizeText(input.category_id),
        description: normalizeText(input.description),
        amount_minor: input.amount_minor,
        currency_code: canonicalCurrency,
        incurred_on: input.incurred_on,
        payee: normalizeOptionalText(input.payee),
        notes: normalizeOptionalText(input.notes),
    };
}
/** A new expense never starts paid: the ledger is the only source of paid state. */
function createExpense(db, input) {
    if (input.replaces_expense_id !== undefined && input.replaces_expense_id !== null) {
        throw badRequest('replaces_expense_id can only be set by the replace operation');
    }
    return (0, db_1.withTxn)(() => runExpenseMutation(db, {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        operation: 'create_expense',
        resourceId: '',
        fields: expenseMutationFields(input),
    }, () => {
        const fields = validateExpenseFields(db, input);
        ensureSupportedActiveCurrencyTotal(db, fields.currencyCode, fields.amountMinor);
        const id = insertExpense(db, fields, input.actorUserId, null);
        return { status: 201, body: { expense: getExpense(db, id) } };
    }));
}
/** Keeps the original expense row, values and audit trail; only adds void metadata. */
function voidExpense(db, id, input) {
    const reason = requireReason(input.reason);
    return (0, db_1.withTxn)(() => runExpenseMutation(db, {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        operation: 'void_expense',
        resourceId: id,
        fields: { reason },
    }, () => {
        requireUnpaidOpenExpense(db, id);
        db.prepare('UPDATE expenses SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').run((0, db_1.now)(), input.actorUserId, reason, id);
        return { status: 200, body: { expense: getExpense(db, id) } };
    }));
}
/** Voids the source and creates the linked replacement in one transaction. */
function replaceExpense(db, id, input) {
    const reason = requireReason(input.reason);
    return (0, db_1.withTxn)(() => runExpenseMutation(db, {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        operation: 'replace_expense',
        resourceId: id,
        fields: { reason, ...expenseMutationFields(input) },
    }, () => {
        const source = requireUnpaidOpenExpense(db, id);
        const fields = validateExpenseFields(db, input);
        ensureSupportedActiveCurrencyTotal(db, fields.currencyCode, fields.amountMinor, source);
        const replacementId = insertExpense(db, fields, input.actorUserId, id);
        db.prepare('UPDATE expenses SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').run((0, db_1.now)(), input.actorUserId, reason, id);
        return {
            status: 201,
            body: { expense: getExpense(db, replacementId), replaced_expense_id: id },
        };
    }));
}
// ── Payment and reversal writes ──────────────────────────────────────────────
const REFERENCE_LIMIT = 200;
function normalizeExpensePaymentMethod(value) {
    if (value !== 'cash' && value !== 'card' && value !== 'bank_transfer' && value !== 'other') {
        throw badRequest('method must be one of: cash, card, bank_transfer, other');
    }
    return value;
}
/** The committed ledger entry for one expense/payment pair, or a 404. */
function getExpensePayment(db, expenseId, paymentId) {
    const row = db
        .prepare('SELECT * FROM expense_payments WHERE id = ? AND expense_id = ?')
        .get(paymentId, expenseId);
    if (!row)
        throw new ExpenseServiceError(404, 'Expense payment not found');
    return row;
}
/**
 * The client sends the currency it reviewed the payment under; the snapshot on
 * the expense stays authoritative so a stale dialog cannot settle in another.
 */
function requireExpectedCurrency(value, expected) {
    if (value === undefined || value === null || value === '')
        return;
    if (requireCurrencyCode(value) !== expected) {
        throw badRequest(`currency_code must match the expense currency (${expected})`);
    }
}
/** Cash entries move real drawer money, so they need a real open session. */
function requireOpenSessionForCashEntry(db, actorUserId) {
    const session = (0, shift_session_gate_1.getOpenSession)(db, actorUserId);
    if (!session) {
        throw conflict('No open cash session: open a shift before moving drawer money for an expense', 'cash_session_required');
    }
    return session;
}
/** Settlements require the expense currency to match the active store currency. */
function requireStoreCurrency(expense) {
    const storeCurrency = tenantRegionalSnapshot().currency;
    if (expense.currency_code !== storeCurrency) {
        throw conflict(`Expense settlements require the expense currency to match the store currency (${storeCurrency})`, 'currency_mismatch');
    }
}
/** Drawer-ledger text for the movement a cash entry writes, bounded for the column. */
function expensePaymentReason(prefix, expense) {
    return `${prefix}: ${expense.description}`.slice(0, cash_drawer_movements_1.MAX_MOVEMENT_REASON_LENGTH);
}
function paymentMutationFields(input, expenseCurrency) {
    const rawCurrency = typeof input.currency_code === 'string'
        ? input.currency_code.trim().toUpperCase()
        : input.currency_code;
    const canonicalCurrency = rawCurrency === undefined || rawCurrency === null || rawCurrency === ''
        ? expenseCurrency
        : rawCurrency;
    return {
        amount_minor: input.amount_minor,
        method: input.method,
        reference: typeof input.reference === 'string'
            ? input.reference.trim() || null
            : (input.reference ?? null),
        currency_code: canonicalCurrency,
    };
}
/** Records money settled against the expense; the ledger row is never edited in place. */
function recordExpensePayment(db, expenseId, input) {
    return (0, db_1.withTxn)(() => {
        const expense = getExpense(db, expenseId);
        return runExpenseMutation(db, {
            actorUserId: input.actorUserId,
            idempotencyKey: input.idempotencyKey ?? null,
            operation: 'record_expense_payment',
            resourceId: expenseId,
            fields: paymentMutationFields(input, expense.currency_code),
        }, () => {
            requireActiveExpense(db, expenseId);
            const amountMinor = requirePositiveMinorUnits(input.amount_minor, 'amount_minor');
            const method = normalizeExpensePaymentMethod(input.method);
            const reference = optionalTrimmedText(input.reference, 'reference', REFERENCE_LIMIT);
            requireStoreCurrency(expense);
            requireExpectedCurrency(input.currency_code, expense.currency_code);
            if (expense.due_minor === null || amountMinor > expense.due_minor)
                throw conflict('Payment exceeds the amount due', 'expense_overpaid');
            const businessDate = currentBusinessDate();
            let cashMovementId = null;
            if (method === 'cash') {
                const session = requireOpenSessionForCashEntry(db, input.actorUserId);
                cashMovementId = (0, cash_drawer_movements_1.insertCashDrawerMovement)(db, {
                    businessDate,
                    movementType: 'pay_out',
                    amountCents: amountMinor,
                    reason: expensePaymentReason('Expense payment', expense),
                    createdBy: input.actorUserId,
                    cashSessionId: session.id,
                });
            }
            const id = `exppay_${(0, crypto_1.randomUUID)()}`;
            db.prepare(`
        INSERT INTO expense_payments (
          id, expense_id, amount_minor, method, business_date, reversal_of, reason, reference, cash_movement_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
      `).run(id, expenseId, amountMinor, method, businessDate, reference, cashMovementId, input.actorUserId, (0, db_1.now)());
            return {
                status: 201,
                body: {
                    expense: getExpense(db, expenseId),
                    payment: getExpensePayment(db, expenseId, id),
                },
            };
        });
    });
}
/**
 * A reversal is a reasoned second ledger row that copies the committed
 * payment's amount and method. The original row and its drawer movement are
 * left untouched, and a cash reversal moves today's drawer once.
 */
function reverseExpensePayment(db, expenseId, paymentId, input) {
    const reason = requireReason(input.reason);
    return (0, db_1.withTxn)(() => runExpenseMutation(db, {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        operation: 'reverse_expense_payment',
        resourceId: paymentId,
        fields: { reason },
    }, () => {
        const expense = requireActiveExpense(db, expenseId);
        const payment = getExpensePayment(db, expenseId, paymentId);
        if (payment.reversal_of !== null)
            throw conflict('A reversal entry cannot be reversed', 'reversal_not_reversible');
        if (db.prepare('SELECT id FROM expense_payments WHERE reversal_of = ? LIMIT 1').get(paymentId)) {
            throw conflict('This payment has already been reversed', 'payment_already_reversed');
        }
        requireStoreCurrency(expense);
        const businessDate = currentBusinessDate();
        let cashMovementId = null;
        if (payment.method === 'cash') {
            const session = requireOpenSessionForCashEntry(db, input.actorUserId);
            cashMovementId = (0, cash_drawer_movements_1.insertCashDrawerMovement)(db, {
                businessDate,
                movementType: 'pay_in',
                amountCents: payment.amount_minor,
                reason: expensePaymentReason('Expense payment reversal', expense),
                createdBy: input.actorUserId,
                cashSessionId: session.id,
            });
        }
        const id = `exppay_${(0, crypto_1.randomUUID)()}`;
        db.prepare(`
        INSERT INTO expense_payments (
          id, expense_id, amount_minor, method, business_date, reversal_of, reason, reference, cash_movement_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(id, expenseId, payment.amount_minor, payment.method, businessDate, paymentId, reason, cashMovementId, input.actorUserId, (0, db_1.now)());
        return {
            status: 201,
            body: {
                expense: getExpense(db, expenseId),
                payment: getExpensePayment(db, expenseId, id),
            },
        };
    }));
}
/** Entry defaults for the expense surfaces: store currency, store business date, drawer state. */
function getExpenseContext(db, actorUserId) {
    return {
        currency_code: tenantRegionalSnapshot().currency,
        business_date: currentBusinessDate(),
        cash_session_open: (0, shift_session_gate_1.getOpenSession)(db, actorUserId) !== undefined,
    };
}
//# sourceMappingURL=expenses.js.map