/** Stage 4 purchases, suppliers, count and wastage workflow. */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-american-pancakes-stage4-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  assertEqualOrThrow, assertOrThrow, closeDatabase, createApp, getResults, initTestDb,
  seedOwnerUser, startServer, api,
} = require('./helpers/test-setup');
const { createSupply, getSupply, recordSupplyMovement } = require('../main/services/supplies');
const {
  StockManagementError, createPurchase, createSupplier, deleteSupplier, getStockCount,
  postStockCount, receivePurchase, recordWastage, reviewPurchase, reviewStockCount,
  saveStockCount, startStockCount,
} = require('../main/services/stock-management');
const { stockManagementRoutes } = require('../main/routes/stock-management');

function expectError(fn: () => unknown, status: number, label: string) {
  try { fn(); throw new Error(`${label}: expected an error`); }
  catch (error: any) { assertEqualOrThrow(error?.statusCode, status, label); }
}

async function main() {
  console.log('American Pancakes Stage 4 workflow tests');
  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const flour = createSupply(db, { name: 'Flour', baseUnit: 'kg', stockQuantity: 10, unitCost: 40, actorUserId: owner.userId });
  const boxes = createSupply(db, { name: 'Parcel boxes', baseUnit: 'each', stockQuantity: 5, unitCost: 2, actorUserId: owner.userId });

  console.log('\n--- Supplier records and references ---');
  const supplier = createSupplier(db, { name: 'Mill Supply', contact_name: 'Mira', phone: '123', email: null, address: null, notes: null });
  assertEqualOrThrow(supplier.is_active, 1, 'supplier starts active');
  const unused = createSupplier(db, { name: 'Unused', contact_name: null, phone: null, email: null, address: null, notes: null });
  deleteSupplier(db, unused.id);
  assertEqualOrThrow(db.prepare('SELECT deleted_at FROM suppliers WHERE id = ?').get(unused.id).deleted_at !== null, true, 'unreferenced supplier is soft deleted');
  expectError(() => createPurchase(db, {
    purchaseDate: '2026-11-04', actorUserId: owner.userId,
    items: [{ supplyId: flour.id, quantity: 1, purchaseUnit: 'pack', packSizeInBase: 10, unitPrice: 1 }],
  }), 400, 'packs cannot silently convert into a weight-based supply');

  console.log('\n--- Draft → review → receive is the only stock-changing purchase transition ---');
  const purchase = createPurchase(db, {
    supplierId: supplier.id, purchaseDate: '2026-11-04', invoiceNumber: 'INV-4', additionalExpenses: 15,
    paymentStatus: 'partial', actorUserId: owner.userId,
    items: [
      { supplyId: flour.id, quantity: 2, purchaseUnit: 'kg', unitPrice: 50 },
      { supplyId: boxes.id, quantity: 2, purchaseUnit: 'pack', packSizeInBase: 25, unitPrice: 30 },
    ],
  });
  assertEqualOrThrow(getSupply(db, flour.id).stock_quantity, 10, 'draft purchase does not add ingredient stock');
  assertEqualOrThrow(getSupply(db, boxes.id).stock_quantity, 5, 'draft pack purchase does not add packaging stock');
  assertEqualOrThrow(purchase.grand_total, 175, 'purchase stores item totals plus additional expenses');
  expectError(() => receivePurchase(db, purchase.id, owner.userId), 409, 'draft purchase cannot be received');
  reviewPurchase(db, purchase.id, owner.userId);
  receivePurchase(db, purchase.id, owner.userId);
  assertEqualOrThrow(getSupply(db, flour.id).stock_quantity, 12, 'received purchase increases kg supply');
  assertEqualOrThrow(getSupply(db, boxes.id).stock_quantity, 55, 'pack receipt converts explicit pack size into pieces');
  assertEqualOrThrow(db.prepare("SELECT COUNT(*) AS total FROM supply_movements WHERE reference_type = 'purchase' AND reference_id = ?").get(purchase.id).total, 2, 'receipt creates one ledger movement per item');
  expectError(() => receivePurchase(db, purchase.id, owner.userId), 409, 'receiving twice is rejected without duplicate movements');
  expectError(() => deleteSupplier(db, supplier.id), 409, 'referenced supplier cannot be deleted');

  console.log('\n--- Count snapshots, review and posting ---');
  const count = startStockCount(db, owner.userId, 'Month end');
  const countItems = getStockCount(db, count.id).items;
  saveStockCount(db, count.id, countItems.map((item: any) => ({
    supplyId: item.supply_id,
    actualQuantity: item.supply_id === flour.id ? 11 : item.expected_quantity,
    reason: item.supply_id === flour.id ? 'Scale variance' : null,
  })));
  reviewStockCount(db, count.id, owner.userId);
  postStockCount(db, count.id, owner.userId);
  assertEqualOrThrow(getSupply(db, flour.id).stock_quantity, 11, 'posted physical count sets actual stock');
  assertEqualOrThrow(db.prepare("SELECT COUNT(*) AS total FROM supply_movements WHERE reference_type = 'stock_count' AND reference_id = ?").get(count.id).total, 1, 'only count variances create adjustment ledger movements');
  assertEqualOrThrow(getStockCount(db, count.id).items.find((item: any) => item.supply_id === flour.id).variance_cost, -41.6666666667, 'count keeps the weighted unit-cost snapshot captured when counting began');
  expectError(() => postStockCount(db, count.id, owner.userId), 409, 'posting a count twice is rejected');

  console.log('\n--- Movements after count save are preserved when posting ---');
  const concurrentCount = startStockCount(db, owner.userId, 'Count while sales continue');
  const concurrentItems = getStockCount(db, concurrentCount.id).items;
  const flourCountItem = concurrentItems.find((item: any) => item.supply_id === flour.id);
  const countedFlour = Number(flourCountItem.expected_quantity);
  saveStockCount(db, concurrentCount.id, concurrentItems.map((item: any) => ({
    supplyId: item.supply_id,
    actualQuantity: item.supply_id === flour.id ? countedFlour : Number(item.expected_quantity),
    reason: null,
  })));
  // Simulate a sale/consumption after the owner saved the physical observation.
  recordSupplyMovement(db, {
    supplyId: flour.id, movementType: 'waste', quantity: 2, unit: 'kg',
    actorUserId: owner.userId, reason: 'Movement during count posting delay',
    referenceType: 'stage4_test', referenceId: concurrentCount.id,
  });
  const stockAfterInterveningMovement = getSupply(db, flour.id).stock_quantity;
  reviewStockCount(db, concurrentCount.id, owner.userId);
  postStockCount(db, concurrentCount.id, owner.userId);
  assertEqualOrThrow(getSupply(db, flour.id).stock_quantity, stockAfterInterveningMovement, 'posting a count with zero observed variance preserves later stock movements');
  assertEqualOrThrow(getStockCount(db, concurrentCount.id).items.find((item: any) => item.supply_id === flour.id).observed_stock_quantity, countedFlour, 'count stores the live system quantity at observation save time');

  console.log('\n--- Wastage stays a physical ledger event ---');
  const waste = recordWastage(db, { supplyId: boxes.id, quantity: 3, unit: 'each', wastageDate: '2026-11-04', reason: 'Damaged cartons', notes: 'Rain', actorUserId: owner.userId });
  assertEqualOrThrow(getSupply(db, boxes.id).stock_quantity, 52, 'wastage lowers packaging stock once');
  assertEqualOrThrow(db.prepare("SELECT reference_type FROM supply_movements WHERE id = ?").get(waste.supply_movement_id).reference_type, 'stock_wastage', 'wastage is linked to its auditable record');

  console.log('\n--- Owner API is mounted and protects the workflow ---');
  const app = createApp({ '/api/stock-management': stockManagementRoutes });
  const { baseUrl, server } = await startServer(app);
  try {
    const dashboard = await api(baseUrl, '/api/stock-management/dashboard', { headers: owner.authHeader });
    assertEqualOrThrow(dashboard.status, 200, 'owner can read stock dashboard');
    assertOrThrow(Array.isArray(dashboard.data.recent_purchases), 'dashboard exposes recent purchases');
    const apiSupplier = await api(baseUrl, '/api/stock-management/suppliers', { method: 'POST', headers: owner.authHeader, body: { name: 'API supplier' } });
    assertEqualOrThrow(apiSupplier.status, 201, 'owner can create supplier through API');
  } finally { await new Promise<void>((resolve) => server.close(resolve)); }

  const results = getResults();
  console.log(`${results.passed}/${results.total} passed, ${results.failed} failed`);
  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
  process.exit(results.failed === 0 ? 0 : 1);
}
main().catch((error: unknown) => { console.error(error); closeDatabase(); process.exit(1); });
