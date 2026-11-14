# Stage 3 inventory lifecycle design

## Lifecycle boundary

`main/db.ts` migration v126 adds `orders.inventory_lifecycle TEXT NOT NULL DEFAULT 'legacy' CHECK (...)` and an index on lifecycle/status. It is additive: all pre-existing orders remain `legacy`, with their historical movements untouched. New orders created by `main/routes/orders.ts` are explicitly `checkout_v1`. The v125 consumption ledger is never used to classify historical orders.

## Movement call sites and rules

| Area | Legacy behaviour | `checkout_v1` behaviour |
| --- | --- | --- |
| `insertOrderItems` / normal create loop in `main/routes/orders.ts` | Existing product, add-on, and recipe depletion remains available for legacy callers. | Persists immutable snapshots only; no movement. |
| `cancelOrderItemAndRestoreStock` and order-status cancellation in `main/routes/orders.ts` | Restores its recorded product, add-on, and recipe snapshots. | Marks the line/order cancelled without a restoration movement. |
| Item restore in `main/routes/orders.ts` | Re-depletes an eligible legacy item. | Marks it pending without re-depletion. |
| `releaseScheduledOrder` / `deductAndValidateInSavepoint` in `main/services/scheduled-orders.ts` | Keeps release-time validation/depletion. | Skips legacy release depletion; settlement is the only consumer. |
| `createRefund` in `main/services/refund.ts` | Retains existing add-on restore behaviour. | Financial refund does not restore physical stock or delete consumption records. |
| `completeExactBalanceSettlement` in `main/routes/bills.ts` | Leaves historic lifecycle untouched. | Calls the central consumer once within settlement's transaction. |

The order edit/cancel routes block completed and cancelled orders and block paid-item changes before movement code is reached. Explicit physical stock operations remain the supply/inventory adjustment services, which produce auditable movements and are separate from financial refunds.

## Transaction and idempotency model

`completeExactBalanceSettlement` detects whether `better-sqlite3` already has an active transaction. If not, it wraps itself in `db.transaction`; if yes, its bill update, consumption movements, ledger records, and settlement reconciliation use the caller's transaction. Any consumer error rolls all of these writes back.

`consumeCheckoutInventory` derives deterministic v126 keys from the order plus the immutable order-item, add-on, recipe-component, or packaging-allocation identity. It checks the v125 unique ledger entry before each movement and inserts the entry with the resulting movement id. Repeated settlement requests are no-ops after the first successful consumption. SQLite's writer serialization and the ledger uniqueness constraint provide the backend/database concurrency boundary.

The consumer uses saved `order_items.recipe_snapshot`, `inventory_*` fields, `order_item_addons.inventory_deducted_quantity`, and v125 packaging snapshots. It deliberately does not recalculate from current recipes or packaging profiles.

## Current focused evidence

`tests/american-pancakes-stage3.test.ts` creates a temporary database and proves:

- creation fixture stock remains unchanged;
- one mixed-serving checkout consumes product, a recipe component, one paper plate, and one manually confirmed parcel box;
- a later packaging-profile change does not affect those snapshots;
- a second central-consumer invocation and a second settlement invocation create no extra movement or ledger entry;
- a legacy completed order is ignored;
- a failing supply snapshot causes `completeExactBalanceSettlement` to roll back its bill update, product movement, all supply movements, and ledger entries.

`tests/american-pancakes-stage3-routes.test.ts` drives the application routes. It proves that partial payment does not consume; final payment now reaches `completeExactBalanceSettlement`; repeat concurrent HTTP retries do not duplicate consumption; checkout-v1 item refunds preserve stock and consumption history; cancellation/restoration prior to payment creates no movement; scheduled release creates no movement; and later recipe/profile API edits do not change the saved snapshots used by settlement.

`tests/american-pancakes-stage3-independent-writers.test.ts` uses a temporary file-backed database, two separately opened `better-sqlite3` connections, and a separate Electron process. It holds `BEGIN IMMEDIATE` in one connection while the process attempts settlement through the real completion function. The blocked writer returns `SQLITE_BUSY` with no partial mutations; an independent connection retries successfully and a further retry is idempotent.

## Final lifecycle evidence

`tests/issue-360-scheduled-orders.test.ts` makes its historical release-time fixtures explicitly `legacy` and passes 364/364. The checkout-v1 route suite provides the complementary no-depletion-on-release/consume-on-settlement evidence.

`tests/american-pancakes-stage3-lifecycle-contract.test.ts` resolves the legacy-refund compatibility boundary: legacy financial refunds restore add-ons only; products, recipe supplies, and packaging supplies remain untouched. Checkout-v1 refunds preserve all product/add-on/supply quantities, consumption-ledger entries, and historical movements. Terminal cancellation calls are idempotent and cannot reverse stock for either fixture. Physical restoration is intentionally outside financial refund and terminal cancellation flows, remaining an explicit audited inventory/supply operation.

With the independent-writer test, route workflow suite, lifecycle contract suite, and all requested regressions passing, Stage 3 is complete.
