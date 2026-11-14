"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addonGroupRoutes = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const db_1 = require("../db");
const crypto_1 = require("crypto");
const authorization_1 = require("../services/authorization");
const cloud_sync_1 = require("../services/cloud-sync");
const operation_failure_1 = require("../lib/operation-failure");
const inventory_1 = require("../services/inventory");
const tax_1 = require("../services/tax");
const VALID_TAX_BEHAVIORS = ['country_default', 'inclusive', 'exclusive', 'exempt'];
const router = (0, express_1.Router)();
function captureSelectionBoundsRejection() {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.addon_group.selection_bounds',
        outcome: 'not_applied',
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change the add-on selection response.
    }
}
function captureAddonGroupInputValidation() {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.addon_group.input_validation',
        outcome: 'not_applied',
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change add-on validation responses.
    }
}
const addonGroupReadRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
const addonGroupWriteRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
});
function hasOwn(body, field) {
    return Object.prototype.hasOwnProperty.call(body, field);
}
function toBoolean(value) {
    return value === true || value === 1;
}
function normalizeBoolean(value, defaultValue = true) {
    if (value === undefined || value === null || value === '')
        return defaultValue;
    if (value === true || value === 1)
        return true;
    if (value === false || value === 0)
        return false;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(normalized))
            return true;
        if (['false', '0', 'no', 'n'].includes(normalized))
            return false;
    }
    return Boolean(value);
}
function parseName(value, field, errors) {
    if (typeof value !== 'string' || value.trim() === '') {
        errors[field] = [`${field} is required`];
        return '';
    }
    return value.trim();
}
function parseNonNegativeNumber(value, field, errors, defaultValue) {
    if ((value === undefined || value === null || value === '') && defaultValue !== undefined)
        return defaultValue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        errors[field] = [`${field} must be a finite non-negative number`];
        return defaultValue ?? 0;
    }
    return numeric;
}
function parseNonNegativeInteger(value, field, errors, defaultValue) {
    if (value === undefined || value === null || value === '')
        return defaultValue;
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0) {
        errors[field] = [`${field} must be a non-negative integer`];
        return defaultValue;
    }
    return numeric;
}
/** Falls back to the stored row so an omitted field keeps its current value on update. */
function parseAddonInventoryFields(addon, prefix, errors, existing) {
    const field = (name) => (prefix ? `${prefix}.${name}` : name);
    const track_inventory = hasOwn(addon ?? {}, 'track_inventory')
        ? normalizeBoolean(addon?.track_inventory, false)
        : Boolean(Number(existing?.track_inventory ?? 0));
    return {
        track_inventory,
        stock_quantity: parseNonNegativeNumber(addon?.stock_quantity, field('stock_quantity'), errors, Number(existing?.stock_quantity ?? 0)),
        low_stock_threshold: parseNonNegativeNumber(addon?.low_stock_threshold, field('low_stock_threshold'), errors, Number(existing?.low_stock_threshold ?? 0)),
        hasStockQuantity: hasOwn(addon ?? {}, 'stock_quantity') &&
            addon?.stock_quantity !== null &&
            addon?.stock_quantity !== undefined,
    };
}
/**
 * A stock change is a ledger event, never a silent overwrite: the add-on pool has
 * to reconcile against its own movements or restore validation rejects the store.
 */
