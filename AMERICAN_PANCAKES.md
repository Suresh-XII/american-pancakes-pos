# American Pancakes local POS

This workspace customises the MIT-licensed FloCafe desktop POS for one American Pancakes push cart. The upstream `LICENSE`, copyright notices, and core architecture are retained.

## What is ready

- Local Electron desktop application with SQLite storage; core order taking, settlement, reporting, printing, and data access work without internet access.
- India-first initial setup: `American Pancakes`, INR, and `Asia/Kolkata` are prefilled. The address, phone number, tax registration, and tax rate remain owner-entered because they must not be invented.
- Counter-service defaults: the initial profile is empty and QSR. No demo transactions are recorded as business data.
- Local-first privacy defaults: cloud coordination and telemetry are off until an owner explicitly enables them in a later configuration change.
- Touch POS with categories, search, variants, add-ons, notes, quantities, holds, discounts, receipt reprint, cash/UPI and split payments. UPI is a recorded operator-confirmed tender; it does not verify a bank transaction.
- Dashboard, date-range reports, CSV export, expenses, supplies/inventory movements, low-stock thresholds, product images, automatic local backups, manual backup, and validated restore.

Money is handled by the application’s backend calculation path and SQLite records; do not use browser floating-point totals for a sale. Completed sales are retained, with refunds/corrections recorded separately.

## Included editable starter menu

`starter-data/` holds three intentionally editable CSV files:

1. Import `american-pancakes-categories.csv`.
2. Import `american-pancakes-products.csv`.
3. Import `american-pancakes-addons.csv`.

Use **Products → Import / Export** in the application. The product amounts are examples, not prescribed business prices. Review every price, tax setting, availability, and recipe before selling. The starter data creates no sales, stock quantities, ingredient costs, or GST registration data.

## Local Windows development setup

Prerequisite: Node.js 22.12 or later. The project is currently installed with Node 24 LTS.

```powershell
Set-Location 'C:\Users\LENOVO\OneDrive\Desktop\PetPooja\FloCafe-main\FloCafe-main'
npm install
npm run dev
```

The desktop application keeps its live SQLite database and managed backups outside this source folder. Do not delete that data directory while upgrading. Use **Settings → Backup** to create a portable backup before an upgrade or restore; restore validates the chosen SQLite file and retains a safety copy of the replaced database.

For a production Windows package, run `npm run build:win` after validation. The build creates a local installer; it does not deploy the application or send business data to the internet.

## Operational scope and limits

The selected base is FloCafe rather than the other bundled projects because it is the only supplied MIT-licensed Electron application with a mature local SQLite database, migration/backup safety, POS payment tests, printing, offline operation, and inventory/expense modules already in its active build.

| Stage | Status | Scope |
| --- | --- | --- |
| Audit and architecture selection | Complete | FloCafe selected; the other bundles remain unmodified. |
| Local runtime and safety | Complete in source | SQLite, migrations, daily local backup, manual backup/restore, idempotency, and invoice sequences are upstream capabilities. |
| Branding and India defaults | Complete | American Pancakes title, initial business name, INR, India timezone, empty QSR profile. |
| POS, checkout, receipts | Existing and retained | Cash, UPI, split tender, holds, discounts, receipt reprint, unique order/bill numbers. |
| Reporting, expenses, inventory | Existing and retained | Sales/payment reports, CSV export, expense workflow, stock movements/supplies. |
| Future work | Deliberately deferred | Multi-outlet synchronisation, staff expansion, customer loyalty, recipe depletion rollout, aggregator ordering, remote dashboard, and cloud backup. |

Current operational limits: no payment gateway is connected, so UPI confirmation is manual; automatic recipe deductions must be configured carefully before being relied on; reports describe sales and recorded expenses, not accounting profit; and tax settings require confirmation from the business’s tax adviser. Existing optional upstream cloud, WhatsApp, and Google Drive integrations are not required or enabled by this fork.

## Modification record

- Initial setup is configured for a single Indian push-cart business and does not automatically enable cloud coordination or analytics.
- The setup screen and browser/desktop metadata use American Pancakes branding.
- Editable pancake categories, products, and add-ons are supplied as separate import files rather than hard-coded records.
