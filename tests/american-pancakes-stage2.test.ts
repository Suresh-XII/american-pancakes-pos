/** American Pancakes Stage 2 serving and packaging workflow regression tests. */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-american-pancakes-stage2-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const assert = require('assert');
const {
  initTestDb, createApp, startServer, seedOwnerUser, seedManagerUser, seedCategory, seedProduct,
  api, closeDatabase,
} = require('./helpers/test-setup');
const { orderRoutes } = require('../main/routes/orders');
const { packagingProfileRoutes } = require('../main/routes/packaging-profiles');

async function main() {
  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const manager = seedManagerUser(db);
  seedCategory(db, 'ap-category', 'Pancakes');
  seedProduct(db, 'ap-pancake', 'ap-category', 'Classic Pancakes', 100, {
    tax_type: 'none', stock_quantity: 0, track_inventory: 0,
  });
  db.prepare(`INSERT INTO supplies (id,name,base_unit,stock_quantity,unit_cost,is_active,created_at,updated_at)
    VALUES ('ap-plates','Paper plates','each',50,2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
           ('ap-boxes','Parcel boxes','each',50,7,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
  const app = createApp({ '/api/orders': orderRoutes, '/api/packaging-profiles': packagingProfileRoutes });
  const { baseUrl, server } = await startServer(app);
  const post = (url: string, body: any, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'POST', headers, body });
  try {
    // Only an owner may mutate profiles, including a manager who has the route permission.
    let result = await post('/api/packaging-profiles', {
      name: 'Plate', serving_type: 'dine_in', packaging_type: 'paper_plate', supply_id: 'ap-plates', is_default: true,
    }, manager.authHeader);
    assert.equal(result.status, 403, 'manager cannot configure packaging profiles');

    result = await post('/api/packaging-profiles', {
      name: 'Plate', serving_type: 'dine_in', packaging_type: 'paper_plate', supply_id: 'ap-plates',
      units_per_serving: 1, customer_charge_per_unit: 1, is_default: true,
    });
    assert.equal(result.status, 201, 'owner creates paper plate profile');
    const plateId = result.data.profile.id;
    result = await post('/api/packaging-profiles', {
      name: 'Box', serving_type: 'parcel', packaging_type: 'parcel_box', supply_id: 'ap-boxes',
      units_per_serving: 2, customer_charge_per_unit: 5, is_default: true,
    });
    assert.equal(result.status, 201, 'owner creates parcel box profile');
    const boxId = result.data.profile.id;

    const beforeSupplyMoves = Number(db.prepare('SELECT COUNT(*) AS n FROM supply_movements').get().n);
    const beforeInventoryMoves = Number(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n);
    result = await post('/api/orders', {
      type: 'dine_in',
      items: [{ product_id: 'ap-pancake', quantity: 3, serving_allocations: [
        { serving_type: 'dine_in', quantity: 1, packaging_profile_id: plateId },
        { serving_type: 'parcel', quantity: 2, packaging_profile_id: boxId },
      ] }],
    });
    assert.equal(result.status, 201, 'mixed serving order is accepted');
    const order = result.data.order;
    assert.equal(order.packaging_charge, 21, 'automatic packaging charges are summed correctly');
    assert.deepEqual(order.items[0].serving_allocations.map((a: any) => a.serving_type).sort(), ['dine_in', 'parcel']);
    const snapshots = order.items[0].serving_allocations.flatMap((a: any) => a.packaging_allocations);
    assert.equal(snapshots.find((p: any) => p.packaging_type_snapshot === 'paper_plate').quantity, 1, 'one plate is allocated for one dine-in pancake');
    assert.equal(snapshots.find((p: any) => p.packaging_type_snapshot === 'parcel_box').quantity, 4, 'two parcel pancakes automatically allocate four boxes');
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM supply_movements').get().n), beforeSupplyMoves, 'serving workflow creates no supply movement');
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n), beforeInventoryMoves, 'serving workflow creates no inventory movement');

    const reopened = await api(baseUrl, `/api/orders/${order.id}`, { headers: owner.authHeader });
    assert.equal(reopened.status, 200, 'order can be reopened');
    assert.equal(reopened.data.order.items[0].serving_allocations.length, 2, 'reopened order hydrates serving snapshots');

    const invalidTotal = await post('/api/orders', { type: 'dine_in', items: [{ product_id: 'ap-pancake', quantity: 2, serving_allocations: [{ serving_type: 'dine_in', quantity: 1, packaging_profile_id: plateId }] }] });
    assert.equal(invalidTotal.status, 400, 'allocation total mismatch is rejected');
    const automaticBoxes = await post('/api/orders', {
      type: 'takeaway',
      items: [{
        product_id: 'ap-pancake',
        quantity: 2,
        serving_allocations: [{
          serving_type: 'parcel',
          quantity: 2,
          packaging_profile_id: boxId,
        }],
      }],
    });

    assert.equal(automaticBoxes.status, 201, 'parcel boxes are allocated automatically');
    const automaticBoxSnapshot =
      automaticBoxes.data.order.items[0].serving_allocations[0].packaging_allocations[0];

    assert.equal(automaticBoxSnapshot.quantity, 4, 'two pancakes allocate four boxes');
    assert.equal(automaticBoxSnapshot.allocation_source, 'automatic');
    assert.equal(automaticBoxSnapshot.confirmed_by_user_id, null);
    assert.equal(automaticBoxSnapshot.confirmed_at, null);
    const incompatible = await post('/api/orders', { type: 'takeaway', items: [{ product_id: 'ap-pancake', quantity: 1, serving_allocations: [{ serving_type: 'parcel', quantity: 1, packaging_profile_id: plateId }] }] });
    assert.equal(incompatible.status, 400, 'incompatible profile is rejected');
    const deactivate = await api(baseUrl, `/api/packaging-profiles/${boxId}`, {
      method: 'PUT', headers: owner.authHeader,
      body: { name: 'Box', serving_type: 'parcel', packaging_type: 'parcel_box', supply_id: 'ap-boxes', units_per_serving: 1, customer_charge_per_unit: 5, is_active: false },
    });
    assert.equal(deactivate.status, 200, 'owner can deactivate a profile without deleting history');
    const inactive = await post('/api/orders', { type: 'takeaway', items: [{ product_id: 'ap-pancake', quantity: 1, serving_allocations: [{ serving_type: 'parcel', quantity: 1, packaging_profile_id: boxId }] }] });
    assert.equal(inactive.status, 400, 'inactive packaging profile is rejected');

    // Old requests and historical delivery records remain readable without allocation rows.
    const legacy = await post('/api/orders', { type: 'delivery', items: [{ product_id: 'ap-pancake', quantity: 1 }] });
    assert.equal(legacy.status, 201, 'legacy order without serving allocations remains accepted');
    const legacyRead = await api(baseUrl, `/api/orders/${legacy.data.order.id}`, { headers: owner.authHeader });
    assert.deepEqual(legacyRead.data.order.items[0].serving_allocations, [], 'legacy item reads with an empty allocation list');
    console.log('American Pancakes Stage 2 workflow tests passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => { console.error(error); process.exit(1); });
