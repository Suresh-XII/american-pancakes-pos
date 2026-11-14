"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const delivery_service_1 = require("../services/delivery/delivery-service");
const router = (0, express_1.Router)();
const actor = (req) => {
    const authReq = req;
    return String(authReq.user?.userId || authReq.user?.id || 'system');
};
function handleError(res, err) {
    const httpErr = err;
    const status = Number(httpErr?.statusCode || httpErr?.status || 500);
    const message = httpErr?.message || 'Internal server error';
    return res.status(status).json({ error: message });
}
// ─── Platform Configurations ──────────────────────────────────────────────────
router.get('/configs', (0, authorization_1.requireAnyPermission)('settings.view', 'settings.manage'), (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const configs = (0, delivery_service_1.getDeliveryPlatformConfigs)(db);
        res.json(configs);
    }
    catch (err) {
        handleError(res, err);
    }
});
router.get('/configs/:provider', (0, authorization_1.requireAnyPermission)('settings.view', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const provider = String(req.params.provider).toLowerCase();
        const config = (0, delivery_service_1.getDeliveryPlatformConfig)(db, provider);
        if (!config) {
            return res.status(404).json({ error: `Platform config for ${provider} not found` });
        }
        res.json(config);
    }
    catch (err) {
        handleError(res, err);
    }
});
router.put('/configs/:provider', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const provider = String(req.params.provider).toLowerCase();
        const updated = (0, delivery_service_1.updateDeliveryPlatformConfig)(db, provider, req.body, actor(req));
        res.json(updated);
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── External Menu Mappings ──────────────────────────────────────────────────
router.get('/mappings', (0, authorization_1.requireAnyPermission)('catalog.view', 'settings.manage', 'orders.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const provider = req.query.provider ? String(req.query.provider).toLowerCase() : undefined;
        const mappings = (0, delivery_service_1.listDeliveryMenuMappings)(db, provider);
        res.json(mappings);
    }
    catch (err) {
        handleError(res, err);
    }
});
router.post('/mappings', (0, authorization_1.requireAnyPermission)('catalog.manage', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const mapping = (0, delivery_service_1.createDeliveryMenuMapping)(db, req.body, actor(req));
        res.status(201).json(mapping);
    }
    catch (err) {
        handleError(res, err);
    }
});
router.put('/mappings/:id', (0, authorization_1.requireAnyPermission)('catalog.manage', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Valid mapping id is required' });
        }
        const updated = (0, delivery_service_1.updateDeliveryMenuMapping)(db, id, req.body, actor(req));
        res.json(updated);
    }
    catch (err) {
        handleError(res, err);
    }
});
router.delete('/mappings/:id', (0, authorization_1.requireAnyPermission)('catalog.manage', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Valid mapping id is required' });
        }
        (0, delivery_service_1.deleteDeliveryMenuMapping)(db, id, actor(req));
        res.json({ success: true, id });
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── Sandbox Order Simulation ────────────────────────────────────────────────
router.post('/sandbox/simulate-order', (0, authorization_1.requireAnyPermission)('orders.create', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const sandboxAdapter = (0, delivery_service_1.getDeliveryAdapter)('sandbox');
        let normalized;
        // If client supplied already normalized format
        if (req.body.externalOrderId && Array.isArray(req.body.items)) {
            normalized = {
                ...req.body,
                customerName: null,
                customerPhone: null,
                provider: 'sandbox',
                isSimulated: true,
            };
        }
        else {
            // Parse raw sandbox payload
            normalized = sandboxAdapter.parseIncomingOrder(req.body);
            normalized.customerName = null;
            normalized.customerPhone = null;
        }
        const result = (0, delivery_service_1.ingestDeliveryOrder)(db, normalized, actor(req));
        res.status(201).json(result);
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── Webhook Receiver & Management ───────────────────────────────────────────
router.post('/webhooks/:provider', async (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const provider = String(req.params.provider).toLowerCase();
        const result = await (0, delivery_service_1.processDeliveryWebhook)(db, provider, req.headers, req.body);
        res.status(200).json(result);
    }
    catch (err) {
        handleError(res, err);
    }
});
router.get('/webhooks/events', (0, authorization_1.requireAnyPermission)('settings.view', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const provider = req.query.provider ? String(req.query.provider).toLowerCase() : undefined;
        const status = req.query.status ? String(req.query.status) : undefined;
        const limit = req.query.limit ? Number(req.query.limit) : 50;
        const events = (0, delivery_service_1.listDeliveryWebhookEvents)(db, { provider, status, limit });
        res.json(events);
    }
    catch (err) {
        handleError(res, err);
    }
});
router.post('/webhooks/events/:id/retry', (0, authorization_1.requireAnyPermission)('settings.manage', 'orders.create'), async (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Valid webhook event id is required' });
        }
        const result = await (0, delivery_service_1.retryDeliveryWebhookEvent)(db, id, actor(req));
        res.json(result);
    }
    catch (err) {
        handleError(res, err);
    }
});
// ─── Delivery Order Tracking & Status Sync ───────────────────────────────────
router.get('/orders/:orderId/tracking', (0, authorization_1.requirePermission)('orders.read'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const orderId = Number(req.params.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
            return res.status(400).json({ error: 'Valid order id is required' });
        }
        const tracking = (0, delivery_service_1.getDeliveryOrderTracking)(db, orderId);
        if (!tracking) {
            return res.status(404).json({ error: `Tracking for order #${orderId} not found` });
        }
        res.json(tracking);
    }
    catch (err) {
        handleError(res, err);
    }
});
router.post('/orders/:orderId/status', (0, authorization_1.requireAnyPermission)('orders.status.update', 'orders.item.edit'), async (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const orderId = Number(req.params.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
            return res.status(400).json({ error: 'Valid order id is required' });
        }
        const status = req.body?.status;
        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }
        const result = await (0, delivery_service_1.syncDeliveryOrderStatus)(db, orderId, status, actor(req));
        res.json(result);
    }
    catch (err) {
        handleError(res, err);
    }
});
exports.deliveryRoutes = router;
//# sourceMappingURL=delivery.js.map