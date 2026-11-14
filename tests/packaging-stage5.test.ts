/**
 * Stage 5 – Complete Packaging Configuration and Inventory Integration Tests
 *
 * Covers:
 * 1. Packaging material CRUD, SKU, category, UOM, validation, and movements.
 * 2. Packaging profiles with multi-material components and duplication.
 * 3. Product and variant assignment precedence (Item override > Variant > Product > Serving default > None).
 * 4. Immutable order-item packaging snapshots and deferred consumption (checkout_v1).
 * 5. Manual packaging adjustments workflow, charge recalculation, and settlement lock.
 * 6. Checkout consumption, ledger movements, idempotency, and cancellation invariants.
 * 7. Role and permission enforcement (Owner vs Manager vs Staff).
 * 8. Packaging dashboard KPI and low-stock alerts.
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-ap-stage5-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const assert = require('assert');
const {
  initTestDb,
  createApp,
  startServer,
  seedOwnerUser,
  seedManagerUser,
  seedCategory,
  seedProduct,
  api,
  closeDatabase,
} = require('./helpers/test-setup');
const { orderRoutes } = require('../main/routes/orders');
const { packagingProfileRoutes } = require('../main/routes/packaging-profiles');
const { packagingRoutes } = require('../main/routes/packaging');
const { billRoutes, completeExactBalanceSettlement } = require('../main/routes/bills');
const { consumeCheckoutInventory } = require('../main/services/checkout-inventory');

async function main() {
  console.log('--- Starting Stage 5 Packaging Configuration & Inventory Tests ---');
  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const manager = seedManagerUser(db);

  // Mount express app with packaging, order, and billing routes
  const app = createApp({
    '/api/packaging': packagingRoutes,
    '/api/packaging-profiles': packagingProfileRoutes,
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  const get = (url: string, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'GET', headers });
  const post = (url: string, body: any, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'POST', headers, body });
  const put = (url: string, body: any, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'PUT', headers, body });
  const del = (url: string, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'DELETE', headers });

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // 1. Role and Permission Enforcement
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n1. Verifying Role & Permission Enforcement...');
    const { getJWTSecret } = require('../main/routes/auth');
    const jwt = require('jsonwebtoken');
    const staffToken = jwt.sign({ userId: 'staff-001', email: 'staff@test.local', role: 'cashier' }, getJWTSecret(), {
      expiresIn: '1h',
    });
    const staffAuth = { Authorization: `Bearer ${staffToken}` };

    let res = await post('/api/packaging/materials', {
      name: 'Staff Box',
      base_unit: 'each',
      stock_quantity: 10,
    }, staffAuth);
    assert.equal(res.status, 403, 'Cashier/staff cannot create packaging materials');

    res = await post('/api/packaging-profiles', {
      name: 'Manager Profile',
      serving_type: 'parcel',
      packaging_type: 'parcel_box',
    }, manager.authHeader);
    assert.equal(res.status, 403, 'Manager cannot create packaging profiles (owner only)');

    // ════════════════════════════════════════════════════════════════════════════
    // 2. Packaging Material Management (CRUD & Validation)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n2. Verifying Packaging Material CRUD & Validation...');

    // Invalid cost validation
    res = await post('/api/packaging/materials', {
      name: 'Negative Cost Box',
      base_unit: 'each',
      unit_cost: -5,
    });
    assert.equal(res.status, 400, 'Negative purchase cost is rejected');

    // Invalid stock quantity validation
    res = await post('/api/packaging/materials', {
      name: 'Negative Stock Box',
      base_unit: 'each',
      stock_quantity: -10,
    });
    assert.equal(res.status, 400, 'Negative stock quantity is rejected');

    // Create valid packaging materials
    const boxRes = await post('/api/packaging/materials', {
      name: 'Small Pancake Box',
      sku: 'BOX-SM-01',
      category: 'Boxes',
      base_unit: 'each',
      stock_quantity: 100,
      min_threshold: 20,
      unit_cost: 5.5,
    });
    assert.equal(boxRes.status, 201, 'Owner creates Small Pancake Box');
    const boxMaterial = boxRes.data.material;
    assert.equal(boxMaterial.is_packaging, 1, 'Material marked as packaging in supplies');
    assert.equal(boxMaterial.sku, 'BOX-SM-01');

    const tissueRes = await post('/api/packaging/materials', {
      name: 'Tissue Paper',
      sku: 'TISS-01',
      category: 'Paper',
      base_unit: 'each',
      stock_quantity: 200,
      min_threshold: 50,
      unit_cost: 0.25,
    });
    assert.equal(tissueRes.status, 201, 'Owner creates Tissue Paper');
    const tissueMaterial = tissueRes.data.material;

    const forkRes = await post('/api/packaging/materials', {
      name: 'Wooden Fork',
      sku: 'FORK-WD-01',
      category: 'Cutlery',
      base_unit: 'each',
      stock_quantity: 150,
      min_threshold: 30,
      unit_cost: 1.0,
    });
    assert.equal(forkRes.status, 201, 'Owner creates Wooden Fork');
    const forkMaterial = forkRes.data.material;

    const bagRes = await post('/api/packaging/materials', {
      name: 'Carry Bag',
      sku: 'BAG-01',
      category: 'Bags',
      base_unit: 'each',
      stock_quantity: 80,
      min_threshold: 15,
      unit_cost: 2.0,
    });
    assert.equal(bagRes.status, 201, 'Owner creates Carry Bag');
    const bagMaterial = bagRes.data.material;

    // Update material
    res = await put(`/api/packaging/materials/${boxMaterial.id}`, {
      name: 'Pancake Box Standard',
      sku: 'BOX-SM-01-REV',
      min_threshold: 25,
    });
    assert.equal(res.status, 200, 'Packaging material updated');
    assert.equal(res.data.material.name, 'Pancake Box Standard');
    assert.equal(res.data.material.sku, 'BOX-SM-01-REV');

    // Material movements inspection
    res = await get(`/api/packaging/materials/${boxMaterial.id}/movements`);
    assert.equal(res.status, 200, 'Can retrieve material movements');
    assert(Array.isArray(res.data.movements), 'Movements is an array');

    // ════════════════════════════════════════════════════════════════════════════
    // 3. Packaging Profiles (Multi-Material Components & Duplication)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n3. Verifying Packaging Profiles with Multi-Material Components & Duplication...');

    // Default Dine-In Paper Plate profile (for Stage 2 serving fallback)
    const plateMaterialRes = await post('/api/packaging/materials', {
      name: 'Dine-In Plate',
      base_unit: 'each',
      stock_quantity: 100,
      unit_cost: 2.0,
    });
    const plateMaterial = plateMaterialRes.data.material;

    const defaultPlateRes = await post('/api/packaging-profiles', {
      name: 'Standard Dine-In Plate',
      serving_type: 'dine_in',
      packaging_type: 'paper_plate',
      supply_id: plateMaterial.id,
      units_per_serving: 1,
      customer_charge_per_unit: 1.0,
      is_default: true,
      components: [
        { material_id: plateMaterial.id, quantity: 1 },
      ],
    });
    assert.equal(defaultPlateRes.status, 201, 'Default Dine-In Plate profile created');

    // Default Parcel Box profile (Stage 2 fallback)
    const defaultBoxRes = await post('/api/packaging-profiles', {
      name: 'Standard Parcel Box Fallback',
      serving_type: 'parcel',
      packaging_type: 'parcel_box',
      supply_id: boxMaterial.id,
      units_per_serving: 1,
      customer_charge_per_unit: 5.0,
      is_default: true,
      components: [
        { material_id: boxMaterial.id, quantity: 1 },
      ],
    });
    assert.equal(defaultBoxRes.status, 201, 'Default Parcel Box profile created');
    const defaultBoxProfile = defaultBoxRes.data.profile;

    // Create a multi-material profile: "Combo Takeaway Pack"
    // Components: 1 x Box, 2 x Tissues, 1 x Fork
    const multiProfileRes = await post('/api/packaging-profiles', {
      name: 'Combo Takeaway Pack',
      description: 'Standard box with fork and napkins',
      serving_type: 'parcel',
      packaging_type: 'parcel_box',
      customer_charge_per_unit: 8.0,
      is_default: false,
      components: [
        { material_id: boxMaterial.id, quantity: 1 },
        { material_id: tissueMaterial.id, quantity: 2 },
        { material_id: forkMaterial.id, quantity: 1 },
      ],
    });
    assert.equal(multiProfileRes.status, 201, 'Multi-material Combo Takeaway Pack created');
    const comboProfile = multiProfileRes.data.profile;
    assert.equal(comboProfile.components.length, 3, 'Combo profile has 3 material components');

    // Duplicate profile
    const dupRes = await post(`/api/packaging/profiles/${comboProfile.id}/duplicate`, {});
    assert.equal(dupRes.status, 201, 'Combo profile duplicated');
    const duplicatedProfile = dupRes.data.profile;
    assert.equal(duplicatedProfile.name, 'Combo Takeaway Pack (Copy)');
    assert.equal(duplicatedProfile.components.length, 3, 'Duplicated profile copied all 3 components');
    assert.notEqual(duplicatedProfile.id, comboProfile.id, 'Duplicated profile has unique ID');

    // ════════════════════════════════════════════════════════════════════════════
    // 4. Product & Variant Assignment Precedence
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n4. Verifying Product and Variant Assignment Precedence...');

    // Seed test category and products
    seedCategory(db, 'cat-pancakes', 'Pancakes');
    seedProduct(db, 'prod-classic', 'cat-pancakes', 'Classic Pancake', 100, {
      tax_type: 'none', stock_quantity: 0, track_inventory: 0,
    });
    seedProduct(db, 'prod-deluxe', 'cat-pancakes', 'Deluxe Pancake', 150, {
      tax_type: 'none', stock_quantity: 0, track_inventory: 0,
    });

    // Seed product variants for Deluxe Pancake
    db.prepare(`
      INSERT INTO product_variants (id, product_id, name, price, sku, is_active, created_at, updated_at)
      VALUES ('var-regular', 'prod-deluxe', 'Regular Stack', 150, 'DLX-REG', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
             ('var-large', 'prod-deluxe', 'Large Stack', 220, 'DLX-LG', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();

    // Custom profile for Large Stack
    const largeStackProfileRes = await post('/api/packaging-profiles', {
      name: 'Large Stack Box',
      serving_type: 'parcel',
      packaging_type: 'parcel_box',
      customer_charge_per_unit: 12.0,
      is_default: false,
      components: [
        { material_id: boxMaterial.id, quantity: 2 },
        { material_id: tissueMaterial.id, quantity: 4 },
      ],
    });
    const largeStackProfile = largeStackProfileRes.data.profile;

    // Product Assignment: Assign comboProfile to Deluxe Pancake
    res = await post('/api/packaging/assignments/product/prod-deluxe', {
      packaging_profile_id: comboProfile.id,
      no_packaging: false,
    });
    assert.equal(res.status, 200, 'Product packaging assigned');

    // Variant Assignment: Assign largeStackProfile to Large Stack variant
    res = await post('/api/packaging/assignments/variant/var-large', {
      packaging_profile_id: largeStackProfile.id,
      no_packaging: false,
    });
    assert.equal(res.status, 200, 'Variant packaging assigned');

    // Verify GET /api/packaging/assignments returns assigned products and variants
    res = await get('/api/packaging/assignments');
    assert.equal(res.status, 200, 'GET /api/packaging/assignments succeeds');
    assert(Array.isArray(res.data.products), 'Products array returned in assignments');
    const deluxeAssigned = res.data.products.find((p: any) => p.product_id === 'prod-deluxe');
    assert(deluxeAssigned, 'Deluxe product present in assignments');
    assert.equal(deluxeAssigned.packaging_profile_id, comboProfile.id);
    const largeVarAssigned = deluxeAssigned.variants.find((v: any) => v.variant_id === 'var-large');
    assert(largeVarAssigned, 'Large variant present in deluxe assignments');
    assert.equal(largeVarAssigned.packaging_profile_id, largeStackProfile.id);

    // Precedence Level 4: Classic Pancake with no assignment falls back to default parcel box (₹5)
    let orderRes = await post('/api/orders', {
      type: 'takeaway',
      items: [
        {
          product_id: 'prod-classic',
          quantity: 1,
          serving_allocations: [{ serving_type: 'parcel', quantity: 1 }],
        },
      ],
    });
    assert.equal(orderRes.status, 201, 'Order with fallback profile created');
    let pkgDetails = await get(`/api/orders/${orderRes.data.order.id}/packaging`);
    assert.equal(pkgDetails.status, 200);
    assert.equal(pkgDetails.data.allocations[0].packaging_profile_id, defaultBoxProfile.id, 'Level 4: Fallback profile resolved');
    assert.equal(pkgDetails.data.total_packaging_charge, 5.0, 'Level 4: Default box charge ₹5 applied');

    // Precedence Level 3: Deluxe Pancake (Regular Stack variant has no variant profile) resolves to Product Default (Combo Takeaway Pack, ₹8)
    orderRes = await post('/api/orders', {
      type: 'takeaway',
      items: [
        {
          product_id: 'prod-deluxe',
          variant_id: 'var-regular',
          quantity: 1,
          serving_allocations: [{ serving_type: 'parcel', quantity: 1 }],
        },
      ],
    });
    assert.equal(orderRes.status, 201, 'Order with product profile created');
    pkgDetails = await get(`/api/orders/${orderRes.data.order.id}/packaging`);
    assert.equal(pkgDetails.data.allocations[0].packaging_profile_id, comboProfile.id, 'Level 3: Product default profile resolved');
    assert.equal(pkgDetails.data.total_packaging_charge, 8.0, 'Level 3: Product profile charge ₹8 applied');
    // Verify multi-material allocations created for this item: 1 box, 2 tissues, 1 fork
    const comboAllocations = pkgDetails.data.allocations.filter((a: any) => a.order_item_id === orderRes.data.order.items[0].id);
    assert.equal(comboAllocations.length, 3, 'Multi-material profile created 3 snapshot rows');

    // Precedence Level 2: Deluxe Pancake with Large Stack variant resolves to Large Stack Box (₹12)
    orderRes = await post('/api/orders', {
      type: 'takeaway',
      items: [
        {
          product_id: 'prod-deluxe',
          variant_id: 'var-large',
          quantity: 1,
          serving_allocations: [{ serving_type: 'parcel', quantity: 1 }],
        },
      ],
    });
    assert.equal(orderRes.status, 201, 'Order with variant profile created');
    pkgDetails = await get(`/api/orders/${orderRes.data.order.id}/packaging`);
    assert.equal(pkgDetails.data.allocations[0].packaging_profile_id, largeStackProfile.id, 'Level 2: Variant profile resolved');
    assert.equal(pkgDetails.data.total_packaging_charge, 24.0, 'Level 2: Variant profile charge ₹24 applied (2 boxes * ₹12)');

    // Precedence Level 1: Explicit order-item override takes precedence over variant assignment
    orderRes = await post('/api/orders', {
      type: 'takeaway',
      items: [
        {
          product_id: 'prod-deluxe',
          variant_id: 'var-large',
          quantity: 1,
          serving_allocations: [
            { serving_type: 'parcel', quantity: 1, packaging_profile_id: comboProfile.id },
          ],
        },
      ],
    });
    assert.equal(orderRes.status, 201, 'Order with item override created');
    pkgDetails = await get(`/api/orders/${orderRes.data.order.id}/packaging`);
    assert.equal(pkgDetails.data.allocations[0].packaging_profile_id, comboProfile.id, 'Level 1: Explicit item override resolved');
    assert.equal(pkgDetails.data.total_packaging_charge, 8.0, 'Level 1: Explicit override charge ₹8 applied');

    // Precedence: no_packaging suppression ('none')
    orderRes = await post('/api/orders', {
      type: 'takeaway',
      items: [
        {
          product_id: 'prod-deluxe',
          variant_id: 'var-large',
          quantity: 1,
          serving_allocations: [
            { serving_type: 'parcel', quantity: 1, packaging_profile_id: 'none' },
          ],
        },
      ],
    });
    assert.equal(orderRes.status, 201, 'Order with no_packaging created');
    pkgDetails = await get(`/api/orders/${orderRes.data.order.id}/packaging`);
    assert.equal(pkgDetails.data.allocations.length, 0, 'No packaging allocations created');
    assert.equal(pkgDetails.data.total_packaging_charge, 0, 'Packaging charge is 0');

    // ════════════════════════════════════════════════════════════════════════════
    // 5. Immutable Snapshots & Deferred Stock Consumption (checkout_v1)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n5. Verifying Immutable Snapshots & Deferred Consumption...');

    const stockBeforeOrder = {
      box: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMaterial.id).stock_quantity),
      tissue: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(tissueMaterial.id).stock_quantity),
      fork: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(forkMaterial.id).stock_quantity),
    };

    // Create an order with 2 x Deluxe Pancake (Combo profile: 1 box, 2 tissues, 1 fork per unit)
    // Total packaging needed: 2 boxes, 4 tissues, 2 forks
    orderRes = await post('/api/orders', {
      type: 'takeaway',
      items: [
        {
          product_id: 'prod-deluxe',
          variant_id: 'var-regular',
          quantity: 2,
          serving_allocations: [{ serving_type: 'parcel', quantity: 2 }],
        },
      ],
    });
    assert.equal(orderRes.status, 201);
    const checkoutOrder = orderRes.data.order;

    // Verify stock is UNCHANGED immediately after order placement (checkout_v1 deferred consumption)
    const stockAfterOrder = {
      box: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMaterial.id).stock_quantity),
      tissue: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(tissueMaterial.id).stock_quantity),
      fork: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(forkMaterial.id).stock_quantity),
    };
    assert.deepEqual(stockAfterOrder, stockBeforeOrder, 'Stock remains unchanged at order placement');

    // Verify immutable snapshot: mutating the profile afterwards does NOT change the order's allocations
    db.prepare('UPDATE packaging_profiles SET customer_charge_per_unit = 99 WHERE id = ?').run(comboProfile.id);
    const orderPkgCheck = await get(`/api/orders/${checkoutOrder.id}/packaging`);
    assert.equal(orderPkgCheck.data.total_packaging_charge, 16.0, 'Order snapshot charge unchanged despite profile modification');
    // Restore profile charge
    db.prepare('UPDATE packaging_profiles SET customer_charge_per_unit = 8.0 WHERE id = ?').run(comboProfile.id);

    // ════════════════════════════════════════════════════════════════════════════
    // 6. Manual Packaging Adjustments Workflow & Recalculation
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n6. Verifying Manual Packaging Adjustments & Recalculation...');

    // Staff/Manager adds 1 extra Carry Bag for ₹2.0 to the order before settlement
    const adjustRes = await post(`/api/orders/${checkoutOrder.id}/packaging/adjust`, {
      adjustments: [
        {
          supply_id: bagMaterial.id,
          quantity: 1,
          customer_charge: 2.0,
          notes: 'Customer requested carry bag',
        },
      ],
      reason: 'Extra carry bag added by staff',
    });
    assert.equal(adjustRes.status, 200, 'Packaging adjusted successfully');
    assert.equal(adjustRes.data.order.packaging_charge, 18.0, 'Order packaging charge recalculated (16 + 2 = 18)');
    assert.equal(adjustRes.data.order.total, 318.0, 'Order total recalculated (300 subtotal + 18 packaging = 318)');

    // ════════════════════════════════════════════════════════════════════════════
    // 7. Checkout Consumption, Ledger & Idempotency
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n7. Verifying Checkout Consumption, Ledger & Idempotency...');

    // Generate bill and settle order
    const billRes = await post('/api/bills/generate', { order_id: checkoutOrder.id });
    assert.equal(billRes.status, 201, 'Bill generated');
    const bill = billRes.data.bill;
    assert.equal(bill.packaging_charge, 18.0, 'Bill reflects packaging charge');
    assert.equal(bill.total, 318.0, 'Bill total matches order total');

    // Settle bill
    completeExactBalanceSettlement(db, bill.id, 318.0, 'INR');

    // Verify stock is now deducted
    // Expected deductions:
    // Box: 2 units (Combo profile * 2) -> 100 - 2 = 98
    // Tissue: 4 units (Combo profile 2 * 2) -> 200 - 4 = 196
    // Fork: 2 units (Combo profile 1 * 2) -> 150 - 2 = 148
    // Bag: 1 unit (Manual adjustment) -> 80 - 1 = 79
    const stockAfterSettlement = {
      box: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMaterial.id).stock_quantity),
      tissue: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(tissueMaterial.id).stock_quantity),
      fork: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(forkMaterial.id).stock_quantity),
      bag: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(bagMaterial.id).stock_quantity),
    };
    assert.equal(stockAfterSettlement.box, 98, 'Box stock deducted by 2');
    assert.equal(stockAfterSettlement.tissue, 196, 'Tissue stock deducted by 4');
    assert.equal(stockAfterSettlement.fork, 148, 'Fork stock deducted by 2');
    assert.equal(stockAfterSettlement.bag, 79, 'Carry bag stock deducted by 1');

    // Verify ledger records in order_inventory_consumptions and supply_movements
    const consumptions = db.prepare(`
      SELECT * FROM order_inventory_consumptions
      WHERE order_id = ? AND consumption_kind = 'packaging'
    `).all(checkoutOrder.id);
    assert.equal(consumptions.length, 4, '4 packaging consumptions recorded in ledger');

    const movements = db.prepare(`
      SELECT m.supply_id, m.quantity_delta, m.movement_type, m.reference_type, m.reference_id
      FROM supply_movements m
      JOIN order_inventory_consumptions c ON c.supply_movement_id = m.id
      WHERE c.order_id = ? AND c.consumption_kind = 'packaging'
    `).all(checkoutOrder.id);
    assert.equal(movements.length, 4, '4 supply movement records created in ledger');

    // Verify consumption idempotency: running checkout consumption again does NOT deduct stock
    db.transaction(() => consumeCheckoutInventory(db, checkoutOrder.id, owner.userId, `bill:${bill.id}`))();
    const stockAfterRetry = {
      box: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMaterial.id).stock_quantity),
      tissue: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(tissueMaterial.id).stock_quantity),
      fork: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(forkMaterial.id).stock_quantity),
      bag: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(bagMaterial.id).stock_quantity),
    };
    assert.deepEqual(stockAfterRetry, stockAfterSettlement, 'Repeated checkout consumption is strictly idempotent');

    // Verify manual adjustment is rejected on settled order
    const adjustSettledRes = await post(`/api/orders/${checkoutOrder.id}/packaging/adjust`, {
      adjustments: [{ supply_id: bagMaterial.id, quantity: 1 }],
    });
    assert.equal(adjustSettledRes.status, 400, 'Manual adjustment rejected on settled order');

    // ════════════════════════════════════════════════════════════════════════════
    // 8. Pre-settlement Cancellation Invariants
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n8. Verifying Pre-settlement Cancellation Invariants...');

    const stockBeforeCancelOrder = {
      box: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMaterial.id).stock_quantity),
    };
    const cancelOrderRes = await post('/api/orders', {
      type: 'takeaway',
      items: [
        {
          product_id: 'prod-deluxe',
          variant_id: 'var-regular',
          quantity: 2,
          serving_allocations: [{ serving_type: 'parcel', quantity: 2 }],
        },
      ],
    });
    const cancelledOrder = cancelOrderRes.data.order;

    // Cancel order before settlement
    await api(baseUrl, `/api/orders/${cancelledOrder.id}/status`, {
      method: 'PATCH',
      headers: owner.authHeader,
      body: { status: 'cancelled', reason: 'Customer changed mind' },
    });

    // Attempting consumption on cancelled order does not deduct stock
    db.transaction(() => consumeCheckoutInventory(db, cancelledOrder.id, owner.userId, 'cancel-test'))();
    const stockAfterCancelOrder = {
      box: Number(db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMaterial.id).stock_quantity),
    };
    assert.deepEqual(stockAfterCancelOrder, stockBeforeCancelOrder, 'Cancelled order consumes zero stock');

    // ════════════════════════════════════════════════════════════════════════════
    // 9. Dashboard KPIs and Low Stock Alerts
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n9. Verifying Packaging Dashboard KPIs & Alerts...');

    // Set carry bag stock to 5 (threshold is 15) to trigger low stock alert
    db.prepare('UPDATE supplies SET stock_quantity = 5 WHERE id = ?').run(bagMaterial.id);

    const dashRes = await get('/api/packaging/dashboard');
    assert.equal(dashRes.status, 200, 'Dashboard loaded');
    assert(dashRes.data.total_materials >= 4, 'Correct material count');
    assert(dashRes.data.active_profiles >= 2, 'Correct profile count');
    assert(dashRes.data.low_stock_materials >= 1, 'Low stock count detected');
    const lowStockBag = dashRes.data.low_stock_items.find((m: any) => m.id === bagMaterial.id);
    assert(lowStockBag, 'Carry bag included in low stock alert list');
    assert.equal(lowStockBag.stock_quantity, 5);

    console.log('\n✓ All Stage 5 Packaging Configuration & Inventory tests passed successfully!');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase(db);
  }
}

main().catch((err) => {
  console.error('\n✗ Stage 5 test failed:', err);
  process.exit(1);
});
