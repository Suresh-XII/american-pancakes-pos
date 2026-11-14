# FloCafe — Stage 7.1: Delivery Sandbox Order Isolation Implementation Report

**Date:** 14 November 2026  
**Target Application:** FloCafe American Pancakes POS System (Desktop & Express Backend)  
**Deliverable Scope:** Stage 7.1 Analytics & Reporting — Delivery Sandbox Order Isolation  
**Identifying Database Column:** `delivery_order_tracking.is_simulated = 1`  
**Test Suite:** `tests/stage7-1-delivery-sandbox-isolation.test.ts` (112 test assertions, 100% passed)  

---

## 1. Executive Summary

During the Stage 7 Analytics & Reporting audit, it was identified that simulated delivery orders generated through the Stage 6A delivery sandbox (`is_simulated = 1`) were aggregated into actual business reporting, financial dashboards, export datasets, and cash drawer reconciliations.

Sandbox orders exist solely for testing third-party delivery provider APIs (Zomato, Swiggy, etc.), menu item mappings, webhook retries, and status synchronization. They represent test simulations and must never affect the actual financial health, daily sales totals, tax obligations, top product metrics, or physical cash drawer reconciliation of the FloCafe shop.

**Stage 7.1 accomplishes complete isolation of simulated delivery orders across the FloCafe application:**
- **Zero Financial Leakage:** Simulated orders contribute ₹0 to sales, revenue, bill counts, tax aggregations, recent order feeds, top product counts, daily sales exports, and X/Z drawer cash reconciliations.
- **Genuine Orders Preserved:** Genuine delivery orders (`is_simulated = 0`) and all in-store orders (dine-in, takeaway) remain 100% accounted for and accurately reported.
- **Sandbox Operational Continuity:** Operational sandbox testing routes (`/api/delivery/sandbox/*`) continue to ingest, track, and update simulated orders normally without interruption.
- **Strict Backward Compatibility:** All prior working tree changes—including the 8 BOGO checkout regression fix files and the Phase 2 Cash + UPI payment method modifications—remain intact.

---

## 2. Root Cause Analysis

In Stage 6A, the `delivery_order_tracking` table was introduced with the column:
```sql
is_simulated INTEGER NOT NULL DEFAULT 0 CHECK (is_simulated IN (0, 1))
```
When simulated delivery orders were ingested via `/api/delivery/sandbox/simulate-order`, the system wrote records into `orders`, `order_items`, `bills`, and `delivery_order_tracking`.

However, the existing SQL queries across:
1. `main/routes/reports.ts` (`/daily-stats`, `/summary`, `/financial-summary`, `/tax-components`, `/sales`, `/topProducts`, `/recentOrders`, `/insights`)
2. `main/routes/cash-closures.ts` (`paymentMethodBreakdown`, `cashDrawerSalesAndRefunds`, `sessionFinancialTotals`, `computePeriodAggregates`, X-report, Z-report)
3. `main/services/daily-sales-export.ts` (`billAggStmt`, `rangeRefundsStmt`, `billsStmt`, `itemsStmt`, `paymentLinesStmt`)
4. `main/services/customer-sales-export.ts` (`lineRows`)
5. `main/services/daily-invoices-export.ts` (`countRow`, `rawBillRows`, `windowRefundRows`)
6. `main/services/item-price-override.ts` (`listPriceExceptions`)

queried `bills`, `orders`, and `order_items` purely by timestamps, `status != 'cancelled'`, or payment states without checking whether the underlying order was marked as `is_simulated = 1`. Consequently, a simulated ₹500 test delivery order inflated daily gross collections, appeared in top products, appeared in recent orders, distorted staff revenue, and skewed expected drawer cash.

---

## 3. Centralized SQL Exclusion Architecture

To avoid copy-paste errors and maintain consistency across all reporting modules, a centralized service was introduced at `main/services/sandbox-exclusion.ts`.

### 3.1 Index Utilization & Performance
The `delivery_order_tracking` schema in `main/db.ts` enforces:
```sql
internal_order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE
```
Because of the `UNIQUE` constraint, SQLite automatically creates a unique B-tree index (`sqlite_autoindex_delivery_order_tracking_1`). Using a correlated `NOT EXISTS` query against `internal_order_id` ensures instantaneous indexed seeks ($O(1)$) without scanning the tracking table or modifying underlying schema migrations.

### 3.2 SQL Predicates

