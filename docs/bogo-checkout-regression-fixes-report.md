# FloCafe POS — Critical Regression Fixes After BOGO Checkout Changes

**Report Generated:** November 13, 2026  
**Repository Branch:** `master`  
**Application:** FloCafe Electron POS (American Pancakes)

---

## Executive Summary

Manual acceptance testing of the POS application after the initial BOGO changes revealed 4 critical regressions:
1. **ISSUE 1 — BOGO is displayed but the payment amount is not discounted:** In checkout, items displayed Cotton Candy Pancake × 1 (₹90) + Cotton Candy Pancake (BOGO Free) × 1 (FREE), but Subtotal and Total Due still requested ₹180 instead of ₹90.
2. **ISSUE 2 — BOGO free item is missing from Order History:** After settling the order, Orders page details showed only the paid pancake (₹90). The free pancake was missing from the persisted order.
3. **ISSUE 3 — Printed bill / receipt rendering problem:** The printed receipt showed Bill number, Subtotal ₹90, Grand Total ₹90, Cash ₹90, Tendered ₹180, Change Returned ₹90, but the item table was completely empty and the date appeared blank.
4. **ISSUE 4 — Top Products missing from Dashboard:** Dashboard displayed Top Categories (which had 30-day historical data), but Top Products Today was not visible or failed to display the prepared, paid, free, gross, discount, and net revenue breakdown.

All 4 issues have been diagnosed to their fundamental root causes and fixed surgically without modifying or destabilizing the Delivery Platforms implementation (Stage 6A), zero-balance settlements, or existing inventory/packaging logic.

---

## Root Cause Analysis & Technical Fixes

### Issue 1: BOGO Displayed but Payment Amount Not Discounted

#### Root Cause
In `frontend/src/components/pos/PrepaidCheckoutModal.tsx`:
- When the cashier clicked the "Launch BOGO" promotion button, `handleSelectPromotion` fetched `/api/promotions/preview`, set `selectedPromotionId('launch-bogo')`, populated `bogoFreeUnits`, set `discountType('amount')`, and set `discountValue('90')`.
- However, lines 423–435 contained a synchronous discount mode reconciliation block:
  ```tsx
  if (
    discountModeLoaded &&
    !committedInitialDiscountUnchanged &&
    discountMode !== 'none' &&
    !isDiscountTypeAllowed(discountMode, discountType)
  ) {
    setDiscountType(defaultDiscountTypeForMode(discountMode));
    setDiscountValue('');
    setDiscountReason('');
    ...
  }
  ```
- Because `discount_mode` in the store settings was set to `'percentage'`, `isDiscountTypeAllowed('percentage', 'amount')` evaluated to `false`.
- On the immediate next render pass, the modal unconditionally erased `discountValue` back to `''` and reset `discountType` to `'percentage'`.
- Consequently, `previewDiscount` evaluated to `null`.
- The hook `useTaxPreview` was called with `effectiveCheckoutItems` (2 pancakes × ₹90 = ₹180 subtotal) and `discount = null`.
- As a result, the backend tax preview calculated Subtotal = ₹180, Discount = ₹0, Total Due = ₹180. The payment inputs automatically populated with ₹180.

#### Resolution
- In `PrepaidCheckoutModal.tsx`, excluded `selectedPromotionId` from the generic manual cashier discount restrictions (`isDiscountTypeAllowed` and `discountMode === 'none'`). Preconfigured business promotions (such as Launch BOGO) are governed by the promotions engine, not arbitrary cashier discount caps.
- Excluded pre-authorized promotions from requiring a cashier Manager PIN (`discountNeedsApprovalPin = !selectedPromotionId && ...`).
- In `handleConfirm`, ensured `finalDiscount` is preserved when `selectedPromotionId` is set, passing `{ promotion_id: selectedPromotionId, type: discountType, value: previewDiscount?.value ?? preview.discountAmount, reason: discountReason }`.
- When the cashier explicitly selects percentage or amount to enter a manual cashier discount, `selectedPromotionId` and `bogoFreeUnits` are safely cleared.

---

### Issue 2: BOGO Free Item Missing from Order History

