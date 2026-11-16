-- =============================================================================
-- American Pancakes POS - Complete Supabase PostgreSQL Schema
-- =============================================================================

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. Settings & Metadata ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _flo_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Users & Authentication ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen', 'chef')),
    pin TEXT,
    pin_hash TEXT,
    category_ids TEXT,
    is_active INTEGER DEFAULT 1,
    terms_accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
    token TEXT PRIMARY KEY,
    revoked_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- ── 3. Catalog (Categories, Products, Addons) ────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    slug TEXT,
    color TEXT,
    icon TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    cost NUMERIC(12, 2) DEFAULT 0,
    sku TEXT,
    barcode TEXT,
    sale_unit TEXT NOT NULL DEFAULT 'each' CHECK (sale_unit IN ('each', 'kg', 'g', 'lb', 'ml', 'cl', 'l', 'fl oz', 'oz')),
    allow_fractional_quantity INTEGER NOT NULL DEFAULT 0,
    weight_precision INTEGER NOT NULL DEFAULT 3 CHECK (weight_precision BETWEEN 0 AND 4),
    image_url TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    track_inventory INTEGER DEFAULT 0,
    stock_quantity NUMERIC(12, 3) DEFAULT 0,
    low_stock_threshold NUMERIC(12, 3) DEFAULT 5,
    tax_type TEXT DEFAULT 'none',
    tax_rate NUMERIC(6, 2) DEFAULT 0,
    tax_category_id TEXT DEFAULT NULL,
    tax_behavior TEXT DEFAULT 'country_default',
    cb_percent NUMERIC(6, 2) DEFAULT 0,
    tags TEXT,
    inventory_product_id TEXT DEFAULT NULL REFERENCES products(id),
    inventory_deduction_quantity NUMERIC(12, 3) DEFAULT 1,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS addon_groups (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT,
    is_required INTEGER DEFAULT 0,
    min_selection INTEGER DEFAULT 0,
    max_selection INTEGER DEFAULT 1,
    allow_multiple_quantities INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS addons (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    addon_group_id TEXT NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_category_id TEXT DEFAULT NULL,
    tax_behavior TEXT DEFAULT 'country_default',
    inherit_parent_tax_category INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS addon_group_product (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    addon_group_id TEXT NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, addon_group_id)
);

CREATE TABLE IF NOT EXISTS category_addon_groups (
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    addon_group_id TEXT NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (category_id, addon_group_id)
);

-- ── 4. Floor, Tables, Kitchen Stations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS printers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'network',
    ip TEXT,
    port INTEGER DEFAULT 9100,
    paper_width INTEGER DEFAULT 80,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kitchen_stations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    description TEXT,
    category_ids TEXT,
    printer_id TEXT REFERENCES printers(id) ON DELETE SET NULL,
    printer_ip TEXT,
    printer_port INTEGER DEFAULT 9100,
    printer_name TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS station_users (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    station_id TEXT NOT NULL REFERENCES kitchen_stations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, station_id)
);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    country_code TEXT DEFAULT '+91',
    address TEXT,
    notes TEXT,
    tag_counts TEXT DEFAULT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tables (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    number TEXT NOT NULL UNIQUE,
    capacity INTEGER DEFAULT 4,
    status TEXT DEFAULT 'available',
    floor TEXT,
    section TEXT,
    position_x REAL,
    position_y REAL,
    kitchen_station_id TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    reservation_customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL
);

