"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecipeServiceError = void 0;
exports.getRecipeByProduct = getRecipeByProduct;
exports.getRecipe = getRecipe;
exports.listRecipes = listRecipes;
exports.saveRecipe = saveRecipe;
exports.deleteRecipe = deleteRecipe;
exports.buildRecipeSnapshot = buildRecipeSnapshot;
exports.scaleRecipeSnapshot = scaleRecipeSnapshot;
exports.extractOrderItemCostFromSnapshot = extractOrderItemCostFromSnapshot;
exports.parseRecipeSnapshot = parseRecipeSnapshot;
exports.applyRecipeSnapshot = applyRecipeSnapshot;
const crypto_1 = require("crypto");
const decimal_js_1 = __importDefault(require("decimal.js"));
const db_1 = require("../db");
const units_1 = require("./units");
const supplies_1 = require("./supplies");
class RecipeServiceError extends Error {
    statusCode;
    diagnosticCode;
    constructor(statusCode, message, diagnosticCode) {
        super(message);
        this.name = 'RecipeServiceError';
        this.statusCode = statusCode;
        this.diagnosticCode = diagnosticCode;
    }
}
exports.RecipeServiceError = RecipeServiceError;
function newId(prefix) {
    return `${prefix}_${(0, crypto_1.randomBytes)(12).toString('hex')}`;
}
function assertPositiveFinite(value, field, diagnosticCode) {
    const quantity = typeof value === 'string' ? Number(value) : value;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
        throw new RecipeServiceError(400, `${field} must be a finite number`, diagnosticCode);
    }
    if (quantity <= 0) {
        throw new RecipeServiceError(400, `${field} must be greater than zero`, diagnosticCode);
    }
    return quantity;
}
function loadRecipeItems(db, recipeId) {
    const rows = db
        .prepare(`
    SELECT
      ri.supply_id,
      s.name AS supply_name,
      s.base_unit,
      s.unit_cost AS supply_unit_cost,
      ri.quantity,
      ri.unit
    FROM recipe_items ri
    JOIN supplies s ON s.id = ri.supply_id
    WHERE ri.recipe_id = ?
    ORDER BY ri.created_at, ri.id
  `)
        .all(recipeId);
    return rows.map((row) => {
        const quantityInBase = (0, units_1.convertQuantity)(row.quantity, row.unit, row.base_unit);
        const supplyUnitCost = row.supply_unit_cost === null || row.supply_unit_cost === undefined
            ? null
            : Number(row.supply_unit_cost);
        const componentCost = supplyUnitCost !== null && Number.isFinite(supplyUnitCost)
            ? (0, supplies_1.roundUnitCost)(new decimal_js_1.default(quantityInBase).mul(supplyUnitCost))
            : null;
        return {
            supply_id: row.supply_id,
            supply_name: row.supply_name,
            base_unit: row.base_unit,
            quantity: row.quantity,
            unit: row.unit,
            quantity_in_base: quantityInBase,
            supply_unit_cost: supplyUnitCost,
            component_cost: componentCost,
        };
    });
}
function hydrateRecipeRecord(db, row) {
    const items = loadRecipeItems(db, row.id);
    const fractionDigits = (0, supplies_1.resolveDbCurrencyFractionDigits)(db);
    const costKnown = items.length > 0 &&
        items.every((item) => typeof item.supply_unit_cost === 'number' && Number.isFinite(item.supply_unit_cost));
    const totalCostDecimal = costKnown
        ? items.reduce((sum, item) => sum.plus(new decimal_js_1.default(item.quantity_in_base).mul(item.supply_unit_cost)), new decimal_js_1.default(0))
        : null;
    const totalCost = totalCostDecimal !== null ? (0, supplies_1.roundUnitCost)(totalCostDecimal) : null;
    const unitCost = totalCostDecimal !== null
        ? (0, supplies_1.roundCurrencyCost)(totalCostDecimal.div(row.yield_quantity), fractionDigits)
        : null;
    return {
        ...row,
        cost_known: costKnown,
        total_cost: totalCost,
        unit_cost: unitCost,
        items,
    };
}
function getRecipeByProduct(db, productId) {
    const row = db
        .prepare(`
    SELECT r.*, p.name AS product_name
    FROM recipes r
    LEFT JOIN products p ON p.id = r.product_id
    WHERE r.product_id = ?
  `)
        .get(productId);
    if (!row)
        return null;
    return hydrateRecipeRecord(db, row);
}
function getRecipe(db, id) {
    const row = db
        .prepare(`
    SELECT r.*, p.name AS product_name
    FROM recipes r
    LEFT JOIN products p ON p.id = r.product_id
    WHERE r.id = ?
  `)
        .get(id);
    if (!row)
        return null;
    return hydrateRecipeRecord(db, row);
}
function listRecipes(db) {
    const rows = db
        .prepare(`
    SELECT r.*, p.name AS product_name
    FROM recipes r
    LEFT JOIN products p ON p.id = r.product_id
    ORDER BY p.name COLLATE NOCASE
  `)
        .all();
    return rows.map((row) => hydrateRecipeRecord(db, row));
}
function saveRecipe(db, input) {
    const productId = String(input.productId || '').trim();
    if (!productId)
        throw new RecipeServiceError(400, 'product_id is required', 'product_missing');
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product)
        throw new RecipeServiceError(404, 'Product not found', 'product_missing');
    if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new RecipeServiceError(400, 'items must contain at least one supply', 'items_missing');
    }
    const seenSupplies = new Set();
    const normalizedItems = [];
    for (const item of input.items) {
        const supplyId = String(item?.supply_id || item?.supplyId || '').trim();
        if (!supplyId)
            throw new RecipeServiceError(400, 'each item requires a supply_id', 'supply_id_missing');
        if (seenSupplies.has(supplyId)) {
            throw new RecipeServiceError(400, 'duplicate supply_id in recipe', 'duplicate_supply');
        }
        seenSupplies.add(supplyId);
        const supply = db
            .prepare('SELECT id, base_unit FROM supplies WHERE id = ? AND deleted_at IS NULL')
            .get(supplyId);
        if (!supply)
            throw new RecipeServiceError(404, `Supply ${supplyId} not found`, 'supply_missing');
        const quantity = assertPositiveFinite(item.quantity, 'item.quantity', 'quantity_invalid');
        let unit;
        try {
            unit = (0, units_1.assertSupplyUnit)(item.unit, 'item.unit');
        }
        catch (error) {
            if (error instanceof units_1.UnitConversionError) {
                throw new RecipeServiceError(error.statusCode, error.message, error.diagnosticCode);
            }
            throw error;
        }
        // Validate convertibility at save time so depletion cannot fail later.
        try {
            (0, units_1.convertQuantity)(quantity, unit, supply.base_unit);
        }
        catch (error) {
            if (error instanceof units_1.UnitConversionError) {
                throw new RecipeServiceError(error.statusCode, error.message, error.diagnosticCode);
            }
            throw error;
        }
        normalizedItems.push({ supplyId, quantity, unit });
    }
    const yieldQuantity = input.yieldQuantity === undefined
        ? 1
        : assertPositiveFinite(input.yieldQuantity, 'yield_quantity', 'yield_invalid');
    const isActive = input.isActive === false ? 0 : 1;
    const timestamp = (0, db_1.now)();
    const recipeId = (0, db_1.withTxn)(() => {
        const existing = db.prepare('SELECT id FROM recipes WHERE product_id = ?').get(productId);
        let id;
        if (existing) {
            id = existing.id;
            db.prepare('UPDATE recipes SET yield_quantity = ?, is_active = ?, updated_at = ? WHERE id = ?').run(yieldQuantity, isActive, timestamp, id);
            db.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(id);
        }
        else {
            id = newId('rcp');
            db.prepare(`
        INSERT INTO recipes (id, product_id, yield_quantity, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, productId, yieldQuantity, isActive, timestamp, timestamp);
        }
        const insertItem = db.prepare(`
      INSERT INTO recipe_items (id, recipe_id, supply_id, quantity, unit, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        for (const item of normalizedItems) {
            insertItem.run(newId('rci'), id, item.supplyId, item.quantity, item.unit, timestamp);
        }
        return id;
    });
    const recipe = getRecipe(db, recipeId);
    if (!recipe)
        throw new RecipeServiceError(500, 'Failed to save recipe');
    return recipe;
}
function deleteRecipe(db, productId) {
    const existing = db.prepare('SELECT id FROM recipes WHERE product_id = ?').get(productId);
    if (!existing)
        throw new RecipeServiceError(404, 'Recipe not found');
    (0, db_1.withTxn)(() => {
        db.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(existing.id);
        db.prepare('DELETE FROM recipes WHERE id = ?').run(existing.id);
    });
}
/**
 * Build an immutable per-order-item snapshot of the recipe scaled to the
 * ordered quantity and to the ordered variant's portion. `recipeMultiplier`
 * is how many base recipe portions the variant consumes and comes from the
 * resolved catalog variant, never from the client. Returns null when the
 * product has no active recipe, in which case a portion has no effect.
 */
function buildRecipeSnapshot(db, productId, orderQuantity, recipeMultiplier = 1) {
    const recipe = getRecipeByProduct(db, productId);
    if (!recipe || recipe.is_active !== 1 || recipe.items.length === 0)
        return null;
    if (!Number.isFinite(orderQuantity) || orderQuantity <= 0)
        return null;
    // A zero, negative, or non-finite portion would silently under-deplete and
    // record a snapshot that cancel and restore would faithfully reproduce.
    // roundQuantity refuses an overflowed product below.
    if (!Number.isFinite(recipeMultiplier) || recipeMultiplier <= 0) {
        throw new RecipeServiceError(400, 'recipe multiplier must be a positive finite number');
    }
    const fractionDigits = (0, supplies_1.resolveDbCurrencyFractionDigits)(db);
    const scale = (orderQuantity * recipeMultiplier) / recipe.yield_quantity;
    const components = recipe.items.map((item) => {
        const quantity = (0, units_1.roundQuantity)(item.quantity_in_base * scale);
        const unitCost = typeof item.supply_unit_cost === 'number' && Number.isFinite(item.supply_unit_cost)
            ? item.supply_unit_cost
            : null;
        const lineCost = unitCost !== null ? (0, supplies_1.roundUnitCost)(new decimal_js_1.default(quantity).mul(unitCost)) : null;
        return {
            supply_id: item.supply_id,
            supply_name: item.supply_name,
            base_unit: item.base_unit,
            quantity,
            unit_cost: unitCost,
            line_cost: lineCost,
        };
    });
    const costKnown = components.length > 0 &&
        components.every((component) => typeof component.unit_cost === 'number' && Number.isFinite(component.unit_cost));
    const totalIngredientCost = costKnown
        ? (0, supplies_1.roundCurrencyCost)(components.reduce((sum, component) => sum.plus(new decimal_js_1.default(component.quantity).mul(component.unit_cost)), new decimal_js_1.default(0)), fractionDigits)
        : null;
    return {
        recipe_id: recipe.id,
        product_id: recipe.product_id,
        yield_quantity: recipe.yield_quantity,
        cost_known: costKnown,
        total_ingredient_cost: totalIngredientCost,
        components,
    };
}
function scaleRecipeSnapshot(snapshot, ratio, fractionDigits) {
    const components = snapshot.components.map((component) => {
        const quantity = Number((component.quantity * ratio).toFixed(6));
        const hasUnitCost = typeof component.unit_cost === 'number' && Number.isFinite(component.unit_cost);
        const lineCost = hasUnitCost
            ? (0, supplies_1.roundUnitCost)(new decimal_js_1.default(quantity).mul(component.unit_cost))
            : component.line_cost !== undefined
                ? null
                : undefined;
        return {
            ...component,
            quantity,
            ...(lineCost !== undefined ? { line_cost: lineCost } : {}),
        };
    });
    const costKnown = snapshot.cost_known === true &&
        components.length > 0 &&
        components.every((component) => typeof component.unit_cost === 'number' && Number.isFinite(component.unit_cost));
    const totalIngredientCost = costKnown
        ? (0, supplies_1.roundCurrencyCost)(components.reduce((sum, component) => sum.plus(new decimal_js_1.default(component.quantity).mul(component.unit_cost)), new decimal_js_1.default(0)), fractionDigits)
        : snapshot.cost_known !== undefined
            ? null
            : undefined;
    return {
        ...snapshot,
        ...(snapshot.cost_known !== undefined ? { cost_known: costKnown } : {}),
        ...(totalIngredientCost !== undefined ? { total_ingredient_cost: totalIngredientCost } : {}),
        components,
    };
}
function extractOrderItemCostFromSnapshot(snapshot) {
    if (snapshot &&
        snapshot.cost_known === true &&
        typeof snapshot.total_ingredient_cost === 'number' &&
        Number.isFinite(snapshot.total_ingredient_cost)) {
        return {
            ingredientCost: snapshot.total_ingredient_cost,
            ingredientCostKnown: 1,
        };
    }
    return {
        ingredientCost: null,
        ingredientCostKnown: 0,
    };
}
function parseRecipeSnapshot(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.components))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/**
 * Apply snapshot component deltas to supply stock. Positive deltas restore,
 * negative deltas deplete. Callers must already be inside a transaction.
 */
function applyRecipeSnapshot(db, snapshot, options) {
    const movementType = options.direction === 'deplete' ? 'recipe_depletion' : 'recipe_restore';
    const sign = options.direction === 'deplete' ? -1 : 1;
    for (const component of snapshot.components) {
        const magnitude = (0, units_1.roundQuantity)(Math.abs(component.quantity));
        if (magnitude === 0)
            continue;
        (0, supplies_1.applySupplyStockChange)(db, {
            supplyId: component.supply_id,
            quantityDelta: sign * magnitude,
            movementType,
            unit: component.base_unit,
            reason: options.direction === 'deplete' ? 'Recipe depletion' : 'Recipe restore',
            actorUserId: options.actorUserId,
            referenceType: 'order_item',
            referenceId: options.referenceId,
            createdAt: options.createdAt,
        });
    }
}
//# sourceMappingURL=recipes.js.map