function applyAddonStockAdjustment(db, addonId, requestedStock, actorUserId, referenceType) {
    const current = db.prepare('SELECT stock_quantity FROM addons WHERE id = ?').get(addonId);
    if (!current)
        return;
    const quantityDelta = requestedStock - Number(current.stock_quantity ?? 0);
    if (quantityDelta === 0)
        return;
    (0, inventory_1.adjustProductStock)(db, {
        productId: null,
        addonId,
        quantityDelta,
        movementType: 'adjustment',
        referenceType,
        referenceId: addonId,
        reason: referenceType === 'opening_balance' ? 'Opening add-on stock' : 'Manual add-on stock update',
        actorUserId,
    });
}
function validationErrorResponse(res, errors) {
    if (Object.keys(errors).length === 0)
        return null;
    captureAddonGroupInputValidation();
    return res.status(400).json({ errors });
}
function serializeAddon(addon) {
    if (!addon)
        return addon;
    return {
        ...addon,
        is_active: toBoolean(addon.is_active),
        inherit_parent_tax_category: toBoolean(addon.inherit_parent_tax_category),
        track_inventory: toBoolean(addon.track_inventory),
        stock_quantity: Number(addon.stock_quantity ?? 0),
        low_stock_threshold: Number(addon.low_stock_threshold ?? 0),
    };
}
function serializeAddonGroup(group) {
    if (!group)
        return group;
    return {
        ...group,
        is_required: toBoolean(group.is_required),
        allow_multiple_quantities: toBoolean(group.allow_multiple_quantities),
        is_active: toBoolean(group.is_active),
        addons: Array.isArray(group.addons) ? group.addons.map(serializeAddon) : group.addons,
    };
}
function invalidTaxBehavior(addons) {
    if (!Array.isArray(addons))
        return null;
    for (const addon of addons) {
        if (addon?.tax_behavior !== undefined &&
            addon.tax_behavior !== null &&
            !VALID_TAX_BEHAVIORS.includes(addon.tax_behavior)) {
            return `tax_behavior must be one of: ${VALID_TAX_BEHAVIORS.join(', ')}`;
        }
    }
    return null;
}
function invalidTaxCategory(addons) {
    if (!Array.isArray(addons))
        return null;
    const country = (0, db_1.getSettingValue)('country') || '';
    const businessType = (0, db_1.getSettingValue)('business_type') || 'restaurant';
    const pack = (0, tax_1.getActiveCountryPack)(country);
    for (const addon of addons) {
        const categoryId = addon?.tax_category_id;
        if (categoryId === null || categoryId === undefined || categoryId === '')
            continue;
        if (typeof categoryId !== 'string')
            return 'tax_category_id must be a string or null';
        if (!(0, tax_1.hasConfiguredTaxCategories)(pack, businessType)) {
            return `No configured tax categories are available for country ${country} and business type ${businessType}`;
        }
        if (!pack.categories.some((category) => category.id === categoryId)) {
            return `Unknown tax_category_id "${categoryId}" for country ${country}`;
        }
    }
    return null;
}
function validateSelectionBounds(minSelection, maxSelection, activeAddonCount) {
    if (minSelection > maxSelection) {
        return { min_selection: ['Minimum selection cannot exceed maximum selection'] };
    }
    if (minSelection > activeAddonCount) {
        return {
            min_selection: [
                `Minimum selection cannot exceed the number of active add-ons (${activeAddonCount})`,
            ],
        };
    }
    return null;
}
// Guards against deactivating/deleting the last addon(s) that a group's min_selection depends on.
function wouldBreakMinSelection(db, groupId, excludeAddonId) {
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(groupId);
    if (!group)
        return null;
    const remaining = db
        .prepare('SELECT COUNT(*) as count FROM addons WHERE addon_group_id = ? AND is_active = 1 AND id != ?')
        .get(groupId, excludeAddonId).count;
    if (remaining < group.min_selection) {
        return {
            min_selection: [
                `Cannot remove this addon — only ${remaining} would remain active, below the group's minimum selection of ${group.min_selection}. Lower the minimum selection first.`,
            ],
        };
    }
    return null;
}
router.get('/', addonGroupReadRateLimit, (0, authorization_1.requirePermission)('catalog.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const includeInactive = req.query.include_inactive === 'true' &&
            (0, authorization_1.hasPermission)(req.user?.userId || '', 'catalog.manage');
        const groups = db
            .prepare(`
      SELECT * FROM addon_groups ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, name
    `)
            .all();
        const groupsWithAddons = groups.map((group) => {
            const addons = db
                .prepare('SELECT * FROM addons WHERE addon_group_id = ? AND is_active = 1 ORDER BY sort_order, name')
                .all(group.id);
            return serializeAddonGroup({ ...group, addons });
        });
        res.json({ addon_groups: groupsWithAddons });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/:id', addonGroupReadRateLimit, (0, authorization_1.requirePermission)('catalog.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Addon group not found' });
        }
        const addons = db
            .prepare('SELECT * FROM addons WHERE addon_group_id = ? ORDER BY sort_order, name')
            .all(req.params.id);
        res.json({ addon_group: serializeAddonGroup({ ...group, addons }) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/', addonGroupWriteRateLimit, (0, authorization_1.requirePermission)('catalog.manage'), (req, res) => {
    try {
        const { name, description, is_required, min_selection, max_selection, allow_multiple_quantities, sort_order, is_active, addons, } = req.body;
        const errors = {};
        const groupName = parseName(name, 'name', errors);
        const min = parseNonNegativeInteger(min_selection, 'min_selection', errors, 0);
        const max = parseNonNegativeInteger(max_selection, 'max_selection', errors, 1);
        const order = parseNonNegativeInteger(sort_order, 'sort_order', errors, 0);
        if (addons !== undefined && !Array.isArray(addons)) {
            errors.addons = ['addons must be an array'];
        }
        const normalizedAddons = Array.isArray(addons)
            ? addons.map((addon, index) => {
                const addonErrors = {};
                const addonName = parseName(addon?.name, `addons.${index}.name`, addonErrors);
                const price = parseNonNegativeNumber(addon?.price, `addons.${index}.price`, addonErrors, 0);
                const inventory = parseAddonInventoryFields(addon, `addons.${index}`, addonErrors);
                Object.assign(errors, addonErrors);
                return {
                    ...addon,
                    name: addonName,
                    price,
                    is_active: normalizeBoolean(addon?.is_active, true),
                    track_inventory: inventory.track_inventory,
                    stock_quantity: inventory.stock_quantity,
                    low_stock_threshold: inventory.low_stock_threshold,
                    has_stock_quantity: inventory.hasStockQuantity,
                };
            })
            : [];
        const activeAddonCount = normalizedAddons.filter((a) => a.is_active).length;
        const validationResponse = validationErrorResponse(res, errors);
        if (validationResponse)
            return validationResponse;
        const boundsError = validateSelectionBounds(min, max, activeAddonCount);
        if (boundsError) {
            captureSelectionBoundsRejection();
            return res.status(400).json({ errors: boundsError });
        }
        const taxBehaviorError = invalidTaxBehavior(normalizedAddons);
        if (taxBehaviorError) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: taxBehaviorError });
        }
        const taxCategoryError = invalidTaxCategory(normalizedAddons);
        if (taxCategoryError) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: taxCategoryError });
        }
        const db = (0, db_1.getDatabase)();
        const actorUserId = String(req.user?.userId || '');
        const groupId = (0, crypto_1.randomUUID)();
        const { group, groupAddons } = (0, db_1.withTxn)(() => {
            db.prepare(`
        INSERT INTO addon_groups (id, name, description, is_required, min_selection, max_selection, allow_multiple_quantities, sort_order, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(groupId, groupName, description || null, normalizeBoolean(is_required, false) ? 1 : 0, min, max, normalizeBoolean(allow_multiple_quantities, false) ? 1 : 0, order, normalizeBoolean(is_active, true) ? 1 : 0, (0, db_1.now)(), (0, db_1.now)());
            if (normalizedAddons.length > 0) {
                const insertAddon = db.prepare(`
          INSERT INTO addons (id, addon_group_id, name, price, tax_category_id, tax_behavior, inherit_parent_tax_category, track_inventory, stock_quantity, low_stock_threshold, is_active, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
        `);
                normalizedAddons.forEach((addon, index) => {
                    const addonId = (0, crypto_1.randomUUID)();
                    insertAddon.run(addonId, groupId, addon.name, addon.price || 0, addon.tax_category_id || null, addon.tax_behavior || 'country_default', addon.inherit_parent_tax_category !== false ? 1 : 0, addon.track_inventory ? 1 : 0, addon.low_stock_threshold, addon.is_active ? 1 : 0, index, (0, db_1.now)(), (0, db_1.now)());
                    if (addon.has_stock_quantity) {
                        applyAddonStockAdjustment(db, addonId, addon.stock_quantity, actorUserId, 'opening_balance');
                    }
                });
            }
            return {
                group: db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(groupId),
                groupAddons: db.prepare('SELECT * FROM addons WHERE addon_group_id = ?').all(groupId),
            };
        });
        res.status(201).json({
            addon_group: serializeAddonGroup(Object.assign({}, group, { addons: groupAddons })),
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/:id', addonGroupWriteRateLimit, (0, authorization_1.requirePermission)('catalog.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Addon group not found' });
        }
        const { name, description, is_required, min_selection, max_selection, allow_multiple_quantities, sort_order, is_active, addons, } = req.body;
        const errors = {};
        const groupName = name === undefined ? null : parseName(name, 'name', errors);
        const effectiveMin = parseNonNegativeInteger(min_selection, 'min_selection', errors, group.min_selection);
        const effectiveMax = parseNonNegativeInteger(max_selection, 'max_selection', errors, group.max_selection);
        const order = parseNonNegativeInteger(sort_order, 'sort_order', errors, group.sort_order);
        if (addons !== undefined && !Array.isArray(addons)) {
            errors.addons = ['addons must be an array'];
        }
        const existingAddonRows = db
            .prepare('SELECT * FROM addons WHERE addon_group_id = ?')
            .all(req.params.id);
        const existingAddonIds = new Set(existingAddonRows.map((addon) => addon.id));
        const existingAddonById = new Map(existingAddonRows.map((addon) => [addon.id, addon]));
        const normalizedAddons = Array.isArray(addons)
            ? addons.map((addon, index) => {
                const addonErrors = {};
                const addonName = parseName(addon?.name, `addons.${index}.name`, addonErrors);
                const price = parseNonNegativeNumber(addon?.price, `addons.${index}.price`, addonErrors, 0);
                if (addon?.id !== undefined &&
                    (typeof addon.id !== 'string' || !existingAddonIds.has(addon.id))) {
                    addonErrors[`addons.${index}.id`] = ['addon id must belong to this group'];
                }
                const inventory = parseAddonInventoryFields(addon, `addons.${index}`, addonErrors, addon?.id ? existingAddonById.get(addon.id) : undefined);
                Object.assign(errors, addonErrors);
                return {
                    ...addon,
                    name: addonName,
                    price,
                    is_active: normalizeBoolean(addon?.is_active, true),
                    track_inventory: inventory.track_inventory,
                    stock_quantity: inventory.stock_quantity,
                    low_stock_threshold: inventory.low_stock_threshold,
                    has_stock_quantity: inventory.hasStockQuantity,
                };
            })
            : null;
        const validationResponse = validationErrorResponse(res, errors);
        if (validationResponse)
            return validationResponse;
        const activeAddonCount = Array.isArray(addons)
            ? normalizedAddons.filter((a) => a.is_active).length
            : db
                .prepare('SELECT COUNT(*) as count FROM addons WHERE addon_group_id = ? AND is_active = 1')
                .get(req.params.id).count;
        const boundsError = validateSelectionBounds(effectiveMin, effectiveMax, activeAddonCount);
        if (boundsError) {
            captureSelectionBoundsRejection();
            return res.status(400).json({ errors: boundsError });
        }
        const taxBehaviorError = invalidTaxBehavior(normalizedAddons || undefined);
        if (taxBehaviorError) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: taxBehaviorError });
        }
        const taxCategoryError = invalidTaxCategory(normalizedAddons || undefined);
        if (taxCategoryError) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: taxCategoryError });
        }
        const reqName = groupName;
        const hasDescription = hasOwn(req.body, 'description');
        const reqDesc = description === undefined || description === null || description === ''
            ? null
            : description;
        const reqReq = is_required === undefined ? null : normalizeBoolean(is_required, false) ? 1 : 0;
        const reqMin = min_selection === undefined ? null : effectiveMin;
        const reqMax = max_selection === undefined ? null : effectiveMax;
        const reqAllowMult = allow_multiple_quantities === undefined
            ? null
            : normalizeBoolean(allow_multiple_quantities, false)
                ? 1
                : 0;
        const reqSort = sort_order === undefined ? null : order;
        const reqActive = is_active === undefined ? null : normalizeBoolean(is_active, true) ? 1 : 0;
        const actorUserId = String(req.user?.userId || '');
        const { updated, updatedAddons } = (0, db_1.withTxn)(() => {
            db.prepare(`
        UPDATE addon_groups SET name = COALESCE(?, name), description = CASE WHEN ? = 1 THEN ? ELSE description END,
          is_required = COALESCE(?, is_required), min_selection = COALESCE(?, min_selection),
          max_selection = COALESCE(?, max_selection), allow_multiple_quantities = COALESCE(?, allow_multiple_quantities),
          sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active), updated_at = ?
        WHERE id = ?
      `).run(reqName, hasDescription ? 1 : 0, reqDesc, reqReq, reqMin, reqMax, reqAllowMult, reqSort, reqActive, (0, db_1.now)(), req.params.id);
            if (normalizedAddons) {
                const touchedIds = new Set();
                const updateAddon = db.prepare(`
          UPDATE addons SET name = ?, price = ?, tax_category_id = ?, tax_behavior = ?,
            inherit_parent_tax_category = ?, track_inventory = ?, low_stock_threshold = ?,
            is_active = ?, sort_order = ?, updated_at = ?
          WHERE id = ? AND addon_group_id = ?
        `);
                const insertAddon = db.prepare(`
          INSERT INTO addons (id, addon_group_id, name, price, tax_category_id, tax_behavior, inherit_parent_tax_category, track_inventory, stock_quantity, low_stock_threshold, is_active, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
        `);
                normalizedAddons.forEach((addon, index) => {
                    const addonId = addon.id || (0, crypto_1.randomUUID)();
                    touchedIds.add(addonId);
                    const values = [
                        addon.name,
                        addon.price,
                        addon.tax_category_id || null,
                        addon.tax_behavior || 'country_default',
                        addon.inherit_parent_tax_category !== false ? 1 : 0,
                        addon.track_inventory ? 1 : 0,
                        addon.low_stock_threshold,
                        addon.is_active ? 1 : 0,
                        index,
                        (0, db_1.now)(),
                    ];
                    if (addon.id) {
                        updateAddon.run(...values, addonId, req.params.id);
                    }
                    else {
                        insertAddon.run(addonId, req.params.id, ...values.slice(0, -1), (0, db_1.now)(), (0, db_1.now)());
                    }
                    if (addon.has_stock_quantity) {
                        applyAddonStockAdjustment(db, addonId, addon.stock_quantity, actorUserId, addon.id ? 'manual_adjustment' : 'opening_balance');
                    }
                });
                for (const existingAddon of existingAddonRows) {
                    if (!touchedIds.has(existingAddon.id) && existingAddon.is_active) {
                        db.prepare('UPDATE addons SET is_active = 0, updated_at = ? WHERE id = ?').run((0, db_1.now)(), existingAddon.id);
                    }
                }
            }
            return {
                updated: db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id),
                updatedAddons: db
                    .prepare('SELECT * FROM addons WHERE addon_group_id = ?')
                    .all(req.params.id),
            };
        });
        res.json({
            addon_group: serializeAddonGroup(Object.assign({}, updated, { addons: updatedAddons })),
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.delete('/:id', addonGroupWriteRateLimit, (0, authorization_1.requirePermission)('catalog.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Addon group not found' });
        }
        // Soft delete to avoid dangling references in historical records.
        db.prepare('UPDATE addon_groups SET is_active = 0, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.id);
        res.json({ message: 'Addon group deleted' });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Addon management within a group
router.post('/:groupId/addons', addonGroupWriteRateLimit, (0, authorization_1.requirePermission)('catalog.manage'), (req, res) => {
    try {
        const { name, price, tax_category_id, tax_behavior, inherit_parent_tax_category, is_active, sort_order, } = req.body;
        const errors = {};
        const addonName = parseName(name, 'name', errors);
        const addonPrice = parseNonNegativeNumber(price, 'price', errors);
        const addonActive = normalizeBoolean(is_active, true);
        const addonSort = parseNonNegativeInteger(sort_order, 'sort_order', errors, 0);
        const inventory = parseAddonInventoryFields(req.body, '', errors);
        const validationResponse = validationErrorResponse(res, errors);
        if (validationResponse)
            return validationResponse;
        if (tax_behavior !== undefined &&
            tax_behavior !== null &&
            !VALID_TAX_BEHAVIORS.includes(tax_behavior)) {
            captureAddonGroupInputValidation();
            return res
                .status(400)
                .json({ error: `tax_behavior must be one of: ${VALID_TAX_BEHAVIORS.join(', ')}` });
        }
        const taxCategoryError = invalidTaxCategory([{ tax_category_id }]);
        if (taxCategoryError) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: taxCategoryError });
        }
        const db = (0, db_1.getDatabase)();
        const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.groupId);
        if (!group) {
            return res.status(404).json({ error: 'Addon group not found' });
        }
        if (!group.is_active) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: 'Cannot add add-ons to an inactive group' });
        }
        if (addonActive) {
            const activeAddonCount = db
                .prepare('SELECT COUNT(*) as count FROM addons WHERE addon_group_id = ? AND is_active = 1')
                .get(req.params.groupId).count + 1;
            const boundsError = validateSelectionBounds(group.min_selection, group.max_selection, activeAddonCount);
            if (boundsError) {
                captureSelectionBoundsRejection();
                return res.status(400).json({ errors: boundsError });
            }
        }
        const addonId = (0, crypto_1.randomUUID)();
        const actorUserId = String(req.user?.userId || '');
        (0, db_1.withTxn)(() => {
            db.prepare(`
        INSERT INTO addons (id, addon_group_id, name, price, tax_category_id, tax_behavior, inherit_parent_tax_category, track_inventory, stock_quantity, low_stock_threshold, is_active, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(addonId, req.params.groupId, addonName, addonPrice, tax_category_id || null, tax_behavior || 'country_default', inherit_parent_tax_category !== false ? 1 : 0, inventory.track_inventory ? 1 : 0, inventory.low_stock_threshold, addonActive ? 1 : 0, addonSort, (0, db_1.now)(), (0, db_1.now)());
            if (inventory.hasStockQuantity) {
                applyAddonStockAdjustment(db, addonId, inventory.stock_quantity, actorUserId, 'opening_balance');
            }
        });
        const addon = db.prepare('SELECT * FROM addons WHERE id = ?').get(addonId);
        res.status(201).json({ addon: serializeAddon(addon) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/:groupId/addons/:addonId', addonGroupWriteRateLimit, (0, authorization_1.requirePermission)('catalog.manage'), (req, res) => {
    try {
        const { name, price, tax_category_id, tax_behavior, inherit_parent_tax_category, is_active, sort_order, } = req.body;
        const errors = {};
        const addonName = name === undefined ? null : parseName(name, 'name', errors);
        const addonPrice = price === undefined ? null : parseNonNegativeNumber(price, 'price', errors);
        const addonSort = sort_order === undefined
            ? null
            : parseNonNegativeInteger(sort_order, 'sort_order', errors, 0);
        const addonActive = is_active === undefined ? null : normalizeBoolean(is_active, true);
        const inventory = parseAddonInventoryFields(req.body, '', errors);
        const validationResponse = validationErrorResponse(res, errors);
        if (validationResponse)
            return validationResponse;
        if (tax_behavior !== undefined &&
            tax_behavior !== null &&
            !VALID_TAX_BEHAVIORS.includes(tax_behavior)) {
            captureAddonGroupInputValidation();
            return res
                .status(400)
                .json({ error: `tax_behavior must be one of: ${VALID_TAX_BEHAVIORS.join(', ')}` });
        }
        const taxCategoryError = invalidTaxCategory([{ tax_category_id }]);
        if (taxCategoryError) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: taxCategoryError });
        }
        const db = (0, db_1.getDatabase)();
        const addon = db
            .prepare('SELECT * FROM addons WHERE id = ? AND addon_group_id = ?')
            .get(req.params.addonId, req.params.groupId);
        if (!addon) {
            return res.status(404).json({ error: 'Addon not found' });
        }
        const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.groupId);
        if (!group || !group.is_active) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: 'Cannot update add-ons for an inactive group' });
        }
        const hasTaxCategoryId = 'tax_category_id' in req.body;
        const actorUserId = String(req.user?.userId || '');
        const updatedAtomically = (0, db_1.withTxn)(() => {
            const current = db
                .prepare('SELECT is_active FROM addons WHERE id = ? AND addon_group_id = ?')
                .get(req.params.addonId, req.params.groupId);
            if (!current)
                return false;
            if (addonActive === false && current.is_active) {
                const boundsError = wouldBreakMinSelection(db, req.params.groupId, req.params.addonId);
                if (boundsError)
                    return boundsError;
            }
            db.prepare(`
        UPDATE addons SET name = COALESCE(?, name), price = COALESCE(?, price),
          tax_category_id = CASE WHEN ? = 1 THEN ? ELSE tax_category_id END,
          tax_behavior = COALESCE(?, tax_behavior),
          inherit_parent_tax_category = COALESCE(?, inherit_parent_tax_category),
          track_inventory = COALESCE(?, track_inventory),
          low_stock_threshold = COALESCE(?, low_stock_threshold),
          is_active = COALESCE(?, is_active), sort_order = COALESCE(?, sort_order)
        WHERE id = ?
      `).run(addonName, addonPrice, hasTaxCategoryId ? 1 : 0, tax_category_id, tax_behavior, inherit_parent_tax_category === undefined ? null : inherit_parent_tax_category ? 1 : 0, hasOwn(req.body, 'track_inventory') ? (inventory.track_inventory ? 1 : 0) : null, hasOwn(req.body, 'low_stock_threshold') &&
                req.body.low_stock_threshold !== null &&
                req.body.low_stock_threshold !== undefined
                ? inventory.low_stock_threshold
                : null, addonActive === null ? null : addonActive ? 1 : 0, addonSort, req.params.addonId);
            if (inventory.hasStockQuantity) {
                applyAddonStockAdjustment(db, req.params.addonId, inventory.stock_quantity, actorUserId, 'manual_adjustment');
            }
            return true;
        });
        if (updatedAtomically !== true) {
            if (updatedAtomically === false)
                return res.status(404).json({ error: 'Addon not found' });
            captureSelectionBoundsRejection();
            return res.status(400).json({ errors: updatedAtomically });
        }
        const updated = db.prepare('SELECT * FROM addons WHERE id = ?').get(req.params.addonId);
        res.json({ addon: serializeAddon(updated) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.delete('/:groupId/addons/:addonId', addonGroupWriteRateLimit, (0, authorization_1.requirePermission)('catalog.manage'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.groupId);
        if (!group || !group.is_active) {
            captureAddonGroupInputValidation();
            return res.status(400).json({ error: 'Cannot delete add-ons from an inactive group' });
        }
        const addon = db
            .prepare('SELECT * FROM addons WHERE id = ? AND addon_group_id = ?')
            .get(req.params.addonId, req.params.groupId);
        if (!addon) {
            return res.status(404).json({ error: 'Addon not found' });
        }
        const deletedAtomically = (0, db_1.withTxn)(() => {
            const current = db
                .prepare('SELECT is_active FROM addons WHERE id = ? AND addon_group_id = ?')
                .get(req.params.addonId, req.params.groupId);
            if (!current)
                return false;
            if (current.is_active) {
                const boundsError = wouldBreakMinSelection(db, req.params.groupId, req.params.addonId);
                if (boundsError)
                    return boundsError;
            }
            db.prepare('UPDATE addons SET is_active = 0, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.addonId);
            return true;
        });
        if (deletedAtomically !== true) {
            if (deletedAtomically === false)
                return res.status(404).json({ error: 'Addon not found' });
            captureSelectionBoundsRejection();
            return res.status(400).json({ errors: deletedAtomically });
        }
        res.json({ message: 'Addon deleted' });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.addonGroupRoutes = router;
//# sourceMappingURL=addon-groups.js.map