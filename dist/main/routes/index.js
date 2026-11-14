"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoutes = registerRoutes;
const crypto_1 = require("crypto");
const auth_1 = require("./auth");
const authorization_1 = require("../services/authorization");
const categories_1 = require("./categories");
const products_1 = require("./products");
const addon_groups_1 = require("./addon-groups");
const orders_1 = require("./orders");
const order_items_1 = require("./order-items");
const bills_1 = require("./bills");
const refunds_1 = require("./refunds");
const cash_closures_1 = require("./cash-closures");
const cash_sessions_1 = require("./cash-sessions");
const inventory_1 = require("./inventory");
const supplies_1 = require("./supplies");
const stock_management_1 = require("./stock-management");
const expenses_1 = require("./expenses");
const recipes_1 = require("./recipes");
const tables_1 = require("./tables");
const kitchen_stations_1 = require("./kitchen-stations");
const kitchen_1 = require("./kitchen");
const customers_1 = require("./customers");
const staff_1 = require("./staff");
const settings_1 = require("./settings");
const payment_methods_1 = require("./payment-methods");
const reports_1 = require("./reports");
const kds_1 = require("./kds");
const customer_display_feed_1 = require("./customer-display-feed");
const kds_info_1 = require("./kds-info");
const pos_info_1 = require("./pos-info");
const server_app_info_1 = require("./server-app-info");
const more_apps_1 = require("./more-apps");
const printers_1 = require("./printers");
const database_1 = require("./database");
const database_tools_1 = require("./database-tools");
const menu_csv_1 = require("./menu-csv");
const tax_packs_1 = require("./tax-packs");
const held_orders_1 = require("./held-orders");
const print_templates_1 = require("./print-templates");
const whatsapp_1 = require("./whatsapp");
const support_ticket_1 = require("./support-ticket");
const diagnostics_1 = require("./diagnostics");
const authorization_2 = require("./authorization");
const counters_1 = require("./counters");
const packaging_profiles_1 = require("./packaging-profiles");
const packaging_1 = require("./packaging");
const delivery_1 = require("./delivery");
const promotions_1 = __importDefault(require("./promotions"));
const db_1 = require("../db");
const cloud_sync_1 = require("../services/cloud-sync");
const operation_failure_1 = require("../lib/operation-failure");
const phone_1 = require("../lib/phone");
const qrcode_1 = __importDefault(require("qrcode"));
const async_handler_1 = require("../middleware/async-handler");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// Distinguish unregistered store error from cloud connectivity failure.
function isUnregisteredCloudError(error) {
    return typeof error?.message === 'string' && error.message.includes('is not registered');
}
function mobilePairingErrorStatus(error) {
    return isUnregisteredCloudError(error) ? 409 : 502;
}
function mobilePairingErrorMessage(error) {
    if (isUnregisteredCloudError(error)) {
        return 'This POS hasn’t been claimed in FloAdmin yet. Complete registration in FloAdmin, then try generating a pairing code again.';
    }
    return error?.message || 'Could not reach FloAdmin';
}
const inlineCustomerLookupRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
function registerRoutes(app) {
    app.use((req, res, next) => {
        res.once('finish', () => {
            const request = req;
            const requestPath = req.path.toLowerCase();
            if (res.statusCode < 500 ||
                !requestPath.startsWith('/api/') ||
                requestPath.startsWith('/api/diagnostics') ||
                request.diagnosticsCaptured)
                return;
            try {
                const operationId = req.get('x-operation-id');
                const failure = (0, operation_failure_1.serializeOperationFailure)({
                    capture_point: 'fc.backend.http.unhandled',
                    outcome: 'unknown',
                    correlation_id: (0, operation_failure_1.isOperationReference)(operationId) ? operationId : (0, crypto_1.randomUUID)(),
                });
                if (failure) {
                    request.diagnosticsCaptured = true;
                    cloud_sync_1.cloudSync.captureOperationFailure(failure);
                }
            }
            catch {
                // Diagnostics are best-effort and must not disrupt a completed response.
            }
        });
        next();
    });
    // Auth routes
    app.use('/api/auth', auth_1.authRoutes);
    // Resource routes
    app.use('/api/categories', categories_1.categoryRoutes);
    app.use('/api/products', products_1.productRoutes);
    app.use('/api/addon-groups', addon_groups_1.addonGroupRoutes);
    app.use('/api/orders', orders_1.orderRoutes);
    app.use('/api/order-items', order_items_1.orderItemRoutes);
    app.use('/api/kitchen', kitchen_1.kitchenRoutes);
    app.use('/api/bills', bills_1.billRoutes);
    app.use('/api/refunds', refunds_1.refundRoutes);
    app.use('/api/cash-closures', cash_closures_1.cashClosureRoutes);
    app.use('/api/cash-sessions', cash_sessions_1.cashSessionRoutes);
    app.use('/api/inventory', inventory_1.inventoryRoutes);
    app.use('/api/supplies', supplies_1.supplyRoutes);
    app.use('/api/stock-management', stock_management_1.stockManagementRoutes);
    app.use('/api/expenses', expenses_1.expenseRoutes);
    app.use('/api/recipes', recipes_1.recipeRoutes);
    app.use('/api/tables', tables_1.tableRoutes);
    app.use('/api/kitchen-stations', kitchen_stations_1.kitchenStationRoutes);
    app.use('/api/customers', customers_1.customerRoutes);
    app.use('/api/staff', staff_1.staffRoutes); // users with POS roles
    app.use('/api/users', staff_1.staffRoutes); // same router, dual-mounted
    app.use('/api/settings', settings_1.settingsRoutes);
    app.use('/api/payment-methods', payment_methods_1.paymentMethodRoutes);
    app.use('/api/reports', reports_1.reportRoutes);
    app.use('/api/kds', kds_1.kdsRoutes);
    app.use('/api/customer-display', customer_display_feed_1.customerDisplayFeedRoutes);
    app.use('/api/kds-info', kds_info_1.kdsInfoRoutes);
    app.use('/api/pos-info', pos_info_1.posInfoRoutes);
    app.use('/api/server-app-info', server_app_info_1.serverAppInfoRoutes);
    app.use('/api/more-apps', more_apps_1.moreAppsRoutes);
    app.use('/api/printers', printers_1.printerRoutes);
    app.use('/api/db', database_1.databaseRoutes);
    app.use('/api/db-tools', database_tools_1.databaseToolsRoutes);
    app.use('/api/menu-csv', menu_csv_1.menuCsvRoutes);
    app.use('/api/tax-packs', tax_packs_1.taxPackRoutes);
    app.use('/api/held-orders', held_orders_1.heldOrderRoutes);
    app.use('/api/print-templates', print_templates_1.printTemplateRoutes);
    app.use('/api/whatsapp', whatsapp_1.whatsappRoutes);
    app.use('/api/support-ticket', support_ticket_1.supportTicketRoutes);
    app.use('/api/diagnostics', diagnostics_1.diagnosticsRoutes);
    app.use('/api/authorization', authorization_2.authorizationRoutes);
    app.use('/api/counters', counters_1.counterRoutes);
    app.use('/api/packaging-profiles', packaging_profiles_1.packagingProfileRoutes);
    app.use('/api/packaging', packaging_1.packagingRoutes);
    app.use('/api/delivery', delivery_1.deliveryRoutes);
    app.use('/api/promotions', promotions_1.default);
    // Tax preview. Priced on every cart change in the prepaid checkout modal, so it
    // has to admit every role that can run a sale; `tax-packs.view-test` (owner and
    // manager) would 403 a cashier mid-checkout, and a 403 makes the API client
    // refresh the whole auth context. Any one of the three sale-facing permissions
    // resolves to the same role set the ungated endpoint had before this migration.
    app.post('/api/tax/preview', (0, authorization_1.requireAnyPermission)('pos.use', 'orders.create', 'kitchen.use'), (0, async_handler_1.asyncHandler)(async (req, res) => {
        const { calculateTaxPreview } = await Promise.resolve().then(() => __importStar(require('../services/tax')));
        calculateTaxPreview(req, res);
    }));
    // Returns active tax categories for product configuration.
    app.get('/api/tax/categories', (0, authorization_1.requirePermission)('tax-packs.view-test'), (0, async_handler_1.asyncHandler)(async (req, res) => {
        try {
            const { getActiveCountryPack, hasConfiguredTaxCategories, previewCategoryRate } = await Promise.resolve().then(() => __importStar(require('../services/tax')));
            const country = (0, db_1.getSettingValue)('country') || '';
            const businessType = (0, db_1.getSettingValue)('business_type') || 'restaurant';
            const pack = getActiveCountryPack(country);
            const configurationReady = hasConfiguredTaxCategories(pack, businessType);
            res.json({
                pack_id: pack.id,
                country: pack.country,
                // Categories available only when configuration is ready.
                categories: configurationReady
                    ? pack.categories.map((category) => {
                        const preview = previewCategoryRate(pack, businessType, category.id);
                        return {
                            id: category.id,
                            label: category.label,
                            rate_percent: preview?.percent ?? null,
                            rate_label: preview?.label ?? null,
                        };
                    })
                    : [],
                default_category_id: configurationReady ? pack.defaultCategories.product : null,
                configuration_ready: configurationReady,
                unclassified_category_id: pack.unclassifiedCategoryId,
            });
        }
        catch (error) {
            console.error('[API] Internal error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }));
    // Returns cached mobile pairing code or generates fresh code if missing or expired.
    app.get('/api/mobile/pairing-code', (0, authorization_1.requirePermission)('mobile-access.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
        try {
            const cached = (0, db_1.getCachedPairingCode)();
            if (cached) {
                return res.json({
                    pairing_code: cached.code,
                    expires_at: cached.expiresAt,
                    qr_data_url: await qrcode_1.default.toDataURL(cached.code, {
                        errorCorrectionLevel: 'M',
                        width: 256,
                    }),
                });
            }
            const { code, expires_at } = await cloud_sync_1.cloudSync.generatePairingCode(false);
            (0, db_1.setCachedPairingCode)(code, expires_at);
            res.json({
                pairing_code: code,
                expires_at,
                qr_data_url: await qrcode_1.default.toDataURL(code, { errorCorrectionLevel: 'M', width: 256 }),
            });
        }
        catch (error) {
            res
                .status(mobilePairingErrorStatus(error))
                .json({ error: mobilePairingErrorMessage(error) });
        }
    }));
    // Explicit rotate — disconnects every currently-paired RevFlo device.
    app.post('/api/mobile/rotate-code', (0, authorization_1.requirePermission)('mobile-access.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
        try {
            const { code, expires_at } = await cloud_sync_1.cloudSync.generatePairingCode(true);
            (0, db_1.setCachedPairingCode)(code, expires_at);
            res.json({
                pairing_code: code,
                expires_at,
                qr_data_url: await qrcode_1.default.toDataURL(code, { errorCorrectionLevel: 'M', width: 256 }),
            });
        }
        catch (error) {
            res
                .status(mobilePairingErrorStatus(error))
                .json({ error: mobilePairingErrorMessage(error) });
        }
    }));
    // Paired RevFlo devices for this store — Settings > Mobile App session list.
    app.get('/api/mobile/devices', (0, authorization_1.requirePermission)('mobile-access.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
        try {
            const devices = await cloud_sync_1.cloudSync.listPairedDevices();
            res.json({ devices });
        }
        catch (error) {
            console.error('[API] FloAdmin request failed:', error);
            res.status(502).json({ error: 'Could not reach FloAdmin' });
        }
    }));
    // Legacy/flat customer search endpoint (frontend uses this)
    app.get('/api/customers-search', inlineCustomerLookupRateLimit, (0, authorization_1.requirePermission)('customers.view'), (req, res) => {
        try {
            const { q } = req.query;
            const rawSearch = String(q || '').trim();
            if (rawSearch.length < 2) {
                return res.json([]);
            }
            const db = (0, db_1.getDatabase)();
            const digitsSearch = (0, phone_1.stripPhoneDigits)(rawSearch);
            const isPhoneLikeSearch = digitsSearch.length > 0 && !/\p{L}/u.test(rawSearch);
            const searchTerm = `%${rawSearch}%`;
            const phoneDigitsSearch = `REPLACE(phone_digits, '/', '')`;
            const query = isPhoneLikeSearch
                ? `
        SELECT * FROM customers
        WHERE is_active = 1 AND (${phoneDigitsSearch} LIKE ? OR name LIKE ? OR email LIKE ?)
        LIMIT 20
      `
                : `
        SELECT * FROM customers
        WHERE is_active = 1 AND (name LIKE ? OR email LIKE ?)
        LIMIT 20
      `;
            const params = isPhoneLikeSearch
                ? [`%${digitsSearch}%`, searchTerm, searchTerm]
                : [searchTerm, searchTerm];
            const customers = db.prepare(query).all(...params);
            const results = customers.map((c) => ({
                ...(0, customers_1.parseCustomer)(c),
                wallet_balance: (0, customers_1.getWalletBalance)(c.id),
            }));
            res.json(results);
        }
        catch (error) {
            console.error('[API] Internal error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    // CRM lookup endpoint (frontend uses this)
    app.get('/api/crm/lookup', inlineCustomerLookupRateLimit, (0, authorization_1.requirePermission)('customers.view'), (req, res) => {
        try {
            const { phone, country_code } = req.query;
            if (!phone) {
                return res.status(400).json({ error: 'Phone number required' });
            }
            const db = (0, db_1.getDatabase)();
            const tenantCountry = (0, db_1.getSettingValue)('country') || '';
            const parsed = (0, phone_1.parsePhoneE164)(String(phone).trim(), tenantCountry);
            const lookupPhone = parsed ? parsed.e164 : String(phone).trim();
            const phoneDigits = (0, phone_1.stripPhoneDigits)(lookupPhone);
            const customer = db
                .prepare('SELECT * FROM customers WHERE phone_digits = ?')
                .get(phoneDigits);
            if (customer) {
                res.json({ found: true, customer });
            }
            else {
                res.json({ found: false, customer: null });
            }
        }
        catch (error) {
            console.error('[API] Internal error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}
//# sourceMappingURL=index.js.map