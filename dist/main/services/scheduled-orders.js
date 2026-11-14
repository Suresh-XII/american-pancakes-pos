"use strict";
/**
 * Scheduled orders release service and server-owned due sweep.
 *
 * Scheduled orders persist quoted items, prices, discounts, charges, taxes, and
 * totals immediately without touching product/variant/add-on/recipe stock or
 * notifying KDS/KOT. Inventory deduction, recipe depletion snapshots, KDS
 * broadcasts, and automatic KOT printing occur atomically at kitchen release.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduledOrderError = exports.ALLOWED_SCHEDULED_ORDER_TYPES = exports.SCHEDULED_SWEEP_INTERVAL_MS = void 0;
exports.isScheduledOrderRow = isScheduledOrderRow;
exports.isUnreleasedOrderRow = isUnreleasedOrderRow;
exports.resolveStoreTimezone = resolveStoreTimezone;
exports.validateScheduledOrderRequest = validateScheduledOrderRequest;
exports.hasRecordedOrderPayment = hasRecordedOrderPayment;
exports.assertScheduledOrderUnpaidForEdit = assertScheduledOrderUnpaidForEdit;
exports.releaseScheduledOrder = releaseScheduledOrder;
exports.sweepDueScheduledOrders = sweepDueScheduledOrders;
exports.triggerScheduledOrderSweep = triggerScheduledOrderSweep;
exports.startScheduledOrderSweep = startScheduledOrderSweep;
exports.stopScheduledOrderSweep = stopScheduledOrderSweep;
exports.encodeScheduledOrdersCursor = encodeScheduledOrdersCursor;
exports.decodeScheduledOrdersCursor = decodeScheduledOrdersCursor;
const db_1 = require("../db");
const countries_1 = require("../countries");
const inventory_1 = require("./inventory");
const checkout_inventory_1 = require("./checkout-inventory");
const product_variants_1 = require("./product-variants");
const recipes_1 = require("./recipes");
const supplies_1 = require("./supplies");
const kds_1 = require("./kds");
const cloud_sync_1 = require("./cloud-sync");
const printers_1 = require("../routes/printers");
const scheduled_time_1 = require("../../shared/scheduled-time");
exports.SCHEDULED_SWEEP_INTERVAL_MS = 10_000;
exports.ALLOWED_SCHEDULED_ORDER_TYPES = new Set(['takeaway', 'delivery']);
class ScheduledOrderError extends Error {
    statusCode;
    code;
    constructor(statusCode, message, code) {
        super(message);
        this.name = 'ScheduledOrderError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
exports.ScheduledOrderError = ScheduledOrderError;
class ReleaseHoldError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ReleaseHoldError';
    }
}
function isScheduledOrderRow(order) {
    if (!order)
        return false;
    return Boolean(order.scheduled_for ||
        (typeof order.release_status === 'string' &&
            order.release_status.length > 0 &&
            order.release_status !== 'released'));
}
function isUnreleasedOrderRow(order) {
    return Boolean(typeof order?.release_status === 'string' &&
        order.release_status.length > 0 &&
        order.release_status !== 'released');
}
function resolveStoreTimezone(db) {
    const readSetting = (key) => {
        if (db) {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
            return row?.value ?? undefined;
        }
        return (0, db_1.getSettingValue)(key) ?? undefined;
    };
    return (0, countries_1.resolveRegionalSnapshot)({
        country: readSetting('country'),
        currency: readSetting('currency'),
        timezone: readSetting('timezone'),
    }).timezone;
}
function validateScheduledOrderRequest(db, params) {
    const { orderType, scheduledForInput, nowMs = Date.now() } = params;
    if (scheduledForInput === undefined || scheduledForInput === null || scheduledForInput === '') {
        return null;
    }
    const normalizedType = typeof orderType === 'string' && orderType ? orderType : 'takeaway';
    if (!exports.ALLOWED_SCHEDULED_ORDER_TYPES.has(normalizedType)) {
        throw new ScheduledOrderError(400, 'Scheduled orders are supported for takeaway and delivery orders only.', 'UNSUPPORTED_ORDER_TYPE');
    }
    const timezone = resolveStoreTimezone(db);
    const parsed = (0, scheduled_time_1.parseScheduledForInput)({
        input: scheduledForInput,
        timezone,
        nowMs,
    });
    if (!parsed.ok) {
        throw new ScheduledOrderError(400, parsed.message, parsed.code);
    }
    return {
        scheduledForUtc: parsed.isoUtc,
        timezone,
    };
}
function hasNonEmptyPaymentDetails(raw) {
    if (!raw || typeof raw !== 'string')
        return false;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '[]' || trimmed === 'null')
        return false;
    try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) && parsed.length > 0;
    }
    catch {
        return true;
    }
}
/**
 * True once any payment has been recorded against any bill on the order,
 * including partial payments or payments later refunded.
 */
