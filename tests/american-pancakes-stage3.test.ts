/** Isolated Stage 3 checkout-consumption invariants. */
const Module = require('module'); const originalLoad = Module._load;
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-ap-stage3-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};
const { initTestDb, seedOwnerUser, seedCategory, seedProduct, closeDatabase } = require('./helpers/test-setup');
const { consumeCheckoutInventory } = require('../main/services/checkout-inventory');
const { completeExactBalanceSettlement } = require('../main/routes/bills');

function count(db: any, table: string) { return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n); }
function main() {
  const db = initTestDb(); const owner = seedOwnerUser(db); seedCategory(db, 'cat', 'Pancakes');
  seedProduct(db, 'p', 'cat', 'Pancake', 100, { tax_type: 'none', stock_quantity: 10, track_inventory: 1 });
  db.prepare(`INSERT INTO supplies (id,name,base_unit,stock_quantity,unit_cost,is_active,created_at,updated_at) VALUES
    ('flour','Flour','g',1000,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('plate','Plate','each',10,2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('box','Box','each',10,3,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
  const order = db.prepare(`INSERT INTO orders(order_number,user_id,type,status,inventory_lifecycle,created_at,updated_at) VALUES ('v126',?,'dine_in','pending','checkout_v1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(owner.userId);
  const item = db.prepare(`INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal,total,inventory_deducted_quantity,inventory_product_id,recipe_snapshot,status,created_at,updated_at) VALUES (?, 'p','Pancake',100,3,300,300,3,'p',?,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(order.lastInsertRowid, JSON.stringify({ components:[{supply_id:'flour',quantity:90,base_unit:'g'}] }));
  const serving = db.prepare(`INSERT INTO order_item_serving_allocations(order_item_id,serving_type,quantity) VALUES (?,'dine_in',1),(?,'parcel',2)`).run(item.lastInsertRowid,item.lastInsertRowid);
  const servingRows = db.prepare('SELECT id,serving_type FROM order_item_serving_allocations WHERE order_item_id=?').all(item.lastInsertRowid) as any[];
  db.prepare(`INSERT INTO packaging_profiles(id,name,serving_type,packaging_type,supply_id,created_by_user_id,updated_by_user_id) VALUES ('plate-profile','Plate','dine_in','paper_plate','plate',?,?),('box-profile','Box','parcel','parcel_box','box',?,?)`).run(owner.userId,owner.userId,owner.userId,owner.userId);
  for (const row of servingRows) db.prepare(`INSERT INTO order_item_packaging_allocations(serving_allocation_id,packaging_profile_id,supply_id_snapshot,packaging_name_snapshot,packaging_type_snapshot,quantity,allocation_source) VALUES (?, ?, ?, ?, ?, ?, ? )`).run(row.id,row.serving_type === 'dine_in' ? 'plate-profile':'box-profile',row.serving_type === 'dine_in'?'plate':'box',row.serving_type === 'dine_in'?'Plate':'Box',row.serving_type === 'dine_in'?'paper_plate':'parcel_box',row.serving_type === 'dine_in'?1:1,row.serving_type === 'dine_in'?'automatic':'manual');
  const before = { p: 10, flour: 1000, plate: 10, box: 10 };
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='p'").get().stock_quantity), before.p, 'creation fixture has no deduction');
  // The later profile edit must not alter this order's immutable snapshots.
  db.prepare("UPDATE packaging_profiles SET supply_id = 'plate' WHERE id = 'box-profile'").run();
  db.transaction(() => consumeCheckoutInventory(db, Number(order.lastInsertRowid), owner.userId, 'bill:1'))();
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='p'").get().stock_quantity), 7);
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM supplies WHERE id='flour'").get().stock_quantity), 910);
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM supplies WHERE id='plate'").get().stock_quantity), 9);
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM supplies WHERE id='box'").get().stock_quantity), 9);
  const movements = { inventory: count(db,'inventory_movements'), supply: count(db,'supply_movements'), ledger: count(db,'order_inventory_consumptions') };
  db.transaction(() => consumeCheckoutInventory(db, Number(order.lastInsertRowid), owner.userId, 'bill:1'))();
  assert.deepEqual({ inventory: count(db,'inventory_movements'), supply: count(db,'supply_movements'), ledger: count(db,'order_inventory_consumptions') }, movements, 'retry is idempotent');
  const legacy = db.prepare(`INSERT INTO orders(order_number,user_id,type,status,inventory_lifecycle,created_at,updated_at) VALUES ('old',?,'dine_in','completed','legacy',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(owner.userId);
  db.transaction(() => consumeCheckoutInventory(db, Number(legacy.lastInsertRowid), owner.userId, 'bill:old'))();
  assert.equal(count(db,'order_inventory_consumptions'), movements.ledger, 'legacy order is never replayed');

  // Use the actual settlement entry point: it owns the enclosing transaction,
  // so a failed snapshot movement must roll back both bill and inventory work.
  const settledOrder = db.prepare(`INSERT INTO orders(order_number,user_id,type,status,inventory_lifecycle,created_at,updated_at) VALUES ('settled',?,'dine_in','pending','checkout_v1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(owner.userId);
  db.prepare(`INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal,total,inventory_deducted_quantity,inventory_product_id,recipe_snapshot,status,created_at,updated_at) VALUES (?, 'p','Pancake',100,1,100,100,1,'p',?,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(settledOrder.lastInsertRowid, JSON.stringify({ components:[{supply_id:'flour',quantity:30,base_unit:'g'}] }));
  const settledBill = db.prepare(`INSERT INTO bills(bill_number,order_id,subtotal,total,paid_amount,balance,payment_status,created_at,updated_at) VALUES ('B-SETTLED',?,100,100,100,0,'unpaid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(settledOrder.lastInsertRowid);
  completeExactBalanceSettlement(db, settledBill.lastInsertRowid, 100, 'INR');
  assert.equal(db.prepare('SELECT payment_status FROM bills WHERE id=?').get(settledBill.lastInsertRowid).payment_status, 'paid', 'settlement completes its bill');
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='p'").get().stock_quantity), 6, 'settlement consumes product once');
  const afterSettlementLedger = count(db, 'order_inventory_consumptions');
  completeExactBalanceSettlement(db, settledBill.lastInsertRowid, 100, 'INR');
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='p'").get().stock_quantity), 6, 'repeated settlement cannot consume twice');
  assert.equal(count(db, 'order_inventory_consumptions'), afterSettlementLedger, 'repeated settlement keeps ledger stable');

  const failingOrder = db.prepare(`INSERT INTO orders(order_number,user_id,type,status,inventory_lifecycle,created_at,updated_at) VALUES ('failing',?,'dine_in','pending','checkout_v1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(owner.userId);
  db.prepare(`INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal,total,inventory_deducted_quantity,inventory_product_id,recipe_snapshot,status,created_at,updated_at) VALUES (?, 'p','Pancake',100,1,100,100,1,'p',?,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(failingOrder.lastInsertRowid, JSON.stringify({ components:[{supply_id:'missing-supply',quantity:1,base_unit:'g'}] }));
  const failingBill = db.prepare(`INSERT INTO bills(bill_number,order_id,subtotal,total,paid_amount,balance,payment_status,created_at,updated_at) VALUES ('B-FAIL',?,100,100,100,0,'unpaid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(failingOrder.lastInsertRowid);
  const countsBeforeFailure = { inventory: count(db, 'inventory_movements'), supply: count(db, 'supply_movements'), ledger: count(db, 'order_inventory_consumptions') };
  assert.throws(() => completeExactBalanceSettlement(db, failingBill.lastInsertRowid, 100, 'INR'), /Supply not found/);
  assert.equal(db.prepare('SELECT payment_status FROM bills WHERE id=?').get(failingBill.lastInsertRowid).payment_status, 'unpaid', 'failed consumption rolls bill state back');
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='p'").get().stock_quantity), 6, 'failed consumption rolls product movement back');
  assert.deepEqual({ inventory: count(db, 'inventory_movements'), supply: count(db, 'supply_movements'), ledger: count(db, 'order_inventory_consumptions') }, countsBeforeFailure, 'failed consumption rolls movements and ledger back');
  closeDatabase(); fs.rmSync(testDir,{recursive:true,force:true}); console.log('American Pancakes Stage 3 focused tests passed.');
}
main();