-- ── 5. Orders & Kitchen Display (KDS) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    table_id TEXT,
    customer_id TEXT,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    type TEXT DEFAULT 'takeaway',
    delivery_address TEXT DEFAULT NULL,
    expected_payment_method TEXT DEFAULT NULL,
    delivery_note TEXT DEFAULT NULL,
    guest_count INTEGER,
    special_instructions TEXT,
    packaging_charge NUMERIC(12, 2) DEFAULT 0,
    delivery_charge NUMERIC(12, 2) DEFAULT 0,
    service_charge NUMERIC(12, 2) DEFAULT 0,
    charges_breakdown TEXT,
    status TEXT DEFAULT 'pending',
    subtotal NUMERIC(12, 2) DEFAULT 0,
    tax_amount NUMERIC(12, 2) DEFAULT 0,
    tax_breakdown TEXT,
    tax_snapshot TEXT DEFAULT NULL,
    packaging_tax_category_id TEXT DEFAULT NULL,
    delivery_tax_category_id TEXT DEFAULT NULL,
    service_charge_tax_category_id TEXT DEFAULT NULL,
    discount_amount NUMERIC(12, 2) DEFAULT 0,
    discount_type TEXT,
    discount_value NUMERIC(12, 2),
    discount_reason TEXT,
    round_off NUMERIC(12, 2) DEFAULT 0,
    total NUMERIC(12, 2) DEFAULT 0,
    cooking_started_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    served_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_sku TEXT,
    unit_price NUMERIC(12, 2) NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
    inventory_deducted_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
    inventory_product_id TEXT DEFAULT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    tax_amount NUMERIC(12, 2) DEFAULT 0,
    tax_breakdown TEXT,
    tax_snapshot TEXT DEFAULT NULL,
    tax_type TEXT,
    discount_amount NUMERIC(12, 2) DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL,
    variant_selection TEXT,
    modifier_selection TEXT,
    addons TEXT,
    special_instructions TEXT,
    status TEXT DEFAULT 'pending',
    recipe_snapshot TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_item_addons (
    id BIGSERIAL PRIMARY KEY,
    order_item_id BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    addon_id TEXT NOT NULL,
    addon_name TEXT NOT NULL,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_audit_log (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id BIGINT REFERENCES order_items(id) ON DELETE SET NULL,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    details_json TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS held_orders (
    id BIGSERIAL PRIMARY KEY,
    label TEXT,
    order_data TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Billing & Payments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
    id BIGSERIAL PRIMARY KEY,
    bill_number TEXT UNIQUE NOT NULL,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    customer_id TEXT,
    subtotal NUMERIC(12, 2) DEFAULT 0,
    tax_amount NUMERIC(12, 2) DEFAULT 0,
    tax_breakdown TEXT,
    tax_snapshot TEXT DEFAULT NULL,
    discount_amount NUMERIC(12, 2) DEFAULT 0,
    discount_type TEXT,
    discount_value NUMERIC(12, 2),
    discount_reason TEXT,
    delivery_charge NUMERIC(12, 2) DEFAULT 0,
    packaging_charge NUMERIC(12, 2) DEFAULT 0,
    service_charge NUMERIC(12, 2) DEFAULT 0,
    charges_breakdown TEXT,
    round_off NUMERIC(12, 2) DEFAULT 0,
    total NUMERIC(12, 2) DEFAULT 0,
    paid_amount NUMERIC(12, 2) DEFAULT 0,
    balance NUMERIC(12, 2) DEFAULT 0,
    payment_status TEXT DEFAULT 'unpaid',
    payment_details TEXT,
    paid_at TIMESTAMPTZ,
    printed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_items (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    order_item_id BIGINT,
    product_name TEXT NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL,
    total NUMERIC(12, 2) NOT NULL,
    tax_amount NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES bills(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    reason TEXT NOT NULL,
    method TEXT NOT NULL,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
    id BIGSERIAL PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    bill_id BIGINT REFERENCES bills(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    description TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. Cash Drawer & Closures (Cierre de Caja) ──────────────────────────────
CREATE TABLE IF NOT EXISTS cash_closures (
    id BIGSERIAL PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'day' CHECK (scope IN ('day', 'session')),
    business_date DATE NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    opening_float_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),
    expected_cash_cents INTEGER NOT NULL,
    counted_cash_cents INTEGER NOT NULL CHECK (counted_cash_cents >= 0),
    variance_cents INTEGER NOT NULL,
    gross_collected_cents INTEGER NOT NULL,
    refunded_cents INTEGER NOT NULL,
    net_collected_cents INTEGER NOT NULL,
    bill_count INTEGER NOT NULL,
    refund_count INTEGER NOT NULL,
    payment_methods_json TEXT NOT NULL DEFAULT '[]',
    staff_sales_json TEXT NOT NULL DEFAULT '[]',
    tax_components_json TEXT NOT NULL DEFAULT '[]',
    pay_in_cents INTEGER NOT NULL DEFAULT 0,
    pay_out_cents INTEGER NOT NULL DEFAULT 0,
    safe_drop_cents INTEGER NOT NULL DEFAULT 0,
    cash_movements_json TEXT NOT NULL DEFAULT '[]',
    z_number INTEGER UNIQUE NOT NULL,
    closed_by TEXT NOT NULL REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_drawer_movements (
    id BIGSERIAL PRIMARY KEY,
    business_date DATE NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('opening_float', 'pay_in', 'pay_out', 'safe_drop')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    reason TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voided_at TIMESTAMPTZ,
    voided_by TEXT REFERENCES users(id),
    void_reason TEXT
);

-- ── 8. Inventory, Supplies & Recipes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
    id BIGSERIAL PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_delta NUMERIC(12, 3) NOT NULL CHECK (quantity_delta <> 0),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'cancel_restore', 'adjustment')),
    reference_type TEXT,
    reference_id TEXT,
    reason TEXT,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    stock_after NUMERIC(12, 3) NOT NULL,
    imported_by_user_id TEXT REFERENCES users(id),
    import_batch_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplies (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    base_unit TEXT NOT NULL CHECK (base_unit IN ('each', 'g', 'kg', 'ml', 'l')),
    stock_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
    low_stock_threshold NUMERIC(12, 3),
    is_active INTEGER NOT NULL DEFAULT 1,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supply_movements (
    id BIGSERIAL PRIMARY KEY,
    supply_id TEXT NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
    quantity_delta NUMERIC(12, 3) NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('receive', 'count', 'adjustment', 'waste', 'recipe_depletion', 'recipe_restore')),
    unit TEXT NOT NULL CHECK (unit IN ('each', 'g', 'kg', 'ml', 'l')),
    stock_after NUMERIC(12, 3) NOT NULL,
    reason TEXT,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    reference_type TEXT,
    reference_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    product_id TEXT NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
    yield_quantity NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (yield_quantity > 0),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipe_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    supply_id TEXT NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
    quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL CHECK (unit IN ('each', 'g', 'kg', 'ml', 'l')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. Expenses ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by TEXT NOT NULL REFERENCES users(id),
    updated_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    category_id TEXT NOT NULL REFERENCES expense_categories(id),
    category_name TEXT NOT NULL,
    description TEXT NOT NULL,
    payee TEXT,
    notes TEXT,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
    incurred_on DATE NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    replaces_expense_id TEXT REFERENCES expenses(id),
    voided_at TIMESTAMPTZ,
    voided_by TEXT REFERENCES users(id),
    void_reason TEXT
);

CREATE TABLE IF NOT EXISTS expense_payments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'other')),
    business_date DATE NOT NULL,
    reversal_of TEXT REFERENCES expense_payments(id),
    reason TEXT,
    cash_movement_id BIGINT REFERENCES cash_drawer_movements(id),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 10. Performance Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_addons_group ON addons(addon_group_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_bills_order ON bills(order_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(payment_status);
CREATE INDEX IF NOT EXISTS idx_bills_created ON bills(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplies_name ON supplies(name);
CREATE INDEX IF NOT EXISTS idx_expenses_incurred ON expenses(incurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_cash_closures_date ON cash_closures(business_date DESC);
