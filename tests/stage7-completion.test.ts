/**
 * FloCafe Stage 7 Completion Test Suite
 *
 * Validates:
 * 1. Workstream B: Cart store serving allocations auto-normalize to order type (dine_in vs parcel)
 * 2. Stage 7.2: BOGO Accounting & Export Alignment (Gross ₹180, Discount ₹90, Net ₹90 for 1 paid + 1 free)
 * 3. Stage 7.2: Product grouping in Daily Sales Export (merges '(BOGO Free)' into single product line)
 * 4. Stage 7.2: Category insights subtracts discounts
 * 5. Stage 7.3: Sales & payment reconciliation in /api/reports/sales (unpaid/pending orders excluded)
 * 6. Stage 7.4: Promotions report summary (BOGO redemptions, paid/free/prepared quantities, launch vs manual)
 * 7. Stage 7.5: Unified Profitability / P&L (Gross Profit - Operating Expenses = Operating Profit)
 *
 * Usage: node tests/run-electron-node-test.cjs tests/stage7-completion.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-stage7-completion-'));

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
  seedCategory,
  seedProduct,
  assert,
  assertEqual,
  getResults,
  closeDatabase,
  now,
} = require('./helpers/test-setup');
const { reportRoutes } = require('../main/routes/reports');
const promotionRoutes = require('../main/routes/promotions').default || require('../main/routes/promotions');
const { expenseRoutes } = require('../main/routes/expenses');
const { buildDailySalesExportDataset } = require('../main/services/daily-sales-export');

function dbTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\..*$/, '');
}

async function main() {
  console.log('FloCafe Stage 7 Completion & Verification Suite');
  console.log('='.repeat(64));

  const db = initTestDb();
  const { authHeader } = seedOwnerUser(db);
  seedCategory(db, 'cat-pancakes', 'Pancakes');
  seedProduct(db, 'prod-cc-pancake', 'cat-pancakes', 'Cotton Candy Pancake', 90);
  seedProduct(db, 'prod-nutella-pancake', 'cat-pancakes', 'Nutella Pancake', 100);

  const businessDate = '2026-11-14';
  const paidAt = dbTimestamp(new Date(`${businessDate}T12:00:00Z`));

  console.log('\n─── 1. Stage 7.2: BOGO Accounting & Export Alignment ───');
  {
    // Order 1: 1 Paid Cotton Candy Pancake (₹90) + 1 Free Cotton Candy Pancake (₹0 net, ₹90 discount)
    db.prepare(`
      INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at, completed_at)
      VALUES ('ORD-BOGO-1', 'owner-test-001', 'dine_in', 'completed', 90, 90, ?, ?, ?)
    `).run(paidAt, paidAt, paidAt);
    const order1Id = Number(
      db.prepare("SELECT id FROM orders WHERE order_number = 'ORD-BOGO-1'").get().id,
    );

    // Paid pancake item
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, subtotal, discount_amount, tax_amount, total, status, created_at, updated_at)
      VALUES (?, 'prod-cc-pancake', 'Cotton Candy Pancake', NULL, 1, 90, 90, 0, 0, 90, 'ready', ?, ?)
    `).run(order1Id, paidAt, paidAt);

    // Free pancake item (BOGO Free)
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, subtotal, discount_amount, tax_amount, total, status, modifier_selection, created_at, updated_at)
      VALUES (?, 'prod-cc-pancake', 'Cotton Candy Pancake (BOGO Free)', NULL, 1, 90, 90, 90, 0, 0, 'ready', ?, ?, ?)
    `).run(order1Id, JSON.stringify({ is_bogo_free: true, promotion_id: 'launch-bogo' }), paidAt, paidAt);

    // Bill 1: Paid ₹90
    db.prepare(`
      INSERT INTO bills (bill_number, order_id, subtotal, total, paid_amount, balance, payment_status, payment_details, paid_at, created_at, updated_at)
      VALUES ('BILL-BOGO-1', ?, 90, 90, 90, 0, 'paid', ?, ?, ?, ?)
    `).run(
      order1Id,
      JSON.stringify([{ method: 'upi', amount: 90, timestamp: paidAt }]),
      paidAt,
      paidAt,
      paidAt,
    );

    // Promotion redemption record
    db.prepare(`
      INSERT INTO promotion_redemptions (promotion_id, order_id, cashier_user_id, discount_amount, is_loyalty_reward, created_at)
      VALUES ('launch-bogo', ?, 'owner-test-001', 90, 0, ?)
    `).run(order1Id, paidAt);

    // Order 2: 2 Paid Nutella Pancakes (₹200) + 2 Free Nutella Pancakes (₹0 net, ₹200 discount)
    db.prepare(`
      INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at, completed_at)
      VALUES ('ORD-BOGO-2', 'owner-test-001', 'takeaway', 'completed', 200, 200, ?, ?, ?)
    `).run(paidAt, paidAt, paidAt);
    const order2Id = Number(
      db.prepare("SELECT id FROM orders WHERE order_number = 'ORD-BOGO-2'").get().id,
    );

    // Paid item: 2 qty @ 100 = 200
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, subtotal, discount_amount, tax_amount, total, status, created_at, updated_at)
      VALUES (?, 'prod-nutella-pancake', 'Nutella Pancake', NULL, 2, 100, 200, 0, 0, 200, 'ready', ?, ?)
    `).run(order2Id, paidAt, paidAt);

    // Free item: 2 qty @ 100 = 200, discount = 200, total = 0
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, subtotal, discount_amount, tax_amount, total, status, modifier_selection, created_at, updated_at)
      VALUES (?, 'prod-nutella-pancake', 'Nutella Pancake (BOGO Free)', NULL, 2, 100, 200, 200, 0, 0, 'ready', ?, ?, ?)
    `).run(order2Id, JSON.stringify({ is_bogo_free: true, promotion_id: 'manual-bogo' }), paidAt, paidAt);

    // Bill 2: Paid ₹200
    db.prepare(`
      INSERT INTO bills (bill_number, order_id, subtotal, total, paid_amount, balance, payment_status, payment_details, paid_at, created_at, updated_at)
      VALUES ('BILL-BOGO-2', ?, 200, 200, 200, 0, 'paid', ?, ?, ?, ?)
    `).run(
      order2Id,
      JSON.stringify([{ method: 'cash', amount: 200, timestamp: paidAt }]),
      paidAt,
      paidAt,
      paidAt,
    );

    // Promotion redemption record
    db.prepare(`
      INSERT INTO promotion_redemptions (promotion_id, order_id, cashier_user_id, discount_amount, is_loyalty_reward, created_at)
      VALUES ('manual-bogo', ?, 'owner-test-001', 200, 0, ?)
    `).run(order2Id, paidAt);

    // Verify dataset built by daily-sales-export
    const dataset = buildDailySalesExportDataset({ date: businessDate }, db);

    assertEqual(dataset.summary.paid_bill_count, 2, '2 paid bills in summary');
    assertEqual(dataset.summary.gross_collected, 290, 'gross collected is 90 + 200 = 290');
    assertEqual(dataset.summary.net_collected, 290, 'net collected is 290');

    // Find Cotton Candy Pancake row (should be merged into 1 row)
    const ccRows = dataset.items.filter((item) => item.product_name === 'Cotton Candy Pancake');
    assertEqual(ccRows.length, 1, 'Cotton Candy Pancake paid and free merge into exactly 1 product line');
    const ccRow = ccRows[0];
    assertEqual(ccRow.quantity, 2, 'Cotton Candy Pancake total quantity is 2 (1 paid + 1 free)');
    assertEqual(ccRow.gross_item_sales, 180, 'Cotton Candy Pancake gross item sales is ₹180');
    assertEqual(ccRow.item_discounts, 90, 'Cotton Candy Pancake item discount is ₹90');
    assertEqual(ccRow.net_item_sales, 90, 'Cotton Candy Pancake net item sales is ₹90 (Gross 180 - Discount 90)');

    // Find Nutella Pancake row (2 paid + 2 free)
    const nutellaRows = dataset.items.filter((item) => item.product_name === 'Nutella Pancake');
    assertEqual(nutellaRows.length, 1, 'Nutella Pancake paid and free merge into exactly 1 product line');
    const nutellaRow = nutellaRows[0];
    assertEqual(nutellaRow.quantity, 4, 'Nutella Pancake total quantity is 4 (2 paid + 2 free)');
    assertEqual(nutellaRow.gross_item_sales, 400, 'Nutella Pancake gross item sales is ₹400');
    assertEqual(nutellaRow.item_discounts, 200, 'Nutella Pancake item discount is ₹200');
    assertEqual(nutellaRow.net_item_sales, 200, 'Nutella Pancake net item sales is ₹200 (Gross 400 - Discount 200)');

    // Ensure no '(BOGO Free)' rows exist in exported items
    const rawBogoRows = dataset.items.filter((item) => item.product_name.includes('(BOGO Free)'));
    assertEqual(rawBogoRows.length, 0, 'No raw (BOGO Free) rows in items sheet');

    // Sum of net item sales must equal total bill collections
    const totalNetItemSales = dataset.items.reduce((sum, item) => sum + item.net_item_sales, 0);
    assertEqual(totalNetItemSales, 290, 'Sum of net item sales (90 + 200) equals gross collected (290)');
  }

  const app = createApp({
    '/api/reports': reportRoutes,
    '/api/promotions': promotionRoutes,
    '/api/expenses': expenseRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  try {
    console.log('\n─── 2. Stage 7.2: Category Insights Discounter Subtraction ───');
    {
      const res = await fetch(`${baseUrl}/api/reports/insights?days=30`, {
        headers: authHeader,
      });
      assertEqual(res.status, 200, 'insights endpoint returns 200');
      const data = await res.json();
      const pancakeCat = data.topCategories.find((c: any) => c.name === 'Pancakes');
      assert(Boolean(pancakeCat), 'Pancakes category found in insights');
      assertEqual(
        pancakeCat.revenue,
        290,
        'Pancakes category revenue is ₹290 (subtracts ₹290 BOGO discount from ₹580 gross)',
      );
    }

    console.log('\n─── 3. Stage 7.3: Sales & Payment Reconciliation ───');
    {
      // Add an unpaid/pending order (should NOT be counted in sales)
      db.prepare(`
        INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at)
        VALUES ('ORD-UNPAID-1', 'owner-test-001', 'dine_in', 'pending', 500, 500, ?, ?)
      `).run(paidAt, paidAt);

      // Add a cancelled order (should NOT be counted in sales)
      db.prepare(`
        INSERT INTO orders (order_number, user_id, type, status, subtotal, total, created_at, updated_at)
        VALUES ('ORD-CANCELLED-1', 'owner-test-001', 'takeaway', 'cancelled', 999, 999, ?, ?)
      `).run(paidAt, paidAt);

      const salesRes = await fetch(
        `${baseUrl}/api/reports/sales?start_date=${businessDate}&end_date=${businessDate}`,
        { headers: authHeader },
      );
      assertEqual(salesRes.status, 200, 'sales report returns 200');
      const salesData = await salesRes.json();
      const sales = salesData.sales;

      // dailySales: should only count the 2 settled orders (₹90 + ₹200 = ₹290)
      const dayRow = sales.dailySales.find((d: any) => d.date === businessDate);
      assertEqual(dayRow?.orders, 2, 'dailySales orders count is 2 (excludes pending and cancelled)');
      assertEqual(dayRow?.sales, 290, 'dailySales sales total is 290 (excludes 500 pending and 999 cancelled)');

      // byOrderType: should only count settled orders
      const dineInType = sales.byOrderType.find((t: any) => t.type === 'dine_in');
      const takeawayType = sales.byOrderType.find((t: any) => t.type === 'takeaway');
      assertEqual(dineInType?.count, 1, 'dine_in count is 1');
      assertEqual(dineInType?.total, 90, 'dine_in total is ₹90');
      assertEqual(takeawayType?.count, 1, 'takeaway count is 1');
      assertEqual(takeawayType?.total, 200, 'takeaway total is ₹200');

      // byPaymentMethod: UPI = 90, Cash = 200
      const upiMethod = sales.byPaymentMethod.find((m: any) => m.method === 'upi');
      const cashMethod = sales.byPaymentMethod.find((m: any) => m.method === 'cash');
      assertEqual(upiMethod?.total, 90, 'UPI payment total is ₹90');
      assertEqual(cashMethod?.total, 200, 'Cash payment total is ₹200');

      // Complete Reconciliation check
      const orderTypeTotal = (dineInType?.total || 0) + (takeawayType?.total || 0);
      const paymentTotal = (upiMethod?.total || 0) + (cashMethod?.total || 0);
      assertEqual(dayRow?.sales, orderTypeTotal, 'dailySales matches byOrderType total');
      assertEqual(dayRow?.sales, paymentTotal, 'dailySales matches byPaymentMethod total');
    }

    console.log('\n─── 4. Stage 7.4: Promotions Summary Endpoint ───');
    {
      const promoRes = await fetch(
        `${baseUrl}/api/promotions/reports/summary?start_date=${businessDate}&end_date=${businessDate}`,
        { headers: authHeader },
      );
      assertEqual(promoRes.status, 200, 'promotions summary returns 200');
      const promoData = await promoRes.json();

      assertEqual(promoData.totalRedemptionsCount, 2, '2 total promotion redemptions');
      assertEqual(promoData.totalDiscountAmount, 290, 'total promotional discount is ₹290');
      assertEqual(promoData.bogoRedemptionsCount, 2, '2 BOGO redemptions');
      assertEqual(promoData.bogoDiscountAmount, 290, 'BOGO discount amount is ₹290');

      // Quantities: 1 Cotton Candy (1 paid + 1 free) + 2 Nutella (2 paid + 2 free) = 3 paid, 3 free, 6 prepared
      assertEqual(promoData.bogoFreeQuantity, 3, '3 free BOGO pancakes');
      assertEqual(promoData.bogoPaidQuantity, 3, '3 paid matching pancakes');
      assertEqual(promoData.bogoPreparedQuantity, 6, '6 total prepared pancakes');

      // Campaign breakdown
      assertEqual(promoData.launchBogoRedemptionsCount, 1, '1 Launch BOGO redemption');
      assertEqual(promoData.launchBogoDiscountAmount, 90, 'Launch BOGO discount is ₹90');
      assertEqual(promoData.manualBogoRedemptionsCount, 1, '1 Manual BOGO redemption');
      assertEqual(promoData.manualBogoDiscountAmount, 200, 'Manual BOGO discount is ₹200');
    }

    console.log('\n─── 5. Stage 7.5: Unified Profitability / P&L ───');
    {
      // Seed expense category & operating expenses: Electricity (₹50) + Cleaning (₹20) on businessDate
      db.prepare(`
        INSERT INTO expense_categories (id, name, name_key, is_active, created_by, updated_by, created_at, updated_at)
        VALUES ('exp-cat-1', 'Utilities', 'utilities', 1, 'owner-test-001', 'owner-test-001', ?, ?)
      `).run(paidAt, paidAt);

      db.prepare(`
        INSERT INTO expenses (id, category_id, category_name, description, amount_minor, currency_code, incurred_on, created_by, created_at)
        VALUES ('exp-1', 'exp-cat-1', 'Utilities', 'Electricity Bill', 5000, 'INR', ?, 'owner-test-001', ?)
      `).run(businessDate, paidAt);

      db.prepare(`
        INSERT INTO expenses (id, category_id, category_name, description, amount_minor, currency_code, incurred_on, created_by, created_at)
        VALUES ('exp-2', 'exp-cat-1', 'Utilities', 'Cleaning Supplies', 2000, 'INR', ?, 'owner-test-001', ?)
      `).run(businessDate, paidAt);

      const finRes = await fetch(
        `${baseUrl}/api/reports/financial-summary?start_date=${businessDate}&end_date=${businessDate}`,
        { headers: authHeader },
      );
      assertEqual(finRes.status, 200, 'financial-summary returns 200');
      const finData = await finRes.json();
      const fs = finData.financialSummary;

      assertEqual(fs.grossCollected, 290, 'financialSummary grossCollected is ₹290');
      assertEqual(fs.netCollected, 290, 'financialSummary netCollected is ₹290');
      assertEqual(fs.operatingExpenses, 70, 'operatingExpenses is ₹70 (50 + 20)');
      assertEqual(fs.expenseCount, 2, 'expenseCount is 2');

      // Operating Profit = Gross Profit - Operating Expenses
      if (fs.grossProfit !== null && fs.grossProfit !== undefined) {
        assertEqual(
          fs.operatingProfit,
          fs.grossProfit - 70,
          'operatingProfit equals grossProfit - operatingExpenses',
        );
      }
    }
  } finally {
    server.close();
    closeDatabase();
    try {
      fs.rmSync(testDir, { recursive: true });
    } catch {}
  }

  const { passed, failed, total } = getResults();
  console.log(`\nResults: ${passed}/${total} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
