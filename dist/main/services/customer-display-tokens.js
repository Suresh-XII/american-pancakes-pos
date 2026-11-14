"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisplayFeedPaginationError = void 0;
exports.parseBoardStatuses = parseBoardStatuses;
exports.normalizeTokenLabel = normalizeTokenLabel;
exports.activeTokenCount = activeTokenCount;
exports.hasReachedTokenLimit = hasReachedTokenLimit;
exports.createDisplayToken = createDisplayToken;
exports.listDisplayTokens = listDisplayTokens;
exports.revokeDisplayToken = revokeDisplayToken;
exports.verifyDisplayToken = verifyDisplayToken;
exports.touchDisplayToken = touchDisplayToken;
exports.collectProjectedCompletedOrderIds = collectProjectedCompletedOrderIds;
exports.selectBoardEligibleOrderPage = selectBoardEligibleOrderPage;
exports.buildDisplayFeed = buildDisplayFeed;
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const customer_display_config_1 = require("./customer-display-config");
const order_item_status_1 = require("../../shared/order-item-status");
const orders_1 = require("./orders");
const TOKEN_PREFIX = 'cdt_';
const MAX_LABEL_LENGTH = 60;
const MAX_ACTIVE_TOKENS = 20;
const FEED_ORDER_LIMIT = 100;
const COMPLETED_CANDIDATE_BATCH_SIZE = 200;
const LAST_SEEN_THROTTLE_MS = 60_000;
function parseBoardStatuses(raw) {
    if (typeof raw !== 'string' || raw.length === 0)
        return null;
    const parts = raw.split(',');
    if (parts.length === 0 ||
        parts.some((part) => !customer_display_config_1.CUSTOMER_DISPLAY_STATUSES.includes(part))) {
        return null;
    }
    return customer_display_config_1.CUSTOMER_DISPLAY_STATUSES.filter((status) => parts.includes(status));
}
class DisplayFeedPaginationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DisplayFeedPaginationError';
    }
}
exports.DisplayFeedPaginationError = DisplayFeedPaginationError;
function encodeDisplayFeedCursor(cursor) {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeDisplayFeedCursor(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
        throw new DisplayFeedPaginationError('Invalid cursor');
    }
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    }
    catch {
        throw new DisplayFeedPaginationError('Invalid cursor');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new DisplayFeedPaginationError('Invalid cursor');
    }
    const { created_at, id } = parsed;
    if (typeof created_at !== 'string' ||
        created_at.trim().length === 0 ||
        typeof id !== 'number' ||
        !Number.isSafeInteger(id) ||
        id <= 0) {
        throw new DisplayFeedPaginationError('Invalid cursor');
    }
    return { created_at, id };
}
const lastSeenWrites = new Map();
function hashToken(token) {
    return (0, node_crypto_1.createHash)('sha256').update(token).digest('hex');
}
function normalizeTokenLabel(value) {
    if (typeof value !== 'string')
        return null;
    const label = value.trim();
    return label.length > 0 && label.length <= MAX_LABEL_LENGTH ? label : null;
}
function activeTokenCount() {
    const row = (0, db_1.getDatabase)()
        .prepare('SELECT COUNT(*) AS n FROM customer_display_tokens WHERE revoked_at IS NULL')
        .get();
    return row.n;
}
function hasReachedTokenLimit() {
    return activeTokenCount() >= MAX_ACTIVE_TOKENS;
}
/** Creates a token and returns the plaintext once; only its hash is stored. */
function createDisplayToken(label, createdBy) {
    const token = `${TOKEN_PREFIX}${(0, node_crypto_1.randomBytes)(32).toString('hex')}`;
    const id = (0, node_crypto_1.randomUUID)();
    const createdAt = (0, db_1.now)();
    (0, db_1.getDatabase)()
        .prepare(`INSERT INTO customer_display_tokens (id, token_hash, label, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`)
        .run(id, hashToken(token), label, createdBy, createdAt);
    return { id, label, created_at: createdAt, last_seen_at: null, token };
}
function listDisplayTokens() {
    return (0, db_1.getDatabase)()
        .prepare(`SELECT id, label, created_at, last_seen_at FROM customer_display_tokens
       WHERE revoked_at IS NULL ORDER BY created_at DESC`)
        .all();
}
/** Returns true when an active token was revoked. */
function revokeDisplayToken(id) {
    lastSeenWrites.delete(id);
    const result = (0, db_1.getDatabase)()
        .prepare('UPDATE customer_display_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run((0, db_1.now)(), id);
    return result.changes > 0;
}
/** Resolves a presented token to its id, or null when unknown or revoked. */
function verifyDisplayToken(token) {
    if (!token.startsWith(TOKEN_PREFIX))
        return null;
    const row = (0, db_1.getDatabase)()
        .prepare('SELECT id FROM customer_display_tokens WHERE token_hash = ? AND revoked_at IS NULL')
        .get(hashToken(token));
    return row?.id ?? null;
}
function touchDisplayToken(id) {
    const nowMs = Date.now();
    const last = lastSeenWrites.get(id) ?? 0;
    if (nowMs - last < LAST_SEEN_THROTTLE_MS)
        return;
    lastSeenWrites.set(id, nowMs);
    (0, db_1.getDatabase)()
        .prepare('UPDATE customer_display_tokens SET last_seen_at = ? WHERE id = ?')
        .run((0, db_1.now)(), id);
}
function collectProjectedCompletedRows(db, allowedStatuses, options) {
    const projectedCompletedRows = [];
    if (!(0, db_1.isKdsEnabled)() || options.maxRows <= 0) {
        return projectedCompletedRows;
    }
    const completedCutoff = (0, orders_1.completedKdsProjectionCutoff)();
    const completedBaseSql = `SELECT co.id AS id,
                co.order_number AS order_number,
                co.created_at AS created_at
         FROM orders co
         WHERE +co.status = 'completed'
           AND co.created_at >= ?`;
    const completedExistsSql = `AND EXISTS (
           SELECT 1 FROM order_items oi
           WHERE oi.order_id = co.id
             AND oi.status IN ('pending', 'preparing', 'ready')
             AND oi.quantity > 0
         )
         ORDER BY co.created_at DESC, co.id DESC
         LIMIT ?`;
    let batchCursor = options.cursor;
    let cursorBatchStmt = null;
    while (projectedCompletedRows.length < options.maxRows) {
        if (batchCursor && batchCursor.created_at < completedCutoff)
            break;
        const batch = (batchCursor
            ? (cursorBatchStmt ??= db.prepare(`${completedBaseSql}
                 AND co.created_at <= ?
                 AND (co.created_at < ? OR (co.created_at = ? AND co.id < ?))
               ${completedExistsSql}`)).all(completedCutoff, batchCursor.created_at, batchCursor.created_at, batchCursor.created_at, batchCursor.id, COMPLETED_CANDIDATE_BATCH_SIZE)
            : db
                .prepare(`${completedBaseSql}
                 ${completedExistsSql}`)
                .all(completedCutoff, COMPLETED_CANDIDATE_BATCH_SIZE));
        if (batch.length === 0)
            break;
        const idPlaceholders = batch.map(() => '?').join(', ');
        const itemRows = db
            .prepare(`SELECT order_id, status, quantity
           FROM order_items
           WHERE order_id IN (${idPlaceholders})`)
            .all(...batch.map((row) => row.id));
        const itemsByOrderId = new Map();
        for (const item of itemRows) {
            let bucket = itemsByOrderId.get(item.order_id);
            if (!bucket) {
                bucket = [];
                itemsByOrderId.set(item.order_id, bucket);
            }
            bucket.push(item);
        }
        for (const candidate of batch) {
            const projectedStatus = (0, order_item_status_1.projectBoardStatusFromItems)(itemsByOrderId.get(candidate.id));
            if (projectedStatus && allowedStatuses.has(projectedStatus)) {
                projectedCompletedRows.push({
                    id: candidate.id,
                    order_number: candidate.order_number,
                    status: projectedStatus,
                    created_at: candidate.created_at,
                });
                if (projectedCompletedRows.length >= options.maxRows)
                    break;
            }
        }
        if (batch.length < COMPLETED_CANDIDATE_BATCH_SIZE)
            break;
        const lastCandidate = batch[batch.length - 1];
        batchCursor = { created_at: lastCandidate.created_at, id: lastCandidate.id };
    }
    return projectedCompletedRows;
}
function collectProjectedCompletedOrderIds(db, statuses, cursor = null) {
    return collectProjectedCompletedRows(db, new Set(statuses), {
        cursor,
        maxRows: Number.POSITIVE_INFINITY,
    }).map((row) => row.id);
}
function selectBoardEligibleOrderPage(db, options) {
    const decodedCursor = options.cursor ?? null;
    const placeholders = options.statuses.map(() => '?').join(', ');
    const selectColumns = `SELECT o.id AS id,
              o.order_number AS order_number,
              o.status AS status,
              o.created_at AS created_at
       FROM orders o`;
    const rows = (decodedCursor
        ? db
            .prepare(`${selectColumns}
             WHERE o.release_status = 'released'
               AND o.status IN (${placeholders})
               AND o.created_at <= ?
               AND (o.created_at < ? OR (o.created_at = ? AND o.id < ?))
             ORDER BY o.created_at DESC, o.id DESC
             LIMIT ?`)
            .all(...options.statuses, decodedCursor.created_at, decodedCursor.created_at, decodedCursor.created_at, decodedCursor.id, options.limit + 1)
        : db
            .prepare(`${selectColumns}
             WHERE o.release_status = 'released'
               AND o.status IN (${placeholders})
             ORDER BY o.created_at DESC, o.id DESC
             LIMIT ?`)
            .all(...options.statuses, options.limit + 1));
    const projectedCompletedRows = collectProjectedCompletedRows(db, new Set(options.statuses), {
        cursor: decodedCursor,
        maxRows: options.limit + 1,
    });
    let mergedRows = rows;
    if (projectedCompletedRows.length > 0) {
        const combined = [...rows, ...projectedCompletedRows].sort((a, b) => a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : b.id - a.id);
        const seenIds = new Set();
        mergedRows = [];
        for (const row of combined) {
            if (seenIds.has(row.id))
                continue;
            seenIds.add(row.id);
            mergedRows.push(row);
        }
    }
    const hasMore = mergedRows.length > options.limit;
    const pageRows = hasMore ? mergedRows.slice(0, options.limit) : mergedRows;
    const oldestRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && oldestRow ? { created_at: oldestRow.created_at, id: oldestRow.id } : null;
    return { pageRows, hasMore, nextCursor };
}
/** Sanitized board data: order numbers and statuses only, never customer or staff fields. */
function buildDisplayFeed(options) {
    const decodedCursor = options?.cursor !== undefined ? decodeDisplayFeedCursor(options.cursor) : null;
    const db = (0, db_1.getDatabase)();
    const settings = Object.fromEntries(db
        .prepare('SELECT key, value FROM settings WHERE key IN (?, ?)')
        .all('business_name', customer_display_config_1.CUSTOMER_DISPLAY_KEY).map((row) => [row.key, row.value]));
    const config = (0, customer_display_config_1.readStoredCustomerDisplayConfig)(settings[customer_display_config_1.CUSTOMER_DISPLAY_KEY]);
    const { pageRows, hasMore, nextCursor } = selectBoardEligibleOrderPage(db, {
        statuses: config.statuses,
        cursor: decodedCursor,
        limit: FEED_ORDER_LIMIT,
    });
    const next_cursor = nextCursor ? encodeDisplayFeedCursor(nextCursor) : null;
    const latestBillByOrderId = new Map();
    if (pageRows.length > 0) {
        const pagePlaceholders = pageRows.map(() => '?').join(', ');
        const billRows = db
            .prepare(`SELECT order_id, bill_number
         FROM bills
         WHERE order_id IN (${pagePlaceholders})
         ORDER BY id DESC`)
            .all(...pageRows.map((row) => row.id));
        for (const bill of billRows) {
            if (!latestBillByOrderId.has(bill.order_id) && bill.bill_number) {
                latestBillByOrderId.set(bill.order_id, bill.bill_number);
            }
        }
    }
    const orders = [...pageRows]
        .sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id)
        .map(({ id, order_number, status }) => ({
        id,
        number: latestBillByOrderId.get(id) || order_number,
        status,
    }));
    return {
        business_name: settings.business_name || '',
        config,
        orders,
        next_cursor,
        has_more: hasMore,
    };
}
//# sourceMappingURL=customer-display-tokens.js.map