#### Root Cause
In `frontend/src/app/(dashboard)/pos/page.tsx`:
- `handlePrepaidCheckout` initializes `orderItems = cart.items.map(cartItemToOrderItem)`. The POS cart state only holds the paid pancake.
- Because `finalDiscount` had been stripped in `PrepaidCheckoutModal` (or because `discount.value > 0` failed when discount was wiped), `pos/page.tsx` evaluated `(effectiveDiscount && effectiveDiscount.value > 0)` to `false`.
- As a result, `api.patch('/orders/${orderId}/discount')` with `promotion_id` was skipped.
- The backend route handler that triggers `applyPromotionToOrder(db, orderId, promotionId)` was never called during prepaid checkout.
- Consequently, the free pancake was never inserted into `order_items`, and no recipe or packaging allocations were generated for it. The database only recorded the single paid pancake.

#### Resolution
- In `frontend/src/app/(dashboard)/pos/page.tsx`:
  - Updated `currentDiscount` and `attempt.discount` to recognize `(discount.value > 0 || Boolean(discount.promotion_id))`.
  - Updated `discountFingerprint` to include `promotion_id` so promotions are tracked accurately across retries and reconciliations.
  - Updated `discountAlreadyApplied` check to evaluate `currentOrderData.order?.promotion_id`.
  - Ensured `PATCH /orders/${orderId}/discount` is executed whenever `discount.promotion_id` is present.
  - Upon receiving the response from `PATCH /orders/${orderId}/discount`, updated `committedOrder` and `orderData` to the server's updated order row.
  - Prior to printing the KOT, ensured `printKotIfEnabled` receives the order with all items (paid + free matching pancake).

---

### Issue 3: Printed Bill / Receipt Rendering Problem

#### Root Cause
- In `main/routes/bills.ts`, the settlement function `applyPaymentBatch` returned:
  ```ts
  const result = {
    bill: parseRowJson(db.prepare('SELECT * FROM bills WHERE id = ?').get(billId)),
    walletDebited,
    loyaltyPointsEarned,
    orderFullyPaid,
    ...
  };
  ```
- The `bills` table in SQLite stores bill metadata (bill number, totals, payments, balances), but does not store nested order items.
- In `pos/page.tsx`:
  ```ts
  const paymentResponse = await api.post(`/bills/${bill.id}/payments`, ...);
  const paidBill: Bill = paymentResponse.data?.bill || bill;
  ...
  await printBillForTenant(paidBill, isPrepaidCheckout);
  ```
- In `frontend/src/lib/printer/print-document.ts`, `buildBillPrintData` relied on:
  ```ts
  const order = bill.order;
  const items = (order?.items ?? []).filter(...);
  createdAt: String(order?.created_at ?? ''),
  ```
- Because `paidBill.order` was `undefined`:
  1. `items` evaluated to `[]` — resulting in an empty item table on the physical receipt.
  2. `order.created_at` evaluated to `undefined` — resulting in a blank date header.
  3. Bill totals, bill number, and payment tendered/change values came directly from `bill` columns, so they printed normally.

#### Resolution
- In `main/routes/bills.ts` (`applyPaymentBatch`):
  - Fully hydrated `result.bill` using `getOrderWithItems(db, rawBill.order_id, rawBill.id)` and `customers`.
  - Applied `addBillLoyaltyFields(db, rawBill)` to ensure loyalty points balance and earnings are attached.
- In `frontend/src/lib/printer/print-document.ts` & `main/printers/document-classic.ts`:
  - Set `createdAt: String(order?.created_at || bill?.created_at || '')` so the bill date is never blank.
- In `frontend/src/app/(dashboard)/pos/page.tsx`:
  - In `printBillForTenant`, added a defensive check: if `bill.order?.items` is missing or empty, it automatically fetches the hydrated bill via `fetchLatestBill(bill.id)` before rendering the receipt.

---

### Issue 4: Top Products Missing from Dashboard

