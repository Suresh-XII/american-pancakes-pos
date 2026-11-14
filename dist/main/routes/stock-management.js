"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockManagementRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const stock_management_1 = require("../services/stock-management");
exports.stockManagementRoutes = (0, express_1.Router)();
function actorId(req) {
    return String(req.user?.userId || '');
}
function sendError(res, error) {
    const status = error instanceof stock_management_1.StockManagementError ? error.statusCode : 500;
    if (status >= 500)
        console.error('[stock-management]', error);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : error.message });
}
exports.stockManagementRoutes.use((0, authorization_1.requirePermission)('supplies.manage'));
exports.stockManagementRoutes.get('/dashboard', (_req, res) => {
    try {
        res.json((0, stock_management_1.stockDashboard)((0, db_1.getDatabase)()));
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.get('/suppliers', (req, res) => {
    try {
        res.json({ suppliers: (0, stock_management_1.listSuppliers)((0, db_1.getDatabase)(), req.query.include_inactive === 'true') });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/suppliers', (req, res) => {
    try {
        res.status(201).json({ supplier: (0, stock_management_1.createSupplier)((0, db_1.getDatabase)(), req.body || {}) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.put('/suppliers/:id', (req, res) => {
    try {
        res.json({ supplier: (0, stock_management_1.updateSupplier)((0, db_1.getDatabase)(), String(req.params.id), req.body || {}) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/suppliers/:id/deactivate', (req, res) => {
    try {
        res.json({ supplier: (0, stock_management_1.updateSupplier)((0, db_1.getDatabase)(), String(req.params.id), { ...(req.body || {}), isActive: false }) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.delete('/suppliers/:id', (req, res) => {
    try {
        (0, stock_management_1.deleteSupplier)((0, db_1.getDatabase)(), String(req.params.id));
        res.json({ success: true });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.get('/purchases', (_req, res) => {
    try {
        res.json({ purchases: (0, stock_management_1.listPurchases)((0, db_1.getDatabase)()) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.get('/purchases/:id', (req, res) => {
    try {
        res.json({ purchase: (0, stock_management_1.getPurchase)((0, db_1.getDatabase)(), String(req.params.id)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/purchases', (req, res) => {
    try {
        res.status(201).json({ purchase: (0, stock_management_1.createPurchase)((0, db_1.getDatabase)(), { ...(req.body || {}), actorUserId: actorId(req) }) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/purchases/:id/review', (req, res) => {
    try {
        res.json({ purchase: (0, stock_management_1.reviewPurchase)((0, db_1.getDatabase)(), String(req.params.id), actorId(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/purchases/:id/receive', (req, res) => {
    try {
        res.json({ purchase: (0, stock_management_1.receivePurchase)((0, db_1.getDatabase)(), String(req.params.id), actorId(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.put('/purchases/:id', (req, res) => {
    try {
        res.json({
            purchase: (0, stock_management_1.updatePurchase)((0, db_1.getDatabase)(), String(req.params.id), {
                ...(req.body || {}),
                actorUserId: actorId(req),
            }),
        });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.get('/stock-counts', (_req, res) => {
    try {
        res.json({ counts: (0, stock_management_1.listStockCounts)((0, db_1.getDatabase)()) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/stock-counts', (req, res) => {
    try {
        res.status(201).json({ count: (0, stock_management_1.startStockCount)((0, db_1.getDatabase)(), actorId(req), req.body?.notes) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.get('/stock-counts/:id', (req, res) => {
    try {
        res.json({ count: (0, stock_management_1.getStockCount)((0, db_1.getDatabase)(), String(req.params.id)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.put('/stock-counts/:id', (req, res) => {
    try {
        res.json({ count: (0, stock_management_1.saveStockCount)((0, db_1.getDatabase)(), String(req.params.id), req.body?.items || []) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/stock-counts/:id/review', (req, res) => {
    try {
        res.json({ count: (0, stock_management_1.reviewStockCount)((0, db_1.getDatabase)(), String(req.params.id), actorId(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/stock-counts/:id/post', (req, res) => {
    try {
        res.json({ count: (0, stock_management_1.postStockCount)((0, db_1.getDatabase)(), String(req.params.id), actorId(req)) });
    }
    catch (error) {
        sendError(res, error);
    }
});
exports.stockManagementRoutes.post('/wastage', (req, res) => {
    try {
        res.status(201).json({ wastage: (0, stock_management_1.recordWastage)((0, db_1.getDatabase)(), { ...(req.body || {}), actorUserId: actorId(req) }) });
    }
    catch (error) {
        sendError(res, error);
    }
});
//# sourceMappingURL=stock-management.js.map