```typescript
/**
 * Excludes orders whose internal order id matches an is_simulated = 1 tracking record.
 */
export function deliverySandboxExclusionSql(orderIdExpr: string = 'o.id'): string {
  return `NOT EXISTS (
    SELECT 1
    FROM delivery_order_tracking d_sb
    WHERE d_sb.internal_order_id = ${orderIdExpr}
      AND d_sb.is_simulated = 1
  )`;
}

/**
 * Excludes refunds belonging to a simulated order's bill.
 */
export function refundSandboxExclusionSql(billIdExpr: string = 'r.bill_id'): string {
  return `NOT EXISTS (
    SELECT 1
    FROM bills b_sb
    JOIN delivery_order_tracking d_sb ON d_sb.internal_order_id = b_sb.order_id
    WHERE b_sb.id = ${billIdExpr}
      AND d_sb.is_simulated = 1
  )`;
}
```

---

## 4. Comprehensive File Changes & Query Coverage

### 4.1 `main/services/sandbox-exclusion.ts` (New File)
Created the single source of truth for delivery sandbox order isolation SQL predicates.

### 4.2 `main/routes/reports.ts` (Updated)
Applied `deliverySandboxExclusionSql` and `refundSandboxExclusionSql` across all reporting endpoints:
1. **`/daily-stats`:**
   - Excluded simulated orders from `salesToday` (bills and refunds subqueries).
   - Excluded simulated orders from `runningOrders` (`orders.id`).
   - Excluded simulated orders from `pendingOrders` (`orders.id`).
2. **`/summary`:**
   - Excluded simulated orders from `ordersToday` (`orders.id`).
   - Excluded simulated orders from `billsToday` (bills `b`, paid bills `b2`, refunds `r`/`b3`).
   - Excluded simulated orders from `ordersByStatus`.
3. **`/financial-summary`:**
   - Excluded simulated orders from `collections` (`bills.order_id`).
   - Excluded simulated orders from `refundTotals` (`b.order_id`).
   - Excluded simulated orders from `refunds` list (`o.id`).
   - Excluded simulated orders from `computeSettledProfitabilitySummary` (`o.id`).
4. **`/tax-components`:**
   - Excluded simulated orders from `bills` query (`o.id`).
5. **`/sales`:**
   - Excluded simulated orders from `dailyRows` (`orders.id`).
   - Excluded simulated orders from `byOrderType` breakdown (`orders.id`).
6. **`/topProducts`:**
   - Excluded simulated orders from `rawTopProducts` aggregation (`o.id`).
   - Excluded simulated orders from `computePeriodProfitabilitySummary` (`o.id`).
7. **`/recentOrders`:**
   - Added predicate to ensure simulated orders never appear in recent orders (whether queried with `date`, date range, or no params).
8. **`/insights`:**
   - Excluded simulated orders from `revenue` (both windowed and open-ended queries).
   - Excluded simulated orders from `prepTime` velocity calculations.
   - Excluded simulated orders from `topStaff` revenue and order counts.
   - Excluded simulated orders from `topCategories` revenue and quantities.
   - Excluded simulated orders from `orderTimestamps` (busiest/idlest hour/day bucketing).

### 4.3 `main/routes/cash-closures.ts` (Updated)
1. **`paymentMethodBreakdown`:**
   - Excluded simulated orders from `payment_lines` CTE (`b.order_id`).
   - Excluded simulated orders from `normalized` refunds CTE (`b.order_id`).
2. **`cashDrawerSalesAndRefunds`:**
   - Excluded simulated orders from `payment_lines` CTE (`b.order_id`).
   - Joined `bills` in `cash_refunds` CTE to exclude simulated order refunds (`b.order_id`).
3. **`sessionExpectedCash`:**
   - Excluded simulated orders from `payment_lines` CTE (`b.order_id`).
   - Joined `bills` in `cash_refunds` CTE to exclude simulated order refunds (`b.order_id`).
4. **`sessionFinancialTotals`:**
   - Excluded simulated orders from `payment_lines` CTE (`b.order_id`).
   - Joined `bills` in `owned_refunds` CTE to exclude simulated order refunds (`b.order_id`).
5. **`computePeriodAggregates` (X-Report and Z-Report Foundation):**
   - Excluded simulated orders from `billRow` (`b.order_id`).
   - Excluded simulated orders from `refundRow` (`b.order_id`).
   - Excluded simulated orders from `staffSalesRows` (both session and day queries).
   - Excluded simulated orders from `bills` tax aggregation (both session and day queries).

### 4.4 `main/services/daily-sales-export.ts` (Updated)
1. **`billAggStmt`:** Excluded simulated orders from gross sales, paid bill counts, order counts, service charges, packaging charges, and delivery charges.
2. **`rangeRefundsStmt`:** Joined `bills` to exclude refunds against simulated orders.
3. **`billsStmt`:** Excluded simulated bills from the Bills sheet.
4. **`itemsStmt`:** Excluded items belonging to simulated orders from the Items sheet and period summaries.
5. **`paymentLinesStmt`:** Excluded payment lines from simulated bills from the Payments sheet.

