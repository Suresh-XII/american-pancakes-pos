# FloCafe — Payment Method Adjustment: Cash + UPI Implementation Report

**Document Status:** Complete  
**Date:** 14 November 2026  
**Project:** FloCafe POS (American Pancakes)  
**Phase:** Phase 2 — Implementation & Regression Verification  

---

## 1. Executive Summary

This report documents the implementation of the payment method adjustment for FloCafe. In alignment with operational requirements for our American Pancakes store, **Card** has been replaced with **UPI** as the available built-in payment option for new POS transactions. The system now provides **Cash** and **UPI** as the primary tendered methods, while maintaining full backwards compatibility for all historical **Card** records.

### Core Objectives Delivered:
1. **New Transactions:** Cash and UPI are the default selectable built-in methods across the POS counter (prepaid checkout modal, dine-in settlement modal, cart panel delivery expected tender).
2. **Historical Integrity:** Existing Card payments in `bills.payment_details` remain 100% functional, readable, refundable, correctable, reportable, and printable without any database rewrite or data migration.
3. **Drawer Reconciliation:** UPI collections are treated as non-cash electronic funds. They are strictly excluded from physical cash drawer expected totals (`isCashTender() === false`), preserving accurate physical cash reconciliation in X-Reports and Z-Reports.
4. **Change Calculation:** Over-tender change calculations apply exclusively to Cash tender. Non-cash payments (including UPI) remain bounded to the exact amount payable.
5. **Localization:** Added `"methodUpi": "UPI"` (and script-appropriate localizations like `"ইউপিআই"` for Bengali, `"ЮПИ"` for Russian) across all 24 supported locales, maintaining zero translation drift and passing full `i18n:check`.
6. **Unified Printing & Exports:** All thermal printer encoders, web print templates, daily sales XLSX/CSV exports, and WhatsApp Z-report summaries cleanly format UPI tenders and historical Card records.

---

## 2. Architecture & Implementation Details

### 2.1 Frontend UI & Modals

| File | Changes Made |
|---|---|
| `frontend/src/lib/payment-methods.ts` | Replaced `Card` with `{ key: 'upi' as const, labelKey: 'pos.methodUpi', icon: QrCode }`. |
| `frontend/src/components/pos/PrepaidCheckoutModal.tsx` | Added `upi: 'methodUpi'` and `card: 'methodCard'` to `BUILT_IN_PAYMENT_KEYS`. Provided fallback to render historical `card` tender label if inspecting a bill settled previously by Card. |
| `frontend/src/components/pos/PaymentModal.tsx` | Updated `BUILT_IN_PAYMENT_KEYS` with `upi` and `card`. Enhanced `tenderLabel()` helper to render localized UPI and historical Card cleanly. |
| `frontend/src/components/pos/CartPanel.tsx` | Updated delivery order expected payment options to `cash` and `upi`. Added dynamic fallback `<option value="card">` only if the active cart already had `expectedPaymentMethod === 'card'`. |
| `frontend/src/components/orders/CorrectPaymentMethodModal.tsx` | Included `upi: 'methodUpi'` in `BUILT_IN_PAYMENT_KEYS`. Formatted `upi` as `'UPI'` in `formatLineMethod()`. Defaulted new target selection to `'upi'` when current payment line was Cash. |
| `frontend/src/components/orders/RefundModal.tsx` | Updated `BUILT_IN_PAYMENT_KEYS` with `upi: 'methodUpi'`. Dynamically rendered `<option value="card">` only when `hasCardPayment` detected an existing Card payment line in `effectiveBill.payment_details`. |
| `frontend/src/app/(dashboard)/dashboard/page.tsx` | Updated dashboard summary tile mapping to resolve UPI (`QrCode`, "UPI") and historical Card (`CreditCard`, "Card"). |
| `frontend/src/components/settings/PaymentMethodsSettings.tsx` | Updated `builtInMethods` set to `['cash', 'upi', 'wallet']`. In `add()`, reserved duplicate checks reject custom methods named `cash`, `upi`, `card`, `wallet`, or `loyalty`. |

### 2.2 Backend APIs & Validation

| File | Changes Made |
|---|---|
| `main/routes/bills.ts` | 1. Added `'upi'` to `PAYMENT_METHODS = new Set(['cash', 'card', 'upi', 'wallet'])`.<br>2. In `preparePaymentBatch()`, canonicalized `'upi'` to uppercase `'UPI'`, linking `payment_method_id` if a custom `UPI` row exists, or recording as built-in `'UPI'`.<br>3. In `PATCH /:id/payments/:index/method`, accepted `'upi'` without requiring a custom payment methods table row, while preserving `'card'` for corrections. |
| `main/routes/orders-validation.ts` | Added `'upi'` to `COURIER_COLLECTIBLE_METHODS`. In `resolveExpectedPaymentMethod()`, returns `'UPI'` when `normalized === 'upi'`, resolving against custom database rows when present. |
| `main/services/shift-session-gate.ts` | Added `'upi'` to `BUILT_IN_PAYMENT_METHODS`. Updated `isCashTender()` to return `false` for `upi` tenders (`normalized === 'cash'`), ensuring cashiers are never blocked on shift-gate restrictions when taking electronic UPI tender. |

### 2.3 Reporting, Thermal Printing & Exports

