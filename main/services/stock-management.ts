import { randomBytes } from 'crypto';
import Decimal from 'decimal.js';
import { getDatabase, now, withTxn } from '../db';
import {
  getSupply,
  listSupplies,
  recordSupplyMovement,
  resolveDbCurrencyFractionDigits,
  roundCurrencyCost,
  roundUnitCost,
  type SupplyRecord,
} from './supplies';
import { assertSupplyUnit, convertQuantity, roundQuantity, type SupplyUnit } from './units';

type Database = ReturnType<typeof getDatabase>;
export type PurchaseUnit = SupplyUnit | 'piece' | 'pack';
export type PurchaseStatus = 'draft' | 'review' | 'received';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export class StockManagementError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'StockManagementError';
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function text(value: unknown, field: string, required = false, maxLength = 500): string | null {
  if (value === undefined || value === null) {
    if (required) throw new StockManagementError(400, `${field} is required`);
    return null;
  }
  const result = String(value).trim();
  if (!result) {
    if (required) throw new StockManagementError(400, `${field} is required`);
    return null;
  }
  if (result.length > maxLength) throw new StockManagementError(400, `${field} is too long`);
  return result;
}

function number(value: unknown, field: string, options: { positive?: boolean; nonNegative?: boolean } = {}): number {
  const result = typeof value === 'string' ? Number(value) : value;
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new StockManagementError(400, `${field} must be a finite number`);
  }
  if (options.positive && result <= 0) throw new StockManagementError(400, `${field} must be positive`);
  if (options.nonNegative && result < 0) throw new StockManagementError(400, `${field} must not be negative`);
  return result;
}

