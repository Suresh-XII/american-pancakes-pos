"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.counterRoutes = void 0;
const express_1 = require("express");
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const router = (0, express_1.Router)();
function parseInteger(value, defaultValue = 0) {
    if (value === undefined || value === null || value === '')
        return defaultValue;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : defaultValue;
}
const ALLOWED_ROLES = new Set(['ordering', 'payment', 'combined']);
function normalizeCounterName(raw) {
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > 100)
        return null;
    return trimmed;
}
function normalizeCounterRole(raw) {
    if (typeof raw !== 'string')
        return null;
    const role = raw.trim().toLowerCase();
    return ALLOWED_ROLES.has(role) ? role : null;
}
function normalizeIsActive(raw, defaultValue = 1) {
    if (raw === undefined || raw === null)
        return defaultValue;
    if (raw === true || raw === 1 || raw === '1' || raw === 'true')
        return 1;
    if (raw === false || raw === 0 || raw === '0' || raw === 'false')
        return 0;
    return defaultValue;
}
function isOwner(req) {
    const user = req.user;
    return user?.role === 'owner';
}
// GET /api/counters — List counters
router.get('/', (0, authorization_1.requireAnyPermission)('pos.use', 'orders.read', 'orders.create', 'payments.take', 'settings.view', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const includeInactive = req.query.include_inactive === 'true' || req.query.all === 'true';
        const counters = includeInactive
            ? db
                .prepare('SELECT * FROM counters ORDER BY sort_order ASC, name ASC')
                .all()
            : db
                .prepare('SELECT * FROM counters WHERE is_active = 1 ORDER BY sort_order ASC, name ASC')
                .all();
        res.json({ counters });
    }
    catch (error) {
        console.error('[Counters] Error listing counters:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/counters/:id — Get a single counter
router.get('/:id', (0, authorization_1.requireAnyPermission)('pos.use', 'orders.read', 'orders.create', 'payments.take', 'settings.view', 'settings.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(req.params.id);
        if (!counter) {
            return res.status(404).json({ error: 'Counter not found' });
        }
        res.json({ counter });
    }
    catch (error) {
        console.error('[Counters] Error fetching counter:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/counters — Create counter (owner only)
router.post('/', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        if (!isOwner(req)) {
            return res
                .status(403)
                .json({ error: 'Only the store owner can modify counter configuration' });
        }
        const name = normalizeCounterName(req.body?.name);
        if (!name) {
            return res.status(400).json({ error: 'Counter name is required (1-100 characters)' });
        }
        const role = normalizeCounterRole(req.body?.role);
        if (!role) {
            return res.status(400).json({ error: 'Counter role must be ordering, payment, or combined' });
        }
        const isActive = normalizeIsActive(req.body?.is_active, 1);
        const sortOrder = parseInteger(req.body?.sort_order, 0);
        const db = (0, db_1.getDatabase)();
        const id = `cnt_${(0, node_crypto_1.randomUUID)()}`;
        const nowStr = (0, db_1.now)();
        db.prepare(`
        INSERT INTO counters (id, name, role, is_active, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, role, isActive, sortOrder, nowStr, nowStr);
        const created = db.prepare('SELECT * FROM counters WHERE id = ?').get(id);
        res.status(201).json({ counter: created });
    }
    catch (error) {
        console.error('[Counters] Error creating counter:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PUT /api/counters/:id — Update counter (owner only)
router.put('/:id', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        if (!isOwner(req)) {
            return res
                .status(403)
                .json({ error: 'Only the store owner can modify counter configuration' });
        }
        const db = (0, db_1.getDatabase)();
        const existing = db.prepare('SELECT * FROM counters WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Counter not found' });
        }
        let name = existing.name;
        if (req.body?.name !== undefined) {
            const normalized = normalizeCounterName(req.body.name);
            if (!normalized) {
                return res.status(400).json({ error: 'Counter name must be 1-100 characters' });
            }
            name = normalized;
        }
        let role = existing.role;
        if (req.body?.role !== undefined) {
            const normalized = normalizeCounterRole(req.body.role);
            if (!normalized) {
                return res
                    .status(400)
                    .json({ error: 'Counter role must be ordering, payment, or combined' });
            }
            role = normalized;
        }
        const isActive = req.body?.is_active !== undefined
            ? normalizeIsActive(req.body.is_active, existing.is_active)
            : existing.is_active;
        const sortOrder = req.body?.sort_order !== undefined
            ? parseInteger(req.body.sort_order, existing.sort_order)
            : existing.sort_order;
        const nowStr = (0, db_1.now)();
        db.prepare(`
        UPDATE counters
        SET name = ?, role = ?, is_active = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(name, role, isActive, sortOrder, nowStr, existing.id);
        const updated = db
            .prepare('SELECT * FROM counters WHERE id = ?')
            .get(existing.id);
        res.json({ counter: updated });
    }
    catch (error) {
        console.error('[Counters] Error updating counter:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /api/counters/:id — Delete counter (owner only)
router.delete('/:id', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        if (!isOwner(req)) {
            return res
                .status(403)
                .json({ error: 'Only the store owner can modify counter configuration' });
        }
        const db = (0, db_1.getDatabase)();
        const existing = db.prepare('SELECT id FROM counters WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Counter not found' });
        }
        db.prepare('DELETE FROM counters WHERE id = ?').run(existing.id);
        res.json({ success: true });
    }
    catch (error) {
        console.error('[Counters] Error deleting counter:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.counterRoutes = router;
//# sourceMappingURL=counters.js.map