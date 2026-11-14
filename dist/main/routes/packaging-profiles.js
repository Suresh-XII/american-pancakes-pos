"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packagingProfileRoutes = void 0;
const express_1 = require("express");
const crypto_1 = require("crypto");
const db_1 = require("../db");
const authorization_1 = require("../services/authorization");
const packaging_1 = require("../services/packaging");
const router = (0, express_1.Router)();
const validServing = new Set(['dine_in', 'parcel']);
const validType = new Set(['paper_plate', 'parcel_box']);
const expected = {
    dine_in: 'paper_plate',
    parcel: 'parcel_box',
};
const actor = (req) => String(req.user?.userId || '');
const isOwner = (req) => req.user?.role === 'owner';
function bad(res, message, status = 400) {
    return res.status(status).json({ error: message });
}
router.get('/', (0, authorization_1.requireAnyPermission)('pos.use', 'orders.create', 'settings.manage'), (req, res) => {
    const activeOnly = req.query.active_only === 'true';
    const db = (0, db_1.getDatabase)();
    const rows = db
        .prepare(`
        SELECT
          p.*,
          s.name AS supply_name,
          s.unit_cost,
          s.is_active AS supply_is_active
        FROM packaging_profiles p
        JOIN supplies s ON s.id = p.supply_id
        WHERE s.deleted_at IS NULL
        ${activeOnly ? 'AND p.is_active=1 AND s.is_active=1' : ''}
        ORDER BY p.serving_type, p.is_default DESC, p.name COLLATE NOCASE
      `)
        .all();
    const profileIds = rows.map((r) => r.id);
    const materialsByProfile = new Map();
    if (profileIds.length > 0) {
        const placeholders = profileIds.map(() => '?').join(',');
        const components = db
            .prepare(`
          SELECT
            pm.profile_id,
            pm.material_id,
            pm.quantity,
            s.name AS material_name,
            s.base_unit,
            s.unit_cost,
            s.stock_quantity,
            s.sku,
            s.category,
            s.is_active
          FROM packaging_profile_materials pm
          JOIN supplies s ON s.id = pm.material_id
          WHERE pm.profile_id IN (${placeholders})
            AND s.deleted_at IS NULL
          ORDER BY pm.id
        `)
            .all(...profileIds);
        for (const c of components) {
            const list = materialsByProfile.get(c.profile_id) || [];
            list.push({
                material_id: c.material_id,
                material_name: c.material_name,
                quantity: Number(c.quantity),
                base_unit: c.base_unit,
                unit_cost: c.unit_cost !== null && c.unit_cost !== undefined ? Number(c.unit_cost) : null,
                sku: c.sku,
                category: c.category,
                is_active: Number(c.is_active),
                stock_quantity: Number(c.stock_quantity || 0),
            });
            materialsByProfile.set(c.profile_id, list);
        }
    }
    const enriched = rows.map((r) => {
        let comps = materialsByProfile.get(r.id);
        if (!comps || comps.length === 0) {
            comps = [
                {
                    material_id: r.supply_id,
                    material_name: r.supply_name || '',
                    quantity: Number(r.units_per_serving || 1),
                    base_unit: 'each',
                    unit_cost: r.unit_cost !== null && r.unit_cost !== undefined ? Number(r.unit_cost) : null,
                    sku: null,
                    category: null,
                    is_active: Number(r.supply_is_active ?? 1),
                    stock_quantity: 0,
                },
            ];
        }
        return {
            ...r,
            components: comps,
        };
    });
    res.json({ profiles: enriched });
});
function write(req, res, id) {
    if (!isOwner(req)) {
        return bad(res, 'Only the owner can manage packaging profiles', 403);
    }
    const body = req.body || {};
    const name = typeof body.name === 'string'
        ? body.name.trim().slice(0, 100)
        : '';
    const servingType = body.serving_type;
    const packagingType = body.packaging_type;
    let supplyId = typeof body.supply_id === 'string'
        ? body.supply_id.trim()
        : '';
    let units = body.units_per_serving === undefined
        ? 1
        : Number(body.units_per_serving);
    const charge = body.customer_charge_per_unit === undefined
        ? 0
        : Number(body.customer_charge_per_unit);
    const active = body.is_active === false ? 0 : 1;
    const defaultProfile = body.is_default === true ? 1 : 0;
    const description = body.description ? String(body.description).trim() : null;
    const notes = body.notes ? String(body.notes).trim() : null;
    // Handle multi-material components if provided
    let componentsInput = Array.isArray(body.components) ? body.components : null;
    if (!componentsInput && Array.isArray(body.materials)) {
        componentsInput = body.materials;
    }
    if (componentsInput && componentsInput.length > 0) {
        if (!supplyId) {
            supplyId = String(componentsInput[0].material_id || '').trim();
            units = Number(componentsInput[0].quantity || 1);
        }
    }
    if (!name ||
        !validServing.has(servingType) ||
        !validType.has(packagingType) ||
        expected[servingType] !== packagingType ||
        !supplyId ||
        !Number.isSafeInteger(units) ||
        units <= 0 ||
        !Number.isFinite(charge) ||
        charge < 0 ||
        (defaultProfile === 1 && active === 0)) {
        return bad(res, 'Invalid packaging profile');
    }
    const db = (0, db_1.getDatabase)();
    const supply = db
        .prepare(`
      SELECT id, base_unit
      FROM supplies
      WHERE id = ?
        AND is_active = 1
        AND deleted_at IS NULL
    `)
        .get(supplyId);
    if (!supply) {
        return bad(res, 'Linked packaging supply is inactive or unavailable');
    }
    if (supply.base_unit !== 'each') {
        return bad(res, 'Packaging supplies must use the each base unit');
    }
    const validatedComponents = [];
    if (componentsInput && componentsInput.length > 0) {
        const seen = new Set();
        for (const comp of componentsInput) {
            const matId = String(comp.material_id || '').trim();
            if (!matId)
                return bad(res, 'Material ID is required for component');
            if (seen.has(matId))
                return bad(res, 'Duplicate component in profile');
            seen.add(matId);
            const qty = Number(comp.quantity);
            if (!Number.isFinite(qty) || qty <= 0) {
                return bad(res, 'Component quantity must be a positive number');
            }
            const mat = db.prepare('SELECT id, is_active, deleted_at FROM supplies WHERE id = ?').get(matId);
            if (!mat || mat.deleted_at !== null || mat.is_active !== 1) {
                return bad(res, 'Linked packaging supply is inactive or unavailable');
            }
            validatedComponents.push({ material_id: matId, quantity: qty });
        }
    }
    else {
        validatedComponents.push({ material_id: supplyId, quantity: units });
    }
    const userId = actor(req);
    const timestamp = (0, db_1.now)();
    const profileId = id || (0, crypto_1.randomUUID)();
    if (id) {
        const existing = db
            .prepare('SELECT id FROM packaging_profiles WHERE id = ?')
            .get(id);
        if (!existing) {
            return bad(res, 'Packaging profile not found', 404);
        }
    }
    try {
        db.transaction(() => {
            if (defaultProfile) {
                db.prepare(`
          UPDATE packaging_profiles
          SET
            is_default = 0,
            updated_at = ?,
            updated_by_user_id = ?
          WHERE serving_type = ?
            AND id != ?
        `).run(timestamp, userId, servingType, profileId);
            }
            if (id) {
                const result = db.prepare(`
          UPDATE packaging_profiles
          SET
            name = ?,
            description = ?,
            notes = ?,
            serving_type = ?,
            packaging_type = ?,
            supply_id = ?,
            units_per_serving = ?,
            customer_charge_per_unit = ?,
            is_active = ?,
            is_default = ?,
            updated_by_user_id = ?,
            updated_at = ?
          WHERE id = ?
        `).run(name, description, notes, servingType, packagingType, supplyId, units, charge, active, defaultProfile, userId, timestamp, id);
                if (result.changes !== 1) {
                    throw new Error('Packaging profile update failed');
                }
            }
            else {
                db.prepare(`
          INSERT INTO packaging_profiles (
            id,
            name,
            description,
            notes,
            serving_type,
            packaging_type,
            supply_id,
            units_per_serving,
            customer_charge_per_unit,
            is_active,
            is_default,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(profileId, name, description, notes, servingType, packagingType, supplyId, units, charge, active, defaultProfile, userId, userId, timestamp, timestamp);
            }
            db.prepare('DELETE FROM packaging_profile_materials WHERE profile_id = ?').run(profileId);
            for (const comp of validatedComponents) {
                db.prepare(`
          INSERT INTO packaging_profile_materials (
            profile_id, material_id, quantity, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(profileId, comp.material_id, comp.quantity, timestamp, timestamp);
                db.prepare('UPDATE supplies SET is_packaging = 1 WHERE id = ?').run(comp.material_id);
            }
        })();
    }
    catch {
        return bad(res, 'Could not save packaging profile');
    }
    const profile = db
        .prepare(`
      SELECT
        p.*,
        s.name AS supply_name,
        s.unit_cost
      FROM packaging_profiles p
      JOIN supplies s ON s.id = p.supply_id
      WHERE p.id = ?
    `)
        .get(profileId);
    const comps = db.prepare(`
    SELECT
      pm.material_id,
      pm.quantity,
      s.name AS material_name,
      s.base_unit,
      s.unit_cost
    FROM packaging_profile_materials pm
    JOIN supplies s ON s.id = pm.material_id
    WHERE pm.profile_id = ?
  `).all(profileId);
    return res.status(id ? 200 : 201).json({
        profile: {
            ...profile,
            components: comps,
        },
    });
}
router.post('/', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => write(req, res));
router.put('/:id', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => write(req, res, String(req.params.id)));
router.post('/:id/duplicate', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    if (!isOwner(req)) {
        return bad(res, 'Only the owner can manage packaging profiles', 403);
    }
    try {
        const db = (0, db_1.getDatabase)();
        const profile = (0, packaging_1.duplicatePackagingProfile)(db, String(req.params.id), actor(req));
        res.status(201).json({ profile });
    }
    catch (err) {
        const error = err;
        bad(res, error?.message || 'Failed to duplicate profile', error?.statusCode || 400);
    }
});
exports.packagingProfileRoutes = router;
//# sourceMappingURL=packaging-profiles.js.map