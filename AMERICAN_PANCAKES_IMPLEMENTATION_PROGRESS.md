# American Pancakes implementation progress

## Completed before this implementation pass

- Stage 1: migration v125 (`add_item_serving_packaging_foundation`) provides additive packaging profiles, serving allocations, immutable packaging snapshots, and the consumption ledger.
- Stage 2: Dine-in/Regular and Parcel/Takeaway selection, mixed item servings, owner-only profile APIs, hydration, validation, POS presentation, and receipt summaries.

## Stage 3: implemented lifecycle increment and hardening

Migration v126 (`mark_checkout_inventory_lifecycle`) adds `orders.inventory_lifecycle` with an additive `legacy` default and index. Existing orders are therefore an explicit compatibility class; the implementation never interprets an empty v125 consumption ledger as evidence that a historical order was not depleted.

New orders inserted by `main/routes/orders.ts` are `checkout_v1`. Their product/variant target, add-on target, recipe, serving, and packaging snapshots are saved at order time but are not depleted then. This also applies to scheduled `checkout_v1` orders: deferred creation retains the snapshots required for later settlement.

`main/services/checkout-inventory.ts` is the single checkout-time consumer. It records deterministic v125 ledger keys and links each product/add-on movement or ingredient/packaging supply movement to that record. It consumes the saved snapshots, including mixed Dine-in paper-plate and Parcel box allocations, and ignores legacy rows.

`main/routes/bills.ts` calls that consumer from `completeExactBalanceSettlement` in the same `better-sqlite3` transaction as the bill update. A nested invocation joins the caller transaction; a direct invocation opens one. The inventory actor is the explicit approver or the persisted order user, never an unauditable synthetic user.

The old creation, cancellation, restore, and scheduled-release paths now retain legacy behaviour only. For `checkout_v1`, creation/editing do not deplete, pre-checkout cancellation does not restore, restoring a pre-checkout item does not re-deplete, and scheduled release does not consume. Financial refunds do not restore add-on stock for `checkout_v1`; no refund path deletes consumption records. Completed/cancelled orders remain guarded against ordinary item edits.

### Files changed in this Stage 3 increment

- `main/db.ts` — v126 lifecycle boundary.
- `main/services/checkout-inventory.ts` — central idempotent snapshot consumer.
- `main/services/inventory.ts` — exposes created movement id for ledger linkage.
- `main/routes/bills.ts` — atomic settlement integration and attributable actor resolution.
- `main/routes/orders.ts` — checkout lifecycle creation, scheduled snapshot retention, and cancellation/restore guards.
- `main/services/scheduled-orders.ts` — release-time legacy-only depletion.
- `main/services/refund.ts` — checkout-v1 financial-refund restoration guard.
- `tests/american-pancakes-stage3.test.ts` and `tests/american-pancakes-stage3-routes.test.ts` — isolated snapshot/rollback checks plus route-level payment, refund, cancellation, scheduling, and normal-API mutation checks.
- `tests/american-pancakes-stage3-independent-writers.test.ts` and `tests/fixtures/stage3-settlement-writer.cjs` — file-backed independent-process SQLite writer/lock/retry safety test.
- `tests/american-pancakes-schema-foundation.test.ts` — Stage 1 upgrade fixture, now extended through v127.
- `package.json` — the focused Stage 3 test is reachable from `test:ingredient-cost`.

### Validation actually run

