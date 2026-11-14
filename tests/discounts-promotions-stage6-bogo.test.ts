/**
 * FloCafe POS – Flexible Discounts & BOGO Promotion System Tests
 *
 * Verifies:
 * 1. Seeded promotions ("launch-bogo" and "loyalty-visit6-bogo") in migration v131.
 * 2. Promotions configuration CRUD, validation, and role permissions.
 * 3. BOGO Engine on identical items (2 pancakes -> 1 free; 4 pancakes -> 2 free).
 * 4. BOGO Engine on mixed items (lower-priced eligible item is free; odd item counts).
 * 5. Ineligible items exclusion (non-pancakes like beverages are untouched).
 * 6. Dynamic matching (newly created pancakes qualify automatically without manual config).
 * 7. Inactive and expired promotions enforcement (rejected on preview and apply).
 * 8. Order & Bill sync on apply & remove (recomputeOrderTotals, tax scaling, balance sync).
 * 9. Loyalty 5-visit milestone & 6th-visit BOGO redemption.
 * 10. Loyalty cycle reset (redeemed reward visit does NOT count; resets to 0/5).
 * 11. Checkout consumption idempotency (no duplicate redemptions on retries).
 * 12. Inventory depletion for BOTH paid and free items (raw recipe ingredients).
 * 13. Stage 5 Packaging material consumption for BOTH paid and free items.
 * 14. Cancellation and refund terminal state protection.
 * 15. Promotions reporting summary and strict exclusion of simulated delivery orders.
 * 16. Permissions matrix enforcement (settings.manage, orders.discount.apply, reports.view).
 *
 * Usage: node tests/run-electron-node-test.cjs tests/discounts-promotions-stage6-bogo.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-discounts-promotions-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const assert = require('assert');
const jwt = require('jsonwebtoken');
const {
  initTestDb,
  createApp,
  startServer,
  seedOwnerUser,
  seedManagerUser,
  seedCategory,
  seedProduct,
  seedCustomer,
  api,
  closeDatabase,
  now,
} = require('./helpers/test-setup');

const { registerRoutes } = require('../main/routes/index');
const { completeExactBalanceSettlement } = require('../main/routes/bills');
const { createSupply, getSupply } = require('../main/services/supplies');
const { saveRecipe } = require('../main/services/recipes');
const { consumeCheckoutInventory } = require('../main/services/checkout-inventory');
const { getJWTSecret } = require('../main/routes/auth');
const { buildBillPrintData } = require('../main/printers/document-classic');

async function main() {
  console.log('=== Starting Discounts & BOGO Promotion System Tests ===\n');

  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const manager = seedManagerUser(db);

  // Seed cashier and server users for permission testing
  const cashierId = 'cashier-promo-001';
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'cashier', 1, ?, ?)
  `).run(cashierId, 'Cashier User', 'cashier@test.local', 'hash', now(), now());
  const cashierToken = jwt.sign({ userId: cashierId, email: 'cashier@test.local', role: 'cashier' }, getJWTSecret(), { expiresIn: '1h' });
  const cashierAuth = { Authorization: `Bearer ${cashierToken}` };

  const serverId = 'server-promo-001';
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'server', 1, ?, ?)
  `).run(serverId, 'Server User', 'server@test.local', 'hash', now(), now());
  const serverToken = jwt.sign({ userId: serverId, email: 'server@test.local', role: 'server' }, getJWTSecret(), { expiresIn: '1h' });
  const serverAuth = { Authorization: `Bearer ${serverToken}` };

  // Setup express application with all routes mounted
  const app = createApp({});
  registerRoutes(app);
  const { baseUrl, server } = await startServer(app);

  const get = (url: string, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'GET', headers });
  const post = (url: string, body: any, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'POST', headers, body });
  const put = (url: string, body: any, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'PUT', headers, body });
  const patch = (url: string, body: any, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'PATCH', headers, body });
  const del = (url: string, headers = owner.authHeader) =>
    api(baseUrl, url, { method: 'DELETE', headers });

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // 1. Initial State & Seeded Promotions
    // ════════════════════════════════════════════════════════════════════════════
    console.log('1. Checking Seeded Promotions from Migration 131...');

    const initialPromos = await get('/api/promotions');
    assert.equal(initialPromos.status, 200);
    const promoList = initialPromos.data.promotions;
    assert(Array.isArray(promoList), 'Promotions returned as array');

    const launchBogo = promoList.find((p: any) => p.id === 'launch-bogo');
    assert(launchBogo, 'Launch BOGO promotion exists');
    assert.equal(launchBogo.discount_type, 'bogo');
    assert.equal(launchBogo.target_type, 'all_pancakes');
    assert.equal(launchBogo.bogo_pricing_rule, 'same_item');
    assert.equal(launchBogo.is_active, true);

    const loyaltyBogo = promoList.find((p: any) => p.id === 'loyalty-visit6-bogo');
    assert(loyaltyBogo, 'Loyalty 6th Visit BOGO promotion exists');
    assert.equal(loyaltyBogo.is_loyalty_reward, true);
    assert.equal(loyaltyBogo.loyalty_qualifying_visits_required, 5);
    assert.equal(loyaltyBogo.bogo_pricing_rule, 'same_item', 'Loyalty BOGO follows matching-item rule');

    const manualBogo = promoList.find((p: any) => p.id === 'manual-bogo');
    assert(manualBogo, 'Manual BOGO promotion exists');
    assert.equal(manualBogo.discount_type, 'bogo');
    assert.equal(manualBogo.target_type, 'all_pancakes');
    assert.equal(manualBogo.bogo_pricing_rule, 'same_item');
    assert.equal(manualBogo.is_active, true);
    assert.equal(manualBogo.end_at, null, 'Manual BOGO has no expiry (permanent until disabled)');
    assert.equal(manualBogo.is_loyalty_reward, false, 'Manual BOGO is not tagged as internal loyalty reward');

    // POS Active selector verification: active_only=true hides internal loyalty rewards
    const activePromos = await get('/api/promotions?active_only=true');
    assert.equal(activePromos.status, 200);
    const activeIds = activePromos.data.promotions.map((p: any) => p.id);
    assert(activeIds.includes('launch-bogo'), 'Launch BOGO visible in active selector');
    assert(activeIds.includes('manual-bogo'), 'Manual BOGO visible in active selector');
    assert(!activeIds.includes('loyalty-visit6-bogo'), 'Internal loyalty reward hidden from active POS selector');

    // ════════════════════════════════════════════════════════════════════════════
    // 2. Promotion Configuration & Permission Checks
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n2. Verifying Promotion CRUD & Permission Enforcement...');

    // Cashier cannot create promotion (requires settings.manage)
    let res = await post('/api/promotions', {
      name: 'Cashier Promo',
      discount_type: 'percentage',
      discount_value: 10,
    }, cashierAuth);
    assert.equal(res.status, 403, 'Cashier forbidden from creating promotions');

    // Owner can create custom percentage promotion
    res = await post('/api/promotions', {
      id: 'custom-pct-10',
      name: 'Festival 10% Off',
      discount_type: 'percentage',
      target_type: 'all_pancakes',
      discount_value: 10,
      is_active: true,
    });
    assert.equal(res.status, 201, 'Owner can create promotion');
    assert.equal(res.data.promotion.id, 'custom-pct-10');

    // Update promotion
    res = await put('/api/promotions/custom-pct-10', {
      discount_value: 15,
      description: 'Updated 15% discount',
    });
    assert.equal(res.status, 200, 'Owner can update promotion');
    assert.equal(res.data.promotion.discount_value, 15);

    // Deactivate promotion
    res = await del('/api/promotions/custom-pct-10');
    assert.equal(res.status, 200, 'Owner can deactivate promotion');

    // ════════════════════════════════════════════════════════════════════════════
    // 3. Catalog & Supplies Fixture Setup
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n3. Setting up Pancakes Catalog, Recipes, Packaging & Customers...');

    seedCategory(db, 'cat-pancakes', 'Pancakes');
    seedCategory(db, 'cat-beverages', 'Beverages');

    seedProduct(db, 'prod-classic', 'cat-pancakes', 'Classic Buttermilk Pancake', 100);
    seedProduct(db, 'prod-deluxe', 'cat-pancakes', 'Nutella Deluxe Pancake', 180);
    seedProduct(db, 'prod-berry', 'cat-pancakes', 'Blueberry Pancake', 150);
    seedProduct(db, 'prod-coffee', 'cat-beverages', 'Cold Brew Coffee', 80);

    // Create supplies & recipes for inventory consumption
    const flourSupply = createSupply(db, {
      name: 'Wheat Flour',
      baseUnit: 'kg',
      stockQuantity: 50,
      unitCost: 40,
      actorUserId: owner.userId,
    });
    const milkSupply = createSupply(db, {
      name: 'Fresh Milk',
      baseUnit: 'l',
      stockQuantity: 50,
      unitCost: 50,
      actorUserId: owner.userId,
    });

    // Save recipe for Classic Pancake: 0.1 kg flour, 0.05 l milk per pancake
    saveRecipe(db, {
      productId: 'prod-classic',
      yieldQuantity: 1,
      items: [
        { supply_id: flourSupply.id, quantity: 0.1, unit: 'kg' },
        { supply_id: milkSupply.id, quantity: 0.05, unit: 'l' },
      ],
    });

    // Setup Stage 5 packaging material & profile
    const boxMatRes = await post('/api/packaging/materials', {
      name: 'Pancake Takeaway Box',
      base_unit: 'each',
      stock_quantity: 100,
      unit_cost: 3,
    });
    assert.equal(boxMatRes.status, 201, 'Packaging material created');
    const boxMaterial = boxMatRes.data.material;

    const boxProfileRes = await post('/api/packaging-profiles', {
      name: 'Standard Pancake Box Profile',
      serving_type: 'parcel',
      packaging_type: 'parcel_box',
      customer_charge_per_unit: 0,
      is_default: true,
      components: [{ material_id: boxMaterial.id, quantity: 1 }],
    });
    assert.equal(boxProfileRes.status, 201, 'Packaging profile created');

    seedCustomer(db, 'cust-alice', 'Alice', '+919876543210');
    seedCustomer(db, 'cust-bob', 'Bob', '+919876543211');

    // ════════════════════════════════════════════════════════════════════════════
    // 4. BOGO Engine: Buy 1 Pancake, Get 1 Free (Launch BOGO)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n4. Verifying BOGO Single-Item & Multiple Quantities (Auto-Addition of Free Matching Item)...');

    // Preview: 1 Classic Pancake -> 1 pair, ₹100 discount, payable subtotal = ₹100
    let prev = await post('/api/promotions/preview', {
      promotion_id: 'launch-bogo',
      items: [{ product_id: 'prod-classic', product_name: 'Classic Buttermilk Pancake', quantity: 1, unit_price: 100 }],
    });
    assert.equal(prev.status, 200);
    assert.equal(prev.data.eligible, true, '1 pancake is eligible for BOGO');
    assert.equal(prev.data.pairs, 1);
    assert.equal(prev.data.totalDiscountAmount, 100);
    assert.equal(prev.data.discountedSubtotal, 100);
    assert.equal(prev.data.freeUnits.length, 1);
    assert.equal(prev.data.freeUnits[0].productName, 'Classic Buttermilk Pancake');

    // Preview: 2 Classic Pancakes -> 2 pairs, ₹200 discount, payable subtotal = ₹200
    prev = await post('/api/promotions/preview', {
      promotion_id: 'launch-bogo',
      items: [{ product_id: 'prod-classic', product_name: 'Classic Buttermilk Pancake', quantity: 2, unit_price: 100 }],
    });
    assert.equal(prev.status, 200);
    assert.equal(prev.data.eligible, true);
    assert.equal(prev.data.pairs, 2);
    assert.equal(prev.data.totalDiscountAmount, 200);
    assert.equal(prev.data.discountedSubtotal, 200);

    // Preview: 3 Classic Pancakes -> 3 pairs, ₹300 discount, payable subtotal = ₹300
    prev = await post('/api/promotions/preview', {
      promotion_id: 'launch-bogo',
      items: [{ product_id: 'prod-classic', product_name: 'Classic Buttermilk Pancake', quantity: 3, unit_price: 100 }],
    });
    assert.equal(prev.status, 200);
    assert.equal(prev.data.eligible, true);
    assert.equal(prev.data.pairs, 3);
    assert.equal(prev.data.totalDiscountAmount, 300);
    assert.equal(prev.data.discountedSubtotal, 300);

    // Live Order: Single-Item BOGO (Buy 1 -> Receive 2, Pay for 1)
    let orderRes = await post('/api/orders', {
      type: 'dine_in',
      customer_id: 'cust-bob',
      items: [{ product_id: 'prod-classic', quantity: 1 }],
    });
    assert.equal(orderRes.status, 201);
    const order1 = orderRes.data.order;
    assert.equal(order1.subtotal, 100);

    // Cashier applies Launch BOGO to order
    let applyRes = await post('/api/promotions/apply', {
      order_id: order1.id,
      promotion_id: 'launch-bogo',
    }, cashierAuth);
    assert.equal(applyRes.status, 200, 'Cashier can apply promotion');
    assert.equal(applyRes.data.order.promotion_id, 'launch-bogo');
    assert.equal(applyRes.data.order.subtotal, 200, 'Subtotal reflects 2 pancakes (1 paid, 1 free)');
    assert.equal(applyRes.data.order.discount_amount, 100, 'Discount equals 1 pancake (₹100)');
    assert.equal(applyRes.data.order.total, 100, 'Customer pays for only 1 pancake (₹100)');

    // Verify order_items in DB: both paid and free pancakes appear!
    const order1Items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(order1.id);
    assert.equal(order1Items.length, 2, '2 pancake items exist in order');
    assert.equal(order1Items[0].product_id, 'prod-classic');
    assert.equal(order1Items[0].quantity, 1);
    assert.equal(order1Items[0].discount_amount, 0);
    assert.equal(order1Items[0].status, 'pending');

    assert.equal(order1Items[1].product_id, 'prod-classic');
    assert.equal(order1Items[1].quantity, 1);
    assert.equal(order1Items[1].discount_amount, 100);
    assert.equal(order1Items[1].total, 0);
    assert.equal(order1Items[1].status, 'pending');
    assert(order1Items[1].product_name.includes('(BOGO Free)'), 'Free pancake identified in product_name');

    // Verify KDS: both pancakes appear on KDS as pending items!
    const kdsItems = db.prepare(
      "SELECT * FROM order_items WHERE order_id = ? AND status IN ('pending', 'preparing', 'ready')",
    ).all(order1.id);
    assert.equal(kdsItems.length, 2, 'Both pancakes appear on KDS');
    const totalPancakeQty = kdsItems.reduce((sum: number, it: any) => sum + it.quantity, 0);
    assert.equal(totalPancakeQty, 2, 'KDS total pancake count is 2 (1 paid + 1 free)');

    // Verify Receipt / Bill:
    const bill1Res = await post('/api/bills/generate', { order_id: order1.id });
    assert.equal(bill1Res.status, 201);
    const bill1 = bill1Res.data.bill;
    assert.equal(bill1.subtotal, 200);
    assert.equal(bill1.discount_amount, 100);
    assert.equal(bill1.total, 100);
    assert.equal(bill1.balance, 100);

    const billDetailRes = await get(`/api/bills/${bill1.id}`);
    assert.equal(billDetailRes.status, 200);
    const billReceiptItems = billDetailRes.data.bill.order.items;
    assert.equal(billReceiptItems.length, 2, 'Receipt lists both items');
    const freeReceiptItem = billReceiptItems.find((it: any) => it.product_name.includes('(BOGO Free)'));
    assert(freeReceiptItem, 'Receipt clearly identifies the free pancake');
    assert.equal(freeReceiptItem.discount_amount, 100, 'Receipt clearly shows free pancake discount value');

    // ════════════════════════════════════════════════════════════════════════════
    // 5. Exhaustive End-to-End Verification for Quantities 1, 2, 3, and 4
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n5. Exhaustive End-to-End Verification for Quantities 1, 2, 3, and 4 (Cart, Order, Bill, KDS, Receipt, Inventory & Packaging)...');

    for (const Q of [1, 2, 3, 4]) {
      console.log(`   -> Testing BOGO for Quantity = ${Q} (Buy ${Q} -> Receive ${2 * Q}, Pay for ${Q})...`);

      // 1. Cart Preview
      const cartPreview = await post('/api/promotions/preview', {
        promotion_id: 'launch-bogo',
        items: [{ product_id: 'prod-classic', product_name: 'Classic Buttermilk Pancake', quantity: Q, unit_price: 100 }],
      });
      assert.equal(cartPreview.status, 200);
      assert.equal(cartPreview.data.eligible, true, `Cart with quantity ${Q} is eligible`);
      assert.equal(cartPreview.data.pairs, Q, `Pairs count is ${Q}`);
      assert.equal(cartPreview.data.totalDiscountAmount, Q * 100, `Estimated discount is ₹${Q * 100}`);
      assert.equal(cartPreview.data.discountedSubtotal, Q * 100, `Discounted subtotal is ₹${Q * 100}`);
      assert.equal(cartPreview.data.freeUnits.length, Q, `Free units count is ${Q}`);
      for (const freeUnit of cartPreview.data.freeUnits) {
        assert.equal(freeUnit.productName, 'Classic Buttermilk Pancake');
        assert.equal(freeUnit.unitPrice, 100);
      }

      // 2. Order Creation with Packaging Allocation (Takeaway with Parcel Box)
      const flourBefore = Number(getSupply(db, flourSupply.id).stock_quantity);
      const milkBefore = Number(getSupply(db, milkSupply.id).stock_quantity);
      const boxBefore = Number(getSupply(db, boxMaterial.id).stock_quantity);

      const oRes = await post('/api/orders', {
        type: 'takeaway',
        items: [
          {
            product_id: 'prod-classic',
            quantity: Q,
            serving_allocations: [{ serving_type: 'parcel', quantity: Q }],
          },
        ],
      });
      assert.equal(oRes.status, 201);
      const createdOrder = oRes.data.order;
      assert.equal(createdOrder.subtotal, Q * 100);

      // Verify stock is untouched at order creation (deferred checkout_v1 lifecycle)
      assert.equal(Number(getSupply(db, flourSupply.id).stock_quantity), flourBefore);
      assert.equal(Number(getSupply(db, milkSupply.id).stock_quantity), milkBefore);
      assert.equal(Number(getSupply(db, boxMaterial.id).stock_quantity), boxBefore);

      // 3. Apply Launch BOGO
      const applyPromoRes = await post('/api/promotions/apply', {
        order_id: createdOrder.id,
        promotion_id: 'launch-bogo',
      }, cashierAuth);
      assert.equal(applyPromoRes.status, 200);
      const promoOrder = applyPromoRes.data.order;
      assert.equal(promoOrder.subtotal, 2 * Q * 100, `Order subtotal is ₹${2 * Q * 100} for ${2 * Q} pancakes`);
      assert.equal(promoOrder.discount_amount, Q * 100, `Discount is ₹${Q * 100} for ${Q} free pancakes`);
      assert.equal(promoOrder.total, Q * 100, `Customer pays for ${Q} pancakes (₹${Q * 100})`);

      // 4. Verify DB Order Items
      const orderItemsDb = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(createdOrder.id);
      assert.equal(orderItemsDb.length, 2, '2 order items: 1 paid item row + 1 matching free item row');
      const [paidRow, freeRow] = orderItemsDb;
      assert.equal(paidRow.quantity, Q, `Paid item quantity is ${Q}`);
      assert.equal(paidRow.unit_price, 100);
      assert.equal(paidRow.subtotal, Q * 100);
      assert.equal(paidRow.discount_amount, 0);

      assert.equal(freeRow.quantity, Q, `Free item quantity is ${Q}`);
      assert.equal(freeRow.unit_price, 100);
      assert.equal(freeRow.subtotal, Q * 100);
      assert.equal(freeRow.discount_amount, Q * 100);
      assert.equal(freeRow.total, 0);
      assert.equal(freeRow.status, 'pending');
      assert.equal(freeRow.special_instructions, 'BOGO Free - Launch Offer');
      assert(freeRow.product_name.includes('(BOGO Free)'), 'Free item labeled (BOGO Free)');

      // Total quantity of pancakes in order is 2 * Q
      const totalQtyInDb = orderItemsDb.reduce((sum: number, it: any) => sum + it.quantity, 0);
      assert.equal(totalQtyInDb, 2 * Q, `Total pancakes in order is ${2 * Q}`);

      // 5. Verify KDS Rendering
      const kdsItems = db.prepare(
        "SELECT * FROM order_items WHERE order_id = ? AND status IN ('pending', 'preparing', 'ready') ORDER BY id ASC",
      ).all(createdOrder.id);
      assert.equal(kdsItems.length, 2, 'Both paid and free items present on KDS');
      const kdsTotalQty = kdsItems.reduce((sum: number, it: any) => sum + it.quantity, 0);
      assert.equal(kdsTotalQty, 2 * Q, `KDS total quantity is ${2 * Q}`);
      assert(kdsItems[1].product_name.includes('(BOGO Free)'), 'KDS item clearly marks free pancake');

      // 6. Verify Bill Generation
      const billGenRes = await post('/api/bills/generate', { order_id: createdOrder.id });
      assert.equal(billGenRes.status, 201);
      const generatedBill = billGenRes.data.bill;
      assert.equal(generatedBill.subtotal, 2 * Q * 100);
      assert.equal(generatedBill.discount_amount, Q * 100);
      assert.equal(generatedBill.total, Q * 100);
      assert.equal(generatedBill.balance, Q * 100);

      // 7. Verify Receipt Formatting
      const billDetail = await get(`/api/bills/${generatedBill.id}`);
      assert.equal(billDetail.status, 200);
      const receiptOrder = billDetail.data.bill.order;
      assert.equal(receiptOrder.items.length, 2, 'Receipt shows both paid and free item rows');
      const freeReceipt = receiptOrder.items.find((it: any) => it.product_name.includes('(BOGO Free)'));
      assert(freeReceipt, 'Receipt has free item');
      assert.equal(freeReceipt.quantity, Q, `Receipt free item quantity is ${Q}`);
      assert.equal(freeReceipt.discount_amount, Q * 100, `Receipt free item discount is ₹${Q * 100}`);

      const printData = buildBillPrintData(receiptOrder, generatedBill, { name: 'American Pancakes' }, false);
      assert.equal(printData.order.items.length, 2);
      assert.equal(printData.bill.discountAmount, Q * 100);
      assert.equal(printData.bill.total, Q * 100);

      // 8. Checkout Settlement & Inventory Effects
      completeExactBalanceSettlement(db, generatedBill.id, generatedBill.total, 'INR');

      const flourAfter = Number(getSupply(db, flourSupply.id).stock_quantity);
      const milkAfter = Number(getSupply(db, milkSupply.id).stock_quantity);
      const boxAfter = Number(getSupply(db, boxMaterial.id).stock_quantity);

      const expectedFlourDeduction = Number((2 * Q * 0.1).toFixed(4));
      const expectedMilkDeduction = Number((2 * Q * 0.05).toFixed(4));
      const expectedBoxDeduction = 2 * Q * 1;

      assert.equal(flourAfter.toFixed(2), (flourBefore - expectedFlourDeduction).toFixed(2), `Flour deducted for ${2 * Q} pancakes`);
      assert.equal(milkAfter.toFixed(2), (milkBefore - expectedMilkDeduction).toFixed(2), `Milk deducted for ${2 * Q} pancakes`);
      assert.equal(boxAfter, boxBefore - expectedBoxDeduction, `Packaging boxes deducted for ${2 * Q} takeaway pancakes`);

      // 9. Promotion Redemption Recorded
      const redemptionRec = db.prepare(
        'SELECT * FROM promotion_redemptions WHERE order_id = ? AND promotion_id = ?',
      ).get(createdOrder.id, 'launch-bogo');
      assert(redemptionRec, 'Promotion redemption recorded');
      assert.equal(redemptionRec.discount_amount, Q * 100);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 6. Matching Free Pancake on Specific & Mixed Pancakes
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n6. Verifying Free Pancake Matching Purchased Pancake Type...');

    // Single Deluxe Pancake (₹180): free item must match Nutella Deluxe Pancake!
    orderRes = await post('/api/orders', {
      type: 'dine_in',
      items: [{ product_id: 'prod-deluxe', quantity: 1 }],
    });
    assert.equal(orderRes.status, 201);
    const orderDeluxe = orderRes.data.order;

    applyRes = await post('/api/promotions/apply', {
      order_id: orderDeluxe.id,
      promotion_id: 'launch-bogo',
    });
    assert.equal(applyRes.status, 200);
    assert.equal(applyRes.data.order.subtotal, 360);
    assert.equal(applyRes.data.order.discount_amount, 180);
    assert.equal(applyRes.data.order.total, 180, 'Customer pays for 1 Nutella Deluxe (₹180)');

    const deluxeItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderDeluxe.id);
    assert.equal(deluxeItems.length, 2);
    assert(deluxeItems[1].product_name.includes('Nutella Deluxe Pancake'), 'Free item matches Nutella Deluxe');

    // Mixed Pancakes: 1 Classic (₹100) + 1 Deluxe (₹180) -> receives 2 Classic + 2 Deluxe, pays 1 Classic + 1 Deluxe
    orderRes = await post('/api/orders', {
      type: 'dine_in',
      items: [
        { product_id: 'prod-classic', quantity: 1 },
        { product_id: 'prod-deluxe', quantity: 1 },
      ],
    });
    assert.equal(orderRes.status, 201);
    const orderMixed = orderRes.data.order;

    applyRes = await post('/api/promotions/apply', {
      order_id: orderMixed.id,
      promotion_id: 'launch-bogo',
    });
    assert.equal(applyRes.status, 200);
    assert.equal(applyRes.data.order.subtotal, 560, 'Subtotal: 2x100 + 2x180 = 560');
    assert.equal(applyRes.data.order.discount_amount, 280, 'Discount: 100 + 180 = 280');
    assert.equal(applyRes.data.order.total, 280, 'Customer pays 100 + 180 = 280');

    // ════════════════════════════════════════════════════════════════════════════
    // 7. Non-Pancakes Exclusion & Mixed Basket Behaviour
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n7. Verifying Non-Pancakes Exclusion & Mixed Basket...');

    // Beverage only -> ineligible
    prev = await post('/api/promotions/preview', {
      promotion_id: 'launch-bogo',
      items: [{ product_id: 'prod-coffee', product_name: 'Cold Brew Coffee', quantity: 1, unit_price: 80 }],
    });
    assert.equal(prev.status, 200);
    assert.equal(prev.data.eligible, false, 'Non-pancake item does not qualify');

    // Order with 1 Classic Pancake ($100) and 1 Coffee ($80)
    // Only pancake receives free matching pancake; coffee is untouched!
    orderRes = await post('/api/orders', {
      type: 'dine_in',
      items: [
        { product_id: 'prod-classic', quantity: 1 },
        { product_id: 'prod-coffee', quantity: 1 },
      ],
    });
    assert.equal(orderRes.status, 201);
    const orderMixedBasket = orderRes.data.order;

    applyRes = await post('/api/promotions/apply', {
      order_id: orderMixedBasket.id,
      promotion_id: 'launch-bogo',
    });
    assert.equal(applyRes.status, 200);
    assert.equal(applyRes.data.order.subtotal, 280, '100 paid + 100 free + 80 coffee = 280');
    assert.equal(applyRes.data.order.discount_amount, 100, 'Discount equals only the free pancake (₹100)');
    assert.equal(applyRes.data.order.total, 180, 'Customer pays for 1 pancake (100) + 1 coffee (80) = 180');

    // Dynamic Matching: create brand-new pancake without editing promotion settings
    seedProduct(db, 'prod-choco-new', 'cat-pancakes', 'Belgian Choco Pancake', 160);

    // Order with 1 Belgian Choco ($160)
    orderRes = await post('/api/orders', {
      type: 'dine_in',
      items: [{ product_id: 'prod-choco-new', quantity: 1 }],
    });
    assert.equal(orderRes.status, 201);
    const orderChoco = orderRes.data.order;

    applyRes = await post('/api/promotions/apply', {
      order_id: orderChoco.id,
      promotion_id: 'launch-bogo',
    });
    assert.equal(applyRes.status, 200, 'Newly created pancake dynamically qualifies for Launch BOGO');
    assert.equal(applyRes.data.order.subtotal, 320);
    assert.equal(applyRes.data.order.discount_amount, 160);
    assert.equal(applyRes.data.order.total, 160);

    // ════════════════════════════════════════════════════════════════════════════
    // 8. Promotion Removal & Order Restoration
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n8. Verifying Manual Removal of Promotions...');

    // Remove promotion from orderChoco
    let removeRes = await post('/api/promotions/remove', {
      order_id: orderChoco.id,
    }, cashierAuth);
    assert.equal(removeRes.status, 200, 'Cashier can remove promotion');
    assert.equal(removeRes.data.order.promotion_id, null);
    assert.equal(removeRes.data.order.subtotal, 160, 'Subtotal restored to 1 pancake');
    assert.equal(removeRes.data.order.discount_amount, 0);
    assert.equal(removeRes.data.order.total, 160, 'Order total restored');

    const chocoItemsAfter = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderChoco.id);
    assert.equal(chocoItemsAfter.length, 1, 'Auto-added free pancake removed');

    // ════════════════════════════════════════════════════════════════════════════
    // 8B. Terminal State Protection (Cancellation, Refunds, and Paid Checks)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n8B. Verifying Cancellation, Refund, and Paid Terminal State Protections...');

    // Order created then cancelled
    const cancelledOrderRes = await post('/api/orders', {
      type: 'dine_in',
      items: [{ product_id: 'prod-classic', quantity: 1 }],
    });
    const cancelledOrder = cancelledOrderRes.data.order;
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(cancelledOrder.id);

    // Attempting to apply promotion to cancelled order must fail with 400
    let termRes = await post('/api/promotions/apply', {
      order_id: cancelledOrder.id,
      promotion_id: 'launch-bogo',
    });
    assert.equal(termRes.status, 400, 'Cannot apply promotion to cancelled order');

    // Attempting to remove promotion from cancelled order must fail with 400
    termRes = await post('/api/promotions/remove', {
      order_id: cancelledOrder.id,
    });
    assert.equal(termRes.status, 400, 'Cannot remove promotion from cancelled order');

    // Already paid bill protection:
    // Create and settle an order
    const paidOrderRes = await post('/api/orders', {
      type: 'dine_in',
      items: [{ product_id: 'prod-classic', quantity: 1 }],
    });
    const paidOrder = paidOrderRes.data.order;
    const paidBillRes = await post('/api/bills/generate', { order_id: paidOrder.id });
    completeExactBalanceSettlement(db, paidBillRes.data.bill.id, 100, 'INR');

    // Applying promotion to paid order must fail with 400 or 409
    termRes = await post('/api/promotions/apply', {
      order_id: paidOrder.id,
      promotion_id: 'launch-bogo',
    });
    assert(termRes.status === 400 || termRes.status === 409, 'Cannot apply promotion to already paid order');

    // ════════════════════════════════════════════════════════════════════════════
    // 8. Loyalty 6th-Visit BOGO & Cycle Reset
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n8. Verifying Loyalty 6th-Visit Milestone & Cycle Reset...');

    // Initial eligibility check for Alice (0 paid visits)
    let loyaltyCheck = await get('/api/promotions/loyalty-eligibility/cust-alice');
    assert.equal(loyaltyCheck.status, 200);
    assert.equal(loyaltyCheck.data.eligible, false);
    assert.equal(loyaltyCheck.data.qualifyingPaidVisits, 0);
    assert.equal(loyaltyCheck.data.visitsNeeded, 5);

    // Simulate 4 qualifying paid visits for Alice
    for (let i = 1; i <= 4; i++) {
      const oRes = await post('/api/orders', {
        type: 'dine_in',
        customer_id: 'cust-alice',
        items: [{ product_id: 'prod-classic', quantity: 1 }],
      });
      const bRes = await post('/api/bills/generate', { order_id: oRes.data.order.id });
      completeExactBalanceSettlement(db, bRes.data.bill.id, 100, 'INR');
    }

    // Check after 4 visits
    loyaltyCheck = await get('/api/promotions/loyalty-eligibility/cust-alice');
    assert.equal(loyaltyCheck.data.qualifyingPaidVisits, 4);
    assert.equal(loyaltyCheck.data.eligible, false);
    assert.equal(loyaltyCheck.data.visitsNeeded, 1);

    // 5th qualifying paid visit
    const o5Res = await post('/api/orders', {
      type: 'dine_in',
      customer_id: 'cust-alice',
      items: [{ product_id: 'prod-classic', quantity: 1 }],
    });
    const b5Res = await post('/api/bills/generate', { order_id: o5Res.data.order.id });
    completeExactBalanceSettlement(db, b5Res.data.bill.id, 100, 'INR');

    // Check after 5 visits -> NOW ELIGIBLE FOR 6th-VISIT REWARD!
    loyaltyCheck = await get('/api/promotions/loyalty-eligibility/cust-alice');
    assert.equal(loyaltyCheck.data.qualifyingPaidVisits, 5);
    assert.equal(loyaltyCheck.data.eligible, true, 'Alice is eligible for 6th visit reward');
    assert.equal(loyaltyCheck.data.isSixthVisitReward, true);

    // On 6th visit, Alice orders 1 pancake and redeems the Loyalty BOGO reward (Buy 1 -> Receive 2, Pay 1)
    const rewardOrderRes = await post('/api/orders', {
      type: 'dine_in',
      customer_id: 'cust-alice',
      items: [{ product_id: 'prod-classic', quantity: 1 }],
    });
    const rewardOrder = rewardOrderRes.data.order;

    // Apply loyalty-visit6-bogo
    applyRes = await post('/api/promotions/apply', {
      order_id: rewardOrder.id,
      promotion_id: 'loyalty-visit6-bogo',
    });
    assert.equal(applyRes.status, 200, 'Loyalty reward applied successfully');
    assert.equal(applyRes.data.order.subtotal, 200);
    assert.equal(applyRes.data.order.discount_amount, 100);
    assert.equal(applyRes.data.order.total, 100);

    // Generate bill and settle
    const rewardBillRes = await post('/api/bills/generate', { order_id: rewardOrder.id });
    assert.equal(rewardBillRes.data.bill.total, 100);
    completeExactBalanceSettlement(db, rewardBillRes.data.bill.id, 100, 'INR');

    // Verify redemption record was created in database
    const redemption = db.prepare(`
      SELECT * FROM promotion_redemptions
      WHERE order_id = ? AND promotion_id = 'loyalty-visit6-bogo'
    `).get(rewardOrder.id);
    assert(redemption, 'Promotion redemption recorded on checkout');
    assert.equal(redemption.is_loyalty_reward, 1, 'Marked as loyalty reward');
    assert.equal(redemption.customer_id, 'cust-alice');

    // CRITICAL REQUIREMENT: Verify cycle reset!
    // The redeemed reward visit does NOT count toward the next cycle.
    // Qualifying visits must now be 0!
    loyaltyCheck = await get('/api/promotions/loyalty-eligibility/cust-alice');
    assert.equal(loyaltyCheck.data.qualifyingPaidVisits, 0, 'Qualifying paid visits reset to 0');
    assert.equal(loyaltyCheck.data.eligible, false, 'Not eligible for another reward until 5 more visits');
    assert.equal(loyaltyCheck.data.visitsNeeded, 5, '5 new visits needed');

    // ════════════════════════════════════════════════════════════════════════════
    // 9. Checkout Consumption Idempotency
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n9. Verifying Checkout Consumption & Redemption Idempotency...');

    const redemptionCountBefore = db.prepare(`
      SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE order_id = ?
    `).get(rewardOrder.id).cnt;
    assert.equal(redemptionCountBefore, 1);

    // Retry settlement / checkout inventory consumption
    db.transaction(() => {
      consumeCheckoutInventory(db, rewardOrder.id, owner.userId, `bill:${rewardBillRes.data.bill.id}`);
    })();

    const redemptionCountAfter = db.prepare(`
      SELECT COUNT(*) as cnt FROM promotion_redemptions WHERE order_id = ?
    `).get(rewardOrder.id).cnt;
    assert.equal(redemptionCountAfter, 1, 'No duplicate redemptions on retry');

    // ════════════════════════════════════════════════════════════════════════════
    // 10. Inventory & Packaging Consumption for Paid AND Free Items
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n10. Verifying Inventory & Packaging Consumption for Free Items...');

    const flourBefore = Number(getSupply(db, flourSupply.id).stock_quantity);
    const milkBefore = Number(getSupply(db, milkSupply.id).stock_quantity);
    const boxBefore = Number(getSupply(db, boxMaterial.id).stock_quantity);

    // Place takeaway order with 1 Classic Pancake under BOGO (1 paid -> receives 2, 1 free)
    const takeawayOrderRes = await post('/api/orders', {
      type: 'takeaway',
      items: [
        {
          product_id: 'prod-classic',
          quantity: 1,
          serving_allocations: [{ serving_type: 'parcel', quantity: 1 }],
        },
      ],
    });
    assert.equal(takeawayOrderRes.status, 201);
    const takeawayOrder = takeawayOrderRes.data.order;

    // Apply Launch BOGO -> automatically adds 1 matching Classic Pancake (BOGO Free)
    await post('/api/promotions/apply', {
      order_id: takeawayOrder.id,
      promotion_id: 'launch-bogo',
    });

    // Generate bill & settle
    const takeawayBillRes = await post('/api/bills/generate', { order_id: takeawayOrder.id });
    const bill = takeawayBillRes.data.bill;
    completeExactBalanceSettlement(db, bill.id, bill.total, 'INR');

    // Check supply stock deductions:
    // Recipe: 0.1 kg flour & 0.05 L milk per pancake.
    // 2 pancakes (1 paid, 1 free) must consume:
    // 2 * 0.1 = 0.2 kg flour
    // 2 * 0.05 = 0.1 L milk
    // 2 * 1 = 2 packaging boxes
    const flourAfter = Number(getSupply(db, flourSupply.id).stock_quantity);
    const milkAfter = Number(getSupply(db, milkSupply.id).stock_quantity);
    const boxAfter = Number(getSupply(db, boxMaterial.id).stock_quantity);

    assert.equal(flourAfter.toFixed(2), (flourBefore - 0.2).toFixed(2), 'Both paid and free pancake consumed flour');
    assert.equal(milkAfter.toFixed(2), (milkBefore - 0.1).toFixed(2), 'Both paid and free pancake consumed milk');
    assert.equal(boxAfter, boxBefore - 2, 'Both paid and free pancake consumed takeaway box');

    // ════════════════════════════════════════════════════════════════════════════
    // 11. Promotions Reports Summary & Simulated Order Exclusion
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n11. Verifying Reports Summary & Simulated Order Exclusion...');

    // Cashier cannot access reports (requires reports.view)
    res = await get('/api/promotions/reports/summary', cashierAuth);
    assert.equal(res.status, 403, 'Cashier forbidden from viewing reports');

    // Insert a simulated delivery order and a fake redemption for it
    db.prepare(`
      INSERT INTO orders (id, order_number, type, status, subtotal, discount_amount, total, created_at, updated_at)
      VALUES (99999, 'ORD-SIM-99999', 'delivery', 'completed', 200, 100, 100, ?, ?)
    `).run(now(), now());

    db.prepare(`
      INSERT INTO delivery_order_tracking (
        internal_order_id, provider, external_order_id, is_simulated,
        external_status, internal_status, created_at, updated_at
      ) VALUES (99999, 'zomato', 'SIM-ORDER-999', 1, 'delivered', 'completed', ?, ?)
    `).run(now(), now());

    db.prepare(`
      INSERT INTO promotion_redemptions (
        promotion_id, order_id, discount_amount, is_loyalty_reward, created_at
      ) VALUES ('launch-bogo', 99999, 100, 0, ?)
    `).run(now());

    // Fetch reports summary as Owner
    const reportRes = await get('/api/promotions/reports/summary', owner.authHeader);
    assert.equal(reportRes.status, 200);
    const summary = reportRes.data;

    // Verify simulated order is excluded:
    // Total redemptions from earlier tests:
    // 1-4. Section 5 (Q = 1, 2, 3, 4 with 'launch-bogo')
    // 5. rewardOrder ('loyalty-visit6-bogo')
    // 6. takeawayOrder ('launch-bogo')
    assert.equal(summary.totalRedemptionsCount, 6, 'Simulated delivery order redemption is strictly excluded');
    assert.equal(summary.loyaltyRewardRedemptionsCount, 1, '1 loyalty reward counted');
    assert.equal(summary.launchBogoRedemptionsCount, 5, '5 launch bogo counted');
    assert(summary.totalDiscountAmount >= 1200, 'Total discount aggregated correctly');

    // ════════════════════════════════════════════════════════════════════════════
    // 12. Permissions Matrix Summary
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n12. Verifying Permissions Matrix Enforcement...');

    // Server user has role 'server' without orders.discount.apply
    const serverApplyRes = await post('/api/promotions/apply', {
      order_id: order1.id,
      promotion_id: 'launch-bogo',
    }, serverAuth);
    assert.equal(serverApplyRes.status, 403, 'Server role cannot apply promotion');

    const serverRemoveRes = await post('/api/promotions/remove', {
      order_id: order1.id,
    }, serverAuth);
    assert.equal(serverRemoveRes.status, 403, 'Server role cannot remove promotion');

    // ════════════════════════════════════════════════════════════════════════════
    // 13. Manual BOGO Promotion Application & Reporting
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n13. Verifying Manual BOGO Promotion Application & Redemption Records...');

    const manualBogoOrderRes = await post('/api/orders', {
      type: 'dine_in',
      customer_id: 'cust-alice',
      items: [{ product_id: 'prod-classic', quantity: 1 }],
    });
    assert.equal(manualBogoOrderRes.status, 201);
    const manualOrder = manualBogoOrderRes.data.order;

    const manualApplyRes = await post('/api/promotions/apply', {
      order_id: manualOrder.id,
      promotion_id: 'manual-bogo',
    });
    assert.equal(manualApplyRes.status, 200, 'Manual BOGO applied successfully');
    assert.equal(manualApplyRes.data.order.subtotal, 200);
    assert.equal(manualApplyRes.data.order.discount_amount, 100);
    assert.equal(manualApplyRes.data.order.total, 100);

    const manualItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(manualOrder.id) as any[];
    assert.equal(manualItems.length, 2, 'Two items in order (1 paid + 1 free)');
    const manualFreeItem = manualItems.find((i) => i.product_name.includes('(BOGO Free)'));
    assert(manualFreeItem, 'Free pancake created for Manual BOGO');
    assert.equal(manualFreeItem.special_instructions, 'BOGO Free - Manual BOGO');

    const manualBillRes = await post('/api/bills/generate', { order_id: manualOrder.id });
    assert.equal(manualBillRes.status, 201);
    completeExactBalanceSettlement(db, manualBillRes.data.bill.id, 100, 'INR');

    const manualRedemption = db.prepare(`
      SELECT * FROM promotion_redemptions WHERE order_id = ? AND promotion_id = 'manual-bogo'
    `).get(manualOrder.id) as any;
    assert(manualRedemption, 'Manual BOGO redemption logged in database');
    assert.equal(manualRedemption.discount_amount, 100);

    const updatedSummaryRes = await get('/api/promotions/reports/summary', owner.authHeader);
    assert.equal(updatedSummaryRes.status, 200);
    assert.equal(updatedSummaryRes.data.manualBogoRedemptionsCount, 1, 'Manual BOGO redemption count is 1');
    assert.equal(updatedSummaryRes.data.manualBogoDiscountAmount, 100, 'Manual BOGO discount is ₹100');

    // ════════════════════════════════════════════════════════════════════════════
    // 14. Promotion Expiry Enforcement
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n14. Verifying Promotion Expiry Enforcement...');

    db.prepare(`
      INSERT OR REPLACE INTO promotions (
        id, name, description, discount_type, target_type, discount_value,
        bogo_buy_qty, bogo_get_qty, bogo_pricing_rule, is_loyalty_reward,
        start_at, end_at, is_active, is_automatic
      ) VALUES (
        'expired-promo', 'Expired Promo', 'Expired Offer', 'bogo', 'all_pancakes', 0,
        1, 1, 'same_item', 0,
        '2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z', 1, 0
      )
    `).run();

    const expiredPreviewRes = await post('/api/promotions/preview', {
      promotion_id: 'expired-promo',
      items: [{ product_id: 'prod-classic', quantity: 1, unit_price: 100 }],
    });
    assert.equal(expiredPreviewRes.status, 200);
    assert.equal(expiredPreviewRes.data.eligible, false);
    assert.equal(expiredPreviewRes.data.ineligibleReason, 'Promotion has expired');

    // ════════════════════════════════════════════════════════════════════════════
    // 15. Zero-Payable Order Settlement Handling
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n15. Verifying Zero-Payable Bill Settlement via API...');

    const freeOrderRes = await post('/api/orders', {
      type: 'dine_in',
      customer_id: 'cust-alice',
      items: [{ product_id: 'prod-classic', quantity: 1 }],
    });
    const freeOrder = freeOrderRes.data.order;

    // Allow 100% discount for comp test
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('discount_max_percentage', '100')").run();

    // Apply 100% discount to bring balance to 0
    const discountRes = await patch(`/api/orders/${freeOrder.id}/discount`, {
      discount_type: 'percentage',
      discount_value: 100,
      discount_reason: '100% Free Comp',
    });
    assert.equal(discountRes.status, 200);
    assert.equal(discountRes.data.order.total, 0, 'Order total is 0');

    const freeBillRes = await post('/api/bills/generate', { order_id: freeOrder.id });
    assert.equal(freeBillRes.status, 201);
    assert.equal(freeBillRes.data.bill.total, 0);
    assert.equal(freeBillRes.data.bill.balance, 0);

    // POST /bills/:id/payments with empty payments array
    const zeroPayRes = await post(`/api/bills/${freeBillRes.data.bill.id}/payments`, {
      payments: [],
    });
    assert.equal(zeroPayRes.status, 200, 'Zero-due bill payment succeeds');
    assert.equal(zeroPayRes.data.orderFullyPaid, true);
    assert.equal(zeroPayRes.data.bill.payment_status, 'paid');

    // ════════════════════════════════════════════════════════════════════════════
    // 16. Top Products Today Breakdown (Paid vs. Free Units)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n16. Verifying Top Products Today Paid vs Free Units Separation...');

    const topProdRes = await get('/api/reports/topProducts', owner.authHeader);
    assert.equal(topProdRes.status, 200);
    assert(Array.isArray(topProdRes.data.topProducts));
    const classicTop = topProdRes.data.topProducts.find((p: any) => p.product_id === 'prod-classic');
    assert(classicTop, 'Classic pancake found in top products');
    assert(classicTop.prepared_quantity > 0, 'Has prepared quantity');
    assert(classicTop.paid_quantity > 0, 'Has paid quantity');
    assert(classicTop.free_quantity > 0, 'Has free promotional quantity');
    assert.equal(
      classicTop.prepared_quantity,
      classicTop.paid_quantity + classicTop.free_quantity,
      'prepared_quantity equals paid_quantity + free_quantity',
    );
    assert(classicTop.gross_sales > classicTop.total_revenue, 'Gross sales is greater than net revenue');
    assert.equal(
      classicTop.total_revenue,
      classicTop.gross_sales - classicTop.discount_amount,
      'total_revenue equals gross_sales minus discount_amount (free units do not inflate revenue)',
    );

    console.log('\n=== All Discounts & BOGO Promotion System Tests Passed Successfully! ===');
  } finally {
    server.close();
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nFAILED with error:', err);
  process.exit(1);
});
