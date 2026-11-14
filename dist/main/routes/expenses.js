"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expenseRoutes = void 0;
/**
 * Expense records API. Reads need `expenses.view`; every mutation needs
 * `expenses.manage` as well as view, so an actor can always inspect the row
 * they just wrote. Amounts are integer minor units end to end.
 */
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const expenses_1 = require("../services/expenses");
const router = (0, express_1.Router)();
function sendError(res, error) {
    const details = error;
    const statusCode = Number.isInteger(details.statusCode) ? details.statusCode : 500;
    if (statusCode >= 500)
        console.error('[API] Internal error:', error);
    const body = {
        error: statusCode >= 500 ? 'Internal server error' : details.message,
    };
    if (typeof details.code === 'string' && details.code)
        body.code = details.code;
    res.status(statusCode).json(body);
}
function actorId(req) {
    const id = String(req.user?.userId || '');
    if (!id)
        throw new expenses_1.ExpenseServiceError(401, 'Authentication required', 'authentication_required');
    return id;
}
/** Writes need both manage and view; manage alone cannot inspect the result. */
function requireExpenseWrite(req, res, next) {
    const id = String(req.user?.userId || '');
    if (!id) {
        res.status(401).json({ error: 'Authentication required', code: 'authentication_required' });
        return;
    }
    if (!(0, authorization_1.hasPermission)(id, 'expenses.manage') || !(0, authorization_1.hasPermission)(id, 'expenses.view')) {
        res.status(403).json({ error: 'Insufficient permissions', code: 'permission_denied' });
        return;
    }
    next();
}
/** Payments and reversals are separate authorities layered on top of read access. */
function requireExpenseAuthority(permissionId) {
    return (req, res, next) => {
        const id = String(req.user?.userId || '');
        if (!id) {
            res.status(401).json({ error: 'Authentication required', code: 'authentication_required' });
            return;
        }
        if (!(0, authorization_1.hasPermission)(id, 'expenses.view') || !(0, authorization_1.hasPermission)(id, permissionId)) {
            res.status(403).json({ error: 'Insufficient permissions', code: 'permission_denied' });
            return;
        }
        next();
    };
}
/** Cash entries move drawer money, so they also need live drawer authority. */
function requireCashDrawerAuthority(req, needsDrawer) {
    if (!needsDrawer)
        return;
    if (!(0, authorization_1.hasPermission)(actorId(req), 'cash.movements.manage')) {
        throw new expenses_1.ExpenseServiceError(403, 'Insufficient permissions', 'permission_denied');
    }
}
function queryString(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || value.length > 256) {
        throw new expenses_1.ExpenseServiceError(400, `${field} must be a string of at most 256 characters`);
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
function listFiltersFromQuery(query) {
    const status = queryString(query.status, 'status');
    if (status !== undefined && !expenses_1.EXPENSE_STATUS_FILTERS.includes(status)) {
        throw new expenses_1.ExpenseServiceError(400, `status must be one of: ${expenses_1.EXPENSE_STATUS_FILTERS.join(', ')}`);
    }
    return {
        from: queryString(query.from, 'from') ?? null,
        to: queryString(query.to, 'to') ?? null,
        categoryId: queryString(query.category_id, 'category_id') ?? null,
        status: status,
        currencyCode: queryString(query.currency, 'currency') ?? null,
        limit: query.limit,
        cursor: queryString(query.cursor, 'cursor') ?? null,
    };
}
/** Client mutations must carry the header: a retry without it is a new expense. */
function requireIdempotencyKey(req) {
    const key = (0, expenses_1.normalizeIdempotencyKey)(req.get('Idempotency-Key'));
    if (!key)
        throw new expenses_1.ExpenseServiceError(400, 'Idempotency-Key header is required for this operation', 'idempotency_key_required');
    return key;
}
router.get('/categories', (0, authorization_1.requirePermission)('expenses.view'), (req, res) => {
    try {
        const includeInactive = req.query.include_inactive === 'true' || req.query.include_inactive === '1';
        const page = (0, expenses_1.listExpenseCategories)((0, db_1.getDatabase)(), { includeInactive });
        res.json({ categories: page.categories, truncated: page.truncated });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.post('/categories', requireExpenseWrite, (req, res) => {
    try {
        const body = req.body || {};
        const outcome = (0, expenses_1.createExpenseCategory)((0, db_1.getDatabase)(), {
            name: body.name,
            is_active: body.is_active,
            actorUserId: actorId(req),
            idempotencyKey: requireIdempotencyKey(req),
        });
        if (outcome.replayed)
            res.set('Idempotent-Replay', 'true');
        res.status(outcome.status).json(outcome.body);
    }
    catch (error) {
        sendError(res, error);
    }
});
router.patch('/categories/:id', requireExpenseWrite, (req, res) => {
    try {
        const body = req.body || {};
        const outcome = (0, expenses_1.updateExpenseCategory)((0, db_1.getDatabase)(), String(req.params.id), {
            name: body.name,
            is_active: body.is_active,
            actorUserId: actorId(req),
            idempotencyKey: requireIdempotencyKey(req),
        });
        if (outcome.replayed)
            res.set('Idempotent-Replay', 'true');
        res.status(outcome.status).json(outcome.body);
    }
    catch (error) {
        sendError(res, error);
    }
});
router.get('/context', (0, authorization_1.requirePermission)('expenses.view'), (req, res) => {
    try {
        res.json((0, expenses_1.getExpenseContext)((0, db_1.getDatabase)(), String(req.user?.userId || '')));
    }
    catch (error) {
        sendError(res, error);
    }
});
router.get('/summary', (0, authorization_1.requirePermission)('expenses.view'), (req, res) => {
    try {
        const filters = listFiltersFromQuery(req.query);
        res.json((0, expenses_1.summarizeExpenses)((0, db_1.getDatabase)(), filters));
    }
    catch (error) {
        sendError(res, error);
    }
});
router.get('/', (0, authorization_1.requirePermission)('expenses.view'), (req, res) => {
    try {
        const filters = listFiltersFromQuery(req.query);
        const page = (0, expenses_1.listExpenses)((0, db_1.getDatabase)(), filters);
        res.json({
            expenses: page.expenses,
            limit: page.limit,
            maxLimit: expenses_1.EXPENSE_LIST_MAX_LIMIT,
            ...(page.nextCursor !== null && { nextCursor: page.nextCursor }),
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.get('/:id', (0, authorization_1.requirePermission)('expenses.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const id = String(req.params.id);
        const expense = (0, expenses_1.getExpense)(db, id);
        const history = (0, expenses_1.listExpensePayments)(db, id, {
            limit: req.query.payments_limit,
            cursor: queryString(req.query.payments_cursor, 'payments_cursor') ?? null,
        });
        res.json({
            expense,
            payments: history.payments,
            ...(history.nextCursor !== null && { paymentsNextCursor: history.nextCursor }),
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
router.post('/', requireExpenseWrite, (req, res) => {
    try {
        const body = req.body || {};
        const outcome = (0, expenses_1.createExpense)((0, db_1.getDatabase)(), {
            ...body,
            actorUserId: actorId(req),
            idempotencyKey: requireIdempotencyKey(req),
        });
        if (outcome.replayed)
            res.set('Idempotent-Replay', 'true');
        res.status(outcome.status).json(outcome.body);
    }
    catch (error) {
        sendError(res, error);
    }
});
router.post('/:id/void', requireExpenseWrite, (req, res) => {
    try {
        const outcome = (0, expenses_1.voidExpense)((0, db_1.getDatabase)(), String(req.params.id), {
            reason: (req.body || {}).reason,
            actorUserId: actorId(req),
            idempotencyKey: requireIdempotencyKey(req),
        });
        if (outcome.replayed)
            res.set('Idempotent-Replay', 'true');
        res.status(outcome.status).json(outcome.body);
    }
    catch (error) {
        sendError(res, error);
    }
});
router.post('/:id/replace', requireExpenseWrite, (req, res) => {
    try {
        const outcome = (0, expenses_1.replaceExpense)((0, db_1.getDatabase)(), String(req.params.id), {
            ...(req.body || {}),
            actorUserId: actorId(req),
            idempotencyKey: requireIdempotencyKey(req),
        });
        if (outcome.replayed)
            res.set('Idempotent-Replay', 'true');
        res.status(outcome.status).json(outcome.body);
    }
    catch (error) {
        sendError(res, error);
    }
});
/** Amounts settle against the immutable ledger; a cash entry also writes a linked Pay Out. */
router.post('/:id/payments', requireExpenseAuthority('expenses.pay'), (req, res) => {
    try {
        const body = req.body || {};
        requireCashDrawerAuthority(req, (0, expenses_1.normalizeExpensePaymentMethod)(body.method) === 'cash');
        const outcome = (0, expenses_1.recordExpensePayment)((0, db_1.getDatabase)(), String(req.params.id), {
            ...body,
            actorUserId: actorId(req),
            idempotencyKey: requireIdempotencyKey(req),
        });
        if (outcome.replayed)
            res.set('Idempotent-Replay', 'true');
        res.status(outcome.status).json(outcome.body);
    }
    catch (error) {
        sendError(res, error);
    }
});
/** Reversals copy the committed payment; a correction is never an in-place edit. */
router.post('/:id/payments/:paymentId/reverse', requireExpenseAuthority('expenses.reverse'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const expenseId = String(req.params.id);
        const paymentId = String(req.params.paymentId);
        requireCashDrawerAuthority(req, (0, expenses_1.getExpensePayment)(db, expenseId, paymentId).method === 'cash');
        const outcome = (0, expenses_1.reverseExpensePayment)(db, expenseId, paymentId, {
            reason: (req.body || {}).reason,
            actorUserId: actorId(req),
            idempotencyKey: requireIdempotencyKey(req),
        });
        if (outcome.replayed)
            res.set('Idempotent-Replay', 'true');
        res.status(outcome.status).json(outcome.body);
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.expenseRoutes = router;
//# sourceMappingURL=expenses.js.map