- `npm run build` — passed (the build script prints a harmless non-git warning in this unpacked workspace).
- `npm run test:migration-registry` — passed: 383/383 checks; registry v1 through v126.
- `npm run test:american-pancakes-schema` — passed; copied v124 fixture upgraded to v126 and Stage 1 assertions passed.
- `npm run test:american-pancakes-stage3` — passed using isolated temporary SQLite databases. The route suite verified partial payment leaves stock untouched; final payment consumes the saved product/recipe/packaging snapshots; concurrent paid-bill retries add no movements or ledger rows; a checkout-v1 refund preserves stock and ledger records; pre-checkout cancellation/restore is movement-free; scheduled release is movement-free; and recipe/profile changes through their APIs cannot alter the existing order snapshot.
- The independent-writer portion of `npm run test:american-pancakes-stage3` opens a temporary file-backed database with separate `better-sqlite3` connections and starts a separate Electron process. While one writer owns `BEGIN IMMEDIATE`, the second receives `SQLITE_BUSY` and leaves zero movement/ledger/bill mutations; an independent retry then creates exactly one product and one ingredient movement plus their two ledger records, and a further retry changes nothing.
- `npm run test:order-item-cancel-restore` — passed (84/84).
- `npm run test:refunds` — passed (81/81 refund checks and 40/40 asynchronous refund checks).
- `npm run test:scheduled-orders` — passed, 364/364. Its historical scheduled fixtures now explicitly use `legacy`, retaining release-time product, add-on, and recipe depletion/restore assertions. The Stage 3 route suite separately covers checkout-v1 scheduling, release-time non-consumption, and settlement-time snapshot consumption.

## Stage 3 complete

`tests/american-pancakes-stage3-lifecycle-contract.test.ts` adds lifecycle-labelled fixtures. It verifies that legacy financial refunds restore only add-ons—the established compatibility contract—while products, recipe supplies, and packaging supplies remain untouched. Its checkout-v1 fixture consumes product, add-on, recipe, and packaging snapshots first, then proves refund leaves every physical quantity, linked movement, and consumption-ledger entry unchanged. Terminal cancellation calls for both lifecycle fixtures are idempotent and cannot reverse stock.

The full requested validation pass completed successfully: build, migration registry, schema upgrade, Stage 3 suite, scheduled orders, cancellation/restore, refunds, and the `test:ingredient-cost` chain. Stage 3 introduces no automatic physical restoration on checkout-v1 financial refund or terminal cancellation. Explicit physical stock changes remain the separately audited inventory/supply operations.

## Stage 4: purchases, suppliers and stock management complete

Migration v127 (`add_supplier_purchase_and_stock_operations`) is additive. It creates supplier master records, immutable purchase headers and line snapshots, physical-count headers/items, and wastage records. It does not alter existing orders, payments, recipes, supplies, inventory movements, or the Stage 3 checkout lifecycle.

`main/services/stock-management.ts` deliberately uses the established `supplies` and append-only `supply_movements` ledger. A purchase has `draft → review → received` transitions: only receiving inserts `receive` movements, inside the same transaction that marks the purchase received. Repeated receipt posting is rejected before an additional movement can be written. Purchase quantities support g/kg, ml/litre, pieces (the pre-existing canonical `each` unit), and explicitly sized packs for piece-based stock; package size must be entered rather than silently assumed. Unit price, line total, base quantity, supply name/base-unit snapshots, invoice, supplier, payment status, additional expenses, and notes are retained with the purchase.

Suppliers support owner-facing creation, viewing, editing, deactivation and safe soft deletion. A referenced supplier cannot be deleted, preserving purchase history. Physical counts snapshot expected quantity and unit cost, require an actual quantity for every captured supply and a reason for each variance, then post only variance movements. Wastage makes one auditable `waste` ledger movement linked to its owner-entered date, quantity, unit, reason, and notes. The existing supply edit surface remains the threshold-configuration and explicit manual-adjustment interface.

The Inventory screen now has a **Stock management** workspace with dashboard, supplier, purchase, physical-count, and wastage workflows. The dashboard surfaces low/out-of-stock supplies, recent purchases and waste, and the latest posted count’s variance. All APIs are protected by the existing `supplies.manage` inventory-management permission.

### Files changed in Stage 4