### 4.5 `main/services/customer-sales-export.ts` (Updated)
- **`lineRows`:** Excluded simulated orders from customer sales rows and PII exports.

### 4.6 `main/services/daily-invoices-export.ts` (Updated)
1. **`countRow`:** Excluded simulated bills from the pre-check invoice count query.
2. **`rawBillRows`:** Excluded simulated bills from invoice rendering.
3. **`windowRefundRows`:** Excluded refunds against simulated bills from prior bill refunds.

### 4.7 `main/services/item-price-override.ts` (Updated)
- **`listPriceExceptions`:** Excluded price overrides on simulated orders from the price exceptions report.

### 4.8 `package.json` (Updated)
- Added `"test:stage7-1-delivery-sandbox-isolation": "node tests/run-electron-node-test.cjs tests/stage7-1-delivery-sandbox-isolation.test.ts"`.
- Appended script to `test:ingredient-cost` in sequential pipeline, maintaining 100% test script reachability under `validate-test-script-coverage.cjs`.

---

## 5. Verification & Test Evidence

### 5.1 Dedicated Stage 7.1 Test Suite (`tests/stage7-1-delivery-sandbox-isolation.test.ts`)
A comprehensive, end-to-end integration test was authored covering all operational scenarios.

| Section | Scenario Tested | Result |
|---|---|---|
| **1** | Baseline Verification (Empty Store Day returns 0 across all reports) | **Passed** |
| **2** | Simulated Sandbox Order Isolation (`is_simulated = 1` ₹500 order yields ₹0 everywhere) | **Passed** |
| **3** | Genuine Delivery Order Inclusion (`is_simulated = 0` ₹300 order included 100%) | **Passed** |
| **4** | In-Store Dine-In Order Inclusion (Mixed basket: ₹300 genuine + ₹200 dine-in = ₹500, sim ₹500 ignored) | **Passed** |
| **5** | Refund on Simulated Order Isolation (Cash refund on sim bill does NOT deduct from real sales/drawer) | **Passed** |
| **6** | Operational Delivery Sandbox Endpoints Unaffected (`/api/delivery/*` still accesses tracking data) | **Passed** |
| **7** | Day Closure (Z-Report) Persisted Snapshot Isolation (`cash_closures` records ₹500, not ₹1000) | **Passed** |
| **Total** | **112 assertions executed** | **112 / 112 Passed (0 Failed)** |

### 5.2 Targeted Integration Test Passes
All related integration test suites were executed with zero failures:
- `tests/stage7-1-delivery-sandbox-isolation.test.ts`: **112/112 passed**
- `tests/delivery-platform-stage6a.test.ts`: **All tests passed**
- `tests/discounts-promotions-stage6-bogo.test.ts`: **All tests passed**
- `tests/cash-closures.test.ts`: **370/370 passed**
- `tests/reports-insights.test.ts`: **60/60 passed**
- `tests/daily-sales-export.test.ts`: **252/252 passed**
- `tests/reports-export.test.ts`: **Passed (including real Electron printToPDF)**
- `npm run lint:budget`: **Passed (1010/1010 backend warnings, 0/5 frontend warnings)**
- `npm run build`: **Passed (clean build, 0 errors)**

---

## 6. Confirmation of System Invariants

1. **Simulated Orders:** Fully visible and mutable in delivery sandbox operational views (`/api/delivery/sandbox/*`), but completely invisible to shop reporting, analytics, accounting, and cashier drawer counts.
2. **Genuine Delivery Orders:** Fully recorded and reported across revenue, tax, payment methods, delivery slips, daily sales exports, and X/Z closures.
3. **In-Store Orders:** Dine-in and takeaway orders remain completely unaffected.
4. **BOGO Rules:** Unaltered; buy-1-get-1-free items continue to auto-populate and calculate correct gross and net amounts.
5. **Payment Methods:** Cash and UPI persist as the selectable POS payment options; historical card data is preserved.
6. **No Production Database Overwrites:** Development was completed using clean temporary database fixtures without resetting or wiping user databases.

---

## 7. Status & Next Steps

Stage 7.1 Delivery Sandbox Order Isolation is **complete and verified**.
The application is ready for operator review. Per the original requirements, Stage 7.2 (Sales Analytics & Performance Reporting) and cloud/mobile development will not commence until explicit user confirmation is received.
