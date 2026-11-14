"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderRoutes = exports.PIN_WINDOW_MS = exports.PIN_MAX_ATTEMPTS = exports.withPinVerificationLock = exports.resetPinRateLimitForTests = exports.clearPinRateLimit = exports.isPinRateLimited = exports.checkPinRateLimit = void 0;
exports.resolveOrderWriteRateLimitMax = resolveOrderWriteRateLimitMax;
exports.shouldSkipOrderWriteRateLimit = shouldSkipOrderWriteRateLimit;
exports.resolveEngineCharges = resolveEngineCharges;
const crypto_1 = require("crypto");
const express_1 = require("express");
const qrcode_1 = __importDefault(require("qrcode"));
const db_1 = require("../db");
const async_handler_1 = require("../middleware/async-handler");
const tax_1 = require("../services/tax");
const tax_engine_1 = require("../services/tax-engine");
const orders_1 = require("../services/orders");
const customer_display_tokens_1 = require("../services/customer-display-tokens");
const charges_1 = require("../services/charges");
const inventory_1 = require("../services/inventory");
const product_variants_1 = require("../services/product-variants");
const recipes_1 = require("../services/recipes");
const item_price_override_1 = require("../services/item-price-override");
const kds_1 = require("../services/kds");
const cloud_sync_1 = require("../services/cloud-sync");
const orders_validation_1 = require("./orders-validation");
const authorization_1 = require("../services/authorization");
const scheduled_orders_1 = require("../services/scheduled-orders");
const role_permissions_1 = require("../../shared/role-permissions");
const order_item_status_1 = require("../../shared/order-item-status");
const promotions_1 = require("../services/promotions");
const countries_1 = require("../countries");
const bills_1 = require("./bills");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const crypto_2 = require("crypto");
const security_1 = require("../middleware/security");
Object.defineProperty(exports, "checkPinRateLimit", { enumerable: true, get: function () { return security_1.checkPinRateLimit; } });
Object.defineProperty(exports, "isPinRateLimited", { enumerable: true, get: function () { return security_1.isPinRateLimited; } });
Object.defineProperty(exports, "clearPinRateLimit", { enumerable: true, get: function () { return security_1.clearPinRateLimit; } });
Object.defineProperty(exports, "resetPinRateLimitForTests", { enumerable: true, get: function () { return security_1.resetPinRateLimitForTests; } });
Object.defineProperty(exports, "withPinVerificationLock", { enumerable: true, get: function () { return security_1.withPinVerificationLock; } });
Object.defineProperty(exports, "PIN_MAX_ATTEMPTS", { enumerable: true, get: function () { return security_1.PIN_MAX_ATTEMPTS; } });
Object.defineProperty(exports, "PIN_WINDOW_MS", { enumerable: true, get: function () { return security_1.PIN_WINDOW_MS; } });
const operation_failure_1 = require("../lib/operation-failure");
const packaging_1 = require("../services/packaging");
const registeredSearchDatabases = new WeakSet();
function ensureOrderSearchFunctions(dbInstance) {
    if (registeredSearchDatabases.has(dbInstance))
        return;
    (0, db_1.registerOrderSearchFunctions)(dbInstance);
    registeredSearchDatabases.add(dbInstance);
}
function isSearchIndexAvailable(dbInstance) {
    try {
        const row = dbInstance
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'orders_search_fts'")
            .get();
        return Boolean(row);
    }
    catch {
        return false;
    }
}
const router = (0, express_1.Router)();
const ORDER_WRITE_RATE_LIMIT_ERROR = {
    error: 'Too many requests, please try again later.',
};
function resolveOrderWriteRateLimitMax(rawLimit = process.env.FLO_ORDER_WRITE_RATE_LIMIT_MAX) {
    const configured = Number.parseInt(rawLimit || '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : 60;
}
function shouldSkipOrderWriteRateLimit(req) {
    const userId = String(req.user?.userId || '');
    if (!userId)
        return false;
    return (0, security_1.isAllowedPrivateIp)(req.socket?.remoteAddress || '');
}
const orderReadRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
const scheduledOrderReadRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: ORDER_WRITE_RATE_LIMIT_ERROR,
});
const orderWriteRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: () => resolveOrderWriteRateLimitMax(),
    standardHeaders: true,
    legacyHeaders: false,
    message: ORDER_WRITE_RATE_LIMIT_ERROR,
    skip: shouldSkipOrderWriteRateLimit,
});
// Kept as its own bucket rather than folded into orderWriteRateLimit: this limit
// had its own counter when the route lived in the registrar, and sharing a
// counter would let unrelated order writes exhaust the item-void budget.
const orderItemCancelRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: () => resolveOrderWriteRateLimitMax(),
    standardHeaders: true,
    legacyHeaders: false,
    message: ORDER_WRITE_RATE_LIMIT_ERROR,
    skip: shouldSkipOrderWriteRateLimit,
});
const MAX_ORDER_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_ORDER_ITEMS = 200;
function structuredOperationFailure(req, capturePoint, outcome, error, displayCode) {
    const header = req.get('x-operation-id');
    const correlationId = (0, operation_failure_1.isOperationReference)(header) ? header : (0, crypto_2.randomUUID)();
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: capturePoint,
        outcome,
        correlation_id: correlationId,
        ...(displayCode ? { facts: { display_code: displayCode } } : {}),
    });
    if (!failure)
        return { error };
    req.diagnosticsCaptured = true;
    try {
        cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        /* Diagnostics must not affect order handling. */
    }
    return {
        error,
        reason_code: failure.reason_code,
        operation: failure.operation,
        stage: failure.stage,
        classification: failure.classification,
        outcome: failure.outcome,
        correlation_id: failure.correlation_id,
        ...(failure.facts.display_code ? { display_code: failure.facts.display_code } : {}),
    };
}
function resolveEngineCharges(order, subtotal, discountAmount) {
    const resolved = (0, charges_1.buildAppliedCharges)({
        currency: (0, bills_1.getTenantCurrency)(),
        orderType: String(order?.type || ''),
        subtotal,
        discountAmount,
        existingBreakdown: order?.charges_breakdown,
    });
    if (!resolved.configured &&
        !resolved.ownsServiceChargeColumn &&
        !resolved.ownsPackagingChargeColumn)
        return null;
    const chargeColumnOverrides = {};
    if (resolved.ownsServiceChargeColumn)
        chargeColumnOverrides.service_charge = resolved.columns.service_charge;
    if (resolved.ownsPackagingChargeColumn)
        chargeColumnOverrides.packaging_charge = resolved.columns.packaging_charge;
    return {
        appliedCharges: resolved.charges,
        ownsServiceChargeColumn: resolved.ownsServiceChargeColumn,
        ownsPackagingChargeColumn: resolved.ownsPackagingChargeColumn,
        chargeColumnOverrides,
        // Applicable definitions and retained snapshots own their standard column;
        // unmatched legacy amounts stay on the row.
        columns: {
            ...resolved.columns,
            service_charge: resolved.ownsServiceChargeColumn
                ? resolved.columns.service_charge
                : Number(order?.service_charge || 0),
            packaging_charge: resolved.ownsPackagingChargeColumn
                ? resolved.columns.packaging_charge
                : Number(order?.packaging_charge || 0),
        },
        chargesJson: (0, charges_1.serializeAppliedCharges)(resolved.charges),
    };
}
function orderIdempotencyKey(req) {
    const raw = req.get('Idempotency-Key');
    if (raw === undefined)
        return null;
    const supplied = raw.trim();
    if (!supplied)
        return null;
    if (supplied.length > MAX_ORDER_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(supplied)) {
        throw Object.assign(new Error('Idempotency-Key is invalid or too long'), { statusCode: 400 });
    }
    return supplied;
}
function getStoredOrderReplay(db, userId, idempotencyKey, requestHash) {
    const prior = db
        .prepare(`
    SELECT request_hash, response_json
    FROM order_idempotency
    WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
    ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `)
        .get(userId, idempotencyKey, userId);
    if (!prior)
        return null;
    if (prior.request_hash !== requestHash) {
        throw Object.assign(new Error('Idempotency-Key was already used for a different order request'), { statusCode: 409 });
    }
    try {
        return JSON.parse(prior.response_json);
    }
    catch {
        throw Object.assign(new Error('Stored order response is invalid'), { statusCode: 500 });
    }
}
function syncCustomerTagCounts(db, customerId, items) {
    const row = db.prepare('SELECT tag_counts FROM customers WHERE id = ?').get(customerId);
    if (!row)
        return;
    let counts = {};
    try {
        counts = row.tag_counts ? JSON.parse(row.tag_counts) : {};
    }
    catch {
        counts = {};
    }
    for (const item of items) {
        const product = db
            .prepare('SELECT tags FROM products WHERE id = ?')
            .get(item.product_id);
        if (!product?.tags)
            continue;
        let tags = [];
        try {
            tags = JSON.parse(product.tags);
        }
        catch {
            continue;
        }
        for (const tag of tags) {
            if (tag && typeof tag === 'string')
                counts[tag] = (counts[tag] || 0) + (item.quantity || 1);
        }
    }
    db.prepare('UPDATE customers SET tag_counts = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(counts), (0, db_1.now)(), customerId);
}
function variantSelectionSnapshot(variant) {
    return JSON.stringify({
        id: variant.id,
        name: variant.name,
        price: Number(variant.price),
        sku: variant.sku,
    });
}
/**
 * The stock pool an order item consumed, read from the pool recorded on the line
 * at sale time. Re-resolving the current variant settings could refund a pool
 * the sale never debited after a track_inventory or recipe-link edit.
 */
function orderItemInventoryTarget(db, item) {
    const recordedProductId = item.inventory_product_id || item.product_id;
    const recordedVariantId = item.inventory_variant_id ? String(item.inventory_variant_id) : null;
    const recorded = db.prepare('SELECT id FROM products WHERE id = ?').get(recordedProductId);
    return recorded ? { productId: recorded.id, variantId: recordedVariantId } : null;
}
/** Move the add-on pools an order line consumed, using the snapshot recorded on the line. */
function moveOrderItemAddonStock(db, addons, options) {
    const sign = options.direction === 'deplete' ? -1 : 1;
    const movementType = options.direction === 'deplete' ? 'sale' : 'cancel_restore';
    for (const addon of addons) {
        const quantity = Number(addon.inventory_deducted_quantity) || 0;
        if (quantity <= 0 || !addon.id)
            continue;
        try {
            (0, inventory_1.adjustProductStock)(db, {
                productId: null,
                addonId: addon.id,
                quantityDelta: sign * quantity,
                movementType,
                referenceType: 'order_item',
                referenceId: options.referenceId,
                reason: options.reason ?? null,
                actorUserId: options.actorUserId,
                createdAt: options.createdAt,
            });
        }
        catch (err) {
            // Two lines can each clear the per-line check and jointly exhaust the
            // pool; the ledger guard stops the second, so name the add-on as the
            // pre-check does rather than returning a bare "Insufficient stock".
            if (!(err instanceof inventory_1.InventoryServiceError) || err.statusCode !== 400)
                throw err;
            const pool = db.prepare('SELECT stock_quantity FROM addons WHERE id = ?').get(addon.id);
            throw new inventory_1.InventoryServiceError(400, `Add-on "${addon.name}" is out of stock (requested ${quantity}, available ${Number(pool?.stock_quantity ?? 0)})`);
        }
    }
}
/** The add-on snapshot rows an order line drew out of its pools, read at sale time. */
function orderItemAddonStockLines(db, orderItemId) {
    return db
        .prepare(`
    SELECT addon_id AS id, addon_name AS name, inventory_deducted_quantity
    FROM order_item_addons
    WHERE order_item_id = ? AND inventory_deducted_quantity > 0
  `)
        .all(orderItemId);
}
/** Resolves and validates item add-ons against catalog to enforce authoritative pricing. */
function resolveItemAddons(db, productId, addons, itemQuantity, options) {
    const addonInputs = Array.isArray(addons) ? addons : [];
    const product = db.prepare('SELECT category_id FROM products WHERE id = ?').get(productId);
    const productGroupIds = db
        .prepare('SELECT addon_group_id FROM addon_group_product WHERE product_id = ?')
        .all(productId).map((row) => row.addon_group_id);
    const categoryGroupIds = product?.category_id
        ? db
            .prepare('SELECT addon_group_id FROM category_addon_groups WHERE category_id = ?')
            .all(product.category_id).map((row) => row.addon_group_id)
        : [];
    const linkedGroupIds = new Set([...productGroupIds, ...categoryGroupIds]);
    const resolved = [];
    const groupSelections = new Map();
    for (const addon of addonInputs) {
        if (!addon)
            continue;
        if (!addon.id || typeof addon.id !== 'string') {
            throw new Error('Each add-on must reference a valid catalog add-on ID');
        }
        const catalog = db
            .prepare(`
      SELECT addons.*, addon_groups.is_active AS addon_group_is_active
      FROM addons LEFT JOIN addon_groups ON addon_groups.id = addons.addon_group_id
      WHERE addons.id = ?
    `)
            .get(addon.id);
        if (!catalog) {
            throw new Error(`Add-on "${addon.id}" was not found`);
        }
        if (catalog.is_active !== 1 ||
            (catalog.addon_group_id !== null && catalog.addon_group_is_active !== 1)) {
            throw new Error(`Add-on "${catalog.name}" is not available`);
        }
        const addonGroupId = catalog.addon_group_id;
        if (!addonGroupId || !linkedGroupIds.has(addonGroupId)) {
            throw new Error(`Add-on "${catalog.name}" is not available for this product`);
        }
        const quantity = addon.quantity ?? 1;
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
            throw new Error(`Invalid add-on quantity for "${catalog.name}": must be a positive integer`);
        }
        // One tracked add-on on a line consumes a whole item's worth: three burgers
        // with two extra bacon each take six, not two. An item quantity that is not
        // yet a positive number is refused by validateProductQuantity before the
        // order is written, so there is no requirement to check here.
        const unitCount = Number(itemQuantity);
        const requirement = Number.isFinite(unitCount) && unitCount > 0 ? unitCount * quantity : 0;
        let inventoryDeductedQuantity = 0;
        if (Number(catalog.track_inventory) === 1 && !options?.deferStockDeduction) {
            const available = Number(catalog.stock_quantity ?? 0);
            // Refusing is the point: a tracked add-on with nothing left must not be
            // silently substituted, so there is no variant-style fallback here.
            if (requirement - available > 1e-8) {
                throw new Error(`Add-on "${catalog.name}" is out of stock (requested ${requirement}, available ${available})`);
            }
            inventoryDeductedQuantity = requirement;
        }
        resolved.push({
            id: catalog.id,
            name: catalog.name,
            price: Number(catalog.price) || 0,
            quantity,
            inventory_deducted_quantity: inventoryDeductedQuantity,
        });
        const qty = Math.max(1, Math.floor(quantity));
        const current = groupSelections.get(addonGroupId) || { totalQty: 0, hasMultiQty: false };
        groupSelections.set(addonGroupId, {
            totalQty: current.totalQty + qty,
            hasMultiQty: current.hasMultiQty || qty > 1,
        });
    }
    // Validate every group linked to the product, not just ones with a selection —
    // otherwise a required group (e.g. Size) can be silently skipped by omitting `addons`.
    for (const groupId of linkedGroupIds) {
        const group = db
            .prepare('SELECT * FROM addon_groups WHERE id = ? AND is_active = 1')
            .get(groupId);
        if (!group)
            continue;
        const selection = groupSelections.get(groupId) || { totalQty: 0, hasMultiQty: false };
        if (!group.allow_multiple_quantities && selection.hasMultiQty) {
            throw new Error(`Add-on group "${group.name}" does not allow multiple quantities`);
        }
        if (group.max_selection !== null &&
            group.max_selection !== undefined &&
            selection.totalQty > group.max_selection) {
            throw new Error(`Total add-on quantity for group "${group.name}" exceeds maximum allowed (${group.max_selection})`);
        }
        const requiredMin = group.is_required
            ? Math.max(1, group.min_selection || 1)
            : group.min_selection || 0;
        if (requiredMin > 0 && selection.totalQty < requiredMin) {
            throw new Error(`Selection for group "${group.name}" requires at least ${requiredMin} item(s)`);
        }
    }
    return resolved;
}
router.get('/', orderReadRateLimit, (0, authorization_1.requirePermission)('orders.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const wheres = [];
        const params = [];
        const view = typeof req.query.view === 'string' ? req.query.view : 'all';
        if (!['all', 'active', 'unpaid'].includes(view)) {
            return res.status(400).json({ error: 'Invalid view parameter.' });
        }
        const boardStatuses = req.query.board_status !== undefined ? (0, customer_display_tokens_1.parseBoardStatuses)(req.query.board_status) : null;
        if (req.query.board_status !== undefined && boardStatuses === null) {
            return res.status(400).json({ error: 'Invalid board_status parameter.' });
        }
        const statusQuery = typeof req.query.status === 'string' ? req.query.status : '';
        const statuses = statusQuery ? statusQuery.split(',') : [];
        const statusIsActive = statuses.length === 1 && statuses[0] === 'active';
        if (boardStatuses === null && (view === 'active' || statusIsActive)) {
            wheres.push(`orders.id IN (
          SELECT ao.id FROM orders AS ao
          WHERE ao.status IN ('pending', 'preparing', 'ready', 'served')
          UNION ALL
          SELECT co.id FROM orders AS co
          WHERE ? = 1
            AND +co.status = 'completed'
            AND co.created_at >= ?
            AND EXISTS (
              SELECT 1 FROM order_items AS active_item
              WHERE active_item.order_id = co.id
                AND active_item.status IN ('pending', 'preparing', 'ready')
                AND active_item.quantity > 0
            )
        )`);
            params.push((0, db_1.isKdsEnabled)() ? 1 : 0, (0, orders_1.completedKdsProjectionCutoff)());
        }
        if (view === 'unpaid') {
            wheres.push("orders.status != 'cancelled'");
            wheres.push(`(
          NOT EXISTS (SELECT 1 FROM bills AS existing_bill WHERE existing_bill.order_id = orders.id)
          OR EXISTS (
            SELECT 1 FROM bills AS payable_bill
            WHERE payable_bill.order_id = orders.id
              AND COALESCE(payable_bill.payment_status, 'unpaid') IN ('unpaid', 'partial')
              AND payable_bill.balance > 0
          )
        )`);
        }
        if (statuses.length > 0 && !statusIsActive) {
            if (statuses.length === 1) {
                wheres.push('orders.status = ?');
                params.push(statuses[0]);
            }
            else {
                wheres.push(`orders.status IN (${statuses.map(() => '?').join(',')})`);
                params.push(...statuses);
            }
        }
        if (req.query.type) {
            wheres.push('orders.type = ?');
            params.push(req.query.type);
        }
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        if (search) {
            ensureOrderSearchFunctions(db);
            const phoneDigits = search.replace(/\D/g, '');
            const isPhoneSearch = Boolean(phoneDigits && !/\p{L}/u.test(search));
            const customerSearch = ['orders_search_contains(search_customer.name, ?)'];
            if (isPhoneSearch) {
                customerSearch.push('orders_search_digits_contains(search_customer.phone_digits, ?)');
                customerSearch.push('orders_search_digits_contains(search_customer.phone, ?)');
            }
            const udfClause = `(
        orders_search_contains(orders.order_number, ?)
        OR EXISTS (
          SELECT 1 FROM customers AS search_customer
          WHERE search_customer.id = orders.customer_id
            AND (${customerSearch.join(' OR ')})
        )
      )`;
            const isPrintableAscii = /^[\x20-\x7E]+$/.test(search) && !/[iI]$/.test(search);
            const isEligible = isPrintableAscii && search.length >= 3;
            const hasFts = isEligible && isSearchIndexAvailable(db);
            if (hasFts) {
                let candidateClause;
                const candidateParams = [];
                const ftsSearch = '"' + search.replace(/"/g, '""') + '"';
                if (isPhoneSearch) {
                    // For phone searches, customer phone strings may contain varied formatting
                    // (e.g. "+1/555 ext 0199"). Querying customers table with digit UDF efficiently
                    // identifies matching customer IDs across the small customers table, avoiding a
                    // full orders scan while preserving full parity across phone formats.
                    candidateClause = `(
              orders.id IN (SELECT rowid FROM orders_search_fts WHERE orders_search_fts MATCH ?)
              OR orders.customer_id IN (
                SELECT id FROM customers
                WHERE (phone_digits IS NOT NULL AND orders_search_digits_contains(phone_digits, ?))
                   OR (phone IS NOT NULL AND orders_search_digits_contains(phone, ?))
                   OR orders_search_contains(name, ?)
              )
            )`;
                    candidateParams.push(ftsSearch, phoneDigits, phoneDigits, search);
                }
                else {
                    candidateClause = `(
              orders.id IN (SELECT rowid FROM orders_search_fts WHERE orders_search_fts MATCH ?)
              OR orders.customer_id IN (
                SELECT id FROM customers WHERE rowid IN (
                  SELECT rowid FROM customers_search_fts WHERE customers_search_fts MATCH ?
                )
              )
            )`;
                    candidateParams.push(ftsSearch, ftsSearch);
                }
                wheres.push(`(${candidateClause} AND ${udfClause})`);
                params.push(...candidateParams, search, search);
                if (isPhoneSearch)
                    params.push(phoneDigits, phoneDigits);
            }
            else {
                wheres.push(udfClause);
                params.push(search, search);
                if (isPhoneSearch)
                    params.push(phoneDigits, phoneDigits);
            }
        }
        // Filter by UTC day or date range across indexed created_at column.
        if (req.query.today && req.query.today !== '0' && req.query.today !== 'false') {
            const [s, e] = (0, db_1.utcDayBounds)((0, db_1.utcTodayDate)());
            wheres.push('created_at >= ? AND created_at < ?');
            params.push(s, e);
        }
        else {
            const startDate = typeof req.query.start_date === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(req.query.start_date)
                ? req.query.start_date
                : null;
            const endDate = typeof req.query.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.end_date)
                ? req.query.end_date
                : null;
            if (startDate) {
                wheres.push('created_at >= ?');
                params.push((0, db_1.utcDayBounds)(startDate)[0]);
            }
            if (endDate) {
                wheres.push('created_at < ?');
                params.push((0, db_1.utcDayBounds)(endDate)[1]);
            }
        }
        if (req.query.table_id) {
            wheres.push('orders.table_id = ?');
            params.push(req.query.table_id);
        }
        // Cursor pagination: `before` / `after` are ORDER BY keys (created_at),
        // composed with `id` to break ties when many orders share a second.
        let beforeCursor = null;
        if (typeof req.query.before_id === 'string' && /^\d+$/.test(req.query.before_id)) {
            const oid = parseInt(req.query.before_id, 10);
            if (Number.isSafeInteger(oid) && oid > 0) {
                const ref = db.prepare('SELECT created_at FROM orders WHERE id = ?').get(oid);
                if (ref) {
                    beforeCursor = { created_at: ref.created_at, id: oid };
                }
            }
        }
        // Limit per-page items with default 50 and maximum 500.
        const requestedPerPage = req.query.per_page
            ? parseInt(req.query.per_page, 10)
            : NaN;
        const perPage = Number.isInteger(requestedPerPage) && requestedPerPage > 0
            ? Math.min(requestedPerPage, 500)
            : 50;
        if (boardStatuses !== null && wheres.length === 0) {
            const { pageRows, hasMore } = (0, customer_display_tokens_1.selectBoardEligibleOrderPage)(db, {
                statuses: boardStatuses,
                cursor: beforeCursor,
                limit: perPage,
            });
            if (pageRows.length === 0) {
                return res.json({ orders: [] });
            }
            const idPlaceholders = pageRows.map(() => '?').join(',');
            const fetchedOrders = db
                .prepare(`SELECT orders.* FROM orders WHERE orders.id IN (${idPlaceholders})`)
                .all(...pageRows.map((row) => row.id));
            const orderById = new Map(fetchedOrders.map((order) => [Number(order.id), order]));
            const pageOrders = pageRows
                .map((row) => orderById.get(row.id))
                .filter((order) => order !== undefined);
            const nextCursor = hasMore && pageOrders.length > 0 ? pageOrders[pageOrders.length - 1].id : null;
            const ordersWithRelations = batchHydrateOrders(db, pageOrders);
            return res.json({
                orders: ordersWithRelations,
                ...(nextCursor !== null && { nextCursor }),
            });
        }
        if (boardStatuses !== null) {
            const boardPlaceholders = boardStatuses.map(() => '?').join(',');
            const projectedCompletedIds = (0, customer_display_tokens_1.collectProjectedCompletedOrderIds)(db, boardStatuses, beforeCursor);
            if (projectedCompletedIds.length > 0) {
                wheres.push(`orders.id IN (
            SELECT ao.id FROM orders AS ao
            WHERE ao.status IN (${boardPlaceholders})
            UNION ALL
            SELECT CAST(value AS INTEGER) FROM json_each(?)
          )`);
                params.push(...boardStatuses, JSON.stringify(projectedCompletedIds));
            }
            else {
                wheres.push(`orders.id IN (
            SELECT ao.id FROM orders AS ao
            WHERE ao.status IN (${boardPlaceholders})
          )`);
                params.push(...boardStatuses);
            }
        }
        if (beforeCursor) {
            wheres.push('(orders.created_at, orders.id) < (?, ?)');
            params.push(beforeCursor.created_at, beforeCursor.id);
        }
        const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
        const perPagePlusOne = perPage + 1;
        const orders = db
            .prepare(`
      SELECT orders.* FROM orders
      ${whereSql}
      ORDER BY orders.created_at DESC, orders.id DESC
      LIMIT ?
    `)
            .all(...params, perPagePlusOne);
        const hasMore = orders.length > perPage;
        const pageOrders = hasMore ? orders.slice(0, perPage) : orders;
        const nextCursor = hasMore ? pageOrders[pageOrders.length - 1].id : null;
        // Batch hydrate relations for page orders.
        const ordersWithRelations = batchHydrateOrders(db, pageOrders);
        res.json({
            orders: ordersWithRelations,
            ...(nextCursor !== null && { nextCursor }),
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
function summarizeWhatsAppReceiptStatuses(statuses) {
    const positiveStatuses = statuses.filter((status) => status === 'sent' || status === 'delivered' || status === 'read');
    if (positiveStatuses.length === statuses.length && statuses.length > 0)
        return 'sent';
    if (positiveStatuses.length > 0)
        return 'partial';
    if (statuses.some((status) => status === 'queued' || status === 'typing'))
        return 'pending';
    if (statuses.some((status) => status === 'failed'))
        return 'failed';
    return null;
}
function insertOrderItems(db, orderId, items, context) {
    const { tenantInfo, customer, isOnlineOrder, actorUserId } = context;
    const initialStatus = context.initialStatus ?? 'pending';
    const checkoutLifecycle = db.prepare('SELECT inventory_lifecycle FROM orders WHERE id=?').get(orderId)
        ?.inventory_lifecycle === 'checkout_v1';
    const insertItem = db.prepare(`
  INSERT INTO order_items (order_id, product_id, variant_id, product_name, product_sku, unit_price, quantity, inventory_deducted_quantity, inventory_product_id, inventory_variant_id,
    subtotal, tax_amount, tax_breakdown, tax_snapshot, tax_type, discount_amount, total, variant_selection,
    modifier_selection, special_instructions, recipe_snapshot, ingredient_cost, ingredient_cost_known, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    const insertedItemIds = [];
    for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
        if (!product) {
            throw Object.assign(new Error(`Product ${item.product_id} not found`), {
                statusCode: 404,
            });
        }
        const quantity = item.quantity;
        // Item discounts are applied via dedicated discount routes, not creation;
        // quantity edits on existing items preserve their scaled discount.
        const itemDiscount = context.preserveUnitPrice &&
            typeof item.discount_amount === 'number' &&
            Number.isFinite(item.discount_amount) &&
            item.discount_amount > 0
            ? item.discount_amount
            : 0;
        // Validate quantity and price
        (0, orders_validation_1.validateProductQuantity)(product, quantity);
        const variant = (0, product_variants_1.resolveOrderItemVariant)(db, product, item, isOnlineOrder, {
            // A quantity reduction keeps the stored selection even if the merchant
            // has since disabled the variant or added variants the line never had;
            // the line was valid when it was sold. Increases and replacements
            // re-validate against the current catalog.
            allowInactive: !!context.preserveSelections,
            allowUnselected: !!context.preserveSelections,
        });
        let unitPrice = context.preserveUnitPrice
            ? Number(item.unit_price)
            : variant
                ? (0, product_variants_1.variantUnitPrice)(variant, isOnlineOrder)
                : parseFloat(String(product.price));
        const menuUnitPrice = unitPrice;
        let priceOverride = null;
        if (item.price_override !== undefined && item.price_override !== null) {
            if (!context.canOverridePrice) {
                throw Object.assign(new Error('Only the owner can override item prices'), {
                    statusCode: 403,
                });
            }
            priceOverride = (0, item_price_override_1.parsePriceOverrideInput)(item.price_override, (0, countries_1.getCurrencyFractionDigits)((0, bills_1.getTenantCurrency)()));
            unitPrice = priceOverride.price;
        }
        // Deferred legacy scheduled orders have historically captured no held
        // inventory.  checkout_v1 orders are different: they still defer the
        // movement, but must retain the immutable target and quantity that the
        // settlement consumer will use later.
        const deduction = context.deferStockDeduction && !checkoutLifecycle
            ? null
            : context.preserveSelections && typeof item.inventory_deducted_quantity === 'number'
                ? item.inventory_deducted_quantity > 0
                    ? {
                        productId: item.inventory_target_product_id ?? product.id,
                        variantId: item.inventory_target_variant_id !== undefined
                            ? item.inventory_target_variant_id
                            : (variant?.id ?? null),
                        deductedQuantity: item.inventory_deducted_quantity,
                    }
                    : null
                : (0, inventory_1.resolveInventoryDeduction)(product, quantity, variant);
        if (unitPrice < 0 || !Number.isFinite(unitPrice)) {
            throw Object.assign(new Error(`Invalid price for ${product.name}: must be a non-negative number`), { statusCode: 400 });
        }
        let itemSubtotal = unitPrice * quantity;
        if (item.addons && Array.isArray(item.addons)) {
            for (const addon of item.addons) {
                if (!addon)
                    continue;
                if (addon.quantity !== undefined) {
                    if (typeof addon.quantity !== 'number' ||
                        !Number.isInteger(addon.quantity) ||
                        addon.quantity <= 0) {
                        throw Object.assign(new Error(`Invalid add-on quantity for ${addon.name || 'addon'}: must be a positive integer`), { statusCode: 400 });
                    }
                }
                const addonQty = addon.quantity || 1;
                itemSubtotal += (addon.price || 0) * addonQty * quantity;
            }
        }
        itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);
        const taxResult = (0, tax_1.calculateItemTax)(tenantInfo, product, itemSubtotal, customer);
        const itemTotal = itemSubtotal + (taxResult.tax_type === 'inclusive' ? 0 : taxResult.tax_amount);
        const itemTaxSnapshotJson = taxResult.tax_snapshot
            ? JSON.stringify(taxResult.tax_snapshot)
            : null;
        const itemCreatedAt = (0, db_1.now)();
        const recipeSnapshot = context.deferStockDeduction && !checkoutLifecycle
            ? null
            : context.preserveSelections && item.recipe_snapshot !== undefined
                ? item.recipe_snapshot
                : (0, recipes_1.buildRecipeSnapshot)(db, product.id, quantity, variant?.recipe_multiplier ?? 1);
        const { ingredientCost, ingredientCostKnown } = (0, recipes_1.extractOrderItemCostFromSnapshot)(recipeSnapshot);
        const insertItemResult = insertItem.run(orderId, product.id, variant ? variant.id : null, product.name, product.sku, unitPrice, quantity, deduction ? deduction.deductedQuantity : 0, deduction ? deduction.productId : null, deduction?.variantId ?? null, itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown), itemTaxSnapshotJson, taxResult.tax_type, itemDiscount, itemTotal, context.preserveSelections && item.variant_selection !== undefined
            ? JSON.stringify(item.variant_selection ?? null)
            : variant
                ? variantSelectionSnapshot(variant)
                : JSON.stringify(item.variant_selection || null), JSON.stringify(item.modifier_selection || null), item.special_instructions || null, recipeSnapshot ? JSON.stringify(recipeSnapshot) : null, ingredientCost, ingredientCostKnown, initialStatus, itemCreatedAt, itemCreatedAt);
        (0, db_1.insertOrderItemAddons)(db, insertItemResult.lastInsertRowid, item.addons, itemCreatedAt);
        // Stage 2 only records the immutable serving/packaging decision.  It deliberately
        // does not create any supply movement or change the established stock lifecycle.
        (0, packaging_1.persistItemServingAndPackaging)({
            db,
            orderItemId: insertItemResult.lastInsertRowid,
            itemQuantity: quantity,
            allocations: item.serving_allocations,
            actorUserId,
            productId: product.id,
            variantId: variant ? variant.id : null,
            explicitProfileId: item.packaging_profile_id ?? (item.no_packaging ? 'none' : null),
        });
        insertedItemIds.push(insertItemResult.lastInsertRowid);
        if (priceOverride) {
            (0, item_price_override_1.markItemPriceOverridden)(db, insertItemResult.lastInsertRowid, {
                originalUnitPrice: menuUnitPrice,
                reason: priceOverride.reason,
                actorUserId,
                at: itemCreatedAt,
            });
            (0, db_1.recordOrderAudit)(db, {
                orderId,
                orderItemId: Number(insertItemResult.lastInsertRowid),
                actorUserId,
                action: 'item_price_overridden',
                details: {
                    original_unit_price: menuUnitPrice,
                    new_unit_price: priceOverride.price,
                    reason: priceOverride.reason,
                },
            });
        }
        if (!context.deferStockDeduction && !checkoutLifecycle) {
            if (deduction) {
                (0, inventory_1.adjustProductStock)(db, {
                    productId: deduction.productId,
                    variantId: deduction.variantId ?? null,
                    quantityDelta: -deduction.deductedQuantity,
                    movementType: 'sale',
                    referenceType: 'order_item',
                    referenceId: String(insertItemResult.lastInsertRowid),
                    actorUserId: actorUserId,
                    createdAt: itemCreatedAt,
                });
            }
            moveOrderItemAddonStock(db, (item.addons ?? []), {
                direction: 'deplete',
                actorUserId: actorUserId,
                referenceId: String(insertItemResult.lastInsertRowid),
                createdAt: itemCreatedAt,
            });
            if (recipeSnapshot) {
                (0, recipes_1.applyRecipeSnapshot)(db, recipeSnapshot, {
                    direction: 'deplete',
                    actorUserId: actorUserId,
                    referenceId: String(insertItemResult.lastInsertRowid),
                    createdAt: itemCreatedAt,
                });
            }
        }
    }
    return insertedItemIds;
}
function resolveOrderLevelDiscountAmount(order, subtotal, decimals) {
    if (subtotal <= 0)
        return 0;
    const existingDiscountAmount = Number(order.discount_amount || 0);
    const configuredValue = Number(order.discount_value || 0);
    if (order.discount_type === 'percentage') {
        if (configuredValue > 0) {
            return Math.min(subtotal, Number(((subtotal * configuredValue) / 100).toFixed(decimals)));
        }
        const previousSubtotal = Number(order.subtotal || 0);
        if (existingDiscountAmount > 0 && previousSubtotal > 0) {
            return Math.min(subtotal, Number((existingDiscountAmount * (subtotal / previousSubtotal)).toFixed(decimals)));
        }
        return 0;
    }
    const flatDiscount = order.discount_type === 'amount' && configuredValue > 0
        ? configuredValue
        : existingDiscountAmount;
    if (flatDiscount <= 0)
        return 0;
    return Math.min(subtotal, Number(flatDiscount.toFixed(decimals)));
}
function cancelOrderItemAndRestoreStock(db, currentItem, actorId, reason, options) {
    // Cancel the item and restore the inventory quantity recorded when it was added.
    db.prepare("UPDATE order_items SET status = 'cancelled', updated_at = ? WHERE id = ?").run((0, db_1.now)(), currentItem.id);
    const lifecycle = db.prepare('SELECT inventory_lifecycle FROM orders WHERE id=(SELECT order_id FROM order_items WHERE id=?)').get(currentItem.id);
    if (lifecycle?.inventory_lifecycle === 'checkout_v1') {
        return;
    }
    if (options?.skipStockRestore) {
        return;
    }
    const inventoryTarget = currentItem.inventory_deducted_quantity > 0 ? orderItemInventoryTarget(db, currentItem) : null;
    if (inventoryTarget) {
        (0, inventory_1.adjustProductStock)(db, {
            productId: inventoryTarget.productId,
            variantId: inventoryTarget.variantId,
            quantityDelta: currentItem.inventory_deducted_quantity,
            movementType: 'cancel_restore',
            referenceType: 'order_item',
            referenceId: `${currentItem.id}:${currentItem.updated_at}`,
            reason: reason || 'Item cancelled',
            actorUserId: actorId,
        });
    }
    moveOrderItemAddonStock(db, orderItemAddonStockLines(db, currentItem.id), {
        direction: 'restore',
        actorUserId: actorId,
        referenceId: `${currentItem.id}:${currentItem.updated_at}`,
        reason: reason || 'Item cancelled',
    });
    const recipeSnapshot = (0, recipes_1.parseRecipeSnapshot)(currentItem.recipe_snapshot);
    if (recipeSnapshot) {
        (0, recipes_1.applyRecipeSnapshot)(db, recipeSnapshot, {
            direction: 'restore',
            actorUserId: actorId,
            referenceId: `${currentItem.id}:${currentItem.updated_at}`,
        });
    }
}
function batchHydrateOrders(db, orders) {
    if (orders.length === 0)
        return [];
    // Normalize JSON text columns on orders and items.
    const parsedOrders = orders.map(db_1.parseRowJson);
    const ids = parsedOrders.map((o) => o.id);
    const tableIds = Array.from(new Set(parsedOrders.map((o) => o.table_id).filter(Boolean)));
    const customerIds = Array.from(new Set(parsedOrders.map((o) => o.customer_id).filter(Boolean)));
    const orderIdsCsv = `(${ids.map(() => '?').join(',')})`;
    const itemsRows = db
        .prepare(`SELECT * FROM order_items WHERE order_id IN ${orderIdsCsv} ORDER BY order_id, id`)
        .all(...ids)
        .map(db_1.parseItemJson);
    // Attach resolved addons and audit metadata, then regroup by order_id.
    const itemsWithAddons = (0, db_1.attachEffectiveAddons)(db, itemsRows);
    const itemIds = itemsWithAddons.map((item) => item.id);
    const allocationsByItemId = new Map();
    if (itemIds.length > 0) {
        const itemPlaceholders = itemIds.map(() => '?').join(',');
        const allocations = db
            .prepare(`SELECT * FROM order_item_serving_allocations WHERE order_item_id IN (${itemPlaceholders}) ORDER BY id`)
            .all(...itemIds);
        const allocationIds = allocations.map((allocation) => allocation.id);
        const packagingByAllocationId = new Map();
        if (allocationIds.length > 0) {
            const allocationPlaceholders = allocationIds.map(() => '?').join(',');
            const packaging = db
                .prepare(`SELECT * FROM order_item_packaging_allocations WHERE serving_allocation_id IN (${allocationPlaceholders}) ORDER BY id`)
                .all(...allocationIds);
            for (const allocation of packaging) {
                const list = packagingByAllocationId.get(allocation.serving_allocation_id) || [];
                list.push(allocation);
                packagingByAllocationId.set(allocation.serving_allocation_id, list);
            }
        }
        for (const allocation of allocations) {
            const list = allocationsByItemId.get(allocation.order_item_id) || [];
            list.push({
                ...allocation,
                packaging_allocations: packagingByAllocationId.get(allocation.id) || [],
            });
            allocationsByItemId.set(allocation.order_item_id, list);
        }
    }
    const itemsWithServing = itemsWithAddons.map((item) => ({
        ...item,
        // An empty array makes legacy records readable without pretending that a
        // historical order had a serving decision captured by Stage 2.
        serving_allocations: allocationsByItemId.get(item.id) || [],
    }));
    const itemsByOrder = new Map();
    for (const it of itemsWithServing) {
        const list = itemsByOrder.get(it.order_id) || [];
        list.push(it);
        itemsByOrder.set(it.order_id, list);
    }
    const tablesById = new Map();
    if (tableIds.length > 0) {
        const ph = tableIds.map(() => '?').join(',');
        const rows = db.prepare(`SELECT * FROM tables WHERE id IN (${ph})`).all(...tableIds);
        for (const t of rows)
            tablesById.set(t.id, t);
    }
    const customersById = new Map();
    if (customerIds.length > 0) {
        const ph = customerIds.map(() => '?').join(',');
        const rows = db.prepare(`SELECT * FROM customers WHERE id IN (${ph})`).all(...customerIds);
        for (const c of rows)
            customersById.set(c.id, (0, db_1.parseRowJson)(c));
    }
    const billsByOrderId = new Map();
    const billsById = new Map();
    const billRows = db
        .prepare(`SELECT * FROM bills WHERE order_id IN ${orderIdsCsv}`)
        .all(...ids);
    for (const b of billRows) {
        const parsed = (0, db_1.parseRowJson)(b);
        parsed.payment_method_correction = (0, bills_1.paymentMethodCorrectionEligibility)(db, parsed);
        const siblings = billsByOrderId.get(parsed.order_id) || [];
        siblings.push(parsed);
        billsByOrderId.set(parsed.order_id, siblings);
        billsById.set(parsed.id, parsed);
    }
    const loyaltyByBillId = new Map();
    if (billsById.size > 0) {
        const billIds = Array.from(billsById.keys());
        const ph = billIds.map(() => '?').join(',');
        const rows = db
            .prepare(`SELECT bill_id, type, COALESCE(SUM(amount),0) as total FROM loyalty_ledger WHERE bill_id IN (${ph}) AND type IN ('credit', 'debit') GROUP BY bill_id, type`)
            .all(...billIds);
        for (const r of rows) {
            const current = loyaltyByBillId.get(r.bill_id) || { earned: 0, redeemed: 0 };
            if (r.type === 'credit')
                current.earned = Number(r.total) || 0;
            if (r.type === 'debit')
                current.redeemed = Number(r.total) || 0;
            loyaltyByBillId.set(r.bill_id, current);
        }
    }
    const whatsappReceiptStatusByBillId = new Map();
    const paidBillIdsByOrderId = new Map();
    const receiptBillIds = Array.from(billsByOrderId.entries()).flatMap(([orderId, bills]) => {
        const paidBillIds = bills
            .filter((bill) => bill.payment_status === 'paid')
            .map((bill) => bill.id);
        paidBillIdsByOrderId.set(orderId, paidBillIds);
        return paidBillIds;
    });
    if (receiptBillIds.length > 0) {
        const ph = receiptBillIds.map(() => '?').join(',');
        const rows = db
            .prepare(`
      SELECT bill_id, status
      FROM whatsapp_messages
      WHERE direction = 'outbound'
        AND kind = 'bill_receipt'
        AND bill_id IN (${ph})
      ORDER BY id DESC
    `)
            .all(...receiptBillIds);
        for (const row of rows) {
            if (!whatsappReceiptStatusByBillId.has(row.bill_id)) {
                whatsappReceiptStatusByBillId.set(row.bill_id, row.status);
            }
        }
    }
    const whatsappReceiptStatusByOrderId = new Map();
    for (const [orderId, billIds] of paidBillIdsByOrderId) {
        whatsappReceiptStatusByOrderId.set(orderId, summarizeWhatsAppReceiptStatuses(billIds.map((billId) => whatsappReceiptStatusByBillId.get(billId) ?? null)));
    }
    const loyaltyEnabled = ['true', '1'].includes((0, db_1.getSettingValue)('loyalty_enabled') || '');
    const loyaltyByCustomerId = new Map();
    const billCustomerIds = Array.from(new Set(Array.from(billsById.values())
        .map((bill) => bill.customer_id)
        .filter(Boolean)));
    if (loyaltyEnabled && billCustomerIds.length > 0) {
        const ph = billCustomerIds.map(() => '?').join(',');
        const rows = db
            .prepare(`
      SELECT customer_id, type, COALESCE(SUM(amount), 0) as total
      FROM loyalty_ledger
      WHERE customer_id IN (${ph})
        AND type IN ('credit', 'debit')
      GROUP BY customer_id, type
    `)
            .all(...billCustomerIds);
        for (const r of rows) {
            const key = String(r.customer_id);
            const current = loyaltyByCustomerId.get(key) || { credits: 0, debits: 0 };
            if (r.type === 'credit')
                current.credits = Number(r.total) || 0;
            if (r.type === 'debit')
                current.debits = Number(r.total) || 0;
            loyaltyByCustomerId.set(key, current);
        }
    }
    return parsedOrders.map((order) => {
        const itemList = itemsByOrder.get(order.id) || [];
        const tableRow = order.table_id ? tablesById.get(order.table_id) : null;
        const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
        const customer = order.customer_id ? customersById.get(order.customer_id) : null;
        const bills = billsByOrderId.get(order.id) || [];
        for (const billRow of bills) {
            if (billRow.customer_id) {
                const billLoyalty = loyaltyByBillId.get(billRow.id) || { earned: 0, redeemed: 0 };
                const customerLoyalty = loyaltyByCustomerId.get(String(billRow.customer_id));
                billRow.points_earned = billLoyalty.earned;
                billRow.points_redeemed = billLoyalty.redeemed;
                billRow.points_balance =
                    loyaltyEnabled && customerLoyalty
                        ? Math.max(0, customerLoyalty.credits - customerLoyalty.debits)
                        : null;
            }
        }
        const bill = bills.find((row) => row.payment_status !== 'paid') || bills[0] || null;
        return {
            ...order,
            items: itemList,
            table,
            customer,
            bill,
            bills,
            whatsapp_receipt_status: whatsappReceiptStatusByOrderId.get(order.id) ?? null,
        };
    });
}
/** Sum immutable snapshot charges, excluding terminal lines just like order totals. */
function snapshotPackagingChargeForOrder(db, orderId) {
    const row = db
        .prepare(`
      SELECT COUNT(p.id) AS count, COALESCE(SUM(p.customer_charge_total_snapshot), 0) AS total
      FROM order_item_packaging_allocations p
      JOIN order_item_serving_allocations s ON s.id = p.serving_allocation_id
      JOIN order_items i ON i.id = s.order_item_id
      WHERE i.order_id = ? AND COALESCE(i.status, 'pending') NOT IN ('cancelled', 'voided', 'void_adjustment')
    `)
        .get(orderId);
    return { hasSnapshots: Number(row?.count || 0) > 0, total: Number(row?.total || 0) };
}
router.get('/scheduled', scheduledOrderReadRateLimit, (0, authorization_1.requirePermission)('orders.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let limit = 200;
        const rawLimit = req.query.limit;
        if (typeof rawLimit === 'string') {
            const parsedLimit = parseInt(rawLimit, 10);
            if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
                limit = Math.min(parsedLimit, 200);
            }
        }
        let cursor = null;
        if (typeof req.query.cursor === 'string' && req.query.cursor.trim()) {
            cursor = (0, scheduled_orders_1.decodeScheduledOrdersCursor)(req.query.cursor.trim());
            if (!cursor) {
                return res.status(400).json({ error: 'Invalid cursor', code: 'INVALID_CURSOR' });
            }
        }
        const countRow = db
            .prepare(`SELECT
             COUNT(CASE WHEN release_status = 'scheduled' THEN 1 END) AS scheduled_count,
             COUNT(CASE WHEN release_status = 'blocked' THEN 1 END) AS blocked_count
           FROM orders
           WHERE release_status IN ('scheduled', 'blocked')
             AND scheduled_for IS NOT NULL
             AND status NOT IN ('cancelled', 'completed')`)
            .get();
        const scheduled_count = countRow?.scheduled_count ?? 0;
        const blocked_count = countRow?.blocked_count ?? 0;
        let sql = `SELECT * FROM orders
                 WHERE release_status IN ('scheduled', 'blocked')
                   AND scheduled_for IS NOT NULL
                   AND status NOT IN ('cancelled', 'completed')`;
        const params = [];
        if (cursor) {
            sql += ` AND (
          (CASE WHEN release_status = 'blocked' THEN 0 ELSE 1 END > ?)
          OR (
            (CASE WHEN release_status = 'blocked' THEN 0 ELSE 1 END = ?)
            AND (
              (COALESCE(scheduled_for, '') > ?)
              OR (COALESCE(scheduled_for, '') = ? AND id > ?)
            )
          )
        )`;
            params.push(cursor.rank, cursor.rank, cursor.scheduled_for, cursor.scheduled_for, cursor.id);
        }
        sql += ` ORDER BY CASE WHEN release_status = 'blocked' THEN 0 ELSE 1 END ASC,
                        scheduled_for ASC,
                        id ASC
               LIMIT ?`;
        params.push(limit + 1);
        const rows = db.prepare(sql).all(...params).map(db_1.parseRowJson);
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const next_cursor = hasMore && pageRows.length > 0
            ? (0, scheduled_orders_1.encodeScheduledOrdersCursor)({
                rank: pageRows[pageRows.length - 1].release_status === 'blocked' ? 0 : 1,
                scheduled_for: String(pageRows[pageRows.length - 1].scheduled_for || ''),
                id: Number(pageRows[pageRows.length - 1].id),
            })
            : null;
        const orders = batchHydrateOrders(db, pageRows);
        res.json({
            orders,
            next_cursor,
            scheduled_count,
            blocked_count,
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Failed to load scheduled orders' });
    }
});
router.get('/awaiting-payment', orderReadRateLimit, (0, authorization_1.requirePermission)('orders.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let limit = 50;
        const rawLimit = req.query.limit;
        if (typeof rawLimit === 'string') {
            const parsedLimit = parseInt(rawLimit, 10);
            if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
                limit = Math.min(parsedLimit, 200);
            }
        }
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        let cursor = null;
        if (typeof req.query.cursor === 'string' && req.query.cursor.trim()) {
            try {
                const decoded = JSON.parse(Buffer.from(req.query.cursor.trim(), 'base64').toString('utf8'));
                if (typeof decoded.rank === 'number' &&
                    typeof decoded.created_at === 'string' &&
                    typeof decoded.id === 'number') {
                    cursor = decoded;
                }
            }
            catch {
                return res.status(400).json({ error: 'Invalid cursor', code: 'INVALID_CURSOR' });
            }
        }
        const countRow = db
            .prepare(`SELECT
             COUNT(CASE WHEN o.checkout_stage = 'awaiting_payment' THEN 1 END) AS awaiting_count,
             COUNT(CASE WHEN o.release_status = 'blocked' AND o.dispatch_policy = 'on_payment' THEN 1 END) AS blocked_count
           FROM orders o
           WHERE (o.checkout_stage = 'awaiting_payment' OR (o.release_status = 'blocked' AND o.dispatch_policy = 'on_payment'))
             AND o.status NOT IN ('cancelled', 'completed')`)
            .get();
        const awaiting_count = countRow?.awaiting_count ?? 0;
        const blocked_count = countRow?.blocked_count ?? 0;
        const total_count = awaiting_count + blocked_count;
        let sql = `
        SELECT
          o.id,
          o.order_number,
          o.type,
          o.table_id,
          t.number AS table_name,
          o.customer_id,
          c.name AS customer_name,
          c.phone AS customer_phone,
          o.scheduled_for,
          o.total,
          o.total AS total_amount,
          o.round_off,
          o.checkout_stage,
          o.dispatch_policy,
          o.release_status,
          o.release_blocked_reason,
          o.created_at,
          o.updated_at,
          b.id AS bill_id,
          b.bill_number,
          COALESCE(b.paid_amount, 0) AS paid_amount,
          COALESCE(b.balance, o.total) AS balance,
          COALESCE(b.payment_status, 'unpaid') AS bill_payment_status
        FROM orders o
        LEFT JOIN tables t ON t.id = o.table_id
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN bills b ON b.id = COALESCE(
          (SELECT id FROM bills WHERE order_id = o.id AND payment_status NOT IN ('paid', 'refunded') ORDER BY id ASC LIMIT 1),
          (SELECT id FROM bills WHERE order_id = o.id ORDER BY id ASC LIMIT 1)
        )
        WHERE (o.checkout_stage = 'awaiting_payment' OR (o.release_status = 'blocked' AND o.dispatch_policy = 'on_payment'))
          AND o.status NOT IN ('cancelled', 'completed')
      `;
        const params = [];
        if (search) {
            const searchPattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
            sql += ` AND (o.order_number LIKE ? ESCAPE '\\' OR t.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }
        if (cursor) {
            sql += ` AND (
          (CASE WHEN o.release_status = 'blocked' THEN 0 ELSE 1 END > ?)
          OR (
            (CASE WHEN o.release_status = 'blocked' THEN 0 ELSE 1 END = ?)
            AND (
              (o.created_at > ?)
              OR (o.created_at = ? AND o.id > ?)
            )
          )
        )`;
            params.push(cursor.rank, cursor.rank, cursor.created_at, cursor.created_at, cursor.id);
        }
        sql += ` ORDER BY CASE WHEN o.release_status = 'blocked' THEN 0 ELSE 1 END ASC,
                        o.created_at ASC,
                        o.id ASC
               LIMIT ?`;
        params.push(limit + 1);
        const rows = db.prepare(sql).all(...params).map(db_1.parseRowJson);
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const next_cursor = hasMore && pageRows.length > 0
            ? Buffer.from(JSON.stringify({
                rank: pageRows[pageRows.length - 1].release_status === 'blocked' ? 0 : 1,
                created_at: String(pageRows[pageRows.length - 1].created_at || ''),
                id: Number(pageRows[pageRows.length - 1].id),
            }), 'utf8').toString('base64')
            : null;
        const tickets = pageRows.map((order) => {
            const paymentTotals = evaluateOrderStatusPaymentBlock(db, order.id, order.total, order.round_off);
            return {
                ...order,
                ticket_balance: paymentTotals.totalOutstandingMinor / paymentTotals.minorFactor,
                ticket_paid_amount: paymentTotals.totalCollectedMinor / paymentTotals.minorFactor,
            };
        });
        res.json({
            orders: tickets,
            tickets,
            next_cursor,
            has_more: hasMore,
            awaiting_count,
            blocked_count,
            total_count,
            counts: {
                awaiting_count,
                blocked_count,
                total_count,
            },
        });
    }
    catch (error) {
        console.error('[API] Awaiting payment queue error:', error);
        res.status(500).json({ error: 'Failed to load awaiting payment queue' });
    }
});
router.get('/by-ticket/:ticket', orderReadRateLimit, (0, authorization_1.requirePermission)('orders.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const rawTicket = String(req.params.ticket || '').trim();
        const cleanTicket = rawTicket.replace(/^FLOCAFE-TICKET:/i, '').trim();
        if (!cleanTicket) {
            return res.status(400).json({ error: 'Ticket number is required' });
        }
        const byParam = String(req.query.by || '').trim();
        const loadById = byParam === 'id' && /^\d+$/.test(cleanTicket);
        const orderRow = db
            .prepare(`SELECT * FROM orders
           WHERE ${loadById ? 'id = ?' : 'order_number = ?'}
             AND status NOT IN ('cancelled', 'completed')
             AND checkout_stage = 'awaiting_payment'`)
            .get(loadById ? Number(cleanTicket) : cleanTicket);
        if (!orderRow) {
            return res.status(404).json({ error: 'Ticket not found or already paid' });
        }
        const [hydrated] = batchHydrateOrders(db, [(0, db_1.parseRowJson)(orderRow)]);
        const bills = db
            .prepare('SELECT * FROM bills WHERE order_id = ? ORDER BY id ASC')
            .all(orderRow.id).map(db_1.parseRowJson);
        const payableBill = bills.find((b) => b.payment_status !== 'paid' && Number(b.balance || 0) > 0);
        const primaryBill = payableBill || bills[0] || null;
        const allBillsSettled = bills.length > 0 &&
            bills.every((b) => b.payment_status === 'paid' && Number(b.balance || 0) <= 0);
        if (allBillsSettled) {
            return res.status(404).json({ error: 'Ticket not found or already paid' });
        }
        res.json({
            order: hydrated,
            bill: primaryBill,
            bills,
        });
    }
    catch (error) {
        console.error('[API] Ticket lookup error:', error);
        res.status(500).json({ error: 'Failed to lookup ticket' });
    }
});
router.get('/:id', orderReadRateLimit, (0, authorization_1.requirePermission)('orders.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const order = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id));
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        // Hydrate relations using batchHydrateOrders.
        const [hydrated] = batchHydrateOrders(db, [order]);
        res.json({ order: hydrated });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.create'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    let operationCommitted = false;
    try {
        const body = req.body || {};
        const { table_id, customer_id, type, guest_count, special_instructions, packaging_charge, delivery_charge, service_charge, items, online_platform, external_order_id, delivery_address, expected_payment_method, expected_payment_method_id, delivery_note, waived_charge_ids, opted_in_charge_ids, dispatch_policy, checkout_stage, } = body;
        // Carries optional service charge without automatic calculation policy.
        const idempotencyKey = orderIdempotencyKey(req);
        const idempotencyUserId = String(req.user.userId);
        const requestHash = idempotencyKey
            ? (0, crypto_1.createHash)('sha256').update(JSON.stringify(body)).digest('hex')
            : null;
        // Always use authenticated user ID to ensure correct server visibility and attribution.
        const authenticatedUserId = req.user.userId;
        if (!Array.isArray(items) || items.length === 0) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'At least one item is required'));
        }
        if (items.length > MAX_ORDER_ITEMS) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', `A maximum of ${MAX_ORDER_ITEMS} items is allowed per request`));
        }
        if (!type || !['dine_in', 'takeaway', 'delivery', 'online'].includes(type)) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'Valid type is required (dine_in, takeaway, delivery, online)'));
        }
        if (dispatch_policy !== undefined &&
            dispatch_policy !== null &&
            !['immediate', 'on_payment'].includes(dispatch_policy)) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'Valid dispatch_policy is required (immediate, on_payment)'));
        }
        const isOnPayment = dispatch_policy === 'on_payment';
        if (isOnPayment && type === 'delivery') {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'Multi-counter payment flow is not supported for delivery orders'));
        }
        if (isOnPayment && !['takeaway', 'dine_in'].includes(type)) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'Multi-counter payment flow is only supported for takeaway and dine-in orders'));
        }
        const derivedCheckoutStage = isOnPayment ? 'awaiting_payment' : 'paid';
        if (checkout_stage !== undefined && checkout_stage !== null) {
            if (!['building', 'awaiting_payment', 'paid'].includes(checkout_stage) ||
                checkout_stage !== derivedCheckoutStage) {
                return res
                    .status(400)
                    .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', `Invalid checkout_stage: expected '${derivedCheckoutStage}' for dispatch_policy '${isOnPayment ? 'on_payment' : 'immediate'}'`));
            }
        }
        if (guest_count !== undefined &&
            guest_count !== null &&
            (!Number.isSafeInteger(guest_count) || guest_count < 1 || guest_count > 99)) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'guest_count must be a whole number between 1 and 99'));
        }
        let pkgCharge;
        let delCharge;
        let serviceCharge;
        try {
            pkgCharge = (0, tax_1.normalizeChargeAmount)(packaging_charge, 'packaging');
            delCharge = (0, tax_1.normalizeChargeAmount)(delivery_charge, 'delivery');
            serviceCharge = (0, tax_1.normalizeChargeAmount)(service_charge, 'service_charge');
        }
        catch (error) {
            const statusCode = typeof error === 'object' &&
                error !== null &&
                'statusCode' in error &&
                typeof error.statusCode === 'number'
                ? error.statusCode
                : 400;
            const message = error instanceof Error ? error.message : 'Invalid charge amount';
            return res
                .status(statusCode)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', message));
        }
        // Cashier charge decisions taken in the cart travel with the order, so the
        // engine applies them instead of resetting to the merchant defaults.
        if ([waived_charge_ids, opted_in_charge_ids].some((list) => list !== undefined &&
            list !== null &&
            (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')))) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'waived_charge_ids and opted_in_charge_ids must be arrays of charge ids'));
        }
        const waivedChargeIds = (waived_charge_ids || []);
        const optedInChargeIds = (opted_in_charge_ids || []);
        if (online_platform !== undefined &&
            online_platform !== null &&
            typeof online_platform !== 'string') {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'online_platform must be a string'));
        }
        if (external_order_id !== undefined &&
            external_order_id !== null &&
            typeof external_order_id !== 'string') {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'external_order_id must be a string'));
        }
        if (delivery_address !== undefined &&
            delivery_address !== null &&
            typeof delivery_address !== 'string') {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'delivery_address must be a string'));
        }
        const deliveryAddress = typeof delivery_address === 'string' ? delivery_address.trim() || null : null;
        if (delivery_note !== undefined &&
            delivery_note !== null &&
            typeof delivery_note !== 'string') {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', 'delivery_note must be a string'));
        }
        // Courier-only details: other order types never store them.
        const isDelivery = type === 'delivery';
        const deliveryNote = isDelivery && typeof delivery_note === 'string' ? delivery_note.trim() || null : null;
        const onlinePlatform = typeof online_platform === 'string' ? online_platform.trim().slice(0, 100) : null;
        const externalOrderId = typeof external_order_id === 'string' ? external_order_id.trim().slice(0, 100) : null;
        const isOnlineOrder = Boolean(onlinePlatform);
        const db = (0, db_1.getDatabase)();
        if (idempotencyKey && requestHash) {
            const replayed = getStoredOrderReplay(db, idempotencyUserId, idempotencyKey, requestHash);
            if (replayed) {
                const replayedOrder = replayed.order;
                const qrPayload = replayed.qr_payload ??
                    (replayedOrder?.dispatch_policy === 'on_payment'
                        ? `FLOCAFE-TICKET:${replayedOrder.order_number}`
                        : null);
                let qrDataUrl = replayed.qr_data_url ?? null;
                if (qrPayload && !qrDataUrl) {
                    qrDataUrl = await qrcode_1.default.toDataURL(qrPayload, {
                        errorCorrectionLevel: 'M',
                        width: 256,
                    });
                }
                return res.status(200).json({
                    order: replayedOrder,
                    ...(qrPayload ? { qr_payload: qrPayload, qr_data_url: qrDataUrl } : {}),
                });
            }
        }
        let scheduledOrderMeta = null;
        try {
            scheduledOrderMeta = (0, scheduled_orders_1.validateScheduledOrderRequest)(db, {
                orderType: type,
                scheduledForInput: body.scheduled_for,
            });
        }
        catch (err) {
            const statusCode = err instanceof scheduled_orders_1.ScheduledOrderError ? err.statusCode : 400;
            const message = err instanceof Error ? err.message : 'Invalid scheduled kitchen release time';
            const code = err instanceof scheduled_orders_1.ScheduledOrderError ? err.code : undefined;
            return res.status(statusCode).json({
                ...structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', message),
                ...(code ? { code } : {}),
            });
        }
        const isScheduledCreation = Boolean(scheduledOrderMeta);
        const shouldDeferRelease = isScheduledCreation || isOnPayment;
        // Free text that ends up printed on a courier slip, so it is capped and
        // validated the same way order notes are, at this boundary.
        let expectedPaymentMethod;
        let expectedPaymentMethodId = null;
        try {
            (0, orders_validation_1.validateDeliveryAddress)(db, deliveryAddress);
            (0, orders_validation_1.validateDeliveryNote)(db, deliveryNote);
            if (isDelivery) {
                // An explicit configured-method identity wins over the string contract:
                // a method literally named "Pending" or "Unknown" would otherwise be
                // read back as the sentinel. Its canonical name is stored with the ID.
                const identity = (0, orders_validation_1.resolveExpectedPaymentMethodIdentity)(db, expected_payment_method_id, expected_payment_method);
                if (identity) {
                    expectedPaymentMethod = identity.name;
                    expectedPaymentMethodId = identity.id;
                }
                else {
                    expectedPaymentMethod = (0, orders_validation_1.resolveExpectedPaymentMethod)(db, expected_payment_method);
                }
            }
            else {
                // Non-delivery orders ignore delivery collection metadata, like before.
                expectedPaymentMethod = null;
            }
        }
        catch (err) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.create.other_validation', 'not_applied', err instanceof Error ? err.message : 'Invalid delivery details'));
        }
        try {
            (0, orders_validation_1.validateOrderNotes)(db, special_instructions);
            for (const item of items) {
                (0, orders_validation_1.validateItemNotes)(db, item.special_instructions);
                item.addons = resolveItemAddons(db, item.product_id, item.addons, item.quantity, {
                    deferStockDeduction: shouldDeferRelease,
                });
            }
        }
        catch (err) {
            const msg = err?.message || 'Item validation failed';
            const isRequiredGroup = typeof msg === 'string' &&
                (msg.includes('requires at least') ||
                    msg.includes('exceeds maximum allowed') ||
                    msg.includes('does not allow multiple'));
            const isAddonUnavailable = typeof msg === 'string' &&
                (msg.includes('is not available') ||
                    msg.includes('was not found') ||
                    msg.includes('is out of stock'));
            const point = isRequiredGroup
                ? 'fc.backend.order.create.addon_group_validation'
                : isAddonUnavailable
                    ? 'fc.backend.order.create.addon_item_validation'
                    : 'fc.backend.order.create.other_validation';
            return res.status(400).json(structuredOperationFailure(req, point, 'not_applied', msg));
        }
        const result = (0, db_1.withTxn)(() => {
            if (idempotencyKey) {
                const prior = db
                    .prepare(`
          SELECT request_hash, response_json
          FROM order_idempotency
          WHERE (user_id = ? OR user_id = 'legacy') AND idempotency_key = ?
          ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END
          LIMIT 1
        `)
                    .get(idempotencyUserId, idempotencyKey, idempotencyUserId);
                if (prior) {
                    if (prior.request_hash !== requestHash) {
                        throw Object.assign(new Error('Idempotency-Key was already used for a different order request'), { statusCode: 409 });
                    }
                    try {
                        const response = JSON.parse(prior.response_json);
                        return {
                            order: response.order,
                            orderItems: response.order?.items || [],
                            idempotentReplay: true,
                        };
                    }
                    catch {
                        throw Object.assign(new Error('Stored order response is invalid'), {
                            statusCode: 500,
                        });
                    }
                }
            }
            if (isOnPayment) {
                const setting = db
                    .prepare("SELECT value FROM settings WHERE key = 'multi_counter_enabled'")
                    .get();
                if (setting?.value !== 'true') {
                    throw Object.assign(new Error('Multi-counter ordering is disabled.'), {
                        statusCode: 409,
                        code: 'MULTI_COUNTER_DISABLED',
                    });
                }
            }
            // Generate order number inside transaction to prevent race conditions
            const orderNumber = (0, db_1.generateOrderNumber)();
            // Get settings for tax calculation
            const settings = {};
            db.prepare('SELECT key, value FROM settings')
                .all()
                .forEach((row) => {
                settings[row.key] = row.value;
            });
            const tenantInfo = {
                country: settings.country || '',
                business_type: settings.business_type || 'restaurant',
                state_code: settings.state_code || '',
                currency: (0, bills_1.getTenantCurrency)(),
                taxes_enabled: settings.taxes_enabled === 'true',
            };
            const chargeCategories = (0, tax_1.getConfiguredChargeTaxCategories)(tenantInfo.country);
            const chargeContext = {
                packaging_charge: pkgCharge,
                delivery_charge: delCharge,
                service_charge: serviceCharge,
                packaging_tax_category_id: chargeCategories.packaging?.categoryId || null,
                delivery_tax_category_id: chargeCategories.delivery?.categoryId || null,
                service_charge_tax_category_id: chargeCategories.service_charge?.categoryId || null,
            };
            const reservedCustomerId = type === 'dine_in' && table_id
                ? db
                    .prepare("SELECT reservation_customer_id FROM tables WHERE id = ? AND status = 'reserved'")
                    .get(table_id)?.reservation_customer_id || null
                : null;
            const orderCustomerId = customer_id || reservedCustomerId || null;
            const orderResult = db
                .prepare(`
        INSERT INTO orders (order_number, table_id, customer_id, user_id, type, delivery_address, expected_payment_method, expected_payment_method_id, delivery_note, guest_count, special_instructions,
          packaging_charge, delivery_charge, packaging_tax_category_id, delivery_tax_category_id,
          service_charge, service_charge_tax_category_id, online_platform, external_order_id,
          scheduled_for, release_status, released_at, release_blocked_reason,
          checkout_stage, dispatch_policy, inventory_lifecycle,
          status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'checkout_v1', 'pending', ?, ?)
      `)
                .run(orderNumber, table_id || null, orderCustomerId, authenticatedUserId, type, deliveryAddress, expectedPaymentMethod, expectedPaymentMethodId, deliveryNote, guest_count || null, special_instructions || null, pkgCharge, delCharge, chargeContext.packaging_tax_category_id, chargeContext.delivery_tax_category_id, serviceCharge, chargeContext.service_charge_tax_category_id, onlinePlatform || null, externalOrderId || null, scheduledOrderMeta ? scheduledOrderMeta.scheduledForUtc : null, shouldDeferRelease ? 'scheduled' : 'released', derivedCheckoutStage, isOnPayment ? 'on_payment' : dispatch_policy || 'immediate', (0, db_1.now)(), (0, db_1.now)());
            const orderId = orderResult.lastInsertRowid;
            const checkoutLifecycle = true;
            let subtotal = 0;
            let totalTax = 0;
            let exclusiveTax = 0;
            const allTaxBreakdowns = [];
            const allTaxSnapshots = [];
            const customer = orderCustomerId
                ? db.prepare('SELECT * FROM customers WHERE id = ?').get(orderCustomerId)
                : null;
            const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, variant_id, product_name, product_sku, unit_price, quantity, inventory_deducted_quantity, inventory_product_id, inventory_variant_id,
          subtotal, tax_amount, tax_breakdown, tax_snapshot, tax_type, discount_amount, total, variant_selection,
          modifier_selection, special_instructions, recipe_snapshot, ingredient_cost, ingredient_cost_known, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);
            const validatedItems = [];
            for (let idx = 0; idx < items.length; idx++) {
                const item = items[idx];
                const product = db
                    .prepare('SELECT * FROM products WHERE id = ?')
                    .get(item.product_id);
                if (!product) {
                    throw Object.assign(new Error(`Product ${item.product_id} not found`), {
                        statusCode: 404,
                    });
                }
                const quantity = item.quantity;
                // Item discounts are applied via dedicated discount routes, not creation.
                const itemDiscount = 0;
                // Validate quantity and price
                (0, orders_validation_1.validateProductQuantity)(product, quantity);
                const variant = (0, product_variants_1.resolveOrderItemVariant)(db, product, item, isOnlineOrder);
                let unitPrice = variant
                    ? (0, product_variants_1.variantUnitPrice)(variant, isOnlineOrder)
                    : parseFloat(product.price);
                const menuUnitPrice = unitPrice;
                let priceOverride = null;
                if (item.price_override !== undefined && item.price_override !== null) {
                    if (!(0, authorization_1.hasPermission)(authenticatedUserId, item_price_override_1.ITEM_PRICE_OVERRIDE_PERMISSION)) {
                        throw Object.assign(new Error('Only the owner can override item prices'), {
                            statusCode: 403,
                        });
                    }
                    priceOverride = (0, item_price_override_1.parsePriceOverrideInput)(item.price_override, (0, countries_1.getCurrencyFractionDigits)((0, bills_1.getTenantCurrency)()));
                    unitPrice = priceOverride.price;
                }
                const deduction = shouldDeferRelease && !checkoutLifecycle
                    ? null
                    : (0, inventory_1.resolveInventoryDeduction)(product, quantity, variant);
                if (unitPrice < 0 || !Number.isFinite(unitPrice)) {
                    throw Object.assign(new Error(`Invalid price for ${product.name}: must be a non-negative number`), { statusCode: 400 });
                }
                let itemSubtotal = unitPrice * quantity;
                if (item.addons && Array.isArray(item.addons)) {
                    for (const addon of item.addons) {
                        if (!addon)
                            continue;
                        if (addon.quantity !== undefined) {
                            if (typeof addon.quantity !== 'number' ||
                                !Number.isInteger(addon.quantity) ||
                                addon.quantity <= 0) {
                                throw Object.assign(new Error(`Invalid add-on quantity for ${addon.name || 'addon'}: must be a positive integer`), { statusCode: 400 });
                            }
                        }
                        const addonQty = addon.quantity || 1;
                        itemSubtotal += (addon.price || 0) * addonQty * quantity;
                    }
                }
                itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);
                const itemId = String(item.id || item.product_id || idx + 1);
                validatedItems.push({
                    item,
                    product,
                    quantity,
                    variant,
                    unitPrice,
                    menuUnitPrice,
                    priceOverride,
                    deduction,
                    itemSubtotal,
                    itemId,
                });
            }
            const itemsSubtotal = validatedItems.reduce((acc, v) => acc + v.itemSubtotal, 0);
            const servingAllocationCount = validatedItems.filter((entry) => entry.item.serving_allocations !== undefined && entry.item.serving_allocations !== null).length;
            if (servingAllocationCount > 0 && servingAllocationCount !== validatedItems.length) {
                throw Object.assign(new Error('Serving allocations must be supplied for every order item'), { statusCode: 400 });
            }
            const hasServingAllocations = servingAllocationCount === validatedItems.length;
            const packagingFromServing = validatedItems.reduce((sum, entry) => sum +
                (0, packaging_1.previewItemPackaging)(db, entry.item.serving_allocations, entry.quantity, entry.product?.id, entry.variant?.id, entry.item.packaging_profile_id ?? (entry.item.no_packaging ? 'none' : null)), 0);
            const currency = (0, bills_1.getTenantCurrency)();
            const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
            const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
            const resolvedCharges = (0, charges_1.buildAppliedCharges)({
                currency,
                orderType: type,
                subtotal: itemsSubtotal,
                discountAmount: 0,
                waivedIds: waivedChargeIds,
                optedInIds: optedInChargeIds,
            });
            const engineColumns = resolvedCharges.configured ? resolvedCharges.columns : null;
            const appliedServiceCharge = resolvedCharges.ownsServiceChargeColumn
                ? resolvedCharges.columns.service_charge
                : serviceCharge;
            // Requests without Stage 2 data are legacy requests and must retain the
            // previous generic packaging behavior.  Explicit serving allocations own
            // the packaging column so profile snapshots can never be double charged.
            const appliedPackagingCharge = hasServingAllocations
                ? packagingFromServing
                : resolvedCharges.ownsPackagingChargeColumn
                    ? resolvedCharges.columns.packaging_charge
                    : pkgCharge;
            const otherCharges = engineColumns ? engineColumns.other_charges : 0;
            const chargesForPersistence = hasServingAllocations
                ? resolvedCharges.charges.filter((charge) => charge.id !== 'packaging_charge')
                : resolvedCharges.charges;
            const appliedChargeContext = {
                ...chargeContext,
                service_charge: appliedServiceCharge,
                packaging_charge: appliedPackagingCharge,
            };
            const { itemResults: documentTaxResults, chargeTaxes } = (0, tax_1.calculateDocumentTaxes)(tenantInfo, {
                items: validatedItems.map((v, idx) => ({
                    lineId: `line-${String(idx + 1).padStart(4, '0')}:${v.itemId}`,
                    product: v.product,
                    taxableAmount: v.itemSubtotal,
                })),
                chargeContext: appliedChargeContext,
                customer,
            });
            for (let idx = 0; idx < validatedItems.length; idx++) {
                const { item, product, quantity, variant, unitPrice, menuUnitPrice, priceOverride, deduction, itemSubtotal, } = validatedItems[idx];
                const taxResult = documentTaxResults[idx];
                totalTax += taxResult.tax_amount;
                if (taxResult.tax_type !== 'inclusive') {
                    exclusiveTax += taxResult.tax_amount;
                }
                if (taxResult.tax_breakdown) {
                    allTaxBreakdowns.push(taxResult.tax_breakdown);
                }
                const itemTaxSnapshotJson = taxResult.tax_snapshot
                    ? JSON.stringify(taxResult.tax_snapshot)
                    : null;
                allTaxSnapshots.push(itemTaxSnapshotJson);
                const itemTotal = itemSubtotal + (taxResult.tax_type === 'inclusive' ? 0 : taxResult.tax_amount);
                subtotal += itemSubtotal;
                const itemCreatedAt = (0, db_1.now)();
                const recipeSnapshot = (0, recipes_1.buildRecipeSnapshot)(db, product.id, quantity, variant?.recipe_multiplier ?? 1);
                const { ingredientCost, ingredientCostKnown } = (0, recipes_1.extractOrderItemCostFromSnapshot)(recipeSnapshot);
                const insertItemResult = insertItem.run(orderId, product.id, variant ? variant.id : null, product.name, product.sku, unitPrice, quantity, deduction ? deduction.deductedQuantity : 0, deduction ? deduction.productId : null, deduction?.variantId ?? null, itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown), itemTaxSnapshotJson, taxResult.tax_type, 0, itemTotal, variant
                    ? variantSelectionSnapshot(variant)
                    : JSON.stringify(item.variant_selection || null), JSON.stringify(item.modifier_selection || null), item.special_instructions || null, recipeSnapshot ? JSON.stringify(recipeSnapshot) : null, ingredientCost, ingredientCostKnown, itemCreatedAt, itemCreatedAt);
                (0, db_1.insertOrderItemAddons)(db, insertItemResult.lastInsertRowid, item.addons, itemCreatedAt);
                (0, packaging_1.persistItemServingAndPackaging)({
                    db,
                    orderItemId: insertItemResult.lastInsertRowid,
                    itemQuantity: quantity,
                    allocations: item.serving_allocations,
                    actorUserId: authenticatedUserId,
                    productId: product.id,
                    variantId: variant ? variant.id : null,
                    explicitProfileId: item.packaging_profile_id ?? (item.no_packaging ? 'none' : null),
                });
                if (priceOverride) {
                    (0, item_price_override_1.markItemPriceOverridden)(db, insertItemResult.lastInsertRowid, {
                        originalUnitPrice: menuUnitPrice,
                        reason: priceOverride.reason,
                        actorUserId: authenticatedUserId,
                        at: itemCreatedAt,
                    });
                    (0, db_1.recordOrderAudit)(db, {
                        orderId: Number(orderId),
                        orderItemId: Number(insertItemResult.lastInsertRowid),
                        actorUserId: authenticatedUserId,
                        action: 'item_price_overridden',
                        details: {
                            original_unit_price: menuUnitPrice,
                            new_unit_price: priceOverride.price,
                            reason: priceOverride.reason,
                        },
                    });
                }
                if (!shouldDeferRelease && !checkoutLifecycle) {
                    if (deduction) {
                        (0, inventory_1.adjustProductStock)(db, {
                            productId: deduction.productId,
                            variantId: deduction.variantId ?? null,
                            quantityDelta: -deduction.deductedQuantity,
                            movementType: 'sale',
                            referenceType: 'order_item',
                            referenceId: String(insertItemResult.lastInsertRowid),
                            actorUserId: authenticatedUserId,
                            createdAt: itemCreatedAt,
                        });
                    }
                    moveOrderItemAddonStock(db, item.addons, {
                        direction: 'deplete',
                        actorUserId: authenticatedUserId,
                        referenceId: String(insertItemResult.lastInsertRowid),
                        createdAt: itemCreatedAt,
                    });
                    if (recipeSnapshot) {
                        (0, recipes_1.applyRecipeSnapshot)(db, recipeSnapshot, {
                            direction: 'deplete',
                            actorUserId: authenticatedUserId,
                            referenceId: String(insertItemResult.lastInsertRowid),
                            createdAt: itemCreatedAt,
                        });
                    }
                }
            }
            const taxRollup = (0, tax_1.combineItemAndChargeTaxes)({
                itemTaxAmount: totalTax,
                itemExclusiveTaxAmount: exclusiveTax,
                itemBreakdowns: allTaxBreakdowns,
                itemSnapshots: allTaxSnapshots,
                itemTaxRatio: 1,
                chargeTaxes,
                minorFactor,
            });
            const preRoundTotal = subtotal +
                taxRollup.exclusiveTaxAmount +
                delCharge +
                appliedPackagingCharge +
                appliedServiceCharge +
                otherCharges;
            const total = Number(preRoundTotal.toFixed(decimals));
            if (!Number.isSafeInteger(Math.round(total * minorFactor))) {
                throw new charges_1.ChargeValidationError('Order total exceeds the supported currency precision');
            }
            const roundOff = 0;
            db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, total = ?,
          service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, total, appliedServiceCharge, appliedPackagingCharge, engineColumns ? (0, charges_1.serializeAppliedCharges)(chargesForPersistence) : null, roundOff, (0, db_1.now)(), orderId);
            if (table_id && type === 'dine_in') {
                db.prepare("UPDATE tables SET status = 'occupied', updated_at = ? WHERE id = ?").run((0, db_1.now)(), table_id);
            }
            if (isScheduledCreation && scheduledOrderMeta) {
                (0, db_1.recordOrderAudit)(db, {
                    orderId: Number(orderId),
                    actorUserId: authenticatedUserId,
                    action: 'order_scheduled',
                    details: {
                        scheduled_for: scheduledOrderMeta.scheduledForUtc,
                        timezone: scheduledOrderMeta.timezone,
                    },
                });
            }
            if (isOnPayment) {
                (0, bills_1.createOrSyncBillForOrder)(db, Number(orderId));
                (0, db_1.recordOrderAudit)(db, {
                    orderId: Number(orderId),
                    actorUserId: authenticatedUserId,
                    action: 'order_sent_to_payment',
                    details: {
                        dispatch_policy: 'on_payment',
                        checkout_stage: 'awaiting_payment',
                    },
                });
            }
            const [hydratedOrder] = batchHydrateOrders(db, [db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)]);
            const order = hydratedOrder;
            const orderItems = order.items;
            const response = { order };
            if (idempotencyKey && requestHash) {
                db.prepare('INSERT INTO order_idempotency (user_id, idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)').run(idempotencyUserId, idempotencyKey, requestHash, JSON.stringify(response), (0, db_1.now)());
            }
            return { order, orderItems, idempotentReplay: false };
        });
        operationCommitted = true;
        if (!result.idempotentReplay) {
            if (shouldDeferRelease) {
                (0, kds_1.notifyOrderUpdated)();
            }
            else {
                (0, kds_1.notifyKdsUpdate)();
            }
            cloud_sync_1.cloudSync.recordOrderChanged(result.order.id, isOnPayment
                ? 'order.sent_to_payment'
                : isScheduledCreation
                    ? 'order.scheduled'
                    : 'order.created');
            if (result.order.customer_id) {
                try {
                    syncCustomerTagCounts(db, result.order.customer_id, items);
                }
                catch (err) {
                    console.error('[Orders] Tag sync failed:', err);
                }
            }
        }
        const qrPayload = result.order?.dispatch_policy === 'on_payment'
            ? `FLOCAFE-TICKET:${result.order.order_number}`
            : null;
        let qrDataUrl = null;
        if (qrPayload) {
            qrDataUrl = await qrcode_1.default.toDataURL(qrPayload, {
                errorCorrectionLevel: 'M',
                width: 256,
            });
        }
        if (idempotencyKey && requestHash && qrPayload) {
            try {
                db.prepare('UPDATE order_idempotency SET response_json = ? WHERE user_id = ? AND idempotency_key = ?').run(JSON.stringify({
                    order: Object.assign({}, result.order, { items: result.orderItems }),
                    qr_payload: qrPayload,
                    qr_data_url: qrDataUrl,
                }), idempotencyUserId, idempotencyKey);
            }
            catch {
                // ignore cache update error
            }
        }
        res.status(result.idempotentReplay ? 200 : 201).json({
            order: Object.assign({}, result.order, { items: result.orderItems }),
            ...(qrPayload ? { qr_payload: qrPayload, qr_data_url: qrDataUrl } : {}),
        });
    }
    catch (error) {
        console.error('[Orders] Create error:', error);
        console.error('[API] Internal error:', error);
        const statusCode = error.statusCode || 500;
        const point = operationCommitted
            ? 'fc.backend.order.create.completion'
            : error?.diagnosticCode === 'quantity_invalid'
                ? 'fc.backend.order.create.quantity_validation'
                : error instanceof inventory_1.InventoryServiceError && error.statusCode === 400
                    ? 'fc.backend.order.create.stock_validation'
                    : statusCode >= 500
                        ? 'fc.backend.order.create.persistence'
                        : 'fc.backend.order.create.other_validation';
        return res.status(statusCode).json({
            ...structuredOperationFailure(req, point, operationCommitted ? 'applied' : 'not_applied', error.statusCode ? error.message : 'Internal server error'),
            ...(error.code === 'MULTI_COUNTER_DISABLED' ? { code: error.code } : {}),
        });
    }
}));
router.patch('/:id/schedule', orderWriteRateLimit, (0, authorization_1.requireAnyPermission)('orders.create', 'orders.status.update'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const actorId = String(req.user?.userId || '');
        if (!actorId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const rawScheduledFor = req.body?.scheduled_for;
        if (rawScheduledFor === undefined || rawScheduledFor === null || rawScheduledFor === '') {
            return res.status(400).json({
                error: 'scheduled_for is required. Use Release now to send the order to the kitchen immediately.',
                code: 'INVALID_FORMAT',
            });
        }
        const updatedOrderRow = (0, db_1.withTxn)(() => {
            const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
            if (!currentOrder) {
                throw new scheduled_orders_1.ScheduledOrderError(404, 'Order not found', 'ORDER_NOT_FOUND');
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw new scheduled_orders_1.ScheduledOrderError(409, `Cannot reschedule a ${currentOrder.status} order`, 'INVALID_ORDER_STATUS');
            }
            if (!currentOrder.release_status || currentOrder.release_status === 'released') {
                throw new scheduled_orders_1.ScheduledOrderError(409, 'Order has already been released to the kitchen and can no longer be rescheduled.', 'ALREADY_RELEASED');
            }
            const scheduledMeta = (0, scheduled_orders_1.validateScheduledOrderRequest)(db, {
                orderType: currentOrder.type,
                scheduledForInput: rawScheduledFor,
            });
            if (!scheduledMeta) {
                throw new scheduled_orders_1.ScheduledOrderError(400, 'scheduled_for is required.', 'INVALID_FORMAT');
            }
            const changedAt = (0, db_1.now)();
            const isBlocked = currentOrder.release_status === 'blocked';
            if (isBlocked) {
                db.prepare(`UPDATE orders
             SET scheduled_for = ?,
                 updated_at = ?
             WHERE id = ?`).run(scheduledMeta.scheduledForUtc, changedAt, currentOrder.id);
            }
            else {
                db.prepare(`UPDATE orders
             SET scheduled_for = ?,
                 release_status = 'scheduled',
                 release_blocked_reason = NULL,
                 updated_at = ?
             WHERE id = ?`).run(scheduledMeta.scheduledForUtc, changedAt, currentOrder.id);
            }
            (0, db_1.recordOrderAudit)(db, {
                orderId: String(currentOrder.id),
                actorUserId: actorId,
                action: 'schedule_updated',
                details: {
                    previous_scheduled_for: currentOrder.scheduled_for,
                    scheduled_for: scheduledMeta.scheduledForUtc,
                    previous_release_status: currentOrder.release_status,
                    release_status: isBlocked ? 'blocked' : 'scheduled',
                    timezone: scheduledMeta.timezone,
                },
            });
            return db.prepare('SELECT * FROM orders WHERE id = ?').get(currentOrder.id);
        });
        const [hydrated] = batchHydrateOrders(db, [updatedOrderRow]);
        (0, kds_1.notifyOrderUpdated)();
        cloud_sync_1.cloudSync.recordOrderChanged(String(req.params.id), 'order.schedule_updated');
        return res.json({ order: hydrated });
    }
    catch (error) {
        if (error instanceof scheduled_orders_1.ScheduledOrderError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        const errObj = error;
        console.error('[Orders] Schedule update error:', error);
        return res
            .status(errObj.statusCode || 500)
            .json({ error: errObj.statusCode ? errObj.message : 'Internal server error' });
    }
});
router.post('/:id/release', orderWriteRateLimit, (0, authorization_1.requireAnyPermission)('orders.create', 'orders.status.update'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const actorId = String(req.user?.userId || '');
        const result = await (0, scheduled_orders_1.releaseScheduledOrder)(db, String(req.params.id), {
            trigger: 'manual',
            actorUserId: actorId || null,
        });
        const [hydrated] = batchHydrateOrders(db, [result.order]);
        if (result.outcome === 'blocked') {
            return res.status(409).json({
                error: result.reason || 'Order release blocked due to stock or catalog availability.',
                code: 'RELEASE_BLOCKED',
                order: hydrated,
            });
        }
        return res.json({
            order: hydrated,
            already_released: result.outcome === 'already_released',
            kot_auto_printed: result.kotAutoPrinted,
        });
    }
    catch (error) {
        if (error instanceof scheduled_orders_1.ScheduledOrderError) {
            return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        const errObj = error;
        console.error('[Orders] Release error:', error);
        return res
            .status(errObj.statusCode || 500)
            .json({ error: errObj.statusCode ? errObj.message : 'Internal server error' });
    }
}));
router.post('/:id/items', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.create'), (req, res) => {
    let operationCommitted = false;
    try {
        const db = (0, db_1.getDatabase)();
        const body = req.body || {};
        const { items, special_instructions } = body;
        const idempotencyKey = orderIdempotencyKey(req);
        const idempotencyUserId = String(req.user.userId);
        const requestHash = idempotencyKey
            ? (0, crypto_1.createHash)('sha256')
                .update(JSON.stringify({ order_id: req.params.id, items, special_instructions }))
                .digest('hex')
            : null;
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        // Return stored idempotent replay if already processed.
        if (idempotencyKey && requestHash) {
            const replayResponse = getStoredOrderReplay(db, idempotencyUserId, idempotencyKey, requestHash);
            if (replayResponse)
                return res.json(replayResponse);
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.append.validation', 'not_applied', 'At least one item is required'));
        }
        if (items.length > MAX_ORDER_ITEMS) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.append.validation', 'not_applied', `A maximum of ${MAX_ORDER_ITEMS} items is allowed per request`));
        }
        // Get settings
        const settings = {};
        db.prepare('SELECT key, value FROM settings')
            .all()
            .forEach((row) => {
            settings[row.key] = row.value;
        });
        const tenantInfo = {
            country: settings.country || '',
            business_type: settings.business_type || 'restaurant',
            state_code: settings.state_code || '',
            currency: (0, bills_1.getTenantCurrency)(),
            taxes_enabled: settings.taxes_enabled === 'true',
        };
        const result = (0, db_1.withTxn)(() => {
            // Re-fetch and re-validate order state inside transaction to prevent concurrency races.
            const currentOrder = db
                .prepare('SELECT * FROM orders WHERE id = ?')
                .get(req.params.id);
            if (!currentOrder) {
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            }
            // Re-check idempotency under transaction lock.
            if (idempotencyKey && requestHash) {
                const replayResponse = getStoredOrderReplay(db, idempotencyUserId, idempotencyKey, requestHash);
                if (replayResponse)
                    return { replayResponse };
            }
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, req.params.id, currentOrder);
            if (db
                .prepare('SELECT 1 FROM bills WHERE order_id = ? AND split_group_id IS NOT NULL LIMIT 1')
                .get(req.params.id)) {
                throw Object.assign(new Error('Items cannot be changed after a check has been split'), {
                    statusCode: 409,
                });
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error('Cannot add items to a completed or cancelled order'), {
                    statusCode: 400,
                });
            }
            const refundedBill = db
                .prepare(`SELECT 1 FROM bills WHERE order_id = ? AND payment_status IN ('refunded', 'partially_refunded') LIMIT 1`)
                .get(req.params.id);
            if (refundedBill) {
                throw Object.assign(new Error('Cannot add items to a refunded order'), {
                    statusCode: 409,
                });
            }
            const deferUnreleased = (0, scheduled_orders_1.isUnreleasedOrderRow)(currentOrder);
            try {
                for (const item of items) {
                    (0, orders_validation_1.validateItemNotes)(db, item.special_instructions);
                    item.addons = resolveItemAddons(db, item.product_id, item.addons, item.quantity, {
                        deferStockDeduction: deferUnreleased,
                    });
                }
                if (special_instructions !== undefined) {
                    (0, orders_validation_1.validateOrderNotes)(db, special_instructions);
                }
            }
            catch (err) {
                throw Object.assign(new Error(err instanceof Error ? err.message : 'Invalid order item'), { statusCode: 400 });
            }
            const customer = currentOrder.customer_id
                ? db
                    .prepare('SELECT * FROM customers WHERE id = ?')
                    .get(currentOrder.customer_id)
                : null;
            const isOnlineOrder = !!currentOrder.online_platform;
            const insertedItemIds = insertOrderItems(db, req.params.id, items, {
                tenantInfo,
                customer,
                isOnlineOrder,
                actorUserId: idempotencyUserId,
                canOverridePrice: (0, authorization_1.hasPermission)(idempotencyUserId, item_price_override_1.ITEM_PRICE_OVERRIDE_PERMISSION),
                deferStockDeduction: deferUnreleased,
            });
            // BUG #3 FIX: Filter out terminal items from total recalculation.
            const totals = (0, orders_1.calculateOrderTotals)(db, req.params.id);
            const { subtotal } = totals;
            // BUG #12 FIX: Preserve order-level discount (scale percentage proportionally)
            const currency = (0, bills_1.getTenantCurrency)();
            const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
            const newDiscountAmount = resolveOrderLevelDiscountAmount(currentOrder, subtotal, decimals);
            const engineCharges = resolveEngineCharges(currentOrder, subtotal, newDiscountAmount);
            const snapshotPackaging = snapshotPackagingChargeForOrder(db, req.params.id);
            const effectiveAppliedCharges = snapshotPackaging.hasSnapshots
                ? (engineCharges?.appliedCharges || []).filter((charge) => charge.id !== 'packaging_charge')
                : engineCharges?.appliedCharges;
            const effectiveChargeOverrides = snapshotPackaging.hasSnapshots
                ? {
                    ...(engineCharges?.chargeColumnOverrides || {}),
                    packaging_charge: snapshotPackaging.total,
                }
                : engineCharges?.chargeColumnOverrides;
            const { taxRollup, total, roundOff } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: currentOrder,
                customer,
                totals,
                discountAmount: newDiscountAmount,
                taxScaling: 'when-discounted',
                appliedCharges: engineCharges ? effectiveAppliedCharges : null,
                chargeColumnOverrides: effectiveChargeOverrides,
            });
            const syncedServiceCharge = engineCharges
                ? engineCharges.columns.service_charge
                : currentOrder.service_charge || 0;
            const syncedPackagingCharge = snapshotPackaging.hasSnapshots
                ? snapshotPackaging.total
                : engineCharges
                    ? engineCharges.columns.packaging_charge
                    : currentOrder.packaging_charge || 0;
            const syncedChargesJson = engineCharges
                ? (0, charges_1.serializeAppliedCharges)(effectiveAppliedCharges || [])
                : (currentOrder.charges_breakdown ?? null);
            // Update order totals and optionally update order-level notes
            if (special_instructions !== undefined) {
                db.prepare(`
          UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?, service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, special_instructions = ?, updated_at = ? WHERE id = ?
        `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, special_instructions || null, (0, db_1.now)(), req.params.id);
            }
            else {
                db.prepare(`
          UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?, service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?
        `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, (0, db_1.now)(), req.params.id);
            }
            // BUG #4 FIX: Sync bill if it exists (add-items didn't update the bill)
            const existingBill = db
                .prepare("SELECT * FROM bills WHERE order_id = ? AND payment_status != 'paid'")
                .get(req.params.id);
            if (existingBill) {
                const pack = (0, tax_1.getActiveCountryPack)(tenantInfo.country);
                const { total: billTotal, adjustment: billRoundOff } = (0, tax_engine_1.applyPayableRounding)(total, pack, currency);
                const newBillBalance = Math.max(0, billTotal - (existingBill.paid_amount || 0));
                db.prepare(`UPDATE bills SET subtotal = ?, total = ?, balance = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?`).run(subtotal, billTotal, newBillBalance, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, billRoundOff, (0, db_1.now)(), existingBill.id);
            }
            (0, db_1.recordOrderAudit)(db, {
                orderId: req.params.id,
                actorUserId: idempotencyUserId,
                action: 'items_added',
                details: { item_ids: insertedItemIds },
            });
            (0, orders_1.reconcileActiveOrderStatusFromItems)(db, req.params.id, idempotencyUserId);
            const [hydratedOrder] = batchHydrateOrders(db, [db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)]);
            const updatedOrder = hydratedOrder;
            const updatedItems = updatedOrder.items;
            const response = { order: updatedOrder };
            if (idempotencyKey && requestHash) {
                db.prepare('INSERT INTO order_idempotency (user_id, idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)').run(idempotencyUserId, idempotencyKey, requestHash, JSON.stringify(response), (0, db_1.now)());
            }
            return { updatedOrder, updatedItems, replayResponse: null };
        });
        operationCommitted = true;
        if (result.replayResponse)
            return res.json(result.replayResponse);
        cloud_sync_1.cloudSync.recordOrderChanged(req.params.id, 'order.updated');
        if ((0, scheduled_orders_1.isUnreleasedOrderRow)(result.updatedOrder)) {
            (0, kds_1.notifyOrderUpdated)();
        }
        else {
            (0, kds_1.notifyKdsUpdate)();
        }
        res.json({ order: Object.assign({}, result.updatedOrder, { items: result.updatedItems }) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        const statusCode = error.statusCode || 500;
        const message = error.statusCode ? error.message : 'Internal server error';
        if (statusCode === 404 && !operationCommitted)
            return res.status(statusCode).json({ error: message });
        const point = operationCommitted
            ? 'fc.backend.order.append.completion'
            : statusCode >= 500
                ? 'fc.backend.order.append.persistence'
                : 'fc.backend.order.append.validation';
        return res.status(statusCode).json({
            ...structuredOperationFailure(req, point, operationCommitted ? 'applied' : 'not_applied', message),
            ...(error.code ? { code: error.code } : {}),
        });
    }
});
function evaluateOrderStatusPaymentBlock(db, orderId, orderTotal, orderRoundOff) {
    const tenantCurrency = (0, bills_1.getTenantCurrency)();
    const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(tenantCurrency);
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(tenantCurrency);
    const roundCurrency = (amount) => fractionDigits === 0 ? Math.round(amount) : Number(amount.toFixed(fractionDigits));
    const billRows = db
        .prepare(`
      SELECT b.*,
             COALESCE((SELECT SUM(r.amount_cents) FROM refunds r WHERE r.bill_id = b.id), 0) AS refunded_cents
      FROM bills b
      WHERE b.order_id = ?
      ORDER BY b.id ASC
    `)
        .all(String(orderId));
    const evaluatedBills = billRows.map((b) => {
        const totalMinor = Math.max(0, Math.round(Number(b.total || 0) * minorFactor));
        const roundOffMinor = Math.round(Number(b.round_off || 0) * minorFactor);
        const unroundedTotalMinor = Math.max(0, totalMinor - roundOffMinor);
        const paidMinor = Math.max(0, Math.round(Number(b.paid_amount || 0) * minorFactor));
        const refundedMinor = Math.max(0, Math.round(Number(b.refunded_cents || 0)));
        const fallbackBalance = Math.max(0, Number(b.total || 0) - Number(b.paid_amount || 0));
        const storedBalanceMinor = Math.max(0, Math.round(Number(b.balance ?? fallbackBalance) * minorFactor));
        let parsedPaymentDetails = [];
        if (typeof b.payment_details === 'string' && b.payment_details.trim()) {
            try {
                const parsed = JSON.parse(b.payment_details);
                if (Array.isArray(parsed))
                    parsedPaymentDetails = parsed;
            }
            catch {
                parsedPaymentDetails = [];
            }
        }
        else if (Array.isArray(b.payment_details)) {
            parsedPaymentDetails = b.payment_details;
        }
        const detailsPaidMinor = parsedPaymentDetails.reduce((sum, entry) => sum + Math.max(0, Math.round(Number(entry?.amount || 0) * minorFactor)), 0);
        const recordedPaidMinor = Math.max(paidMinor, detailsPaidMinor);
        const netCollectedMinor = Math.max(0, recordedPaidMinor - refundedMinor);
        const paymentStatus = String(b.payment_status || '');
        const effectiveCollectedMinor = Math.max(netCollectedMinor, paymentStatus === 'paid' ? Math.max(0, totalMinor - refundedMinor) : 0);
        const hasCollectedFunds = effectiveCollectedMinor > 0 ||
            (recordedPaidMinor > 0 && paymentStatus !== 'refunded') ||
            paymentStatus === 'partial' ||
            paymentStatus === 'partially_refunded' ||
            (paymentStatus === 'paid' && (totalMinor > 0 || parsedPaymentDetails.length > 0));
        const isPayable = totalMinor > 0 || storedBalanceMinor > 0;
        const unpaidBalanceMinor = isPayable
            ? Math.max(storedBalanceMinor, Math.max(0, totalMinor - recordedPaidMinor))
            : 0;
        const isSettled = !isPayable ||
            (paymentStatus === 'paid' && unpaidBalanceMinor === 0 && recordedPaidMinor >= totalMinor);
        return {
            id: b.id,
            paymentStatus,
            totalMinor,
            unroundedTotalMinor,
            recordedPaidMinor,
            effectiveCollectedMinor,
            hasCollectedFunds,
            isPayable,
            unpaidBalanceMinor,
            isSettled,
        };
    });
    const orderTotalMinor = Math.max(0, Math.round(Number(orderTotal || 0) * minorFactor));
    const orderRoundOffMinor = Math.round(Number(orderRoundOff || 0) * minorFactor);
    const orderUnroundedTotalMinor = Math.max(0, orderTotalMinor - orderRoundOffMinor);
    const effectiveOrderTargetMinor = Math.min(orderTotalMinor, orderUnroundedTotalMinor);
    const payableBills = evaluatedBills.filter((b) => b.isPayable);
    const billedCoverageMinor = evaluatedBills.reduce((sum, b) => sum + Math.max(b.totalMinor, b.unroundedTotalMinor), 0);
    const unbilledMinor = payableBills.length === 0
        ? orderTotalMinor
        : Math.max(0, effectiveOrderTargetMinor - billedCoverageMinor);
    const totalOutstandingMinor = payableBills.reduce((sum, b) => sum + b.unpaidBalanceMinor, 0) + unbilledMinor;
    const totalCollectedMinor = evaluatedBills.reduce((sum, b) => sum + b.effectiveCollectedMinor, 0);
    const paymentBlocksCompletion = totalOutstandingMinor > 0 ||
        (orderTotalMinor > 0 && payableBills.length === 0) ||
        payableBills.some((b) => !b.isSettled);
    return {
        minorFactor,
        roundCurrency,
        evaluatedBills,
        orderTotalMinor,
        payableBills,
        totalOutstandingMinor,
        totalCollectedMinor,
        paymentBlocksCompletion,
    };
}
router.patch('/:id/status', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.status.update'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const { status, reason, override_pin, free_table } = req.body;
        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }
        const validStatuses = ['preparing', 'ready', 'served', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
        }
        // reason is optional for cancellation
        const db = (0, db_1.getDatabase)();
        // Validate order existence before beginning authoritative transaction.
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        if ((0, scheduled_orders_1.isUnreleasedOrderRow)(order) && status !== 'cancelled') {
            return res.status(409).json({
                error: 'Scheduled order must be released to the kitchen before updating kitchen status.',
                code: 'ORDER_NOT_RELEASED',
            });
        }
        if (status === 'cancelled' && (0, scheduled_orders_1.isScheduledOrderRow)(order)) {
            const preCancelPaymentCheck = evaluateOrderStatusPaymentBlock(db, req.params.id, order.total, order.round_off);
            if (preCancelPaymentCheck.evaluatedBills.some((b) => b.hasCollectedFunds)) {
                return res.status(409).json({
                    error: 'Collected payment must be fully refunded before cancelling a scheduled order.',
                    code: 'REFUND_REQUIRED_BEFORE_CANCEL',
                });
            }
        }
        let preVerifiedStatusApprover = null;
        if ((status === 'cancelled' || status === 'completed') &&
            override_pin &&
            typeof override_pin === 'string') {
            const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
            const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
            const rateLimitKey = status === 'cancelled'
                ? `pin:${canonicalIp}:order-cancel`
                : `pin:${canonicalIp}:order-complete`;
            if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (!/^\d{4,6}$/.test(override_pin)) {
                (0, security_1.checkPinRateLimit)(rateLimitKey);
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            const preVerificationRequiresPayment = status === 'completed' &&
                evaluateOrderStatusPaymentBlock(db, req.params.id, order.total, order.round_off)
                    .paymentBlocksCompletion;
            const explicitApproverId = req.body.approver_id || req.body.manager_id || req.body.user_id;
            const candidateUsers = explicitApproverId
                ? db
                    .prepare("SELECT id, role, pin_hash FROM users WHERE id = ? AND is_active = 1 AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL")
                    .all(explicitApproverId)
                : db
                    .prepare("SELECT id, role, pin_hash FROM users WHERE is_active = 1 AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL")
                    .all();
            const preVerifiedCandidate = await (0, security_1.withPinVerificationLock)(rateLimitKey, async () => {
                if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                    return { rateLimited: true };
                }
                for (const candidate of candidateUsers) {
                    if ((0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                        (0, authorization_1.hasPermission)(candidate.id, 'orders.status.update') &&
                        (status !== 'cancelled' || (0, authorization_1.hasPermission)(candidate.id, 'orders.item.cancel')) &&
                        (!preVerificationRequiresPayment || (0, authorization_1.hasPermission)(candidate.id, 'payments.take'))) {
                        if (await (0, db_1.verifyPinAsync)(candidate.pin_hash, override_pin)) {
                            (0, security_1.clearPinRateLimit)(rateLimitKey);
                            return {
                                approver: {
                                    id: candidate.id,
                                    verifiedPinHash: candidate.pin_hash,
                                },
                            };
                        }
                    }
                }
                (0, security_1.checkPinRateLimit)(rateLimitKey);
                return { approver: null };
            });
            if (preVerifiedCandidate.rateLimited) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (!preVerifiedCandidate.approver) {
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            preVerifiedStatusApprover = preVerifiedCandidate.approver;
        }
        const nowStr = (0, db_1.now)();
        const { updatedOrder, orderItems, table, changed } = (0, db_1.withTxn)(() => {
            const currentOrder = db
                .prepare('SELECT * FROM orders WHERE id = ?')
                .get(req.params.id);
            if (!currentOrder) {
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            }
            const authUser = req.user;
            if (!authUser?.userId || !(0, authorization_1.hasPermission)(authUser.userId, 'orders.status.update')) {
                throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });
            }
            if (currentOrder.status === status) {
                // Idempotent same-state request for order
                const items = (0, db_1.attachEffectiveAddons)(db, db
                    .prepare('SELECT * FROM order_items WHERE order_id = ?')
                    .all(req.params.id)
                    .map(db_1.parseItemJson));
                const tableRow = currentOrder.table_id
                    ? db.prepare('SELECT * FROM tables WHERE id = ?').get(currentOrder.table_id)
                    : null;
                const tableObj = tableRow ? { ...tableRow, name: tableRow.number } : null;
                return {
                    updatedOrder: (0, db_1.parseRowJson)(currentOrder),
                    orderItems: items,
                    table: tableObj,
                    changed: false,
                };
            }
            const VALID_TRANSITIONS = {
                pending: ['preparing', 'ready', 'served', 'completed', 'cancelled'],
                preparing: ['ready', 'served', 'completed', 'cancelled'],
                ready: ['served', 'completed', 'cancelled'],
                served: ['completed', 'cancelled'],
                completed: [],
                cancelled: [],
            };
            const allowedTargets = VALID_TRANSITIONS[currentOrder.status] || [];
            if (!allowedTargets.includes(status)) {
                throw Object.assign(new Error(`Cannot transition order status from '${currentOrder.status}' to '${status}'`), { statusCode: 400 });
            }
            if ((0, scheduled_orders_1.isUnreleasedOrderRow)(currentOrder) && status !== 'cancelled') {
                throw Object.assign(new Error('Scheduled order must be released to the kitchen before updating kitchen status.'), { statusCode: 409, code: 'ORDER_NOT_RELEASED' });
            }
            // Evaluate item progress, kitchen delivery policy, and bill/payment state
            // inside the authoritative transaction.
            const hasItemsInProgress = db
                .prepare(`
        SELECT 1 FROM order_items
        WHERE order_id = ? AND status IN ('preparing', 'ready', 'served', 'completed')
        LIMIT 1
      `)
                .get(req.params.id) !== undefined;
            const statusOrder = ['pending', 'preparing', 'ready', 'served', 'completed'];
            const currentStatusIndex = statusOrder.indexOf(currentOrder.status);
            const { minorFactor, roundCurrency, evaluatedBills, orderTotalMinor, payableBills, totalOutstandingMinor, totalCollectedMinor, paymentBlocksCompletion: rawPaymentBlocksCompletion, } = evaluateOrderStatusPaymentBlock(db, req.params.id, currentOrder.total, currentOrder.round_off);
            const paymentBlocksCompletion = status === 'completed' && rawPaymentBlocksCompletion;
            const requireKitchenDelivered = db
                .prepare("SELECT value FROM settings WHERE key = 'require_kitchen_delivered_before_settlement'")
                .get();
            const kdsEnabled = db
                .prepare("SELECT value FROM settings WHERE key = 'kds_enabled'")
                .get();
            const billingType = db
                .prepare("SELECT value FROM settings WHERE key = 'billing_type'")
                .get();
            const kitchenPolicyApplies = requireKitchenDelivered?.value === 'true' &&
                kdsEnabled?.value !== 'false' &&
                billingType?.value !== 'prepaid';
            const undeliveredKitchenItems = status === 'completed' && kitchenPolicyApplies
                ? db
                    .prepare(`
                  SELECT product_name FROM order_items
                  WHERE order_id = ? AND status IN ('pending', 'preparing', 'ready')
                `)
                    .all(req.params.id)
                : [];
            const kitchenBlocksCompletion = status === 'completed' && undeliveredKitchenItems.length > 0;
            const orderInProgressForCancel = currentStatusIndex > 0 || hasItemsInProgress;
            const hasCollectedFundsOnOrder = evaluatedBills.some((b) => b.hasCollectedFunds);
            if (status === 'cancelled' &&
                (0, scheduled_orders_1.isScheduledOrderRow)(currentOrder) &&
                hasCollectedFundsOnOrder) {
                throw Object.assign(new Error('Collected payment must be fully refunded before cancelling a scheduled order.'), { statusCode: 409, code: 'REFUND_REQUIRED_BEFORE_CANCEL' });
            }
            const requiresCancelOverride = status === 'cancelled' && (orderInProgressForCancel || hasCollectedFundsOnOrder);
            const requiresCompleteOverride = status === 'completed' && (paymentBlocksCompletion || kitchenBlocksCompletion);
            const requiresOverride = requiresCancelOverride || requiresCompleteOverride;
            const overriddenSafeguards = [];
            if (status === 'completed') {
                if (paymentBlocksCompletion)
                    overriddenSafeguards.push('unsettled_payment');
                if (kitchenBlocksCompletion)
                    overriddenSafeguards.push('kitchen_undelivered');
            }
            else if (status === 'cancelled') {
                if (orderInProgressForCancel)
                    overriddenSafeguards.push('order_in_progress');
                if (hasCollectedFundsOnOrder)
                    overriddenSafeguards.push('collected_funds');
            }
            let approvedByUserId;
            if (requiresOverride) {
                if (!override_pin || typeof override_pin !== 'string') {
                    let missingPinMessage = 'Manager PIN required to cancel order in progress';
                    if (status === 'cancelled' && hasCollectedFundsOnOrder && !orderInProgressForCancel) {
                        missingPinMessage = 'Manager PIN required to cancel order with collected payment';
                    }
                    else if (status === 'completed') {
                        if (paymentBlocksCompletion && kitchenBlocksCompletion) {
                            missingPinMessage =
                                'Manager PIN required to complete unpaid order with undelivered kitchen items';
                        }
                        else if (paymentBlocksCompletion) {
                            missingPinMessage = 'Manager PIN required to complete unpaid order';
                        }
                        else {
                            missingPinMessage =
                                'Manager PIN required to complete order with undelivered kitchen items';
                        }
                    }
                    throw Object.assign(new Error(missingPinMessage), { statusCode: 400 });
                }
                const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
                const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
                const rateLimitKey = status === 'cancelled'
                    ? `pin:${canonicalIp}:order-cancel`
                    : `pin:${canonicalIp}:order-complete`;
                if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                    throw Object.assign(new Error('Too many PIN attempts. Try again in 15 minutes.'), {
                        statusCode: 429,
                    });
                }
                const explicitApproverId = req.body.approver_id || req.body.manager_id || req.body.user_id;
                let user;
                if (preVerifiedStatusApprover) {
                    const candidate = db
                        .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager')")
                        .get(preVerifiedStatusApprover.id);
                    if (candidate &&
                        candidate.is_active === 1 &&
                        candidate.pin_hash === preVerifiedStatusApprover.verifiedPinHash &&
                        (0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                        (0, authorization_1.hasPermission)(candidate.id, 'orders.status.update') &&
                        (status !== 'cancelled' || (0, authorization_1.hasPermission)(candidate.id, 'orders.item.cancel')) &&
                        (!paymentBlocksCompletion || (0, authorization_1.hasPermission)(candidate.id, 'payments.take')) &&
                        (!explicitApproverId || candidate.id === explicitApproverId)) {
                        user = { id: candidate.id, role: candidate.role, pin_hash: candidate.pin_hash };
                    }
                }
                if (!user) {
                    (0, security_1.checkPinRateLimit)(rateLimitKey);
                    throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
                }
                (0, security_1.clearPinRateLimit)(rateLimitKey);
                approvedByUserId = user.id;
            }
            switch (status) {
                case 'preparing':
                    db.prepare('UPDATE orders SET status = ?, cooking_started_at = ?, updated_at = ? WHERE id = ?').run(status, nowStr, nowStr, req.params.id);
                    break;
                case 'ready':
                    db.prepare('UPDATE orders SET status = ?, ready_at = ?, updated_at = ? WHERE id = ?').run(status, nowStr, nowStr, req.params.id);
                    break;
                case 'served':
                    db.prepare('UPDATE orders SET status = ?, served_at = ?, updated_at = ? WHERE id = ?').run(status, nowStr, nowStr, req.params.id);
                    break;
                case 'completed':
                    db.prepare('UPDATE orders SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(status, nowStr, nowStr, req.params.id);
                    db.prepare(`
            UPDATE order_items SET status = 'served', updated_at = ?
            WHERE order_id = ? AND status IN ('pending', 'preparing', 'ready')
          `).run(nowStr, req.params.id);
                    if (currentOrder.table_id) {
                        db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?").run(nowStr, currentOrder.table_id);
                    }
                    break;
                case 'cancelled': {
                    // Never restore stock on unreleased scheduled orders since stock was never deducted.
                    // checkout_v1 rows have not been depleted at order creation or
                    // kitchen release.  Cancelling them before settlement must only
                    // change their order state; restoring here would manufacture
                    // stock and break the checkout-time lifecycle.
                    const eligibleItems = (0, scheduled_orders_1.isUnreleasedOrderRow)(currentOrder) || currentOrder.inventory_lifecycle === 'checkout_v1'
                        ? []
                        : db
                            .prepare(`
            SELECT * FROM order_items
            WHERE order_id = ? AND status = 'pending'
          `)
                            .all(req.params.id);
                    for (const item of eligibleItems) {
                        const inventoryTarget = item.inventory_deducted_quantity > 0 ? orderItemInventoryTarget(db, item) : null;
                        if (inventoryTarget) {
                            (0, inventory_1.adjustProductStock)(db, {
                                productId: inventoryTarget.productId,
                                variantId: inventoryTarget.variantId,
                                quantityDelta: item.inventory_deducted_quantity,
                                movementType: 'cancel_restore',
                                referenceType: 'order_item',
                                referenceId: `${item.id}:${item.updated_at}`,
                                reason: reason || 'Order cancelled',
                                actorUserId: authUser.userId,
                            });
                        }
                        moveOrderItemAddonStock(db, orderItemAddonStockLines(db, item.id), {
                            direction: 'restore',
                            actorUserId: authUser.userId,
                            referenceId: `${item.id}:${item.updated_at}`,
                            reason: reason || 'Order cancelled',
                        });
                        const recipeSnapshot = (0, recipes_1.parseRecipeSnapshot)(item.recipe_snapshot);
                        if (recipeSnapshot) {
                            (0, recipes_1.applyRecipeSnapshot)(db, recipeSnapshot, {
                                direction: 'restore',
                                actorUserId: authUser.userId,
                                referenceId: `${item.id}:${item.updated_at}`,
                            });
                        }
                    }
                    db.prepare(`
            UPDATE order_items SET status = 'cancelled', updated_at = ?
            WHERE order_id = ? AND status NOT IN ('cancelled', 'voided', 'void_adjustment', 'refunded')
          `).run(nowStr, req.params.id);
                    db.prepare('UPDATE orders SET status = ?, cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?').run(status, nowStr, reason, nowStr, req.params.id);
                    // Only free table if explicitly requested (default: true for backward compatibility)
                    if (currentOrder.table_id && free_table !== false) {
                        db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?").run(nowStr, currentOrder.table_id);
                    }
                    break;
                }
            }
            (0, db_1.recordOrderAudit)(db, {
                orderId: req.params.id,
                actorUserId: authUser.userId,
                action: 'status_changed',
                details: {
                    from: currentOrder.status,
                    to: status,
                    ...(approvedByUserId && {
                        actor_user_id: authUser.userId,
                        approved_by: approvedByUserId,
                        overridden_safeguards: overriddenSafeguards,
                        bill_ids: evaluatedBills.map((b) => b.id),
                        outstanding_amount: roundCurrency(totalOutstandingMinor / minorFactor),
                        outstanding_amounts: evaluatedBills.map((b) => ({
                            bill_id: b.id,
                            outstanding_amount: roundCurrency(b.unpaidBalanceMinor / minorFactor),
                            collected_amount: roundCurrency(b.effectiveCollectedMinor / minorFactor),
                        })),
                        collected_amount: roundCurrency(totalCollectedMinor / minorFactor),
                        ...(kitchenBlocksCompletion
                            ? { undelivered_items: undeliveredKitchenItems.map((i) => i.product_name) }
                            : {}),
                    }),
                    ...(status === 'cancelled' && reason ? { reason } : {}),
                },
            });
            const updatedOrder = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id));
            const orderItems = (0, db_1.attachEffectiveAddons)(db, db
                .prepare('SELECT * FROM order_items WHERE order_id = ?')
                .all(req.params.id)
                .map(db_1.parseItemJson));
            const tableRow2 = updatedOrder.table_id
                ? db.prepare('SELECT * FROM tables WHERE id = ?').get(updatedOrder.table_id)
                : null;
            const table = tableRow2 ? { ...tableRow2, name: tableRow2.number } : null;
            return { updatedOrder, orderItems, table, changed: true };
        });
        if (changed) {
            cloud_sync_1.cloudSync.recordOrderChanged(req.params.id, `order.${status}`);
            if ((0, scheduled_orders_1.isUnreleasedOrderRow)(updatedOrder)) {
                (0, kds_1.notifyOrderUpdated)();
            }
            else {
                (0, kds_1.notifyKdsUpdate)();
            }
        }
        res.json({ order: Object.assign({}, updatedOrder, { items: orderItems, table }) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Internal server error',
            ...(error.code ? { code: error.code } : {}),
        });
    }
}));
router.patch('/:id/customer', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.customer.update'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const { customer_id } = req.body;
        // Validate customer exists if providing one
        if (customer_id) {
            const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
            if (!customer) {
                return res.status(404).json({ error: 'Customer not found' });
            }
        }
        const nowStr = (0, db_1.now)();
        const actorId = String(req.user?.userId || '');
        const updatedOrder = (0, db_1.withTxn)(() => {
            const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
            if (!currentOrder) {
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error('Cannot update customer on a completed or cancelled order'), { statusCode: 400 });
            }
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, req.params.id, currentOrder);
            const blockingBill = db
                .prepare(`SELECT id FROM bills
             WHERE order_id = ?
               AND (
                 split_group_id IS NOT NULL
                 OR payment_status IN ('paid', 'partial', 'partially_paid', 'partially_refunded', 'refunded')
                 OR COALESCE(paid_amount, 0) > 0
               )
             LIMIT 1`)
                .get(req.params.id);
            if (blockingBill) {
                throw Object.assign(new Error('Cannot change customer once a bill has payments, a split, or a refund'), { statusCode: 409 });
            }
            const oldCustomer = currentOrder.customer_id
                ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(currentOrder.customer_id) ?? null)
                : null;
            const customer = customer_id
                ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id) ?? null)
                : null;
            if (customer_id && !customer) {
                throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
            }
            const tenantInfo = {
                country: (0, db_1.getSettingValue)('country') || '',
                business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
                state_code: (0, db_1.getSettingValue)('state_code') || '',
                currency: (0, bills_1.getTenantCurrency)(),
                taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
            };
            if (tenantInfo.taxes_enabled) {
                const oldRegNum = oldCustomer?.taxRegistrationNumber || oldCustomer?.tax_registration_number;
                const oldCustomerState = oldCustomer?.customer_state_code ?? undefined;
                const oldIsB2B = Boolean(oldRegNum && oldCustomerState);
                const newRegNum = customer?.taxRegistrationNumber || customer?.tax_registration_number;
                const newCustomerState = customer?.customer_state_code ?? undefined;
                const newIsB2B = Boolean(newRegNum && newCustomerState);
                const customerTaxContextUnchanged = oldIsB2B === newIsB2B && (oldCustomerState ?? null) === (newCustomerState ?? null);
                const itemRows = db
                    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC')
                    .all(req.params.id);
                const activeItemRows = itemRows.filter((item) => item.status === null ||
                    item.status === undefined ||
                    !(0, order_item_status_1.isTerminalItemStatus)(item.status));
                const allActiveItemsHaveValidTaxSnapshot = activeItemRows.length > 0 &&
                    activeItemRows.every((item) => {
                        if (!item.tax_snapshot)
                            return false;
                        try {
                            const parsed = typeof item.tax_snapshot === 'string'
                                ? JSON.parse(item.tax_snapshot)
                                : item.tax_snapshot;
                            return Boolean(parsed &&
                                typeof parsed === 'object' &&
                                Array.isArray(parsed.lines) &&
                                parsed.lines[0]?.categoryId);
                        }
                        catch {
                            return false;
                        }
                    });
                if (!(customerTaxContextUnchanged && allActiveItemsHaveValidTaxSnapshot)) {
                    const updateItemTax = db.prepare(`UPDATE order_items
               SET tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, tax_type = ?, total = ?, updated_at = ?
               WHERE id = ?`);
                    for (const item of activeItemRows) {
                        if (!item.tax_snapshot)
                            continue;
                        let savedSnapshot = null;
                        try {
                            savedSnapshot =
                                typeof item.tax_snapshot === 'string'
                                    ? JSON.parse(item.tax_snapshot)
                                    : item.tax_snapshot;
                        }
                        catch {
                            continue;
                        }
                        const savedLine = Array.isArray(savedSnapshot?.lines) ? savedSnapshot.lines[0] : null;
                        const itemPack = (0, tax_1.getCountryPackByVersion)(savedSnapshot?.packId, savedSnapshot?.packVersion, tenantInfo.country);
                        if (!savedLine?.categoryId ||
                            !itemPack ||
                            (savedSnapshot?.packId && itemPack.id !== savedSnapshot.packId) ||
                            !itemPack.categories.some((cat) => cat.id === savedLine.categoryId)) {
                            continue;
                        }
                        const effectiveProduct = {
                            tax_type: 'exclusive',
                            tax_rate: 0,
                            tax_category_id: savedLine.categoryId,
                            tax_category: savedLine.categoryId,
                            tax_behavior: savedLine.taxBehavior || 'country_default',
                        };
                        const itemSubtotal = Number(item.subtotal || 0);
                        const taxResult = (0, tax_1.calculateItemTax)(tenantInfo, effectiveProduct, itemSubtotal, customer, itemPack);
                        if (taxResult.tax_snapshot &&
                            Array.isArray(taxResult.tax_snapshot.lines) &&
                            taxResult.tax_snapshot.lines[0]) {
                            if (savedLine.categorySource) {
                                taxResult.tax_snapshot.lines[0].categorySource = savedLine.categorySource;
                            }
                            if (Array.isArray(savedSnapshot?.merchantOverridesApplied)) {
                                taxResult.tax_snapshot.merchantOverridesApplied =
                                    savedSnapshot.merchantOverridesApplied;
                            }
                        }
                        const itemTotal = itemSubtotal + (taxResult.tax_type === 'inclusive' ? 0 : taxResult.tax_amount);
                        const itemTaxSnapshotJson = taxResult.tax_snapshot
                            ? JSON.stringify(taxResult.tax_snapshot)
                            : null;
                        updateItemTax.run(taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown), itemTaxSnapshotJson, taxResult.tax_type, itemTotal, nowStr, item.id);
                    }
                }
            }
            const totals = (0, orders_1.calculateOrderTotals)(db, req.params.id);
            const decimals = (0, countries_1.getCurrencyFractionDigits)(tenantInfo.currency);
            const discountAmount = resolveOrderLevelDiscountAmount(currentOrder, totals.subtotal, decimals);
            const engineCharges = resolveEngineCharges(currentOrder, totals.subtotal, discountAmount);
            const { taxRollup, total, roundOff } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: currentOrder,
                customer,
                totals,
                discountAmount,
                taxScaling: 'when-discounted',
                appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
                chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
            });
            const syncedServiceCharge = engineCharges
                ? engineCharges.columns.service_charge
                : Number(currentOrder.service_charge || 0);
            const syncedPackagingCharge = engineCharges
                ? engineCharges.columns.packaging_charge
                : Number(currentOrder.packaging_charge || 0);
            const syncedChargesJson = engineCharges
                ? engineCharges.chargesJson
                : (currentOrder.charges_breakdown ?? null);
            db.prepare(`UPDATE orders
           SET customer_id = ?, subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?,
               discount_amount = ?, service_charge = ?, packaging_charge = ?, charges_breakdown = ?,
               total = ?, round_off = ?, updated_at = ?
           WHERE id = ?`).run(customer_id || null, totals.subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, discountAmount, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, total, roundOff, nowStr, req.params.id);
            // Keep every unpaid guest check attached to the same customer.
            db.prepare("UPDATE bills SET customer_id = ?, updated_at = ? WHERE order_id = ? AND payment_status IN ('unpaid', 'partial', 'partially_paid')").run(customer_id || null, nowStr, req.params.id);
            (0, bills_1.syncUnpaidBillsForOrder)(db, req.params.id, {
                subtotal: totals.subtotal,
                taxAmount: taxRollup.taxAmount,
                taxBreakdown: JSON.stringify(taxRollup.breakdowns),
                taxSnapshot: taxRollup.snapshotJson,
                discountAmount,
                deliveryCharge: Number(currentOrder.delivery_charge || 0),
                packagingCharge: syncedPackagingCharge,
                serviceCharge: syncedServiceCharge,
                chargesBreakdown: syncedChargesJson,
                total,
            }, tenantInfo.country);
            if (actorId) {
                (0, db_1.recordOrderAudit)(db, {
                    orderId: req.params.id,
                    actorUserId: actorId,
                    action: 'customer_updated',
                    details: {
                        previous_customer_id: currentOrder.customer_id || null,
                        customer_id: customer_id || null,
                    },
                });
            }
            return (0, db_1.parseRowJson)(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id));
        });
        const customer = updatedOrder.customer_id
            ? db.prepare('SELECT * FROM customers WHERE id = ?').get(updatedOrder.customer_id)
            : null;
        cloud_sync_1.cloudSync.recordOrderChanged(req.params.id, 'order.updated');
        (0, kds_1.notifyOrderUpdated)();
        res.json({ order: { ...updatedOrder, customer } });
    }
    catch (error) {
        const err = error;
        console.error('[API] Internal error:', err);
        res.status(err.statusCode || 500).json({
            error: err.statusCode ? err.message : 'Internal server error',
            ...(err.code ? { code: err.code } : {}),
        });
    }
});
router.patch('/:id/convert-to-takeaway', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.create'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const nowStr = (0, db_1.now)();
        const actorId = String(req.user?.userId || '');
        (0, db_1.withTxn)(() => {
            const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
            if (!order) {
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            }
            if (order.type !== 'dine_in') {
                throw Object.assign(new Error('Only dine-in orders can be converted to takeaway'), {
                    statusCode: 400,
                });
            }
            if (['completed', 'cancelled'].includes(order.status)) {
                throw Object.assign(new Error('Cannot convert a completed or cancelled order'), {
                    statusCode: 400,
                });
            }
            const bills = db
                .prepare('SELECT * FROM bills WHERE order_id = ? ORDER BY id')
                .all(req.params.id);
            if (bills.some((bill) => bill.split_group_id !== null && bill.split_group_id !== undefined)) {
                throw Object.assign(new Error('A split dine-in check cannot be converted to takeaway'), {
                    statusCode: 409,
                });
            }
            if (bills.some((bill) => ['paid', 'partially_refunded', 'refunded'].includes(bill.payment_status))) {
                throw Object.assign(new Error('Cannot convert an order with a paid or refunded bill'), {
                    statusCode: 409,
                });
            }
            // Charges are defined per order type, so converting re-resolves them
            // against 'takeaway'. The dine-in breakdown is deliberately not carried
            // forward: its waivers belong to a charge set the takeaway order no longer
            // uses, and a takeaway order that configures no charge must end at zero
            // rather than keep the dine-in fee.
            const totals = (0, orders_1.calculateOrderTotals)(db, req.params.id);
            const discountAmount = Number(order.discount_amount || 0);
            const engineCharges = resolveEngineCharges({ ...order, type: 'takeaway', charges_breakdown: null }, totals.subtotal, discountAmount);
            const syncedServiceCharge = engineCharges ? engineCharges.columns.service_charge : 0;
            const syncedPackagingCharge = engineCharges ? engineCharges.columns.packaging_charge : 0;
            const syncedChargesJson = engineCharges ? engineCharges.chargesJson : '[]';
            const tenantInfo = {
                country: (0, db_1.getSettingValue)('country') || '',
                business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
                state_code: (0, db_1.getSettingValue)('state_code') || '',
                currency: (0, bills_1.getTenantCurrency)(),
                taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
            };
            const customer = order.customer_id
                ? db
                    .prepare('SELECT * FROM customers WHERE id = ?')
                    .get(order.customer_id)
                : null;
            // The order type changed, so tax, rounding and the payable total are all
            // stale until they are recomputed from the item data.
            const { taxRollup, total, roundOff } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: {
                    ...order,
                    service_charge: syncedServiceCharge,
                    packaging_charge: syncedPackagingCharge,
                },
                customer,
                totals,
                discountAmount,
                taxScaling: 'when-discounted',
                appliedCharges: engineCharges ? engineCharges.appliedCharges : [],
                chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
            });
            const { total: roundedOrderTotal } = (0, tax_engine_1.applyPayableRounding)(total, (0, tax_1.getActiveCountryPack)(tenantInfo.country), tenantInfo.currency);
            const collected = bills.reduce((sum, bill) => sum + Number(bill.paid_amount || 0), 0);
            if (roundedOrderTotal < collected) {
                throw Object.assign(new Error('Cannot convert order below already collected payment amount'), { statusCode: 409, diagnosticCode: 'below_collected_funds' });
            }
            db.prepare(`
        UPDATE orders SET type = 'takeaway', table_id = NULL, subtotal = ?, tax_amount = ?, tax_breakdown = ?,
          tax_snapshot = ?, service_charge = ?, packaging_charge = ?, charges_breakdown = ?,
          total = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(totals.subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, total, roundOff, nowStr, req.params.id);
            (0, bills_1.syncUnpaidBillsForOrder)(db, req.params.id, {
                subtotal: totals.subtotal,
                taxAmount: taxRollup.taxAmount,
                taxBreakdown: JSON.stringify(taxRollup.breakdowns),
                taxSnapshot: taxRollup.snapshotJson,
                discountAmount,
                deliveryCharge: Number(order.delivery_charge || 0),
                packagingCharge: syncedPackagingCharge,
                serviceCharge: syncedServiceCharge,
                chargesBreakdown: syncedChargesJson,
                total,
            }, tenantInfo.country);
            if (actorId) {
                (0, db_1.recordOrderAudit)(db, {
                    orderId: req.params.id,
                    actorUserId: actorId,
                    action: 'converted_to_takeaway',
                    details: {
                        from_type: order.type,
                        to_type: 'takeaway',
                        ...(order.table_id ? { previous_table_id: order.table_id } : {}),
                    },
                });
            }
            if (order.table_id) {
                db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?").run(nowStr, order.table_id);
            }
            return order.table_id;
        });
        const updatedOrder = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id));
        const orderItems = (0, db_1.attachEffectiveAddons)(db, db
            .prepare('SELECT * FROM order_items WHERE order_id = ?')
            .all(req.params.id)
            .map(db_1.parseItemJson));
        cloud_sync_1.cloudSync.recordOrderChanged(req.params.id, 'order.type_changed');
        (0, kds_1.notifyKdsUpdate)();
        res.json({ order: Object.assign({}, updatedOrder, { items: orderItems, table: null }) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Internal server error',
            ...(error.diagnosticCode
                ? { code: error.diagnosticCode, display_code: error.diagnosticCode }
                : {}),
        });
    }
});
const handleOrderDiscount = (0, async_handler_1.asyncHandler)(async (req, res) => {
    let operationCommitted = false;
    try {
        const db = (0, db_1.getDatabase)();
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        try {
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, req.params.id, order);
        }
        catch (err) {
            const typedErr = err;
            return res.status(typedErr.statusCode || 409).json({
                ...structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', typedErr.message || 'Scheduled order edit locked after payment', 'paid'),
                code: 'SCHEDULED_ORDER_PAID',
            });
        }
        if (db
            .prepare('SELECT 1 FROM bills WHERE order_id = ? AND split_group_id IS NOT NULL LIMIT 1')
            .get(req.params.id)) {
            return res
                .status(409)
                .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', 'Discounts cannot be changed after a check has been split', 'split_check'));
        }
        // Cannot apply discount to completed or cancelled orders
        if (['completed', 'cancelled'].includes(order.status)) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', 'Cannot apply discount to a completed or cancelled order', 'order_not_discountable'));
        }
        const { promotion_id, discount_type, discount_value, discount_reason, override_pin, approver_id, user_id, manager_id, } = req.body || {};
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        if (promotion_id) {
            try {
                const actorUserId = req.user?.userId || 'system';
                const promoResult = (0, db_1.withTxn)(() => {
                    return (0, promotions_1.applyPromotionToOrder)(db, String(req.params.id), promotion_id, actorUserId, clientIp);
                });
                return res.json({
                    success: true,
                    order: promoResult.order,
                    bill: promoResult.bill,
                    calculation: promoResult.calculation,
                });
            }
            catch (err) {
                const typedErr = err;
                return res.status(typedErr.statusCode || 400).json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', typedErr.message || 'Failed to apply promotion', typedErr.diagnosticCode || 'invalid_value'));
            }
        }
        // Validate discount_type
        if (discount_value !== 0 &&
            (!discount_type || !['percentage', 'amount'].includes(discount_type))) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', 'discount_type must be "percentage" or "amount"', 'invalid_type'));
        }
        // Validate discount_value is a non-negative finite number
        if (discount_value === undefined ||
            discount_value === null ||
            typeof discount_value !== 'number' ||
            discount_value < 0 ||
            !Number.isFinite(discount_value)) {
            return res
                .status(400)
                .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', 'discount_value must be a non-negative number', 'invalid_value'));
        }
        // Check if approval is required
        const suppliedApproverIds = [approver_id, manager_id, user_id]
            .filter((val) => val !== undefined && val !== null && String(val).trim() !== '')
            .map((val) => String(val).trim());
        if (new Set(suppliedApproverIds).size > 1) {
            return res.status(400).json({ error: 'Conflicting approver identifiers' });
        }
        const explicitApproverId = suppliedApproverIds[0];
        let approvedByUserId;
        let preVerifiedOrderDiscountPinHash;
        if (discount_value > 0) {
            const requiresApproval = (0, db_1.getSettingValue)('discount_requires_approval') === 'true';
            if (requiresApproval) {
                if (!override_pin) {
                    return res
                        .status(403)
                        .json({ error: 'Manager PIN required for discounts', requiresApproval: true });
                }
                const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
                const rateLimitKey = `pin:${canonicalIp}:discount`;
                if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                    return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
                }
                if (typeof override_pin !== 'string' || !/^\d{4,6}$/.test(override_pin)) {
                    (0, security_1.checkPinRateLimit)(rateLimitKey);
                    return res.status(403).json({ error: 'Invalid manager PIN' });
                }
                const candidateUsers = explicitApproverId
                    ? db
                        .prepare("SELECT id, role, pin_hash FROM users WHERE id = ? AND is_active = 1 AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL")
                        .all(explicitApproverId)
                    : db
                        .prepare("SELECT id, role, pin_hash FROM users WHERE is_active = 1 AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL")
                        .all();
                const verifiedResult = await (0, security_1.withPinVerificationLock)(rateLimitKey, async () => {
                    if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                        return { rateLimited: true };
                    }
                    let user;
                    for (const candidate of candidateUsers) {
                        if ((0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                            (0, authorization_1.hasPermission)(candidate.id, 'orders.discount.apply') &&
                            (await (0, db_1.verifyPinAsync)(candidate.pin_hash, override_pin))) {
                            user = candidate;
                            break;
                        }
                    }
                    if (!user) {
                        (0, security_1.checkPinRateLimit)(rateLimitKey);
                        return { user: null };
                    }
                    (0, security_1.clearPinRateLimit)(rateLimitKey);
                    return { user };
                });
                if (verifiedResult.rateLimited) {
                    return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
                }
                if (!verifiedResult.user) {
                    return res.status(403).json({ error: 'Invalid manager PIN' });
                }
                approvedByUserId = verifiedResult.user.id;
                preVerifiedOrderDiscountPinHash = verifiedResult.user.pin_hash;
            }
        }
        let preVerifiedKitchenManager = null;
        if (approvedByUserId && preVerifiedOrderDiscountPinHash) {
            preVerifiedKitchenManager = {
                id: approvedByUserId,
                verifiedPinHash: preVerifiedOrderDiscountPinHash,
            };
        }
        else if (override_pin) {
            const existingBill = db
                .prepare('SELECT id FROM bills WHERE order_id = ? AND payment_status != ?')
                .get(req.params.id, 'paid');
            const initialKitchenStatus = (0, bills_1.checkKitchenDeliveryStatus)(db, String(req.params.id), undefined, clientIp, existingBill?.id);
            if (!initialKitchenStatus.allowed) {
                preVerifiedKitchenManager = await (0, bills_1.preVerifyKitchenDeliveryPin)(db, override_pin, clientIp, explicitApproverId);
            }
        }
        // Check discount mode
        if (discount_value > 0) {
            const discountMode = (0, db_1.getSettingValue)('discount_mode') || 'percentage';
            if (discountMode === 'none') {
                return res
                    .status(400)
                    .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', 'Discounts are disabled', 'disabled'));
            }
            if (discountMode === 'flat' && discount_type === 'percentage') {
                return res
                    .status(400)
                    .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', 'Percentage discounts are disabled', 'type_disabled'));
            }
            if (discountMode === 'percentage' && discount_type === 'amount') {
                return res
                    .status(400)
                    .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', 'Flat amount discounts are disabled', 'type_disabled'));
            }
        }
        // Check against limits from settings (0 = no limit)
        if (discount_value > 0) {
            if (discount_type === 'percentage') {
                const maxPercentage = parseFloat((0, db_1.getSettingValue)('discount_max_percentage') || '25');
                if (maxPercentage > 0 && discount_value > maxPercentage) {
                    return res
                        .status(400)
                        .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', `discount_value exceeds maximum percentage of ${maxPercentage}`, 'limit_exceeded'));
                }
            }
            else if (discount_type === 'amount') {
                const maxAmount = parseFloat((0, db_1.getSettingValue)('discount_max_amount') || '0');
                if (maxAmount > 0 && discount_value > maxAmount) {
                    return res
                        .status(400)
                        .json(structuredOperationFailure(req, 'fc.backend.order.discount.validation', 'not_applied', `discount_value exceeds maximum amount of ${maxAmount}`, 'limit_exceeded'));
                }
            }
        }
        const tenantInfo = {
            country: (0, db_1.getSettingValue)('country') || '',
            business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
            state_code: (0, db_1.getSettingValue)('state_code') || '',
            currency: (0, bills_1.getTenantCurrency)(),
            taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
        };
        // Wrap discount, tax recalculation, and bill sync in transaction.
        const result = (0, db_1.withTxn)(() => {
            if (approvedByUserId && preVerifiedOrderDiscountPinHash) {
                const approver = db
                    .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager')")
                    .get(approvedByUserId);
                if (!approver ||
                    approver.is_active !== 1 ||
                    !(0, role_permissions_1.hasRole)(approver.role, role_permissions_1.ROLE_ACCESS.ownerManager) ||
                    !(0, authorization_1.hasPermission)(approver.id, 'orders.discount.apply') ||
                    approver.pin_hash !== preVerifiedOrderDiscountPinHash) {
                    throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
                }
            }
            // Re-fetch and re-validate under transaction lock to prevent races with concurrent edits.
            const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
            if (!currentOrder) {
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            }
            try {
                (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, req.params.id, currentOrder);
            }
            catch (err) {
                const typedErr = err;
                throw Object.assign(new Error(typedErr.message || 'Scheduled order edit locked after payment'), {
                    statusCode: typedErr.statusCode || 409,
                    diagnosticCode: 'paid',
                    code: 'SCHEDULED_ORDER_PAID',
                });
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error('Cannot apply discount to a completed or cancelled order'), {
                    statusCode: 400,
                    diagnosticCode: 'order_not_discountable',
                });
            }
            const splitBill = db
                .prepare('SELECT 1 FROM bills WHERE order_id = ? AND split_group_id IS NOT NULL LIMIT 1')
                .get(req.params.id);
            if (splitBill) {
                throw Object.assign(new Error('Discounts cannot be changed after a check has been split'), {
                    statusCode: 409,
                    diagnosticCode: 'split_check',
                });
            }
            const refundedBill = db
                .prepare(`SELECT 1 FROM bills WHERE order_id = ? AND payment_status IN ('refunded', 'partially_refunded') LIMIT 1`)
                .get(req.params.id);
            if (refundedBill) {
                throw Object.assign(new Error('Cannot apply discount to a refunded bill'), {
                    statusCode: 409,
                    diagnosticCode: 'refunded',
                });
            }
            const customer = currentOrder.customer_id
                ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(currentOrder.customer_id) ?? null)
                : null;
            const currency = (0, bills_1.getTenantCurrency)();
            const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
            // Recalculate tax from item-level data to avoid compounding on repeated discount edits.
            // The fresh item sum is the only basis: it describes exactly the items the
            // tax is summed over, and the write below heals the stored column to match.
            const totals = (0, orders_1.calculateOrderTotals)(db, req.params.id);
            // Calculate discount amount
            let discountAmount = 0;
            if (discount_value > 0) {
                if (discount_type === 'percentage') {
                    discountAmount = (totals.subtotal * discount_value) / 100;
                }
                else {
                    discountAmount = Math.min(discount_value, totals.subtotal);
                }
                discountAmount = Number(discountAmount.toFixed(decimals));
            }
            const engineCharges = resolveEngineCharges(currentOrder, totals.subtotal, discountAmount);
            const { taxRollup, total: newTotal, roundOff, } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: currentOrder,
                customer,
                totals,
                discountAmount,
                taxScaling: 'when-discounted',
                appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
                chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
            });
            const syncedServiceCharge = engineCharges
                ? engineCharges.columns.service_charge
                : currentOrder.service_charge || 0;
            const syncedPackagingCharge = engineCharges
                ? engineCharges.columns.packaging_charge
                : currentOrder.packaging_charge || 0;
            const syncedChargesJson = engineCharges
                ? engineCharges.chargesJson
                : (currentOrder.charges_breakdown ?? null);
            db.prepare(`
        UPDATE orders SET subtotal = ?, discount_amount = ?, discount_type = ?, discount_value = ?,
          discount_reason = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, total = ?,
          service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(totals.subtotal, discountAmount, discount_value > 0 ? discount_type : null, discount_value > 0 ? discount_value : null, discount_value > 0 ? discount_reason || null : null, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newTotal, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, (0, db_1.now)(), req.params.id);
            // Sync discount to bill if it exists and is unpaid
            const existingBill = db
                .prepare('SELECT * FROM bills WHERE order_id = ? AND payment_status != ?')
                .get(req.params.id, 'paid');
            if (existingBill) {
                const pack = (0, tax_1.getActiveCountryPack)(tenantInfo.country);
                const { total: billTotal, adjustment: billRoundOff } = (0, tax_engine_1.applyPayableRounding)(newTotal, pack, currency);
                const billPaidAmount = Number(existingBill.paid_amount || 0);
                if (billPaidAmount > 0 && billTotal < billPaidAmount) {
                    throw Object.assign(new Error('Discount cannot reduce bill total below collected payments'), { statusCode: 409, diagnosticCode: 'below_collected_funds' });
                }
                const newBillBalance = Math.max(0, billTotal - billPaidAmount);
                const kitchenStatus = (0, bills_1.checkKitchenDeliveryStatus)(db, String(req.params.id), override_pin, clientIp, existingBill.id, preVerifiedKitchenManager, explicitApproverId);
                const isBillNowPaid = billPaidAmount > 0 && newBillBalance === 0 && kitchenStatus.allowed;
                db.prepare(`
          UPDATE bills SET subtotal = ?, discount_amount = ?, discount_type = ?, discount_value = ?,
            discount_reason = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, total = ?, balance = ?,
            service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?,
            payment_status = CASE WHEN ? = 1 THEN 'paid' ELSE payment_status END,
            paid_at = CASE WHEN ? = 1 THEN COALESCE(paid_at, ?) ELSE paid_at END,
            updated_at = ?
          WHERE id = ?
        `).run(totals.subtotal, discountAmount, discount_value > 0 ? discount_type : null, discount_value > 0 ? discount_value : null, discount_value > 0 ? discount_reason || null : null, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, billTotal, newBillBalance, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, billRoundOff, isBillNowPaid ? 1 : 0, isBillNowPaid ? 1 : 0, (0, db_1.now)(), (0, db_1.now)(), existingBill.id);
                if (isBillNowPaid) {
                    (0, bills_1.completeExactBalanceSettlement)(db, existingBill.id, billTotal, currency, (0, db_1.now)(), override_pin, clientIp, preVerifiedKitchenManager, explicitApproverId);
                }
                if (kitchenStatus.overridden && isBillNowPaid) {
                    (0, db_1.recordOrderAudit)(db, {
                        orderId: req.params.id,
                        actorUserId: req.user.userId,
                        action: 'kitchen_delivery_override',
                        details: {
                            manager_user_id: kitchenStatus.managerUserId,
                            undelivered_count: kitchenStatus.count,
                        },
                    });
                }
            }
            (0, db_1.recordOrderAudit)(db, {
                orderId: req.params.id,
                actorUserId: req.user.userId,
                action: 'order_discount_applied',
                details: {
                    discount_type,
                    discount_value,
                    ...(approvedByUserId && { approved_by: approvedByUserId }),
                },
            });
            const updatedOrder = (0, db_1.parseRowJson)(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id));
            return updatedOrder;
        });
        operationCommitted = true;
        (0, kds_1.notifyOrderUpdated)();
        res.json({ order: result });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        const statusCode = error.statusCode || 500;
        const message = error.statusCode ? error.message : 'Internal server error';
        if (statusCode === 404 && !operationCommitted)
            return res.status(statusCode).json({ error: message });
        const point = operationCommitted
            ? 'fc.backend.order.discount.completion'
            : statusCode >= 500
                ? 'fc.backend.order.discount.persistence'
                : 'fc.backend.order.discount.validation';
        return res.status(statusCode).json({
            ...structuredOperationFailure(req, point, operationCommitted ? 'applied' : 'not_applied', message, operationCommitted ? undefined : error.diagnosticCode),
            ...(error.code ? { code: error.code } : {}),
        });
    }
});
router.patch('/:id/discount', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.discount.apply'), handleOrderDiscount);
router.post('/:id/discount', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.discount.apply'), handleOrderDiscount);
const handleItemDiscount = (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        try {
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, req.params.id, order);
        }
        catch (err) {
            const typedErr = err;
            return res.status(typedErr.statusCode || 409).json({
                error: typedErr.message ||
                    'Item and financial edits are locked after payment is recorded on a scheduled order.',
                code: typedErr.code || 'SCHEDULED_ORDER_PAID',
            });
        }
        if (db
            .prepare('SELECT 1 FROM bills WHERE order_id = ? AND split_group_id IS NOT NULL LIMIT 1')
            .get(req.params.id)) {
            return res
                .status(409)
                .json({ error: 'Discounts cannot be changed after a check has been split' });
        }
        const refundedBill = db
            .prepare(`SELECT 1 FROM bills WHERE order_id = ? AND payment_status IN ('refunded', 'partially_refunded') LIMIT 1`)
            .get(req.params.id);
        if (refundedBill) {
            return res.status(409).json({ error: 'Cannot apply discount to a refunded bill' });
        }
        // Cannot apply discount to completed or cancelled orders
        if (['completed', 'cancelled'].includes(order.status)) {
            return res
                .status(400)
                .json({ error: 'Cannot apply discount to a completed or cancelled order' });
        }
        const item = db
            .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
            .get(req.params.itemId, req.params.id);
        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }
        if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(item.status)) {
            return res
                .status(400)
                .json({ error: 'Cannot apply discount to a cancelled, voided, or refunded item' });
        }
        const { discount_type, discount_value, override_pin, approver_id, user_id } = req.body;
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        // Validate discount_type
        if (!discount_type || !['percentage', 'amount'].includes(discount_type)) {
            return res.status(400).json({ error: 'discount_type must be "percentage" or "amount"' });
        }
        // Validate discount_value is a positive number
        if (discount_value === undefined ||
            discount_value === null ||
            typeof discount_value !== 'number' ||
            discount_value <= 0) {
            return res.status(400).json({ error: 'discount_value must be a positive number' });
        }
        // Check if approval is required
        const suppliedApproverIds = [approver_id, req.body.manager_id, user_id]
            .filter((val) => val !== undefined && val !== null && String(val).trim() !== '')
            .map((val) => String(val).trim());
        if (new Set(suppliedApproverIds).size > 1) {
            return res.status(400).json({ error: 'Conflicting approver identifiers' });
        }
        const explicitApproverId = suppliedApproverIds[0];
        let approvedByUserId;
        let preVerifiedItemDiscountPinHash;
        const requiresApproval = (0, db_1.getSettingValue)('discount_requires_approval') === 'true';
        if (requiresApproval) {
            if (!override_pin) {
                return res
                    .status(403)
                    .json({ error: 'Manager PIN required for discounts', requiresApproval: true });
            }
            const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
            const rateLimitKey = `pin:${canonicalIp}:item-discount`;
            if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (typeof override_pin !== 'string' || !/^\d{4,6}$/.test(override_pin)) {
                (0, security_1.checkPinRateLimit)(rateLimitKey);
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            const candidateUsers = explicitApproverId
                ? db
                    .prepare("SELECT id, role, pin_hash FROM users WHERE id = ? AND is_active = 1 AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL")
                    .all(explicitApproverId)
                : db
                    .prepare("SELECT id, role, pin_hash FROM users WHERE is_active = 1 AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL")
                    .all();
            const verifiedResult = await (0, security_1.withPinVerificationLock)(rateLimitKey, async () => {
                if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                    return { rateLimited: true };
                }
                let user;
                for (const candidate of candidateUsers) {
                    if ((0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                        (0, authorization_1.hasPermission)(candidate.id, 'orders.discount.apply') &&
                        (await (0, db_1.verifyPinAsync)(candidate.pin_hash, override_pin))) {
                        user = candidate;
                        break;
                    }
                }
                if (!user) {
                    (0, security_1.checkPinRateLimit)(rateLimitKey);
                    return { user: null };
                }
                (0, security_1.clearPinRateLimit)(rateLimitKey);
                return { user };
            });
            if (verifiedResult.rateLimited) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (!verifiedResult.user) {
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            approvedByUserId = verifiedResult.user.id;
            preVerifiedItemDiscountPinHash = verifiedResult.user.pin_hash;
        }
        let preVerifiedKitchenManager = null;
        if (approvedByUserId && preVerifiedItemDiscountPinHash) {
            preVerifiedKitchenManager = {
                id: approvedByUserId,
                verifiedPinHash: preVerifiedItemDiscountPinHash,
            };
        }
        else if (override_pin) {
            const existingBill = db
                .prepare('SELECT id FROM bills WHERE order_id = ? AND payment_status != ?')
                .get(req.params.id, 'paid');
            const initialKitchenStatus = (0, bills_1.checkKitchenDeliveryStatus)(db, String(req.params.id), undefined, clientIp, existingBill?.id);
            if (!initialKitchenStatus.allowed) {
                preVerifiedKitchenManager = await (0, bills_1.preVerifyKitchenDeliveryPin)(db, override_pin, clientIp, explicitApproverId);
            }
        }
        // Check discount mode
        const discountMode = (0, db_1.getSettingValue)('discount_mode') || 'percentage';
        if (discountMode === 'none') {
            return res.status(400).json({ error: 'Discounts are disabled' });
        }
        if (discountMode === 'flat' && discount_type === 'percentage') {
            return res.status(400).json({ error: 'Percentage discounts are disabled' });
        }
        if (discountMode === 'percentage' && discount_type === 'amount') {
            return res.status(400).json({ error: 'Flat amount discounts are disabled' });
        }
        // BUG #14 FIX: Check item-level discount against max settings (0 = no limit)
        if (discount_type === 'percentage') {
            const maxPercentage = parseFloat((0, db_1.getSettingValue)('discount_max_percentage') || '25');
            if (maxPercentage > 0 && discount_value > maxPercentage) {
                return res
                    .status(400)
                    .json({ error: `discount_value exceeds maximum percentage of ${maxPercentage}` });
            }
        }
        else if (discount_type === 'amount') {
            const maxAmount = parseFloat((0, db_1.getSettingValue)('discount_max_amount') || '0');
            if (maxAmount > 0 && discount_value > maxAmount) {
                return res
                    .status(400)
                    .json({ error: `discount_value exceeds maximum amount of ${maxAmount}` });
            }
        }
        const currency = (0, bills_1.getTenantCurrency)();
        const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
        const updatedItem = (0, db_1.withTxn)(() => {
            if (approvedByUserId && preVerifiedItemDiscountPinHash) {
                const approver = db
                    .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager')")
                    .get(approvedByUserId);
                if (!approver ||
                    approver.is_active !== 1 ||
                    !(0, role_permissions_1.hasRole)(approver.role, role_permissions_1.ROLE_ACCESS.ownerManager) ||
                    !(0, authorization_1.hasPermission)(approver.id, 'orders.discount.apply') ||
                    approver.pin_hash !== preVerifiedItemDiscountPinHash) {
                    throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
                }
            }
            // Re-read current order and item under transaction lock to prevent financial state races
            const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
            if (!currentOrder) {
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            }
            try {
                (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, req.params.id, currentOrder);
            }
            catch (err) {
                const typedErr = err;
                throw Object.assign(new Error(typedErr.message || 'Scheduled order edit locked after payment'), {
                    statusCode: typedErr.statusCode || 409,
                    code: typedErr.code || 'SCHEDULED_ORDER_PAID',
                });
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error('Cannot apply discount to a completed or cancelled order'), {
                    statusCode: 400,
                });
            }
            const splitBill = db
                .prepare('SELECT 1 FROM bills WHERE order_id = ? AND split_group_id IS NOT NULL LIMIT 1')
                .get(req.params.id);
            if (splitBill) {
                throw Object.assign(new Error('Discounts cannot be changed after a check has been split'), {
                    statusCode: 409,
                });
            }
            const refundedBill = db
                .prepare(`SELECT 1 FROM bills WHERE order_id = ? AND payment_status IN ('refunded', 'partially_refunded') LIMIT 1`)
                .get(req.params.id);
            if (refundedBill) {
                throw Object.assign(new Error('Cannot apply discount to a refunded bill'), {
                    statusCode: 409,
                });
            }
            const currentItem = db
                .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
                .get(req.params.itemId, req.params.id);
            if (!currentItem) {
                throw Object.assign(new Error('Item not found'), { statusCode: 404 });
            }
            if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(currentItem.status)) {
                throw Object.assign(new Error('Cannot apply discount to a cancelled, voided, or refunded item'), { statusCode: 400 });
            }
            // Calculate item discount amount using fresh quantity and addons
            const addonRows = db
                .prepare('SELECT price, quantity FROM order_item_addons WHERE order_item_id = ?')
                .all(currentItem.id);
            const addonTotal = addonRows.reduce((sum, addon) => sum + (addon.price || 0) * (addon.quantity || 1) * currentItem.quantity, 0);
            const freshItemBaseTotal = currentItem.unit_price * currentItem.quantity + addonTotal;
            let discountAmount;
            if (discount_type === 'percentage') {
                discountAmount = (freshItemBaseTotal * discount_value) / 100;
            }
            else {
                discountAmount = Math.min(discount_value, freshItemBaseTotal);
            }
            discountAmount = Number(discountAmount.toFixed(decimals));
            // Recalculate item subtotal after discount
            const newSubtotal = Math.max(0, freshItemBaseTotal - discountAmount);
            // Recalculate tax on discounted subtotal
            const product = db
                .prepare('SELECT * FROM products WHERE id = ?')
                .get(currentItem.product_id);
            if (!product) {
                throw Object.assign(new Error('Product not found'), { statusCode: 404 });
            }
            const customer = currentOrder.customer_id
                ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(currentOrder.customer_id) ?? null)
                : null;
            const settings = db
                .prepare("SELECT key, value FROM settings WHERE key IN ('country', 'business_type', 'state_code', 'taxes_enabled')")
                .all();
            const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));
            const tenantInfo = {
                country: settingsMap.country || '',
                business_type: settingsMap.business_type || 'restaurant',
                state_code: settingsMap.state_code || '',
                currency: (0, bills_1.getTenantCurrency)(),
                taxes_enabled: settingsMap.taxes_enabled === 'true',
            };
            const taxResult = (0, tax_1.calculateItemTax)(tenantInfo, product, newSubtotal, customer);
            const newTaxAmount = taxResult.tax_amount;
            const newTaxBreakdown = taxResult.tax_breakdown;
            const newTaxSnapshotJson = taxResult.tax_snapshot
                ? JSON.stringify(taxResult.tax_snapshot)
                : null;
            const newTotal = newSubtotal + (taxResult.tax_type === 'inclusive' ? 0 : newTaxAmount);
            // Update item with recalculated tax
            db.prepare(`
        UPDATE order_items SET discount_amount = ?,
          subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, tax_type = ?,
          total = ?, updated_at = ? WHERE id = ?
      `).run(discountAmount, newSubtotal, newTaxAmount, JSON.stringify(newTaxBreakdown), newTaxSnapshotJson, taxResult.tax_type, newTotal, (0, db_1.now)(), req.params.itemId);
            // Update order totals excluding terminal items.
            const orderTotals = (0, orders_1.calculateOrderTotals)(db, req.params.id);
            // Recalculate order-level discount on new subtotal (scale percentage; clamp flat amount)
            const newOrderDiscount = resolveOrderLevelDiscountAmount(currentOrder, orderTotals.subtotal, decimals);
            // Recalculate tax on discounted subtotal
            const engineCharges = resolveEngineCharges(currentOrder, orderTotals.subtotal, newOrderDiscount);
            const { taxRollup, total: orderTotal, roundOff, } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: currentOrder,
                customer,
                totals: orderTotals,
                discountAmount: newOrderDiscount,
                taxScaling: 'when-discounted',
                appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
                chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
            });
            const syncedServiceCharge = engineCharges
                ? engineCharges.columns.service_charge
                : currentOrder.service_charge || 0;
            const syncedPackagingCharge = engineCharges
                ? engineCharges.columns.packaging_charge
                : currentOrder.packaging_charge || 0;
            const syncedChargesJson = engineCharges
                ? engineCharges.chargesJson
                : (currentOrder.charges_breakdown ?? null);
            db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?,
          service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(orderTotals.subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newOrderDiscount, orderTotal, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, (0, db_1.now)(), req.params.id);
            // BUG #15 FIX: Sync item-level discount to bill
            const existingBill = db
                .prepare("SELECT * FROM bills WHERE order_id = ? AND payment_status != 'paid'")
                .get(req.params.id);
            if (existingBill) {
                const pack = (0, tax_1.getActiveCountryPack)(tenantInfo.country);
                const { total: billTotal, adjustment: billRoundOff } = (0, tax_engine_1.applyPayableRounding)(orderTotal, pack, currency);
                const billPaidAmount = Number(existingBill.paid_amount || 0);
                if (billPaidAmount > 0 && billTotal < billPaidAmount) {
                    throw Object.assign(new Error('Discount cannot reduce bill total below collected payments'), { statusCode: 409, diagnosticCode: 'below_collected_funds' });
                }
                const newBillBalance = Math.max(0, billTotal - billPaidAmount);
                const kitchenStatus = (0, bills_1.checkKitchenDeliveryStatus)(db, String(req.params.id), override_pin, clientIp, existingBill.id, preVerifiedKitchenManager, explicitApproverId);
                const isBillNowPaid = billPaidAmount > 0 && newBillBalance === 0 && kitchenStatus.allowed;
                db.prepare(`UPDATE bills SET subtotal = ?, total = ?, balance = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?,
            payment_status = CASE WHEN ? = 1 THEN 'paid' ELSE payment_status END,
            paid_at = CASE WHEN ? = 1 THEN COALESCE(paid_at, ?) ELSE paid_at END,
            updated_at = ? WHERE id = ?`).run(orderTotals.subtotal, billTotal, newBillBalance, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newOrderDiscount, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, billRoundOff, isBillNowPaid ? 1 : 0, isBillNowPaid ? 1 : 0, (0, db_1.now)(), (0, db_1.now)(), existingBill.id);
                if (isBillNowPaid) {
                    (0, bills_1.completeExactBalanceSettlement)(db, existingBill.id, billTotal, currency, (0, db_1.now)(), override_pin, clientIp, preVerifiedKitchenManager, explicitApproverId);
                }
                if (kitchenStatus.overridden && isBillNowPaid) {
                    (0, db_1.recordOrderAudit)(db, {
                        orderId: req.params.id,
                        orderItemId: req.params.itemId,
                        actorUserId: req.user.userId,
                        action: 'kitchen_delivery_override',
                        details: {
                            manager_user_id: kitchenStatus.managerUserId,
                            undelivered_count: kitchenStatus.count,
                        },
                    });
                }
            }
            (0, db_1.recordOrderAudit)(db, {
                orderId: req.params.id,
                orderItemId: req.params.itemId,
                actorUserId: req.user.userId,
                action: 'item_discount_applied',
                details: {
                    discount_type,
                    discount_value,
                    ...(approvedByUserId && { approved_by: approvedByUserId }),
                },
            });
            const updatedRow = db
                .prepare('SELECT * FROM order_items WHERE id = ?')
                .get(req.params.itemId);
            return {
                ...updatedRow,
                edit_version: getOrderItemEditVersion(db, req.params.id, req.params.itemId),
            };
        });
        res.json({ item: updatedItem });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Internal server error',
            ...(error.code ? { code: error.code } : {}),
        });
    }
});
router.patch('/:id/items/:itemId/discount', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.discount.apply'), handleItemDiscount);
router.post('/:id/items/:itemId/discount', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.discount.apply'), handleItemDiscount);
const handleItemPriceOverride = (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const currency = (0, bills_1.getTenantCurrency)();
        const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
        const override = (0, item_price_override_1.parsePriceOverrideInput)(req.body, decimals);
        const actorId = req.user.userId;
        const updatedItem = (0, db_1.withTxn)(() => {
            const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
            if (!currentOrder) {
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error('Cannot override prices on a completed or cancelled order'), {
                    statusCode: 400,
                });
            }
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, req.params.id, currentOrder);
            const blockingBill = db
                .prepare(`SELECT payment_status, split_group_id, COALESCE(paid_amount, 0) AS paid_amount
           FROM bills WHERE order_id = ?
             AND (split_group_id IS NOT NULL
                  OR payment_status IN ('paid', 'partial', 'refunded', 'partially_refunded')
                  OR COALESCE(paid_amount, 0) > 0)
           LIMIT 1`)
                .get(req.params.id);
            if (blockingBill) {
                throw Object.assign(new Error('Prices cannot be overridden once a bill has payments, a split, or a refund'), { statusCode: 409 });
            }
            const currentItem = db
                .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
                .get(req.params.itemId, req.params.id);
            if (!currentItem) {
                throw Object.assign(new Error('Item not found'), { statusCode: 404 });
            }
            if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(currentItem.status)) {
                throw Object.assign(new Error('Cannot override the price of a cancelled or voided item'), {
                    statusCode: 400,
                });
            }
            const product = db
                .prepare('SELECT * FROM products WHERE id = ?')
                .get(currentItem.product_id);
            if (!product) {
                throw Object.assign(new Error('Product not found'), { statusCode: 404 });
            }
            const addonRows = db
                .prepare('SELECT price, quantity FROM order_item_addons WHERE order_item_id = ?')
                .all(currentItem.id);
            const addonTotal = addonRows.reduce((sum, addon) => sum + (addon.price || 0) * (addon.quantity || 1) * currentItem.quantity, 0);
            const baseTotal = override.price * currentItem.quantity + addonTotal;
            // An existing item discount stays, capped so the line never goes negative.
            const itemDiscount = Number(Math.min(Number(currentItem.discount_amount || 0), baseTotal).toFixed(decimals));
            const newSubtotal = Math.max(0, Number((baseTotal - itemDiscount).toFixed(decimals)));
            const customer = currentOrder.customer_id
                ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(currentOrder.customer_id) ?? null)
                : null;
            const settingsMap = Object.fromEntries(db
                .prepare("SELECT key, value FROM settings WHERE key IN ('country', 'business_type', 'state_code', 'taxes_enabled')")
                .all().map((s) => [s.key, s.value]));
            const tenantInfo = {
                country: settingsMap.country || '',
                business_type: settingsMap.business_type || 'restaurant',
                state_code: settingsMap.state_code || '',
                currency,
                taxes_enabled: settingsMap.taxes_enabled === 'true',
            };
            const taxResult = (0, tax_1.calculateItemTax)(tenantInfo, product, newSubtotal, customer);
            const newTotal = newSubtotal + (taxResult.tax_type === 'inclusive' ? 0 : taxResult.tax_amount);
            const at = (0, db_1.now)();
            const originalUnitPrice = currentItem.price_overridden
                ? Number(currentItem.original_unit_price ?? currentItem.unit_price)
                : Number(currentItem.unit_price);
            db.prepare(`UPDATE order_items SET unit_price = ?, discount_amount = ?, subtotal = ?, tax_amount = ?,
           tax_breakdown = ?, tax_snapshot = ?, tax_type = ?, total = ?, updated_at = ? WHERE id = ?`).run(override.price, itemDiscount, newSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown), taxResult.tax_snapshot ? JSON.stringify(taxResult.tax_snapshot) : null, taxResult.tax_type, newTotal, at, currentItem.id);
            (0, item_price_override_1.markItemPriceOverridden)(db, currentItem.id, {
                originalUnitPrice,
                reason: override.reason,
                actorUserId: actorId,
                at,
            });
            const orderTotals = (0, orders_1.calculateOrderTotals)(db, req.params.id);
            const newOrderDiscount = resolveOrderLevelDiscountAmount(currentOrder, orderTotals.subtotal, decimals);
            const engineCharges = resolveEngineCharges(currentOrder, orderTotals.subtotal, newOrderDiscount);
            const { taxRollup, total: orderTotal, roundOff, } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: currentOrder,
                customer,
                totals: orderTotals,
                discountAmount: newOrderDiscount,
                taxScaling: 'when-discounted',
                appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
                chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
            });
            const syncedServiceCharge = engineCharges
                ? engineCharges.columns.service_charge
                : currentOrder.service_charge || 0;
            const syncedPackagingCharge = engineCharges
                ? engineCharges.columns.packaging_charge
                : currentOrder.packaging_charge || 0;
            const syncedChargesJson = engineCharges
                ? engineCharges.chargesJson
                : (currentOrder.charges_breakdown ?? null);
            db.prepare(`UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?,
           service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?`).run(orderTotals.subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newOrderDiscount, orderTotal, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, at, req.params.id);
            // No payments exist (checked above), so an open bill simply takes the new total.
            const existingBill = db
                .prepare("SELECT id FROM bills WHERE order_id = ? AND payment_status != 'paid'")
                .get(req.params.id);
            if (existingBill) {
                const pack = (0, tax_1.getActiveCountryPack)(tenantInfo.country);
                const { total: billTotal, adjustment: billRoundOff } = (0, tax_engine_1.applyPayableRounding)(orderTotal, pack, currency);
                db.prepare(`UPDATE bills SET subtotal = ?, total = ?, balance = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?,
             discount_amount = ?, service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?,
             updated_at = ? WHERE id = ?`).run(orderTotals.subtotal, billTotal, billTotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newOrderDiscount, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, billRoundOff, at, existingBill.id);
            }
            (0, db_1.recordOrderAudit)(db, {
                orderId: req.params.id,
                orderItemId: req.params.itemId,
                actorUserId: actorId,
                action: 'item_price_overridden',
                details: {
                    original_unit_price: originalUnitPrice,
                    previous_unit_price: Number(currentItem.unit_price),
                    new_unit_price: override.price,
                    reason: override.reason,
                },
            });
            const updatedRow = db
                .prepare('SELECT * FROM order_items WHERE id = ?')
                .get(req.params.itemId);
            return {
                ...updatedRow,
                edit_version: getOrderItemEditVersion(db, req.params.id, req.params.itemId),
            };
        });
        cloud_sync_1.cloudSync.recordOrderChanged(req.params.id, 'order.updated');
        (0, kds_1.notifyOrderUpdated)();
        res.json({ item: updatedItem });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        const failure = error;
        res.status(failure.statusCode || 500).json({
            error: failure.statusCode ? failure.message : 'Internal server error',
            ...(failure.code ? { code: failure.code } : {}),
        });
    }
});
router.patch('/:id/items/:itemId/price', orderWriteRateLimit, (0, authorization_1.requirePermission)(item_price_override_1.ITEM_PRICE_OVERRIDE_PERMISSION), handleItemPriceOverride);
function getOrderItemEditVersion(db, orderId, itemId) {
    const row = db
        .prepare('SELECT COALESCE(MAX(id), 0) AS v FROM order_audit_log WHERE order_id = ? AND order_item_id = ?')
        .get(orderId, itemId);
    return Number(row?.v ?? 0);
}
function isOrderItemSuperseded(db, orderId, itemId) {
    const rows = db
        .prepare(`SELECT details_json FROM order_audit_log WHERE order_id = ? AND order_item_id = ? AND action = 'item_edited'`)
        .all(orderId, itemId);
    return rows.some((row) => {
        if (!row.details_json)
            return false;
        try {
            const parsed = JSON.parse(row.details_json);
            return parsed?.superseded === true;
        }
        catch {
            return false;
        }
    });
}
function normalizeReplacementForHash(replacement) {
    if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
        return null;
    }
    const r = replacement;
    const addons = Array.isArray(r.addons)
        ? r.addons.map((a) => {
            if (!a || typeof a !== 'object')
                return a;
            const addon = a;
            return {
                id: addon.id ?? null,
                name: addon.name ?? null,
                price: addon.price !== undefined ? Number(addon.price) : null,
                quantity: addon.quantity !== undefined ? Number(addon.quantity) : 1,
            };
        })
        : null;
    return {
        product_id: String(r.product_id ?? ''),
        quantity: Number(r.quantity),
        variant_id: r.variant_id ?? null,
        variant_selection: r.variant_selection ?? null,
        modifier_selection: r.modifier_selection ?? null,
        special_instructions: typeof r.special_instructions === 'string' ? r.special_instructions.trim() || null : null,
        addons,
    };
}
function buildOrderItemEditRequestHash(params) {
    const normalized = {
        operation: 'order.item.edit',
        order_id: String(params.orderId),
        item_id: String(params.itemId),
        expected_edit_version: params.expectedEditVersion,
        kind: params.hasQuantity ? 'quantity' : 'replacement',
        quantity: params.hasQuantity ? Number(params.quantity) : null,
        replacement: params.hasQuantity ? null : normalizeReplacementForHash(params.replacement),
        reason: typeof params.reason === 'string' ? params.reason.trim() || null : null,
    };
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(normalized)).digest('hex');
}
function getAppliedItemDiscountDetails(db, itemId) {
    const auditRow = db
        .prepare(`SELECT details_json FROM order_audit_log WHERE order_item_id = ? AND action = 'item_discount_applied' ORDER BY id DESC LIMIT 1`)
        .get(itemId);
    if (!auditRow?.details_json)
        return null;
    try {
        const details = JSON.parse(auditRow.details_json);
        if ((details?.discount_type === 'percentage' || details?.discount_type === 'amount') &&
            typeof details.discount_value === 'number') {
            return {
                discount_type: details.discount_type,
                discount_value: details.discount_value,
                ...(typeof details.approved_by === 'string' ? { approved_by: details.approved_by } : {}),
            };
        }
    }
    catch {
        // Fall back to proportional scaling.
    }
    return null;
}
function resolveEditedItemDiscountAmount(db, oldItem, itemBaseTotal, newQuantity, oldQuantity, decimals, extraLineOnly = false) {
    const existingDiscount = Number(oldItem.discount_amount || 0);
    if (existingDiscount <= 0)
        return 0;
    const details = getAppliedItemDiscountDetails(db, oldItem.id);
    if (details?.discount_type === 'percentage') {
        return Math.min(itemBaseTotal, Number(((itemBaseTotal * details.discount_value) / 100).toFixed(decimals)));
    }
    if (details?.discount_type === 'amount') {
        if (extraLineOnly)
            return 0;
        return Math.min(itemBaseTotal, Number(details.discount_value.toFixed(decimals)));
    }
    if (extraLineOnly)
        return 0;
    const scaled = oldQuantity > 0 ? (existingDiscount * newQuantity) / oldQuantity : existingDiscount;
    return Math.min(itemBaseTotal, Number(scaled.toFixed(decimals)));
}
// Cancel or void an order item (frontend calls this)
router.patch('/:orderId/items/:itemId/cancel', orderItemCancelRateLimit, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const orderId = String(req.params.orderId);
        const itemId = String(req.params.itemId);
        const { override_pin, reason } = req.body;
        // requireAuth (main/server.ts) already verified the token and attached
        // the user's current DB role to req.user — use that, not the JWT claim.
        const actorId = String(req.user?.userId || '');
        if (!actorId)
            return res.status(403).json({ error: 'Authentication required' });
        const db = (0, db_1.getDatabase)();
        // Look up pre-transaction rows for initial 404 validation.
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const item = db
            .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
            .get(itemId, orderId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found in this order' });
        }
        const isItemVoidInProgress = ['preparing', 'ready'].includes(item.status);
        const suppliedApproverIds = [req.body.approver_id, req.body.manager_id, req.body.user_id]
            .filter((val) => val !== undefined && val !== null && String(val).trim() !== '')
            .map((val) => String(val).trim());
        const managerId = suppliedApproverIds[0];
        let preVerifiedVoidApprover = null;
        if (isItemVoidInProgress && override_pin && typeof override_pin === 'string') {
            const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
            const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
            const rateLimitKey = `pin:${canonicalIp}:item-void`;
            if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (!/^\d{4,6}$/.test(override_pin)) {
                (0, security_1.checkPinRateLimit)(rateLimitKey);
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            if (new Set(suppliedApproverIds).size > 1) {
                return res.status(400).json({ error: 'Conflicting approver identifiers' });
            }
            const candidateUsers = managerId
                ? db
                    .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL AND is_active = 1")
                    .all(managerId)
                : db
                    .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE role IN ('owner', 'manager') AND pin_hash IS NOT NULL AND is_active = 1")
                    .all();
            const preVerifiedCandidate = await (0, security_1.withPinVerificationLock)(rateLimitKey, async () => {
                if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                    return { rateLimited: true };
                }
                for (const candidate of candidateUsers) {
                    if ((0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                        (0, authorization_1.hasPermission)(candidate.id, 'orders.item.void')) {
                        if (await (0, db_1.verifyPinAsync)(candidate.pin_hash, override_pin)) {
                            (0, security_1.clearPinRateLimit)(rateLimitKey);
                            return {
                                approver: { id: candidate.id, verifiedPinHash: candidate.pin_hash },
                            };
                        }
                    }
                }
                (0, security_1.checkPinRateLimit)(rateLimitKey);
                return { approver: null };
            });
            if (preVerifiedCandidate.rateLimited) {
                return res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            }
            if (!preVerifiedCandidate.approver) {
                return res.status(403).json({ error: 'Invalid manager PIN' });
            }
            preVerifiedVoidApprover = preVerifiedCandidate.approver;
        }
        // Wrap item cancel and total recalculation in transaction.
        const result = (0, db_1.withTxn)(() => {
            const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            const currentItem = db
                .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
                .get(itemId, orderId);
            if (!currentItem || !currentOrder) {
                throw Object.assign(new Error('Item or order not found'), { statusCode: 404 });
            }
            const actor = db
                .prepare('SELECT id FROM users WHERE id = ? AND is_active = 1')
                .get(actorId);
            if (!actor) {
                throw Object.assign(new Error('Authentication required'), { statusCode: 403 });
            }
            // Idempotent no-op for already-terminal items.
            if (['cancelled', 'voided', 'void_adjustment', 'refunded'].includes(currentItem.status)) {
                const terminalPermission = currentItem.status === 'cancelled' ? 'orders.item.cancel' : 'orders.item.void';
                if (!(0, authorization_1.hasPermission)(actorId, terminalPermission)) {
                    throw Object.assign(new Error('Only owner or manager can cancel this item'), {
                        statusCode: 403,
                    });
                }
                const items = (0, db_1.attachEffectiveAddons)(db, db
                    .prepare('SELECT * FROM order_items WHERE order_id = ?')
                    .all(orderId)
                    .map(db_1.parseItemJson));
                return {
                    updatedOrder: currentOrder,
                    items,
                    orderCancelled: currentOrder.status === 'cancelled',
                    eventType: null,
                };
            }
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, orderId, currentOrder);
            if (db
                .prepare(`
        SELECT 1
        FROM bills
        WHERE order_id = ?
          AND NOT (COALESCE(payment_status, '') = 'paid' AND COALESCE(paid_amount, 0) = 0)
          AND (
            COALESCE(payment_status, 'unpaid') <> 'unpaid'
            OR COALESCE(paid_amount, 0) > 0
            OR (payment_details IS NOT NULL AND TRIM(payment_details) NOT IN ('', '[]', '{}', 'null'))
          )
        LIMIT 1
      `)
                .get(orderId)) {
                throw Object.assign(new Error('Cannot cancel items on a paid or partially paid order'), {
                    statusCode: 409,
                });
            }
            // Completed and cancelled orders are terminal.
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error('Cannot cancel items on completed or cancelled orders'), {
                    statusCode: 400,
                });
            }
            // Voiding items in preparation requires manager PIN and records a void adjustment line.
            const isItemVoid = ['preparing', 'ready'].includes(currentItem.status);
            const requiredPermission = isItemVoid ? 'orders.item.void' : 'orders.item.cancel';
            if (!(0, authorization_1.hasPermission)(actorId, requiredPermission)) {
                throw Object.assign(new Error('Only owner or manager can cancel this item'), {
                    statusCode: 403,
                });
            }
            let approvedByUserId;
            if (isItemVoid) {
                if (!override_pin) {
                    throw Object.assign(new Error('Manager PIN required to void an item already in progress'), { statusCode: 400 });
                }
                const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
                const canonicalIp = (0, security_1.normalizeIpForRateLimit)(clientIp);
                // Rate-limit attempts per client rather than per item to prevent brute force attacks.
                const rateLimitKey = `pin:${canonicalIp}:item-void`;
                if ((0, security_1.isPinRateLimited)(rateLimitKey)) {
                    throw Object.assign(new Error('Too many PIN attempts. Try again in 15 minutes.'), {
                        statusCode: 429,
                    });
                }
                let pinUser = null;
                if (preVerifiedVoidApprover) {
                    const candidate = db
                        .prepare("SELECT id, role, pin_hash, is_active FROM users WHERE id = ? AND role IN ('owner', 'manager')")
                        .get(preVerifiedVoidApprover.id);
                    if (candidate &&
                        candidate.is_active === 1 &&
                        candidate.pin_hash === preVerifiedVoidApprover.verifiedPinHash &&
                        (0, role_permissions_1.hasRole)(candidate.role, role_permissions_1.ROLE_ACCESS.ownerManager) &&
                        (0, authorization_1.hasPermission)(candidate.id, 'orders.item.void') &&
                        (!managerId || candidate.id === managerId)) {
                        pinUser = candidate;
                    }
                }
                if (!pinUser) {
                    (0, security_1.checkPinRateLimit)(rateLimitKey);
                    throw Object.assign(new Error('Invalid manager PIN'), { statusCode: 403 });
                }
                (0, security_1.clearPinRateLimit)(rateLimitKey);
                approvedByUserId = pinUser.id;
            }
            if (isItemVoid) {
                // Record mirrored negative line to adjust bill total while preserving original item line.
                db.prepare(`
          INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, unit_price, quantity,
            subtotal, tax_amount, tax_breakdown, tax_snapshot, tax_type, discount_amount, total,
            variant_selection, modifier_selection, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'void_adjustment', ?, ?)
        `).run(orderId, currentItem.product_id, `Void: ${currentItem.product_name}`, currentItem.product_sku, -currentItem.unit_price, currentItem.quantity, -currentItem.subtotal, -(currentItem.tax_amount || 0), (0, tax_1.invertTaxBreakdown)(currentItem.tax_breakdown), (0, tax_1.invertTaxSnapshot)(currentItem.tax_snapshot), currentItem.tax_type, -(currentItem.discount_amount || 0), -currentItem.total, currentItem.variant_selection, currentItem.modifier_selection, (0, db_1.now)(), (0, db_1.now)());
                // Mark item voided without restoring deducted inventory.
                db.prepare("UPDATE order_items SET status = 'voided', voided_at = ?, updated_at = ? WHERE id = ?").run((0, db_1.now)(), (0, db_1.now)(), itemId);
            }
            else {
                cancelOrderItemAndRestoreStock(db, currentItem, actorId, reason, {
                    skipStockRestore: (0, scheduled_orders_1.isUnreleasedOrderRow)(currentOrder),
                });
            }
            // Recalculate order totals excluding terminal items.
            const orderTotals = (0, orders_1.calculateOrderTotals)(db, orderId);
            const { activeItems, subtotal } = orderTotals;
            // BUG #13 FIX: Preserve order-level discount (scale percentage proportionally)
            const currency = (0, bills_1.getTenantCurrency)();
            const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
            const newDiscountAmount = resolveOrderLevelDiscountAmount(currentOrder, subtotal, decimals);
            const tenantInfo = {
                country: (0, db_1.getSettingValue)('country') || '',
                business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
                state_code: (0, db_1.getSettingValue)('state_code') || '',
                currency: (0, bills_1.getTenantCurrency)(),
                taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
            };
            const customer = currentOrder.customer_id
                ? db
                    .prepare('SELECT * FROM customers WHERE id = ?')
                    .get(currentOrder.customer_id)
                : null;
            // BUG #5 FIX: Correct round-off formula; BUG #24 FIX: include delivery_charge (was missing, causing total mismatch with bill generation)
            const engineCharges = resolveEngineCharges(currentOrder, subtotal, newDiscountAmount);
            const orderCancelled = activeItems.length === 0 && currentOrder.status !== 'cancelled';
            const chargeColumnOverrides = engineCharges && orderCancelled
                ? {
                    ...(engineCharges.ownsServiceChargeColumn ? { service_charge: 0 } : {}),
                    ...(engineCharges.ownsPackagingChargeColumn ? { packaging_charge: 0 } : {}),
                }
                : engineCharges?.chargeColumnOverrides;
            const syncedCharges = orderCancelled && engineCharges ? [] : engineCharges?.appliedCharges;
            const { taxRollup, total, roundOff } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: currentOrder,
                customer,
                totals: orderTotals,
                discountAmount: newDiscountAmount,
                taxScaling: 'when-discounted',
                appliedCharges: syncedCharges ?? null,
                chargeColumnOverrides,
            });
            const syncedServiceCharge = orderCancelled && engineCharges?.ownsServiceChargeColumn
                ? 0
                : (engineCharges?.columns.service_charge ?? (currentOrder.service_charge || 0));
            const syncedPackagingCharge = orderCancelled && engineCharges?.ownsPackagingChargeColumn
                ? 0
                : (engineCharges?.columns.packaging_charge ?? (currentOrder.packaging_charge || 0));
            const syncedChargesJson = orderCancelled && engineCharges
                ? '[]'
                : engineCharges
                    ? engineCharges.chargesJson
                    : (currentOrder.charges_breakdown ?? null);
            // Cancelling the last active item marks the entire order cancelled and frees table.
            if (orderCancelled) {
                db.prepare(`
          UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?,
            service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?,
            status = 'cancelled', cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?
        `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, (0, db_1.now)(), 'All items cancelled', (0, db_1.now)(), orderId);
                if (currentOrder.table_id) {
                    db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?").run((0, db_1.now)(), currentOrder.table_id);
                }
            }
            else {
                db.prepare(`
          UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?,
            service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?
        `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, (0, db_1.now)(), orderId);
            }
            (0, bills_1.syncUnpaidBillsForOrder)(db, orderId, {
                subtotal,
                taxAmount: taxRollup.taxAmount,
                taxBreakdown: JSON.stringify(taxRollup.breakdowns),
                taxSnapshot: taxRollup.snapshotJson,
                discountAmount: newDiscountAmount,
                deliveryCharge: currentOrder.delivery_charge || 0,
                packagingCharge: syncedPackagingCharge,
                serviceCharge: syncedServiceCharge,
                chargesBreakdown: syncedChargesJson,
                total,
            }, tenantInfo.country);
            (0, db_1.recordOrderAudit)(db, {
                orderId,
                orderItemId: itemId,
                actorUserId: actorId,
                action: isItemVoid ? 'item_voided' : 'item_cancelled',
                details: { ...(approvedByUserId && { approved_by: approvedByUserId }) },
            });
            if (!orderCancelled) {
                (0, orders_1.reconcileActiveOrderStatusFromItems)(db, orderId, actorId);
            }
            const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            const items = (0, db_1.attachEffectiveAddons)(db, db
                .prepare('SELECT * FROM order_items WHERE order_id = ?')
                .all(orderId)
                .map(db_1.parseItemJson));
            return {
                updatedOrder,
                items,
                orderCancelled,
                eventType: orderCancelled
                    ? 'order.cancelled'
                    : isItemVoid
                        ? 'order.item_voided'
                        : 'order.item_cancelled',
            };
        });
        if (result.eventType) {
            cloud_sync_1.cloudSync.recordOrderChanged(orderId, result.eventType);
            if ((0, scheduled_orders_1.isUnreleasedOrderRow)(result.updatedOrder)) {
                (0, kds_1.notifyOrderUpdated)();
            }
            else {
                (0, kds_1.notifyKdsUpdate)();
            }
        }
        res.json({ order: { ...result.updatedOrder, items: result.items } });
    }
    catch (error) {
        console.error('[Orders] Cancel item error:', error);
        console.error('[API] Internal error:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Internal server error',
            ...(error.code ? { code: error.code } : {}),
        });
    }
}));
// Owner-only edit of a live order line: change its quantity or swap it for another product.
router.patch('/:orderId/items/:itemId/edit', orderWriteRateLimit, (0, authorization_1.requirePermission)('orders.item.edit'), (req, res) => {
    try {
        const orderId = String(req.params.orderId);
        const itemId = String(req.params.itemId);
        const actorId = String(req.user?.userId || '');
        if (!actorId)
            return res.status(403).json({ error: 'Authentication required' });
        const idempotencyKey = orderIdempotencyKey(req);
        if (!idempotencyKey) {
            return res.status(400).json({ error: 'Idempotency-Key header is required' });
        }
        const { quantity, replacement, reason, expected_edit_version } = req.body || {};
        if (typeof expected_edit_version !== 'number' ||
            !Number.isSafeInteger(expected_edit_version) ||
            expected_edit_version < 0) {
            return res
                .status(400)
                .json({ error: 'expected_edit_version must be a non-negative integer' });
        }
        const hasQuantity = quantity !== undefined;
        if (hasQuantity === (replacement !== undefined)) {
            return res.status(400).json({ error: 'Provide either quantity or replacement' });
        }
        if (reason !== undefined && (typeof reason !== 'string' || reason.length > 200)) {
            return res.status(400).json({ error: 'reason must be a string of at most 200 characters' });
        }
        if (hasQuantity) {
            const parsedQty = Number(quantity);
            if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
                return res.status(400).json({ error: 'quantity must be a positive number' });
            }
        }
        else if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
            return res.status(400).json({ error: 'replacement must be an item object' });
        }
        const requestHash = buildOrderItemEditRequestHash({
            orderId,
            itemId,
            expectedEditVersion: expected_edit_version,
            hasQuantity,
            quantity,
            replacement,
            reason,
        });
        const db = (0, db_1.getDatabase)();
        const preReplay = getStoredOrderReplay(db, actorId, idempotencyKey, requestHash);
        if (preReplay) {
            return res.status(200).json({ order: preReplay.order });
        }
        const result = (0, db_1.withTxn)(() => {
            const txReplay = getStoredOrderReplay(db, actorId, idempotencyKey, requestHash);
            if (txReplay) {
                return {
                    order: txReplay.order,
                    idempotentReplay: true,
                };
            }
            const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            if (!currentOrder)
                throw Object.assign(new Error('Order not found'), { statusCode: 404 });
            const oldItem = db
                .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
                .get(itemId, orderId);
            if (!oldItem) {
                throw Object.assign(new Error('Item not found in this order'), { statusCode: 404 });
            }
            const currentEditVersion = getOrderItemEditVersion(db, orderId, oldItem.id);
            if (expected_edit_version !== currentEditVersion) {
                throw Object.assign(new Error('Order item was modified by another request; refresh and try again'), { statusCode: 409 });
            }
            if ((0, order_item_status_1.isTerminalItemStatus)(oldItem.status)) {
                throw Object.assign(new Error('This item can no longer be edited'), { statusCode: 400 });
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error('Cannot edit items on completed or cancelled orders'), {
                    statusCode: 400,
                });
            }
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, orderId, currentOrder);
            const bills = db.prepare('SELECT * FROM bills WHERE order_id = ?').all(orderId);
            if (bills.some((bill) => bill.split_group_id)) {
                throw Object.assign(new Error('Items cannot be changed after a check has been split'), {
                    statusCode: 409,
                });
            }
            if (bills.some((bill) => ['paid', 'refunded', 'partially_refunded'].includes(bill.payment_status))) {
                throw Object.assign(new Error('Cannot edit items on a paid or refunded order'), {
                    statusCode: 409,
                });
            }
            const deferUnreleased = (0, scheduled_orders_1.isUnreleasedOrderRow)(currentOrder);
            const tenantInfo = {
                country: (0, db_1.getSettingValue)('country') || '',
                business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
                state_code: (0, db_1.getSettingValue)('state_code') || '',
                currency: (0, bills_1.getTenantCurrency)(),
                taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
            };
            const decimals = (0, countries_1.getCurrencyFractionDigits)(tenantInfo.currency);
            const customer = currentOrder.customer_id
                ? db
                    .prepare('SELECT * FROM customers WHERE id = ?')
                    .get(currentOrder.customer_id)
                : null;
            const oldAddons = db
                .prepare('SELECT * FROM order_item_addons WHERE order_item_id = ? ORDER BY id')
                .all(oldItem.id);
            const oldQuantity = Number(oldItem.quantity);
            const newQuantity = hasQuantity ? Number(quantity) : 0;
            if (hasQuantity && newQuantity === oldQuantity) {
                throw Object.assign(new Error('Quantity is unchanged'), { statusCode: 400 });
            }
            const isPendingLine = oldItem.status === 'pending';
            const isStartedQuantityDecrease = hasQuantity && newQuantity < oldQuantity && !isPendingLine;
            const isStartedQuantityIncrease = hasQuantity && newQuantity > oldQuantity && !isPendingLine;
            let newItemId = null;
            let superseded = false;
            let wastedQuantity;
            if (!hasQuantity && !isPendingLine) {
                throw Object.assign(new Error('Cannot replace an item once kitchen preparation has started; reduce quantity or void instead'), { statusCode: 400 });
            }
            if (isStartedQuantityDecrease) {
                const product = db
                    .prepare('SELECT * FROM products WHERE id = ?')
                    .get(oldItem.product_id);
                if (!product) {
                    throw Object.assign(new Error(`Product ${oldItem.product_id} not found`), {
                        statusCode: 404,
                    });
                }
                (0, orders_validation_1.validateProductQuantity)(product, newQuantity);
                const addonPerUnitTotal = oldAddons.reduce((sum, addon) => sum + Number(addon.price || 0) * Number(addon.quantity || 1), 0);
                const unitPrice = Number(oldItem.unit_price);
                const itemBaseTotal = (unitPrice + addonPerUnitTotal) * newQuantity;
                const itemDiscount = resolveEditedItemDiscountAmount(db, oldItem, itemBaseTotal, newQuantity, oldQuantity, decimals);
                const itemSubtotal = Math.max(0, Number((itemBaseTotal - itemDiscount).toFixed(decimals)));
                const taxResult = (0, tax_1.calculateItemTax)(tenantInfo, product, itemSubtotal, customer);
                const itemTotal = itemSubtotal + (taxResult.tax_type === 'inclusive' ? 0 : taxResult.tax_amount);
                const itemTaxSnapshotJson = taxResult.tax_snapshot
                    ? JSON.stringify(taxResult.tax_snapshot)
                    : null;
                // The dropped units are waste that stays out of stock, so the line's
                // held deduction, add-on snapshot, and recipe snapshot shrink to the
                // remaining quantity. A later cancel restores exactly what the line
                // still holds instead of the original deduction (regression: wasted
                // stock returning to available when a back-to-pending line is edited).
                const heldRatio = newQuantity / oldQuantity;
                const heldRecipeSnapshot = (0, recipes_1.parseRecipeSnapshot)(oldItem.recipe_snapshot);
                const scaledRecipeSnapshot = heldRecipeSnapshot
                    ? (0, recipes_1.scaleRecipeSnapshot)(heldRecipeSnapshot, heldRatio, decimals)
                    : null;
                const { ingredientCost: scaledIngredientCost, ingredientCostKnown: scaledIngredientCostKnown, } = (0, recipes_1.extractOrderItemCostFromSnapshot)(scaledRecipeSnapshot);
                db.prepare(`
            UPDATE order_items
            SET quantity = ?,
                inventory_deducted_quantity = ?,
                recipe_snapshot = ?,
                ingredient_cost = ?,
                ingredient_cost_known = ?,
                subtotal = ?,
                tax_amount = ?,
                tax_breakdown = ?,
                tax_snapshot = ?,
                tax_type = ?,
                discount_amount = ?,
                total = ?,
                updated_at = ?
            WHERE id = ?
          `).run(newQuantity, Number((Number(oldItem.inventory_deducted_quantity) * heldRatio).toFixed(6)), scaledRecipeSnapshot ? JSON.stringify(scaledRecipeSnapshot) : oldItem.recipe_snapshot, scaledIngredientCost, scaledIngredientCostKnown, itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown), itemTaxSnapshotJson, taxResult.tax_type, itemDiscount, itemTotal, (0, db_1.now)(), oldItem.id);
                for (const addon of oldAddons) {
                    db.prepare('UPDATE order_item_addons SET inventory_deducted_quantity = ? WHERE id = ?').run(Number((Number(addon.inventory_deducted_quantity || 0) * heldRatio).toFixed(6)), addon.id);
                }
                superseded = false;
                wastedQuantity = Number((oldQuantity - newQuantity).toFixed(6));
            }
            else {
                let newItem;
                const preserveUnitPrice = hasQuantity;
                const preserveStoredSelections = hasQuantity && newQuantity < oldQuantity;
                if (hasQuantity) {
                    const lineQuantity = isStartedQuantityIncrease
                        ? Number((newQuantity - oldQuantity).toFixed(6))
                        : newQuantity;
                    const parsedOld = (0, db_1.parseItemJson)(oldItem);
                    newItem = {
                        product_id: oldItem.product_id,
                        variant_id: oldItem.variant_id,
                        quantity: lineQuantity,
                        unit_price: oldItem.unit_price,
                        variant_selection: parsedOld.variant_selection,
                        modifier_selection: parsedOld.modifier_selection,
                        special_instructions: oldItem.special_instructions,
                        addons: oldAddons.map((addon) => ({
                            id: addon.addon_id ?? undefined,
                            name: addon.addon_name,
                            price: addon.price,
                            quantity: addon.quantity,
                        })),
                    };
                }
                else {
                    newItem = { ...replacement };
                }
                if (isStartedQuantityIncrease) {
                    superseded = false;
                }
                else if (isPendingLine) {
                    cancelOrderItemAndRestoreStock(db, oldItem, actorId, reason, {
                        skipStockRestore: deferUnreleased,
                    });
                    superseded = true;
                }
                else {
                    // Started replacement: void original line without restoring stock.
                    db.prepare("UPDATE order_items SET status = 'voided', voided_at = ?, updated_at = ? WHERE id = ?").run((0, db_1.now)(), (0, db_1.now)(), oldItem.id);
                    superseded = true;
                    wastedQuantity = oldQuantity;
                }
                try {
                    (0, orders_validation_1.validateItemNotes)(db, newItem.special_instructions);
                    if (preserveStoredSelections) {
                        // A reduction needs no extra units, so the stored selections stay
                        // authoritative even when the catalog has since disabled the sold
                        // variant or add-on; their held stock scales with the line.
                        const heldRatio = newQuantity / oldQuantity;
                        newItem.addons = oldAddons.map((addon) => ({
                            id: addon.addon_id ?? undefined,
                            name: addon.addon_name,
                            price: addon.price,
                            quantity: addon.quantity,
                            inventory_deducted_quantity: Number((Number(addon.inventory_deducted_quantity || 0) * heldRatio).toFixed(6)),
                        }));
                        const heldRecipeSnapshot = (0, recipes_1.parseRecipeSnapshot)(oldItem.recipe_snapshot);
                        newItem.recipe_snapshot = heldRecipeSnapshot
                            ? (0, recipes_1.scaleRecipeSnapshot)(heldRecipeSnapshot, heldRatio, decimals)
                            : null;
                        const oldTarget = orderItemInventoryTarget(db, oldItem);
                        newItem.inventory_deducted_quantity = Number((Number(oldItem.inventory_deducted_quantity || 0) * heldRatio).toFixed(6));
                        newItem.inventory_target_product_id = oldTarget?.productId ?? null;
                        newItem.inventory_target_variant_id = oldTarget?.variantId ?? null;
                    }
                    else {
                        const resolved = resolveItemAddons(db, newItem.product_id, newItem.addons, newItem.quantity, { deferStockDeduction: deferUnreleased });
                        if (preserveUnitPrice && Array.isArray(resolved)) {
                            const originalPrice = new Map(oldAddons.map((a) => [a.addon_id, a.price]));
                            for (const addon of resolved) {
                                const original = originalPrice.get(addon.id);
                                if (original !== undefined)
                                    addon.price = original;
                            }
                        }
                        newItem.addons = resolved;
                    }
                }
                catch (err) {
                    throw Object.assign(new Error(err instanceof Error ? err.message : 'Invalid item'), {
                        statusCode: 400,
                    });
                }
                const carriedDiscountDetails = preserveUnitPrice
                    ? getAppliedItemDiscountDetails(db, oldItem.id)
                    : null;
                if (preserveUnitPrice) {
                    const addonPerUnitTotal = (newItem.addons || []).reduce((sum, addon) => sum + Number(addon?.price || 0) * Number(addon?.quantity || 1), 0);
                    const itemBaseTotal = (Number(newItem.unit_price) + addonPerUnitTotal) * Number(newItem.quantity);
                    newItem.discount_amount = resolveEditedItemDiscountAmount(db, oldItem, itemBaseTotal, Number(newItem.quantity), oldQuantity, decimals, isStartedQuantityIncrease);
                }
                const [insertedId] = insertOrderItems(db, orderId, [newItem], {
                    tenantInfo,
                    customer,
                    isOnlineOrder: !!currentOrder.online_platform,
                    actorUserId: actorId,
                    initialStatus: 'pending',
                    preserveUnitPrice,
                    preserveSelections: preserveStoredSelections,
                    deferStockDeduction: deferUnreleased,
                });
                newItemId = insertedId;
                if (preserveUnitPrice)
                    (0, item_price_override_1.carryPriceOverride)(db, oldItem.id, insertedId);
                if (carriedDiscountDetails &&
                    Number(newItem.discount_amount || 0) > 0 &&
                    (!isStartedQuantityIncrease || carriedDiscountDetails.discount_type === 'percentage')) {
                    (0, db_1.recordOrderAudit)(db, {
                        orderId,
                        orderItemId: String(insertedId),
                        actorUserId: actorId,
                        action: 'item_discount_applied',
                        details: carriedDiscountDetails,
                    });
                }
            }
            const orderTotals = (0, orders_1.calculateOrderTotals)(db, orderId);
            const { subtotal } = orderTotals;
            const newDiscountAmount = resolveOrderLevelDiscountAmount(currentOrder, subtotal, decimals);
            const engineCharges = resolveEngineCharges(currentOrder, subtotal, newDiscountAmount);
            const { taxRollup, total, roundOff } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: currentOrder,
                customer,
                totals: orderTotals,
                discountAmount: newDiscountAmount,
                taxScaling: 'when-discounted',
                appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
                chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
            });
            const { total: payableTotal } = (0, tax_engine_1.applyPayableRounding)(total, (0, tax_1.getActiveCountryPack)(tenantInfo.country), tenantInfo.currency);
            const collected = bills.reduce((sum, bill) => sum + Number(bill.paid_amount || 0), 0);
            if (payableTotal < collected) {
                throw Object.assign(new Error('The new total is below the amount already collected; refund the difference first'), { statusCode: 409 });
            }
            const serviceCharge = engineCharges
                ? engineCharges.columns.service_charge
                : currentOrder.service_charge || 0;
            const packagingCharge = engineCharges
                ? engineCharges.columns.packaging_charge
                : currentOrder.packaging_charge || 0;
            const chargesJson = engineCharges
                ? engineCharges.chargesJson
                : (currentOrder.charges_breakdown ?? null);
            db.prepare(`
          UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?,
            service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?
        `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, serviceCharge, packagingCharge, chargesJson, roundOff, (0, db_1.now)(), orderId);
            (0, bills_1.syncUnpaidBillsForOrder)(db, orderId, {
                subtotal,
                taxAmount: taxRollup.taxAmount,
                taxBreakdown: JSON.stringify(taxRollup.breakdowns),
                taxSnapshot: taxRollup.snapshotJson,
                discountAmount: newDiscountAmount,
                deliveryCharge: currentOrder.delivery_charge || 0,
                packagingCharge,
                serviceCharge,
                chargesBreakdown: chargesJson,
                total,
            }, tenantInfo.country);
            (0, db_1.recordOrderAudit)(db, {
                orderId,
                orderItemId: itemId,
                actorUserId: actorId,
                action: 'item_edited',
                details: {
                    kind: hasQuantity ? 'quantity' : 'replacement',
                    from_quantity: oldItem.quantity,
                    from_product_id: oldItem.product_id,
                    superseded,
                    ...(newItemId !== null ? { new_item_id: Number(newItemId) } : {}),
                    ...(hasQuantity ? { to_quantity: newQuantity } : {}),
                    ...(wastedQuantity !== undefined ? { wasted_quantity: wastedQuantity } : {}),
                    ...(reason ? { reason } : {}),
                },
            });
            (0, orders_1.reconcileActiveOrderStatusFromItems)(db, orderId, actorId);
            const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            const items = (0, db_1.attachEffectiveAddons)(db, db
                .prepare('SELECT * FROM order_items WHERE order_id = ?')
                .all(orderId)
                .map(db_1.parseItemJson));
            const response = { order: { ...updatedOrder, items } };
            db.prepare('INSERT INTO order_idempotency (user_id, idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)').run(actorId, idempotencyKey, requestHash, JSON.stringify(response), (0, db_1.now)());
            return { order: response.order, idempotentReplay: false };
        });
        if (!result.idempotentReplay) {
            cloud_sync_1.cloudSync.recordOrderChanged(orderId, 'order.item_edited');
            if ((0, scheduled_orders_1.isUnreleasedOrderRow)(result.order)) {
                (0, kds_1.notifyOrderUpdated)();
            }
            else {
                (0, kds_1.notifyKdsUpdate)();
            }
        }
        res.json({ order: result.order });
    }
    catch (err) {
        const error = err;
        console.error('[Orders] Edit item error:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Internal server error',
            ...(error.code ? { code: error.code } : {}),
        });
    }
});
// Restore cancelled order item (frontend calls this)
router.patch('/:orderId/items/:itemId/restore', orderWriteRateLimit, (req, res) => {
    try {
        const orderId = String(req.params.orderId);
        const itemId = String(req.params.itemId);
        // requireAuth (main/server.ts) already verified the token and attached
        // the user's current DB role to req.user — use that, not the JWT claim.
        const actorId = String(req.user?.userId || '');
        if (!actorId)
            return res.status(403).json({ error: 'Authentication required' });
        const db = (0, db_1.getDatabase)();
        // Keep these lookups only for the inexpensive not-found response. The
        // transaction repeats all mutable state and policy checks authoritatively.
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const item = db
            .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
            .get(itemId, orderId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found in this order' });
        }
        // BUG #17 FIX: Wrap restore + total recalc in transaction
        const result = (0, db_1.withTxn)(() => {
            const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            const currentItem = db
                .prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?')
                .get(itemId, orderId);
            if (!currentItem || !currentOrder) {
                throw Object.assign(new Error('Item or order not found'), { statusCode: 404 });
            }
            const actor = db
                .prepare('SELECT id FROM users WHERE id = ? AND is_active = 1')
                .get(actorId);
            if (!actor || !(0, authorization_1.hasPermission)(actorId, 'orders.item.restore')) {
                throw Object.assign(new Error('Only owner or manager can restore items'), {
                    statusCode: 403,
                });
            }
            if (['completed', 'cancelled'].includes(currentOrder.status)) {
                throw Object.assign(new Error('Cannot restore items on completed or cancelled orders'), {
                    statusCode: 400,
                });
            }
            (0, scheduled_orders_1.assertScheduledOrderUnpaidForEdit)(db, orderId, currentOrder);
            if (db
                .prepare(`SELECT id FROM bills
               WHERE order_id = ?
                 AND (
                   payment_status IN ('partial', 'partially_paid', 'partially_refunded', 'refunded')
                   OR COALESCE(paid_amount, 0) > 0
                   OR (payment_status = 'paid' AND (split_group_id IS NULL OR COALESCE(total, 0) > 0))
                 )
               LIMIT 1`)
                .get(orderId)) {
                throw Object.assign(new Error('Cannot restore items on a paid order'), {
                    statusCode: 400,
                });
            }
            if (currentItem.status === 'cancelled' &&
                isOrderItemSuperseded(db, orderId, currentItem.id)) {
                throw Object.assign(new Error('Superseded order items cannot be restored'), {
                    statusCode: 400,
                });
            }
            // Only cancelled items can be restored; ignore if already active or voided
            if (currentItem.status !== 'cancelled') {
                const items = (0, db_1.attachEffectiveAddons)(db, db
                    .prepare('SELECT * FROM order_items WHERE order_id = ?')
                    .all(orderId)
                    .map(db_1.parseItemJson));
                return { updatedOrder: currentOrder, items, changed: false };
            }
            if (!(0, scheduled_orders_1.isUnreleasedOrderRow)(currentOrder) && currentOrder.inventory_lifecycle !== 'checkout_v1') {
                // Re-deduct the inventory quantity originally consumed by the item
                const inventoryTarget = currentItem.inventory_deducted_quantity > 0
                    ? orderItemInventoryTarget(db, currentItem)
                    : null;
                if (inventoryTarget) {
                    (0, inventory_1.adjustProductStock)(db, {
                        productId: inventoryTarget.productId,
                        variantId: inventoryTarget.variantId,
                        quantityDelta: -currentItem.inventory_deducted_quantity,
                        movementType: 'cancel_restore',
                        referenceType: 'order_item',
                        referenceId: `${currentItem.id}:${currentItem.updated_at}`,
                        reason: 'Cancelled item restored',
                        actorUserId: actorId,
                    });
                }
                // The add-on snapshot, not a recomputation from the current catalog: the
                // merchant may have changed the add-on since the order was placed.
                moveOrderItemAddonStock(db, orderItemAddonStockLines(db, currentItem.id), {
                    direction: 'deplete',
                    actorUserId: actorId,
                    referenceId: `${currentItem.id}:${currentItem.updated_at}`,
                    reason: 'Cancelled item restored',
                });
                const recipeSnapshot = (0, recipes_1.parseRecipeSnapshot)(currentItem.recipe_snapshot);
                if (recipeSnapshot) {
                    (0, recipes_1.applyRecipeSnapshot)(db, recipeSnapshot, {
                        direction: 'deplete',
                        actorUserId: actorId,
                        referenceId: `${currentItem.id}:${currentItem.updated_at}`,
                    });
                }
            }
            // Restore - mark as pending
            db.prepare("UPDATE order_items SET status = 'pending', updated_at = ? WHERE id = ?").run((0, db_1.now)(), itemId);
            // Recalculate order totals
            const orderTotals = (0, orders_1.calculateOrderTotals)(db, orderId);
            const { subtotal } = orderTotals;
            // BUG #13 FIX: Preserve order-level discount (scale percentage proportionally)
            const currency = (0, bills_1.getTenantCurrency)();
            const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
            const newDiscountAmount = resolveOrderLevelDiscountAmount(currentOrder, subtotal, decimals);
            const tenantInfo = {
                country: (0, db_1.getSettingValue)('country') || '',
                business_type: (0, db_1.getSettingValue)('business_type') || 'restaurant',
                state_code: (0, db_1.getSettingValue)('state_code') || '',
                currency: (0, bills_1.getTenantCurrency)(),
                taxes_enabled: (0, db_1.getSettingValue)('taxes_enabled') === 'true',
            };
            const customer = currentOrder.customer_id
                ? db
                    .prepare('SELECT * FROM customers WHERE id = ?')
                    .get(currentOrder.customer_id)
                : null;
            // BUG #5 FIX: Correct round-off formula; BUG #24 FIX: include delivery_charge (was missing, causing total mismatch with bill generation)
            const engineCharges = resolveEngineCharges(order, subtotal, newDiscountAmount);
            const { taxRollup, total, roundOff } = (0, orders_1.recomputeOrderTotals)({
                tenantInfo,
                chargeContext: currentOrder,
                customer,
                totals: orderTotals,
                discountAmount: newDiscountAmount,
                taxScaling: 'when-discounted',
                appliedCharges: engineCharges ? engineCharges.appliedCharges : null,
                chargeColumnOverrides: engineCharges?.chargeColumnOverrides,
            });
            const syncedServiceCharge = engineCharges
                ? engineCharges.columns.service_charge
                : order.service_charge || 0;
            const syncedPackagingCharge = engineCharges
                ? engineCharges.columns.packaging_charge
                : order.packaging_charge || 0;
            const syncedChargesJson = engineCharges
                ? engineCharges.chargesJson
                : (order.charges_breakdown ?? null);
            db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, tax_snapshot = ?, discount_amount = ?, total = ?,
          service_charge = ?, packaging_charge = ?, charges_breakdown = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, taxRollup.taxAmount, JSON.stringify(taxRollup.breakdowns), taxRollup.snapshotJson, newDiscountAmount, total, syncedServiceCharge, syncedPackagingCharge, syncedChargesJson, roundOff, (0, db_1.now)(), orderId);
            (0, bills_1.syncUnpaidBillsForOrder)(db, orderId, {
                subtotal,
                taxAmount: taxRollup.taxAmount,
                taxBreakdown: JSON.stringify(taxRollup.breakdowns),
                taxSnapshot: taxRollup.snapshotJson,
                discountAmount: newDiscountAmount,
                deliveryCharge: order.delivery_charge || 0,
                packagingCharge: syncedPackagingCharge,
                serviceCharge: syncedServiceCharge,
                chargesBreakdown: syncedChargesJson,
                total,
            }, tenantInfo.country);
            (0, db_1.recordOrderAudit)(db, {
                orderId,
                orderItemId: itemId,
                actorUserId: actorId,
                action: 'item_restored',
            });
            (0, orders_1.reconcileActiveOrderStatusFromItems)(db, orderId, actorId);
            const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            const items = (0, db_1.attachEffectiveAddons)(db, db
                .prepare('SELECT * FROM order_items WHERE order_id = ?')
                .all(orderId)
                .map(db_1.parseItemJson));
            return { updatedOrder, items, changed: true };
        });
        if (result.changed) {
            cloud_sync_1.cloudSync.recordOrderChanged(orderId, 'order.item_restored');
            if ((0, scheduled_orders_1.isUnreleasedOrderRow)(result.updatedOrder)) {
                (0, kds_1.notifyOrderUpdated)();
            }
            else {
                (0, kds_1.notifyKdsUpdate)();
            }
        }
        res.json({ order: { ...result.updatedOrder, items: result.items } });
    }
    catch (error) {
        console.error('[Orders] Restore item error:', error);
        console.error('[API] Internal error:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Internal server error',
            ...(error.code ? { code: error.code } : {}),
        });
    }
});
router.get('/:orderId/packaging', (0, authorization_1.requireAnyPermission)('orders.read', 'pos.use', 'orders.create'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const packaging = (0, packaging_1.getOrderPackaging)(db, String(req.params.orderId));
        res.json(packaging);
    }
    catch (error) {
        const err = error;
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to get order packaging' });
    }
});
router.post('/:orderId/packaging/adjust', orderWriteRateLimit, (0, authorization_1.requireAnyPermission)('orders.item.edit', 'orders.create', 'pos.use'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const actorUserId = String(req.user?.userId || '');
        const adjustments = req.body?.adjustments;
        const result = (0, packaging_1.adjustOrderPackaging)(db, {
            orderId: String(req.params.orderId),
            adjustments,
            actorUserId,
        });
        (0, kds_1.notifyKdsUpdate)();
        res.json({ success: true, ...result });
    }
    catch (error) {
        const err = error;
        res.status(err.statusCode || 400).json({ error: err.message || 'Failed to adjust packaging' });
    }
});
exports.orderRoutes = router;
//# sourceMappingURL=orders.js.map