function hasRecordedOrderPayment(db, orderId) {
    const bills = db
        .prepare('SELECT payment_status, paid_amount, payment_details FROM bills WHERE order_id = ?')
        .all(orderId);
    return bills.some((bill) => ['paid', 'partial', 'partially_paid', 'partially_refunded', 'refunded'].includes(String(bill.payment_status || '')) ||
        Number(bill.paid_amount || 0) > 0 ||
        hasNonEmptyPaymentDetails(bill.payment_details));
}
/**
 * Scheduled orders allow item and financial edits only before the first
 * payment is recorded. Afterwards, staff must use correction or refund flows.
 */
function assertScheduledOrderUnpaidForEdit(db, orderId, order) {
    const isGuarded = isScheduledOrderRow(order) ||
        order?.dispatch_policy === 'on_payment' ||
        order?.checkout_stage === 'awaiting_payment';
    if (!isGuarded)
        return;
    if (hasRecordedOrderPayment(db, orderId)) {
        throw new ScheduledOrderError(409, 'Item and financial edits are locked after payment is recorded on a scheduled or awaiting-payment order. Use the refund or payment correction flow instead.', 'SCHEDULED_ORDER_PAID');
    }
}
function resolveReleaseActorUserId(db, preferredActorId, orderCreatorId) {
    if (preferredActorId) {
        const row = db.prepare('SELECT id FROM users WHERE id = ?').get(preferredActorId);
        if (row?.id)
            return row.id;
    }
    if (orderCreatorId) {
        const row = db.prepare('SELECT id FROM users WHERE id = ?').get(orderCreatorId);
        if (row?.id)
            return row.id;
    }
    const fallback = db
        .prepare(`SELECT id FROM users
       ORDER BY CASE WHEN role = 'owner' THEN 0 WHEN role = 'manager' THEN 1 ELSE 2 END,
                is_active DESC,
                rowid ASC
       LIMIT 1`)
        .get();
    return fallback?.id ?? null;
}
class ValidationRollback extends Error {
    constructor() {
        super('validation_rollback');
    }
}
function isCatalogOrStockHoldError(error) {
    if (error instanceof ReleaseHoldError ||
        error instanceof inventory_1.InventoryServiceError ||
        error instanceof recipes_1.RecipeServiceError ||
        error instanceof supplies_1.SupplyServiceError) {
        return true;
    }
    if (error instanceof Error) {
        const statusCode = error.statusCode;
        if (statusCode === 400 || statusCode === 404) {
            return true;
        }
    }
    return false;
}
function formatSqlUtcTimestamp(date) {
    return date.toISOString().replace('T', ' ').replace(/\..*$/, '');
}
/**
 * Shared, transactional release operation for scheduled orders.
 *
 * - Runs inside a SQLite transaction with compare-and-check on `release_status`
 *   so concurrent due sweeps and manual retries never deduct stock twice.
 * - Uses a nested savepoint so any stock shortfall or unusable catalog item
 *   rolls back partial item deductions while committing `release_status = 'blocked'`
 *   and `release_blocked_reason` on the whole order.
 * - Preserves saved prices, discounts, charges, taxes, and totals without repricing.
 */
