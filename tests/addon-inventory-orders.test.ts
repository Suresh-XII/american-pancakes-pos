/**
 * Behavioral coverage for the add-on inventory order lifecycle (#358).
 *
 * An add-on with its own stock pool has to be as load-bearing on the order path
 * as a product or a variant pool, so these assert the whole cycle: the quantity
 * a line consumes is the item quantity times the add-on quantity, a tracked
 * add-on that cannot cover that requirement refuses the order instead of
 * selling into a negative pool, cancel returns exactly what the line took, item
 * restore re-deducts the recorded snapshot rather than recomputing it from the
 * catalog, and a kitchen void stays a waste. Every movement carries the
 * authenticated operator and an addon_id, and every add-on pool still reconciles
 * against its own ledger afterwards.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/addon-inventory-orders.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-addon-inventory-orders-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb,
  createApp,
  startServer,
  seedOwnerUser,
  seedManagerUser,
  seedCategory,
  seedProduct,
  api,
  assertEqualOrThrow,
  assertOrThrow,
  assertIncludesOrThrow,
  getResults,
  resetCounters,
  closeDatabase,
  now,
} = require('./helpers/test-setup');
const { validateInventoryLedgerDatabase, withTxn } = require('../main/db');
const { adjustProductStock } = require('../main/services/inventory');
const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');
const { refundRoutes } = require('../main/routes/refunds');
const { consumeCheckoutInventory } = require('../main/services/checkout-inventory');

const OAT = 'addon-oat-milk';
const WHOLE = 'addon-whole-milk';

/** Stock a pool holds right now. */
const stockOf = (db: any, addonId: string) =>
  Number(
    (db.prepare('SELECT stock_quantity FROM addons WHERE id = ?').get(addonId) as any)
      ?.stock_quantity ?? 0,
  );

/** Every ledger row an add-on pool has accumulated, oldest first. */
const movementsFor = (db: any, addonId: string): any[] =>
  db.prepare('SELECT * FROM inventory_movements WHERE addon_id = ? ORDER BY id').all(addonId);

/** What a line recorded it took, per add-on row. */
const snapshotOf = (db: any, orderItemId: any) =>
  db
    .prepare(
      'SELECT addon_id, addon_name, quantity, inventory_deducted_quantity FROM order_item_addons WHERE order_item_id = ? ORDER BY id',
    )
    .all(orderItemId) as any[];

/**
 * Every pool must reconcile against its own ledger: an add-on chain that the
 * validator cannot attribute to `addons.stock_quantity` is exactly the silent
 * failure this feature exists to prevent.
 */
function assertPoolsReconcile(db: any, note: string) {
  assertEqualOrThrow(
    validateInventoryLedgerDatabase(db),
    null,
    `add-on pools reconcile after ${note}`,
  );
}