- `main/db.ts` — additive v127 tables and indexes.
- `main/services/stock-management.ts` — supplier, purchase receipt, physical count, wastage, and dashboard service.
- `main/routes/stock-management.ts` and `main/routes/index.ts` — owner inventory APIs mounted at `/api/stock-management`.
- `frontend/src/components/inventory/StockManagementPanel.tsx` and `frontend/src/app/(dashboard)/inventory/page.tsx` — owner-facing workflows.
- `tests/american-pancakes-stage4.test.ts`, `tests/american-pancakes-schema-foundation.test.ts`, and `package.json` — isolated workflow/upgrade coverage and test command.

### Stage 4 validation actually run

- `npm run test:american-pancakes-stage4` — passed, 21/21 checks on a temporary SQLite database. It verifies supplier retention, draft/review/receive timing, explicit pack conversion and invalid pack-to-weight rejection, receipt idempotency, count posting/idempotency and cost snapshots, wastage audit linkage, and authenticated API access.
- `npm run test:migration-registry` — passed, 386/386 checks; registry v1 through v127.
- `npm run test:american-pancakes-schema` — passed; a copied v124 fixture upgrades through v127 while historical orders, recipe snapshots, and inventory movements remain unchanged.
- `npm run test:supplies-service` — passed, 65/65.
- `npm run build` — passed (the unpacked workspace still prints its harmless non-git warning).
- `npm run build:frontend` — passed.
- `npm run lint` — passed with pre-existing repository warnings only.
- `npm run test:script-coverage` — its coverage phase passed (277 reachable test scripts, including the new Stage 4 suite); its pre-existing test-harness assertion check then failed under the local runner, unrelated to Stage 4 code.

One pre-existing broad `npm run test:inventory-ledger` suite still asserts the retired creation-time product inventory lifecycle and fails under the Stage 3 checkout-time boundary. It was not changed or used as a Stage 4 pass criterion; Stage 3’s focused lifecycle suites remain the compatibility evidence. No Stage 5 work, final packaging, or ZIP creation has begun.

## Stage 4 hardening — physical stock-count concurrency complete

- Added migration v128 with per-item `observed_stock_quantity` and `observed_at` snapshots.
- Saving a physical count captures the live system quantity at observation-save time and calculates variance against that value.
- Posting applies the saved variance as an additive adjustment delta, rather than setting stock to an old absolute quantity. Movements recorded after the count was saved are preserved.
- Added a Stage 4 regression scenario that records a stock movement after count save and verifies posting does not overwrite it.
- Existing pre-v128 reviewed counts without observation snapshots fail closed at posting and must be recreated/re-saved rather than posted with potentially stale quantities.

## Stage 5: Complete Packaging Configuration & Inventory Integration complete

Migration v129 (`add_packaging_configuration_stage5`) provides multi-material packaging profiles, material master tracking with SKU/category, product and variant packaging assignments, manual packaging adjustments, and immutable order-item packaging snapshots.

### Implementation details
- Packaging materials tracked in `supplies` with `is_packaging = 1`.
- Multi-material components in `packaging_profile_materials`.
- Profile resolution precedence: Item-level explicit override > Variant profile > Product profile > Serving-type default > None (`no_packaging`).
- Packaging snapshots created at order time without premature deduction; deferred consumption executed at checkout settlement via `consumeCheckoutInventory()`.
- Packaging movements recorded in `supply_movements` and linked to `order_inventory_consumptions`.
- Owner management UI in `PackagingProfilesPanel.tsx` mounted under Inventory → Packaging.
- Comprehensive test suite in `tests/packaging-stage5.test.ts` (9 test phases).

## Stage 6A: Delivery Platform Integration Foundation complete

Migration v130 (`add_delivery_integration_foundation_stage6a`) introduces provider-independent external delivery integration architecture (Swiggy, Zomato, and Sandbox Mock Mode).

### Implementation details
- Adapter-based architecture with `DeliveryProvider` interface, sandbox provider simulator, and placeholder adapters for Swiggy and Zomato.
- Order ingestion service with webhook HMAC/signature verification, provider-scoped idempotency, and automated status synchronization.
- Menu mapping engine in `external_menu_mappings` linking external IDs to internal POS products and variants.
- Sandbox mode allows simulating end-to-end incoming delivery orders, rider assignments, pickups, and completions.
- Deferred `checkout_v1` inventory and packaging consumption seamlessly integrates when delivery orders are settled.
- Settings screen in `DeliverySettingsPanel.tsx` mounted under Settings → Integrations.
- Comprehensive test suite in `tests/delivery-platform-stage6a.test.ts` (10 test phases).

