"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packagingRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const packaging_1 = require("../services/packaging");
const router = (0, express_1.Router)();
const actor = (req) => String(req.user?.userId || '');
function bad(res, message, status = 400) {
    return res.status(status).json({ error: message });
}
function handleRouteError(res, err, fallbackMessage, defaultStatus = 400) {
    const error = err;
    return bad(res, error?.message || fallbackMessage, error?.statusCode || defaultStatus);
}
// --- Dashboard ---
router.get('/dashboard', (0, authorization_1.requireAnyPermission)('inventory.view', 'settings.manage', 'dashboard.view'), (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const data = (0, packaging_1.getPackagingDashboard)(db);
        res.json(data);
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to get packaging dashboard', 500);
    }
});
// --- Packaging Materials ---
router.get('/materials', (0, authorization_1.requireAnyPermission)('inventory.view', 'supplies.manage', 'settings.manage', 'pos.use'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const filters = {
            search: typeof req.query.search === 'string' ? req.query.search : undefined,
            category: typeof req.query.category === 'string' ? req.query.category : undefined,
            lowStockOnly: req.query.low_stock_only === 'true',
            includeInactive: req.query.include_inactive === 'true',
        };
        const materials = (0, packaging_1.listPackagingMaterials)(db, filters);
        res.json({ materials });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to list packaging materials', 500);
    }
});
router.get('/materials/:id', (0, authorization_1.requireAnyPermission)('inventory.view', 'supplies.manage', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const material = (0, packaging_1.getPackagingMaterial)(db, String(req.params.id));
        if (!material)
            return bad(res, 'Packaging material not found', 404);
        res.json({ material });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to get packaging material', 500);
    }
});
router.post('/materials', (0, authorization_1.requireAnyPermission)('supplies.manage', 'inventory.manage', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const material = (0, packaging_1.createPackagingMaterial)(db, req.body || {}, actor(req));
        res.status(201).json({ material });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to create packaging material', 400);
    }
});
router.put('/materials/:id', (0, authorization_1.requireAnyPermission)('supplies.manage', 'inventory.manage', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const material = (0, packaging_1.updatePackagingMaterial)(db, String(req.params.id), req.body || {}, actor(req));
        res.json({ material });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to update packaging material', 400);
    }
});
router.delete('/materials/:id', (0, authorization_1.requireAnyPermission)('supplies.manage', 'inventory.manage', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        (0, packaging_1.deletePackagingMaterial)(db, String(req.params.id), actor(req));
        res.json({ success: true });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to delete packaging material', 400);
    }
});
router.get('/materials/:id/movements', (0, authorization_1.requireAnyPermission)('inventory.view', 'supplies.manage', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
        const result = (0, packaging_1.getPackagingMaterialMovements)(db, String(req.params.id), limit);
        res.json(result);
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to get material movements', 500);
    }
});
// --- Packaging Profiles ---
router.get('/profiles', (0, authorization_1.requireAnyPermission)('pos.use', 'orders.create', 'settings.manage', 'inventory.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const activeOnly = req.query.active_only === 'true';
        const profiles = (0, packaging_1.listPackagingProfiles)(db, { activeOnly });
        res.json({ profiles });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to list packaging profiles', 500);
    }
});
router.get('/profiles/:id', (0, authorization_1.requireAnyPermission)('pos.use', 'orders.create', 'settings.manage', 'inventory.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const profile = (0, packaging_1.getPackagingProfile)(db, String(req.params.id));
        if (!profile)
            return bad(res, 'Packaging profile not found', 404);
        res.json({ profile });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to get packaging profile', 500);
    }
});
router.post('/profiles', (0, authorization_1.requireAnyPermission)('settings.manage', 'supplies.manage', 'inventory.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const profile = (0, packaging_1.createPackagingProfile)(db, req.body || {}, actor(req));
        res.status(201).json({ profile });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to create packaging profile', 400);
    }
});
router.put('/profiles/:id', (0, authorization_1.requireAnyPermission)('settings.manage', 'supplies.manage', 'inventory.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const profile = (0, packaging_1.updatePackagingProfile)(db, String(req.params.id), req.body || {}, actor(req));
        res.json({ profile });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to update packaging profile', 400);
    }
});
router.post('/profiles/:id/duplicate', (0, authorization_1.requireAnyPermission)('settings.manage', 'supplies.manage', 'inventory.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const profile = (0, packaging_1.duplicatePackagingProfile)(db, String(req.params.id), actor(req));
        res.status(201).json({ profile });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to duplicate packaging profile', 400);
    }
});
router.delete('/profiles/:id', (0, authorization_1.requireAnyPermission)('settings.manage', 'supplies.manage', 'inventory.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        (0, packaging_1.deletePackagingProfile)(db, String(req.params.id), actor(req));
        res.json({ success: true });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to delete packaging profile', 400);
    }
});
// --- Product and Variant Assignments ---
router.get('/assignments', (0, authorization_1.requireAnyPermission)('catalog.manage', 'settings.manage', 'inventory.view', 'pos.use'), (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const products = (0, packaging_1.getProductPackagingAssignments)(db);
        res.json({ products });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to get packaging assignments', 500);
    }
});
const handleProductAssignment = (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const product = (0, packaging_1.setProductPackagingAssignment)(db, String(req.params.id), req.body || {});
        res.json({ success: true, product });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to set product packaging assignment', 400);
    }
};
const handleVariantAssignment = (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const variant = (0, packaging_1.setVariantPackagingAssignment)(db, String(req.params.id), req.body || {});
        res.json({ success: true, variant });
    }
    catch (err) {
        handleRouteError(res, err, 'Failed to set variant packaging assignment', 400);
    }
};
router.put(['/assignments/products/:id', '/assignments/product/:id'], (0, authorization_1.requireAnyPermission)('catalog.manage', 'settings.manage'), handleProductAssignment);
router.post(['/assignments/products/:id', '/assignments/product/:id'], (0, authorization_1.requireAnyPermission)('catalog.manage', 'settings.manage'), handleProductAssignment);
router.put(['/assignments/variants/:id', '/assignments/variant/:id'], (0, authorization_1.requireAnyPermission)('catalog.manage', 'settings.manage'), handleVariantAssignment);
router.post(['/assignments/variants/:id', '/assignments/variant/:id'], (0, authorization_1.requireAnyPermission)('catalog.manage', 'settings.manage'), handleVariantAssignment);
exports.packagingRoutes = router;
//# sourceMappingURL=packaging.js.map