function date(value: unknown, field: string): string {
  const result = text(value, field, true, 32)!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T12:00:00Z`))) {
    throw new StockManagementError(400, `${field} must be an ISO date (YYYY-MM-DD)`);
  }
  return result;
}

function purchaseUnit(value: unknown): PurchaseUnit {
  if (value === 'pack') return 'pack';
  // `each` is the long-standing database representation for individual pieces.
  if (value === 'piece') return 'each';
  return assertSupplyUnit(value, 'purchase_unit');
}

function status(value: unknown): PaymentStatus {
  if (value === 'unpaid' || value === 'partial' || value === 'paid') return value;
  throw new StockManagementError(400, 'payment_status must be unpaid, partial, or paid');
}

function row<T>(value: T | undefined, message: string): T {
  if (!value) throw new StockManagementError(404, message);
  return value;
}

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  purchase_count?: number;
}

export function listSuppliers(db: Database, includeInactive = false): Supplier[] {
  return db.prepare(`
    SELECT s.*, COUNT(p.id) AS purchase_count
    FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id
    WHERE s.deleted_at IS NULL ${includeInactive ? '' : 'AND s.is_active = 1'}
    GROUP BY s.id ORDER BY s.name COLLATE NOCASE
  `).all() as Supplier[];
}

export function createSupplier(db: Database, input: Omit<Supplier, 'id' | 'is_active' | 'deleted_at' | 'created_at' | 'updated_at'> & { isActive?: boolean }): Supplier {
  const timestamp = now();
  const supplierId = id('supplier');
  db.prepare(`INSERT INTO suppliers
    (id, name, contact_name, phone, email, address, notes, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(supplierId, text(input.name, 'name', true, 200), text(input.contact_name, 'contact_name', false, 200), text(input.phone, 'phone', false, 100), text(input.email, 'email', false, 254), text(input.address, 'address', false, 1000), text(input.notes, 'notes', false, 2000), input.isActive === false ? 0 : 1, timestamp, timestamp);
  return getSupplier(db, supplierId);
}

export function getSupplier(db: Database, supplierId: string): Supplier {
  return row(db.prepare('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL').get(supplierId) as Supplier | undefined, 'Supplier not found');
}

export function updateSupplier(db: Database, supplierId: string, input: Partial<Omit<Supplier, 'id' | 'deleted_at' | 'created_at' | 'updated_at'>> & { isActive?: boolean }): Supplier {
  const current = getSupplier(db, supplierId);
  db.prepare(`UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?`)
    .run(
      input.name === undefined ? current.name : text(input.name, 'name', true, 200),
      input.contact_name === undefined ? current.contact_name : text(input.contact_name, 'contact_name', false, 200),
      input.phone === undefined ? current.phone : text(input.phone, 'phone', false, 100),
      input.email === undefined ? current.email : text(input.email, 'email', false, 254),
      input.address === undefined ? current.address : text(input.address, 'address', false, 1000),
      input.notes === undefined ? current.notes : text(input.notes, 'notes', false, 2000),
      input.isActive === undefined ? current.is_active : input.isActive ? 1 : 0,
      now(), supplierId,
    );
  return getSupplier(db, supplierId);
}

export function deleteSupplier(db: Database, supplierId: string): void {
  getSupplier(db, supplierId);
  if (db.prepare('SELECT 1 FROM purchases WHERE supplier_id = ? LIMIT 1').get(supplierId)) {
    throw new StockManagementError(409, 'Cannot delete a supplier referenced by purchases; deactivate it instead');
  }
  db.prepare('UPDATE suppliers SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), supplierId);
}

export interface PurchaseItemInput {
  supplyId: string;
  quantity: number;
  purchaseUnit: PurchaseUnit;
  packSizeInBase?: number | null;
  unitPrice: number;
}

type PreparedPurchaseItem = PurchaseItemInput & {
  supply: SupplyRecord;
  quantityInBase: number;
  lineTotal: number;
};

function preparePurchaseItems(db: Database, inputs: PurchaseItemInput[]): PreparedPurchaseItem[] {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new StockManagementError(400, 'At least one purchase item is required');
  return inputs.map((raw) => {
    const supply = getSupply(db, String(raw.supplyId));
    if (supply.is_active !== 1) throw new StockManagementError(409, `Supply ${supply.name} is inactive`);
    const quantity = roundQuantity(number(raw.quantity, 'quantity', { positive: true }));
    const unit = purchaseUnit(raw.purchaseUnit);
    const unitPrice = number(raw.unitPrice, 'unit_price', { nonNegative: true });
    let quantityInBase: number;
    let packSizeInBase: number | null = null;
    if (unit === 'pack') {
      if (supply.base_unit !== 'each') throw new StockManagementError(400, 'packs can only be received into piece-based supplies');
      packSizeInBase = roundQuantity(number(raw.packSizeInBase, 'pack_size_in_base', { positive: true }));
      quantityInBase = roundQuantity(quantity * packSizeInBase);
    } else {
      quantityInBase = convertQuantity(quantity, unit, supply.base_unit);
    }
    return { ...raw, quantity, purchaseUnit: unit, unitPrice, supply, quantityInBase, packSizeInBase, lineTotal: roundUnitCost(new Decimal(quantity).mul(unitPrice)) };
  });
}

export interface Purchase {
  id: string;
  supplier_id: string | null;
  supplier_name?: string | null;
  purchase_date: string;
  invoice_number: string | null;
  additional_expenses: number;
  payment_status: PaymentStatus;
  notes: string | null;
  status: PurchaseStatus;
  items_total: number;
  grand_total: number;
  received_at: string | null;
  received_by_user_id: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  items?: PurchaseItem[];
}
export interface PurchaseItem {
  id: number;
  purchase_id: string;
  supply_id: string;
  supply_name_snapshot: string;
  supply_base_unit_snapshot: SupplyUnit;
  quantity: number;
  purchase_unit: PurchaseUnit;
  pack_size_in_base: number | null;
  quantity_in_base: number;
  unit_price: number;
  line_total: number;
}

function getPurchaseInternal(db: Database, purchaseId: string): Purchase {
  const purchase = row(db.prepare(`SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`).get(purchaseId) as Purchase | undefined, 'Purchase not found');
  purchase.items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(purchaseId) as PurchaseItem[];
  return purchase;
}
export const getPurchase = getPurchaseInternal;

export function listPurchases(db: Database, limit = 50): Purchase[] {
  return db.prepare(`SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.purchase_date DESC, p.created_at DESC LIMIT ?`).all(Math.min(Math.max(limit, 1), 200)) as Purchase[];
}

export interface PurchaseInput {
  supplierId?: string | null;
  purchaseDate: string;
  invoiceNumber?: string | null;
  additionalExpenses?: number;
  paymentStatus?: PaymentStatus;
  notes?: string | null;
  items: PurchaseItemInput[];
  actorUserId: string;
}

function writePurchaseItems(db: Database, purchaseId: string, prepared: PreparedPurchaseItem[]): { itemsTotal: number; grandTotal: number } {
  const fractionDigits = resolveDbCurrencyFractionDigits(db);
  let itemsTotal = new Decimal(0);
  for (const item of prepared) {
    const lineTotal = roundCurrencyCost(item.lineTotal, fractionDigits);
    itemsTotal = itemsTotal.plus(lineTotal);
    db.prepare(`INSERT INTO purchase_items (purchase_id, supply_id, supply_name_snapshot, supply_base_unit_snapshot, quantity, purchase_unit, pack_size_in_base, quantity_in_base, unit_price, line_total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(purchaseId, item.supply.id, item.supply.name, item.supply.base_unit, item.quantity, item.purchaseUnit, item.packSizeInBase, item.quantityInBase, item.unitPrice, lineTotal, now());
  }
  return { itemsTotal: roundCurrencyCost(itemsTotal, fractionDigits), grandTotal: 0 };
}

export function createPurchase(db: Database, input: PurchaseInput): Purchase {
  if (!input.actorUserId) throw new StockManagementError(400, 'actor_user_id is required');
  const prepared = preparePurchaseItems(db, input.items);
  const supplierId = input.supplierId ? String(input.supplierId) : null;
  if (supplierId) {
    const supplier = getSupplier(db, supplierId);
    if (supplier.is_active !== 1) throw new StockManagementError(409, 'Supplier is inactive');
  }
  const additionalExpenses = number(input.additionalExpenses ?? 0, 'additional_expenses', { nonNegative: true });
  const purchaseId = id('purchase');
  const purchaseDate = date(input.purchaseDate, 'purchase_date');
  const fractionDigits = resolveDbCurrencyFractionDigits(db);
  return withTxn(() => {
    db.prepare(`INSERT INTO purchases (id, supplier_id, purchase_date, invoice_number, additional_expenses, payment_status, notes, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(purchaseId, supplierId, purchaseDate, text(input.invoiceNumber, 'invoice_number', false, 200), roundCurrencyCost(additionalExpenses, fractionDigits), status(input.paymentStatus ?? 'unpaid'), text(input.notes, 'notes', false, 2000), input.actorUserId, now(), now());
    const totals = writePurchaseItems(db, purchaseId, prepared);
    const grandTotal = roundCurrencyCost(new Decimal(totals.itemsTotal).plus(additionalExpenses), fractionDigits);
    db.prepare('UPDATE purchases SET items_total = ?, grand_total = ?, updated_at = ? WHERE id = ?').run(totals.itemsTotal, grandTotal, now(), purchaseId);
    return getPurchaseInternal(db, purchaseId);
  });
}

export function updatePurchase(
  db: Database,
  purchaseId: string,
  input: PurchaseInput,
): Purchase {
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
  const additionalExpenses = number(
    input.additionalExpenses ?? 0,
    'additional_expenses',
    { nonNegative: true },
  );

  const fractionDigits = resolveDbCurrencyFractionDigits(db);

  return withTxn(() => {
    const current = getPurchaseInternal(db, purchaseId);

    if (current.status !== 'draft') {
      throw new StockManagementError(
        409,
        `Only draft purchases can be edited (current status: ${current.status})`,
      );
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
    `).run(
      supplierId,
      purchaseDate,
      text(input.invoiceNumber, 'invoice_number', false, 200),
      roundCurrencyCost(additionalExpenses, fractionDigits),
      status(input.paymentStatus ?? 'unpaid'),
      text(input.notes, 'notes', false, 2000),
      now(),
      purchaseId,
    );

    db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?')
      .run(purchaseId);

    const totals = writePurchaseItems(db, purchaseId, prepared);
    const grandTotal = roundCurrencyCost(
      new Decimal(totals.itemsTotal).plus(additionalExpenses),
      fractionDigits,
    );

    db.prepare(`
      UPDATE purchases
      SET items_total = ?, grand_total = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'
    `).run(totals.itemsTotal, grandTotal, now(), purchaseId);

    return getPurchaseInternal(db, purchaseId);
  });
}

export function reviewPurchase(db: Database, purchaseId: string, actorUserId: string): Purchase {
  if (!actorUserId) throw new StockManagementError(400, 'actor_user_id is required');
  const result = db.prepare(`UPDATE purchases SET status = 'review', updated_at = ? WHERE id = ? AND status = 'draft'`).run(now(), purchaseId);
  if (result.changes !== 1) {
    const current = getPurchaseInternal(db, purchaseId);
    throw new StockManagementError(409, `Only draft purchases can be reviewed (current status: ${current.status})`);
  }
  return getPurchaseInternal(db, purchaseId);
}

export function receivePurchase(db: Database, purchaseId: string, actorUserId: string): Purchase {
  if (!actorUserId) throw new StockManagementError(400, 'actor_user_id is required');
  return withTxn(() => {
    const purchase = getPurchaseInternal(db, purchaseId);
    if (purchase.status !== 'review') throw new StockManagementError(409, `Only reviewed purchases can be received (current status: ${purchase.status})`);
    const priorMovement = db.prepare(`SELECT 1 FROM supply_movements WHERE reference_type = 'purchase' AND reference_id = ? LIMIT 1`).get(purchaseId);
    if (priorMovement) throw new StockManagementError(409, 'Purchase has already created inventory movements');
    const fractionDigits = resolveDbCurrencyFractionDigits(db);
    for (const item of purchase.items || []) {
      const supply = getSupply(db, item.supply_id);
      const total = roundCurrencyCost(item.line_total, fractionDigits);
      recordSupplyMovement(db, {
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
    const changed = db.prepare(`UPDATE purchases SET status = 'received', received_at = ?, received_by_user_id = ?, updated_at = ? WHERE id = ? AND status = 'review'`).run(now(), actorUserId, now(), purchaseId);
    if (changed.changes !== 1) throw new StockManagementError(409, 'Purchase receipt state changed while posting');
    return getPurchaseInternal(db, purchaseId);
  });
}

export interface StockCount { id: string; status: 'draft' | 'review' | 'posted'; notes: string | null; created_at: string; reviewed_at: string | null; posted_at: string | null; items?: StockCountItem[] }
export interface StockCountItem { id: number; stock_count_id: string; supply_id: string; supply_name_snapshot: string; base_unit_snapshot: SupplyUnit; expected_quantity: number; observed_stock_quantity: number | null; observed_at: string | null; actual_quantity: number | null; unit_cost_snapshot: number | null; variance_quantity: number | null; variance_cost: number | null; reason: string | null; supply_movement_id: number | null }

function getStockCountInternal(db: Database, countId: string): StockCount {
  const count = row(db.prepare('SELECT * FROM stock_counts WHERE id = ?').get(countId) as StockCount | undefined, 'Stock count not found');
  count.items = db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ? ORDER BY supply_name_snapshot COLLATE NOCASE').all(countId) as StockCountItem[];
  return count;
}
export const getStockCount = getStockCountInternal;

export function listStockCounts(db: Database, limit = 30): StockCount[] {
  return db.prepare('SELECT * FROM stock_counts ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 100)) as StockCount[];
}

export function startStockCount(db: Database, actorUserId: string, notes?: string | null): StockCount {
  if (!actorUserId) throw new StockManagementError(400, 'actor_user_id is required');
  const countId = id('count');
  withTxn(() => {
    db.prepare('INSERT INTO stock_counts (id, notes, started_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(countId, text(notes, 'notes', false, 2000), actorUserId, now(), now());
    for (const supply of listSupplies(db, { includeInactive: false })) {
      db.prepare(`INSERT INTO stock_count_items (stock_count_id, supply_id, supply_name_snapshot, base_unit_snapshot, expected_quantity, unit_cost_snapshot)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(countId, supply.id, supply.name, supply.base_unit, supply.stock_quantity, supply.unit_cost);
    }
  });
  return getStockCountInternal(db, countId);
}

export function saveStockCount(db: Database, countId: string, items: Array<{ supplyId: string; actualQuantity: number; reason?: string | null }>): StockCount {
  const count = getStockCountInternal(db, countId);
  if (count.status !== 'draft') throw new StockManagementError(409, 'Only draft stock counts can be edited');
  withTxn(() => {
    for (const input of items) {
      const item = row(db.prepare('SELECT * FROM stock_count_items WHERE stock_count_id = ? AND supply_id = ?').get(countId, String(input.supplyId)) as StockCountItem | undefined, 'Stock count item not found');
      const actual = roundQuantity(number(input.actualQuantity, 'actual_quantity', { nonNegative: true }));
      // Capture the live system quantity when the physical observation is saved.
      // Posting later applies only the observed variance as a delta, preserving
      // purchases, sales, wastage, and other movements that happen after this save.
      const liveSupply = getSupply(db, item.supply_id);
      const observedStock = roundQuantity(Number(liveSupply.stock_quantity));
      const variance = roundQuantity(actual - observedStock);
      const observedAt = now();
      const reason = text(input.reason, 'reason', false, 500);
      if (variance !== 0 && !reason) throw new StockManagementError(400, `A reason is required for a variance on ${item.supply_name_snapshot}`);
      const varianceCost = item.unit_cost_snapshot === null ? null : roundUnitCost(new Decimal(variance).mul(item.unit_cost_snapshot));
      db.prepare(`UPDATE stock_count_items
        SET actual_quantity = ?, observed_stock_quantity = ?, observed_at = ?, variance_quantity = ?, variance_cost = ?, reason = ?
        WHERE id = ?`).run(actual, observedStock, observedAt, variance, varianceCost, reason, item.id);
    }
    db.prepare('UPDATE stock_counts SET updated_at = ? WHERE id = ?').run(now(), countId);
  });
  return getStockCountInternal(db, countId);
}

export function reviewStockCount(db: Database, countId: string, actorUserId: string): StockCount {
  if (!actorUserId) throw new StockManagementError(400, 'actor_user_id is required');
  const count = getStockCountInternal(db, countId);
  if (count.status !== 'draft') throw new StockManagementError(409, 'Only draft stock counts can be reviewed');
  if ((count.items || []).some((item) => item.actual_quantity === null)) throw new StockManagementError(400, 'Every stock-count item requires an actual quantity before review');
  if ((count.items || []).some((item) => item.observed_stock_quantity === null || !item.observed_at || item.variance_quantity === null)) {
    throw new StockManagementError(409, 'Save the physical quantities again to capture current stock observations before review.');
  }
  const changed = db.prepare(`UPDATE stock_counts SET status = 'review', reviewed_by_user_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`).run(actorUserId, now(), now(), countId);
  if (changed.changes !== 1) throw new StockManagementError(409, 'Stock count state changed while reviewing');
  return getStockCountInternal(db, countId);
}

export function postStockCount(db: Database, countId: string, actorUserId: string): StockCount {
  if (!actorUserId) throw new StockManagementError(400, 'actor_user_id is required');
  return withTxn(() => {
    const count = getStockCountInternal(db, countId);
    if (count.status !== 'review') throw new StockManagementError(409, `Only reviewed stock counts can be posted (current status: ${count.status})`);
    if (db.prepare(`SELECT 1 FROM supply_movements WHERE reference_type = 'stock_count' AND reference_id = ? LIMIT 1`).get(countId)) throw new StockManagementError(409, 'Stock count has already created inventory movements');
    for (const item of count.items || []) {
      if (item.actual_quantity === null) throw new StockManagementError(400, 'Every stock-count item requires an actual quantity');
      if (item.observed_stock_quantity === null || !item.observed_at || item.variance_quantity === null) {
        throw new StockManagementError(409, 'This stock count has no concurrency-safe observation snapshot. Start a new stock count and enter the physical quantities again.');
      }
      if (Number(item.variance_quantity) === 0) continue;
      const movement = recordSupplyMovement(db, {
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
    const changed = db.prepare(`UPDATE stock_counts SET status = 'posted', posted_by_user_id = ?, posted_at = ?, updated_at = ? WHERE id = ? AND status = 'review'`).run(actorUserId, now(), now(), countId);
    if (changed.changes !== 1) throw new StockManagementError(409, 'Stock count state changed while posting');
    return getStockCountInternal(db, countId);
  });
}

export function recordWastage(db: Database, input: { supplyId: string; quantity: number; unit: SupplyUnit; wastageDate: string; reason: string; notes?: string | null; actorUserId: string }): { id: string; supply_movement_id: number | null } {
  if (!input.actorUserId) throw new StockManagementError(400, 'actor_user_id is required');
  const supply = getSupply(db, input.supplyId);
  const wastageId = id('waste');
  return withTxn(() => {
    db.prepare(`INSERT INTO stock_wastage_records (id, supply_id, quantity, unit, wastage_date, reason, notes, recorded_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(wastageId, supply.id, roundQuantity(number(input.quantity, 'quantity', { positive: true })), assertSupplyUnit(input.unit), date(input.wastageDate, 'wastage_date'), text(input.reason, 'reason', true, 500), text(input.notes, 'notes', false, 2000), input.actorUserId, now());
    const movement = recordSupplyMovement(db, { supplyId: supply.id, movementType: 'waste', quantity: input.quantity, unit: input.unit, reason: input.reason, actorUserId: input.actorUserId, referenceType: 'stock_wastage', referenceId: wastageId, createdAt: `${date(input.wastageDate, 'wastage_date')} 12:00:00` });
    db.prepare('UPDATE stock_wastage_records SET supply_movement_id = ? WHERE id = ?').run(movement?.id ?? null, wastageId);
    return { id: wastageId, supply_movement_id: movement?.id ?? null };
  });
}

export function stockDashboard(db: Database): Record<string, unknown> {
  const lowStock = listSupplies(db, { lowStockOnly: true });
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
