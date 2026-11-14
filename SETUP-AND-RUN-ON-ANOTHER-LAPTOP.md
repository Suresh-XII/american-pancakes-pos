# FloCafe POS — Setup & Run Instructions for Another Laptop

**Application:** FloCafe American Pancakes POS (Stage 7 Final Version)  
**Date:** 14 November 2026  
**Target Launch:** 20 November 2026  

---

## 1. System Requirements

Before running the application on your new laptop, make sure the following are installed:

1. **Node.js**: Version **22.12.0** or higher (LTS recommended).
   - Download from: [https://nodejs.org](https://nodejs.org)
   - Verify in terminal:
     ```bash
     node -v
     npm -v
     ```
2. **Git** (optional, recommended for version tracking).
3. **Operating System**: Windows 10/11, macOS, or Linux.

---

## 2. Quick Start Steps

### Step 1 — Extract the Zip
Extract `American-Pancakes-POS-Stage4-Final.zip` into any folder on your laptop (e.g. `C:\FloCafe` or Desktop).

### Step 2 — Open Terminal in the Project Folder
Open PowerShell, Command Prompt, or Terminal in the extracted `American-Pancakes-POS-Stage4` folder.

### Step 3 — Install Dependencies
Run:
```bash
# 1. Install root project dependencies
npm install

# 2. Install frontend Next.js dependencies
cd frontend
npm install
cd ..
```

### Step 4 — Launch the POS Application
Run:
```bash
npm run dev
```

This command automatically:
1. Clears any lingering local ports (3001, 3002, 3003).
2. Compiles the Next.js 16 frontend (`npm run build:frontend`).
3. Compiles the backend TypeScript into `dist/` (`npm run build`).
4. Launches the Electron desktop POS application window.

---

## 3. Alternative Execution Modes

- **Run Frontend Web Interface Only (in browser):**
  ```bash
  npm run dev:frontend
  ```
  Opens at `http://localhost:3000`.

- **Run Full Regression Test Suite:**
  ```bash
  npm test
  ```

- **Run Stage 7 Completion Targeted Tests:**
  ```bash
  npm run test:stage7-completion
  ```

- **Verify Lint Budget & Code Quality:**
  ```bash
  npm run lint:budget
  ```

---

## 4. Key Updates Included in this Final Version

1. **POS Packaging UI Corrections (Workstream B):**
   - **Dine In:** Shows only paper-plate allocation (`Plate × N`). Parcel box section and profile selectors are hidden.
   - **Takeaway:** Shows only parcel box allocation (`Boxes required: N`). Dine-in plate inputs are hidden.
   - **Order Type Switch:** Automatically updates and normalizes allocations.
   - **Order Notes:** Textarea removed from POS cart panel for a cleaner cashier workflow.
2. **Payment Method Adjustment (Cash + UPI):**
   - POS active methods offer strictly **Cash** and **UPI**.
   - Physical cash drawer reconciliation strictly tracks physical cash; UPI digital collections are isolated.
   - Historical Card records remain fully supported and readable.
3. **BOGO Engine & Accounting (Stage 7.2):**
   - For 1 paid + 1 free pancake (₹90): Gross = ₹180, Discount = ₹90, Net = ₹90.
   - Merges free matching items into parent product lines in daily exports.
4. **Delivery Sandbox Order Isolation (Stage 7.1):**
   - Simulated delivery orders (`is_simulated = 1`) are 100% excluded from all financial reports, sales, taxes, bills, and exports.
5. **Sales Reconciliation (Stage 7.3):**
   - Excludes draft, unpaid, held, and cancelled orders from settled sales metrics.
6. **Promotions Dashboard (Stage 7.4):**
   - Dedicated dashboard card displaying total promotional discounts, BOGO redemptions, and paid/free/prepared pancake units.
7. **Unified Profitability / P&L (Stage 7.5):**
   - 6-metric Profitability overview incorporating Revenue, COGS, Packaging Cost, Gross Profit, Operating Expenses, and Operating Profit.

---

## 5. Documentation & Engineering Reports

All full technical reports are located inside the `docs/` folder:
- `docs/flocafe-final-regression-report.md`: Final full sequential regression & acceptance report.
- `docs/flocafe-stage-7-completion-report.md`: Stage 7 completion & POS packaging report.
- `docs/flocafe-stage-7-1-sandbox-isolation-report.md`: Delivery sandbox isolation report.
- `docs/flocafe-payment-method-cash-upi-implementation-report.md`: Cash + UPI implementation report.
- `docs/bogo-checkout-regression-fixes-report.md`: BOGO checkout regression fixes report.
