/** Independent file-backed SQLite writer safety check for checkout_v1 settlement. */
const Module = require('module'); const originalLoad = Module._load;
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert'); const { spawnSync } = require('child_process');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-ap-stage3-writers-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) { if (request === 'electron') return { app:{isPackaged:true,getPath:()=>testDir,getVersion:()=> 'test'} }; return originalLoad.apply(this, arguments as any); };
const Database = require('better-sqlite3');
const { initTestDb, seedOwnerUser, seedCategory, seedProduct, closeDatabase } = require('./helpers/test-setup');
const { completeExactBalanceSettlement } = require('../main/routes/bills');
// The test mocks `electron` for the application runtime, so resolve the
// separately launched Electron executable from its installed distribution.
const electronPath = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
function count(db:any, table:string) { return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n); }
function main() {
  const db = initTestDb(); const owner=seedOwnerUser(db); seedCategory(db,'writers-cat','Writers'); seedProduct(db,'writers-product','writers-cat','Pancake',100,{tax_type:'none',stock_quantity:5,track_inventory:true});
  db.prepare("INSERT INTO supplies(id,name,base_unit,stock_quantity,is_active,created_at,updated_at) VALUES ('writers-flour','Flour','g',100,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run();
  const order=db.prepare("INSERT INTO orders(order_number,user_id,type,status,inventory_lifecycle,created_at,updated_at) VALUES ('writers',?,'takeaway','pending','checkout_v1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(owner.userId);
  db.prepare("INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,subtotal,total,inventory_deducted_quantity,inventory_product_id,recipe_snapshot,status,created_at,updated_at) VALUES (?,'writers-product','Pancake',100,1,100,100,1,'writers-product',?,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(order.lastInsertRowid,JSON.stringify({components:[{supply_id:'writers-flour',quantity:10,base_unit:'g'}]}));
  const bill=db.prepare("INSERT INTO bills(bill_number,order_id,subtotal,total,paid_amount,balance,payment_status,created_at,updated_at) VALUES ('writers',?,100,100,100,0,'unpaid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(order.lastInsertRowid);
  const dbPath=path.join(testDir,'flo.db'); const lock=new Database(dbPath,{timeout:50}); lock.exec('BEGIN IMMEDIATE');
  try {
    const worker=spawnSync(electronPath,[path.join(process.cwd(),'tests','fixtures','stage3-settlement-writer.cjs'),dbPath,String(bill.lastInsertRowid)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:30000});
    assert.equal(worker.status,12,`independent blocked writer reports SQLITE_BUSY: ${worker.stderr || worker.stdout}`);
    assert.equal(count(db,'order_inventory_consumptions'),0,'blocked writer leaves no ledger entries');
    assert.equal(count(db,'inventory_movements'),0,'blocked writer leaves no product movement');
    assert.equal(count(db,'supply_movements'),0,'blocked writer leaves no ingredient movement');
    assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='writers-product'").get().stock_quantity),5,'blocked writer leaves product stock unchanged');
  } finally { lock.exec('ROLLBACK'); lock.close(); }
  const retry=new Database(dbPath,{timeout:1000}); completeExactBalanceSettlement(retry,bill.lastInsertRowid,100,'INR'); retry.close();
  assert.equal(count(db,'order_inventory_consumptions'),2,'retry records exactly product and ingredient consumption');
  assert.equal(count(db,'inventory_movements'),1,'retry records one product movement'); assert.equal(count(db,'supply_movements'),1,'retry records one ingredient movement');
  assert.equal(Number(db.prepare("SELECT stock_quantity FROM products WHERE id='writers-product'").get().stock_quantity),4); assert.equal(Number(db.prepare("SELECT stock_quantity FROM supplies WHERE id='writers-flour'").get().stock_quantity),90);
  const retryAgain=new Database(dbPath,{timeout:1000}); completeExactBalanceSettlement(retryAgain,bill.lastInsertRowid,100,'INR'); retryAgain.close();
  assert.equal(count(db,'order_inventory_consumptions'),2,'independent retry cannot duplicate ledger'); assert.equal(count(db,'inventory_movements'),1,'independent retry cannot duplicate movement');
  assert.equal(db.prepare('SELECT payment_status FROM bills WHERE id=?').get(bill.lastInsertRowid).payment_status,'paid'); assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(order.lastInsertRowid).status,'completed');
  closeDatabase(); fs.rmSync(testDir,{recursive:true,force:true}); console.log('American Pancakes Stage 3 independent-writer test passed.');
}
main();
