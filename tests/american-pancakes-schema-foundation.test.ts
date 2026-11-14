/**
 * American Pancakes Stage 1 database foundation.
 *
 * Builds a v124 database, copies it as an existing customer database, and
 * upgrades only the copy through v125. The assertions keep legacy orders and
 * inventory history intact while exercising the new serving, packaging, and
 * consumption-ledger shapes.
 */
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const originalLoad = Module._load;
let activeTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-american-pancakes-source-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => activeTestDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const {
  initDatabase,
  getDatabase,
  getCurrentSchemaVersion,
  closeDatabase,
  MIGRATIONS,
} = require('../main/db');

const FOUNDATION_VERSION = 125;
const CURRENT_SCHEMA_VERSION = 131;

function tableExists(db: any, table: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
}

function movementCounts(db: any): { inventory: number; supply: number } {
  return {
    inventory: Number(db.prepare('SELECT COUNT(*) AS count FROM inventory_movements').get().count),
    supply: Number(db.prepare('SELECT COUNT(*) AS count FROM supply_movements').get().count),
  };
}

function seedLegacyDatabase(db: any): {
  orderId: number;
  itemId: number;
  inventoryMovementId: number;
  supplyMovementId: number;
  sourceCounts: { inventory: number; supply: number };
} {
  db.prepare(`
    INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
    VALUES ('owner-ap', 'American Pancakes Owner', 'owner@american-pancakes.local', 'x', 'owner', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();
  db.prepare(`INSERT INTO categories (id, name) VALUES ('cat-ap', 'Pancakes')`).run();
  db.prepare(`
    INSERT INTO products (id, category_id, name, price, track_inventory, stock_quantity)
    VALUES ('prod-ap', 'cat-ap', 'Classic Pancakes', 240, 1, 20)
  `).run();
  db.prepare(`
    INSERT INTO supplies (id, name, base_unit, stock_quantity, unit_cost, is_active, created_at, updated_at)
    VALUES
      ('sup-flour-ap', 'Flour', 'g', 1000, 0.08, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('sup-plate-ap', 'Paper Plate', 'each', 50, 2.5, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('sup-box-ap', 'Parcel Box', 'each', 50, 8, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();

  const order = db
    .prepare(`
      INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at)
      VALUES ('AP-LEGACY-1', 'owner-ap', 'takeaway', 'completed', 720, 720, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .run();
  const orderId = Number(order.lastInsertRowid);
  const item = db
    .prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity, subtotal, total,
        status, recipe_snapshot, ingredient_cost, ingredient_cost_known, created_at, updated_at
      ) VALUES (?, 'prod-ap', 'Classic Pancakes', 240, 3, 720, 720, 'completed', ?, 24, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .run(orderId, JSON.stringify({ recipe_id: 'legacy-recipe', components: [{ supply_id: 'sup-flour-ap' }] }));
  const itemId = Number(item.lastInsertRowid);

  const inventoryMovement = db
    .prepare(`
      INSERT INTO inventory_movements (
        product_id, quantity_delta, movement_type, reference_type, reference_id,
        reason, actor_user_id, stock_after, created_at
      ) VALUES ('prod-ap', -3, 'sale', 'order_item', ?, 'Legacy sale', 'owner-ap', 17, CURRENT_TIMESTAMP)
    `)
    .run(String(itemId));
  const supplyMovement = db
    .prepare(`
      INSERT INTO supply_movements (
        supply_id, quantity_delta, movement_type, unit, stock_after, reason,
        actor_user_id, reference_type, reference_id, created_at
      ) VALUES ('sup-flour-ap', -150, 'recipe_depletion', 'g', 850, 'Legacy recipe use', 'owner-ap', 'order_item', ?, CURRENT_TIMESTAMP)
    `)
    .run(String(itemId));

  return {
    orderId,
    itemId,
    inventoryMovementId: Number(inventoryMovement.lastInsertRowid),
    supplyMovementId: Number(supplyMovement.lastInsertRowid),
    sourceCounts: movementCounts(db),
  };
}

function main(): void {
  const originalRegistry = MIGRATIONS.slice();
  const sourceDir = activeTestDir;
  const upgradedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-american-pancakes-upgrade-'));

  try {
    MIGRATIONS.length = 0;
    MIGRATIONS.push(...originalRegistry.filter((migration: any) => migration.version < FOUNDATION_VERSION));
    initDatabase();
    let db = getDatabase();
    assert.equal(getCurrentSchemaVersion(), 124, 'source database starts at v124');
    const fixture = seedLegacyDatabase(db);
    const legacyOrder = db
      .prepare('SELECT order_number, type, status, total FROM orders WHERE id = ?')
      .get(fixture.orderId);
    const legacyItem = db
      .prepare('SELECT recipe_snapshot, ingredient_cost, ingredient_cost_known FROM order_items WHERE id = ?')
      .get(fixture.itemId);
    db.pragma('wal_checkpoint(TRUNCATE)');
    closeDatabase();

    fs.copyFileSync(path.join(sourceDir, 'flo.db'), path.join(upgradedDir, 'flo.db'));

    activeTestDir = upgradedDir;
    MIGRATIONS.length = 0;
    MIGRATIONS.push(...originalRegistry);
    initDatabase();
    db = getDatabase();

    assert.equal(getCurrentSchemaVersion(), CURRENT_SCHEMA_VERSION, 'copied database upgrades through v131');
    for (const table of [
      'packaging_profiles',
      'order_item_serving_allocations',
      'order_item_packaging_allocations',
      'order_inventory_consumptions',
      'packaging_profile_materials',
      'delivery_platform_configs',
      'delivery_menu_mappings',
      'delivery_order_tracking',
      'delivery_webhook_events',
      'promotions',
      'promotion_products',
      'promotion_redemptions',
    ]) {
      assert(tableExists(db, table), `${table} is created by v125/v129/v130/v131`);
    }
    for (const table of [
      'suppliers',
      'purchases',
      'purchase_items',
      'stock_counts',
      'stock_count_items',
      'stock_wastage_records',
    ]) {
      assert(tableExists(db, table), `${table} is created by v127`);
    }
    const stockCountColumns = db.prepare('PRAGMA table_info(stock_count_items)').all().map((column: any) => column.name);
    assert(stockCountColumns.includes('observed_stock_quantity'), 'v128 adds observed stock quantity');
    assert(stockCountColumns.includes('observed_at'), 'v128 adds observation timestamp');
    assert.deepEqual(
      db.prepare('SELECT order_number, type, status, total FROM orders WHERE id = ?').get(fixture.orderId),
      legacyOrder,
      'historical order remains readable and unchanged',
    );
    assert.deepEqual(
      db
        .prepare('SELECT recipe_snapshot, ingredient_cost, ingredient_cost_known FROM order_items WHERE id = ?')
        .get(fixture.itemId),
      legacyItem,
      'historical recipe and ingredient-cost snapshots remain unchanged',
    );
    assert.deepEqual(movementCounts(db), fixture.sourceCounts, 'existing inventory movements remain unchanged');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM order_item_serving_allocations').get().count,
      0,
      'legacy order items are not rewritten into serving allocations',
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM order_inventory_consumptions').get().count,
      0,
      'migration creates no inventory-consumption records',
    );

    db.prepare(`
      INSERT INTO packaging_profiles (
        id, name, serving_type, packaging_type, supply_id, units_per_serving,
        customer_charge_per_unit, is_active, is_default, created_by_user_id, updated_by_user_id
      ) VALUES
        ('profile-plate', 'Paper Plate', 'dine_in', 'paper_plate', 'sup-plate-ap', 1, 0, 1, 1, 'owner-ap', 'owner-ap'),
        ('profile-box', 'Parcel Box', 'parcel', 'parcel_box', 'sup-box-ap', 1, 12, 1, 1, 'owner-ap', 'owner-ap')
    `).run();
    db.prepare(`
      INSERT INTO order_item_serving_allocations (order_item_id, serving_type, quantity)
      VALUES (?, 'dine_in', 1), (?, 'parcel', 2)
    `).run(fixture.itemId, fixture.itemId);
    const allocations = db
      .prepare(`
        SELECT id, serving_type, quantity
        FROM order_item_serving_allocations
        WHERE order_item_id = ?
        ORDER BY serving_type
      `)
      .all(fixture.itemId);
    assert.deepEqual(
      allocations.map((allocation: any) => [allocation.serving_type, allocation.quantity]),
      [
        ['dine_in', 1],
        ['parcel', 2],
      ],
      'one order item supports mixed Dine-in and Parcel quantities',
    );
    assert.throws(
      () =>
        db
          .prepare('UPDATE order_item_serving_allocations SET quantity = 2 WHERE serving_type = ?')
          .run('dine_in'),
      /Serving allocation exceeds order item quantity/,
      'serving allocations cannot exceed the order item quantity',
    );
    assert.throws(
      () =>
        db
          .prepare(`
            INSERT INTO packaging_profiles (
              id, name, serving_type, packaging_type, supply_id, created_by_user_id, updated_by_user_id
            ) VALUES ('invalid-profile', 'Invalid', 'parcel', 'paper_plate', 'sup-plate-ap', 'owner-ap', 'owner-ap')
          `)
          .run(),
      /CHECK constraint failed/,
      'Parcel profiles cannot be configured as paper plates',
    );
    const dineInAllocationId = Number(allocations.find((row: any) => row.serving_type === 'dine_in').id);
    const parcelAllocationId = Number(allocations.find((row: any) => row.serving_type === 'parcel').id);
    db.prepare(`
      INSERT INTO order_item_packaging_allocations (
        serving_allocation_id, packaging_profile_id, supply_id_snapshot,
        packaging_name_snapshot, packaging_type_snapshot, quantity,
        unit_cost_snapshot, total_cost_snapshot, cost_known,
        customer_charge_per_unit_snapshot, customer_charge_total_snapshot,
        allocation_source, confirmed_by_user_id, confirmed_at
      ) VALUES
        (?, 'profile-plate', 'sup-plate-ap', 'Paper Plate', 'paper_plate', 1, 2.5, 2.5, 1, 0, 0, 'automatic', NULL, NULL),
        (?, 'profile-box', 'sup-box-ap', 'Parcel Box', 'parcel_box', 1, 8, 8, 1, 12, 12, 'manual', 'owner-ap', CURRENT_TIMESTAMP)
    `).run(dineInAllocationId, parcelAllocationId);
    const parcelPackaging = db
      .prepare(`
        SELECT quantity, packaging_type_snapshot, unit_cost_snapshot,
          total_cost_snapshot, customer_charge_total_snapshot, allocation_source,
          confirmed_by_user_id
        FROM order_item_packaging_allocations
        WHERE serving_allocation_id = ?
      `)
      .get(parcelAllocationId);
    assert.deepEqual(
      parcelPackaging,
      {
        quantity: 1,
        packaging_type_snapshot: 'parcel_box',
        unit_cost_snapshot: 8,
        total_cost_snapshot: 8,
        customer_charge_total_snapshot: 12,
        allocation_source: 'manual',
        confirmed_by_user_id: 'owner-ap',
      },
      'manual Parcel box allocation stores immutable quantity, type, cost, and charge snapshots',
    );

    db.prepare(`
      INSERT INTO order_inventory_consumptions (
        id, order_id, order_item_id, completion_reference, idempotency_key,
        consumption_kind, inventory_movement_id
      ) VALUES ('consume-product', ?, ?, 'completed-order:AP-LEGACY-1', 'AP-LEGACY-1:product', 'product', ?)
    `).run(fixture.orderId, fixture.itemId, fixture.inventoryMovementId);
    db.prepare(`
      INSERT INTO order_inventory_consumptions (
        id, order_id, order_item_id, packaging_allocation_id, completion_reference,
        idempotency_key, consumption_kind, supply_movement_id
      ) VALUES ('consume-packaging', ?, ?, ?, 'completed-order:AP-LEGACY-1', 'AP-LEGACY-1:packaging:box', 'packaging', ?)
    `).run(
      fixture.orderId,
      fixture.itemId,
      Number(
        db
          .prepare('SELECT id FROM order_item_packaging_allocations WHERE serving_allocation_id = ?')
          .get(parcelAllocationId).id,
      ),
      fixture.supplyMovementId,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM order_inventory_consumptions').get().count,
      2,
      'consumption ledger represents product and packaging movement links',
    );
    assert.deepEqual(
      movementCounts(db),
      fixture.sourceCounts,
      'representing consumption links does not alter inventory quantities or movement history',
    );

    const migration = MIGRATIONS.find((entry: any) => entry.version === FOUNDATION_VERSION);
    assert(migration, 'v125 migration is registered');
    db.transaction(() => migration.up())();
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM order_item_packaging_allocations').get().count,
      2,
      're-running v125 is repeatable and does not duplicate packaging allocations',
    );

    closeDatabase();
    const sourceDb = new Database(path.join(sourceDir, 'flo.db'), { readonly: true });
    try {
      assert.equal(sourceDb.pragma('user_version', { simple: true }), 124, 'source database copy remains at v124');
      assert(!tableExists(sourceDb, 'packaging_profiles'), 'source database copy is not modified');
      assert.deepEqual(movementCounts(sourceDb), fixture.sourceCounts, 'source inventory history is untouched');
    } finally {
      sourceDb.close();
    }

    console.log('American Pancakes Stage 1 schema foundation: all assertions passed');
  } finally {
    closeDatabase();
    MIGRATIONS.length = 0;
    MIGRATIONS.push(...originalRegistry);
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(upgradedDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
