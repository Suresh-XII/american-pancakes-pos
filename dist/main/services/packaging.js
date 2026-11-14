"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePackagingUnit = normalizePackagingUnit;
exports.normalizeServingAllocations = normalizeServingAllocations;
exports.profileFor = profileFor;
exports.listPackagingMaterials = listPackagingMaterials;
exports.getPackagingMaterial = getPackagingMaterial;
exports.createPackagingMaterial = createPackagingMaterial;
exports.updatePackagingMaterial = updatePackagingMaterial;
exports.deletePackagingMaterial = deletePackagingMaterial;
exports.getPackagingMaterialMovements = getPackagingMaterialMovements;
exports.getProfileComponents = getProfileComponents;
exports.listPackagingProfiles = listPackagingProfiles;
exports.getPackagingProfile = getPackagingProfile;
exports.createPackagingProfile = createPackagingProfile;
exports.updatePackagingProfile = updatePackagingProfile;
exports.duplicatePackagingProfile = duplicatePackagingProfile;
exports.deletePackagingProfile = deletePackagingProfile;
exports.getProductPackagingAssignments = getProductPackagingAssignments;
exports.setProductPackagingAssignment = setProductPackagingAssignment;
exports.setVariantPackagingAssignment = setVariantPackagingAssignment;
exports.resolvePackagingProfile = resolvePackagingProfile;
exports.previewItemPackaging = previewItemPackaging;
exports.persistItemServingAndPackaging = persistItemServingAndPackaging;
exports.getOrderPackaging = getOrderPackaging;
exports.adjustOrderPackaging = adjustOrderPackaging;
exports.getPackagingDashboard = getPackagingDashboard;
const crypto_1 = require("crypto");
const db_1 = require("../db");
const units_1 = require("./units");
const expectedType = {
    dine_in: 'paper_plate',
    parcel: 'parcel_box',
};
function fail(message, statusCode = 400) {
    throw Object.assign(new Error(message), { statusCode });
}
function finitePositive(value, name) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`${name} must be greater than zero`);
    }
    return parsed;
}
function finiteNonNegative(value, name) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        fail(`${name} must be a valid non-negative amount`);
    }
    return parsed;
}
function normalizePackagingUnit(raw) {
    if (typeof raw !== 'string')
        return 'each';
    const u = raw.trim().toLowerCase();
    if (['piece', 'pieces', 'pc', 'pcs', 'pack', 'packs', 'box', 'boxes', 'roll', 'rolls', 'each'].includes(u)) {
        return 'each';
    }
    if (['gram', 'grams', 'g'].includes(u)) {
        return 'g';
    }
    if (['millilitre', 'millilitres', 'milliliter', 'milliliters', 'ml'].includes(u)) {
        return 'ml';
    }
    if (['kilogram', 'kilograms', 'kg'].includes(u)) {
        return 'kg';
    }
    if (['litre', 'litres', 'liter', 'liters', 'l'].includes(u)) {
        return 'l';
    }
    return u;
}
function normalizeServingAllocations(raw, itemQuantity) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2) {
        fail('serving_allocations is invalid');
    }
    const seen = new Set();
    const allocations = raw.map((entry) => {
        if (!entry || !entry.serving_type || !['dine_in', 'parcel'].includes(entry.serving_type)) {
            fail('serving_type is invalid');
        }
        if (seen.has(entry.serving_type)) {
            fail('serving_type may appear once per item');
        }
        seen.add(entry.serving_type);
        const quantity = finitePositive(entry.quantity, 'serving allocation quantity');
        const profileId = typeof entry.packaging_profile_id === 'string'
            ? entry.packaging_profile_id.trim()
            : null;
        return {
            serving_type: entry.serving_type,
            quantity,
            packaging_profile_id: profileId || null,
        };
    });
    const total = allocations.reduce((sum, entry) => sum + entry.quantity, 0);
    if (Math.abs(total - itemQuantity) > 0.000001) {
        fail('Serving allocations must equal the item quantity');
    }
    return allocations;
}
function profileFor(db, id, servingType) {
    const profile = db.prepare(`
    SELECT
      p.*,
      s.unit_cost,
      s.base_unit
    FROM packaging_profiles p
    JOIN supplies s ON s.id = p.supply_id
    WHERE
      p.id = ?
      AND p.is_active = 1
      AND s.is_active = 1
      AND s.deleted_at IS NULL
  `).get(id);
    if (!profile) {
        fail('Packaging profile is inactive or unavailable');
    }
    if (profile.serving_type !== servingType ||
        profile.packaging_type !== expectedType[servingType]) {
        fail('Packaging profile is incompatible with serving type');
    }
    if (profile.base_unit !== 'each') {
        fail('Packaging supplies must use each as their base unit');
    }
    const unitsPerServing = Number(profile.units_per_serving);
    if (!Number.isSafeInteger(unitsPerServing) ||
        unitsPerServing <= 0) {
        fail('Packaging quantity per serving must be a positive whole number');
    }
    finiteNonNegative(profile.customer_charge_per_unit, 'Packaging customer charge');
    if (profile.unit_cost !== null) {
        finiteNonNegative(profile.unit_cost, 'Packaging supply unit cost');
    }
    return profile;
}
function packagingQuantity(allocationQuantity, profile) {
    const quantity = allocationQuantity * Number(profile.units_per_serving);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        fail('Calculated packaging quantity is invalid');
    }
    return quantity;
}
// --- Material Management ---
function listPackagingMaterials(db, filters = {}) {
    const conditions = ['deleted_at IS NULL', 'is_packaging = 1'];
    const params = [];
    if (!filters.includeInactive) {
        conditions.push('is_active = 1');
    }
    if (filters.search) {
        conditions.push('(name LIKE ? OR sku LIKE ?)');
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.category) {
        conditions.push('category = ?');
        params.push(filters.category);
    }
    let sql = `
    SELECT *,
      CASE
        WHEN low_stock_threshold IS NOT NULL AND stock_quantity <= low_stock_threshold THEN 1
        ELSE 0
      END AS is_low_stock
    FROM supplies
    WHERE ${conditions.join(' AND ')}
  `;
    if (filters.lowStockOnly) {
        sql += ' AND low_stock_threshold IS NOT NULL AND stock_quantity <= low_stock_threshold';
    }
    sql += ' ORDER BY name COLLATE NOCASE';
    return db.prepare(sql).all(...params);
}
function getPackagingMaterial(db, id) {
    const row = db.prepare(`
    SELECT *,
      CASE
        WHEN low_stock_threshold IS NOT NULL AND stock_quantity <= low_stock_threshold THEN 1
        ELSE 0
      END AS is_low_stock
    FROM supplies
    WHERE id = ? AND deleted_at IS NULL
  `).get(id);
    return row || null;
}
function createPackagingMaterial(db, input, actorUserId) {
    const name = String(input.name || '').trim();
    if (!name)
        fail('Material name is required');
    if (name.length > 200)
        fail('Material name cannot exceed 200 characters');
    const sku = input.sku ? String(input.sku).trim() : null;
    if (sku) {
        if (sku.length > 100)
            fail('SKU cannot exceed 100 characters');
        const existingSku = db.prepare('SELECT id FROM supplies WHERE sku = ? AND deleted_at IS NULL').get(sku);
        if (existingSku)
            fail('SKU must be unique');
    }
    const category = input.category ? String(input.category).trim().slice(0, 100) : null;
    const rawUnit = input.unit || 'each';
    const unit = normalizePackagingUnit(rawUnit);
    if (!(0, units_1.isSupplyUnit)(unit)) {
        fail(`Unit must be one of: ${units_1.SUPPLY_UNITS.join(', ')} or pieces, packs, boxes, rolls, grams, millilitres`);
    }
    const rawStock = input.initial_stock !== undefined ? input.initial_stock : (input.stock_quantity !== undefined ? input.stock_quantity : 0);
    const stock = Number(rawStock);
    if (!Number.isFinite(stock) || stock < 0) {
        fail('Initial stock quantity cannot be negative');
    }
    let threshold = null;
    const rawThreshold = input.low_stock_threshold !== undefined
        ? input.low_stock_threshold
        : input.min_threshold;
    if (rawThreshold !== undefined && rawThreshold !== null && String(rawThreshold).trim() !== '') {
        const t = Number(rawThreshold);
        if (!Number.isFinite(t) || t < 0)
            fail('Low stock threshold cannot be negative');
        threshold = t;
    }
    let unitCost = null;
    const rawCost = input.purchase_cost !== undefined ? input.purchase_cost : input.unit_cost;
    if (rawCost !== undefined && rawCost !== null && String(rawCost).trim() !== '') {
        const c = Number(rawCost);
        if (!Number.isFinite(c) || c < 0)
            fail('Purchase cost cannot be negative');
        unitCost = c;
    }
    const isActive = input.is_active === false || input.is_active === 0 ? 0 : 1;
    const id = (0, crypto_1.randomUUID)();
    const timestamp = (0, db_1.now)();
    db.transaction(() => {
        db.prepare(`
      INSERT INTO supplies (
        id, name, sku, category, base_unit, stock_quantity, low_stock_threshold,
        unit_cost, is_active, is_packaging, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, name, sku, category, unit, stock, threshold, unitCost, isActive, timestamp, timestamp);
        if (stock > 0) {
            db.prepare(`
        INSERT INTO supply_movements (
          supply_id, quantity_delta, movement_type, unit, stock_after,
          unit_cost, total_cost, unit_cost_after, reason, actor_user_id,
          reference_type, reference_id, created_at
        ) VALUES (?, ?, 'receive', ?, ?, ?, ?, ?, 'Initial packaging stock', ?, 'initial_stock', ?, ?)
      `).run(id, stock, unit, stock, unitCost, unitCost !== null ? unitCost * stock : null, unitCost, actorUserId || 'system', id, timestamp);
        }
    })();
    return getPackagingMaterial(db, id);
}
function updatePackagingMaterial(db, id, input, _actorUserId) {
    const existing = db.prepare('SELECT * FROM supplies WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!existing)
        fail('Packaging material not found', 404);
    const name = input.name !== undefined ? String(input.name).trim() : existing.name;
    if (!name)
        fail('Material name is required');
    if (name.length > 200)
        fail('Material name cannot exceed 200 characters');
    let sku = existing.sku;
    if (input.sku !== undefined) {
        sku = input.sku ? String(input.sku).trim() : null;
        if (sku) {
            if (sku.length > 100)
                fail('SKU cannot exceed 100 characters');
            const clash = db.prepare('SELECT id FROM supplies WHERE sku = ? AND id != ? AND deleted_at IS NULL').get(sku, id);
            if (clash)
                fail('SKU must be unique');
        }
    }
    const category = input.category !== undefined ? (input.category ? String(input.category).trim().slice(0, 100) : null) : existing.category;
    let unit = existing.base_unit;
    if (input.unit !== undefined) {
        unit = normalizePackagingUnit(input.unit);
        if (!(0, units_1.isSupplyUnit)(unit)) {
            fail(`Unit must be one of: ${units_1.SUPPLY_UNITS.join(', ')}`);
        }
    }
    let threshold = existing.low_stock_threshold;
    const updateRawThreshold = input.low_stock_threshold !== undefined
        ? input.low_stock_threshold
        : input.min_threshold;
    if (updateRawThreshold !== undefined) {
        if (updateRawThreshold === null || String(updateRawThreshold).trim() === '') {
            threshold = null;
        }
        else {
            const t = Number(updateRawThreshold);
            if (!Number.isFinite(t) || t < 0)
                fail('Low stock threshold cannot be negative');
            threshold = t;
        }
    }
    let unitCost = existing.unit_cost;
    const rawCost = input.purchase_cost !== undefined ? input.purchase_cost : input.unit_cost;
    if (rawCost !== undefined) {
        if (rawCost === null || String(rawCost).trim() === '') {
            unitCost = null;
        }
        else {
            const c = Number(rawCost);
            if (!Number.isFinite(c) || c < 0)
                fail('Purchase cost cannot be negative');
            unitCost = c;
        }
    }
    const isActive = input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active;
    const timestamp = (0, db_1.now)();
    db.prepare(`
    UPDATE supplies
    SET name = ?, sku = ?, category = ?, base_unit = ?,
        low_stock_threshold = ?, unit_cost = ?, is_active = ?,
        is_packaging = 1, updated_at = ?
    WHERE id = ?
  `).run(name, sku, category, unit, threshold, unitCost, isActive, timestamp, id);
    return getPackagingMaterial(db, id);
}
function deletePackagingMaterial(db, id, _actorUserId) {
    const existing = db.prepare('SELECT * FROM supplies WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!existing)
        fail('Packaging material not found', 404);
    const activeProfileLink = db.prepare(`
    SELECT p.name
    FROM packaging_profile_materials pm
    JOIN packaging_profiles p ON p.id = pm.profile_id
    WHERE pm.material_id = ? AND p.is_active = 1
    LIMIT 1
  `).get(id);
    if (activeProfileLink) {
        fail(`Cannot delete packaging material: it is currently used in active profile "${activeProfileLink.name}". Deactivate the profile or remove the material first.`);
    }
    const timestamp = (0, db_1.now)();
    db.prepare('UPDATE supplies SET is_active = 0, deleted_at = ?, updated_at = ? WHERE id = ?').run(timestamp, timestamp, id);
}
function getPackagingMaterialMovements(db, id, limit = 50) {
    const material = db.prepare('SELECT id, name FROM supplies WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!material)
        fail('Packaging material not found', 404);
    const rows = db.prepare(`
    SELECT
      sm.id,
      sm.supply_id,
      sm.quantity_delta,
      sm.movement_type,
      sm.unit,
      sm.stock_after,
      sm.unit_cost,
      sm.total_cost,
      sm.reason,
      sm.actor_user_id,
      sm.reference_type,
      sm.reference_id,
      sm.created_at,
      u.name AS actor_name
    FROM supply_movements sm
    LEFT JOIN users u ON u.id = sm.actor_user_id
    WHERE sm.supply_id = ?
    ORDER BY sm.id DESC
    LIMIT ?
  `).all(id, Math.min(Math.max(limit, 1), 200));
    return {
        material,
        movements: rows,
    };
}
// --- Profile Components & Profiles Management ---
function getProfileComponents(db, profileId) {
    const rows = db.prepare(`
    SELECT
      pm.material_id,
      pm.quantity,
      s.name AS material_name,
      s.base_unit,
      s.unit_cost,
      s.sku,
      s.category,
      s.is_active,
      s.stock_quantity
    FROM packaging_profile_materials pm
    JOIN supplies s ON s.id = pm.material_id
    WHERE pm.profile_id = ?
      AND s.deleted_at IS NULL
    ORDER BY pm.id
  `).all(profileId);
    if (rows.length > 0) {
        for (const row of rows) {
            if (row.is_active !== 1) {
                fail('Linked packaging supply is inactive or unavailable');
            }
        }
        const profile = db.prepare('SELECT packaging_type FROM packaging_profiles WHERE id = ?').get(profileId);
        return rows.map((r) => ({
            material_id: r.material_id,
            material_name: r.material_name,
            quantity: Number(r.quantity),
            base_unit: r.base_unit || 'each',
            unit_cost: r.unit_cost !== null && r.unit_cost !== undefined ? Number(r.unit_cost) : null,
            packaging_type: profile?.packaging_type || 'parcel_box',
            sku: r.sku || null,
            category: r.category || null,
            is_active: Number(r.is_active),
            stock_quantity: Number(r.stock_quantity || 0),
        }));
    }
    // Fallback to legacy single-material profile on packaging_profiles
    const legacyProfile = db.prepare(`
    SELECT
      p.supply_id,
      p.units_per_serving,
      p.packaging_type,
      s.name AS supply_name,
      s.base_unit,
      s.unit_cost,
      s.sku,
      s.category,
      s.is_active,
      s.stock_quantity
    FROM packaging_profiles p
    JOIN supplies s ON s.id = p.supply_id
    WHERE p.id = ?
      AND s.deleted_at IS NULL
  `).get(profileId);
    if (!legacyProfile) {
        fail('Packaging profile is inactive or unavailable');
    }
    if (legacyProfile.is_active !== 1) {
        fail('Linked packaging supply is inactive or unavailable');
    }
    return [
        {
            material_id: legacyProfile.supply_id,
            material_name: legacyProfile.supply_name,
            quantity: Number(legacyProfile.units_per_serving),
            base_unit: legacyProfile.base_unit || 'each',
            unit_cost: legacyProfile.unit_cost !== null && legacyProfile.unit_cost !== undefined ? Number(legacyProfile.unit_cost) : null,
            packaging_type: legacyProfile.packaging_type,
            sku: legacyProfile.sku || null,
            category: legacyProfile.category || null,
            is_active: Number(legacyProfile.is_active),
            stock_quantity: Number(legacyProfile.stock_quantity || 0),
        },
    ];
}
function listPackagingProfiles(db, options = {}) {
    const conditions = [];
    if (options.activeOnly) {
        conditions.push('p.is_active = 1');
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`
    SELECT
      p.*,
      s.name AS supply_name,
      s.unit_cost,
      s.is_active AS supply_is_active
    FROM packaging_profiles p
    LEFT JOIN supplies s ON s.id = p.supply_id
    ${whereClause}
    ORDER BY p.serving_type, p.is_default DESC, p.name COLLATE NOCASE
  `).all();
    const profileIds = rows.map((r) => r.id);
    const materialsByProfile = new Map();
    if (profileIds.length > 0) {
        const placeholders = profileIds.map(() => '?').join(',');
        const components = db.prepare(`
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
    `).all(...profileIds);
        for (const c of components) {
            const pid = c.profile_id || '';
            const list = materialsByProfile.get(pid) || [];
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
            materialsByProfile.set(pid, list);
        }
    }
    return rows.map((r) => {
        let comps = materialsByProfile.get(r.id);
        if (!comps || comps.length === 0) {
            if (r.supply_id) {
                comps = [
                    {
                        material_id: r.supply_id,
                        material_name: r.supply_name || '',
                        quantity: Number(r.units_per_serving || 1),
                        base_unit: 'each',
                        unit_cost: r.unit_cost !== null && r.unit_cost !== undefined ? Number(r.unit_cost) : null,
                        is_active: Number(r.supply_is_active ?? 1),
                    },
                ];
            }
            else {
                comps = [];
            }
        }
        return {
            id: r.id,
            name: r.name,
            description: r.description || null,
            notes: r.notes || null,
            serving_type: r.serving_type,
            packaging_type: r.packaging_type,
            supply_id: r.supply_id,
            units_per_serving: Number(r.units_per_serving || 1),
            customer_charge_per_unit: Number(r.customer_charge_per_unit || 0),
            is_active: Number(r.is_active),
            is_default: Number(r.is_default),
            components: comps,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    });
}
function getPackagingProfile(db, id) {
    const row = db.prepare(`
    SELECT
      p.*,
      s.name AS supply_name,
      s.unit_cost,
      s.is_active AS supply_is_active
    FROM packaging_profiles p
    LEFT JOIN supplies s ON s.id = p.supply_id
    WHERE p.id = ?
  `).get(id);
    if (!row)
        return null;
    const components = getProfileComponents(db, id);
    return {
        id: row.id,
        name: row.name,
        description: row.description || null,
        notes: row.notes || null,
        serving_type: row.serving_type,
        packaging_type: row.packaging_type,
        supply_id: row.supply_id,
        units_per_serving: Number(row.units_per_serving || 1),
        customer_charge_per_unit: Number(row.customer_charge_per_unit || 0),
        is_active: Number(row.is_active),
        is_default: Number(row.is_default),
        components,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
function createPackagingProfile(db, input, actorUserId) {
    const name = String(input.name || '').trim();
    if (!name)
        fail('Profile name is required');
    if (name.length > 100)
        fail('Profile name cannot exceed 100 characters');
    const servingType = input.serving_type || 'parcel';
    if (!['dine_in', 'parcel'].includes(servingType))
        fail('serving_type is invalid');
    const packagingType = input.packaging_type || expectedType[servingType];
    if (!['paper_plate', 'parcel_box'].includes(packagingType) || expectedType[servingType] !== packagingType) {
        fail('Packaging profile is incompatible with serving type');
    }
    let charge = 0;
    if (input.customer_charge_per_unit !== undefined) {
        charge = Number(input.customer_charge_per_unit);
        if (!Number.isFinite(charge) || charge < 0) {
            fail('Packaging customer charge must be a valid non-negative amount');
        }
    }
    const isActive = input.is_active === false || input.is_active === 0 ? 0 : 1;
    const isDefault = (input.is_default === true || input.is_default === 1) ? 1 : 0;
    if (isDefault === 1 && isActive === 0) {
        fail('Default profile cannot be inactive');
    }
    let componentsInput = input.components;
    if (!componentsInput || componentsInput.length === 0) {
        if (input.supply_id) {
            const units = input.units_per_serving !== undefined ? Number(input.units_per_serving) : 1;
            componentsInput = [{ material_id: input.supply_id, quantity: units }];
        }
        else {
            fail('Packaging profile must have at least one packaging material component');
        }
    }
    const validatedComponents = [];
    const seenMaterials = new Set();
    for (const comp of componentsInput) {
        const matId = String(comp.material_id || '').trim();
        if (!matId)
            fail('Material ID is required for profile component');
        if (seenMaterials.has(matId))
            fail('Duplicate packaging material in profile');
        seenMaterials.add(matId);
        const qty = Number(comp.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            fail('Packaging quantity per serving must be a positive number');
        }
        const material = db.prepare('SELECT id, is_active, deleted_at, is_packaging FROM supplies WHERE id = ?').get(matId);
        if (!material || material.deleted_at !== null || material.is_active !== 1) {
            fail('Linked packaging supply is inactive or unavailable');
        }
        validatedComponents.push({ material_id: matId, quantity: qty });
    }
    const id = (0, crypto_1.randomUUID)();
    const timestamp = (0, db_1.now)();
    const primaryMaterialId = validatedComponents[0].material_id;
    const primaryQuantity = validatedComponents[0].quantity;
    const description = input.description ? String(input.description).trim() : null;
    const notes = input.notes ? String(input.notes).trim() : null;
    db.transaction(() => {
        if (isDefault === 1) {
            db.prepare(`
        UPDATE packaging_profiles
        SET is_default = 0, updated_at = ?, updated_by_user_id = ?
        WHERE serving_type = ? AND id != ?
      `).run(timestamp, actorUserId, servingType, id);
        }
        db.prepare(`
      INSERT INTO packaging_profiles (
        id, name, description, notes, serving_type, packaging_type,
        supply_id, units_per_serving, customer_charge_per_unit,
        is_active, is_default, created_by_user_id, updated_by_user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description, notes, servingType, packagingType, primaryMaterialId, primaryQuantity, charge, isActive, isDefault, actorUserId, actorUserId, timestamp, timestamp);
        for (const comp of validatedComponents) {
            db.prepare(`
        INSERT INTO packaging_profile_materials (
          profile_id, material_id, quantity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(id, comp.material_id, comp.quantity, timestamp, timestamp);
            db.prepare('UPDATE supplies SET is_packaging = 1 WHERE id = ?').run(comp.material_id);
        }
    })();
    return getPackagingProfile(db, id);
}
function updatePackagingProfile(db, id, input, actorUserId) {
    const existing = db.prepare('SELECT * FROM packaging_profiles WHERE id = ?').get(id);
    if (!existing)
        fail('Packaging profile not found', 404);
    const name = input.name !== undefined ? String(input.name).trim() : existing.name;
    if (!name)
        fail('Profile name is required');
    if (name.length > 100)
        fail('Profile name cannot exceed 100 characters');
    const servingType = input.serving_type || existing.serving_type;
    if (!['dine_in', 'parcel'].includes(servingType))
        fail('serving_type is invalid');
    const packagingType = input.packaging_type || expectedType[servingType];
    if (!['paper_plate', 'parcel_box'].includes(packagingType) || expectedType[servingType] !== packagingType) {
        fail('Packaging profile is incompatible with serving type');
    }
    let charge = existing.customer_charge_per_unit;
    if (input.customer_charge_per_unit !== undefined) {
        charge = Number(input.customer_charge_per_unit);
        if (!Number.isFinite(charge) || charge < 0) {
            fail('Packaging customer charge must be a valid non-negative amount');
        }
    }
    const isActive = input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active;
    const isDefault = input.is_default !== undefined ? (input.is_default ? 1 : 0) : existing.is_default;
    if (isDefault === 1 && isActive === 0) {
        fail('Default profile cannot be inactive');
    }
    let componentsInput = input.components;
    if (!componentsInput && input.supply_id) {
        const units = input.units_per_serving !== undefined ? Number(input.units_per_serving) : 1;
        componentsInput = [{ material_id: input.supply_id, quantity: units }];
    }
    let validatedComponents = null;
    if (componentsInput) {
        if (componentsInput.length === 0) {
            fail('Packaging profile must have at least one packaging material component');
        }
        validatedComponents = [];
        const seen = new Set();
        for (const comp of componentsInput) {
            const matId = String(comp.material_id || '').trim();
            if (!matId)
                fail('Material ID is required for profile component');
            if (seen.has(matId))
                fail('Duplicate packaging material in profile');
            seen.add(matId);
            const qty = Number(comp.quantity);
            if (!Number.isFinite(qty) || qty <= 0) {
                fail('Packaging quantity per serving must be a positive number');
            }
            const material = db.prepare('SELECT id, is_active, deleted_at FROM supplies WHERE id = ?').get(matId);
            if (!material || material.deleted_at !== null || material.is_active !== 1) {
                fail('Linked packaging supply is inactive or unavailable');
            }
            validatedComponents.push({ material_id: matId, quantity: qty });
        }
    }
    const timestamp = (0, db_1.now)();
    const description = input.description !== undefined ? (input.description ? String(input.description).trim() : null) : existing.description;
    const notes = input.notes !== undefined ? (input.notes ? String(input.notes).trim() : null) : existing.notes;
    db.transaction(() => {
        if (isDefault === 1) {
            db.prepare(`
        UPDATE packaging_profiles
        SET is_default = 0, updated_at = ?, updated_by_user_id = ?
        WHERE serving_type = ? AND id != ?
      `).run(timestamp, actorUserId, servingType, id);
        }
        const primaryMaterialId = validatedComponents ? validatedComponents[0].material_id : existing.supply_id;
        const primaryQuantity = validatedComponents ? validatedComponents[0].quantity : existing.units_per_serving;
        db.prepare(`
      UPDATE packaging_profiles
      SET name = ?, description = ?, notes = ?, serving_type = ?,
          packaging_type = ?, supply_id = ?, units_per_serving = ?,
          customer_charge_per_unit = ?, is_active = ?, is_default = ?,
          updated_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(name, description, notes, servingType, packagingType, primaryMaterialId, primaryQuantity, charge, isActive, isDefault, actorUserId, timestamp, id);
        if (validatedComponents) {
            db.prepare('DELETE FROM packaging_profile_materials WHERE profile_id = ?').run(id);
            for (const comp of validatedComponents) {
                db.prepare(`
          INSERT INTO packaging_profile_materials (
            profile_id, material_id, quantity, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(id, comp.material_id, comp.quantity, timestamp, timestamp);
                db.prepare('UPDATE supplies SET is_packaging = 1 WHERE id = ?').run(comp.material_id);
            }
        }
    })();
    return getPackagingProfile(db, id);
}
function duplicatePackagingProfile(db, id, actorUserId) {
    const existing = getPackagingProfile(db, id);
    if (!existing)
        fail('Packaging profile not found', 404);
    return createPackagingProfile(db, {
        name: `${existing.name} (Copy)`,
        description: existing.description,
        notes: existing.notes,
        serving_type: existing.serving_type,
        packaging_type: existing.packaging_type,
        customer_charge_per_unit: existing.customer_charge_per_unit,
        is_active: true,
        is_default: false,
        components: existing.components.map((c) => ({
            material_id: c.material_id,
            quantity: c.quantity,
        })),
    }, actorUserId);
}
function deletePackagingProfile(db, id, actorUserId) {
    const existing = db.prepare('SELECT * FROM packaging_profiles WHERE id = ?').get(id);
    if (!existing)
        fail('Packaging profile not found', 404);
    const timestamp = (0, db_1.now)();
    db.prepare(`
    UPDATE packaging_profiles
    SET is_active = 0, is_default = 0, updated_at = ?, updated_by_user_id = ?
    WHERE id = ?
  `).run(timestamp, actorUserId, id);
}
// --- Product and Variant Assignments ---
function getProductPackagingAssignments(db) {
    const products = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.packaging_profile_id,
      p.no_packaging,
      prof.name AS packaging_profile_name
    FROM products p
    LEFT JOIN packaging_profiles prof ON prof.id = p.packaging_profile_id
    WHERE p.deleted_at IS NULL
    ORDER BY p.name COLLATE NOCASE
  `).all();
    const variants = db.prepare(`
    SELECT
      pv.id,
      pv.product_id,
      pv.name,
      pv.packaging_profile_id,
      pv.no_packaging,
      prof.name AS packaging_profile_name
    FROM product_variants pv
    LEFT JOIN packaging_profiles prof ON prof.id = pv.packaging_profile_id
    WHERE pv.is_active = 1
    ORDER BY pv.sort_order, pv.name COLLATE NOCASE
  `).all();
    const variantsByProductId = new Map();
    for (const v of variants) {
        const list = variantsByProductId.get(v.product_id) || [];
        list.push({
            variant_id: v.id,
            variant_name: v.name,
            packaging_profile_id: v.packaging_profile_id,
            profile_name: v.packaging_profile_name || null,
            no_packaging: Number(v.no_packaging) === 1,
        });
        variantsByProductId.set(v.product_id, list);
    }
    return products.map((p) => ({
        product_id: p.id,
        product_name: p.name,
        packaging_profile_id: p.packaging_profile_id,
        profile_name: p.packaging_profile_name || null,
        no_packaging: Number(p.no_packaging) === 1,
        variants: variantsByProductId.get(p.id) || [],
    }));
}
function setProductPackagingAssignment(db, productId, input) {
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL').get(productId);
    if (!product)
        fail('Product not found', 404);
    const noPackaging = input.no_packaging ? 1 : 0;
    const profileId = input.packaging_profile_id ? String(input.packaging_profile_id).trim() : null;
    if (profileId) {
        const profile = db.prepare('SELECT id, is_active FROM packaging_profiles WHERE id = ?').get(profileId);
        if (!profile || profile.is_active !== 1) {
            fail('Packaging profile is inactive or unavailable');
        }
    }
    db.prepare(`
    UPDATE products
    SET packaging_profile_id = ?, no_packaging = ?, updated_at = ?
    WHERE id = ?
  `).run(noPackaging ? null : profileId, noPackaging, (0, db_1.now)(), productId);
    return db.prepare(`
    SELECT p.id, p.name, p.packaging_profile_id, p.no_packaging, prof.name AS profile_name
    FROM products p
    LEFT JOIN packaging_profiles prof ON prof.id = p.packaging_profile_id
    WHERE p.id = ?
  `).get(productId);
}
function setVariantPackagingAssignment(db, variantId, input) {
    const variant = db.prepare('SELECT id, product_id FROM product_variants WHERE id = ?').get(variantId);
    if (!variant)
        fail('Product variant not found', 404);
    const noPackaging = input.no_packaging ? 1 : 0;
    const profileId = input.packaging_profile_id ? String(input.packaging_profile_id).trim() : null;
    if (profileId) {
        const profile = db.prepare('SELECT id, is_active FROM packaging_profiles WHERE id = ?').get(profileId);
        if (!profile || profile.is_active !== 1) {
            fail('Packaging profile is inactive or unavailable');
        }
    }
    db.prepare(`
    UPDATE product_variants
    SET packaging_profile_id = ?, no_packaging = ?, updated_at = ?
    WHERE id = ?
  `).run(noPackaging ? null : profileId, noPackaging, (0, db_1.now)(), variantId);
    return db.prepare(`
    SELECT pv.id, pv.name, pv.packaging_profile_id, pv.no_packaging, prof.name AS profile_name
    FROM product_variants pv
    LEFT JOIN packaging_profiles prof ON prof.id = pv.packaging_profile_id
    WHERE pv.id = ?
  `).get(variantId);
}
// --- Precedence Resolution Engine ---
function resolvePackagingProfile(db, params) {
    const { productId, variantId, explicitProfileId, servingType } = params;
    // 1. Explicit order-item packaging override
    if (explicitProfileId !== undefined && explicitProfileId !== null) {
        const trimmed = String(explicitProfileId).trim();
        if (trimmed === 'none' || trimmed === '__none__') {
            return { profile: null, noPackaging: true };
        }
        if (trimmed) {
            const profile = db.prepare('SELECT * FROM packaging_profiles WHERE id = ?').get(trimmed);
            if (!profile || profile.is_active !== 1) {
                fail('Packaging profile is inactive or unavailable');
            }
            if (profile.serving_type !== servingType || profile.packaging_type !== expectedType[servingType]) {
                fail('Packaging profile is incompatible with serving type');
            }
            return { profile, noPackaging: false };
        }
    }
    // 2. Variant-specific packaging profile
    if (variantId) {
        const variant = db.prepare('SELECT packaging_profile_id, no_packaging FROM product_variants WHERE id = ?').get(variantId);
        if (variant) {
            if (Number(variant.no_packaging) === 1) {
                return { profile: null, noPackaging: true };
            }
            if (variant.packaging_profile_id) {
                const profile = db.prepare('SELECT * FROM packaging_profiles WHERE id = ?').get(variant.packaging_profile_id);
                if (profile && profile.is_active === 1 && profile.serving_type === servingType) {
                    return { profile, noPackaging: false };
                }
            }
        }
    }
    // 3. Product-level default packaging profile
    if (productId) {
        const product = db.prepare('SELECT packaging_profile_id, no_packaging FROM products WHERE id = ?').get(productId);
        if (product) {
            if (Number(product.no_packaging) === 1) {
                return { profile: null, noPackaging: true };
            }
            if (product.packaging_profile_id) {
                const profile = db.prepare('SELECT * FROM packaging_profiles WHERE id = ?').get(product.packaging_profile_id);
                if (profile && profile.is_active === 1 && profile.serving_type === servingType) {
                    return { profile, noPackaging: false };
                }
            }
        }
    }
    // 4. Default serving profile fallback
    const defaultProfile = db.prepare(`
    SELECT * FROM packaging_profiles
    WHERE serving_type = ? AND is_active = 1 AND is_default = 1
  `).get(servingType);
    if (!defaultProfile) {
        fail(`An active default ${servingType === 'dine_in' ? 'paper plate' : 'parcel box'} profile is required`);
    }
    return { profile: defaultProfile, noPackaging: false };
}
// --- Packaging Preview & Snapshotting ---
function previewItemPackaging(db, raw, itemQuantity, productId, variantId, explicitProfileId) {
    return normalizeServingAllocations(raw, itemQuantity).reduce((total, allocation) => {
        const resolved = resolvePackagingProfile(db, {
            productId,
            variantId,
            explicitProfileId: allocation.packaging_profile_id || explicitProfileId,
            servingType: allocation.serving_type,
        });
        if (resolved.noPackaging || !resolved.profile) {
            return total;
        }
        const components = getProfileComponents(db, resolved.profile.id);
        const primaryQty = components.length > 0 ? components[0].quantity : Number(resolved.profile.units_per_serving || 1);
        const totalUnits = allocation.quantity * primaryQty;
        const charge = Number(resolved.profile.customer_charge_per_unit || 0) * totalUnits;
        if (!Number.isFinite(charge)) {
            fail('Calculated packaging charge is invalid');
        }
        return total + charge;
    }, 0);
}
function persistItemServingAndPackaging(args) {
    const allocations = normalizeServingAllocations(args.allocations, args.itemQuantity);
    let charge = 0;
    let productId = args.productId;
    let variantId = args.variantId;
    if (productId === undefined || variantId === undefined) {
        const itemRow = args.db.prepare('SELECT product_id, variant_id FROM order_items WHERE id = ?').get(args.orderItemId);
        if (itemRow) {
            if (productId === undefined)
                productId = itemRow.product_id;
            if (variantId === undefined)
                variantId = itemRow.variant_id;
        }
    }
    for (const allocation of allocations) {
        const serving = args.db.prepare(`
      INSERT INTO order_item_serving_allocations
        (order_item_id, serving_type, quantity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(args.orderItemId, allocation.serving_type, allocation.quantity, (0, db_1.now)(), (0, db_1.now)());
        const resolved = resolvePackagingProfile(args.db, {
            productId,
            variantId,
            explicitProfileId: allocation.packaging_profile_id || args.explicitProfileId,
            servingType: allocation.serving_type,
        });
        if (resolved.noPackaging || !resolved.profile) {
            continue;
        }
        const profile = resolved.profile;
        const components = getProfileComponents(args.db, profile.id);
        if (components.length === 0) {
            const legacyProfile = profileFor(args.db, profile.id, allocation.serving_type);
            const quantity = packagingQuantity(allocation.quantity, legacyProfile);
            const totalCost = legacyProfile.unit_cost === null ? null : Number((Number(legacyProfile.unit_cost) * quantity).toFixed(10));
            const customerCharge = Number((Number(legacyProfile.customer_charge_per_unit) * quantity).toFixed(10));
            args.db.prepare(`
        INSERT INTO order_item_packaging_allocations (
          serving_allocation_id, packaging_profile_id, supply_id_snapshot,
          packaging_name_snapshot, packaging_type_snapshot, unit_snapshot,
          quantity, unit_cost_snapshot, total_cost_snapshot, cost_known,
          customer_charge_per_unit_snapshot, customer_charge_total_snapshot,
          allocation_source, confirmed_by_user_id, confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'each', ?, ?, ?, ?, ?, ?, 'automatic', null, null, ?, ?)
      `).run(serving.lastInsertRowid, legacyProfile.id, legacyProfile.supply_id, legacyProfile.name, legacyProfile.packaging_type, quantity, legacyProfile.unit_cost, totalCost, legacyProfile.unit_cost === null ? 0 : 1, legacyProfile.customer_charge_per_unit, customerCharge, (0, db_1.now)(), (0, db_1.now)());
            charge += customerCharge;
        }
        else {
            let allocationTotalCharge = 0;
            let attributedCharge = false;
            for (const comp of components) {
                const compQuantity = allocation.quantity * comp.quantity;
                if (!Number.isFinite(compQuantity) || compQuantity <= 0) {
                    fail('Calculated packaging quantity is invalid');
                }
                const compTotalCost = comp.unit_cost === null ? null : Number((Number(comp.unit_cost) * compQuantity).toFixed(10));
                const compChargePerUnit = !attributedCharge ? Number(profile.customer_charge_per_unit || 0) : 0;
                const compChargeTotal = Number((compChargePerUnit * compQuantity).toFixed(10));
                if (!attributedCharge) {
                    allocationTotalCharge += compChargeTotal;
                    attributedCharge = true;
                }
                args.db.prepare(`
          INSERT INTO order_item_packaging_allocations (
            serving_allocation_id, packaging_profile_id, supply_id_snapshot,
            packaging_name_snapshot, packaging_type_snapshot, unit_snapshot,
            quantity, unit_cost_snapshot, total_cost_snapshot, cost_known,
            customer_charge_per_unit_snapshot, customer_charge_total_snapshot,
            allocation_source, confirmed_by_user_id, confirmed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'automatic', null, null, ?, ?)
        `).run(serving.lastInsertRowid, profile.id, comp.material_id, comp.material_name, comp.packaging_type || profile.packaging_type, comp.base_unit || 'each', compQuantity, comp.unit_cost, compTotalCost, comp.unit_cost === null ? 0 : 1, compChargePerUnit, compChargeTotal, (0, db_1.now)(), (0, db_1.now)());
            }
            charge += allocationTotalCharge;
        }
    }
    if (!Number.isFinite(charge)) {
        fail('Total packaging charge is invalid');
    }
    return charge;
}
// --- Order Packaging & Manual Adjustments ---
function getOrderPackaging(db, orderId) {
    const order = db.prepare(`
    SELECT o.id, o.status, o.packaging_charge, o.total, o.subtotal,
           b.id AS bill_id, b.payment_status AS bill_payment_status
    FROM orders o
    LEFT JOIN bills b ON b.order_id = o.id
    WHERE o.id = ?
    ORDER BY b.id DESC
    LIMIT 1
  `).get(orderId);
    if (!order)
        fail('Order not found', 404);
    const allocations = db.prepare(`
    SELECT
      p.id AS packaging_allocation_id,
      p.id,
      p.serving_allocation_id,
      s.order_item_id,
      i.product_id,
      i.product_name AS item_name,
      i.quantity AS item_quantity,
      s.serving_type,
      p.packaging_profile_id,
      prof.name AS profile_name,
      p.supply_id_snapshot,
      p.packaging_name_snapshot,
      p.packaging_name_snapshot AS material_name,
      p.packaging_type_snapshot,
      p.unit_snapshot,
      p.quantity AS packaging_quantity,
      p.quantity,
      p.unit_cost_snapshot,
      p.total_cost_snapshot,
      p.cost_known,
      p.customer_charge_per_unit_snapshot,
      p.customer_charge_total_snapshot,
      p.customer_charge_total_snapshot AS customer_charge,
      p.allocation_source,
      p.confirmed_by_user_id,
      u.name AS confirmed_by_name,
      p.confirmed_at,
      p.notes,
      p.created_at,
      p.updated_at
    FROM order_item_packaging_allocations p
    JOIN order_item_serving_allocations s ON s.id = p.serving_allocation_id
    JOIN order_items i ON i.id = s.order_item_id
    LEFT JOIN packaging_profiles prof ON prof.id = p.packaging_profile_id
    LEFT JOIN users u ON u.id = p.confirmed_by_user_id
    WHERE i.order_id = ? AND i.status NOT IN ('cancelled', 'voided', 'void_adjustment')
    ORDER BY p.id ASC
  `).all(orderId);
    const summaryMap = new Map();
    for (const a of allocations) {
        const sId = String(a.supply_id_snapshot);
        const existing = summaryMap.get(sId);
        if (!existing) {
            summaryMap.set(sId, {
                supply_id: sId,
                material_name: a.packaging_name_snapshot,
                unit: a.unit_snapshot || 'each',
                total_quantity: Number(a.quantity || 0),
                total_charge: Number(a.customer_charge || 0),
            });
        }
        else {
            existing.total_quantity += Number(a.quantity || 0);
            existing.total_charge += Number(a.customer_charge || 0);
        }
    }
    const summary = Array.from(summaryMap.values());
    const canAdjust = order.status !== 'cancelled' && order.status !== 'completed' && (!order.bill_payment_status || order.bill_payment_status !== 'paid');
    return {
        order_id: order.id,
        order_status: order.status,
        payment_status: order.bill_payment_status || 'unpaid',
        can_adjust: canAdjust,
        total_packaging_charge: Number(order.packaging_charge || 0),
        order: {
            id: order.id,
            status: order.status,
            packaging_charge: Number(order.packaging_charge || 0),
            total: Number(order.total || 0),
            subtotal: Number(order.subtotal || 0),
        },
        allocations,
        summary,
    };
}
function adjustOrderPackaging(db, input) {
    const order = db.prepare(`
    SELECT o.id, o.status, o.subtotal, o.tax_amount, o.packaging_charge,
           o.delivery_charge, o.service_charge, o.discount_amount, o.round_off, o.total,
           b.id AS bill_id, b.payment_status AS bill_payment_status
    FROM orders o
    LEFT JOIN bills b ON b.order_id = o.id
    WHERE o.id = ?
    ORDER BY b.id DESC
    LIMIT 1
  `).get(input.orderId);
    if (!order)
        fail('Order not found', 404);
    if (['cancelled', 'completed', 'settled'].includes(order.status) || order.bill_payment_status === 'paid') {
        fail('Cannot adjust packaging for settled or cancelled order');
    }
    if (!Array.isArray(input.adjustments) || input.adjustments.length === 0) {
        fail('adjustments array is required');
    }
    const timestamp = (0, db_1.now)();
    const actorUserId = input.actorUserId || 'system';
    db.transaction(() => {
        for (const adj of input.adjustments) {
            const targetMaterialId = adj.material_id || adj.supply_id;
            if (adj.packaging_allocation_id) {
                const alloc = db.prepare('SELECT * FROM order_item_packaging_allocations WHERE id = ?').get(adj.packaging_allocation_id);
                if (!alloc)
                    fail('Packaging allocation not found', 404);
                const newQty = Number(adj.quantity);
                if (!Number.isFinite(newQty))
                    fail('Invalid adjustment quantity');
                if (newQty <= 0) {
                    db.prepare('DELETE FROM order_item_packaging_allocations WHERE id = ?').run(adj.packaging_allocation_id);
                }
                else {
                    const totalCost = alloc.unit_cost_snapshot !== null ? Number((Number(alloc.unit_cost_snapshot) * newQty).toFixed(10)) : null;
                    const customerCharge = adj.customer_charge !== undefined
                        ? Number(adj.customer_charge)
                        : Number((Number(alloc.customer_charge_per_unit_snapshot) * newQty).toFixed(10));
                    db.prepare(`
            UPDATE order_item_packaging_allocations
            SET quantity = ?, total_cost_snapshot = ?, customer_charge_total_snapshot = ?,
                allocation_source = 'manual', confirmed_by_user_id = ?, confirmed_at = ?,
                notes = ?, updated_at = ?
            WHERE id = ?
          `).run(newQty, totalCost, customerCharge, actorUserId, timestamp, adj.notes || alloc.notes || null, timestamp, adj.packaging_allocation_id);
                }
            }
            else if (targetMaterialId) {
                const material = db.prepare('SELECT * FROM supplies WHERE id = ? AND deleted_at IS NULL AND is_active = 1').get(targetMaterialId);
                if (!material)
                    fail('Packaging material not found or inactive', 404);
                const qty = Number(adj.quantity);
                if (!Number.isFinite(qty) || qty <= 0)
                    fail('Packaging quantity must be positive');
                let servingAllocationId = null;
                if (adj.order_item_id) {
                    const s = db.prepare('SELECT id FROM order_item_serving_allocations WHERE order_item_id = ? ORDER BY id LIMIT 1').get(adj.order_item_id);
                    if (s)
                        servingAllocationId = s.id;
                }
                if (!servingAllocationId) {
                    const item = db.prepare("SELECT id FROM order_items WHERE order_id = ? AND status NOT IN ('cancelled', 'voided') ORDER BY id LIMIT 1").get(input.orderId);
                    if (!item)
                        fail('No active order items in order');
                    const s = db.prepare('SELECT id FROM order_item_serving_allocations WHERE order_item_id = ? ORDER BY id LIMIT 1').get(item.id);
                    if (!s) {
                        const ins = db.prepare(`
              INSERT INTO order_item_serving_allocations (order_item_id, serving_type, quantity, created_at, updated_at)
              VALUES (?, 'parcel', 1, ?, ?)
            `).run(item.id, timestamp, timestamp);
                        servingAllocationId = Number(ins.lastInsertRowid);
                    }
                    else {
                        servingAllocationId = s.id;
                    }
                }
                const defaultProfile = db.prepare('SELECT id FROM packaging_profiles WHERE is_active = 1 LIMIT 1').get();
                const profileId = defaultProfile ? defaultProfile.id : db.prepare('SELECT id FROM packaging_profiles LIMIT 1').get()?.id;
                const unitCost = material.unit_cost !== null && material.unit_cost !== undefined ? Number(material.unit_cost) : null;
                const totalCost = unitCost !== null ? Number((unitCost * qty).toFixed(10)) : null;
                const customerChargeTotal = adj.customer_charge !== undefined ? Number(adj.customer_charge) : 0;
                const customerChargePerUnit = qty > 0 ? Number((customerChargeTotal / qty).toFixed(10)) : 0;
                db.prepare(`
          INSERT INTO order_item_packaging_allocations (
            serving_allocation_id, packaging_profile_id, supply_id_snapshot,
            packaging_name_snapshot, packaging_type_snapshot, unit_snapshot,
            quantity, unit_cost_snapshot, total_cost_snapshot, cost_known,
            customer_charge_per_unit_snapshot, customer_charge_total_snapshot,
            allocation_source, confirmed_by_user_id, confirmed_at, notes,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'manual_adjustment', ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)
        `).run(servingAllocationId, profileId, material.id, material.name, material.base_unit || 'each', qty, unitCost, totalCost, unitCost !== null ? 1 : 0, customerChargePerUnit, customerChargeTotal, actorUserId, timestamp, adj.notes || 'Manual packaging adjustment', timestamp, timestamp);
            }
            else {
                fail('Adjustment must specify packaging_allocation_id or material_id');
            }
        }
        const packagingSumRow = db.prepare(`
      SELECT COALESCE(SUM(p.customer_charge_total_snapshot), 0) AS total
      FROM order_item_packaging_allocations p
      JOIN order_item_serving_allocations s ON s.id = p.serving_allocation_id
      JOIN order_items i ON i.id = s.order_item_id
      WHERE i.order_id = ? AND COALESCE(i.status, 'pending') NOT IN ('cancelled', 'voided', 'void_adjustment')
    `).get(input.orderId);
        const newPackagingCharge = Number(packagingSumRow?.total || 0);
        const newTotal = Number((Number(order.subtotal) +
            Number(order.tax_amount || 0) +
            newPackagingCharge +
            Number(order.delivery_charge || 0) +
            Number(order.service_charge || 0) -
            Number(order.discount_amount || 0) +
            Number(order.round_off || 0)).toFixed(2));
        db.prepare(`
      UPDATE orders
      SET packaging_charge = ?, total = ?, updated_at = ?
      WHERE id = ?
    `).run(newPackagingCharge, newTotal, timestamp, input.orderId);
    })();
    return getOrderPackaging(db, input.orderId);
}
// --- Dashboard ---
function getPackagingDashboard(db) {
    const totalMaterials = db.prepare(`
    SELECT COUNT(*) AS count FROM supplies WHERE is_packaging = 1 AND deleted_at IS NULL AND is_active = 1
  `).get()?.count || 0;
    const lowStockMaterials = db.prepare(`
    SELECT COUNT(*) AS count FROM supplies
    WHERE is_packaging = 1 AND deleted_at IS NULL AND is_active = 1
      AND low_stock_threshold IS NOT NULL AND stock_quantity <= low_stock_threshold
  `).get()?.count || 0;
    const activeProfiles = db.prepare(`
    SELECT COUNT(*) AS count FROM packaging_profiles WHERE is_active = 1
  `).get()?.count || 0;
    const assignedProductsCount = db.prepare(`
    SELECT COUNT(*) AS count FROM products
    WHERE (packaging_profile_id IS NOT NULL OR no_packaging = 1) AND deleted_at IS NULL
  `).get()?.count || 0;
    const lowStockItems = db.prepare(`
    SELECT id, name, sku, category, base_unit, stock_quantity, low_stock_threshold, unit_cost
    FROM supplies
    WHERE is_packaging = 1 AND deleted_at IS NULL AND is_active = 1
      AND low_stock_threshold IS NOT NULL AND stock_quantity <= low_stock_threshold
    ORDER BY stock_quantity ASC
    LIMIT 20
  `).all();
    const recentMovements = db.prepare(`
    SELECT
      sm.id,
      sm.supply_id,
      s.name AS material_name,
      sm.quantity_delta,
      sm.movement_type,
      sm.unit,
      sm.stock_after,
      sm.reason,
      sm.actor_user_id,
      sm.created_at
    FROM supply_movements sm
    JOIN supplies s ON s.id = sm.supply_id
    WHERE s.is_packaging = 1
    ORDER BY sm.id DESC
    LIMIT 15
  `).all();
    return {
        total_materials: totalMaterials,
        low_stock_materials: lowStockMaterials,
        active_profiles: activeProfiles,
        assigned_products_count: assignedProductsCount,
        low_stock_items: lowStockItems,
        recent_movements: recentMovements,
    };
}
//# sourceMappingURL=packaging.js.map