## Stage 6: Flexible Discounts & BOGO Promotion System complete

Migration v131 (`add_promotions_and_discounts_stage6`) adds configurable promotions, BOGO engines, and loyalty rewards integration.

### Implementation details
- `promotions`, `promotion_products`, and `promotion_redemptions` tables with foreign keys on `orders` and `bills`.
- Seeded "Launch BOGO – All Pancakes" (`launch-bogo`) with dynamic regex matching across all pancake products and variants, lower-priced item free (`cheapest_free`), and owner-configurable time windows.
- Seeded 6th-Visit Loyalty BOGO Reward (`loyalty-visit6-bogo`) requiring 5 qualifying paid visits; upon redemption on the 6th visit, that visit does NOT count as a qualifying visit and cleanly resets the cycle to 0/5.
- Both paid and free items deplete raw supplies and packaging materials identically during checkout settlement (`consumeCheckoutInventory`).
- Taxes rescaled proportionally using `recomputeOrderTotals` and `computeDiscountTaxRatio`.
- Reporting endpoint `GET /api/promotions/reports/summary` aggregates redemption totals while strictly excluding simulated delivery orders.
- Comprehensive test suite in `tests/discounts-promotions-stage6-bogo.test.ts` (12 test phases).

## Bugfix & Hardening: Packaging Configuration Loading

- Resolved SQL prepare error `no such column: pv.deleted_at` in `getProductPackagingAssignments()` by correctly filtering variants with `pv.is_active = 1`.
- Added string identifier support in `ProductDbRow` and `VariantDbRow` to align with text primary keys.
- Enhanced frontend error handling in `PackagingProfilesPanel.tsx` to surface backend error details.
- Verified all packaging endpoints return HTTP 200 with live store catalog.
- Added explicit assertions in `tests/packaging-stage5.test.ts` to prevent regression.
- Regression verification: 229/229 commands passing in `npm test`.

## BOGO Promotion Engine Correction: Buy 1 Get 1 Free Auto-Addition & Inventory Integration

### Problem & Objective
The original BOGO implementation expected cashiers to manually add both pancakes to the cart before discounting one. Under the corrected business requirement for "Buy 1 Pancake, Get 1 Free", adding one eligible pancake and applying Launch BOGO must automatically create the matching free pancake, display both on the KDS, consume raw recipe supplies and packaging materials for both at checkout, and reflect both on the receipt while the customer only pays for one.

### Implementation Details
- **Auto-Creation of Free Matching Items**:
  - `applyPromotionToOrder` in `main/services/promotions.ts` inspects eligible pancakes in the cart and auto-inserts matching free pancakes into `order_items`.
  - Free items carry `product_name: '${paidItem.product_name} (BOGO Free)'`, `unit_price`, `subtotal: paidItem.unit_price * freeQty`, `discount_amount: paidItem.unit_price * freeQty`, and `total: 0`.
  - `special_instructions` marked as `'BOGO Free - Launch Offer'` and `modifier_selection` tagged with `{ is_bogo_free: true, promotion_id, source_order_item_id }`.
  - Free item is created with `status: 'pending'` and triggers `notifyKdsUpdate()`, ensuring kitchen display stations immediately receive tickets for both items.
- **Recipe & Packaging Inventory Consumption**:
  - Auto-added free items snapshot full recipes via `buildRecipeSnapshot()` and clone serving/packaging allocations via `persistItemServingAndPackaging()`.
  - At checkout settlement, `consumeCheckoutInventory()` consumes recipe ingredients (flour, milk, eggs, etc.) and packaging materials (takeaway boxes, paper plates) for both the purchased and free items.
