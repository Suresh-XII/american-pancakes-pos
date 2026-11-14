import { getDatabase } from '../db';
type ExpenseDb = ReturnType<typeof getDatabase>;
export type ExpensePaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other';
export type ExpenseStatus = 'active' | 'voided' | 'replaced';
export type ExpenseStatusFilter = ExpenseStatus | 'all';
export declare const EXPENSE_STATUS_FILTERS: readonly ["active", "voided", "replaced", "all"];
export declare const EXPENSE_LIST_DEFAULT_LIMIT = 50;
export declare const EXPENSE_LIST_MAX_LIMIT = 100;
export declare const EXPENSE_CATEGORY_LIST_LIMIT = 500;
export declare class ExpenseServiceError extends Error {
    readonly statusCode: number;
    readonly code: string | null;
    constructor(statusCode: number, message: string, code?: string | null);
}
export interface ExpenseCategoryRecord {
    id: string;
    name: string;
    is_active: number;
    created_by: string;
    updated_by: string;
    created_at: string;
    updated_at: string;
}
export interface ExpenseRecord {
    id: string;
    category_id: string;
    category_name: string;
    description: string;
    payee: string | null;
    notes: string | null;
    amount_minor: number | null;
    currency_code: string;
    incurred_on: string;
    created_by: string;
    created_at: string;
    replaces_expense_id: string | null;
    voided_at: string | null;
    voided_by: string | null;
    void_reason: string | null;
    status: ExpenseStatus;
    paid_minor: number;
    due_minor: number | null;
}
export interface ExpensePaymentRecord {
    id: string;
    expense_id: string;
    amount_minor: number;
    method: ExpensePaymentMethod;
    business_date: string;
    reversal_of: string | null;
    reason: string | null;
    reference: string | null;
    cash_movement_id: number | null;
    created_by: string;
    created_at: string;
}
export interface ExpenseSummaryGroup {
    currency_code: string;
    category_id: string;
    category_name: string;
    expense_count: number;
    incurred_minor: number;
    net_paid_minor: number;
    due_minor: number;
}
export interface ExpenseSummaryTotals {
    currency_code: string;
    expense_count: number;
    incurred_minor: number;
    net_paid_minor: number;
    due_minor: number;
}
export interface ExpenseSummary {
    basis: 'active_expenses_incurred_in_range_paid_to_date';
    filters: {
        from: string | null;
        to: string | null;
        category_id: string | null;
        currency_code: string | null;
        status: 'active';
    };
    groups: ExpenseSummaryGroup[];
    totals: ExpenseSummaryTotals[];
}
export interface ExpenseListFilters {
    from?: string | null;
    to?: string | null;
    categoryId?: string | null;
    status?: ExpenseStatusFilter;
    currencyCode?: string | null;
    limit?: unknown;
    cursor?: string | null;
}
export interface ExpenseWriteFields {
    category_id?: unknown;
    description?: unknown;
    amount_minor?: unknown;
    currency_code?: unknown;
    incurred_on?: unknown;
    payee?: unknown;
    notes?: unknown;
    replaces_expense_id?: unknown;
}
export interface MutationOutcome<T> {
    status: number;
    body: T;
    replayed: boolean;
}
export declare function normalizeIdempotencyKey(value: unknown): string | null;
/** Stable JSON for hashing: object keys sorted, arrays kept in order. */
export declare function canonicalizeExpenseRequest(value: unknown): string;
export declare function expenseRequestHash(operation: string, resourceId: string, fields: unknown): string;
/** Gregorian calendar validation: the date shape alone would accept 2026-02-30. */
export declare function isValidBusinessDate(value: string): boolean;
export declare function requireBusinessDate(value: unknown, field: string): string;
/** Store-local business date, so an expense can be dated to a closed trading day. */
export declare function currentBusinessDate(): string;
export declare function listExpenseCategories(db: ExpenseDb, filters?: {
    includeInactive?: boolean;
}): {
    categories: ExpenseCategoryRecord[];
    truncated: boolean;
};
export declare function getExpenseCategory(db: ExpenseDb, id: string): ExpenseCategoryRecord;
export declare function createExpenseCategory(db: ExpenseDb, input: {
    name?: unknown;
    is_active?: unknown;
    actorUserId: string;
    idempotencyKey?: string | null;
}): MutationOutcome<{
    category: ExpenseCategoryRecord;
}>;
export declare function updateExpenseCategory(db: ExpenseDb, id: string, input: {
    name?: unknown;
    is_active?: unknown;
    actorUserId: string;
    idempotencyKey?: string | null;
}): MutationOutcome<{
    category: ExpenseCategoryRecord;
}>;
export declare function normalizeExpenseLimit(value: unknown, fallback?: number): number;
export declare function listExpenses(db: ExpenseDb, filters?: ExpenseListFilters): {
    expenses: ExpenseRecord[];
    nextCursor: string | null;
    limit: number;
};
export declare function getExpense(db: ExpenseDb, id: string): ExpenseRecord;
/** Payment history, newest first; reversals stay in the ledger as their own entries. */
export declare function listExpensePayments(db: ExpenseDb, expenseId: string, options?: {
    limit?: unknown;
    cursor?: string | null;
}): {
    payments: ExpensePaymentRecord[];
    nextCursor: string | null;
};
/**
 * Current net paid/due against the active expenses incurred in the filter
 * range — not payments made in the period, and never subtracted from sales.
 */
