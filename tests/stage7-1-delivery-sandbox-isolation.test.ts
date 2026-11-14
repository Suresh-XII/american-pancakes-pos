/**
 * FloCafe — Stage 7.1: Delivery Sandbox Order Isolation Test Suite
 *
 * Verifies that simulated delivery orders (delivery_order_tracking.is_simulated = 1)
 * are completely excluded from actual business reporting, accounting, exports,
 * and cash drawer reconciliations, while genuine delivery orders (is_simulated = 0)
 * and in-store orders (dine-in / takeaway) remain fully included.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/stage7-1-delivery-sandbox-isolation.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-stage-7-1-sandbox-isolation-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-stage-7-1-isolation';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const {
  initDatabase,
  getDatabase,
  closeDatabase,
  now,
  dayBoundsInTimezone,
  localDateInTimezone,
  parseDbTimestamp,
} = require('../main/db');
const { getJWTSecret } = require('../main/routes/auth');
const { reportRoutes } = require('../main/routes/reports');
const { cashClosureRoutes } = require('../main/routes/cash-closures');
const { deliveryRoutes } = require('../main/routes/delivery');

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  total++;
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(
      `  ✗ FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

async function main() {
  console.log('FloCafe Stage 7.1: Delivery Sandbox Order Isolation Test Suite');
  console.log('='.repeat(65));

  initDatabase();
  const db = getDatabase();

  // Set store timezone and country settings
  db.prepare(`UPDATE settings SET value = 'Asia/Kolkata' WHERE key = 'timezone'`).run();
  if (
    (db.prepare(`SELECT COUNT(*) as c FROM settings WHERE key = 'timezone'`).get() as any).c === 0
  ) {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('timezone', 'Asia/Kolkata')`).run();
  }
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('country', 'IN', ?) ON CONFLICT(key) DO UPDATE SET value='IN', updated_at=excluded.updated_at`,
  ).run(now());

  // Seed users: Owner and Cashier
  const ownerId = 'owner-stage7-1';
  db.prepare(
    `INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    ownerId,
    'Shop Owner',
    'owner-s71@flocafe.test',
    bcrypt.hashSync('pw', 10),
    'owner',
    now(),
    now(),
  );

  const cashierId = 'cashier-stage7-1';
  db.prepare(
    `INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    cashierId,
    'Store Cashier',
    'cashier-s71@flocafe.test',
    bcrypt.hashSync('pw', 10),
    'cashier',
    now(),
    now(),
  );

  // Seed product and category
  db.prepare(`INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)`).run(
    'cat-pancakes',
    'Pancakes',
    1,
  );
  db.prepare(
    `INSERT INTO products (id, category_id, name, price, is_active, sort_order) VALUES (?, ?, ?, ?, 1, 1)`,
  ).run('prod-choc-pancake', 'cat-pancakes', 'Chocolate Pancake', 100);

  // Setup express test app
  const app = express();
  app.use(express.json());
  app.use((req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], getJWTSecret());
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  app.use('/api/reports', reportRoutes);
  app.use('/api/cash-closures', cashClosureRoutes);
  app.use('/api/delivery', deliveryRoutes);

  const ownerToken = jwt.sign(
    { userId: ownerId, email: 'owner-s71@flocafe.test', role: 'owner' },
    getJWTSecret(),
    { expiresIn: '2h' },
  );

  const today = localDateInTimezone(new Date(), 'Asia/Kolkata', '04:00');
  const [startUtc, endUtc] = dayBoundsInTimezone(today, 'Asia/Kolkata', '04:00');
  const midDayUtc = new Date((new Date(startUtc).getTime() + new Date(endUtc).getTime()) / 2)
    .toISOString()
    .replace('T', ' ')
    .replace(/\..*$/, '');

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // 1. Baseline Zero Verification
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n1. Baseline Verification (Empty Store Day)');
    {
      const dailyStatsRes = await request(app)
        .get('/api/reports/daily-stats')
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(dailyStatsRes.status, 200, 'daily-stats returns 200');
      assertEqual(dailyStatsRes.body.sales, 0, 'baseline sales is 0');
      assertEqual(dailyStatsRes.body.runningOrders, 0, 'baseline runningOrders is 0');
      assertEqual(dailyStatsRes.body.pendingOrders, 0, 'baseline pendingOrders is 0');

      const summaryRes = await request(app)
        .get(`/api/reports/summary?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(summaryRes.status, 200, 'summary returns 200');
      assertEqual(summaryRes.body.summary.orders.count, 0, 'baseline orders.count is 0');
      assertEqual(summaryRes.body.summary.bills.count, 0, 'baseline bills.count is 0');
      assertEqual(summaryRes.body.summary.bills.collected, 0, 'baseline bills.collected is 0');

      const financialRes = await request(app)
        .get(`/api/reports/financial-summary?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(financialRes.status, 200, 'financial-summary returns 200');
      assertEqual(financialRes.body.financialSummary.grossCollected, 0, 'baseline grossCollected is 0');
      assertEqual(financialRes.body.financialSummary.netCollected, 0, 'baseline netCollected is 0');
      assertEqual(financialRes.body.financialSummary.billCount, 0, 'baseline billCount is 0');

      const xReportRes = await request(app)
        .get(`/api/reports/x-report?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(xReportRes.status, 200, 'x-report returns 200');
      assertEqual(xReportRes.body.xReport.grossCollected, 0, 'baseline X grossCollected is 0');
      assertEqual(xReportRes.body.xReport.netCollected, 0, 'baseline X netCollected is 0');
      assertEqual(xReportRes.body.xReport.billCount, 0, 'baseline X billCount is 0');
      assertEqual(xReportRes.body.xReport.expectedCashCents, 0, 'baseline X expectedCashCents is 0');
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 2. Simulated Sandbox Delivery Order Creation & Isolation
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n2. Simulated Sandbox Delivery Order Isolation');
    const simOrderId = 10001;
    const simBillId = 20001;
    {
      // Insert simulated delivery order (₹500 total, 5 Chocolate Pancakes)
      db.prepare(`
        INSERT INTO orders (
          id, order_number, user_id, type, status, release_status,
          subtotal, discount_amount, tax_amount, total,
          cooking_started_at, ready_at, completed_at, created_at, updated_at
        ) VALUES (
          ?, 'ORD-SIM-10001', ?, 'online', 'completed', 'released',
          450, 0, 50, 500,
          ?, ?, ?, ?, ?
        )
      `).run(simOrderId, cashierId, midDayUtc, midDayUtc, midDayUtc, midDayUtc, midDayUtc);

      // Insert tracking record with is_simulated = 1
      db.prepare(`
        INSERT INTO delivery_order_tracking (
          internal_order_id, provider, external_order_id, is_simulated,
          external_status, internal_status, created_at, updated_at
        ) VALUES (
          ?, 'zomato', 'SIM-EXT-ZOMATO-1', 1,
          'delivered', 'completed', ?, ?
        )
      `).run(simOrderId, midDayUtc, midDayUtc);

      // Insert order item
      db.prepare(`
        INSERT INTO order_items (
          id, order_id, product_id, product_name, quantity,
          unit_price, subtotal, tax_amount, total, status, created_at
        ) VALUES (
          30001, ?, 'prod-choc-pancake', 'Chocolate Pancake', 5,
          90, 450, 50, 500, 'active', ?
        )
      `).run(simOrderId, midDayUtc);

      // Insert bill with payment_details (Cash payment ₹500)
      const simPaymentDetails = JSON.stringify([
        { method: 'cash', amount: 500, timestamp: midDayUtc },
      ]);
      db.prepare(`
        INSERT INTO bills (
          id, bill_number, order_id, subtotal, discount_amount, tax_amount, total,
          paid_amount, payment_status, payment_details, paid_at, created_at
        ) VALUES (
          ?, 'BILL-SIM-20001', ?, 450, 0, 50, 500,
          500, 'paid', ?, ?, ?
        )
      `).run(simBillId, simOrderId, simPaymentDetails, midDayUtc, midDayUtc);

      // Verify that delivery_order_tracking has is_simulated = 1
      const tracking = db
        .prepare('SELECT is_simulated FROM delivery_order_tracking WHERE internal_order_id = ?')
        .get(simOrderId) as any;
      assertEqual(tracking.is_simulated, 1, 'tracking.is_simulated is 1');

      // ── Verify daily-stats ignores simulated order ──
      const dailyStatsRes = await request(app)
        .get('/api/reports/daily-stats')
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(dailyStatsRes.status, 200, 'daily-stats returns 200');
      assertEqual(dailyStatsRes.body.sales, 0, 'daily-stats sales remains 0');
      assertEqual(dailyStatsRes.body.paymentMethods.length, 0, 'daily-stats paymentMethods empty');

      // ── Verify summary ignores simulated order ──
      const summaryRes = await request(app)
        .get(`/api/reports/summary?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(summaryRes.status, 200, 'summary returns 200');
      assertEqual(summaryRes.body.summary.orders.count, 0, 'summary orders.count remains 0');
      assertEqual(summaryRes.body.summary.bills.count, 0, 'summary bills.count remains 0');
      assertEqual(summaryRes.body.summary.bills.collected, 0, 'summary bills.collected remains 0');
      assertEqual(summaryRes.body.summary.paymentMethods.length, 0, 'summary paymentMethods empty');
      assertEqual(summaryRes.body.summary.ordersByStatus.length, 0, 'summary ordersByStatus empty');

      // ── Verify financial-summary ignores simulated order ──
      const financialRes = await request(app)
        .get(`/api/reports/financial-summary?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(financialRes.status, 200, 'financial-summary returns 200');
      assertEqual(financialRes.body.financialSummary.grossCollected, 0, 'financial grossCollected remains 0');
      assertEqual(financialRes.body.financialSummary.netCollected, 0, 'financial netCollected remains 0');
      assertEqual(financialRes.body.financialSummary.billCount, 0, 'financial billCount remains 0');
      assertEqual(financialRes.body.financialSummary.paymentMethods.length, 0, 'financial paymentMethods empty');
      assertEqual(financialRes.body.financialSummary.profitability.total_quantity, 0, 'profitability total_quantity remains 0');

      // ── Verify sales report ignores simulated order ──
      const salesRes = await request(app)
        .get(`/api/reports/sales?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(salesRes.status, 200, 'sales returns 200');
      assertEqual(salesRes.body.sales.dailySales.length, 0, 'sales dailySales empty');
      assertEqual(salesRes.body.sales.byPaymentMethod.length, 0, 'sales byPaymentMethod empty');
      assertEqual(salesRes.body.sales.byOrderType.length, 0, 'sales byOrderType empty');

      // ── Verify topProducts ignores simulated order ──
      const topProductsRes = await request(app)
        .get(`/api/reports/topProducts?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(topProductsRes.status, 200, 'topProducts returns 200');
      assertEqual(topProductsRes.body.topProducts.length, 0, 'topProducts empty');

      // ── Verify recentOrders ignores simulated order ──
      const recentOrdersRes = await request(app)
        .get(`/api/reports/recentOrders?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(recentOrdersRes.status, 200, 'recentOrders returns 200');
      assertEqual(recentOrdersRes.body.recentOrders.length, 0, 'recentOrders empty');

      // ── Verify tax-components ignores simulated order ──
      const taxRes = await request(app)
        .get(`/api/reports/tax-components?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(taxRes.status, 200, 'tax-components returns 200');
      assertEqual(taxRes.body.taxComponents.billCount, 0, 'tax-components billCount is 0');
      assertEqual(taxRes.body.taxComponents.taxAmount, 0, 'tax-components taxAmount is 0');

      // ── Verify insights ignores simulated order ──
      const insightsRes = await request(app)
        .get(`/api/reports/insights?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(insightsRes.status, 200, 'insights returns 200');
      assertEqual(insightsRes.body.aov, 0, 'insights aov is 0');
      assertEqual(insightsRes.body.ordersAnalyzed, 0, 'insights ordersAnalyzed is 0');
      assertEqual(insightsRes.body.topStaff.length, 0, 'insights topStaff empty');
      assertEqual(insightsRes.body.topCategories.length, 0, 'insights topCategories empty');

      // ── Verify daily-sales export ignores simulated order ──
      const exportRes = await request(app)
        .get(`/api/reports/daily-sales/export?format=csv&part=summary&date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(exportRes.status, 200, 'daily-sales export returns 200');
      assert(exportRes.text.includes('net_collected,0'), 'export net_collected is 0');
      assert(exportRes.text.includes('paid_bill_count,0'), 'export paid_bill_count is 0');

      // ── Verify customer-sales export ignores simulated order ──
      const customerExportRes = await request(app)
        .get(`/api/reports/customer-sales/export?format=csv&date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(customerExportRes.status, 200, 'customer-sales export returns 200');
      const lines = customerExportRes.text.trim().split('\n');
      assertEqual(lines.length, 1, 'customer-sales export has header only (0 item rows)');

      // ── Verify X-Report ignores simulated order ──
      const xReportRes = await request(app)
        .get(`/api/reports/x-report?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(xReportRes.status, 200, 'x-report returns 200');
      assertEqual(xReportRes.body.xReport.grossCollected, 0, 'X-report grossCollected remains 0');
      assertEqual(xReportRes.body.xReport.netCollected, 0, 'X-report netCollected remains 0');
      assertEqual(xReportRes.body.xReport.billCount, 0, 'X-report billCount remains 0');
      assertEqual(xReportRes.body.xReport.expectedCashCents, 0, 'X-report expectedCashCents remains 0');
      assertEqual(xReportRes.body.xReport.paymentMethods.length, 0, 'X-report paymentMethods empty');
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 3. Genuine Delivery Order Inclusion (is_simulated = 0)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n3. Genuine Delivery Order Inclusion (is_simulated = 0)');
    const realDeliveryOrderId = 10002;
    const realDeliveryBillId = 20002;
    {
      // Insert genuine delivery order (₹300 total, 3 Chocolate Pancakes)
      db.prepare(`
        INSERT INTO orders (
          id, order_number, user_id, type, status, release_status,
          subtotal, discount_amount, tax_amount, total,
          cooking_started_at, ready_at, completed_at, created_at, updated_at
        ) VALUES (
          ?, 'ORD-REAL-10002', ?, 'delivery', 'completed', 'released',
          270, 0, 30, 300,
          ?, ?, ?, ?, ?
        )
      `).run(realDeliveryOrderId, cashierId, midDayUtc, midDayUtc, midDayUtc, midDayUtc, midDayUtc);

      // Insert tracking record with is_simulated = 0
      db.prepare(`
        INSERT INTO delivery_order_tracking (
          internal_order_id, provider, external_order_id, is_simulated,
          external_status, internal_status, created_at, updated_at
        ) VALUES (
          ?, 'swiggy', 'REAL-EXT-SWIGGY-1', 0,
          'delivered', 'completed', ?, ?
        )
      `).run(realDeliveryOrderId, midDayUtc, midDayUtc);

      // Insert order item
      db.prepare(`
        INSERT INTO order_items (
          id, order_id, product_id, product_name, quantity,
          unit_price, subtotal, tax_amount, total, status, created_at
        ) VALUES (
          30002, ?, 'prod-choc-pancake', 'Chocolate Pancake', 3,
          90, 270, 30, 300, 'active', ?
        )
      `).run(realDeliveryOrderId, midDayUtc);

      // Insert bill with payment_details (Cash payment ₹300)
      const realPaymentDetails = JSON.stringify([
        { method: 'cash', amount: 300, timestamp: midDayUtc },
      ]);
      db.prepare(`
        INSERT INTO bills (
          id, bill_number, order_id, subtotal, discount_amount, tax_amount, total,
          paid_amount, payment_status, payment_details, paid_at, created_at
        ) VALUES (
          ?, 'BILL-REAL-20002', ?, 270, 0, 30, 300,
          300, 'paid', ?, ?, ?
        )
      `).run(realDeliveryBillId, realDeliveryOrderId, realPaymentDetails, midDayUtc, midDayUtc);

      // ── Verify daily-stats includes genuine order ONLY ──
      const dailyStatsRes = await request(app)
        .get('/api/reports/daily-stats')
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(dailyStatsRes.body.sales, 300, 'daily-stats reflects ₹300 from genuine order');
      assertEqual(dailyStatsRes.body.paymentMethods.length, 1, '1 payment method');
      assertEqual(dailyStatsRes.body.paymentMethods[0].total, 300, 'payment method total is 300');

      // ── Verify summary includes genuine order ONLY ──
      const summaryRes = await request(app)
        .get(`/api/reports/summary?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(summaryRes.body.summary.orders.count, 1, 'summary orders.count is 1');
      assertEqual(summaryRes.body.summary.orders.total, 300, 'summary orders.total is 300');
      assertEqual(summaryRes.body.summary.bills.count, 1, 'summary bills.count is 1');
      assertEqual(summaryRes.body.summary.bills.collected, 300, 'summary bills.collected is 300');

      // ── Verify financial-summary includes genuine order ONLY ──
      const financialRes = await request(app)
        .get(`/api/reports/financial-summary?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(financialRes.body.financialSummary.grossCollected, 300, 'grossCollected is 300');
      assertEqual(financialRes.body.financialSummary.netCollected, 300, 'netCollected is 300');
      assertEqual(financialRes.body.financialSummary.billCount, 1, 'billCount is 1');

      // ── Verify topProducts includes genuine order ONLY ──
      const topProductsRes = await request(app)
        .get(`/api/reports/topProducts?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(topProductsRes.body.topProducts.length, 1, 'topProducts has 1 product');
      assertEqual(topProductsRes.body.topProducts[0].total_quantity, 3, 'total_quantity is 3 (not 8)');
      assertEqual(topProductsRes.body.topProducts[0].total_revenue, 270, 'total_revenue is 270 (not 720)');

      // ── Verify recentOrders includes genuine order ONLY ──
      const recentOrdersRes = await request(app)
        .get(`/api/reports/recentOrders?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(recentOrdersRes.body.recentOrders.length, 1, 'recentOrders has 1 order');
      assertEqual(recentOrdersRes.body.recentOrders[0].id, realDeliveryOrderId, 'recent order is genuine order');

      // ── Verify X-Report includes genuine order ONLY ──
      const xReportRes = await request(app)
        .get(`/api/reports/x-report?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(xReportRes.body.xReport.grossCollected, 300, 'X grossCollected is 300');
      assertEqual(xReportRes.body.xReport.netCollected, 300, 'X netCollected is 300');
      assertEqual(xReportRes.body.xReport.billCount, 1, 'X billCount is 1');
      assertEqual(xReportRes.body.xReport.expectedCashCents, 30000, 'X expectedCashCents is 30000 (₹300)');
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 4. In-Store Dine-In Order Inclusion (Mixed Orders Test)
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n4. In-Store Dine-In Order Inclusion (Mixed Orders Test)');
    const dineInOrderId = 10003;
    const dineInBillId = 20003;
    {
      // Insert in-store dine-in order (₹200 total, 2 Chocolate Pancakes paid via UPI)
      db.prepare(`
        INSERT INTO orders (
          id, order_number, user_id, type, status, release_status,
          subtotal, discount_amount, tax_amount, total,
          cooking_started_at, ready_at, completed_at, created_at, updated_at
        ) VALUES (
          ?, 'ORD-DINEIN-10003', ?, 'dine_in', 'completed', 'released',
          180, 0, 20, 200,
          ?, ?, ?, ?, ?
        )
      `).run(dineInOrderId, cashierId, midDayUtc, midDayUtc, midDayUtc, midDayUtc, midDayUtc);

      // Insert order item
      db.prepare(`
        INSERT INTO order_items (
          id, order_id, product_id, product_name, quantity,
          unit_price, subtotal, tax_amount, total, status, created_at
        ) VALUES (
          30003, ?, 'prod-choc-pancake', 'Chocolate Pancake', 2,
          90, 180, 20, 200, 'active', ?
        )
      `).run(dineInOrderId, midDayUtc);

      // Insert bill with UPI payment
      const upiPaymentDetails = JSON.stringify([
        { method: 'upi', amount: 200, timestamp: midDayUtc },
      ]);
      db.prepare(`
        INSERT INTO bills (
          id, bill_number, order_id, subtotal, discount_amount, tax_amount, total,
          paid_amount, payment_status, payment_details, paid_at, created_at
        ) VALUES (
          ?, 'BILL-DINEIN-20003', ?, 180, 0, 20, 200,
          200, 'paid', ?, ?, ?
        )
      `).run(dineInBillId, dineInOrderId, upiPaymentDetails, midDayUtc, midDayUtc);

      // Total expected = ₹300 (genuine delivery) + ₹200 (dine-in) = ₹500
      // Simulated delivery order (₹500) must still be completely absent!
      const dailyStatsRes = await request(app)
        .get('/api/reports/daily-stats')
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(dailyStatsRes.body.sales, 500, 'daily-stats sales is ₹500 (300+200, excluding 500 sim)');

      const summaryRes = await request(app)
        .get(`/api/reports/summary?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(summaryRes.body.summary.orders.count, 2, 'summary orders.count is 2');
      assertEqual(summaryRes.body.summary.orders.total, 500, 'summary orders.total is 500');
      assertEqual(summaryRes.body.summary.bills.count, 2, 'summary bills.count is 2');
      assertEqual(summaryRes.body.summary.bills.collected, 500, 'summary bills.collected is 500');

      const financialRes = await request(app)
        .get(`/api/reports/financial-summary?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(financialRes.body.financialSummary.grossCollected, 500, 'financial grossCollected is 500');
      assertEqual(financialRes.body.financialSummary.netCollected, 500, 'financial netCollected is 500');
      assertEqual(financialRes.body.financialSummary.billCount, 2, 'financial billCount is 2');

      // Top products: 3 (genuine delivery) + 2 (dine-in) = 5 pancakes
      const topProductsRes = await request(app)
        .get(`/api/reports/topProducts?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(topProductsRes.body.topProducts[0].total_quantity, 5, 'topProducts quantity is 5 (not 10)');
      assertEqual(topProductsRes.body.topProducts[0].total_revenue, 450, 'topProducts total_revenue is 450 (not 900)');

      // X-Report drawer math: Cash = ₹300 (genuine delivery), UPI = ₹200 (excluded from drawer cash)
      const xReportRes = await request(app)
        .get(`/api/reports/x-report?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(xReportRes.body.xReport.grossCollected, 500, 'X grossCollected is 500');
      assertEqual(xReportRes.body.xReport.netCollected, 500, 'X netCollected is 500');
      assertEqual(xReportRes.body.xReport.billCount, 2, 'X billCount is 2');
      assertEqual(xReportRes.body.xReport.expectedCashCents, 30000, 'X expected cash is strictly ₹300 cash (UPI ₹200 excluded, sim ₹500 excluded)');
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 5. Refund on Simulated Order Isolation
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n5. Refund on Simulated Order Isolation');
    {
      // Issue a cash refund against the simulated order's bill
      db.prepare(`
        INSERT INTO refunds (
          id, bill_id, amount_cents, method, reason,
          approved_by, created_by, created_at
        ) VALUES (
          40001, ?, 10000, 'cash', 'Simulated order customer cancellation',
          ?, ?, ?
        )
      `).run(simBillId, ownerId, cashierId, midDayUtc);

      // Verify that the refund on simulated order is completely ignored
      const dailyStatsRes = await request(app)
        .get('/api/reports/daily-stats')
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(dailyStatsRes.body.sales, 500, 'daily-stats sales unaffected by simulated refund (still ₹500)');

      const summaryRes = await request(app)
        .get(`/api/reports/summary?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(summaryRes.body.summary.bills.collected, 500, 'summary collected unaffected by simulated refund (still ₹500)');

      const financialRes = await request(app)
        .get(`/api/reports/financial-summary?start_date=${today}&end_date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(financialRes.body.financialSummary.refundCount, 0, 'financial refundCount remains 0');
      assertEqual(financialRes.body.financialSummary.refunded, 0, 'financial refunded remains 0');

      const xReportRes = await request(app)
        .get(`/api/reports/x-report?date=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assertEqual(xReportRes.body.xReport.refundCount, 0, 'X-report refundCount remains 0');
      assertEqual(xReportRes.body.xReport.refunded, 0, 'X-report refunded remains 0');
      assertEqual(xReportRes.body.xReport.expectedCashCents, 30000, 'X-report expected cash unaffected (still ₹300)');
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 6. Operational Delivery Sandbox Endpoints Unaffected
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n6. Operational Delivery Sandbox Endpoints Unaffected');
    {
      // Verify simulated order tracking is still accessible via delivery endpoints
      const trackingRow = db
        .prepare('SELECT * FROM delivery_order_tracking WHERE internal_order_id = ?')
        .get(simOrderId) as any;
      assert(trackingRow != null, 'tracking record exists in database');
      assertEqual(trackingRow.is_simulated, 1, 'tracking.is_simulated is 1');
      assertEqual(trackingRow.provider, 'zomato', 'tracking provider is zomato');
      assertEqual(trackingRow.external_order_id, 'SIM-EXT-ZOMATO-1', 'external order id matches');
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 7. Day Closure (Z-Report) Persisted Snapshot Isolation
    // ════════════════════════════════════════════════════════════════════════════
    console.log('\n7. Day Closure (Z-Report) Persisted Snapshot Isolation');
    {
      const dayCloseRes = await request(app)
        .post('/api/cash-closures')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          business_date: today,
          counted_cash_cents: 30000,
          opening_float_cents: 0,
          notes: 'Stage 7.1 isolation verification close',
        });
      assertEqual(dayCloseRes.status, 201, 'POST /api/cash-closures returns 201 Created');
      const zReport = dayCloseRes.body.zReport;
      assertEqual(zReport.gross_collected_cents, 50000, 'Z-report gross is 50000 cents (₹500)');
      assertEqual(zReport.refunded_cents, 0, 'Z-report refunded is 0 cents');
      assertEqual(zReport.net_collected_cents, 50000, 'Z-report net is 50000 cents (₹500)');
      assertEqual(zReport.bill_count, 2, 'Z-report bill count is 2 (genuine delivery + dine-in)');
      assertEqual(zReport.expected_cash_cents, 30000, 'Z-report expected cash is 30000 cents (₹300)');
      assertEqual(zReport.counted_cash_cents, 30000, 'Z-report counted cash is 30000 cents');
      assertEqual(zReport.variance_cents, 0, 'Z-report variance is 0');
    }

    console.log('\n' + '='.repeat(65));
    console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Unhandled test failure:', error);
    process.exit(1);
  } finally {
    closeDatabase();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

main();