- **Quantity Scaling**:
  - Supports scaling linearly: Buy 1 -> 2 pancakes (pay 1); Buy 2 -> 4 pancakes (pay 2); Buy 3 -> 6 pancakes (pay 3).
  - Same-item matching rule seeded in migration v131 (`bogo_pricing_rule = 'same_item'`).
- **Promotion Removal & Lifecycle Safety**:
  - `removePromotionFromOrder` cleans up auto-added BOGO items and their associated serving/packaging allocations from the database, restores item discounts and order subtotals, and updates KDS.
  - Terminal order states (settled/paid or cancelled) are guarded against promo modifications.
- **Verification**:
  - Full test suite in `tests/discounts-promotions-stage6-bogo.test.ts` covering single-item BOGO, multiple quantities scaling, KDS quantities, inventory consumption, packaging box deductions, receipts, terminal order status protection, and loyalty 6th-visit BOGO redemption. All 12 test sections pass.

## BOGO Business Rule Final Verification: Matching-Item Rule for Launch & Loyalty BOGO

### Business Rule Alignment
- Confirmed business requirement: **BUY ONE PANCAKE, GET ONE MATCHING PANCAKE FREE**.
- Corrected `loyalty-visit6-bogo` from legacy `cheapest_free` to `same_item`, ensuring loyalty rewards strictly adhere to the exact same matching-item rule.
- Migration v131 updated to execute `UPDATE promotions SET bogo_pricing_rule = 'same_item' WHERE id IN ('launch-bogo', 'loyalty-visit6-bogo')`.
- Default BOGO pricing rule in `main/routes/promotions.ts` set to `'same_item'`.
- Dynamic special instructions generated: `'BOGO Free - Loyalty 6th Visit Reward'` for loyalty rewards and `'BOGO Free - Launch Offer'` for launch promotions.

### Comprehensive End-to-End Testing (Quantities 1, 2, 3, 4)
- Added dedicated end-to-end test assertions in `tests/discounts-promotions-stage6-bogo.test.ts` covering:
  - **Cart preview**: Correct calculation of pairs, free units matching purchased pancake product and unit price, and estimated discount.
  - **Order creation**: Deferred inventory lifecycle verified (stock untouched prior to payment).
  - **Promotion application**: Subtotal updated to $2Q \times 100$, discount to $Q \times 100$, net payable to $Q \times 100$.
  - **Order items**: Explicit verification of 2 item rows (paid item with qty $Q$, free matching item with qty $Q$, discount $Q \times 100$, and total 0).
  - **KDS ticket rendering**: Both paid and free pancakes appear on KDS as pending items, with the free pancake clearly identified with `(BOGO Free)`.
  - **Bill and Receipt**: Generated bill matches net payable amount; thermal receipt builder `buildBillPrintData` renders both paid and free lines and explicit discount breakdown.
  - **Checkout settlement**: Atomic settlement via `completeExactBalanceSettlement` consumes recipe supplies ($2Q \times 0.1$ kg flour, $2Q \times 0.05$ L milk) and packaging materials ($2Q \times 1$ takeaway boxes).
  - **Redemption record**: Immutable `promotion_redemptions` record created linking order and bill.
- All 12 test phases passed in `tests/discounts-promotions-stage6-bogo.test.ts`.
- Full sequential regression suite passed: 229/229 commands (exit code 0).
- Lint warning budget passed: 1008 backend warnings (budget: 1010), 0 frontend warnings (budget: 5).
- Frontend production build passed (`next build`).

## Real-World Testing Fixes: BOGO, Checkout, Loyalty, and Dashboard Complete

### 1. Dedicated BOGO Action in POS Checkout
- BOGO promotions (Launch BOGO and Manual BOGO) now render as dedicated 1-click action buttons in the POS checkout interface.
- Cashier is no longer prompted with a generic percentage input or asked to enter 100% manually.
- Clicking BOGO immediately fetches promotion calculation, adds matching free item(s) to the breakdown, and applies discount to the free items without cashier calculation.
- Tapping the active BOGO button toggles off the promotion and restores the original cart state.

