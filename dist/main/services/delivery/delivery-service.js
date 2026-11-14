"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeliveryAdapter = getDeliveryAdapter;
exports.getDeliveryPlatformConfigs = getDeliveryPlatformConfigs;
exports.getDeliveryPlatformConfig = getDeliveryPlatformConfig;
exports.updateDeliveryPlatformConfig = updateDeliveryPlatformConfig;
exports.listDeliveryMenuMappings = listDeliveryMenuMappings;
exports.createDeliveryMenuMapping = createDeliveryMenuMapping;
exports.updateDeliveryMenuMapping = updateDeliveryMenuMapping;
exports.deleteDeliveryMenuMapping = deleteDeliveryMenuMapping;
exports.resolveExternalMenuItem = resolveExternalMenuItem;
exports.ingestDeliveryOrder = ingestDeliveryOrder;
exports.syncDeliveryOrderStatus = syncDeliveryOrderStatus;
exports.processDeliveryWebhook = processDeliveryWebhook;
exports.retryDeliveryWebhookEvent = retryDeliveryWebhookEvent;
exports.listDeliveryWebhookEvents = listDeliveryWebhookEvents;
exports.getDeliveryOrderTracking = getDeliveryOrderTracking;
const db_1 = require("../../db");
const kds_1 = require("../kds");
const packaging_1 = require("../packaging");
const tax_1 = require("../tax");
const swiggy_adapter_1 = require("./adapters/swiggy-adapter");
const zomato_adapter_1 = require("./adapters/zomato-adapter");
const sandbox_adapter_1 = require("./adapters/sandbox-adapter");
function httpError(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}
const adapters = {
    swiggy: new swiggy_adapter_1.SwiggyAdapter(),
    zomato: new zomato_adapter_1.ZomatoAdapter(),
    sandbox: new sandbox_adapter_1.SandboxAdapter(),
};
function getDeliveryAdapter(provider) {
    const adapter = adapters[provider];
    if (!adapter) {
        throw new Error(`Unsupported delivery provider: ${provider}`);
    }
    return adapter;
}
// ─── 1. Configuration Management ─────────────────────────────────────────────
function getDeliveryPlatformConfigs(db) {
    const rows = db.prepare('SELECT * FROM delivery_platform_configs ORDER BY provider ASC').all();
    return rows.map((r) => ({
        provider: r.provider,
        display_name: r.display_name,
        is_enabled: Boolean(r.is_enabled),
        mode: r.mode,
        api_key_configured: Boolean(r.api_key_configured),
        api_secret_configured: Boolean(r.api_secret_configured),
        merchant_id: r.merchant_id,
        store_id: r.store_id,
        auto_accept_orders: Boolean(r.auto_accept_orders),
        last_sync_at: r.last_sync_at,
        last_error: r.last_error,
        last_error_at: r.last_error_at,
        notes: r.notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }));
}
function getDeliveryPlatformConfig(db, provider) {
    const r = db.prepare('SELECT * FROM delivery_platform_configs WHERE provider = ?').get(provider);
    if (!r)
        return null;
    return {
        provider: r.provider,
        display_name: r.display_name,
        is_enabled: Boolean(r.is_enabled),
        mode: r.mode,
        api_key_configured: Boolean(r.api_key_configured),
        api_secret_configured: Boolean(r.api_secret_configured),
        merchant_id: r.merchant_id,
        store_id: r.store_id,
        auto_accept_orders: Boolean(r.auto_accept_orders),
        last_sync_at: r.last_sync_at,
        last_error: r.last_error,
        last_error_at: r.last_error_at,
        notes: r.notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}
function updateDeliveryPlatformConfig(db, provider, input, _actorUserId) {
    const current = getDeliveryPlatformConfig(db, provider);
    if (!current) {
        throw httpError(`Delivery platform config for ${provider} not found`, 404);
    }
    const adapter = getDeliveryAdapter(provider);
    // STRICT SAFETY GUARD: Live mode cannot be enabled without official approved partner API credentials
    if (input.mode === 'live') {
        if (!adapter.isLiveSupported()) {
            throw httpError(`Live mode cannot be activated for ${adapter.displayName}: official partner API access is pending. Use sandbox mode for integration verification.`, 400);
        }
    }
    const isEnabled = input.is_enabled !== undefined ? (input.is_enabled ? 1 : 0) : (current.is_enabled ? 1 : 0);
    const mode = input.mode !== undefined ? input.mode : current.mode;
    const autoAccept = input.auto_accept_orders !== undefined ? (input.auto_accept_orders ? 1 : 0) : (current.auto_accept_orders ? 1 : 0);
    const merchantId = input.merchant_id !== undefined ? (input.merchant_id ? String(input.merchant_id).trim() : null) : current.merchant_id;
    const storeId = input.store_id !== undefined ? (input.store_id ? String(input.store_id).trim() : null) : current.store_id;
    const notes = input.notes !== undefined ? (input.notes ? String(input.notes).trim() : null) : current.notes;
    db.prepare(`
    UPDATE delivery_platform_configs
    SET is_enabled = ?, mode = ?, auto_accept_orders = ?, merchant_id = ?, store_id = ?, notes = ?, updated_at = ?
    WHERE provider = ?
  `).run(isEnabled, mode, autoAccept, merchantId, storeId, notes, (0, db_1.now)(), provider);
    const updated = getDeliveryPlatformConfig(db, provider);
    if (!updated)
        throw new Error('Failed to retrieve updated delivery platform config');
    return updated;
}
// ─── 2. External Menu Mapping Management ─────────────────────────────────────
function listDeliveryMenuMappings(db, provider) {
    let query = `
    SELECT
      m.id,
      m.provider,
      m.external_item_id,
      m.external_variant_id,
      m.internal_product_id,
      m.internal_variant_id,
      m.external_name,
      m.is_active,
      m.sync_status,
      m.last_synced_at,
      m.created_at,
      m.updated_at,
      p.name AS product_name,
      v.name AS variant_name
    FROM delivery_menu_mappings m
    JOIN products p ON p.id = m.internal_product_id
    LEFT JOIN product_variants v ON v.id = m.internal_variant_id
  `;
    const params = [];
    if (provider) {
        query += ' WHERE m.provider = ?';
        params.push(provider);
    }
    query += ' ORDER BY m.provider ASC, m.external_name ASC';
    const rows = db.prepare(query).all(...params);
    return rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        external_item_id: r.external_item_id,
        external_variant_id: r.external_variant_id,
        internal_product_id: r.internal_product_id,
        internal_variant_id: r.internal_variant_id,
        external_name: r.external_name,
        product_name: r.product_name,
        variant_name: r.variant_name,
        is_active: Boolean(r.is_active),
        sync_status: r.sync_status,
        last_synced_at: r.last_synced_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }));
}
function createDeliveryMenuMapping(db, input, _actorUserId) {
    const provider = input.provider;
    if (!['swiggy', 'zomato', 'sandbox'].includes(provider)) {
        throw httpError('Invalid delivery provider', 400);
    }
    const externalItemId = String(input.external_item_id || '').trim();
    if (!externalItemId) {
        throw httpError('external_item_id is required', 400);
    }
    const externalVariantId = input.external_variant_id ? String(input.external_variant_id).trim() : null;
    const externalName = String(input.external_name || '').trim();
    if (!externalName) {
        throw httpError('external_name is required', 400);
    }
    const internalProductId = String(input.internal_product_id || '').trim();
    if (!internalProductId) {
        throw httpError('internal_product_id is required', 400);
    }
    // Validate internal product exists
    const product = db.prepare('SELECT id, name FROM products WHERE id = ? AND deleted_at IS NULL').get(internalProductId);
    if (!product) {
        throw httpError(`Internal product not found: ${internalProductId}`, 404);
    }
    // Validate internal variant if provided
    const internalVariantId = input.internal_variant_id ? String(input.internal_variant_id).trim() : null;
    if (internalVariantId) {
        const variant = db.prepare('SELECT id, product_id, name FROM product_variants WHERE id = ?').get(internalVariantId);
        if (!variant) {
            throw httpError(`Internal product variant not found: ${internalVariantId}`, 404);
        }
        if (variant.product_id !== internalProductId) {
            throw httpError(`Variant ${internalVariantId} does not belong to product ${internalProductId}`, 400);
        }
    }
    // Check unique mapping constraint
    const clash = db.prepare(`
    SELECT id FROM delivery_menu_mappings
    WHERE provider = ? AND external_item_id = ? AND (external_variant_id = ? OR (external_variant_id IS NULL AND ? IS NULL))
  `).get(provider, externalItemId, externalVariantId, externalVariantId);
    if (clash) {
        throw httpError(`Menu mapping already exists for ${provider} item ${externalItemId}`, 409);
    }
    const isActive = input.is_active !== undefined ? (input.is_active ? 1 : 0) : 1;
    const timestamp = (0, db_1.now)();
    const insert = db.prepare(`
    INSERT INTO delivery_menu_mappings (
      provider, external_item_id, external_variant_id, internal_product_id, internal_variant_id,
      external_name, is_active, sync_status, last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'mapped', ?, ?, ?)
  `).run(provider, externalItemId, externalVariantId, internalProductId, internalVariantId, externalName, isActive, timestamp, timestamp, timestamp);
    const mappings = listDeliveryMenuMappings(db);
    const created = mappings.find((m) => m.id === Number(insert.lastInsertRowid));
    if (!created)
        throw new Error('Failed to create delivery menu mapping');
    return created;
}
function updateDeliveryMenuMapping(db, id, input, _actorUserId) {
    const existing = db.prepare('SELECT * FROM delivery_menu_mappings WHERE id = ?').get(id);
    if (!existing) {
        throw httpError('Delivery menu mapping not found', 404);
    }
    const externalName = input.external_name !== undefined ? String(input.external_name).trim() : existing.external_name;
    const internalProductId = input.internal_product_id !== undefined ? String(input.internal_product_id).trim() : existing.internal_product_id;
    const internalVariantId = input.internal_variant_id !== undefined ? (input.internal_variant_id ? String(input.internal_variant_id).trim() : null) : existing.internal_variant_id;
    const isActive = input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active;
    if (input.internal_product_id) {
        const product = db.prepare('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL').get(internalProductId);
        if (!product) {
            throw httpError(`Internal product not found: ${internalProductId}`, 404);
        }
    }
    if (internalVariantId) {
        const variant = db.prepare('SELECT id, product_id FROM product_variants WHERE id = ?').get(internalVariantId);
        if (!variant || variant.product_id !== internalProductId) {
            throw httpError(`Variant does not match product: ${internalVariantId}`, 400);
        }
    }
    db.prepare(`
    UPDATE delivery_menu_mappings
    SET external_name = ?, internal_product_id = ?, internal_variant_id = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(externalName, internalProductId, internalVariantId, isActive, (0, db_1.now)(), id);
    const mappings = listDeliveryMenuMappings(db);
    const updated = mappings.find((m) => m.id === id);
    if (!updated)
        throw new Error('Failed to update delivery menu mapping');
    return updated;
}
function deleteDeliveryMenuMapping(db, id, _actorUserId) {
    const res = db.prepare('DELETE FROM delivery_menu_mappings WHERE id = ?').run(id);
    if (res.changes === 0) {
        throw httpError('Delivery menu mapping not found', 404);
    }
}
function resolveExternalMenuItem(db, provider, externalItemId, externalVariantId) {
    let mappingRow;
    if (externalVariantId) {
        mappingRow = db.prepare(`
      SELECT * FROM delivery_menu_mappings
      WHERE provider = ? AND external_item_id = ? AND external_variant_id = ? AND is_active = 1
    `).get(provider, externalItemId, externalVariantId);
    }
    if (!mappingRow) {
        mappingRow = db.prepare(`
      SELECT * FROM delivery_menu_mappings
      WHERE provider = ? AND external_item_id = ? AND is_active = 1
    `).get(provider, externalItemId);
    }
    if (!mappingRow) {
        throw httpError(`Unmapped delivery item: external id "${externalItemId}"${externalVariantId ? ` (variant ${externalVariantId})` : ''} on ${provider}. Menu mapping required.`, 400);
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(mappingRow.internal_product_id);
    if (!product || product.is_active === 0) {
        throw httpError(`Mapped product is inactive or deleted: ${mappingRow.internal_product_id}`, 400);
    }
    let variant = null;
    if (mappingRow.internal_variant_id) {
        variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(mappingRow.internal_variant_id) || null;
    }
    return {
        mapping: {
            id: mappingRow.id,
            provider: mappingRow.provider,
            external_item_id: mappingRow.external_item_id,
            external_variant_id: mappingRow.external_variant_id,
            internal_product_id: mappingRow.internal_product_id,
            internal_variant_id: mappingRow.internal_variant_id,
            external_name: mappingRow.external_name,
            is_active: Boolean(mappingRow.is_active),
            sync_status: mappingRow.sync_status,
            last_synced_at: mappingRow.last_synced_at,
            created_at: mappingRow.created_at,
            updated_at: mappingRow.updated_at,
        },
        product,
        variant,
    };
}
// ─── 3. Order Ingestion & POS Lifecycle Integration ──────────────────────────
function ingestDeliveryOrder(db, normalized, actorUserId) {
    const provider = normalized.provider;
    const externalOrderId = String(normalized.externalOrderId || '').trim();
    if (!externalOrderId) {
        throw httpError('externalOrderId is required', 400);
    }
    // 1. Idempotency Check: prevent duplicate external orders
    const existingTracking = db.prepare(`
    SELECT * FROM delivery_order_tracking
    WHERE provider = ? AND external_order_id = ?
  `).get(provider, externalOrderId);
    if (existingTracking) {
        const existingOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(existingTracking.internal_order_id);
        return {
            order: existingOrder,
            tracking: {
                id: existingTracking.id,
                internal_order_id: existingTracking.internal_order_id,
                provider: existingTracking.provider,
                external_order_id: existingTracking.external_order_id,
                is_simulated: Boolean(existingTracking.is_simulated),
                external_status: existingTracking.external_status,
                internal_status: existingTracking.internal_status,
                pickup_code: existingTracking.pickup_code,
                rider_name: existingTracking.rider_name,
                rider_phone: existingTracking.rider_phone,
                estimated_delivery_time: existingTracking.estimated_delivery_time,
                delivery_address: existingTracking.delivery_address,
                raw_details_json: existingTracking.raw_details_json,
                created_at: existingTracking.created_at,
                updated_at: existingTracking.updated_at,
            },
            isDuplicate: true,
        };
    }
    // 2. Validate Platform Config
    const config = getDeliveryPlatformConfig(db, provider);
    if (!config) {
        throw httpError(`Delivery provider config for ${provider} not found`, 400);
    }
    if (!config.is_enabled && provider !== 'sandbox') {
        throw httpError(`Delivery provider ${provider} is currently disabled`, 400);
    }
    if (normalized.items.length === 0) {
        throw httpError('Delivery order contains no items', 400);
    }
    // 3. Resolve Items through Menu Mappings
    const resolvedItems = normalized.items.map((item) => {
        const resolved = resolveExternalMenuItem(db, provider, item.externalItemId, item.externalVariantId);
        const unitPrice = item.unitPrice !== undefined
            ? item.unitPrice
            : (resolved.variant?.online_price || resolved.variant?.price || resolved.product.price);
        return {
            raw: item,
            product: resolved.product,
            variant: resolved.variant,
            quantity: item.quantity,
            unitPrice,
            subtotal: Number((unitPrice * item.quantity).toFixed(2)),
        };
    });
    const timestamp = (0, db_1.now)();
    const adapter = getDeliveryAdapter(provider);
    const isSimulated = config.mode === 'sandbox' || provider === 'sandbox' ? 1 : 0;
    // 4. Create Order Transactionally
    const result = (0, db_1.withTxn)(() => {
        const orderNumber = `DLV-${provider.toUpperCase().slice(0, 3)}-${externalOrderId.slice(-6)}`;
        // Order Totals
        const itemsSubtotal = resolvedItems.reduce((sum, i) => sum + i.subtotal, 0);
        const deliveryCharge = normalized.deliveryCharge || 0;
        const discountAmount = normalized.discountAmount || 0;
        // Check if actorUserId is a valid user in DB; otherwise NULL to respect FOREIGN KEY (user_id) REFERENCES users(id)
        const userRow = actorUserId
            ? db.prepare('SELECT id FROM users WHERE id = ?').get(actorUserId)
            : undefined;
        const effectiveUserId = userRow ? userRow.id : null;
        // Insert Order row
        const orderInsert = db.prepare(`
      INSERT INTO orders (
        order_number, user_id, type, online_platform, external_order_id,
        delivery_address, delivery_note, special_instructions,
        subtotal, delivery_charge, discount_amount, total,
        status, inventory_lifecycle, created_at, updated_at
      ) VALUES (?, ?, 'online', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'checkout_v1', ?, ?)
    `).run(orderNumber, effectiveUserId, adapter.displayName, externalOrderId, normalized.deliveryAddress || null, normalized.deliveryNote || null, normalized.specialInstructions || null, itemsSubtotal, deliveryCharge, discountAmount, itemsSubtotal + deliveryCharge - discountAmount, timestamp, timestamp);
        const orderId = Number(orderInsert.lastInsertRowid);
        let totalPackagingCharge = 0;
        const settings = db.prepare('SELECT key, value FROM settings').all();
        const settingMap = new Map(settings.map((s) => [s.key, s.value]));
        const tenantInfo = {
            country: settingMap.get('country') || '',
            business_type: settingMap.get('business_type') || 'restaurant',
            state_code: settingMap.get('state_code') || '',
            currency: settingMap.get('currency') || 'INR',
            taxes_enabled: settingMap.get('taxes_enabled') === 'true',
        };
        // Insert Order Items and Attach Stage 5 Packaging & Recipe Snapshots
        for (const entry of resolvedItems) {
            const taxProduct = entry.product;
            const taxResult = (0, tax_1.calculateItemTax)(tenantInfo, taxProduct, entry.subtotal, null);
            const itemInsert = db.prepare(`
        INSERT INTO order_items (
          order_id, product_id, variant_id, product_name, product_sku,
          unit_price, quantity, subtotal, tax_amount, tax_breakdown, tax_type,
          discount_amount, total, special_instructions, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'pending', ?, ?)
      `).run(orderId, entry.product.id, entry.variant?.id || null, entry.product.name, entry.product.sku || null, entry.unitPrice, entry.quantity, entry.subtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown), taxResult.tax_type, entry.subtotal + taxResult.tax_amount, entry.raw.specialInstructions || null, timestamp, timestamp);
            const orderItemId = Number(itemInsert.lastInsertRowid);
            // Stage 5 Packaging Integration: Automatically allocate parcel packaging
            const pkgCharge = (0, packaging_1.persistItemServingAndPackaging)({
                db,
                orderItemId,
                itemQuantity: entry.quantity,
                allocations: [{ serving_type: 'parcel', quantity: entry.quantity }],
                actorUserId: actorUserId || 'system',
                productId: entry.product.id,
                variantId: entry.variant?.id || null,
            });
            totalPackagingCharge += pkgCharge;
        }
        // Recompute Order with packaging charge
        const orderTotal = Number((itemsSubtotal + deliveryCharge + totalPackagingCharge - discountAmount).toFixed(2));
        db.prepare(`
      UPDATE orders
      SET packaging_charge = ?, total = ?, updated_at = ?
      WHERE id = ?
    `).run(totalPackagingCharge, orderTotal, timestamp, orderId);
        // Create Tracking record
        db.prepare(`
      INSERT INTO delivery_order_tracking (
        internal_order_id, provider, external_order_id, is_simulated,
        external_status, internal_status, delivery_address, raw_details_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'received', 'pending', ?, ?, ?, ?)
    `).run(orderId, provider, externalOrderId, isSimulated, normalized.deliveryAddress || null, JSON.stringify(normalized.rawPayload || normalized), timestamp, timestamp);
        // Auto-accept if configured
        if (config.auto_accept_orders) {
            db.prepare(`
        UPDATE orders SET status = 'preparing', updated_at = ? WHERE id = ?
      `).run(timestamp, orderId);
            db.prepare(`
        UPDATE delivery_order_tracking
        SET internal_status = 'preparing', external_status = 'accepted', updated_at = ?
        WHERE internal_order_id = ?
      `).run(timestamp, orderId);
        }
        const createdOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        const tracking = db.prepare('SELECT * FROM delivery_order_tracking WHERE internal_order_id = ?').get(orderId);
        return {
            order: createdOrder,
            tracking: {
                id: tracking.id,
                internal_order_id: tracking.internal_order_id,
                provider: tracking.provider,
                external_order_id: tracking.external_order_id,
                is_simulated: Boolean(tracking.is_simulated),
                external_status: tracking.external_status,
                internal_status: tracking.internal_status,
                pickup_code: tracking.pickup_code,
                rider_name: tracking.rider_name,
                rider_phone: tracking.rider_phone,
                estimated_delivery_time: tracking.estimated_delivery_time,
                delivery_address: tracking.delivery_address,
                raw_details_json: tracking.raw_details_json,
                created_at: tracking.created_at,
                updated_at: tracking.updated_at,
            },
            isDuplicate: false,
        };
    });
    // Notify KDS kitchen display
    (0, kds_1.notifyKdsUpdate)();
    return result;
}
// ─── 4. Order Status Synchronization ─────────────────────────────────────────
async function syncDeliveryOrderStatus(db, orderId, targetStatus, _actorUserId) {
    const tracking = db.prepare('SELECT * FROM delivery_order_tracking WHERE internal_order_id = ?').get(orderId);
    if (!tracking) {
        throw httpError(`Order #${orderId} is not a tracked delivery platform order`, 404);
    }
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
        throw httpError(`Order #${orderId} not found`, 404);
    }
    if (['completed', 'cancelled'].includes(order.status)) {
        throw httpError(`Cannot transition delivery order from terminal status "${order.status}"`, 400);
    }
    const adapter = getDeliveryAdapter(tracking.provider);
    // Determine internal and external target statuses
    let internalStatus;
    let externalStatus;
    const validInternalStatuses = ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
    const validExternalStatuses = ['received', 'accepted', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled', 'rejected'];
    if (validInternalStatuses.includes(targetStatus)) {
        internalStatus = targetStatus;
        externalStatus = adapter.mapInternalStatus(internalStatus) || 'preparing';
    }
    else if (validExternalStatuses.includes(targetStatus)) {
        externalStatus = targetStatus;
        internalStatus = adapter.mapExternalStatus(externalStatus);
    }
    else {
        throw httpError(`Invalid status: ${targetStatus}`, 400);
    }
    const timestamp = (0, db_1.now)();
    // Transactionally update POS order and delivery tracking
    (0, db_1.withTxn)(() => {
        db.prepare(`
      UPDATE orders
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(internalStatus, timestamp, orderId);
        db.prepare(`
      UPDATE delivery_order_tracking
      SET internal_status = ?, external_status = ?, updated_at = ?
      WHERE internal_order_id = ?
    `).run(internalStatus, externalStatus, timestamp, orderId);
    });
    // Call adapter to notify external platform
    const externalResult = await adapter.updateOrderStatus(tracking.external_order_id, externalStatus);
    // Notify KDS
    (0, kds_1.notifyKdsUpdate)();
    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const updatedTracking = db.prepare('SELECT * FROM delivery_order_tracking WHERE internal_order_id = ?').get(orderId);
    return {
        order: updatedOrder,
        tracking: {
            id: updatedTracking.id,
            internal_order_id: updatedTracking.internal_order_id,
            provider: updatedTracking.provider,
            external_order_id: updatedTracking.external_order_id,
            is_simulated: Boolean(updatedTracking.is_simulated),
            external_status: updatedTracking.external_status,
            internal_status: updatedTracking.internal_status,
            pickup_code: updatedTracking.pickup_code,
            rider_name: updatedTracking.rider_name,
            rider_phone: updatedTracking.rider_phone,
            estimated_delivery_time: updatedTracking.estimated_delivery_time,
            delivery_address: updatedTracking.delivery_address,
            raw_details_json: updatedTracking.raw_details_json,
            created_at: updatedTracking.created_at,
            updated_at: updatedTracking.updated_at,
        },
        externalResult,
    };
}
// ─── 5. Webhook Processing & Retry Service ───────────────────────────────────
async function processDeliveryWebhook(db, provider, headers, payload) {
    const adapter = getDeliveryAdapter(provider);
    const config = getDeliveryPlatformConfig(db, provider);
    if (!config) {
        throw httpError(`Configuration for ${provider} not found`, 404);
    }
    // Validate signature (safe sandbox validation / adapter hook)
    const validation = adapter.validateWebhookSignature(headers, payload);
    if (!validation.isValid && provider !== 'sandbox') {
        throw httpError(validation.reason || 'Webhook signature verification failed', 401);
    }
    const payloadObj = (payload && typeof payload === 'object' ? payload : {});
    const eventId = String(payloadObj.event_id || payloadObj.eventId || payloadObj.id || `evt-${Date.now()}`);
    const eventType = String(payloadObj.event_type || payloadObj.eventType || payloadObj.type || 'order.created');
    const idempotencyKey = `${provider}:${eventId}:${eventType}`;
    // Check event idempotency
    const existingEvent = db.prepare('SELECT * FROM delivery_webhook_events WHERE idempotency_key = ?').get(idempotencyKey);
    if (existingEvent) {
        return {
            eventId: existingEvent.id,
            status: existingEvent.status,
            message: 'Duplicate webhook event skipped via idempotency',
            orderId: existingEvent.internal_order_id || undefined,
        };
    }
    const timestamp = (0, db_1.now)();
    const insert = db.prepare(`
    INSERT INTO delivery_webhook_events (
      event_id, provider, event_type, idempotency_key, payload_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'received', ?)
  `).run(eventId, provider, eventType, idempotencyKey, JSON.stringify(payload), timestamp);
    const eventRecordId = Number(insert.lastInsertRowid);
    try {
        let internalOrderId = null;
        let externalOrderId = null;
        if (eventType === 'order.created' || eventType === 'order.new') {
            const orderPayload = payloadObj.order || payloadObj.data || payload;
            const normalized = adapter.parseIncomingOrder(orderPayload);
            externalOrderId = normalized.externalOrderId;
            const result = ingestDeliveryOrder(db, normalized, 'webhook');
            internalOrderId = result.order.id;
        }
        else if (eventType === 'order.status_updated' || eventType === 'order.status') {
            externalOrderId = String(payloadObj.external_order_id || payloadObj.order_id || payloadObj.orderId || '');
            const status = String(payloadObj.status || payloadObj.target_status || '');
            const tracking = db.prepare('SELECT internal_order_id FROM delivery_order_tracking WHERE provider = ? AND external_order_id = ?').get(provider, externalOrderId);
            if (tracking) {
                internalOrderId = tracking.internal_order_id;
                await syncDeliveryOrderStatus(db, tracking.internal_order_id, status, 'webhook');
            }
        }
        else if (eventType === 'order.cancelled') {
            externalOrderId = String(payloadObj.external_order_id || payloadObj.order_id || payloadObj.orderId || '');
            const tracking = db.prepare('SELECT internal_order_id FROM delivery_order_tracking WHERE provider = ? AND external_order_id = ?').get(provider, externalOrderId);
            if (tracking) {
                internalOrderId = tracking.internal_order_id;
                await syncDeliveryOrderStatus(db, tracking.internal_order_id, 'cancelled', 'webhook');
            }
        }
        db.prepare(`
      UPDATE delivery_webhook_events
      SET status = 'processed', internal_order_id = ?, external_order_id = ?, processed_at = ?
      WHERE id = ?
    `).run(internalOrderId, externalOrderId, (0, db_1.now)(), eventRecordId);
        return {
            eventId: eventRecordId,
            status: 'processed',
            orderId: internalOrderId || undefined,
        };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Processing failed';
        db.prepare(`
      UPDATE delivery_webhook_events
      SET status = 'failed', last_error = ?, processed_at = ?
      WHERE id = ?
    `).run(errorMsg, (0, db_1.now)(), eventRecordId);
        throw err;
    }
}
async function retryDeliveryWebhookEvent(db, eventId, _actorUserId) {
    const event = db.prepare('SELECT * FROM delivery_webhook_events WHERE id = ?').get(eventId);
    if (!event) {
        throw httpError('Webhook event not found', 404);
    }
    const payload = JSON.parse(event.payload_json);
    const adapter = getDeliveryAdapter(event.provider);
    try {
        let internalOrderId = event.internal_order_id;
        let externalOrderId = event.external_order_id;
        if (event.event_type === 'order.created' || event.event_type === 'order.new') {
            const orderPayload = payload.order || payload.data || payload;
            const normalized = adapter.parseIncomingOrder(orderPayload);
            externalOrderId = normalized.externalOrderId;
            const result = ingestDeliveryOrder(db, normalized, 'manual_retry');
            internalOrderId = result.order.id;
        }
        db.prepare(`
      UPDATE delivery_webhook_events
      SET status = 'processed', last_error = NULL, internal_order_id = ?, external_order_id = ?,
          retry_count = retry_count + 1, processed_at = ?
      WHERE id = ?
    `).run(internalOrderId, externalOrderId, (0, db_1.now)(), eventId);
        const updated = db.prepare('SELECT * FROM delivery_webhook_events WHERE id = ?').get(eventId);
        return {
            success: true,
            event: {
                id: updated.id,
                event_id: updated.event_id,
                provider: updated.provider,
                event_type: updated.event_type,
                idempotency_key: updated.idempotency_key,
                payload_json: updated.payload_json,
                status: updated.status,
                internal_order_id: updated.internal_order_id,
                external_order_id: updated.external_order_id,
                retry_count: updated.retry_count,
                last_error: updated.last_error,
                created_at: updated.created_at,
                processed_at: updated.processed_at,
            },
        };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Retry failed';
        db.prepare(`
      UPDATE delivery_webhook_events
      SET status = 'failed', last_error = ?, retry_count = retry_count + 1, processed_at = ?
      WHERE id = ?
    `).run(errorMsg, (0, db_1.now)(), eventId);
        throw err;
    }
}
function listDeliveryWebhookEvents(db, filters) {
    let query = 'SELECT * FROM delivery_webhook_events';
    const params = [];
    const wheres = [];
    if (filters?.provider) {
        wheres.push('provider = ?');
        params.push(filters.provider);
    }
    if (filters?.status) {
        wheres.push('status = ?');
        params.push(filters.status);
    }
    if (wheres.length > 0) {
        query += ` WHERE ${wheres.join(' AND ')}`;
    }
    query += ' ORDER BY id DESC LIMIT ?';
    params.push(filters?.limit || 50);
    const rows = db.prepare(query).all(...params);
    return rows.map((r) => ({
        id: r.id,
        event_id: r.event_id,
        provider: r.provider,
        event_type: r.event_type,
        idempotency_key: r.idempotency_key,
        payload_json: r.payload_json,
        status: r.status,
        internal_order_id: r.internal_order_id,
        external_order_id: r.external_order_id,
        retry_count: r.retry_count,
        last_error: r.last_error,
        created_at: r.created_at,
        processed_at: r.processed_at,
    }));
}
function getDeliveryOrderTracking(db, orderId) {
    const r = db.prepare('SELECT * FROM delivery_order_tracking WHERE internal_order_id = ?').get(orderId);
    if (!r)
        return null;
    return {
        id: r.id,
        internal_order_id: r.internal_order_id,
        provider: r.provider,
        external_order_id: r.external_order_id,
        is_simulated: Boolean(r.is_simulated),
        external_status: r.external_status,
        internal_status: r.internal_status,
        pickup_code: r.pickup_code,
        rider_name: r.rider_name,
        rider_phone: r.rider_phone,
        estimated_delivery_time: r.estimated_delivery_time,
        delivery_address: r.delivery_address,
        raw_details_json: r.raw_details_json,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}
//# sourceMappingURL=delivery-service.js.map