| File | Changes Made |
|---|---|
| `shared/print/document.ts` | Added `upi: 'pos.methodUpi'` to `PAYMENT_METHOD_CONCEPTS`. |
| `shared/print/z-report.ts` | Added `upi: 'pos.methodUpi'` to `PAYMENT_METHOD_CONCEPTS`. |
| `shared/print/concepts.ts` | Registered `pos.methodUpi` in `PRINT_CONCEPT_IDS`. |
| `scripts/generate-print-labels.cjs` | Added `pos.methodUpi` to `BORROWED_KEYS` and regenerated `main/print/print-labels.generated.ts`. |
| `main/printers/thermal.ts` | Added `upi: 'pos.methodUpi'` to `PAYMENT_METHOD_CONCEPTS`. |
| `main/services/daily-sales-export.ts` | Added `if (key === 'upi') return printLabel(language, 'pos.methodUpi');` in `localizeWhatsAppPaymentMethod()`. |
| `main/services/whatsapp.ts` | Added `if (key === 'upi') return printLabel(language, 'pos.methodUpi');` in `localizeZPaymentMethod()`. |
| `frontend/src/lib/printer/delivery-slip-encoder.ts` | Added `case 'upi': return label('pos.methodUpi');` in `paymentMethodLabel()`. |
| `frontend/src/lib/printer/delivery-slip-web-print.ts` | Added `method.toLowerCase() === 'upi' ? tr('pos.methodUpi') :` in `paymentMethod`. |
| `frontend/src/lib/printer/tax-bill-encoder.ts` | Added `upi: 'pos.methodUpi'` to `keys` in `resolvePaymentLabel()`. |
| `tests/helpers/legacy-thermal-oracle.ts` | Added `upi: 'pos.methodUpi'` to `concepts` in `resolvePaymentMethodLabel()`. |

---

## 3. Financial & Operational Invariants Verified

1. **Cash Drawer Independence:**
   In `main/routes/cash-closures.ts`, `cashDrawerSalesAndRefunds()` queries transactions with:
   `AND (lower(trim(pl.method)) = 'cash' OR pm.id IS NOT NULL)`
   Because `isCashTender(payment) === false` for UPI and UPI is not named cash, UPI collections are never added to `cashSalesCents` or `expectedCashFromAggregates()`. Physical drawer reconciliation remains solely dependent on physical currency.
2. **Change Calculations:**
   In `PrepaidCheckoutModal.tsx`, change is only calculated and displayed if `method === 'cash'` and `tendered > balance`. Non-cash tender cannot exceed the outstanding balance (`non_cash_exceeds_balance` error in backend).
3. **No Database Migrations Required:**
   SQLite columns for payments (`bills.payment_details`, `orders.expected_payment_method`, `cash_closures.payment_methods_json`) store JSON strings or unconstrained TEXT. No schema changes or table alter scripts were required.
4. **Historical Card Preservation:**
   Historical bills containing `"method": "card"` or `"Card"` continue to render in order details, bill previews, reprint documents, and refund modals without modification or data loss.

---

## 4. Test Verification Summary

### Targeted Test Suites:
| Test Suite | Result | Details |
|---|---|---|
| `npm run test:payment-methods-split` | **351/351 Passed** | Split bills, guest check settlements, custom & built-in tenders |
| `npm run test:integration-payments` | **11/11 Passed** | Split payments (Cash + UPI), Wallet double-spend prevention, zero amount rejection, cashier payments |
| `npm run test:payment-method-correction` | **154/154 Passed** | Correction flows (Cash ↔ Card, Cash ↔ UPI), audit logs, PIN overrides |
| `npm run test:cash-closures` | **Passed** | Day close, cash drawer reconciliations, Z-reports, WhatsApp summaries |
| `npm run test:daily-sales-export` | **252/252 Passed** | XLSX and CSV exports, payment sheet rows, formula sanitization |
| `npm run test:card-transaction-id` | **57/57 Passed** | Card terminal transaction number requirement & backwards compatibility |
| `npm run test:translations` | **24/24 Passed** | Parity across all 24 translation files, zero orphan/missing keys |
| `npm run i18n:check` | **Passed** | Drift validation: generated view matches canonical messages; TS clean |
| `node tests/run-electron-node-test.cjs tests/delivery-address-egress.test.ts` | **14/14 Passed** | Expected payment persistence (`['upi', 'UPI']`), courier notes |
| `node tests/run-electron-node-test.cjs tests/delivery-slip-printing.test.ts` | **50/50 Passed** | Delivery slip renderers (native, WebUSB, HTML), expected payment display |
| `node tests/run-electron-node-test.cjs tests/printer.test.ts` | **441/441 Passed** | Thermal receipt generation, Cash and UPI payment formatting |
| `node tests/run-electron-node-test.cjs tests/print-parity.test.ts` | **625/625 Passed** | Byte-for-byte ESC/POS layout parity across widths and templates |
| `npm run build` | **Passed (Code 0)** | Full TypeScript compilation and runtime asset sync |
| `npm run lint:budget` | **Passed** | Backend (1010/1010) and frontend (0/5) within strict warning budgets |

---

## 5. Conclusion

The Phase 2 Cash + UPI implementation has been completed cleanly with zero regressions. All BOGO fixes, delivery platform features, inventory tracking, and historical Card records remain intact and operational. FloCafe is ready for deployment with Cash and UPI checkout.
