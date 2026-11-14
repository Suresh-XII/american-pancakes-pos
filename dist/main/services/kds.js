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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_UNAUTHENTICATED_KDS_CLIENTS = exports.MAX_KDS_CLIENTS = exports.KDS_AUTH_TIMEOUT_MS = void 0;
exports.getKdsClientCount = getKdsClientCount;
exports.closeKdsClientForTest = closeKdsClientForTest;
exports.setupKdsWebSocket = setupKdsWebSocket;
exports.buildActiveOrdersSnapshot = buildActiveOrdersSnapshot;
exports.notifyKdsUpdate = notifyKdsUpdate;
exports.notifyOrderUpdated = notifyOrderUpdated;
const ws_1 = require("ws");
const db_1 = require("../db");
const jwt = __importStar(require("jsonwebtoken"));
const jwt_secret_1 = require("../security/jwt-secret");
const auth_1 = require("../routes/auth");
const security_1 = require("../middleware/security");
const role_permissions_1 = require("../../shared/role-permissions");
const authorization_1 = require("./authorization");
const orders_1 = require("./orders");
const cloud_sync_1 = require("./cloud-sync");
exports.KDS_AUTH_TIMEOUT_MS = 5_000;
exports.MAX_KDS_CLIENTS = 100;
exports.MAX_UNAUTHENTICATED_KDS_CLIENTS = 25;
const clients = new Map();
let activeWebSocketServers = 0;
let heartbeat = null;
function clearClientAuthTimeout(client) {
    if (client.authTimeout) {
        clearTimeout(client.authTimeout);
        client.authTimeout = undefined;
    }
}
function clearClientIdentity(client) {
    clearClientAuthTimeout(client);
    client.userId = null;
    client.userName = null;
    client.role = null;
    client.categoryIds = [];
    client.stationIds = [];
    client.stationCategoryIds = [];
    client.stationAssignmentsConfigured = false;
    client.lastExpiredVoidMarker = null;
    client.token = null;
}
function getExpiredVoidMarker() {
    try {
        const cutoff = new Date(Date.now() - db_1.KDS_VOIDED_ITEM_VISIBILITY_MS)
            .toISOString()
            .replace('T', ' ')
            .replace(/\..*$/, '');
        const row = (0, db_1.getDatabase)()
            .prepare(`
      SELECT COUNT(*) AS count, MAX(id) AS max_id
      FROM order_items
      WHERE status = 'voided' AND voided_at IS NOT NULL AND voided_at <= ?
    `)
            .get(cutoff);
        return row.count > 0 ? `${row.count}:${row.max_id ?? ''}` : null;
    }
    catch {
        return null;
    }
}
function closeKdsClient(client, message) {
    clients.delete(client.ws);
    if (message && client.ws.readyState === ws_1.WebSocket.OPEN) {
        try {
            client.ws.send(JSON.stringify({ type: 'auth_error', message }));
        }
        catch { }
    }
    clearClientIdentity(client);
    if (client.ws.readyState === ws_1.WebSocket.OPEN || client.ws.readyState === ws_1.WebSocket.CONNECTING) {
        try {
            client.ws.close(1008, message || 'Session invalid');
        }
        catch { }
    }
}
function getKdsClientCount() {
    return clients.size;
}
function closeKdsClientForTest(ws, message) {
    const client = clients.get(ws);
    if (client)
        closeKdsClient(client, message);
}
function isKdsClientAuthorized(client) {
    if (!(0, db_1.isKdsEnabled)() || !client.userId || !client.token || (0, security_1.isTokenRevoked)(client.token))
        return false;
    try {
        const decoded = jwt.verify(client.token, (0, jwt_secret_1.getJWTSecret)());
        const status = (0, security_1.getUserAuthStatus)(decoded.userId, { fresh: true });
        if (decoded.userId !== client.userId ||
            !status?.isActive ||
            !(0, authorization_1.hasPermission)(decoded.userId, 'kitchen.use') ||
            (0, security_1.isTokenStale)(decoded.iat, status.tokensValidAfter))
            return false;
        const currentUser = (0, db_1.getDatabase)()
            .prepare('SELECT category_ids FROM users WHERE id = ? AND is_active = 1')
            .get(client.userId);
        if (!currentUser)
            return false;
        const nextCategoryIds = (0, role_permissions_1.hasRole)(status.role, role_permissions_1.ROLE_ACCESS.ownerManager)
            ? []
            : (0, auth_1.parseCategoryIds)(currentUser.category_ids);
        const nextStationIds = (0, db_1.getUserKdsStationIds)((0, db_1.getDatabase)(), client.userId);
        const nextStationCategoryIds = nextStationIds
            ? (0, db_1.getKdsStationCategoryIds)((0, db_1.getDatabase)(), nextStationIds)
            : null;
        const nextStationAssignmentsConfigured = (0, db_1.hasUserKdsStationAssignments)((0, db_1.getDatabase)(), client.userId);
        if (!nextStationIds || !nextStationCategoryIds || nextStationAssignmentsConfigured === null)
            return false;
        if (nextStationAssignmentsConfigured && nextStationIds.length === 0)
            return false;
        const roleChanged = client.role !== status.role;
        client.categoryIdsChanged =
            client.categoryIdsChanged ||
                JSON.stringify(client.categoryIds) !== JSON.stringify(nextCategoryIds);
        client.stationIdsChanged =
            client.stationIdsChanged ||
                roleChanged ||
                JSON.stringify(client.stationIds) !== JSON.stringify(nextStationIds) ||
                JSON.stringify(client.stationCategoryIds) !== JSON.stringify(nextStationCategoryIds) ||
                client.stationAssignmentsConfigured !== nextStationAssignmentsConfigured;
        client.role = status.role;
        client.categoryIds = nextCategoryIds;
        client.stationIds = nextStationIds;
        client.stationCategoryIds = nextStationCategoryIds;
        client.stationAssignmentsConfigured = nextStationAssignmentsConfigured;
        return true;
    }
    catch {
        return false;
    }
}
function setupKdsWebSocket(wss) {
    const unregisterMaintenanceListener = (0, db_1.registerDatabaseMaintenanceStartListener)(() => {
        clients.forEach((client) => closeKdsClient(client, 'Database maintenance in progress'));
    });
    wss.once('close', unregisterMaintenanceListener);
    wss.on('connection', (ws, _req) => {
        const unauthenticatedClients = Array.from(clients.values()).filter((client) => !client.userId).length;
        if (clients.size >= exports.MAX_KDS_CLIENTS ||
            unauthenticatedClients >= exports.MAX_UNAUTHENTICATED_KDS_CLIENTS) {
            ws.close(1013, 'KDS connection capacity reached');
            return;
        }
        console.log('[KDS] New client connection');
        const client = {
            ws,
            userId: null,
            userName: null,
            role: null,
            categoryIds: [],
            stationIds: [],
            stationCategoryIds: [],
            stationAssignmentsConfigured: false,
            token: null,
            isAlive: true,
            categoryIdsChanged: false,
            stationIdsChanged: false,
            lastExpiredVoidMarker: null,
        };
        client.authTimeout = setTimeout(() => {
            if (!client.userId) {
                closeKdsClient(client, 'Authentication required');
            }
        }, exports.KDS_AUTH_TIMEOUT_MS);
        client.authTimeout.unref();
        clients.set(ws, client);
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                handleMessage(ws, message);
            }
            catch (error) {
                console.error('[KDS] Message parse error:', error);
            }
        });
        ws.on('close', () => {
            console.log('[KDS] Client disconnected');
            clearClientAuthTimeout(client);
            clients.delete(ws);
        });
        ws.on('error', (error) => {
            console.error('[KDS] Client error:', error);
        });
        ws.on('pong', () => {
            client.isAlive = true;
        });
        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Connected to Flo KDS',
            timestamp: new Date().toISOString(),
        }));
    });
    activeWebSocketServers += 1;
    if (!heartbeat) {
        heartbeat = setInterval(() => {
            // Compute voided-item expiry marker once per tick for all connected clients.
            const sharedExpiredVoidMarker = getExpiredVoidMarker();
            clients.forEach((client, ws) => {
                if ((0, db_1.isDatabaseMaintenanceActive)()) {
                    closeKdsClient(client, 'Database maintenance in progress');
                    return;
                }
                if (!(0, db_1.isKdsEnabled)()) {
                    closeKdsClient(client, 'KDS is disabled');
                    return;
                }
                if (client.userId && !isKdsClientAuthorized(client)) {
                    closeKdsClient(client, 'Session expired or revoked');
                    return;
                }
                const expiredVoidMarker = client.userId ? sharedExpiredVoidMarker : null;
                let snapshotSent = false;
                const permissionRefreshNeeded = client.categoryIdsChanged || client.stationIdsChanged;
                const expiryRefreshNeeded = expiredVoidMarker !== null && expiredVoidMarker !== client.lastExpiredVoidMarker;
                if ((permissionRefreshNeeded || expiryRefreshNeeded) && ws.readyState === ws_1.WebSocket.OPEN) {
                    try {
                        sendActiveOrders(ws, client.categoryIds, client.stationIds, client.role === 'chef' ||
                            client.categoryIds.length > 0 ||
                            client.stationIds.length > 0);
                        client.categoryIdsChanged = false;
                        client.stationIdsChanged = false;
                        client.lastExpiredVoidMarker = expiredVoidMarker;
                        snapshotSent = true;
                    }
                    catch (error) {
                        console.error('[KDS] Category refresh error:', error);
                        closeKdsClient(client, 'Could not refresh KDS permissions');
                        return;
                    }
                }
                if (ws.readyState === ws_1.WebSocket.OPEN) {
                    if (client.isAlive === false) {
                        ws.terminate();
                        clients.delete(ws);
                        return;
                    }
                    if (client.userId && !snapshotSent) {
                        client.lastExpiredVoidMarker = expiredVoidMarker;
                    }
                    client.isAlive = false;
                    ws.ping();
                }
            });
        }, 30000);
        // The HTTP server owns the WebSocket server. Do not keep Electron/test
        // processes alive after that server has closed.
        heartbeat.unref();
    }
    wss.once('close', () => {
        activeWebSocketServers = Math.max(0, activeWebSocketServers - 1);
        if (activeWebSocketServers === 0 && heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
        }
    });
    console.log('[KDS] WebSocket server setup complete');
}
function handleMessage(ws, message) {
    const client = clients.get(ws);
    if (!client)
        return;
    if ((0, db_1.isDatabaseMaintenanceActive)()) {
        closeKdsClient(client, 'Database maintenance in progress');
        return;
    }
    if (!client.userId && message.type !== 'auth') {
        closeKdsClient(client, 'Authentication required');
        return;
    }
    switch (message.type) {
        case 'auth':
            handleAuth(ws, client, message);
            break;
        case 'status_update':
            handleStatusUpdate(client, message);
            break;
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;
        default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
}
function handleAuth(ws, client, message) {
    const { token } = message;
    if (!(0, db_1.isKdsEnabled)()) {
        closeKdsClient(client, 'KDS is disabled');
        return;
    }
    // JWT-only authentication — plaintext password auth removed for security
    if (!token || (0, security_1.isTokenRevoked)(token)) {
        closeKdsClient(client, 'Invalid or revoked token');
        return;
    }
    try {
        const decoded = jwt.verify(token, (0, jwt_secret_1.getJWTSecret)());
        const db = (0, db_1.getDatabase)();
        const user = db
            .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
            .get(decoded.userId);
        if (!user) {
            closeKdsClient(client, 'User not found');
            return;
        }
        if ((0, security_1.isTokenStale)(decoded.iat, user.tokens_valid_after)) {
            closeKdsClient(client, 'Invalid or revoked token');
            return;
        }
        if (!(0, authorization_1.hasPermission)(user.id, 'kitchen.use')) {
            closeKdsClient(client, 'Only kitchen staff can access KDS');
            return;
        }
        const categoryIds = (0, role_permissions_1.hasRole)(user.role, role_permissions_1.ROLE_ACCESS.ownerManager)
            ? []
            : (0, auth_1.parseCategoryIds)(user.category_ids);
        const stationIds = (0, db_1.getUserKdsStationIds)((0, db_1.getDatabase)(), user.id);
        const stationAssignmentsConfigured = (0, db_1.hasUserKdsStationAssignments)((0, db_1.getDatabase)(), user.id);
        if (!stationIds || stationAssignmentsConfigured === null)
            throw new Error('Could not load station permissions');
        if (stationAssignmentsConfigured && stationIds.length === 0) {
            throw new Error('No active kitchen station is assigned to this user');
        }
        client.userId = user.id;
        client.userName = user.name;
        client.role = user.role;
        client.categoryIds = categoryIds;
        client.stationIds = stationIds;
        client.stationAssignmentsConfigured = stationAssignmentsConfigured;
        client.categoryIdsChanged = false;
        client.stationIdsChanged = false;
        client.stationCategoryIds = (0, db_1.getKdsStationCategoryIds)((0, db_1.getDatabase)(), stationIds) || [];
        client.token = token;
        clearClientAuthTimeout(client);
        ws.send(JSON.stringify({
            type: 'auth_success',
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                categoryIds: categoryIds,
                stationIds: stationIds,
            },
        }));
        sendActiveOrders(ws, client.categoryIds, client.stationIds, client.role === 'chef' || client.categoryIds.length > 0 || client.stationIds.length > 0);
        client.lastExpiredVoidMarker = getExpiredVoidMarker();
    }
    catch (error) {
        const message = error instanceof Error && /station|permission/i.test(error.message)
            ? error.message
            : 'Invalid token';
        closeKdsClient(client, message);
    }
}
function handleStatusUpdate(client, message) {
    if (!(0, db_1.isKdsEnabled)()) {
        closeKdsClient(client, 'KDS is disabled');
        return;
    }
    if (!isKdsClientAuthorized(client)) {
        closeKdsClient(client, 'Session expired or revoked');
        return;
    }
    if (!client.userId || !(0, authorization_1.hasPermission)(client.userId, 'kitchen.status.update')) {
        client.ws.send(JSON.stringify({ type: 'error', message: 'Insufficient permissions' }));
        return;
    }
    const actorUserId = client.userId;
    const { order_item_id, status, expected_status: expectedStatus } = message;
    if (!order_item_id || !status) {
        client.ws.send(JSON.stringify({ type: 'error', message: 'order_item_id and status required' }));
        return;
    }
    // Validate status against allowed values
    const validStatuses = ['pending', 'preparing', 'ready', 'served'];
    if (!validStatuses.includes(status)) {
        client.ws.send(JSON.stringify({
            type: 'error',
            message: `Invalid status. Use: ${validStatuses.join(', ')}`,
        }));
        return;
    }
    if (expectedStatus !== undefined && !validStatuses.includes(expectedStatus)) {
        client.ws.send(JSON.stringify({
            type: 'error',
            message: `Invalid expected status. Use: ${validStatuses.join(', ')}`,
        }));
        return;
    }
    try {
        const db = (0, db_1.getDatabase)();
        let autoCompletedOrderId = null;
        const result = (0, db_1.withTxn)(() => {
            const existingItem = db
                .prepare(`
        SELECT oi.*, p.category_id
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.id = ?
      `)
                .get(order_item_id);
            if (!existingItem) {
                return { error: 'Item not found' };
            }
            if (existingItem.status === 'voided') {
                return { error: 'This item has been voided and can no longer be updated' };
            }
            if (existingItem.status === 'void_adjustment') {
                return { error: 'This bill adjustment cannot be updated from KDS' };
            }
            if (existingItem.status === 'completed' ||
                existingItem.status === 'cancelled' ||
                existingItem.status === 'refunded') {
                return { error: 'This terminal item cannot be updated from KDS' };
            }
            const parentOrderState = (0, db_1.getKdsItemParentOrderState)(db, existingItem.order_id);
            if (parentOrderState === 'missing') {
                return { error: 'Order item is not attached to an order' };
            }
            if (parentOrderState === 'unreleased') {
                return { error: db_1.UNRELEASED_KDS_ORDER_ITEM_ERROR };
            }
            if (client.stationIds.length > 0) {
                const station = db
                    .prepare(`
          SELECT t.kitchen_station_id
          FROM orders o LEFT JOIN tables t ON t.id = o.table_id
          WHERE o.id = ?
        `)
                    .get(existingItem.order_id);
                const stationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, client.stationIds);
                const stationScope = (0, db_1.getKdsStationRoutingScope)(db, client.stationIds, client.categoryIds);
                const stationRoutingCategoryIds = stationScope?.tablelessCategoryIds;
                if (!stationCategoryIds ||
                    !stationScope ||
                    !stationRoutingCategoryIds ||
                    !(0, db_1.isKdsStationItemAllowed)(client.stationIds, stationRoutingCategoryIds, station?.kitchen_station_id, existingItem.category_id, station?.kitchen_station_id
                        ? stationScope.categoryIdsByStation[String(station?.kitchen_station_id)]
                        : undefined, stationScope.hasUnrestrictedStation)) {
                    return { error: 'Not authorized to update this station' };
                }
            }
            if (client.categoryIds.length > 0 && !client.categoryIds.includes(existingItem.category_id)) {
                return { error: 'Not authorized to update this item' };
            }
            const updatedAt = (0, db_1.now)();
            const updateResult = expectedStatus === undefined
                ? db
                    .prepare("UPDATE order_items SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('voided', 'void_adjustment', 'completed', 'cancelled', 'refunded')")
                    .run(status, updatedAt, order_item_id)
                : db
                    .prepare('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
                    .run(status, updatedAt, order_item_id, expectedStatus);
            if (updateResult.changes !== 1) {
                return { error: 'Item status changed; refresh and try again' };
            }
            const reconcile = (0, orders_1.reconcileActiveOrderStatusFromItems)(db, existingItem.order_id, actorUserId);
            if (status === 'served' &&
                (0, db_1.completeSettledReleasedOrderIfServed)(db, existingItem.order_id, updatedAt)) {
                autoCompletedOrderId = String(existingItem.order_id);
            }
            return {
                success: true,
                reconciledEvent: reconcile.changed && reconcile.status
                    ? { orderId: String(existingItem.order_id), status: reconcile.status }
                    : null,
            };
        });
        if (result.error) {
            client.ws.send(JSON.stringify({ type: 'error', message: result.error }));
            return;
        }
        if (result.reconciledEvent) {
            try {
                cloud_sync_1.cloudSync.recordOrderChanged(result.reconciledEvent.orderId, `order.${result.reconciledEvent.status}`);
            }
            catch { }
        }
        broadcastOrderUpdate();
        if (autoCompletedOrderId) {
            cloud_sync_1.cloudSync.recordOrderChanged(autoCompletedOrderId, 'order.completed');
        }
        client.ws.send(JSON.stringify({
            type: 'status_updated',
            order_item_id,
            status,
        }));
    }
    catch (error) {
        console.error('[KDS] Status update error:', error);
        client.ws.send(JSON.stringify({
            type: 'error',
            message: error?.statusCode === 409 ? error.message : 'Could not update item status',
        }));
    }
}
/** Returns SQL condition for orders needing kitchen attention or unserved items. */
function activeOrdersCondition() {
    if (!(0, db_1.isKdsEnabled)())
        return `o.release_status = 'released' AND o.status NOT IN ('completed', 'cancelled')`;
    // Fast indexed CTE query matching active orders or unserved items.
    return `o.id IN (${db_1.ACTIVE_RELEASED_KDS_ORDER_IDS_SQL})`;
}
function sendActiveOrders(ws, categoryIds, stationIds = [], restrictedPayload = categoryIds.length > 0) {
    sendSerializedSnapshot(ws, buildActiveOrdersSnapshot(categoryIds, stationIds, restrictedPayload));
}
function sendSerializedSnapshot(ws, serialized) {
    if (ws.bufferedAmount > 1_000_000) {
        ws.close(1013, 'KDS client is too slow');
        return;
    }
    ws.send(serialized);
}
/** Queries and serializes the snapshot for one filter signature; identical for every client sharing it. */
function buildActiveOrdersSnapshot(categoryIds, stationIds = [], restrictedPayload = categoryIds.length > 0) {
    const db = (0, db_1.getDatabase)();
    const stationCategoryIds = (0, db_1.getKdsStationCategoryIds)(db, stationIds);
    const stationScope = (0, db_1.getKdsStationRoutingScope)(db, stationIds, categoryIds);
    const stationRoutingCategoryIds = stationScope?.tablelessCategoryIds;
    if (!stationCategoryIds || !stationScope || !stationRoutingCategoryIds)
        throw new Error('Could not load station permissions');
    let query = `
    SELECT o.*, t.number as table_name, t.kitchen_station_id
    FROM orders o
    LEFT JOIN tables t ON o.table_id = t.id
    WHERE ${activeOrdersCondition()}
  `;
    const orderParams = [];
    if (stationIds.length > 0) {
        const stationPlaceholders = stationIds.map(() => '?').join(',');
        const categoryRoute = stationRoutingCategoryIds.length > 0
            ? ` OR EXISTS (SELECT 1 FROM order_items routed_oi JOIN products routed_p ON routed_p.id = routed_oi.product_id WHERE routed_oi.order_id = o.id AND t.kitchen_station_id IS NULL AND routed_p.category_id IN (${stationRoutingCategoryIds.map(() => '?').join(',')}))`
            : '';
        query += ` AND (t.kitchen_station_id IN (${stationPlaceholders})${categoryRoute}${stationScope.hasUnrestrictedStation ? ' OR t.kitchen_station_id IS NULL' : ''})`;
        orderParams.push(...stationIds, ...stationRoutingCategoryIds);
    }
    query += ' ORDER BY o.created_at ASC';
    const orders = db.prepare(query).all(...orderParams);
    // Pre-fetch allowed product IDs once if category restrictions apply to eliminate N+1 queries
    let allowedProductIds = null;
    if (categoryIds.length > 0) {
        const productRows = db
            .prepare(`
      SELECT id FROM products WHERE category_id IN (${categoryIds.map(() => '?').join(',')})
    `)
            .all(...categoryIds);
        allowedProductIds = new Set(productRows.map((p) => p.id));
    }
    // Filter and attach items — one batched items query and one addons pass
    // per broadcast instead of N+1 per order (this runs on every KDS update).
    const orderIds = orders.map((o) => o.id);
    const itemsByOrder = {};
    if (orderIds.length > 0) {
        const placeholders = orderIds.map(() => '?').join(',');
        const rawItems = db
            .prepare(`
      SELECT oi.*, p.category_id
      FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id IN (${placeholders}) ORDER BY oi.order_id, oi.id
    `)
            .all(...orderIds);
        for (const item of rawItems) {
            if (!itemsByOrder[item.order_id])
                itemsByOrder[item.order_id] = [];
            itemsByOrder[item.order_id].push(item);
        }
    }
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const allVisibleItems = orders
        .flatMap((o) => itemsByOrder[o.id] || [])
        .filter((i) => i.status !== 'void_adjustment' &&
        !['completed', 'cancelled', 'refunded'].includes(i.status) &&
        (i.status !== 'voided' || (0, db_1.isVoidedItemKdsVisible)(i.voided_at)) &&
        (0, db_1.isKdsStationItemAllowed)(stationIds, stationRoutingCategoryIds, orderById.get(i.order_id)?.kitchen_station_id, i.category_id, orderById.get(i.order_id)?.kitchen_station_id
            ? stationScope.categoryIdsByStation[String(orderById.get(i.order_id)?.kitchen_station_id)]
            : undefined, stationScope.hasUnrestrictedStation));
    const itemsWithAddons = (0, db_1.attachEffectiveAddons)(db, allVisibleItems.map(db_1.parseItemJson));
    const addonsByItemId = new Map(itemsWithAddons.map((it) => [it.id, it]));
    const ordersWithItems = orders
        .map((order) => {
        // #150: hide the void reversal line (bill adjustment, not a kitchen
        // item) and age voided items off the board after their grace period.
        const visibleItems = (itemsByOrder[order.id] || [])
            .filter((i) => i.status !== 'void_adjustment' &&
            !['completed', 'cancelled', 'refunded'].includes(i.status) &&
            (i.status !== 'voided' || (0, db_1.isVoidedItemKdsVisible)(i.voided_at)) &&
            (0, db_1.isKdsStationItemAllowed)(stationIds, stationRoutingCategoryIds, order.kitchen_station_id, i.category_id, order.kitchen_station_id
                ? stationScope.categoryIdsByStation[String(order.kitchen_station_id)]
                : undefined, stationScope.hasUnrestrictedStation))
            .map((i) => addonsByItemId.get(i.id) || i);
        // Filter items by category if user has category restrictions
        let items = visibleItems;
        if (allowedProductIds) {
            items = items.filter((item) => allowedProductIds.has(item.product_id));
        }
        items = items.map((item) => (0, db_1.projectKdsItem)(item, restrictedPayload));
        // Normalize: frontend expects table.name, query aliases the join as table_name.
        const table = order.table_name ? { name: order.table_name } : null;
        return { ...(0, db_1.projectKdsOrder)(order, restrictedPayload), items, table };
    })
        .filter((order) => order.items.length > 0);
    // Get counts (filtered by category)
    const voidedCutoff = new Date(Date.now() - db_1.KDS_VOIDED_ITEM_VISIBILITY_MS)
        .toISOString()
        .replace('T', ' ')
        .replace(/\..*$/, '');
    let countsQuery = `
    SELECT oi.status, COUNT(*) as count
    FROM order_items oi
    LEFT JOIN products p ON oi.product_id = p.id
    JOIN orders o ON oi.order_id = o.id
    LEFT JOIN tables t ON o.table_id = t.id
    WHERE ${activeOrdersCondition()}
      AND oi.status NOT IN ('completed', 'cancelled', 'void_adjustment', 'refunded')
      AND (oi.status != 'voided' OR oi.voided_at IS NULL OR oi.voided_at > ?)
  `;
    const countParams = [voidedCutoff];
    if (stationIds.length > 0) {
        const stationRoutes = [];
        for (const stationId of stationIds) {
            const allowedCategoryIds = stationScope.categoryIdsByStation[String(stationId)];
            if (allowedCategoryIds === null) {
                stationRoutes.push('t.kitchen_station_id = ?');
                countParams.push(stationId);
            }
            else if (allowedCategoryIds.length > 0) {
                stationRoutes.push(`(t.kitchen_station_id = ? AND p.category_id IN (${allowedCategoryIds.map(() => '?').join(',')}))`);
                countParams.push(stationId, ...allowedCategoryIds);
            }
        }
        if (stationRoutingCategoryIds.length > 0) {
            stationRoutes.push(`(t.kitchen_station_id IS NULL AND p.category_id IN (${stationRoutingCategoryIds.map(() => '?').join(',')}))`);
            countParams.push(...stationRoutingCategoryIds);
        }
        if (stationScope.hasUnrestrictedStation)
            stationRoutes.push('t.kitchen_station_id IS NULL');
        countsQuery += ` AND (${stationRoutes.length > 0 ? stationRoutes.join(' OR ') : '0'})`;
    }
    if (categoryIds.length > 0) {
        countsQuery += ` AND p.category_id IN (${categoryIds.map(() => '?').join(',')})`;
        countParams.push(...categoryIds);
    }
    countsQuery += ' GROUP BY oi.status';
    const counts = db.prepare(countsQuery).all(...countParams);
    const countMap = {};
    counts.forEach((c) => {
        countMap[c.status] = c.count;
    });
    return JSON.stringify({
        type: 'initial_data',
        orders: ordersWithItems,
        counts: countMap,
    });
}
let broadcastQueued = false;
function broadcastOrderUpdate() {
    if ((0, db_1.isDatabaseMaintenanceActive)())
        return;
    if (!(0, db_1.isKdsEnabled)()) {
        clients.forEach((client) => closeKdsClient(client, 'KDS is disabled'));
        return;
    }
    // The voided-item expiry marker is global, not per-client — compute it once
    // and share it across every client in this broadcast.
    const sharedExpiredVoidMarker = getExpiredVoidMarker();
    // Clients sharing a filter signature receive the same snapshot: query and
    // serialize once per signature, then fan the string out.
    const groups = new Map();
    clients.forEach((client) => {
        if (client.ws.readyState !== ws_1.WebSocket.OPEN) {
            clients.delete(client.ws);
            clearClientAuthTimeout(client);
            return;
        }
        // A socket still inside its connect-to-auth window is not a revoked
        // session — its lifecycle belongs to the KDS_AUTH_TIMEOUT_MS timer, the
        // same way the heartbeat below treats it. Skip it before building any
        // snapshot so no order snapshot can reach an unauthenticated socket.
        if (!client.userId) {
            return;
        }
        if (!isKdsClientAuthorized(client)) {
            closeKdsClient(client, 'Session expired or revoked');
            return;
        }
        const signature = kdsFilterSignature(client);
        const group = groups.get(signature);
        if (group)
            group.push(client);
        else
            groups.set(signature, [client]);
    });
    for (const group of groups.values()) {
        const [first] = group;
        try {
            const serialized = buildActiveOrdersSnapshot(first.categoryIds, first.stationIds, kdsRestrictedPayload(first));
            for (const client of group) {
                try {
                    sendSerializedSnapshot(client.ws, serialized);
                    client.categoryIdsChanged = false;
                    client.stationIdsChanged = false;
                    client.lastExpiredVoidMarker = sharedExpiredVoidMarker;
                }
                catch (err) {
                    console.error('[KDS] Broadcast error for client:', err);
                }
            }
        }
        catch (err) {
            console.error('[KDS] Broadcast error for client group:', err);
        }
    }
}
function kdsRestrictedPayload(client) {
    return client.role === 'chef' || client.categoryIds.length > 0 || client.stationIds.length > 0;
}
function kdsFilterSignature(client) {
    return JSON.stringify([
        [...client.categoryIds].sort(),
        [...client.stationIds].sort(),
        kdsRestrictedPayload(client),
    ]);
}
function notifyKdsUpdate() {
    if (broadcastQueued)
        return;
    broadcastQueued = true;
    queueMicrotask(() => {
        broadcastQueued = false;
        broadcastOrderUpdate();
    });
}
function notifyOrderUpdated() {
    notifyKdsUpdate();
}
//# sourceMappingURL=kds.js.map