#### Root Cause
- Endpoint permission check: In `main/routes/reports.ts`, `router.get('/topProducts')` required `reports.view`. If a user with `dashboard.view` accessed the dashboard, the request returned `403 Forbidden`.
- In `frontend/src/app/(dashboard)/dashboard/page.tsx`, `Promise.all` did not handle a rejection from `/reports/topProducts` gracefully; any failure in the batch left `topProducts` as `[]`.
- Furthermore, because of Issue 2, BOGO free items were not previously persisted into `order_items`. Even when sales occurred, `free_quantity` remained 0, `gross_sales` showed only the paid line, and promo discount was 0.

#### Resolution
- In `main/routes/reports.ts`:
  - Updated permission checks for dashboard-facing endpoints (`/topProducts`, `/recentOrders`, `/insights`, `/daily-stats`, `/summary`) to `requireAnyPermission('reports.view', 'dashboard.view')`.
- In `frontend/src/app/(dashboard)/dashboard/page.tsx`:
  - Added resilient fallback catching to `api.get('/reports/topProducts').catch(() => ({ data: { topProducts: [] } }))` so dashboard rendering is never blocked.
  - Verified that the Top Products card cleanly displays:
    - Prepared items: `Prepared: 2 (1 paid + 1 free) · 1 orders`
    - Net revenue: `₹90`
    - Gross & Promo discount: `Gross ₹180 · Promo −₹90`

---

## Verification Results

| Test Suite / Build Step | Command | Result | Notes |
|---|---|---|---|
| **BOGO Promotion System** | `node tests/run-electron-node-test.cjs tests/discounts-promotions-stage6-bogo.test.ts` | **PASS (16/16)** | BOGO 1, 2, 3, 4 quantities, KDS, inventory, packaging, zero-balance settlement |
| **Delivery Integration (Stage 6A)** | `node tests/run-electron-node-test.cjs tests/delivery-platform-stage6a.test.ts` | **PASS (10/10)** | Preserved Stage 6A delivery platform integration & customer data removal |
| **Zero-Balance Settlement** | `node tests/run-electron-node-test.cjs tests/issue-zero-balance-settlement.test.ts` | **PASS (112/112)** | Zero-total siblings, refunds, split auto-closures all intact |
| **Stage 5 Packaging** | `node tests/run-electron-node-test.cjs tests/packaging-stage5.test.ts` | **PASS (9/9)** | Packaging profiles, consumption, and dashboard KPIs verified |
| **Migration Registry** | `node tests/run-electron-node-test.cjs tests/migration-registry.test.ts` | **PASS (398/398)** | All 131 migrations valid and sequential |
| **Lint Budget** | `npm run lint:budget` | **PASS** | Backend: 1010/1010 (within ceiling); Frontend: 0/5 warnings |
| **Backend TypeScript Build** | `npm run build` | **PASS** | `dist/` clean compilation |
| **Frontend Production Build** | `npm run build:frontend` | **PASS** | Next.js 16.4.3 production build (27/27 pages compiled) |

---

## Git Summary

### Modified Files:
- `frontend/src/components/pos/PrepaidCheckoutModal.tsx`: Uncoupled BOGO promotions from manual discount type restrictions; preserved `finalDiscount` with `promotion_id`.
- `frontend/src/app/(dashboard)/pos/page.tsx`: Preserved `promotion_id` in attempt state and discount fingerprint; called `PATCH /orders/${orderId}/discount`; hydrated order before KOT and receipt printing.
- `main/routes/bills.ts`: Hydrated `result.bill` in `applyPaymentBatch` with `order`, `order.items`, and `customer`.
- `frontend/src/lib/printer/print-document.ts`: Added fallback to `bill.created_at` when `order.created_at` is empty.
- `main/printers/document-classic.ts`: Added fallback to `bill.created_at`.
- `frontend/src/lib/types.ts`: Added optional `created_at?: string` and `updated_at?: string` to `Bill` interface.
- `main/routes/reports.ts`: Allowed `dashboard.view` permission for `/topProducts`, `/recentOrders`, `/insights`, `/daily-stats`, `/summary`.
- `frontend/src/app/(dashboard)/dashboard/page.tsx`: Added resilient catch handler for Top Products tile.