export declare function summarizeExpenses(db: ExpenseDb, filters?: ExpenseListFilters): ExpenseSummary;
/** A new expense never starts paid: the ledger is the only source of paid state. */
export declare function createExpense(db: ExpenseDb, input: ExpenseWriteFields & {
    actorUserId: string;
    idempotencyKey?: string | null;
}): MutationOutcome<{
    expense: ExpenseRecord;
}>;
/** Keeps the original expense row, values and audit trail; only adds void metadata. */
export declare function voidExpense(db: ExpenseDb, id: string, input: {
    reason?: unknown;
    actorUserId: string;
    idempotencyKey?: string | null;
}): MutationOutcome<{
    expense: ExpenseRecord;
}>;
/** Voids the source and creates the linked replacement in one transaction. */
export declare function replaceExpense(db: ExpenseDb, id: string, input: ExpenseWriteFields & {
    reason?: unknown;
    actorUserId: string;
    idempotencyKey?: string | null;
}): MutationOutcome<{
    expense: ExpenseRecord;
    replaced_expense_id: string;
}>;
export declare function normalizeExpensePaymentMethod(value: unknown): ExpensePaymentMethod;
/** The committed ledger entry for one expense/payment pair, or a 404. */
export declare function getExpensePayment(db: ExpenseDb, expenseId: string, paymentId: string): ExpensePaymentRecord;
interface ExpensePaymentWriteFields {
    amount_minor?: unknown;
    method?: unknown;
    reference?: unknown;
    currency_code?: unknown;
}
/** Records money settled against the expense; the ledger row is never edited in place. */
export declare function recordExpensePayment(db: ExpenseDb, expenseId: string, input: ExpensePaymentWriteFields & {
    actorUserId: string;
    idempotencyKey?: string | null;
}): MutationOutcome<{
    expense: ExpenseRecord;
    payment: ExpensePaymentRecord;
}>;
/**
 * A reversal is a reasoned second ledger row that copies the committed
 * payment's amount and method. The original row and its drawer movement are
 * left untouched, and a cash reversal moves today's drawer once.
 */
export declare function reverseExpensePayment(db: ExpenseDb, expenseId: string, paymentId: string, input: {
    reason?: unknown;
    actorUserId: string;
    idempotencyKey?: string | null;
}): MutationOutcome<{
    expense: ExpenseRecord;
    payment: ExpensePaymentRecord;
}>;
export interface ExpenseContext {
    currency_code: string;
    business_date: string;
    cash_session_open: boolean;
}
/** Entry defaults for the expense surfaces: store currency, store business date, drawer state. */
export declare function getExpenseContext(db: ExpenseDb, actorUserId?: string): ExpenseContext;
export {};
//# sourceMappingURL=expenses.d.ts.map