async function releaseScheduledOrder(db, orderId, options) {
    const nowDate = options.nowDate ?? new Date();
    const nowIso = nowDate.toISOString();
    const nowDb = formatSqlUtcTimestamp(nowDate);
    const isAutoTrigger = options.trigger !== 'manual';
    const txResult = db.transaction(() => {
        const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (!currentOrder) {
            throw new ScheduledOrderError(404, 'Order not found', 'ORDER_NOT_FOUND');
        }
        if (currentOrder.status === 'cancelled' || currentOrder.status === 'completed') {
            if (isAutoTrigger) {
                return {
                    outcome: 'skipped',
                    reason: 'terminal_order_status',
                    order: currentOrder,
                };
            }
            throw new ScheduledOrderError(409, `Cannot release a ${currentOrder.status} order`, 'INVALID_ORDER_STATUS');
        }
        if (currentOrder.release_status === 'released') {
            return {
                outcome: 'already_released',
                order: currentOrder,
            };
        }
        const billCounts = db
            .prepare(`SELECT COUNT(*) AS total,
                COUNT(CASE WHEN payment_status = 'refunded' THEN 1 END) AS refunded
         FROM bills WHERE order_id = ?`)
            .get(currentOrder.id);
        if (billCounts.total > 0 && billCounts.total === billCounts.refunded) {
            if (currentOrder.release_status !== 'blocked' ||
                currentOrder.release_blocked_reason !== 'refunded') {
                db.prepare(`UPDATE orders SET release_status = 'blocked', release_blocked_reason = 'refunded', updated_at = ?
           WHERE id = ?`).run(nowDb, currentOrder.id);
                const actorUserId = resolveReleaseActorUserId(db, options.actorUserId, currentOrder.user_id);
                if (actorUserId) {
                    (0, db_1.recordOrderAudit)(db, {
                        orderId: String(currentOrder.id),
                        actorUserId,
                        action: 'release_blocked',
                        details: {
                            trigger: options.trigger,
                            initiated_by: options.actorUserId ? 'staff' : 'server_sweep',
                            reason: 'refunded',
                        },
                    });
                }
            }
            return {
                outcome: 'blocked',
                reason: 'refunded',
                order: db
                    .prepare('SELECT * FROM orders WHERE id = ?')
                    .get(currentOrder.id),
            };
        }
        // Gate 1: If dispatch_policy === 'on_payment', full payment across all applicable bills is required.
        if (currentOrder.dispatch_policy === 'on_payment') {
            const isPaid = (0, db_1.isOrderSettledAndNonRefunded)(db, currentOrder.id);
            if (!isPaid) {
                if (isAutoTrigger) {
                    return {
                        outcome: 'skipped',
                        reason: 'awaiting_payment',
                        order: currentOrder,
                    };
                }
                throw new ScheduledOrderError(409, 'Multi-counter orders cannot be released to the kitchen before full payment is completed.', 'ORDER_NOT_PAID');
            }
        }
        // Gate 2: If scheduled_for is set, scheduled_for must be due (unless staff explicitly triggered manual release after payment)
        if (isAutoTrigger) {
            if (currentOrder.release_status !== 'scheduled') {
                return {
                    outcome: 'skipped',
                    reason: 'already_blocked',
                    order: currentOrder,
                };
            }
            if (currentOrder.scheduled_for) {
                const scheduledMs = (0, db_1.parseDbTimestamp)(currentOrder.scheduled_for).getTime();
                if (!Number.isFinite(scheduledMs) || scheduledMs > nowDate.getTime()) {
                    return {
                        outcome: 'skipped',
                        reason: 'not_due',
                        order: currentOrder,
                    };
                }
            }
        }
        else if (currentOrder.release_status !== 'scheduled' &&
            currentOrder.release_status !== 'blocked') {
            throw new ScheduledOrderError(409, `Order cannot be released from state "${currentOrder.release_status}"`, 'INVALID_RELEASE_STATUS');
        }
        const effectiveActorId = resolveReleaseActorUserId(db, options.actorUserId, currentOrder.user_id);
        if (options.checkPreconditions) {
            const decision = options.checkPreconditions({
                db,
                order: currentOrder,
                trigger: options.trigger,
                nowIso,
            });
            if (!decision.allow) {
                if (decision.markBlocked) {
                    const reason = decision.holdReason || 'Order release preconditions are not satisfied.';
                    db.prepare(`UPDATE orders
             SET release_status = 'blocked',
                 release_blocked_reason = ?,
                 updated_at = ?
             WHERE id = ?`).run(reason, nowDb, currentOrder.id);
                    if (effectiveActorId) {
                        (0, db_1.recordOrderAudit)(db, {
                            orderId: String(currentOrder.id),
                            actorUserId: effectiveActorId,
                            action: 'release_blocked',
                            details: {
                                trigger: options.trigger,
                                initiated_by: options.actorUserId ? 'staff' : 'server_sweep',
                                reason,
                            },
                        });
                    }
                    const blockedOrder = db
                        .prepare('SELECT * FROM orders WHERE id = ?')
                        .get(currentOrder.id);
                    return {
                        outcome: 'blocked',
                        reason,
                        order: blockedOrder,
                    };
                }
                return {
                    outcome: 'skipped',
                    reason: decision.holdReason || 'precondition_not_met',
                    order: currentOrder,
                };
            }
        }
        const deductAndValidateInSavepoint = db.transaction(() => {
            if (!effectiveActorId) {
                throw new ReleaseHoldError('No staff user exists to attribute inventory depletion for this order.');
            }
            const itemRows = db
                .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC')
                .all(currentOrder.id);
            const activeItems = itemRows.filter((item) => item.status !== 'cancelled' && item.status !== 'voided');
            if (activeItems.length === 0) {
                throw new ReleaseHoldError('Order has no active items to release to the kitchen.');
            }
            const updateAddonDepletion = db.prepare('UPDATE order_item_addons SET inventory_deducted_quantity = ? WHERE id = ?');
            const updateItemDepletion = db.prepare(`UPDATE order_items
         SET inventory_deducted_quantity = ?,
             inventory_product_id = ?,
             inventory_variant_id = ?,
             recipe_snapshot = ?,
             ingredient_cost = ?,
             ingredient_cost_known = ?,
             status = 'pending',
             updated_at = ?
         WHERE id = ?`);
            for (const item of activeItems) {
                const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
                if (!product || product.deleted_at) {
                    throw new ReleaseHoldError(`Product "${item.product_name}" is no longer available in the catalog.`);
                }
                if (Number(product.is_active) !== 1) {
                    throw new ReleaseHoldError(`Product "${product.name}" is currently inactive.`);
                }
                if (product.category_id) {
                    const category = db
                        .prepare('SELECT id, name, is_active FROM categories WHERE id = ?')
                        .get(product.category_id);
                    if (category && Number(category.is_active) === 0) {
                        throw new ReleaseHoldError(`Category "${category.name}" for "${product.name}" is currently inactive.`);
                    }
                }
                const variant = (0, product_variants_1.resolveOrderItemVariant)(db, product, { variant_id: item.variant_id }, false);
                const productGroupIds = db
                    .prepare('SELECT addon_group_id FROM addon_group_product WHERE product_id = ?')
                    .all(product.id).map((row) => row.addon_group_id);
                const categoryGroupIds = product.category_id
                    ? db
                        .prepare('SELECT addon_group_id FROM category_addon_groups WHERE category_id = ?')
                        .all(product.category_id).map((row) => row.addon_group_id)
                    : [];
                const linkedGroupIds = new Set([...productGroupIds, ...categoryGroupIds]);
                const addonRows = db
                    .prepare('SELECT * FROM order_item_addons WHERE order_item_id = ? ORDER BY id ASC')
                    .all(item.id);
                const groupSelections = new Map();
                for (const addonRow of addonRows) {
                    if (!addonRow.addon_id) {
                        throw new ReleaseHoldError(`Add-on "${addonRow.addon_name}" on "${product.name}" is missing a catalog reference.`);
                    }
                    const catalogAddon = db
                        .prepare(`SELECT addons.*, addon_groups.is_active AS addon_group_is_active
               FROM addons
               LEFT JOIN addon_groups ON addon_groups.id = addons.addon_group_id
               WHERE addons.id = ?`)
                        .get(addonRow.addon_id);
                    if (!catalogAddon) {
                        throw new ReleaseHoldError(`Add-on "${addonRow.addon_name}" on "${product.name}" was removed from the catalog.`);
                    }
                    if (Number(catalogAddon.is_active) !== 1 ||
                        (catalogAddon.addon_group_id !== null &&
                            Number(catalogAddon.addon_group_is_active) !== 1)) {
                        throw new ReleaseHoldError(`Add-on "${catalogAddon.name}" on "${product.name}" is currently inactive.`);
                    }
                    if (!catalogAddon.addon_group_id || !linkedGroupIds.has(catalogAddon.addon_group_id)) {
                        throw new ReleaseHoldError(`Add-on "${catalogAddon.name}" is no longer linked to "${product.name}".`);
                    }
                    const unitCount = Number(item.quantity);
                    const addonQty = Number(addonRow.quantity || 1);
                    const qtyInt = Math.max(1, Math.floor(addonQty));
                    const currentSel = groupSelections.get(catalogAddon.addon_group_id) || {
                        totalQty: 0,
                        hasMultiQty: false,
                    };
                    groupSelections.set(catalogAddon.addon_group_id, {
                        totalQty: currentSel.totalQty + qtyInt,
                        hasMultiQty: currentSel.hasMultiQty || qtyInt > 1,
                    });
                    const requirement = Number((unitCount * addonQty).toFixed(8));
                    if (Number(catalogAddon.track_inventory) === 1 && requirement > 0) {
                        const available = Number(catalogAddon.stock_quantity ?? 0);
                        if (requirement - available > 1e-8) {
                            throw new ReleaseHoldError(`Insufficient stock for add-on "${catalogAddon.name}" (requested ${requirement}, available ${available}).`);
                        }
                        (0, inventory_1.adjustProductStock)(db, {
                            productId: null,
                            addonId: catalogAddon.id,
                            quantityDelta: -requirement,
                            movementType: 'sale',
                            referenceType: 'order_item',
                            referenceId: String(item.id),
                            actorUserId: effectiveActorId,
                            createdAt: nowDb,
                        });
                        updateAddonDepletion.run(requirement, addonRow.id);
                    }
                    else {
                        updateAddonDepletion.run(0, addonRow.id);
                    }
                }
                for (const groupId of linkedGroupIds) {
                    const group = db
                        .prepare('SELECT * FROM addon_groups WHERE id = ? AND is_active = 1')
                        .get(groupId);
                    if (!group)
                        continue;
                    const selection = groupSelections.get(groupId) || { totalQty: 0, hasMultiQty: false };
                    if (!group.allow_multiple_quantities && selection.hasMultiQty) {
                        throw new ReleaseHoldError(`Add-on group "${group.name}" on "${product.name}" no longer allows multiple quantities.`);
                    }
                    if (group.max_selection !== null &&
                        group.max_selection !== undefined &&
                        selection.totalQty > Number(group.max_selection)) {
                        throw new ReleaseHoldError(`Add-on group "${group.name}" on "${product.name}" exceeds maximum allowed (${group.max_selection}).`);
                    }
                    const requiredMin = group.is_required
                        ? Math.max(1, Number(group.min_selection || 1))
                        : Number(group.min_selection || 0);
                    if (requiredMin > 0 && selection.totalQty < requiredMin) {
                        throw new ReleaseHoldError(`Required add-on group "${group.name}" on "${product.name}" needs at least ${requiredMin} selection(s).`);
                    }
                }
                const deduction = (0, inventory_1.resolveInventoryDeduction)(product, Number(item.quantity), variant);
                if (deduction) {
                    if (!deduction.variantId && String(deduction.productId) !== String(product.id)) {
                        const linkedProduct = db
                            .prepare('SELECT id, name, deleted_at, is_active FROM products WHERE id = ?')
                            .get(deduction.productId);
                        if (!linkedProduct || linkedProduct.deleted_at) {
                            throw new ReleaseHoldError(`Linked inventory product for "${product.name}" is unavailable.`);
                        }
                    }
                    (0, inventory_1.adjustProductStock)(db, {
                        productId: deduction.productId,
                        variantId: deduction.variantId ?? null,
                        quantityDelta: -deduction.deductedQuantity,
                        movementType: 'sale',
                        referenceType: 'order_item',
                        referenceId: String(item.id),
                        actorUserId: effectiveActorId,
                        createdAt: nowDb,
                    });
                }
                const recipeSnapshot = (0, recipes_1.buildRecipeSnapshot)(db, product.id, Number(item.quantity), variant?.recipe_multiplier ?? 1);
                if (recipeSnapshot) {
                    for (const component of recipeSnapshot.components) {
                        const supply = db
                            .prepare('SELECT id, name, deleted_at FROM supplies WHERE id = ?')
                            .get(component.supply_id);
                        if (!supply || supply.deleted_at) {
                            throw new ReleaseHoldError(`Recipe supply "${component.supply_name}" for "${product.name}" is unavailable.`);
                        }
                    }
                    (0, recipes_1.applyRecipeSnapshot)(db, recipeSnapshot, {
                        direction: 'deplete',
                        actorUserId: effectiveActorId,
                        referenceId: String(item.id),
                        createdAt: nowDb,
                    });
                }
                const { ingredientCost, ingredientCostKnown } = (0, recipes_1.extractOrderItemCostFromSnapshot)(recipeSnapshot);
                updateItemDepletion.run(deduction ? deduction.deductedQuantity : 0, deduction ? deduction.productId : null, deduction?.variantId ?? null, recipeSnapshot ? JSON.stringify(recipeSnapshot) : null, ingredientCost, ingredientCostKnown, nowDb, item.id);
            }
        });
        try {
            // Checkout-lifecycle orders keep their creation snapshot and are consumed
            // only by settlement or kitchen release. Legacy scheduled orders retain their release-time path.
            if (currentOrder.inventory_lifecycle !== 'checkout_v1') {
                deductAndValidateInSavepoint();
            }
            else {
                if (!effectiveActorId) {
                    throw new ReleaseHoldError('No staff user exists to attribute inventory depletion for this order.');
                }
                const isPaid = Boolean((currentOrder.checkout_stage === 'paid' &&
                    currentOrder.dispatch_policy === 'on_payment') ||
                    db
                        .prepare(`SELECT 1 FROM bills WHERE order_id = ? AND payment_status IN ('paid', 'refunded', 'partially_refunded') LIMIT 1`)
                        .get(currentOrder.id));
                if (isPaid) {
                    (0, checkout_inventory_1.consumeCheckoutInventory)(db, Number(currentOrder.id), effectiveActorId, `release:${currentOrder.id}`);
                }
                else {
                    const validateOnly = db.transaction(() => {
                        (0, checkout_inventory_1.consumeCheckoutInventory)(db, Number(currentOrder.id), effectiveActorId, `validate:${currentOrder.id}`);
                        throw new ValidationRollback();
                    });
                    try {
                        validateOnly();
                    }
                    catch (e) {
                        if (!(e instanceof ValidationRollback)) {
                            throw e;
                        }
                    }
                }
            }
        }
        catch (error) {
            if (!isCatalogOrStockHoldError(error)) {
                throw error;
            }
            const holdReason = error.message || 'Scheduled release blocked due to stock or catalog issue.';
            db.prepare(`UPDATE orders
         SET release_status = 'blocked',
             release_blocked_reason = ?,
             updated_at = ?
         WHERE id = ?`).run(holdReason, nowDb, currentOrder.id);
            if (effectiveActorId) {
                (0, db_1.recordOrderAudit)(db, {
                    orderId: String(currentOrder.id),
                    actorUserId: effectiveActorId,
                    action: 'release_blocked',
                    details: {
                        trigger: options.trigger,
                        initiated_by: options.actorUserId ? 'staff' : 'server_sweep',
                        scheduled_for: currentOrder.scheduled_for,
                        reason: holdReason,
                    },
                });
            }
            const blockedOrder = db
                .prepare('SELECT * FROM orders WHERE id = ?')
                .get(currentOrder.id);
            return {
                outcome: 'blocked',
                reason: holdReason,
                order: blockedOrder,
            };
        }
        const kdsSetting = db.prepare("SELECT value FROM settings WHERE key = 'kds_enabled'").get();
        const kdsEnabled = kdsSetting?.value !== 'false';
        const isSettled = (0, db_1.isOrderSettledAndNonRefunded)(db, currentOrder.id);
        const hasUnservedKitchenItems = kdsEnabled && (0, db_1.hasActiveUnservedOrderItems)(db, currentOrder.id);
        const isDineInWithTable = currentOrder.type === 'dine_in' || Boolean(currentOrder.table_id);
        const shouldCompleteAtRelease = isSettled && !hasUnservedKitchenItems && !isDineInWithTable;
        if (shouldCompleteAtRelease) {
            db.prepare(`UPDATE orders
         SET release_status = 'released',
             released_at = ?,
             release_blocked_reason = NULL,
             status = 'completed',
             completed_at = COALESCE(completed_at, ?),
             updated_at = ?
         WHERE id = ?`).run(nowIso, nowDb, nowDb, currentOrder.id);
        }
        else {
            db.prepare(`UPDATE orders
         SET release_status = 'released',
             released_at = ?,
             release_blocked_reason = NULL,
             status = 'pending',
             updated_at = ?
         WHERE id = ?`).run(nowIso, nowDb, currentOrder.id);
        }
        if (effectiveActorId) {
            (0, db_1.recordOrderAudit)(db, {
                orderId: String(currentOrder.id),
                actorUserId: effectiveActorId,
                action: 'order_released',
                details: {
                    trigger: options.trigger,
                    initiated_by: options.actorUserId ? 'staff' : 'server_sweep',
                    scheduled_for: currentOrder.scheduled_for,
                    released_at: nowIso,
                },
            });
        }
        const releasedOrder = db
            .prepare('SELECT * FROM orders WHERE id = ?')
            .get(currentOrder.id);
        return {
            outcome: 'released',
            order: releasedOrder,
        };
    })();
    let kotAutoPrinted = false;
    if (txResult.outcome === 'released') {
        (0, kds_1.notifyKdsUpdate)();
        cloud_sync_1.cloudSync.recordOrderChanged(String(orderId), 'order.released');
        if (options.autoPrintKot !== false) {
            kotAutoPrinted = await (0, printers_1.autoPrintReleasedOrderKot)(db, orderId);
        }
    }
    else if (txResult.outcome === 'blocked') {
        (0, kds_1.notifyOrderUpdated)();
        cloud_sync_1.cloudSync.recordOrderChanged(String(orderId), 'order.release_blocked');
    }
    return {
        ...txResult,
        kotAutoPrinted,
    };
}
/**
 * Releases all due scheduled orders (`release_status = 'scheduled'` and
 * `scheduled_for <= now`). Orders already in `release_status = 'blocked'` are
 * intentionally excluded and require an explicit staff retry.
 */