### 2. Checkout Modal Item Breakdown (`PrepaidCheckoutModal.tsx`)
- Constructed `effectiveCheckoutItems` within the modal that combines original paid cart items with auto-added matching free pancakes (`(BOGO Free)`).
- Modal displays a scrollable **Order Items Breakdown** showing both paid pancakes (with prices) and matching free pancakes (with `FREE` badge and strikethrough price).
- Bill summary reflects full subtotal (e.g. ₹140), promotional discount (e.g. − ₹70), and net amount payable (e.g. ₹70).
- `useTaxPreview` receives `effectiveCheckoutItems` to ensure taxes, packaging, and round-offs match the final created bill.

### 3. Cash Payment and Change Calculation Reconciled
- Prevented stale cash amounts from producing incorrect change when promotions or totals change.
- When `remaining <= 0` (zero-payable order): payment inputs reset to empty, change is strictly 0, and confirmation button displays `"Confirm Order (Free)"`.
- When `remaining > 0`: single active payment method auto-updates to `remaining` if untouched, and change is computed strictly as `Math.max(0, cashReceived - remaining)`.
- Backend `POST /bills/:id/payments` in `main/routes/bills.ts` accepts empty payments array for zero-due bills and settles the bill as fully paid after kitchen delivery checks.

### 4. External Loyalty Separation & Manual BOGO
- FloCafe uses an external loyalty web app for visit tracking. The duplicate internal loyalty visits counter / 6th-visit BOGO button is excluded from active POS promotion selection (`GET /promotions?active_only=true`).
- Seeded permanent `manual-bogo` promotion (`end_at: null`, `is_active: 1`, `bogo_pricing_rule: 'same_item'`) in migration v131 for staff to apply manually when external loyalty eligibility is confirmed.
- Preserved historical loyalty tables, audit logs, and redemption records.

### 5. Launch BOGO vs. Permanent Manual BOGO
- `launch-bogo`: Has configurable start and end dates, auto-expires after the launch window.
- `manual-bogo`: Permanent manual BOGO without expiry (`end_at: null`), available indefinitely until disabled by owner.
- Same-item matching rule enforced for both promotions. Anti-stacking ensures an order cannot stack both promotions on the same units.

### 6. Dashboard Metrics: Paid vs. Free Pancake Quantities (`/reports/topProducts`)
- Updated `GET /reports/topProducts` raw query to compute:
  - `total_quantity` / `prepared_quantity`: Total pancakes prepared (paid + free promotional units).
  - `paid_quantity`: Units that were purchased and paid for.
  - `free_quantity`: Promotional free units (e.g. `(BOGO Free)`).
  - `gross_sales`: Gross item value.
  - `discount_amount`: Promotional discount amount.
  - `total_revenue` / `net_revenue`: Net revenue (`gross_sales - discount_amount`). Free pancakes do not inflate revenue.
- Updated `TopProduct` interface and Dashboard page (`frontend/src/app/(dashboard)/dashboard/page.tsx`) to display:
  - `Prepared: X (Y paid + Z free)` in the Top Products Today list when free units exist.
  - Gross sales vs. promo discount breakdown (`Gross ... · Promo -...`).

### 7. Verification & Regression Coverage
- `tests/discounts-promotions-stage6-bogo.test.ts`: Expanded to 16 test phases verifying `manual-bogo`, `launch-bogo` auto-expiry, zero-payable bill settlement, anti-stacking, and dashboard paid vs. free quantity separation. (Passed 100%).
- `tests/issue-zero-balance-settlement.test.ts`: Verified zero-balance settlement, kitchen delivery gating, and split auto-completion (Passed 112/112).
- `tests/pos-keyboard-shortcuts.test.ts` & `tests/card-transaction-id.test.ts`: All passed.
- `npm run build`: Backend TypeScript compilation passed (exit code 0).
- `npm run build:frontend`: Next.js production build passed (all 27 routes compiled statically, exit code 0).
- `npm run lint:budget`: Backend 1010 warnings (budget: 1010), frontend 0 warnings (budget: 5).

