"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStockCount = exports.getPurchase = exports.StockManagementError = void 0;
exports.listSuppliers = listSuppliers;
exports.createSupplier = createSupplier;
exports.getSupplier = getSupplier;
exports.updateSupplier = updateSupplier;
exports.deleteSupplier = deleteSupplier;
exports.listPurchases = listPurchases;
exports.createPurchase = createPurchase;
exports.updatePurchase = updatePurchase;
exports.reviewPurchase = reviewPurchase;
exports.receivePurchase = receivePurchase;
exports.listStockCounts = listStockCounts;
exports.startStockCount = startStockCount;
exports.saveStockCount = saveStockCount;
exports.reviewStockCount = reviewStockCount;
exports.postStockCount = postStockCount;
exports.recordWastage = recordWastage;
exports.stockDashboard = stockDashboard;
const crypto_1 = require("crypto");
const decimal_js_1 = __importDefault(require("decimal.js"));
const db_1 = require("../db");
const supplies_1 = require("./supplies");
const units_1 = require("./units");
class StockManagementError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'StockManagementError';
    }
}
exports.StockManagementError = StockManagementError;
function id(prefix) {
    return `${prefix}_${(0, crypto_1.randomBytes)(12).toString('hex')}`;
}
function text(value, field, required = false, maxLength = 500) {
    if (value === undefined || value === null) {
        if (required)
            throw new StockManagementError(400, `${field} is required`);
        return null;
    }
    const result = String(value).trim();
    if (!result) {
        if (required)
            throw new StockManagementError(400, `${field} is required`);
        return null;
    }
    if (result.length > maxLength)
        throw new StockManagementError(400, `${field} is too long`);
    return result;
}
function number(value, field, options = {}) {
    const result = typeof value === 'string' ? Number(value) : value;
    if (typeof result !== 'number' || !Number.isFinite(result)) {
        throw new StockManagementError(400, `${field} must be a finite number`);
    }
    if (options.positive && result <= 0)
        throw new StockManagementError(400, `${field} must be positive`);
    if (options.nonNegative && result < 0)
        throw new StockManagementError(400, `${field} must not be negative`);
    return result;
}
function date(value, field) {
    const result = text(value, field, true, 32);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T12:00:00Z`))) {
        throw new StockManagementError(400, `${field} must be an ISO date (YYYY-MM-DD)`);
    }
    return result;
}
function purchaseUnit(value) {
    if (value === 'pack')
        return 'pack';
    // `each` is the long-standing database representation for individual pieces.
    if (value === 'piece')
        return 'each';
    return (0, units_1.assertSupplyUnit)(value, 'purchase_unit');
}
function status(value) {
    if (value === 'unpaid' || value === 'partial' || value === 'paid')
        return value;
    throw new StockManagementError(400, 'payment_status must be unpaid, partial, or paid');
}
function row(value, message) {
    if (!value)
        throw new StockManagementError(404, message);
    return value;
}
function listSuppliers(db, includeInactive = false) {
    return db.prepare(`
    SELECT s.*, COUNT(p.id) AS purchase_count
    FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id
    WHERE s.deleted_at IS NULL ${includeInactive ? '' : 'AND s.is_active = 1'}
    GROUP BY s.id ORDER BY s.name COLLATE NOCASE
  `).all();
}
function createSupplier(db, input) {
    const timestamp = (0, db_1.now)();
    const supplierId = id('supplier');
    db.prepare(`INSERT INTO suppliers
    (id, name, contact_name, phone, email, address, notes, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(supplierId, text(input.name, 'name', true, 200), text(input.contact_name, 'contact_name', false, 200), text(input.phone, 'phone', false, 100), text(input.email, 'email', false, 254), text(input.address, 'address', false, 1000), text(input.notes, 'notes', false, 2000), input.isActive === false ? 0 : 1, timestamp, timestamp);
    return getSupplier(db, supplierId);
}
function getSupplier(db, supplierId) {
    return row(db.prepare('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL').get(supplierId), 'Supplier not found');
}
function updateSupplier(db, supplierId, input) {
    const current = getSupplier(db, supplierId);
    db.prepare(`UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?`)
        .run(input.name === undefined ? current.name : text(input.name, 'name', true, 200), input.contact_name === undefined ? current.contact_name : text(input.contact_name, 'contact_name', false, 200), input.phone === undefined ? current.phone : text(input.phone, 'phone', false, 100), input.email === undefined ? current.email : text(input.email, 'email', false, 254), input.address === undefined ? current.address : text(input.address, 'address', false, 1000), input.notes === undefined ? current.notes : text(input.notes, 'notes', false, 2000), input.isActive === undefined ? current.is_active : input.isActive ? 1 : 0, (0, db_1.now)(), supplierId);
    return getSupplier(db, supplierId);
}
function deleteSupplier(db, supplierId) {
    getSupplier(db, supplierId);
    if (db.prepare('SELECT 1 FROM purchases WHERE supplier_id = ? LIMIT 1').get(supplierId)) {
        throw new StockManagementError(409, 'Cannot delete a supplier referenced by purchases; deactivate it instead');
    }
    db.prepare('UPDATE suppliers SET deleted_at = ?, updated_at = ? WHERE id = ?').run((0, db_1.now)(), (0, db_1.now)(), supplierId);
}
function preparePurchaseItems(db, inputs) {
    if (!Array.isArray(inputs) || inputs.length === 0)
        throw new StockManagementError(400, 'At least one purchase item is required');
    return inputs.map((raw) => {
        const supply = (0, supplies_1.getSupply)(db, String(raw.supplyId));
        if (supply.is_active !== 1)
            throw new StockManagementError(409, `Supply ${supply.name} is inactive`);
        const quantity = (0, units_1.roundQuantity)(number(raw.quantity, 'quantity', { positive: true }));
        const unit = purchaseUnit(raw.purchaseUnit);
        const unitPrice = number(raw.unitPrice, 'unit_price', { nonNegative: true });
        let quantityInBase;
        let packSizeInBase = null;
        if (unit === 'pack') {
            if (supply.base_unit !== 'each')
                throw new StockManagementError(400, 'packs can only be received into piece-based supplies');
            packSizeInBase = (0, units_1.roundQuantity)(number(raw.packSizeInBase, 'pack_size_in_base', { positive: true }));
            quantityInBase = (0, units_1.roundQuantity)(quantity * packSizeInBase);
        }
        else {
            quantityInBase = (0, units_1.convertQuantity)(quantity, unit, supply.base_unit);
        }
        return { ...raw, quantity, purchaseUnit: unit, unitPrice, supply, quantityInBase, packSizeInBase, lineTotal: (0, supplies_1.roundUnitCost)(new decimal_js_1.default(quantity).mul(unitPrice)) };
    });
}
function getPurchaseInternal(db, purchaseId) {
    const purchase = row(db.prepare(`SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`).get(purchaseId), 'Purchase not found');
    purchase.items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(purchaseId);
    return purchase;
}
exports.getPurchase = getPurchaseInternal;
function listPurchases(db, limit = 50) {
    return db.prepare(`SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.purchase_date DESC, p.created_at DESC LIMIT ?`).all(Math.min(Math.max(limit, 1), 200));
}
function writePurchaseItems(db, purchaseId, prepared) {
    const fractionDigits = (0, supplies_1.resolveDbCurrencyFractionDigits)(db);
    let itemsTotal = new decimal_js_1.default(0);
    for (const item of prepared) {
        const lineTotal = (0, supplies_1.roundCurrencyCost)(item.lineTotal, fractionDigits);
        itemsTotal = itemsTotal.plus(lineTotal);
        db.prepare(`INSERT INTO purchase_items (purchase_id, supply_id, supply_name_snapshot, supply_base_unit_snapshot, quantity, purchase_unit, pack_size_in_base, quantity_in_base, unit_price, line_total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(purchaseId, item.supply.id, item.supply.name, item.supply.base_unit, item.quantity, item.purchaseUnit, item.packSizeInBase, item.quantityInBase, item.unitPrice, lineTotal, (0, db_1.now)());
    }
    return { itemsTotal: (0, supplies_1.roundCurrencyCost)(itemsTotal, fractionDigits), grandTotal: 0 };
}
function createPurchase(db, input) {
    if (!input.actorUserId)
        throw new StockManagementError(400, 'actor_user_id is required');
    const prepared = preparePurchaseItems(db, input.items);
    const supplierId = input.supplierId ? String(input.supplierId) : null;
    if (supplierId) {
        const supplier = getSupplier(db, supplierId);
        if (supplier.is_active !== 1)
            throw new StockManagementError(409, 'Supplier is inactive');
    }
    const additionalExpenses = number(input.additionalExpenses ?? 0, 'additional_expenses', { nonNegative: true });
    const purchaseId = id('purchase');
    const purchaseDate = date(input.purchaseDate, 'purchase_date');
    const fractionDigits = (0, supplies_1.resolveDbCurrencyFractionDigits)(db);
    return (0, db_1.withTxn)(() => {
        db.prepare(`INSERT INTO purchases (id, supplier_id, purchase_date, invoice_number, additional_expenses, payment_status, notes, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(purchaseId, supplierId, purchaseDate, text(input.invoiceNumber, 'invoice_number', false, 200), (0, supplies_1.roundCurrencyCost)(additionalExpenses, fractionDigits), status(input.paymentStatus ?? 'unpaid'), text(input.notes, 'notes', false, 2000), input.actorUserId, (0, db_1.now)(), (0, db_1.now)());
        const totals = writePurchaseItems(db, purchaseId, prepared);
        const grandTotal = (0, supplies_1.roundCurrencyCost)(new decimal_js_1.default(totals.itemsTotal).plus(additionalExpenses), fractionDigits);
        db.prepare('UPDATE purchases SET items_total = ?, grand_total = ?, updated_at = ? WHERE id = ?').run(totals.itemsTotal, grandTotal, (0, db_1.now)(), purchaseId);
        return getPurchaseInternal(db, purchaseId);
    });
}
function updatePurchase(db, purchaseId, input) {
    if (!input.actorUserId) {
        throw new StockManagementError(400, 'actor_user_id is required');
    }
    const prepared = preparePurchaseItems(db, input.items);
    const supplierId = input.supplierId ? String(input.supplierId) : null;
    if (supplierId) {
        const supplier = getSupplier(db, supplierId);
        if (supplier.is_active !== 1) {
            throw new StockManagementError(409, 'Supplier is inactive');
        }
    }
    const purchaseDate = date(input.purchaseDate, 'purchase_date');
    const additionalExpenses = number(input.additionalExpenses ?? 0, 'additional_expenses', { nonNegative: true });
    const fractionDigits = (0, supplies_1.resolveDbCurrencyFractionDigits)(db);
    return (0, db_1.withTxn)(() => {
        const current = getPurchaseInternal(db, purchaseId);
        if (current.status !== 'draft') {
            throw new StockManagementError(409, `Only draft purchases can be edited (current status: ${current.status})`);
        }
        db.prepare(`
      UPDATE purchases
      SET supplier_id = ?,
          purchase_date = ?,
          invoice_number = ?,
          additional_expenses = ?,
          payment_status = ?,
          notes = ?,
          updated_at = ?
      WHERE id = ? AND status = 'draft'
    `).run(supplierId, purchaseDate, text(input.invoiceNumber, 'invoice_number', false, 200), (0, supplies_1.roundCurrencyCost)(additionalExpenses, fractionDigits), status(input.paymentStatus ?? 'unpaid'), text(input.notes, 'notes', false, 2000), (0, db_1.now)(), purchaseId);
        db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?')
            .run(purchaseId);
        const totals = writePurchaseItems(db, purchaseId, prepared);
        const grandTotal = (0, supplies_1.roundCurrencyCost)(new decimal_js_1.default(totals.itemsTotal).plus(additionalExpenses), fractionDigits);
        db.prepare(`
      UPDATE purchases
      SET items_total = ?, grand_total = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'
    `).run(totals.itemsTotal, grandTotal, (0, db_1.now)(), purchaseId);
        return getPurchaseInternal(db, purchaseId);
    });
}
function reviewPurchase(db, purchaseId, actorUserId) {
    if (!actorUserId)
        throw new StockManagementError(400, 'actor_user_id is required');
    const result = db.prepare(`UPDATE purchases SET status = 'review', updated_at = ? WHERE id = ? AND status = 'draft'`).run((0, db_1.now)(), purchaseId);
    if (result.changes !== 1) {
        const current = getPurchaseInternal(db, purchaseId);
        throw new StockManagementError(409, `Only draft purchases can be reviewed (current status: ${current.status})`);
    }
    return getPurchaseInternal(db, purchaseId);
}
function receivePurchase(db, purchaseId, actorUserId) {
    if (!actorUserId)
        throw new StockManagementError(400, 'actor_user_id is required');
    return (0, db_1.withTxn)(() => {
        const purchase = getPurchaseInternal(db, purchaseId);
        if (purchase.status !== 'review')
            throw new StockManagementError(409, `Only reviewed purchases can be received (current status: ${purchase.status})`);
        const priorMovement = db.prepare(`SELECT 1 FROM supply_movements WHERE reference_type = 'purchase' AND reference_id = ? LIMIT 1`).get(purchaseId);
        if (priorMovement)
            throw new StockManagementError(409, 'Purchase has already created inventory movements');
        const fractionDigits = (0, supplies_1.resolveDbCurrencyFractionDigits)(db);
        for (const item of purchase.items || []) {
            const supply = (0, supplies_1.getSupply)(db, item.supply_id);
            const total = (0, supplies_1.roundCurrencyCost)(item.line_total, fractionDigits);
            (0, supplies_1.recordSupplyMovement)(db, {
                supplyId: item.supply_id,
                movementType: 'receive',
                quantity: item.quantity_in_base,
                unit: supply.base_unit,
                totalCost: total,
                actorUserId,
                reason: purchase.invoice_number ? `Purchase ${purchase.invoice_number}` : 'Purchase receipt',
                referenceType: 'purchase',
                referenceId: purchaseId,
            });
        }
        const changed = db.prepare(`UPDATE purchases SET status = 'received', received_at = ?, received_by_user_id = ?, updated_at = ? WHERE id = ? AND status = 'review'`).run((0, db_1.now)(), actorUserId, (0, db_1.now)(), purchaseId);
        if (changed.changes !== 1)
            throw new StockManagementError(409, 'Purchase receipt state changed while posting');
        return getPurchaseInternal(db, purchaseId);
    });
}
function getStockCountInternal(db, countId) {
    const count = row(db.prepare('SELECT * FROM stock_counts WHERE id = ?').get(countId), 'Stock count not found');
    count.items = db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ? ORDER BY supply_name_snapshot COLLATE NOCASE').all(countId);
    return count;
}
exports.getStockCount = getStockCountInternal;
function listStockCounts(db, limit = 30) {
    return db.prepare('SELECT * FROM stock_counts ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 100));
}
function startStockCount(db, actorUserId, notes) {
    if (!actorUserId)
        throw new StockManagementError(400, 'actor_user_id is required');
    const countId = id('count');
    (0, db_1.withTxn)(() => {
        db.prepare('INSERT INTO stock_counts (id, notes, started_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(countId, text(notes, 'notes', false, 2000), actorUserId, (0, db_1.now)(), (0, db_1.now)());
        for (const supply of (0, supplies_1.listSupplies)(db, { includeInactive: false })) {
            db.prepare(`INSERT INTO stock_count_items (stock_count_id, supply_id, supply_name_snapshot, base_unit_snapshot, expected_quantity, unit_cost_snapshot)
        VALUES (?, ?, ?, ?, ?, ?)`)
                .run(countId, supply.id, supply.name, supply.base_unit, supply.stock_quantity, supply.unit_cost);
        }
    });
    return getStockCountInternal(db, countId);
}
function saveStockCount(db, countId, items) {
    const count = getStockCountInternal(db, countId);
    if (count.status !== 'draft')
        throw new StockManagementError(409, 'Only draft stock counts can be edited');
    (0, db_1.withTxn)(() => {
        for (const input of items) {
            const item = row(db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ? AND supply_id = ?').get(countId, String(input.supplyId)), 'Stock count item not found');
            const actual = (0, units_1.roundQuantity)(number(input.actualQuantity, 'actual_quantity', { nonNegative: true }));
            // Capture the live system quantity when the physical observation is saved.
            // Posting later applies only the observed variance as a delta, preserving
            // purchases, sales, wastage, and other movements that happen after this save.
            const liveSupply = (0, supplies_1.getSupply)(db, item.supply_id);
            const observedStock = (0, units_1.roundQuantity)(Number(liveSupply.stock_quantity));
            const variance = (0, units_1.roundQuantity)(actual - observedStock);
            const observedAt = (0, db_1.now)();
            const reason = text(input.reason, 'reason', false, 500);
            if (variance !== 0 && !reason)
                throw new StockManagementError(400, `A reason is required for a variance on ${item.supply_name_snapshot}`);
            const varianceCost = item.unit_cost_snapshot === null ? null : (0, supplies_1.roundUnitCost)(new decimal_js_1.default(variance).mul(item.unit_cost_snapshot));
            db.prepare(`UPDATE stock_count_items
        SET actual_quantity = ?, observed_stock_quantity = ?, observed_at = ?, variance_quantity = ?, variance_cost = ?, reason = ?
        WHERE id = ?`).run(actual, observedStock, observedAt, variance, varianceCost, reason, item.id);
        }
        db.prepare('UPDATE stock_counts SET updated_at = ? WHERE id = ?').run((0, db_1.now)(), countId);
    });
    return getStockCountInternal(db, countId);
}
function reviewStockCount(db, countId, actorUserId) {
    if (!actorUserId)
        throw new StockManagementError(400, 'actor_user_id is required');
    const count = getStockCountInternal(db, countId);
    if (count.status !== 'draft')
        throw new StockManagementError(409, 'Only draft stock counts can be reviewed');
    if ((count.items || []).some((item) => item.actual_quantity === null))
        throw new StockManagementError(400, 'Every stock-count item requires an actual quantity before review');
    if ((count.items || []).some((item) => item.observed_stock_quantity === null || !item.observed_at || item.variance_quantity === null)) {
        throw new StockManagementError(409, 'Save the physical quantities again to capture current stock observations before review.');
    }
    const changed = db.prepare(`UPDATE stock_counts SET status = 'review', reviewed_by_user_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`).run(actorUserId, (0, db_1.now)(), (0, db_1.now)(), countId);
    if (changed.changes !== 1)
        throw new StockManagementError(409, 'Stock count state changed while reviewing');
    return getStockCountInternal(db, countId);
}
function postStockCount(db, countId, actorUserId) {
    if (!actorUserId)
        throw new StockManagementError(400, 'actor_user_id is required');
    return (0, db_1.withTxn)(() => {
        const count = getStockCountInternal(db, countId);
        if (count.status !== 'review')
            throw new StockManagementError(409, `Only reviewed stock counts can be posted (current status: ${count.status})`);
        if (db.prepare(`SELECT 1 FROM supply_movements WHERE reference_type = 'stock_count' AND reference_id = ? LIMIT 1`).get(countId))
            throw new StockManagementError(409, 'Stock count has already created inventory movements');
        for (const item of count.items || []) {
            if (item.actual_quantity === null)
                throw new StockManagementError(400, 'Every stock-count item requires an actual quantity');
            if (item.observed_stock_quantity === null || !item.observed_at || item.variance_quantity === null) {
                throw new StockManagementError(409, 'This stock count has no concurrency-safe observation snapshot. Start a new stock count and enter the physical quantities again.');
            }
            if (Number(item.variance_quantity) === 0)
                continue;
            const movement = (0, supplies_1.recordSupplyMovement)(db, {
                supplyId: item.supply_id,
                movementType: 'adjustment',
                // Apply the difference observed when the count was saved, not an absolute
                // stock target. Later movements therefore remain reflected in live stock.
                quantity: Number(item.variance_quantity),
                unit: item.base_unit_snapshot,
                actorUserId,
                reason: item.reason || 'Physical stock count',
                referenceType: 'stock_count',
                referenceId: countId,
            });
            db.prepare('UPDATE stock_count_items SET supply_movement_id = ? WHERE id = ?').run(movement?.id ?? null, item.id);
        }
        const changed = db.prepare(`UPDATE stock_counts SET status = 'posted', posted_by_user_id = ?, posted_at = ?, updated_at = ? WHERE id = ? AND status = 'review'`).run(actorUserId, (0, db_1.now)(), (0, db_1.now)(), countId);
        if (changed.changes !== 1)
            throw new StockManagementError(409, 'Stock count state changed while posting');
        return getStockCountInternal(db, countId);
    });
}
function recordWastage(db, input) {
    if (!input.actorUserId)
        throw new StockManagementError(400, 'actor_user_id is required');
    const supply = (0, supplies_1.getSupply)(db, input.supplyId);
    const wastageId = id('waste');
    return (0, db_1.withTxn)(() => {
        db.prepare(`INSERT INTO stock_wastage_records (id, supply_id, quantity, unit, wastage_date, reason, notes, recorded_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(wastageId, supply.id, (0, units_1.roundQuantity)(number(input.quantity, 'quantity', { positive: true })), (0, units_1.assertSupplyUnit)(input.unit), date(input.wastageDate, 'wastage_date'), text(input.reason, 'reason', true, 500), text(input.notes, 'notes', false, 2000), input.actorUserId, (0, db_1.now)());
        const movement = (0, supplies_1.recordSupplyMovement)(db, { supplyId: supply.id, movementType: 'waste', quantity: input.quantity, unit: input.unit, reason: input.reason, actorUserId: input.actorUserId, referenceType: 'stock_wastage', referenceId: wastageId, createdAt: `${date(input.wastageDate, 'wastage_date')} 12:00:00` });
        db.prepare('UPDATE stock_wastage_records SET supply_movement_id = ? WHERE id = ?').run(movement?.id ?? null, wastageId);
        return { id: wastageId, supply_movement_id: movement?.id ?? null };
    });
}
function stockDashboard(db) {
    const lowStock = (0, supplies_1.listSupplies)(db, { lowStockOnly: true });
    const outOfStock = db.prepare(`SELECT * FROM supplies WHERE deleted_at IS NULL AND is_active = 1 AND stock_quantity <= 0 ORDER BY name COLLATE NOCASE`).all();
    return {
        low_stock: lowStock,
        out_of_stock: outOfStock,
        recent_purchases: listPurchases(db, 8),
        recent_wastage: db.prepare(`SELECT w.*, s.name AS supply_name FROM stock_wastage_records w JOIN supplies s ON s.id = w.supply_id ORDER BY w.wastage_date DESC, w.created_at DESC LIMIT 8`).all(),
        latest_count: db.prepare(`
      SELECT c.*, COALESCE(SUM(i.variance_cost), 0) AS variance_cost
      FROM stock_counts c LEFT JOIN stock_count_items i ON i.stock_count_id = c.id
      WHERE c.status = 'posted'
      GROUP BY c.id
      ORDER BY c.posted_at DESC LIMIT 1
    `).get() || null,
        counts_awaiting_review: db.prepare(`SELECT COUNT(*) AS total FROM stock_counts WHERE status IN ('draft', 'review')`).get(),
    };
}
//# sourceMappingURL=stock-management.js.map