async function main() {
  console.log('Integration Test: add-on inventory order lifecycle (#358)');
  console.log('='.repeat(66));
  resetCounters();

  const db = initTestDb();
  const owner = seedOwnerUser(db);
  const manager = seedManagerUser(db);

  seedCategory(db, 'cat-addon-inv', 'Addon Inventory');
  // Zero product stock on purpose: the products here are untracked menu lines,
  // and a seeded stock figure with no ledger behind it is what the backup
  // validator is there to reject.
  seedProduct(db, 'prod-burger', 'cat-addon-inv', 'Burger', 100, {
    tax_type: 'none',
    stock_quantity: 0,
  });
  seedProduct(db, 'prod-wrap', 'cat-addon-inv', 'Wrap', 100, {
    tax_type: 'none',
    stock_quantity: 0,
  });

  // Group limits are deliberately wide open: this fixture is about the add-on
  // stock pool, not about the group caps enforced elsewhere.
  db.prepare(`INSERT INTO addon_groups (id, name, min_selection, max_selection, allow_multiple_quantities, is_required, is_active, created_at, updated_at)
    VALUES ('grp-milk', 'Milk Options', 0, NULL, 1, 0, 1, ?, ?)`).run(now(), now());
  // Oat milk is the tracked pool this feature is about; whole milk is the
  // untracked control that must keep moving with no stock at all.
  db.prepare(`INSERT INTO addons (id, addon_group_id, name, price, is_active, track_inventory, stock_quantity, low_stock_threshold, created_at, updated_at)
    VALUES (?, 'grp-milk', 'Oat Milk', 1.5, 1, 1, 40, 5, ?, ?)`).run(OAT, now(), now());
  db.prepare(`INSERT INTO addons (id, addon_group_id, name, price, is_active, track_inventory, stock_quantity, created_at, updated_at)
    VALUES (?, 'grp-milk', 'Whole Milk', 0, 1, 0, 0, ?, ?)`).run(WHOLE, now(), now());
  db.prepare(
    `INSERT INTO addon_group_product (product_id, addon_group_id) VALUES ('prod-burger', 'grp-milk')`,
  ).run();
  db.prepare(
    `INSERT INTO addon_group_product (product_id, addon_group_id) VALUES ('prod-wrap', 'grp-milk')`,
  ).run();
  // Opening stock has to exist as a ledger event: a pool whose first movement
  // does not equal its own resulting stock is one the backup validator rejects.
  db.prepare(`INSERT INTO inventory_movements (product_id, variant_id, addon_id, quantity_delta, movement_type, reference_type, reference_id, reason, actor_user_id, stock_after, created_at)
    VALUES (NULL, NULL, ?, 40, 'adjustment', 'opening_balance', NULL, 'Opening stock', ?, 40, ?)`).run(
    OAT,
    owner.userId,
    now(),
  );

  const app = createApp({
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
    '/api/refunds': refundRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  const createOrder = (headers: any, items: any[]) =>
    api(baseUrl, '/api/orders', { method: 'POST', headers, body: { type: 'takeaway', items } });
  const burgerWith = (quantity: number, addons: any[]) => ({
    product_id: 'prod-burger',
    quantity,
    addons,
  });
  const oatMovement = (db: any, index: number) => movementsFor(db, OAT)[index];
  const consume = (orderId: number, reference: string) =>
    db.transaction(() => consumeCheckoutInventory(db, orderId, owner.userId, reference))();

  try {
    console.log('\n--- A line consumes item quantity x add-on quantity ---');
    {
      const before = stockOf(db, OAT);
      // Three burgers with two extra oat milk each: six, not two.
      const res = await createOrder(owner.authHeader, [burgerWith(3, [{ id: OAT, quantity: 2 }])]);
      assertEqualOrThrow(res.status, 201, 'the order is created');
      const item = res.data.order.items[0];
      assertEqualOrThrow(
        stockOf(db, OAT),
        before,
        'checkout_v1 creation defers tracked add-on consumption',
      );
      const snapshot = snapshotOf(db, item.id);
      assertEqualOrThrow(snapshot.length, 1, 'the line records one add-on row');
      assertEqualOrThrow(snapshot[0].addon_id, OAT, 'the row names the catalog add-on');
      assertEqualOrThrow(
        snapshot[0].quantity,
        2,
        'the row keeps the customer-facing add-on quantity',
      );
      assertEqualOrThrow(
        snapshot[0].inventory_deducted_quantity,
        6,
        'the row snapshots the multiplied deduction',
      );

      consume(res.data.order.id, `addon-order:${res.data.order.id}`);
      assertEqualOrThrow(
        stockOf(db, OAT),
        before - 6,
        'checkout consumes the tracked add-on pool',
      );
      consume(res.data.order.id, `addon-order:${res.data.order.id}`);
      assertEqualOrThrow(
        stockOf(db, OAT),
        before - 6,
        'repeated checkout cannot consume the tracked add-on twice',
      );

      const sale = oatMovement(db, 1);
      assertEqualOrThrow(sale.movement_type, 'sale', 'the debit is a sale movement');
      assertEqualOrThrow(sale.addon_id, OAT, 'the ledger row names the add-on pool');
      assertEqualOrThrow(sale.product_id, null, 'an add-on pool movement names no product');
      assertEqualOrThrow(
        sale.quantity_delta,
        -6,
        'the ledger row carries the full multiplied debit',
      );
      assertEqualOrThrow(sale.stock_after, before - 6, 'the ledger row records the resulting pool');
      assertEqualOrThrow(
        sale.actor_user_id,
        owner.userId,
        'the ledger attributes the authenticated operator',
      );
      assertEqualOrThrow(sale.reference_type, 'order_item', 'the ledger points at the order line');
      assertPoolsReconcile(db, 'a tracked sale');
    }
    {
      // An untracked add-on has no pool to move, whatever its stock column says.
      const res = await createOrder(owner.authHeader, [
        burgerWith(1, [{ id: WHOLE, quantity: 2 }]),
      ]);
      assertEqualOrThrow(res.status, 201, 'an untracked add-on still orders normally');
      assertEqualOrThrow(
        movementsFor(db, WHOLE).length,
        0,
        'an untracked add-on writes no ledger row',
      );
      assertEqualOrThrow(stockOf(db, WHOLE), 0, 'an untracked add-on keeps its zero stock');
      assertEqualOrThrow(
        snapshotOf(db, res.data.order.items[0].id)[0].inventory_deducted_quantity,
        0,
        'an untracked add-on snapshots no deduction',
      );
      consume(res.data.order.id, `untracked-order:${res.data.order.id}`);
      assertEqualOrThrow(
        movementsFor(db, WHOLE).length,
        0,
        'checkout writes no ledger row for an untracked add-on',
      );
      assertEqualOrThrow(stockOf(db, WHOLE), 0, 'checkout leaves untracked stock at zero');
    }

    console.log('\n--- A tracked add-on that cannot cover the line refuses the order ---');
    {
      const before = stockOf(db, OAT);
      const ordersBefore = Number((db.prepare('SELECT COUNT(*) AS n FROM orders').get() as any).n);
      // Three items of this add-on cannot fit in what is left in the pool.
      const perItem = Math.floor(before / 3) + 1;
      const res = await createOrder(owner.authHeader, [
        burgerWith(3, [{ id: OAT, quantity: perItem }]),
      ]);
      assertEqualOrThrow(res.status, 400, 'an order the pool cannot cover is refused');
      assertIncludesOrThrow(res.data.error, 'Oat Milk', 'the refusal names the add-on');
      assertIncludesOrThrow(
        res.data.error,
        `requested ${perItem * 3}`,
        'the refusal names the requested amount',
      );
      assertIncludesOrThrow(
        res.data.error,
        `available ${before}`,
        'the refusal names the available amount',
      );
      assertEqualOrThrow(stockOf(db, OAT), before, 'a refused order moves no stock');
      assertEqualOrThrow(
        Number((db.prepare('SELECT COUNT(*) AS n FROM orders').get() as any).n),
        ordersBefore,
        'a refused order writes no order row',
      );
      assertPoolsReconcile(db, 'a refused sale');
    }
    {
      // Two lines can each pass the per-line check and jointly exceed the pool.
      // Under checkout_v1, creation defers consumption, but the checkout ledger
      // guard catches the overdraft at settlement and refuses consumption.
      const before = stockOf(db, OAT);
      const half = Math.floor(before / 2) + 1;
      const eachItem = burgerWith(1, [{ id: OAT, quantity: half }]);
      const res = await createOrder(owner.authHeader, [eachItem, eachItem]);
      assertEqualOrThrow(
        res.status,
        201,
        'lines that individually fit the catalog pool are accepted at creation under checkout_v1',
      );
      assertEqualOrThrow(stockOf(db, OAT), before, 'order creation defers consumption');
      let consumed = false;
      try {
        consume(res.data.order.id, `overcommit:${res.data.order.id}`);
        consumed = true;
      } catch (err: any) {
        assertIncludesOrThrow(err.message, 'Insufficient stock', 'checkout refusal names insufficient stock');
      }
      assertEqualOrThrow(consumed, false, 'checkout consumption is refused for lines jointly exceeding the pool');
      assertEqualOrThrow(stockOf(db, OAT), before, 'the failed checkout moves no stock at all');
      assertPoolsReconcile(db, 'an over-committed order');
    }
    {
      // Appending to a live order enforces the same rule.
      const order = (await createOrder(owner.authHeader, [burgerWith(1, [])])).data.order;
      const before = stockOf(db, OAT);
      const res = await api(baseUrl, `/api/orders/${order.id}/items`, {
        method: 'POST',
        headers: owner.authHeader,
        body: { items: [burgerWith(1, [{ id: OAT, quantity: before + 1 }])] },
      });
      assertEqualOrThrow(res.status, 400, 'appending a line the pool cannot cover is refused');
      assertIncludesOrThrow(res.data.error, 'Oat Milk', 'the append refusal names the add-on');
      assertEqualOrThrow(stockOf(db, OAT), before, 'the refused append moves no stock');
      assertEqualOrThrow(
        Number(
          (
            db
              .prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?')
              .get(order.id) as any
          ).n,
        ),
        1,
        'the refused append writes no line',
      );
    }
    {
      // A line exactly equal to what is left is allowed: refusing at the
      // boundary would make the pool unusable.
      const before = stockOf(db, OAT);
      const res = await createOrder(owner.authHeader, [
        burgerWith(1, [{ id: OAT, quantity: before }]),
      ]);
      assertEqualOrThrow(
        res.status,
        201,
        'a line consuming exactly the remaining pool is accepted',
      );
      assertEqualOrThrow(stockOf(db, OAT), before, 'creation defers consumption of the whole pool');
      consume(res.data.order.id, `boundary:${res.data.order.id}`);
      assertEqualOrThrow(stockOf(db, OAT), 0, 'checkout leaves the pool on zero, not below it');
      // Restock the pool back to its balance so subsequent tests continue with available stock.
      withTxn(() =>
        adjustProductStock(db, {
          productId: null,
          addonId: OAT,
          quantityDelta: before,
          movementType: 'adjustment',
          referenceType: 'restock',
          reason: 'Restock after boundary test',
          actorUserId: owner.userId,
        }),
      );
      assertEqualOrThrow(stockOf(db, OAT), before, 'the pool is restocked');
      assertPoolsReconcile(db, 'boundary test restock');
    }

    console.log('\n--- Cancelling an unconsumed order leaves stock intact ---');
    {
      const before = stockOf(db, OAT);
      const order = (
        await createOrder(owner.authHeader, [
          burgerWith(2, [{ id: OAT, quantity: 3 }]),
          { product_id: 'prod-wrap', quantity: 1, addons: [{ id: OAT, quantity: 1 }] },
        ])
      ).data.order;
      assertEqualOrThrow(stockOf(db, OAT), before, 'creation defers consumption of 6 and 1');
      const movementsBefore = movementsFor(db, OAT).length;

      const res = await api(baseUrl, `/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: manager.authHeader,
        body: { status: 'cancelled', reason: 'customer left' },
      });
      assertEqualOrThrow(res.status, 200, 'the order cancels');
      assertEqualOrThrow(
        stockOf(db, OAT),
        before,
        'cancelling an unconsumed order leaves stock unchanged',
      );
      assertEqualOrThrow(
        movementsFor(db, OAT).length,
        movementsBefore,
        'pre-settlement cancellation appends no restore movements',
      );

      // Cancelling again must not change stock.
      const again = await api(baseUrl, `/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: manager.authHeader,
        body: { status: 'cancelled' },
      });
      assertEqualOrThrow(again.status, 200, 're-cancelling is accepted');
      assertEqualOrThrow(
        stockOf(db, OAT),
        before,
        're-cancelling is idempotent and does not change stock',
      );
      assertPoolsReconcile(db, 'a whole-order cancel');
    }

    console.log('\n--- A voided line is a waste, not a return ---');
    {
      const before = stockOf(db, OAT);
      const order = (
        await createOrder(owner.authHeader, [burgerWith(2, [{ id: OAT, quantity: 3 }])])
      ).data.order;
      const itemId = order.items[0].id;
      assertEqualOrThrow(stockOf(db, OAT), before, 'order creation defers consumption');
      db.prepare("UPDATE order_items SET status = 'preparing' WHERE id = ?").run(itemId);
      const movementsBefore = movementsFor(db, OAT).length;

      const res = await api(baseUrl, `/api/orders/${order.id}/items/${itemId}/cancel`, {
        method: 'PATCH',
        headers: owner.authHeader,
        body: { override_pin: '1234' }, // seedManagerUser's manager PIN
      });
      assertEqualOrThrow(res.status, 200, 'the in-progress line voids');
      assertEqualOrThrow(
        (db.prepare('SELECT status FROM order_items WHERE id = ?').get(itemId) as any).status,
        'voided',
        'the line is marked voided',
      );
      assertEqualOrThrow(stockOf(db, OAT), before, 'voiding does not return add-on stock');
      assertEqualOrThrow(
        movementsFor(db, OAT).length,
        movementsBefore,
        'the void appends no add-on movement at all',
      );

      // Voided lines are omitted from checkout consumption.
      consume(order.id, `voided-item:${order.id}`);
      assertEqualOrThrow(stockOf(db, OAT), before, 'voided line is not consumed at checkout');
      assertPoolsReconcile(db, 'a void');
    }

    console.log('\n--- Cancelling and restoring one line moves the snapshot amount ---');
    {
      const before = stockOf(db, OAT);
      // A second untracked line keeps the order live: cancelling its only
      // active line would auto-cancel the order and close the restore route.
      const order = (
        await createOrder(owner.authHeader, [
          burgerWith(2, [{ id: OAT, quantity: 3 }]),
          { product_id: 'prod-wrap', quantity: 1 },
        ])
      ).data.order;
      const itemId = (
        db
          .prepare(
            'SELECT order_item_id FROM order_item_addons WHERE addon_id = ? ORDER BY id DESC LIMIT 1',
          )
          .get(OAT) as any
      ).order_item_id;

      assertEqualOrThrow(stockOf(db, OAT), before, 'order creation defers consumption');

      const cancelled = await api(baseUrl, `/api/orders/${order.id}/items/${itemId}/cancel`, {
        method: 'PATCH',
        headers: manager.authHeader,
        body: { reason: 'sent back' },
      });
      assertEqualOrThrow(cancelled.status, 200, 'a pending line cancels');
      assertEqualOrThrow(stockOf(db, OAT), before, 'pre-settlement cancellation leaves stock unchanged');

      // The merchant restocks the pool while the line sits cancelled. The
      // restore must still preserve the recorded 6, not anything recomputed - and
      // the restock goes through the ledger so the chain stays intact.
      withTxn(() =>
        adjustProductStock(db, {
          productId: null,
          addonId: OAT,
          quantityDelta: 100,
          movementType: 'adjustment',
          referenceType: 'restock',
          reason: 'Delivery received',
          actorUserId: manager.userId,
        }),
      );
      const inflated = stockOf(db, OAT);

      const restored = await api(baseUrl, `/api/orders/${order.id}/items/${itemId}/restore`, {
        method: 'PATCH',
        headers: manager.authHeader,
        body: {},
      });
      assertEqualOrThrow(restored.status, 200, 'the cancelled line restores');
      assertEqualOrThrow(
        (db.prepare('SELECT status FROM order_items WHERE id = ?').get(itemId) as any).status,
        'pending',
        'the restored line is active again',
      );
      assertEqualOrThrow(
        stockOf(db, OAT),
        inflated,
        'pre-settlement restoration still defers consumption',
      );
      assertEqualOrThrow(
        snapshotOf(db, itemId)[0].inventory_deducted_quantity,
        6,
        'the snapshot row is unchanged by the restore',
      );

      // Cancelling the live line again is a real cancel; cancelling it once more
      // is a no-op, and neither may hand the pool a second time.
      const recancel = await api(baseUrl, `/api/orders/${order.id}/items/${itemId}/cancel`, {
        method: 'PATCH',
        headers: manager.authHeader,
        body: {},
      });
      assertEqualOrThrow(recancel.status, 200, 'the restored line cancels again');
      assertEqualOrThrow(
        stockOf(db, OAT),
        inflated,
        'pre-settlement cancel leaves stock at inflated level',
      );
      const noopCancel = await api(baseUrl, `/api/orders/${order.id}/items/${itemId}/cancel`, {
        method: 'PATCH',
        headers: manager.authHeader,
        body: {},
      });
      assertEqualOrThrow(
        noopCancel.status,
        200,
        'cancelling an already-cancelled line is accepted',
      );
      assertEqualOrThrow(
        stockOf(db, OAT),
        inflated,
        'cancelling an already-cancelled line moves no add-on stock',
      );
      await api(baseUrl, `/api/orders/${order.id}/items/${itemId}/restore`, {
        method: 'PATCH',
        headers: manager.authHeader,
        body: {},
      });
      assertEqualOrThrow(
        stockOf(db, OAT),
        inflated,
        'restoring an already-active line moves no add-on stock',
      );

      // Checkout consumes the recorded snapshot amount (6) exactly once.
      consume(order.id, `addon-line-restore:${order.id}`);
      assertEqualOrThrow(
        stockOf(db, OAT),
        inflated - 6,
        'checkout consumes the recorded snapshot 6',
      );
      consume(order.id, `addon-line-restore:${order.id}`);
      assertEqualOrThrow(
        stockOf(db, OAT),
        inflated - 6,
        'repeated checkout does not consume twice',
      );
      assertPoolsReconcile(db, 'a line cancel and restore');
    }

    console.log('\n--- A post-settlement item refund follows checkout_v1 lifecycle ---');
    {
      const before = stockOf(db, OAT);
      const order = (
        await createOrder(owner.authHeader, [burgerWith(2, [{ id: OAT, quantity: 3 }])])
      ).data.order;
      const itemId = order.items[0].id;
      assertEqualOrThrow(
        stockOf(db, OAT),
        before,
        'order creation defers consumption of 6 from the add-on pool',
      );
      db.prepare("UPDATE order_items SET status = 'served' WHERE id = ?").run(itemId);

      const billRes = await api(baseUrl, '/api/bills/generate', {
        method: 'POST',
        headers: owner.authHeader,
        body: { order_id: order.id },
      });
      assertEqualOrThrow(billRes.status, 201, 'the bill is generated');
      const paidRes = await api(baseUrl, `/api/bills/${billRes.data.bill.id}/payment`, {
        method: 'POST',
        headers: owner.authHeader,
        body: { method: 'card', amount: null },
      });
      assertEqualOrThrow(paidRes.status, 200, 'the bill is paid');
      assertEqualOrThrow(
        stockOf(db, OAT),
        before - 6,
        'bill payment triggers checkout consumption and debits 6 from the add-on pool',
      );

      const movementsBefore = movementsFor(db, OAT).length;
      const refundRes = await api(baseUrl, '/api/refunds', {
        method: 'POST',
        headers: owner.authHeader,
        body: {
          bill_id: paidRes.data.bill.id,
          order_item_id: itemId,
          method: 'card',
          override_pin: '1234',
          approver_id: manager.userId,
          reason: 'Returned item',
        },
      });
      assertEqualOrThrow(refundRes.status, 201, 'the post-settlement item refund is accepted');
      assertEqualOrThrow(
        stockOf(db, OAT),
        before - 6,
        'financial refunds do not restore physical add-on stock under checkout_v1',
      );
      assertEqualOrThrow(
        movementsFor(db, OAT).length,
        movementsBefore,
        'the post-settlement refund appends no add-on restore movement',
      );
      assertEqualOrThrow(
        snapshotOf(db, itemId)[0].inventory_deducted_quantity,
        6,
        'the original order_item_addons snapshot stays intact',
      );
      assertPoolsReconcile(db, 'a post-settlement item refund');
    }

    console.log('\n--- A line with no tracked add-on writes no add-on movement ---');
    {
      const movementsBefore = movementsFor(db, OAT).length;
      const order = (await createOrder(owner.authHeader, [burgerWith(1, [])])).data.order;
      await api(baseUrl, `/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: manager.authHeader,
        body: { status: 'cancelled' },
      });
      assertEqualOrThrow(
        movementsFor(db, OAT).length,
        movementsBefore,
        'cancelling an untracked line appends no add-on movement',
      );
    }
  } finally {
    server.close();
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const results = getResults();
  console.log(`\n${results.passed}/${results.total} passed`);
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((error: any) => {
  console.error(error);
  process.exit(1);
});
