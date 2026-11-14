/**
 * Stage 6A – Delivery Platform Integration Foundation Tests
 *
 * Covers:
 * 1. Platform Configurations & Live Mode Safety Guard (Swiggy, Zomato, Sandbox).
 * 2. External Menu Mapping Management (CRUD, validations, duplicate prevention, variant support).
 * 3. Sandbox Order Simulation & POS Ingestion (parcel packaging, checkout_v1, KDS notification).
 * 4. Provider-Scoped Idempotency (prevent duplicate ingestion of same external order ID).
 * 5. Unmapped Item Rejection (safe rejection with actionable error message).
 * 6. Order Status Synchronization & Terminal State Transition Validation.
 * 7. Webhook Processing, Idempotency, and Failure Retry Service.
 * 8. Stage 5 Packaging & Checkout Inventory Lifecycle Integration (checkout_v1 settlement).
 * 9. Role & Permission Enforcement.
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-ap-stage6a-'));
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
const { productRoutes } = require('../main/routes/products');
const { orderRoutes } = require('../main/routes/orders');
const { packagingProfileRoutes } = require('../main/routes/packaging-profiles');
const { packagingRoutes } = require('../main/routes/packaging');
const { deliveryRoutes } = require('../main/routes/delivery');
const { getDeliveryAdapter } = require('../main/services/delivery/delivery-service');
const { billRoutes, completeExactBalanceSettlement } = require('../main/routes/bills');
const { consumeCheckoutInventory } = require('../main/services/checkout-inventory');

async function main() {
  console.log('--- Starting Stage 6A Delivery Platform Integration Tests ---');
  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const manager = seedManagerUser(db);

  // Mount express app with delivery, packaging, order, and billing routes
  const app = createApp({
    '/api/delivery': deliveryRoutes,
    '/api/packaging': packagingRoutes,
    '/api/packaging-profiles': packagingProfileRoutes,
    '/api/products': productRoutes,
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
    const cashierToken = jwt.sign(
      { userId: 'cashier-001', email: 'cashier@test.local', role: 'cashier' },
      getJWTSecret(),
      { expiresIn: '1h' },
    );
    const cashierAuth = { Authorization: `Bearer ${cashierToken}` };

    // Cashier cannot update platform configuration (requires settings.manage)
    const forbiddenConfig = await put('/api/delivery/configs/swiggy', { is_enabled: true }, cashierAuth);
    assert.strictEqual(forbiddenConfig.status, 403, 'Cashier must be forbidden from updating configs');

    // Cashier cannot delete menu mappings (requires catalog.manage / settings.manage)
    const forbiddenDelete = await del('/api/delivery/mappings/999', cashierAuth);
    assert.strictEqual(forbiddenDelete.status, 403, 'Cashier must be forbidden from deleting menu mappings');

    // ════════════════════════════════════════════════════════════════════════════
    // 2. Platform Configurations & Live Mode Safety Guard
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n2. Verifying Platform Configurations & Live Mode Safety Guard...');

    const configsRes = await get('/api/delivery/configs');
    assert.strictEqual(configsRes.status, 200);
    const configs = configsRes.data;
    assert.strictEqual(configs.length, 3, 'Should have swiggy, zomato, and sandbox seeded');

    const swiggyConfig = configs.find((c: any) => c.provider === 'swiggy');
    const zomatoConfig = configs.find((c: any) => c.provider === 'zomato');
    const sandboxConfig = configs.find((c: any) => c.provider === 'sandbox');

    assert.ok(swiggyConfig, 'Swiggy config must exist');
    assert.ok(zomatoConfig, 'Zomato config must exist');
    assert.ok(sandboxConfig, 'Sandbox config must exist');
    assert.strictEqual(swiggyConfig.mode, 'disconnected');
    assert.strictEqual(zomatoConfig.mode, 'disconnected');
    assert.strictEqual(sandboxConfig.mode, 'sandbox');

    // Update Swiggy to sandbox mode and enabled
    const updateSwiggy = await put('/api/delivery/configs/swiggy', {
      is_enabled: true,
      mode: 'sandbox',
      auto_accept_orders: true,
      notes: 'Initial sandbox testing',
    });
    assert.strictEqual(updateSwiggy.status, 200);
    assert.strictEqual(updateSwiggy.data.is_enabled, true);
    assert.strictEqual(updateSwiggy.data.mode, 'sandbox');
    assert.strictEqual(updateSwiggy.data.auto_accept_orders, true);

    // CRITICAL SAFETY GUARD TEST:
    // Attempting to activate LIVE mode for Swiggy or Zomato without official partner API approval MUST FAIL with 400
    const liveSwiggyAttempt = await put('/api/delivery/configs/swiggy', { mode: 'live' });
    assert.strictEqual(liveSwiggyAttempt.status, 400, 'Activating live mode without official API support must return 400');
    assert.match(liveSwiggyAttempt.data.error, /official partner API access is pending/i);

    const liveZomatoAttempt = await put('/api/delivery/configs/zomato', { mode: 'live' });
    assert.strictEqual(liveZomatoAttempt.status, 400, 'Activating live mode for Zomato must return 400');
    assert.match(liveZomatoAttempt.data.error, /official partner API access is pending/i);

    // ════════════════════════════════════════════════════════════════════════════
    // 3. External Menu Mappings Management
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n3. Verifying External Menu Mappings Management...');

    // Seed test category and products
    seedCategory(db, 'cat-pancakes', 'Pancakes');
    seedProduct(db, 'prod-pancake-stack', 'cat-pancakes', 'Blueberry Pancake Stack', 180);
    seedProduct(db, 'prod-waffle', 'cat-pancakes', 'Nutella Waffle', 220);
    const productA = { id: 'prod-pancake-stack' };
    const productB = { id: 'prod-waffle' };

    // Seed variant for product B
    db.prepare(`
      INSERT INTO product_variants (id, product_id, name, price, is_active, created_at, updated_at)
      VALUES ('var-nutella-lrg', ?, 'Large Stack (4 pcs)', 260, 1, datetime('now'), datetime('now'))
    `).run(productB.id);

    // Create Swiggy Mapping for product A
    const mapRes1 = await post('/api/delivery/mappings', {
      provider: 'swiggy',
      external_item_id: 'SW-BLUEBERRY-1',
      external_name: 'Swiggy Blueberry Stack',
      internal_product_id: productA.id,
    });
    assert.strictEqual(mapRes1.status, 201);
    assert.strictEqual(mapRes1.data.provider, 'swiggy');
    assert.strictEqual(mapRes1.data.external_item_id, 'SW-BLUEBERRY-1');
    assert.strictEqual(mapRes1.data.sync_status, 'mapped');
    const mappingAId = mapRes1.data.id;

    // Create mapping with variant for product B
    const mapRes2 = await post('/api/delivery/mappings', {
      provider: 'swiggy',
      external_item_id: 'SW-WAFFLE-2',
      external_variant_id: 'SW-VAR-LRG',
      external_name: 'Swiggy Nutella Waffle Large',
      internal_product_id: productB.id,
      internal_variant_id: 'var-nutella-lrg',
    });
    assert.strictEqual(mapRes2.status, 201);
    assert.strictEqual(mapRes2.data.internal_variant_id, 'var-nutella-lrg');

    // Also create Sandbox mappings for simulator testing
    const mapResSb1 = await post('/api/delivery/mappings', {
      provider: 'sandbox',
      external_item_id: 'SB-BLUEBERRY-1',
      external_name: 'Sandbox Blueberry Stack',
      internal_product_id: productA.id,
    });
    assert.strictEqual(mapResSb1.status, 201);

    // Duplicate mapping prevention: attempting same provider + external item id
    const dupMap = await post('/api/delivery/mappings', {
      provider: 'swiggy',
      external_item_id: 'SW-BLUEBERRY-1',
      external_name: 'Another Name',
      internal_product_id: productA.id,
    });
    assert.strictEqual(dupMap.status, 409, 'Duplicate mapping must be rejected with 409');

    // Invalid product ID mapping
    const invalidProdMap = await post('/api/delivery/mappings', {
      provider: 'swiggy',
      external_item_id: 'SW-NONEXISTENT',
      external_name: 'Ghost Item',
      internal_product_id: 'non-existent-product-id',
    });
    assert.strictEqual(invalidProdMap.status, 404, 'Non-existent product must return 404');

    // Query mappings list
    const mappingsAll = await get('/api/delivery/mappings');
    assert.strictEqual(mappingsAll.status, 200);
    assert.ok(mappingsAll.data.length >= 3);

    const swiggyOnly = await get('/api/delivery/mappings?provider=swiggy');
    assert.strictEqual(swiggyOnly.status, 200);
    assert.ok(swiggyOnly.data.every((m: any) => m.provider === 'swiggy'));

    // Update mapping
    const updateMapRes = await put(`/api/delivery/mappings/${mappingAId}`, {
      external_name: 'Swiggy Premium Blueberry Stack',
    });
    assert.strictEqual(updateMapRes.status, 200);
    assert.strictEqual(updateMapRes.data.external_name, 'Swiggy Premium Blueberry Stack');

    // ════════════════════════════════════════════════════════════════════════════
    // 4. Stage 5 Packaging Profile Setup for Delivery
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n4. Setting up Stage 5 Parcel Packaging Profiles...');

    // Create packaging materials
    const matBoxRes = await post('/api/packaging/materials', {
      name: 'Pancake Delivery Box (Kraft)',
      base_unit: 'piece',
      unit_cost: 4.5,
      stock_quantity: 100,
    });
    assert.strictEqual(matBoxRes.status, 201);
    const boxMatId = matBoxRes.data.material?.id || matBoxRes.data.id;

    const matForkRes = await post('/api/packaging/materials', {
      name: 'Birchwood Cutlery Set',
      base_unit: 'piece',
      unit_cost: 1.5,
      stock_quantity: 100,
    });
    assert.strictEqual(matForkRes.status, 201);
    const forkMatId = matForkRes.data.material?.id || matForkRes.data.id;

    // Create parcel packaging profile
    const profileRes = await post('/api/packaging-profiles', {
      name: 'Standard Pancake Parcel Pack',
      serving_type: 'parcel',
      packaging_type: 'parcel_box',
      customer_charge_per_unit: 10.0,
      components: [
        { material_id: boxMatId, quantity: 1 },
        { material_id: forkMatId, quantity: 1 },
      ],
    });
    assert.strictEqual(profileRes.status, 201);
    const profileId = profileRes.data.profile?.id || profileRes.data.id;

    // Assign profile to product A
    const assignRes = await post(`/api/packaging/assignments/product/${productA.id}`, {
      packaging_profile_id: profileId,
      no_packaging: false,
    });
    assert.strictEqual(assignRes.status, 200);

    // ════════════════════════════════════════════════════════════════════════════
    // 5. Sandbox Order Simulation & Ingestion
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n5. Verifying Sandbox Order Simulation & Ingestion...');

    const simulatedPayload = {
      external_order_id: 'SIM-SWIGGY-8899',
      provider: 'sandbox',
      customer_name: 'Anita Roy',
      customer_phone: '+919876543210',
      delivery_address: 'Flat 3B, Sunshine Towers, 100ft Road, Bangalore',
      delivery_note: 'Leave with security guard',
      special_instructions: 'Extra maple syrup on the side please',
      delivery_charge: 35.0,
      discount_amount: 15.0,
      items: [
        {
          external_item_id: 'SB-BLUEBERRY-1',
          external_name: 'Blueberry Pancake Stack',
          quantity: 2,
          unit_price: 180,
          instructions: 'Warm pancakes',
        },
      ],
    };

    const simRes = await post('/api/delivery/sandbox/simulate-order', simulatedPayload);
    assert.strictEqual(simRes.status, 201, 'Simulation must ingest with 201 Created');
    assert.strictEqual(simRes.data.isDuplicate, false);

    const createdOrder = simRes.data.order;
    const tracking = simRes.data.tracking;

    assert.ok(createdOrder.id > 0);
    assert.strictEqual(createdOrder.type, 'online');
    assert.strictEqual(createdOrder.external_order_id, 'SIM-SWIGGY-8899');
    assert.strictEqual(createdOrder.inventory_lifecycle, 'checkout_v1');
    assert.strictEqual(createdOrder.delivery_charge, 35.0);
    assert.strictEqual(createdOrder.discount_amount, 15.0);
    assert.strictEqual(createdOrder.delivery_address, 'Flat 3B, Sunshine Towers, 100ft Road, Bangalore');

    // Stage 5 Packaging Verification: 2 items * ₹10 packaging charge = ₹20
    assert.strictEqual(createdOrder.packaging_charge, 20.0, 'Order must include Stage 5 calculated packaging charge');

    // Expected total = itemsSubtotal (360) + deliveryCharge (35) + packagingCharge (20) - discount (15) = 400.00
    assert.strictEqual(createdOrder.total, 400.0, 'Total must equal items + delivery + packaging - discount');

    // Verify Tracking record
    assert.ok(tracking);
    assert.strictEqual(tracking.provider, 'sandbox');
    assert.strictEqual(tracking.external_order_id, 'SIM-SWIGGY-8899');
    assert.strictEqual(tracking.is_simulated, true);
    assert.strictEqual(tracking.internal_order_id, createdOrder.id);

    // Verify order item in database
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(createdOrder.id);
    assert.strictEqual(orderItems.length, 1);
    assert.strictEqual(orderItems[0].product_id, productA.id);
    assert.strictEqual(orderItems[0].quantity, 2);

    // Verify packaging snapshot allocated via Stage 5
    const pkgAllocations = db.prepare('SELECT * FROM order_item_serving_allocations WHERE order_item_id = ?').all(orderItems[0].id);
    assert.strictEqual(pkgAllocations.length, 1);
    assert.strictEqual(pkgAllocations[0].serving_type, 'parcel');
    assert.strictEqual(pkgAllocations[0].quantity, 2);

    // Verify tracking query endpoint
    const trackingRes = await get(`/api/delivery/orders/${createdOrder.id}/tracking`);
    assert.strictEqual(trackingRes.status, 200);
    assert.strictEqual(trackingRes.data.external_order_id, 'SIM-SWIGGY-8899');

    // ════════════════════════════════════════════════════════════════════════════
    // 5b. Customer Data Removal Verification (No Customer Requirement/DB Registration)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n5b. Verifying Customer Data Removal for Delivery Ingestion...');

    // 1. Simulate order without ANY customer_name or customer_phone
    const noCustomerPayload = {
      external_order_id: 'SIM-NO-CUST-9900',
      provider: 'sandbox',
      delivery_address: 'Flat 101, Sunshine Heights, Bangalore',
      delivery_charge: 30.0,
      items: [
        {
          external_item_id: 'SB-BLUEBERRY-1',
          external_name: 'Blueberry Pancake Stack',
          quantity: 1,
          unit_price: 180,
        },
      ],
    };

    const noCustRes = await post('/api/delivery/sandbox/simulate-order', noCustomerPayload);
    assert.strictEqual(noCustRes.status, 201, 'Delivery order must succeed without any customer details');
    assert.strictEqual(noCustRes.data.order.customer_id, null, 'Delivery order customer_id must be null');
    assert.strictEqual(noCustRes.data.order.external_order_id, 'SIM-NO-CUST-9900');

    // 2. Verify customers table has zero rows created from delivery orders
    const deliveryCustomers = db.prepare('SELECT COUNT(*) AS cnt FROM customers').get();
    assert.strictEqual(deliveryCustomers.cnt, 0, 'No rows should be inserted into customers table for delivery orders');

    // 3. Verify adapters strictly strip/nullify customerName & customerPhone (no fake placeholders)
    const sandboxAdapter = getDeliveryAdapter('sandbox');
    const parsedSandbox = sandboxAdapter.parseIncomingOrder({
      id: 'SB-TEST-ORDER-1',
      customer_name: 'Some Name',
      customer_phone: '9999999999',
      items: [{ id: 'SB-BLUEBERRY-1', quantity: 1 }],
    });
    assert.strictEqual(parsedSandbox.customerName, null, 'Sandbox adapter must not collect customer name');
    assert.strictEqual(parsedSandbox.customerPhone, null, 'Sandbox adapter must not collect customer phone');

    const swiggyAdapter = getDeliveryAdapter('swiggy');
    const parsedSwiggy = swiggyAdapter.parseIncomingOrder({
      order_id: 'SW-TEST-ORDER-1',
      customer: { name: 'Some Swiggy Name', phone: '8888888888' },
      items: [{ item_id: 'SB-BLUEBERRY-1', quantity: 1 }],
    });
    assert.strictEqual(parsedSwiggy.customerName, null, 'Swiggy adapter must not collect customer name');
    assert.strictEqual(parsedSwiggy.customerPhone, null, 'Swiggy adapter must not collect customer phone');

    const zomatoAdapter = getDeliveryAdapter('zomato');
    const parsedZomato = zomatoAdapter.parseIncomingOrder({
      order_id: 'ZM-TEST-ORDER-1',
      customer: { name: 'Some Zomato Name', phone: '7777777777' },
      items: [{ item_id: 'SB-BLUEBERRY-1', quantity: 1 }],
    });
    assert.strictEqual(parsedZomato.customerName, null, 'Zomato adapter must not collect customer name');
    assert.strictEqual(parsedZomato.customerPhone, null, 'Zomato adapter must not collect customer phone');

    // ════════════════════════════════════════════════════════════════════════════
    // 6. Provider-Scoped Idempotency
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n6. Verifying Provider-Scoped Idempotency...');

    // Attempting to ingest the EXACT same order again
    const dupeOrderRes = await post('/api/delivery/sandbox/simulate-order', simulatedPayload);
    assert.strictEqual(dupeOrderRes.status, 201);
    assert.strictEqual(dupeOrderRes.data.isDuplicate, true, 'Duplicate ingestion must report isDuplicate: true');
    assert.strictEqual(dupeOrderRes.data.order.id, createdOrder.id, 'Must return existing order ID');

    // Verify orders count did NOT increase
    const countCheck = db.prepare('SELECT COUNT(*) AS cnt FROM orders WHERE external_order_id = ?').get('SIM-SWIGGY-8899');
    assert.strictEqual(countCheck.cnt, 1, 'Orders table must contain exactly 1 order for this external order ID');

    // ════════════════════════════════════════════════════════════════════════════
    // 7. Unmapped Item Rejection
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n7. Verifying Unmapped Item Rejection...');

    const unmappedPayload = {
      external_order_id: 'SIM-UNKNOWN-999',
      provider: 'sandbox',
      items: [
        {
          external_item_id: 'SB-UNMAPPED-ITEM-99',
          external_name: 'Unknown Dish',
          quantity: 1,
        },
      ],
    };

    const unmappedRes = await post('/api/delivery/sandbox/simulate-order', unmappedPayload);
    assert.strictEqual(unmappedRes.status, 400, 'Unmapped items must be rejected with HTTP 400');
    assert.match(unmappedRes.data.error, /Unmapped delivery item/i, 'Error must indicate mapping is required');

    // ════════════════════════════════════════════════════════════════════════════
    // 8. Order Status Synchronization & Terminal State Invariants
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n8. Verifying Order Status Synchronization & Transition Invariants...');

    // Update status to 'preparing'
    const statusPrep = await post(`/api/delivery/orders/${createdOrder.id}/status`, {
      status: 'preparing',
    });
    assert.strictEqual(statusPrep.status, 200);
    assert.strictEqual(statusPrep.data.order.status, 'preparing');
    assert.strictEqual(statusPrep.data.tracking.internal_status, 'preparing');

    // Update status to 'ready'
    const statusReady = await post(`/api/delivery/orders/${createdOrder.id}/status`, {
      status: 'ready',
    });
    assert.strictEqual(statusReady.status, 200);
    assert.strictEqual(statusReady.data.order.status, 'ready');

    // Update status to 'completed'
    const statusComp = await post(`/api/delivery/orders/${createdOrder.id}/status`, {
      status: 'completed',
    });
    assert.strictEqual(statusComp.status, 200);
    assert.strictEqual(statusComp.data.order.status, 'completed');

    // Transition from terminal 'completed' state MUST FAIL
    const illegalTransition = await post(`/api/delivery/orders/${createdOrder.id}/status`, {
      status: 'preparing',
    });
    assert.strictEqual(illegalTransition.status, 400, 'Transition from completed state must fail with 400');
    assert.match(illegalTransition.data.error, /Cannot transition delivery order from terminal status/i);

    // ════════════════════════════════════════════════════════════════════════════
    // 9. Webhook Processing, Idempotency, and Failure Retry
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n9. Verifying Webhook Processing, Idempotency, and Failure Retry...');

    const webhookPayload = {
      event_id: 'evt-wh-1001',
      event_type: 'order.created',
      order: {
        external_order_id: 'SB-WH-ORDER-55',
        customer_name: 'Pooja Sharma',
        customer_phone: '9988776655',
        delivery_address: '42 MG Road, Bangalore',
        items: [
          {
            external_item_id: 'SB-BLUEBERRY-1',
            external_name: 'Blueberry Pancake Stack',
            quantity: 1,
            unit_price: 180,
          },
        ],
      },
    };

    // Post to webhook receiver
    const whRes1 = await post('/api/delivery/webhooks/sandbox', webhookPayload);
    assert.strictEqual(whRes1.status, 200);
    assert.strictEqual(whRes1.data.status, 'processed');
    assert.ok(whRes1.data.orderId > 0);

    // Duplicate webhook: send same event again
    const whResDupe = await post('/api/delivery/webhooks/sandbox', webhookPayload);
    assert.strictEqual(whResDupe.status, 200);
    assert.strictEqual(whResDupe.data.status, 'processed');
    assert.match(whResDupe.data.message, /Duplicate webhook event skipped via idempotency/i);

    // Webhook with unmapped item (should record as failed in events table)
    const badWebhookPayload = {
      event_id: 'evt-wh-fail-1002',
      event_type: 'order.created',
      order: {
        external_order_id: 'SB-WH-ORDER-FAIL-99',
        items: [
          {
            external_item_id: 'SB-UNMAPPED-RETRY-ITEM',
            external_name: 'Retry Candidate Item',
            quantity: 1,
          },
        ],
      },
    };

    const whFailRes = await post('/api/delivery/webhooks/sandbox', badWebhookPayload);
    assert.strictEqual(whFailRes.status, 400);

    // Verify failed event is in the audit log
    const eventLogs = await get('/api/delivery/webhooks/events?status=failed');
    assert.strictEqual(eventLogs.status, 200);
    const failedEvt = eventLogs.data.find((e: any) => e.event_id === 'evt-wh-fail-1002');
    assert.ok(failedEvt, 'Failed webhook event must be logged');
    assert.strictEqual(failedEvt.status, 'failed');
    assert.match(failedEvt.last_error, /Unmapped delivery item/i);

    // Fix the mapping for the failed item
    await post('/api/delivery/mappings', {
      provider: 'sandbox',
      external_item_id: 'SB-UNMAPPED-RETRY-ITEM',
      external_name: 'Retry Candidate Item',
      internal_product_id: productA.id,
    });

    // Now call retry endpoint
    const retryRes = await post(`/api/delivery/webhooks/events/${failedEvt.id}/retry`, {});
    assert.strictEqual(retryRes.status, 200);
    assert.strictEqual(retryRes.data.success, true);
    assert.strictEqual(retryRes.data.event.status, 'processed');
    assert.ok(retryRes.data.event.internal_order_id > 0);

    // ════════════════════════════════════════════════════════════════════════════
    // 10. Stage 5 Packaging & Checkout Inventory Consumption Integration
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n10. Verifying Stage 5 Packaging & Checkout Inventory Consumption Integration...');

    // Create a new delivery order to test complete inventory checkout consumption
    const checkoutSimPayload = {
      external_order_id: 'SIM-INV-TEST-77',
      provider: 'sandbox',
      customer_name: 'Rahul Sen',
      customer_phone: '9876500000',
      delivery_address: 'Indiranagar 12th Main',
      items: [
        {
          external_item_id: 'SB-BLUEBERRY-1',
          external_name: 'Blueberry Pancake Stack',
          quantity: 3, // Requires 3 boxes and 3 forks
          unit_price: 180,
        },
      ],
    };

    const checkoutOrderRes = await post('/api/delivery/sandbox/simulate-order', checkoutSimPayload);
    assert.strictEqual(checkoutOrderRes.status, 201);
    const invOrderId = checkoutOrderRes.data.order.id;

    // Check material stock before checkout
    const boxBefore = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMatId);
    const forkBefore = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(forkMatId);
    assert.strictEqual(Number(boxBefore.stock_quantity), 100);
    assert.strictEqual(Number(forkBefore.stock_quantity), 100);

    // Consume checkout inventory
    consumeCheckoutInventory(db, invOrderId, owner.userId, 'DLV-CHECKOUT-TEST-1');

    // Check material stock after checkout
    const boxAfter = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMatId);
    const forkAfter = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(forkMatId);
    assert.strictEqual(Number(boxAfter.stock_quantity), 97, 'Box stock should be deducted by 3');
    assert.strictEqual(Number(forkAfter.stock_quantity), 97, 'Fork stock should be deducted by 3');

    // Check inventory ledger records in order_inventory_consumptions
    const pkgConsumptions = db.prepare(`
      SELECT * FROM order_inventory_consumptions
      WHERE order_id = ? AND consumption_kind = 'packaging'
    `).all(invOrderId);
    assert.strictEqual(pkgConsumptions.length, 2, 'Should record 2 packaging consumptions (box and fork)');

    // Verify Idempotency: Running consumeCheckoutInventory again must not deduct stock again
    consumeCheckoutInventory(db, invOrderId, owner.userId, 'DLV-CHECKOUT-TEST-1');

    const boxAfterDupe = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(boxMatId);
    const forkAfterDupe = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get(forkMatId);
    assert.strictEqual(Number(boxAfterDupe.stock_quantity), 97, 'Stock must remain unchanged on duplicate consumption');
    assert.strictEqual(Number(forkAfterDupe.stock_quantity), 97, 'Fork stock must remain unchanged on duplicate consumption');

    const pkgConsumptionsAfterDupe = db.prepare(`
      SELECT * FROM order_inventory_consumptions
      WHERE order_id = ? AND consumption_kind = 'packaging'
    `).all(invOrderId);
    assert.strictEqual(pkgConsumptionsAfterDupe.length, 2, 'No duplicate ledger records on second consumption run');

    console.log('\n--- All Stage 6A Delivery Integration Tests Passed Successfully! ---');
  } finally {
    server.close();
    closeDatabase();
  }
}

main().catch((err) => {
  console.error('\nTest failed with error:', err);
  process.exit(1);
});