---

## Stage 6A Follow-Up: Delivery Platform UI Crash Fix & Customer Data Removal

### 1. Root Cause Analysis & Fix for Settings Delivery Platform Crash
- **Root Cause**:
  - `GET /api/products` returns `{ products: [...] }`, not a bare array.
  - In `DeliveryIntegrationsPanel.tsx`, `api.get('/products')` response data was assigned directly to `setProducts(productsRes.data || [])`.
  - As a result, `products` became `{ products: [...] }` (an object, not an array).
  - During the subsequent render pass, evaluating `products.find((p) => p.id === selectedProductId)` threw `TypeError: products.find is not a function`, triggering the dashboard Error Boundary (`"Something went wrong. This screen hit a snag – recovering automatically..."`).
- **Correction**:
  - Added robust array extraction for `products` (`Array.isArray(rawProducts) ? rawProducts : Array.isArray(rawProducts?.products) ? rawProducts.products : []`).
  - Added defensive array guards for `configs`, `mappings`, and `webhookEvents` with `safeConfigs`, `safeMappings`, `safeWebhookEvents`, and `safeProducts`.
  - Added safe date string parsing for `last_sync_at` and `created_at` audit timestamps to guard against null or malformed date values.
  - Added route tab alias in `frontend/src/app/(dashboard)/settings/page.tsx` mapping `?tab=delivery` to `'delivery-integrations'`.

### 2. Complete Customer Data Removal for Delivery Platform Ingestion
- **Business Rule**: American Pancakes uses a separate external system for customer registration and loyalty. Delivery platform orders (Swiggy, Zomato, Sandbox) must never collect, store, require, or display customer names or phone numbers.
- **Frontend Changes**:
  - Removed `simCustomerName` and `simCustomerPhone` state and input fields from `DeliveryIntegrationsPanel.tsx` sandbox simulator dialog.
  - In `OrderCard.tsx` and `OrderDetailPanel.tsx`:
    - Detected delivery platform orders via `order.type === 'online' || Boolean(order.online_platform) || Boolean(order.external_order_id)`.
    - Replaced the customer details strip with a dedicated Delivery Platform strip displaying provider badge, external order ID (`#SWIGGY-...`, `#ZOMATO-...`, `#SIM-...`), and delivery address.
    - Suppressed "Link Customer", "Change Customer", and "New Order for Customer" actions for delivery platform orders.
    - Suppressed WhatsApp receipts for delivery platform orders.
- **Backend Changes**:
  - Updated `SandboxAdapter`, `SwiggyAdapter`, and `ZomatoAdapter` in `main/services/delivery/adapters/`:
    - Removed placeholder strings (e.g. `'Sandbox Customer'`, `'+919876543210'`).
    - Enforced `customerName: null` and `customerPhone: null` across all incoming order normalization.
  - In `main/routes/delivery.ts`: Ingestion and simulator endpoints enforce `customerName: null` and `customerPhone: null`.
  - In `main/services/delivery/delivery-service.ts`: `ingestDeliveryOrder` creates order records with `customer_id: null` and never queries or registers rows in the `customers` table.
  - Preserved standard customer management, linking, and loyalty behavior for in-store dine-in and takeaway orders. Historical customer data remains intact.

### 3. Verification
- `tests/delivery-platform-stage6a.test.ts`: Added phase 5b verifying:
  - Delivery order simulation succeeds with HTTP 201 without customer name or phone.
  - `orders.customer_id` is null.
  - `customers` table remains at 0 rows.
  - All adapters return `customerName: null` and `customerPhone: null` without fake fallbacks.
- `npm run lint:budget`: Backend 1010/1010, frontend 0/5.
- `npm run build`: Backend TypeScript build passed (exit code 0).
- `npm run build:frontend`: Next.js production build passed (exit code 0).





