
/** Route-level Stage 3 lifecycle checks. All state is an isolated temp DB. */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const bcrypt = require('bcryptjs');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-ap-stage3-routes-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: () => testDir,
        getVersion: () => 'test',
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb,
  createApp,
  startServer,
  seedOwnerUser,
  seedCategory,
  seedProduct,
  api,
  closeDatabase,
} = require('./helpers/test-setup');

const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');
const { refundRoutes } = require('../main/routes/refunds');
const { packagingProfileRoutes } = require('../main/routes/packaging-profiles');
const { recipeRoutes } = require('../main/routes/recipes');

const count = (db: any, table: string) =>
  Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);

const stock = (db: any, table: string, id: string) =>
  Number(
    db.prepare(`SELECT stock_quantity FROM ${table} WHERE id=?`).get(id).stock_quantity,
  );

async function main() {
  const db = initTestDb();
  const owner = seedOwnerUser(db);

  db.prepare('UPDATE users SET pin_hash=? WHERE id=?').run(
    bcrypt.hashSync('9999', 10),
    owner.userId,
  );

  seedCategory(db, 'stage3-cat', 'Stage 3');

  seedProduct(db, 'stage3-product', 'stage3-cat', 'Pancake', 100, {
    tax_type: 'none',
    stock_quantity: 20,
    track_inventory: true,
  });

  db.prepare(`
    INSERT INTO supplies(id,name,base_unit,stock_quantity,unit_cost,is_active,created_at,updated_at)
    VALUES
      ('stage3-flour','Flour','g',1000,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
      ('stage3-plate','Plate','each',20,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
      ('stage3-box','Box','each',20,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `).run();

  const app = createApp({
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
    '/api/refunds': refundRoutes,
    '/api/packaging-profiles': packagingProfileRoutes,
    '/api/recipes': recipeRoutes,
  });

  const { baseUrl, server } = await startServer(app);

  const call = (url: string, method = 'GET', body?: any) =>
    api(baseUrl, url, {
      method,
      headers: owner.authHeader,
      ...(body === undefined ? {} : { body }),
    });

  try {
    const plate = await call('/api/packaging-profiles', 'POST', {
      name: 'Plate',
      serving_type: 'dine_in',
      packaging_type: 'paper_plate',
      supply_id: 'stage3-plate',
      units_per_serving: 1,
      customer_charge_per_unit: 0,
      is_default: true,
    });

    // Test-only multiplier: two boxes per takeaway pancake.
    const box = await call('/api/packaging-profiles', 'POST', {
      name: 'Box',
      serving_type: 'parcel',
      packaging_type: 'parcel_box',
      supply_id: 'stage3-box',
      units_per_serving: 2,
      customer_charge_per_unit: 0,
      is_default: true,
    });

    assert.equal(plate.status, 201);
    assert.equal(box.status, 201);

    const recipe = await call('/api/recipes/product/stage3-product', 'PUT', {
      yield_quantity: 1,
      is_active: true,
      items: [{ supply_id: 'stage3-flour', quantity: 30, unit: 'g' }],
    });

    assert.equal(recipe.status, 200, 'recipe API saves initial snapshot source');

    const futureLocalWallTime = () =>
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(new Date(Date.now() + 3 * 3600_000))
        .replace(' ', 'T');

    const create = async (scheduled = false) =>
      call('/api/orders', 'POST', {
        type: 'takeaway',
        ...(scheduled ? { scheduled_for: futureLocalWallTime() } : {}),
        items: [
          {
            product_id: 'stage3-product',
            quantity: 2,
            serving_allocations: [
              {
                serving_type: 'dine_in',
                quantity: 1,
                packaging_profile_id: plate.data.profile.id,
              },
              {
                serving_type: 'parcel',
                quantity: 1,
                packaging_profile_id: box.data.profile.id,
              },
            ],
          },
        ],
      });

    const orderRes = await create();

    assert.equal(orderRes.status, 201, 'route creates checkout-v1 order');

    const order = orderRes.data.order;
    const itemId = order.items[0].id;

    // Verify immutable automatic parcel packaging snapshot.
    const packagingSnapshot = db
      .prepare(`
        SELECT
          p.quantity,
          p.allocation_source,
          p.confirmed_by_user_id,
          p.confirmed_at,
          p.supply_id_snapshot
        FROM order_item_packaging_allocations p
        JOIN order_item_serving_allocations s
          ON s.id = p.serving_allocation_id
        WHERE s.order_item_id = ?
          AND s.serving_type = 'parcel'
      `)
      .get(itemId) as any;

    assert(packagingSnapshot, 'parcel packaging snapshot exists');
    assert.equal(
      packagingSnapshot.quantity,
      2,
      'one takeaway pancake allocates two boxes in this test',
    );
    assert.equal(
      packagingSnapshot.allocation_source,
      'automatic',
      'parcel packaging is automatically allocated',
    );
    assert.equal(
      packagingSnapshot.confirmed_by_user_id,
      null,
      'automatic allocation requires no user confirmation',
    );
    assert.equal(
      packagingSnapshot.confirmed_at,
      null,
      'automatic allocation has no manual confirmation timestamp',
    );
    assert.equal(
      packagingSnapshot.supply_id_snapshot,
      'stage3-box',
      'packaging snapshot retains the original box supply',
    );

    assert.equal(
      stock(db, 'products', 'stage3-product'),
      20,
      'creation does not consume product',
    );
    assert.equal(
      stock(db, 'supplies', 'stage3-flour'),
      1000,
      'creation does not consume recipe',
    );
    assert.equal(
      stock(db, 'supplies', 'stage3-plate'),
      20,
      'creation does not consume plates',
    );
    assert.equal(
      stock(db, 'supplies', 'stage3-box'),
      20,
      'creation does not consume parcel boxes',
    );

    // Normal APIs may change live definitions, but this pre-existing order keeps snapshots.
    assert.equal(
      (
        await call('/api/recipes/product/stage3-product', 'PUT', {
          yield_quantity: 1,
          is_active: true,
          items: [{ supply_id: 'stage3-flour', quantity: 99, unit: 'g' }],
        })
      ).status,
      200,
    );

    assert.equal(
      (
        await call(`/api/packaging-profiles/${box.data.profile.id}`, 'PUT', {
          name: 'Box',
          serving_type: 'parcel',
          packaging_type: 'parcel_box',
          supply_id: 'stage3-plate',
          units_per_serving: 1,
          customer_charge_per_unit: 0,
          is_active: true,
        })
      ).status,
      200,
    );

    const billGen = await call('/api/bills/generate', 'POST', {
      order_id: order.id,
    });

    assert.equal(billGen.status, 201);

    const billId = billGen.data.bill.id;

    const partial = await call(`/api/bills/${billId}/payment`, 'POST', {
      method: 'cash',
      amount: 100,
    });

    assert.equal(partial.status, 200);

    assert.equal(
      stock(db, 'products', 'stage3-product'),
      20,
      'partial payment does not consume products',
    );
    assert.equal(
      stock(db, 'supplies', 'stage3-plate'),
      20,
      'partial payment does not consume plates',
    );
    assert.equal(
      stock(db, 'supplies', 'stage3-box'),
      20,
      'partial payment does not consume parcel boxes',
    );

    const paid = await call(`/api/bills/${billId}/payment`, 'POST', {
      method: 'cash',
      amount: 100,
    });

    assert.equal(paid.status, 200);

    assert.equal(
      stock(db, 'products', 'stage3-product'),
      18,
      'completion consumes saved product snapshot',
    );
    assert.equal(
      stock(db, 'supplies', 'stage3-flour'),
      940,
      'completion uses original recipe snapshot, not edited recipe',
    );
    assert.equal(
      stock(db, 'supplies', 'stage3-plate'),
      19,
      'completion consumes one dine-in plate',
    );
    assert.equal(
      stock(db, 'supplies', 'stage3-box'),
      18,
      'completion consumes two parcel boxes from the original snapshot',
    );

    const ledgerAfter = count(db, 'order_inventory_consumptions');
    const movementAfter = count(db, 'inventory_movements');

    const concurrent = await Promise.all([
      call(`/api/bills/${billId}/payment`, 'POST', {
        method: 'cash',
        amount: 0,
      }),
      call(`/api/bills/${billId}/payment`, 'POST', {
        method: 'cash',
        amount: 0,
      }),
    ]);

    assert(
      concurrent.every((r: any) => r.status === 200),
      'concurrent paid-bill settlement requests return consistent responses',
    );

    assert.equal(
      count(db, 'order_inventory_consumptions'),
      ledgerAfter,
      'concurrent requests create no duplicate ledger',
    );

    assert.equal(
      count(db, 'inventory_movements'),
      movementAfter,
      'concurrent requests create no duplicate movements',
    );

    // A financial refund preserves checkout-time consumption and ledger history.
    db.prepare("UPDATE order_items SET status='completed' WHERE id=?").run(itemId);

    const refund = await call('/api/refunds', 'POST', {
      bill_id: billId,
      order_item_id: itemId,
      method: 'cash',
      override_pin: '9999',
      approver_id: owner.userId,
    });

    assert.equal(
      refund.status,
      201,
      `checkout-v1 item refund succeeds through route: ${JSON.stringify(refund.data)}`
    );
    assert.equal(
      stock(db, 'products', 'stage3-product'),
      18,
      'checkout-v1 refund does not restore product',
    );

    assert.equal(
      count(db, 'order_inventory_consumptions'),
      ledgerAfter,
      'checkout-v1 refund preserves consumption ledger',
    );
    // Restore the test profile for the next order.
    // The previous order has already verified immutable snapshots.
    const restoredBoxProfile = await call(
      `/api/packaging-profiles/${box.data.profile.id}`,
      'PUT',
      {
        name: 'Box',
        serving_type: 'parcel',
        packaging_type: 'parcel_box',
        supply_id: 'stage3-box',
        units_per_serving: 2,
        customer_charge_per_unit: 0,
        is_active: true,
      },
    );

    assert.equal(restoredBoxProfile.status, 200, 'test parcel profile restored');
    
    // Restore the live recipe before the next order.
    // The earlier order must retain its 30g snapshot after the live recipe
    // was changed to 99g; this new mixed order should use the restored 30g recipe.
    const restoredRecipe = await call(
      '/api/recipes/product/stage3-product',
      'PUT',
      {
        yield_quantity: 1,
        is_active: true,
        items: [{ supply_id: 'stage3-flour', quantity: 30, unit: 'g' }],
      },
    );

    assert.equal(restoredRecipe.status, 200, 'test recipe restored to 30g per pancake');

    // Mixed order: four pancakes split equally between dine-in and takeaway.
    const mixedOrder = await call('/api/orders', 'POST', {
      type: 'takeaway',
      items: [
        {
          product_id: 'stage3-product',
          quantity: 4,
          serving_allocations: [
            {
              serving_type: 'dine_in',
              quantity: 2,
              packaging_profile_id: plate.data.profile.id,
            },
            {
              serving_type: 'parcel',
              quantity: 2,
              packaging_profile_id: box.data.profile.id,
            },
          ],
        },
      ],
    });

    assert.equal(mixedOrder.status, 201, 'mixed-serving order is created');

    const mixedItemId = mixedOrder.data.order.items[0].id;

    // Verify both automatic packaging snapshots.
    const mixedPackaging = db.prepare(`
      SELECT s.serving_type, p.quantity, p.allocation_source
      FROM order_item_packaging_allocations p
      JOIN order_item_serving_allocations s
        ON s.id = p.serving_allocation_id
      WHERE s.order_item_id = ?
    `).all(mixedItemId) as any[];

    const dineInPackaging = mixedPackaging.find(
      (p) => p.serving_type === 'dine_in',
    );
    const parcelPackaging = mixedPackaging.find(
      (p) => p.serving_type === 'parcel',
    );

    assert(dineInPackaging, 'dine-in packaging snapshot exists');
    assert(parcelPackaging, 'takeaway packaging snapshot exists');

    assert.equal(dineInPackaging.quantity, 2, 'two dine-in pancakes allocate two plates');
    assert.equal(parcelPackaging.quantity, 4, 'two takeaway pancakes allocate four boxes');

    assert.equal(dineInPackaging.allocation_source, 'automatic');
    assert.equal(parcelPackaging.allocation_source, 'automatic');

    // Creating the mixed order must not deduct stock.
    assert.equal(stock(db, 'supplies', 'stage3-plate'), 19);
    assert.equal(stock(db, 'supplies', 'stage3-box'), 18);

    // Complete payment for all four pancakes.
    const mixedBill = await call('/api/bills/generate', 'POST', {
      order_id: mixedOrder.data.order.id,
    });

    assert.equal(mixedBill.status, 201);

    const mixedPayment = await call(
      `/api/bills/${mixedBill.data.bill.id}/payment`,
      'POST',
      { method: 'cash', amount: 400 },
    );

    assert.equal(mixedPayment.status, 200, 'mixed order payment completes');

    // Both packaging types must be deducted in the same checkout.
    assert.equal(stock(db, 'supplies', 'stage3-plate'), 17,
      'mixed checkout consumes two plates');

    assert.equal(stock(db, 'supplies', 'stage3-box'), 14,
      'mixed checkout consumes four parcel boxes');

    assert.equal(stock(db, 'products', 'stage3-product'), 14,
      'mixed checkout consumes four pancakes');

    assert.equal(stock(db, 'supplies', 'stage3-flour'), 820,
      'mixed checkout consumes recipe ingredients for four pancakes');


    // Pre-checkout cancellation/restoration must be pure order-state edits.
    const pending = await create();
    const pendingItem = pending.data.order.items[0].id;

    assert.equal(
      (
        await call(`/api/orders/${pending.data.order.id}/items`, 'POST', {
          items: [{ product_id: 'stage3-product', quantity: 1 }],
        })
      ).status,
      200,
    );

    const beforeCancel = {
      product: stock(db, 'products', 'stage3-product'),
      supply: stock(db, 'supplies', 'stage3-flour'),
      plate: stock(db, 'supplies', 'stage3-plate'),
      box: stock(db, 'supplies', 'stage3-box'),
    };

    assert.equal(
      (
        await call(
          `/api/orders/${pending.data.order.id}/items/${pendingItem}/cancel`,
          'PATCH',
          {},
        )
      ).status,
      200,
    );

    assert.deepEqual(
      {
        product: stock(db, 'products', 'stage3-product'),
        supply: stock(db, 'supplies', 'stage3-flour'),
        plate: stock(db, 'supplies', 'stage3-plate'),
        box: stock(db, 'supplies', 'stage3-box'),
      },
      beforeCancel,
      'pre-checkout cancellation restores nothing',
    );

    assert.equal(
      (
        await call(
          `/api/orders/${pending.data.order.id}/items/${pendingItem}/restore`,
          'PATCH',
          {},
        )
      ).status,
      200,
    );

    assert.deepEqual(
      {
        product: stock(db, 'products', 'stage3-product'),
        supply: stock(db, 'supplies', 'stage3-flour'),
        plate: stock(db, 'supplies', 'stage3-plate'),
        box: stock(db, 'supplies', 'stage3-box'),
      },
      beforeCancel,
      'pre-checkout restore re-deducts nothing',
    );

    // Release is no-op for stock on scheduled checkout-v1 order.
    const scheduled = await create(true);

    assert.equal(scheduled.status, 201);

    const scheduledId = scheduled.data.order.id;
    const scheduledBefore = {
      product: stock(db, 'products', 'stage3-product'),
      plate: stock(db, 'supplies', 'stage3-plate'),
      box: stock(db, 'supplies', 'stage3-box'),
    };

    assert.equal(
      (await call(`/api/orders/${scheduledId}/release`, 'POST', {})).status,
      200,
    );

    assert.deepEqual(
      {
        product: stock(db, 'products', 'stage3-product'),
        plate: stock(db, 'supplies', 'stage3-plate'),
        box: stock(db, 'supplies', 'stage3-box'),
      },
      scheduledBefore,
      'scheduled release does not consume checkout-v1 inventory',
    );

    console.log('American Pancakes Stage 3 route workflow tests passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