async function sweepDueScheduledOrders(db, options) {
    const nowDate = options?.nowDate ?? new Date();
    const nowIso = nowDate.toISOString();
    const trigger = options?.trigger ?? 'sweep';
    const dueRows = db
        .prepare(`SELECT id, scheduled_for
       FROM orders
       WHERE release_status = 'scheduled'
         AND status NOT IN ('cancelled', 'completed')
         AND (
           (scheduled_for IS NOT NULL AND scheduled_for <= ?)
           OR
           (dispatch_policy = 'on_payment' AND checkout_stage = 'paid' AND (scheduled_for IS NULL OR scheduled_for <= ?))
         )
       ORDER BY COALESCE(scheduled_for, created_at) ASC, id ASC`)
        .all(nowIso, nowIso);
    const summary = {
        checkedCount: dueRows.length,
        releasedIds: [],
        blockedIds: [],
        skippedIds: [],
    };
    for (const row of dueRows) {
        try {
            const result = await releaseScheduledOrder(db, row.id, {
                trigger,
                nowDate,
                autoPrintKot: options?.autoPrintKot,
                checkPreconditions: options?.checkPreconditions,
            });
            if (result.outcome === 'released') {
                summary.releasedIds.push(row.id);
            }
            else if (result.outcome === 'blocked') {
                summary.blockedIds.push(row.id);
            }
            else {
                summary.skippedIds.push(row.id);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('shutting down') ||
                message.includes('maintenance') ||
                message.includes('not initialized') ||
                (0, db_1.isDatabaseMaintenanceActive)()) {
                throw err;
            }
            console.error(`[Scheduled Orders] Unexpected sweep release error for order ${row.id} (${trigger}):`, err);
            try {
                const orderRow = db
                    .prepare('SELECT id, release_status FROM orders WHERE id = ?')
                    .get(row.id);
                if (orderRow && orderRow.release_status === 'scheduled') {
                    const reason = 'Automatic release failed due to an unexpected error. Staff can retry release manually.';
                    const nowDb = formatSqlUtcTimestamp(nowDate);
                    db.prepare(`UPDATE orders
             SET release_status = 'blocked',
                 release_blocked_reason = ?,
                 updated_at = ?
             WHERE id = ? AND release_status = 'scheduled'`).run(reason, nowDb, row.id);
                    (0, kds_1.notifyOrderUpdated)();
                    cloud_sync_1.cloudSync.recordOrderChanged(String(row.id), 'order.release_blocked');
                    summary.blockedIds.push(row.id);
                }
                else {
                    summary.skippedIds.push(row.id);
                }
            }
            catch (innerErr) {
                console.error(`[Scheduled Orders] Failed to mark order ${row.id} as blocked after sweep failure:`, innerErr);
                summary.skippedIds.push(row.id);
            }
        }
    }
    return summary;
}
let sweepIntervalHandle = null;
let sweepInFlight = null;
async function triggerScheduledOrderSweep(trigger = 'sweep', nowDate) {
    if ((0, db_1.isDatabaseMaintenanceActive)()) {
        return { checkedCount: 0, releasedIds: [], blockedIds: [], skippedIds: [] };
    }
    if (sweepInFlight) {
        if (trigger !== 'resume') {
            return sweepInFlight;
        }
        await sweepInFlight;
    }
    const runPromise = (0, db_1.withDatabaseRequest)(async () => {
        const db = (0, db_1.getDatabase)();
        return sweepDueScheduledOrders(db, { trigger, nowDate });
    }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('shutting down') &&
            !message.includes('maintenance') &&
            !message.includes('not initialized')) {
            console.error(`[Scheduled Orders] ${trigger} sweep failed:`, error);
        }
        return { checkedCount: 0, releasedIds: [], blockedIds: [], skippedIds: [] };
    });
    const trackedPromise = runPromise.finally(() => {
        if (sweepInFlight === trackedPromise) {
            sweepInFlight = null;
        }
    });
    sweepInFlight = trackedPromise;
    return trackedPromise;
}
function startScheduledOrderSweep(intervalMs = exports.SCHEDULED_SWEEP_INTERVAL_MS) {
    stopScheduledOrderSweep();
    void triggerScheduledOrderSweep('startup');
    sweepIntervalHandle = setInterval(() => {
        void triggerScheduledOrderSweep('sweep');
    }, intervalMs);
    sweepIntervalHandle.unref?.();
}
function stopScheduledOrderSweep() {
    if (sweepIntervalHandle) {
        clearInterval(sweepIntervalHandle);
        sweepIntervalHandle = null;
    }
}
function encodeScheduledOrdersCursor(cursor) {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeScheduledOrdersCursor(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
        return null;
    }
    try {
        const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (parsed &&
            typeof parsed === 'object' &&
            typeof parsed.rank === 'number' &&
            typeof parsed.scheduled_for === 'string' &&
            typeof parsed.id === 'number') {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=scheduled-orders.js.map