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
exports.settingsRoutes = void 0;
exports.isOrdersLayout = isOrdersLayout;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const crypto_1 = require("crypto");
const db_1 = require("../db");
const cloud_sync_1 = require("../services/cloud-sync");
const google_drive_1 = require("../services/google-drive");
const authorization_1 = require("../services/authorization");
const customer_display_config_1 = require("../services/customer-display-config");
const customer_display_tokens_1 = require("../services/customer-display-tokens");
const master_pin_1 = require("../middleware/master-pin");
const tax_1 = require("../services/tax");
const telemetry_1 = require("../services/telemetry");
const posthog_1 = require("../services/posthog");
const offline_mode_1 = require("../services/offline-mode");
const whatsapp = __importStar(require("../services/whatsapp"));
const posthog_identity_1 = require("../services/posthog-identity");
const countries_1 = require("../countries");
const country_provenance_1 = require("../services/country-provenance");
const shutdown_1 = require("../shutdown");
const async_handler_1 = require("../middleware/async-handler");
const phone_1 = require("../lib/phone");
const html_to_pdf_1 = require("../services/html-to-pdf");
const pos_sort_1 = require("../lib/pos-sort");
const print_templates_1 = require("../services/print-templates");
const merchant_print_templates_1 = require("../services/merchant-print-templates");
const currency_1 = require("../../shared/print/currency");
const image_raster_1 = require("../../shared/print/image-raster");
const print_language_settings_1 = require("../lib/print-language-settings");
const title_bar_theme_1 = require("../title-bar-theme");
const charges_1 = require("../services/charges");
const router = (0, express_1.Router)();
const configuredSettingsReadLimit = Number.parseInt(process.env.FLO_SETTINGS_READ_RATE_LIMIT_MAX || '', 10);
const settingsReadRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: Number.isFinite(configuredSettingsReadLimit) && configuredSettingsReadLimit > 0
        ? configuredSettingsReadLimit
        : 120,
    standardHeaders: true,
    legacyHeaders: false,
});
const configuredSettingsWriteLimit = Number.parseInt(process.env.FLO_SETTINGS_WRITE_RATE_LIMIT_MAX || '', 10);
const settingsWriteRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    limit: Number.isFinite(configuredSettingsWriteLimit) && configuredSettingsWriteLimit > 0
        ? configuredSettingsWriteLimit
        : 60,
    standardHeaders: true,
    legacyHeaders: false,
});
// ── Helpers ────────────────────────────────────────────────────────────────
function getAllSettings(db) {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const s = {};
    for (const row of rows)
        s[row.key] = row.value;
    return s;
}
function upsertSettings(db, entries) {
    const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
    db.transaction(() => {
        for (const [key, val] of Object.entries(entries)) {
            if (val !== undefined)
                stmt.run(key, val === null ? '' : String(val), (0, db_1.now)());
        }
    })();
}
function validBusinessLocation(timezone, currency, country) {
    if (timezone !== undefined && !(0, countries_1.isValidTimeZone)(timezone))
        return false;
    if (currency !== undefined && !(0, currency_1.isSyntacticallyValidCurrencyCode)(currency))
        return false;
    if (country !== undefined && (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)))
        return false;
    return true;
}
const SENSITIVE_SETTING_KEYS = new Set([
    'mobile_pairing_code',
    'jwt_secret',
    'cloud_api_key',
    'cloud_device_secret',
    'cloud_deletion_status_token',
    'cloud_last_error',
    'posthog_project_token',
    'posthog_host',
]);
function isGoogleDriveSettingKey(key) {
    return key.startsWith('google_drive_');
}
const OPTIONAL_SETTING_DEFAULTS = {
    bill_template: 'classic',
    bill_footer_message: '',
    bill_show_logo: 'false',
    receipt_logo: '',
    receipt_logo_raster: '',
    printer_trim_decimals: 'false',
    auto_print_kot: 'false',
    printer_use_unicode: 'false',
    printer_arabic_shaping: 'false',
    split_checks_enabled: 'false',
    card_transaction_id_required: 'false',
    multi_counter_enabled: 'false',
    require_open_shift: 'false',
    one_shift_per_staff: 'false',
    // Print language policies (#441) — inherit store language, no second
    // language. Defaults preserve pre-policy behavior for existing tenants.
    [print_language_settings_1.BILL_LANGUAGE_POLICY_KEY]: (0, print_language_settings_1.defaultLanguagePolicySettingJson)(),
    [print_language_settings_1.KOT_LANGUAGE_POLICY_KEY]: (0, print_language_settings_1.defaultLanguagePolicySettingJson)(),
    // Iran locale display preferences (Batch G, Refs #241) — display-only.
    currency_display: 'rial',
    number_digits: 'locale',
    calendar: 'locale',
    // Returns 'system' if not yet explicitly saved by the user.
    theme_mode: 'system',
    // Orders screen layout (#639): master/detail split view is the default.
    orders_layout: 'split',
    // POS catalog ordering: 'saved' keeps the stored sort_order.
    pos_category_sort: 'saved',
    pos_item_sort: 'saved',
    // Idle auto-lock timeout in minutes ('0' = off).
    auto_lock_minutes: '0',
};
const VALID_AUTO_LOCK_MINUTES = new Set(['0', '1', '5', '15', '30']);
function normalizeAutoLockMinutes(value) {
    if (value === 0 || value === '0' || value === 'off' || value === false || value === '') {
        return '0';
    }
    const str = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    return VALID_AUTO_LOCK_MINUTES.has(str) ? str : null;
}
/** Single authority for the orders_layout enum; both write transports gate on it. */
function isOrdersLayout(value) {
    return value === 'split' || value === 'cards';
}
function maskSetting(key, value) {
    if (key === 'cloud_last_error')
        return value ? 'Cloud service request failed' : '';
    if (key === 'mobile_pairing_code')
        return value ? '****' : '';
    if (!SENSITIVE_SETTING_KEYS.has(key))
        return value;
    return value ? `****${value.slice(-4)}` : '';
}
function publicSettingsShape(settings) {
    const publicSettings = {};
    for (const [key, value] of Object.entries(settings)) {
        if (isGoogleDriveSettingKey(key))
            continue;
        publicSettings[key] = maskSetting(key, value);
    }
    return publicSettings;
}
function boolFlag(value) {
    if (value === undefined)
        return undefined;
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) ? 'true' : 'false';
    }
    return value ? 'true' : 'false';
}
// Flags stored as strict '1'/'0' to match cloud database conventions.
function bool01Flag(value) {
    const flag = boolFlag(value);
    return flag === undefined ? undefined : flag === 'true' ? '1' : '0';
}
function deriveCurrencySymbol(currency, country) {
    return (0, countries_1.getCurrencySymbol)(currency || '', (0, countries_1.getCountryByCode)(country)?.locale) || currency || '';
}
function isMaskedSecret(value) {
    return typeof value === 'string' && value.startsWith('****');
}
function businessShape(s) {
    return {
        business_name: s.business_name || '',
        // Regional fields degrade to empty rather than throw — Settings must
        // never fail to load for an authenticated user (should be unreachable
        // post-setup; see docs/reference/product-invariants.md).
        timezone: s.timezone || '',
        business_day_start_time: s.business_day_start_time || '00:00',
        currency: s.currency || '',
        country: s.country || '',
        language: s.language || 'en',
        tax_registration_number: s.tax_registration_number || '',
        state_code: s.state_code || '',
        business_address: s.business_address || '',
        business_phone: s.business_phone || '',
        instagram_handle: s.instagram_handle || '',
        billing_type: s.billing_type || 'postpaid',
        tables_required: s.tables_required !== 'false',
        tax_registered: s.tax_registered === 'true' || s.tax_registered === '1',
        bill_show_name: s.bill_show_name !== 'false',
        bill_show_address: s.bill_show_address !== 'false',
        bill_show_phone: s.bill_show_phone !== 'false',
        bill_show_tax_id: s.bill_show_tax_id === 'true',
        bill_show_tax_breakdown: s.bill_show_tax_breakdown !== 'false',
        bill_show_customer_name: s.bill_show_customer_name !== 'false',
        bill_show_customer_phone: s.bill_show_customer_phone !== 'false',
        bill_delivery_show_customer_phone_always: s.bill_delivery_show_customer_phone_always !== 'false',
        bill_show_table_number: s.bill_show_table_number !== 'false',
        bill_show_logo: s.bill_show_logo === 'true',
        receipt_logo: s.receipt_logo || '',
        receipt_logo_raster: s.receipt_logo_raster || '',
        bill_footer_message: s.bill_footer_message || '',
        bill_template: s.bill_template || 'classic',
        currency_display: (0, countries_1.resolveStoredLocalePreference)('currency_display', s.currency_display, s.country || ''),
        number_digits: (0, countries_1.resolveStoredLocalePreference)('number_digits', s.number_digits, s.country || ''),
        calendar: (0, countries_1.resolveStoredLocalePreference)('calendar', s.calendar, s.country || ''),
        auto_lock_minutes: Number(normalizeAutoLockMinutes(s.auto_lock_minutes) || 0),
        // Non-blocking informational tax format description for the UI.
        tax_id_format: (0, tax_1.resolveTaxIdFormat)(s.country || ''),
    };
}
function taxShape(s) {
    return {
        tax_registered: s.tax_registered === 'true',
        tax_registration_number: s.tax_registration_number || '',
        state_code: s.state_code || '',
        tax_scheme: s.tax_scheme || 'regular',
        country: s.country || '',
        tax_id_format: (0, tax_1.resolveTaxIdFormat)(s.country || ''),
    };
}
// ── Specific routes (must come BEFORE /:key wildcard) ─────────────────────
const requireBusinessSettingsRead = (req, res, next) => {
    const userId = String(req.user?.userId || '');
    if (!userId) {
        return res
            .status(401)
            .json({ error: 'Authentication required', code: 'authentication_required' });
    }
    const effective = (0, authorization_1.resolveEffectivePermissions)(userId);
    if (!effective ||
        !['settings.view', 'bills.read', 'bills.print', 'bills.generate'].some((permissionId) => effective.permissionIds.has(permissionId))) {
        return res.status(403).json({
            error: 'Insufficient permissions',
            code: 'permission_denied',
            permission: 'settings.view',
        });
    }
    next();
};
router.get('/business', requireBusinessSettingsRead, (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json(businessShape(s));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/business', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const { business_name, timezone, business_day_start_time, currency, country, language, tax_registration_number, state_code, business_address, business_phone, instagram_handle, billing_type, tables_required, tax_registered, bill_show_name, bill_show_address, bill_show_phone, bill_show_tax_id, bill_show_tax_breakdown, bill_show_customer_name, bill_show_customer_phone, bill_show_table_number, bill_delivery_show_customer_phone_always, receipt_logo, receipt_logo_raster, bill_show_logo, currency_display, number_digits, calendar, } = req.body;
        const normalizedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : currency;
        const normalizedInstagramHandle = instagram_handle !== undefined
            ? String(instagram_handle || '')
                .trim()
                .slice(0, 100)
            : undefined;
        let normalizedReceiptLogo = undefined;
        if (receipt_logo !== undefined) {
            if (typeof receipt_logo !== 'string') {
                return res.status(400).json({ error: 'receipt_logo must be a string' });
            }
            if (receipt_logo.length > 250_000) {
                return res.status(400).json({ error: 'receipt_logo exceeds maximum size (250 KB)' });
            }
            if (receipt_logo.length > 0 && !receipt_logo.startsWith('data:image/')) {
                return res.status(400).json({ error: 'receipt_logo must be a valid data URI' });
            }
            normalizedReceiptLogo = receipt_logo;
        }
        let normalizedReceiptLogoRaster = undefined;
        if (receipt_logo_raster !== undefined) {
            if (typeof receipt_logo_raster !== 'string') {
                return res.status(400).json({ error: 'receipt_logo_raster must be a string' });
            }
            if (receipt_logo_raster.length > 250_000) {
                return res.status(400).json({ error: 'receipt_logo_raster exceeds maximum size (250 KB)' });
            }
            if (receipt_logo_raster.length > 0 && !(0, image_raster_1.parseReceiptLogoData)(receipt_logo_raster)) {
                return res
                    .status(400)
                    .json({ error: 'receipt_logo_raster must contain valid raster data' });
            }
            normalizedReceiptLogoRaster = receipt_logo_raster;
        }
        if (!validBusinessLocation(timezone, normalizedCurrency, country)) {
            return res.status(400).json({ error: 'Invalid timezone, currency, or country' });
        }
        if (business_day_start_time !== undefined) {
            if (typeof business_day_start_time !== 'string' ||
                !/^(?:0\d|1[01]):[0-5]\d$/.test(business_day_start_time.trim())) {
                return res.status(400).json({
                    error: 'Invalid business_day_start_time format (must be HH:mm between 00:00 and 11:59)',
                });
            }
        }
        const db = (0, db_1.getDatabase)();
        const currentSettings = getAllSettings(db);
        if (normalizedCurrency !== undefined && normalizedCurrency !== currentSettings.currency) {
            return res.status(409).json({
                error: 'currency_change_requires_reset',
                current_currency: currentSettings.currency || '',
                requested_currency: normalizedCurrency,
            });
        }
        const effectiveCountry = country || currentSettings.country || '';
        const effectiveCurrency = normalizedCurrency || currentSettings.currency || '';
        // Validate locale preferences against country options, normalizing unsupported legacy values.
        const localeUpdates = {};
        for (const { key, submitted } of [
            { key: 'currency_display', submitted: currency_display },
            { key: 'number_digits', submitted: number_digits },
            { key: 'calendar', submitted: calendar },
        ]) {
            if (submitted !== undefined) {
                if (typeof submitted !== 'string' ||
                    !(0, countries_1.isLocalePreferenceSupported)(key, submitted, effectiveCountry)) {
                    return res.status(400).json({ error: `Invalid ${key} for country ${effectiveCountry}` });
                }
                localeUpdates[key] = submitted;
            }
            else {
                localeUpdates[key] = (0, countries_1.resolveStoredLocalePreference)(key, currentSettings[key], effectiveCountry);
            }
        }
        if (tax_registration_number) {
            const { valid, format } = (0, tax_1.validateTaxRegistrationNumber)(effectiveCountry, tax_registration_number);
            if (!valid && format) {
                return res.status(400).json({
                    error: `Tax ID does not match the expected ${effectiveCountry} format: ${format.description}`,
                    tax_id_format: format,
                });
            }
        }
        let normalizedPhone = undefined;
        if (business_phone !== undefined) {
            const phoneRes = (0, phone_1.normalizeOptionalPhone)(business_phone, effectiveCountry);
            if (!phoneRes.valid) {
                return res.status(400).json({ error: phoneRes.error || 'Invalid business phone number' });
            }
            normalizedPhone = phoneRes.e164 || '';
        }
        upsertSettings(db, {
            business_name,
            timezone,
            business_day_start_time: business_day_start_time !== undefined ? business_day_start_time.trim() : undefined,
            currency: normalizedCurrency,
            country,
            language,
            currency_symbol: normalizedCurrency !== undefined || country !== undefined
                ? deriveCurrencySymbol(effectiveCurrency, effectiveCountry)
                : undefined,
            tax_registration_number,
            state_code,
            business_address,
            business_phone: normalizedPhone !== undefined ? normalizedPhone : undefined,
            instagram_handle: normalizedInstagramHandle,
            billing_type,
            tables_required,
            tax_registered,
            bill_show_name,
            bill_show_address,
            bill_show_phone,
            bill_show_tax_id,
            bill_show_tax_breakdown,
            bill_show_customer_name,
            bill_show_customer_phone,
            bill_show_table_number,
            bill_delivery_show_customer_phone_always,
            bill_show_logo: boolFlag(bill_show_logo),
            receipt_logo: normalizedReceiptLogo,
            receipt_logo_raster: normalizedReceiptLogoRaster,
            ...localeUpdates,
            // Only mark country as user-confirmed if it actually changed in this submission.
            ...(0, country_provenance_1.countryConfirmationPatch)(country, currentSettings.country, req.body.country_selected),
        });
        cloud_sync_1.cloudSync.refreshRegistrationProfile();
        (0, posthog_1.syncPostHogIdentity)();
        res.json(businessShape(getAllSettings(db)));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/tax', (0, authorization_1.requirePermission)('settings.view'), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json(taxShape(s));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/tax', (0, authorization_1.requirePermission)('tax-configuration.manage'), (req, res) => {
    try {
        const { tax_registered, tax_registration_number, state_code, tax_scheme, country } = req.body;
        if (!validBusinessLocation(undefined, undefined, country)) {
            return res.status(400).json({ error: 'Invalid country' });
        }
        const db = (0, db_1.getDatabase)();
        const currentSettings = getAllSettings(db);
        const effectiveCountry = country || currentSettings.country || '';
        if (tax_registration_number) {
            const { valid, format } = (0, tax_1.validateTaxRegistrationNumber)(effectiveCountry, tax_registration_number);
            if (!valid && format) {
                return res.status(400).json({
                    error: `Tax ID does not match the expected ${effectiveCountry} format: ${format.description}`,
                    tax_id_format: format,
                });
            }
        }
        upsertSettings(db, {
            tax_registered,
            tax_registration_number,
            state_code,
            tax_scheme,
            country,
            currency_symbol: country !== undefined
                ? deriveCurrencySymbol(currentSettings.currency || '', country || currentSettings.country || '')
                : undefined,
        });
        cloud_sync_1.cloudSync.refreshRegistrationProfile();
        res.json(taxShape(getAllSettings(db)));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/loyalty', (0, authorization_1.requirePermission)('settings.view'), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({
            loyalty_enabled: s.loyalty_enabled === 'true' || s.loyalty_enabled === '1',
            global_cashback_percent: parseFloat(s.global_cashback_percent || '0'),
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/loyalty', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const { loyalty_enabled, global_cashback_percent } = req.body;
        let finalGlobalCb = undefined;
        if (global_cashback_percent !== undefined) {
            if (typeof global_cashback_percent !== 'number' ||
                !Number.isFinite(global_cashback_percent) ||
                global_cashback_percent < 0 ||
                global_cashback_percent > 100) {
                return res
                    .status(400)
                    .json({ error: 'Global cashback percent must be a number between 0 and 100' });
            }
            finalGlobalCb = global_cashback_percent;
        }
        const db = (0, db_1.getDatabase)();
        upsertSettings(db, {
            loyalty_enabled,
            ...(finalGlobalCb !== undefined && { global_cashback_percent: String(finalGlobalCb) }),
        });
        const s = getAllSettings(db);
        res.json({
            loyalty_enabled: s.loyalty_enabled === 'true' || s.loyalty_enabled === '1',
            global_cashback_percent: parseFloat(s.global_cashback_percent || '0'),
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── Discount settings ──────────────────────────────────────────────────────
router.get('/discount', (0, authorization_1.requirePermission)('settings.view'), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({
            discount_max_percentage: parseFloat(s.discount_max_percentage || '25'),
            discount_max_amount: parseFloat(s.discount_max_amount || '0'),
            discount_mode: s.discount_mode || 'percentage',
            discount_requires_approval: s.discount_requires_approval === 'true' || s.discount_requires_approval === '1',
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/discount', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const { discount_max_percentage, discount_max_amount, discount_mode, discount_requires_approval, } = req.body;
        // Validate inputs
        if (discount_max_percentage !== undefined) {
            const val = parseFloat(discount_max_percentage);
            if (isNaN(val) || val < 1 || val > 100) {
                return res
                    .status(400)
                    .json({ error: 'discount_max_percentage must be a number between 1 and 100' });
            }
        }
        if (discount_max_amount !== undefined) {
            const val = parseFloat(discount_max_amount);
            if (isNaN(val) || val < 0 || val > 999999) {
                return res
                    .status(400)
                    .json({ error: 'discount_max_amount must be a number between 0 and 999999' });
            }
        }
        if (discount_mode !== undefined &&
            !['percentage', 'flat', 'both', 'none'].includes(discount_mode)) {
            return res
                .status(400)
                .json({ error: 'discount_mode must be "percentage", "flat", "both", or "none"' });
        }
        const db = (0, db_1.getDatabase)();
        upsertSettings(db, {
            discount_max_percentage,
            discount_max_amount,
            discount_mode,
            discount_requires_approval: discount_requires_approval === true || discount_requires_approval === 'true'
                ? 'true'
                : 'false',
        });
        const s = getAllSettings(db);
        res.json({
            discount_max_percentage: parseFloat(s.discount_max_percentage || '25'),
            discount_max_amount: parseFloat(s.discount_max_amount || '0'),
            discount_mode: s.discount_mode || 'percentage',
            discount_requires_approval: s.discount_requires_approval === 'true' || s.discount_requires_approval === '1',
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── KDS settings (must come BEFORE /:key wildcard) ─────────────────────────
// Mirrors KDS default view for the dashboard settings page.
router.get('/kds', (0, authorization_1.requirePermission)('settings.view'), (_req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({
            kds_default_view: s.kds_default_view === 'kanban' ? 'kanban' : 'tabs',
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/kds', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const { kds_default_view } = req.body;
        if (kds_default_view !== undefined && !['tabs', 'kanban'].includes(kds_default_view)) {
            return res.status(400).json({ error: 'kds_default_view must be "tabs" or "kanban"' });
        }
        if (kds_default_view !== undefined) {
            upsertSettings((0, db_1.getDatabase)(), { kds_default_view });
        }
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({
            kds_default_view: s.kds_default_view === 'kanban' ? 'kanban' : 'tabs',
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── Product analytics sharing level (must come BEFORE /:key wildcard) ──────
router.get('/product-analytics', (0, authorization_1.requirePermission)('settings.manage'), (_req, res) => {
    try {
        res.json((0, posthog_1.readProductAnalyticsChoice)());
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// `off` also stops the anonymous collector; the other levels keep it on.
router.put('/product-analytics', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const level = (0, posthog_identity_1.parseProductAnalyticsLevel)(req.body?.level);
        if (!level) {
            return res.status(400).json({ error: 'level must be "full", "anonymous" or "off"' });
        }
        const telemetry = level === 'off' ? 'false' : 'true';
        upsertSettings((0, db_1.getDatabase)(), {
            [posthog_identity_1.PRODUCT_ANALYTICS_LEVEL_SETTING]: level,
            telemetry_enabled: telemetry,
            anonymous_data_consent: telemetry,
        });
        (0, posthog_1.syncPostHogIdentity)();
        res.json((0, posthog_1.readProductAnalyticsChoice)());
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── POS catalog sort (must come BEFORE /:key wildcard) ─────────────────────
// Every role that can ring up orders needs the ordering, not only settings.view.
router.get('/pos-sort', settingsReadRateLimit, (0, authorization_1.requireAnyPermission)('settings.view', 'orders.read', 'orders.create'), (_req, res) => {
    try {
        res.json((0, pos_sort_1.readPosSortSettings)(getAllSettings((0, db_1.getDatabase)())));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── Customer display settings (must come BEFORE /:key wildcard) ────────────
// The board runs under any role that can see orders, so reads are not limited to settings.view.
router.get('/customer-display', settingsReadRateLimit, (0, authorization_1.requireAnyPermission)('settings.view', 'orders.read', 'orders.create'), (_req, res) => {
    try {
        res.json((0, customer_display_config_1.readStoredCustomerDisplayConfig)(getAllSettings((0, db_1.getDatabase)())[customer_display_config_1.CUSTOMER_DISPLAY_KEY]));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/customer-display', settingsWriteRateLimit, (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const config = (0, customer_display_config_1.parseCustomerDisplayConfig)(req.body);
        if (!config) {
            return res.status(400).json({ error: 'Invalid customer display settings' });
        }
        upsertSettings((0, db_1.getDatabase)(), { [customer_display_config_1.CUSTOMER_DISPLAY_KEY]: JSON.stringify(config) });
        res.json(config);
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/customer-display/tokens', settingsReadRateLimit, (0, authorization_1.requirePermission)('settings.manage'), (_req, res) => {
    try {
        res.json({ tokens: (0, customer_display_tokens_1.listDisplayTokens)() });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// The plaintext token is returned once, on creation; only its hash is stored.
router.post('/customer-display/tokens', settingsWriteRateLimit, (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const label = (0, customer_display_tokens_1.normalizeTokenLabel)(req.body?.label);
        if (!label) {
            return res.status(400).json({ error: 'A label of 1-60 characters is required' });
        }
        if ((0, customer_display_tokens_1.hasReachedTokenLimit)()) {
            return res.status(409).json({ error: 'customer_display_token_limit' });
        }
        const actor = req.user?.userId ?? null;
        res.status(201).json((0, customer_display_tokens_1.createDisplayToken)(label, actor));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.delete('/customer-display/tokens/:id', settingsWriteRateLimit, (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        if (!(0, customer_display_tokens_1.revokeDisplayToken)(String(req.params.id))) {
            return res.status(404).json({ error: 'Display token not found' });
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ─── Order numbering settings (must come BEFORE /:key wildcard) ─────────────
const INVOICE_RESET_PERIODS = new Set(['never', 'daily', 'monthly', 'financial_year']);
function orderNumberingShape(s) {
    const resetPeriod = INVOICE_RESET_PERIODS.has(s.invoice_number_reset_period)
        ? s.invoice_number_reset_period
        : 'daily';
    const orderResetDaily = s.order_number_reset_daily !== 'false';
    return {
        order_number_prefix: s.order_number_prefix ?? 'ORD',
        order_number_include_date: (0, db_1.orderNumberIncludesDate)(s.order_number_include_date !== 'false', orderResetDaily),
        order_number_reset_daily: orderResetDaily,
        invoice_number_prefix: s.invoice_number_prefix ?? 'INV',
        invoice_number_include_period: (0, db_1.invoiceNumberIncludesPeriod)(s.invoice_number_include_period !== 'false', resetPeriod),
        invoice_number_reset_period: resetPeriod,
        invoice_financial_year_start_month: parseBoundedInt(s.invoice_financial_year_start_month, 1, 12, 4),
        invoice_financial_year_start_day: parseBoundedInt(s.invoice_financial_year_start_day, 1, 31, 1),
    };
}
// Alphanumeric only to avoid collisions with automatic hyphen separators.
const ORDER_NUMBER_PREFIX_PATTERN = /^[A-Za-z0-9]{0,12}$/;
function parseBoundedInt(value, min, max, fallback) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
router.get('/order-numbering', (0, authorization_1.requirePermission)('settings.view'), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json(orderNumberingShape(s));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/order-numbering', (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const { order_number_prefix, order_number_include_date, order_number_reset_daily, invoice_number_prefix, invoice_number_include_period, invoice_number_reset_period, invoice_financial_year_start_month, invoice_financial_year_start_day, } = req.body;
        if (order_number_prefix !== undefined &&
            !ORDER_NUMBER_PREFIX_PATTERN.test(order_number_prefix)) {
            return res
                .status(400)
                .json({ error: 'order_number_prefix must be up to 12 letters and numbers only' });
        }
        if (invoice_number_prefix !== undefined &&
            !ORDER_NUMBER_PREFIX_PATTERN.test(invoice_number_prefix)) {
            return res
                .status(400)
                .json({ error: 'invoice_number_prefix must be up to 12 letters and numbers only' });
        }
        if (invoice_number_reset_period !== undefined &&
            !INVOICE_RESET_PERIODS.has(invoice_number_reset_period)) {
            return res.status(400).json({
                error: 'invoice_number_reset_period must be one of never, daily, monthly, financial_year',
            });
        }
        if (invoice_financial_year_start_month !== undefined &&
            parseBoundedInt(invoice_financial_year_start_month, 1, 12, NaN) !==
                Number(invoice_financial_year_start_month)) {
            return res.status(400).json({
                error: 'invoice_financial_year_start_month must be a whole number between 1 and 12',
            });
        }
        if (invoice_financial_year_start_day !== undefined &&
            parseBoundedInt(invoice_financial_year_start_day, 1, 31, NaN) !==
                Number(invoice_financial_year_start_day)) {
            return res.status(400).json({
                error: 'invoice_financial_year_start_day must be a whole number between 1 and 31',
            });
        }
        const db = (0, db_1.getDatabase)();
        db.transaction(() => {
            upsertSettings(db, {
                order_number_prefix,
                order_number_include_date: boolFlag(order_number_include_date),
                order_number_reset_daily: boolFlag(order_number_reset_daily),
                invoice_number_prefix,
                invoice_number_include_period: boolFlag(invoice_number_include_period),
                invoice_number_reset_period,
                invoice_financial_year_start_month,
                invoice_financial_year_start_day,
            });
            // Persist the effective flags so a series that must carry its date or period never
            // stores a contradictory "off" that would resurface when the reset option changes.
            const effective = orderNumberingShape(getAllSettings(db));
            upsertSettings(db, {
                order_number_include_date: String(effective.order_number_include_date),
                invoice_number_include_period: String(effective.invoice_number_include_period),
            });
        })();
        res.json(orderNumberingShape(getAllSettings(db)));
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
function publicDeletionRequest(request) {
    if (!request)
        return null;
    const safe = {};
    const requestId = request.request_id ?? request.id;
    if (typeof requestId === 'string' && requestId)
        safe.id = requestId;
    if (typeof request.status === 'string')
        safe.status = request.status;
    if (typeof request.requested_at === 'string')
        safe.requested_at = request.requested_at;
    if (typeof request.reviewed_at === 'string' || request.reviewed_at === null)
        safe.reviewed_at = request.reviewed_at;
    if (typeof request.decision_note === 'string')
        safe.decision_note = request.decision_note;
    return safe;
}
function publicEmailPreferences(data) {
    return {
        email: typeof data.email === 'string' ? data.email : null,
        verified: data.verified === true,
        verified_at: typeof data.verified_at === 'string' || data.verified_at === null ? data.verified_at : null,
        verification_sent_at: typeof data.verification_sent_at === 'string' || data.verification_sent_at === null
            ? data.verification_sent_at
            : null,
        product_updates: data.product_updates === true,
        marketing: data.marketing === true,
    };
}
const CLOUD_ACCOUNT_UNAVAILABLE_ERROR = 'Cloud account services are unavailable while Cloud services are stopped or unregistered';
// ─── Cloud Sync settings (must come BEFORE /:key wildcard) ──────────────────
router.get('/cloud', (0, authorization_1.requirePermission)('cloud.manage'), (req, res) => {
    try {
        res.json(cloud_sync_1.cloudSync.getStatus());
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/cloud', (0, authorization_1.requirePermission)('cloud.manage'), (req, res) => {
    try {
        const { cloud_server_url, cloud_api_key, cloud_store_id, cloud_sync_enabled, cloud_orders_enabled, cloud_reports_enabled, cloud_command_polling_enabled, } = req.body;
        const isOwner = req.user?.role === 'owner';
        const hasUnmaskedApiKey = cloud_api_key !== undefined && !isMaskedSecret(cloud_api_key);
        if (!isOwner &&
            (cloud_server_url !== undefined || hasUnmaskedApiKey || cloud_store_id !== undefined)) {
            return res
                .status(403)
                .json({ error: 'Only the store owner can modify cloud credentials or server URL' });
        }
        const db = (0, db_1.getDatabase)();
        const updates = {
            cloud_store_id: cloud_store_id === undefined ? undefined : String(cloud_store_id || ''),
            cloud_sync_enabled: bool01Flag(cloud_sync_enabled),
            cloud_orders_enabled: bool01Flag(cloud_orders_enabled),
            cloud_reports_enabled: bool01Flag(cloud_reports_enabled),
            cloud_command_polling_enabled: bool01Flag(cloud_command_polling_enabled),
        };
        if (cloud_server_url !== undefined) {
            updates.cloud_server_url = (0, cloud_sync_1.normalizeCloudServerUrl)(cloud_server_url || cloud_sync_1.DEFAULT_CLOUD_SERVER_URL);
        }
        if (hasUnmaskedApiKey) {
            updates.cloud_api_key = String(cloud_api_key || '');
        }
        const enablingCloud = [
            cloud_sync_enabled,
            cloud_orders_enabled,
            cloud_reports_enabled,
            cloud_command_polling_enabled,
        ].some((value) => bool01Flag(value) === '1');
        const resumingStoppedCloud = cloud_sync_1.cloudSync.getStatus().cloud_services_disabled_by_user && enablingCloud;
        if (resumingStoppedCloud) {
            // Stop All disables every cloud feature. Re-enabling the Cloud Services
            // control is a resume action, not just a sync preference change.
            updates.cloud_sync_enabled = '1';
            updates.cloud_orders_enabled = '1';
            updates.cloud_reports_enabled = '1';
            updates.cloud_command_polling_enabled = '1';
        }
        if (enablingCloud)
            updates.cloud_services_disabled_by_user = 'false';
        if (enablingCloud && cloud_sync_1.cloudSync.getStatus().cloud_deletion_blocked) {
            return res.status(409).json({
                error: 'Cloud deletion is unresolved; retry or cancel it before re-enabling cloud services.',
            });
        }
        upsertSettings(db, updates);
        cloud_sync_1.cloudSync.reload();
        cloud_sync_1.cloudSync.refreshRegistrationProfile();
        res.json(cloud_sync_1.cloudSync.getStatus());
    }
    catch (error) {
        console.error('[API] Cloud settings update failed:', error);
        res.status(400).json({ error: 'Invalid cloud settings' });
    }
});
router.post('/cloud/register', (0, authorization_1.requirePermission)('cloud.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        let requestedUrl;
        if (req.body?.cloud_server_url !== undefined) {
            if (req.user?.role !== 'owner') {
                return res
                    .status(403)
                    .json({ error: 'Only the store owner can modify cloud credentials or server URL' });
            }
            requestedUrl = (0, cloud_sync_1.normalizeCloudServerUrl)(req.body.cloud_server_url || cloud_sync_1.DEFAULT_CLOUD_SERVER_URL);
        }
        const deletionRequest = await cloud_sync_1.cloudSync.getDeletionRequestStatus({
            allowRemote: cloud_sync_1.cloudSync.isCloudAccountAvailable(),
            signal: (0, shutdown_1.getHttpRequestSignal)(req),
        });
        if (deletionRequest?.status === 'pending') {
            return res.status(409).json({
                error: 'A cloud deletion request is pending review. Cancel it before re-enabling cloud services.',
            });
        }
        const currentStatus = cloud_sync_1.cloudSync.getStatus();
        if (currentStatus.cloud_services_disabled_by_user) {
            return res.status(409).json({ error: CLOUD_ACCOUNT_UNAVAILABLE_ERROR });
        }
        if (currentStatus.cloud_deletion_blocked) {
            return res.status(409).json({
                error: 'Cloud deletion is unresolved; retry or cancel it before re-enabling cloud services.',
            });
        }
        if (requestedUrl !== undefined) {
            upsertSettings((0, db_1.getDatabase)(), {
                cloud_server_url: requestedUrl,
            });
            cloud_sync_1.cloudSync.reload();
        }
        // Registration sends contact metadata for FloAdmin support; it does not
        // create a cloud owner account or grant authentication access.
        await cloud_sync_1.cloudSync.register((0, shutdown_1.getHttpRequestSignal)(req));
        upsertSettings((0, db_1.getDatabase)(), {
            cloud_sync_enabled: '1',
            cloud_reports_enabled: '1',
            cloud_command_polling_enabled: '1',
            cloud_services_disabled_by_user: 'false',
        });
        cloud_sync_1.cloudSync.reload();
        res.json(cloud_sync_1.cloudSync.getStatus());
    }
    catch (error) {
        console.error('[API] Cloud registration failed:', error);
        res.status(502).json({ error: 'Cloud registration failed' });
    }
}));
router.post('/cloud/test', (0, authorization_1.requirePermission)('cloud.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const result = await cloud_sync_1.cloudSync.testConnection((0, shutdown_1.getHttpRequestSignal)(req));
        res.json(result);
    }
    catch (error) {
        console.error('[API] Cloud test failed:', error);
        res.status(502).json({ error: 'Cloud test failed' });
    }
}));
router.get('/cloud/account', (0, authorization_1.requirePermission)('cloud.account.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const cloudAccountAvailable = cloud_sync_1.cloudSync.isCloudAccountAvailable();
        const signal = (0, shutdown_1.getHttpRequestSignal)(req);
        const deletionRequest = await cloud_sync_1.cloudSync.getDeletionRequestStatus({
            allowRemote: cloudAccountAvailable,
            signal,
        });
        const safeDeletionRequest = publicDeletionRequest(deletionRequest);
        if (deletionRequest?.status === 'approved' || !cloud_sync_1.cloudSync.isCloudAccountAvailable()) {
            return res.json({
                email: null,
                verified: false,
                verified_at: null,
                verification_sent_at: null,
                product_updates: false,
                marketing: false,
                cloud_account_available: false,
                deletion_request: safeDeletionRequest,
            });
        }
        res.json({
            ...publicEmailPreferences(await cloud_sync_1.cloudSync.getEmailPreferences(signal)),
            cloud_account_available: true,
            deletion_request: safeDeletionRequest,
        });
    }
    catch {
        res.status(502).json({ error: 'Could not load cloud account status' });
    }
}));
router.put('/cloud/account/preferences', (0, authorization_1.requirePermission)('cloud.account.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!cloud_sync_1.cloudSync.isCloudAccountAvailable()) {
        return res.status(409).json({ error: CLOUD_ACCOUNT_UNAVAILABLE_ERROR });
    }
    try {
        res.json(publicEmailPreferences(await cloud_sync_1.cloudSync.updateEmailPreferences({
            product_updates: req.body?.product_updates,
            marketing: req.body?.marketing,
        }, (0, shutdown_1.getHttpRequestSignal)(req))));
    }
    catch {
        res.status(502).json({ error: 'Could not update email preferences' });
    }
}));
function describeVerificationFailure(error) {
    if (error instanceof cloud_sync_1.CloudRequestError) {
        return `FloAdmin rejected the request (HTTP ${error.status}): ${error.message}`;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        return 'FloAdmin did not respond in time';
    }
    if (error instanceof TypeError) {
        const cause = error.cause?.code;
        return `Could not reach FloAdmin${cause ? ` (${cause})` : ''}`;
    }
    return message;
}
router.post('/cloud/account/verification', (0, authorization_1.requirePermission)('cloud.account.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!cloud_sync_1.cloudSync.isCloudAccountAvailable()) {
        return res.status(409).json({ error: CLOUD_ACCOUNT_UNAVAILABLE_ERROR });
    }
    try {
        res.json(publicEmailPreferences(await cloud_sync_1.cloudSync.requestEmailVerification({ source: 'settings' }, (0, shutdown_1.getHttpRequestSignal)(req))));
    }
    catch (error) {
        console.error('[Cloud] Verification email request failed:', error);
        res.status(502).json({ error: describeVerificationFailure(error) });
    }
}));
router.get('/cloud/delete-data/status', (0, authorization_1.requirePermission)('cloud.account.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const deletionRequest = await cloud_sync_1.cloudSync.getDeletionRequestStatus({
            allowRemote: true,
            signal: (0, shutdown_1.getHttpRequestSignal)(req),
        });
        res.json({
            cloud_account_available: cloud_sync_1.cloudSync.isCloudAccountAvailable(),
            deletion_request: publicDeletionRequest(deletionRequest),
        });
    }
    catch {
        res.status(502).json({ error: 'Could not refresh cloud deletion status' });
    }
}));
router.post('/cloud/stop-all', (0, authorization_1.requirePermission)('cloud.account.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json(await cloud_sync_1.cloudSync.stopAllCloudServices((0, shutdown_1.getHttpRequestSignal)(req)));
}));
router.post('/cloud/delete-data', (0, authorization_1.requirePermission)('cloud.account.manage'), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (req.body?.confirmation !== 'DELETE CLOUD DATA') {
        return res.status(400).json({ error: 'Type DELETE CLOUD DATA to confirm' });
    }
    try {
        res.json(await cloud_sync_1.cloudSync.deleteCloudData((0, shutdown_1.getHttpRequestSignal)(req)));
    }
    catch {
        res.status(502).json({ error: 'Cloud data deletion failed' });
    }
}));
router.post('/cloud/delete-data/cancel', (0, authorization_1.requirePermission)('cloud.account.manage'), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        res.json(await cloud_sync_1.cloudSync.cancelDeletionRequest((0, shutdown_1.getHttpRequestSignal)(req)));
    }
    catch {
        res.status(502).json({ error: 'Could not cancel deletion request' });
    }
}));
// Google Drive endpoints return only redacted status or an allowlisted error code.
function googleDriveErrorResponse(res, error) {
    const code = (0, google_drive_1.getGoogleDriveErrorCode)(error);
    let status = 502;
    if (code === 'menu_pdf_too_large')
        status = 413;
    else if (code === 'menu_not_published')
        status = 404;
    else if (code === 'permission_denied')
        status = 403;
    else if (code === 'conflict')
        status = 409;
    else if ([
        'warning_acknowledgement_required',
        'restore_validation_failed',
        'preferences_invalid',
        'menu_pdf_invalid',
    ].includes(code))
        status = 400;
    else if (['offline', 'rate_limited'].includes(code))
        status = 503;
    else if ([
        'configuration_unavailable',
        'secure_storage_unavailable',
        'not_connected',
        'reauth_required',
        'destination_required',
        'destination_invalid',
        'menu_file_invalid',
    ].includes(code))
        status = 409;
    return res.status(status).json({ error: code });
}
const requireQrMenuPermission = (0, authorization_1.requireAnyPermission)('catalog.manage', 'google-drive.manage');
router.get('/google-drive/qr-menu', requireQrMenuPermission, (0, async_handler_1.asyncHandler)(async (_req, res) => {
    try {
        return res.json(await google_drive_1.googleDrive.getQrMenuStatus());
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.put('/google-drive/qr-menu/preferences', requireQrMenuPermission, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        return res.json(await google_drive_1.googleDrive.saveQrMenuGeneratorPrefs(req.body));
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.post('/google-drive/qr-menu/generate', requireQrMenuPermission, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const html = req.body?.html;
        if (typeof html !== 'string' || html.length === 0)
            return res.status(400).json({ error: 'menu_pdf_invalid' });
        if (Buffer.byteLength(html, 'utf8') > html_to_pdf_1.MAX_PDF_HTML_BYTES)
            return res.status(413).json({ error: 'menu_pdf_too_large' });
        const pdfBuffer = await (0, html_to_pdf_1.renderHtmlToPdfBuffer)({ html, pageSize: req.body?.pageSize });
        return res.json(await google_drive_1.googleDrive.publishQrMenuPdf({
            pdfBuffer,
            source: 'generated',
            generatorPrefs: req.body?.preferences,
        }));
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.post('/google-drive/qr-menu/upload', requireQrMenuPermission, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        if (req.body?.mimeType !== 'application/pdf' ||
            typeof req.body?.fileName !== 'string' ||
            !req.body.fileName.toLowerCase().endsWith('.pdf') ||
            typeof req.body?.data !== 'string')
            return res.status(400).json({ error: 'menu_pdf_invalid' });
        const pdfBuffer = Buffer.from(req.body.data, 'base64');
        return res.json(await google_drive_1.googleDrive.publishQrMenuPdf({ pdfBuffer, source: 'uploaded' }));
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.put('/google-drive/qr-menu/sharing', requireQrMenuPermission, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        if (typeof req.body?.enabled !== 'boolean')
            return res.status(400).json({ error: 'preferences_invalid' });
        return res.json(await google_drive_1.googleDrive.setQrMenuSharing(req.body.enabled));
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.get('/google-drive', (0, authorization_1.requirePermission)('google-drive.manage'), (_req, res) => {
    try {
        return res.json(google_drive_1.googleDrive.getStatus());
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
});
router.put('/google-drive', (0, authorization_1.requirePermission)('google-drive.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const { frequency, retention_count, destination_folder_id, warning_acknowledged } = req.body || {};
        if (warning_acknowledged === true)
            google_drive_1.googleDrive.acknowledgeWarning();
        let status = google_drive_1.googleDrive.updatePreferences({ frequency, retention_count });
        if (destination_folder_id !== undefined)
            status = await google_drive_1.googleDrive.setDestination(destination_folder_id);
        return res.json(status);
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.get('/google-drive/destinations', (0, authorization_1.requirePermission)('google-drive.manage'), (0, async_handler_1.asyncHandler)(async (_req, res) => {
    try {
        return res.json({ destinations: await google_drive_1.googleDrive.listDestinations() });
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.post('/google-drive/destinations', (0, authorization_1.requirePermission)('google-drive.manage'), (0, async_handler_1.asyncHandler)(async (_req, res) => {
    try {
        return res.json(await google_drive_1.googleDrive.createDestination());
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.post('/google-drive/connect', (0, authorization_1.requirePermission)('google-drive.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const body = req.body || {};
        const status = await (0, shutdown_1.trackHttpRequestWork)(req, google_drive_1.googleDrive.connect((0, shutdown_1.getHttpRequestSignal)(req), body.allow_switch === true, body.warning_acknowledged === true));
        return res.json(status);
    }
    catch (error) {
        if ((0, shutdown_1.getHttpRequestSignal)(req)?.aborted) {
            if (!res.headersSent)
                res.status(503).end();
            else if (!res.writableEnded)
                res.destroy();
            return res;
        }
        return googleDriveErrorResponse(res, error);
    }
}));
router.post('/google-drive/disconnect', (0, authorization_1.requirePermission)('google-drive.manage'), (0, async_handler_1.asyncHandler)(async (_req, res) => {
    try {
        return res.json(await google_drive_1.googleDrive.disconnect());
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.post('/google-drive/backup-now', (0, authorization_1.requirePermission)('google-drive.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        if (req.body?.warning_acknowledged === true)
            google_drive_1.googleDrive.acknowledgeWarning();
        return res
            .status(202)
            .json(google_drive_1.googleDrive.startBackupJob('manual', req.body?.warning_acknowledged === true));
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
router.get('/google-drive/jobs/:jobId', (0, authorization_1.requirePermission)('google-drive.manage'), (_req, res) => {
    const job = google_drive_1.googleDrive.getJob(_req.params.jobId);
    if (!job)
        return res.status(404).json({ error: 'not_found' });
    return res.json({ job });
});
router.post('/google-drive/jobs/:jobId/cancel', (0, authorization_1.requirePermission)('google-drive.manage'), (_req, res) => {
    try {
        return res.json(google_drive_1.googleDrive.cancelJob(_req.params.jobId));
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
});
router.get('/google-drive/backups', (0, authorization_1.requirePermission)('google-drive.manage'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const pagination = (0, db_1.parseBackupPaginationQuery)(req.query.limit, req.query.cursor);
        return res.json(await google_drive_1.googleDrive.listRemoteBackupsPage(pagination));
    }
    catch (error) {
        if (error?.code === 'ERR_INVALID_BACKUP_PAGINATION') {
            return res.status(400).json({ error: error.message });
        }
        return googleDriveErrorResponse(res, error);
    }
}));
router.post('/google-drive/restore', (0, authorization_1.requirePermission)('google-drive.manage'), master_pin_1.requireMasterPin, (0, async_handler_1.asyncHandler)(async (req, res) => {
    try {
        const body = req.body || {};
        if (body.confirmation !== google_drive_1.DRIVE_RESTORE_CONFIRMATION)
            return res.status(400).json({ error: 'confirmation_required' });
        return res.status(202).json(google_drive_1.googleDrive.startRestoreJob({
            fileId: body.file_id,
            expectedSha256: body.expected_sha256,
            confirmation: body.confirmation,
        }));
    }
    catch (error) {
        return googleDriveErrorResponse(res, error);
    }
}));
// ── Charges & fees (must come BEFORE /:key wildcard) ───────────────────────
/**
 * Dedicated, validated charges & fees endpoints. `custom_charges` is
 * deliberately unreachable from the generic wildcard route below: a charge
 * definition needs range, enum and order-type validation that the wildcard
 * handler does not perform, and PR #829 shipped exactly that gap.
 */
router.get('/charges', settingsReadRateLimit, (0, authorization_1.requireAnyPermission)('settings.view', 'orders.create', 'bills.discount.apply'), (_req, res) => {
    try {
        return res.json({ charges: (0, charges_1.getChargeDefinitions)() });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/charges', settingsWriteRateLimit, (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        const payload = (req.body || {}).charges ?? req.body;
        let definitions;
        try {
            const currencyDecimals = (0, countries_1.getCurrencyFractionDigits)((0, db_1.getSettingValue)('currency') || 'USD');
            definitions = (0, charges_1.normalizeChargeDefinitions)(payload, currencyDecimals);
        }
        catch (error) {
            if (error instanceof charges_1.ChargeValidationError) {
                return res.status(400).json({ error: error.message });
            }
            throw error;
        }
        const db = (0, db_1.getDatabase)();
        db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(charges_1.CUSTOM_CHARGES_SETTING_KEY, JSON.stringify(definitions), (0, db_1.now)());
        return res.json({ charges: definitions });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Orders screen layout (must come BEFORE /:key wildcard) ─────────────────
/**
 * The Orders layout is a tenant-wide display preference, so every role that can
 * open Orders has to read it — including roles denied `settings.view`. Writes
 * stay on the generic settings route, which requires `settings.manage`.
 */
router.get('/orders_layout', settingsReadRateLimit, (0, authorization_1.requireAnyPermission)('settings.view', 'orders.read', 'orders.create'), (_req, res) => {
    try {
        const setting = (0, db_1.getDatabase)()
            .prepare('SELECT * FROM settings WHERE key = ?')
            .get('orders_layout');
        if (setting)
            return res.json({ setting });
        return res.json({
            setting: {
                key: 'orders_layout',
                value: OPTIONAL_SETTING_DEFAULTS.orders_layout,
                updated_at: null,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
const requireAuthenticatedStaff = (req, res, next) => {
    const userId = String(req.user?.userId ||
        req.user?.id ||
        '');
    if (!userId) {
        return res
            .status(401)
            .json({ error: 'Authentication required', code: 'authentication_required' });
    }
    const db = (0, db_1.getDatabase)();
    const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(userId);
    if (!user || user.is_active !== 1) {
        return res.status(401).json({ error: 'Invalid or expired token', code: 'invalid_token' });
    }
    next();
};
router.get('/auto_lock_minutes', settingsReadRateLimit, requireAuthenticatedStaff, (_req, res) => {
    try {
        const setting = (0, db_1.getDatabase)()
            .prepare('SELECT * FROM settings WHERE key = ?')
            .get('auto_lock_minutes');
        if (setting)
            return res.json({ setting });
        return res.json({
            setting: {
                key: 'auto_lock_minutes',
                value: OPTIONAL_SETTING_DEFAULTS.auto_lock_minutes,
                updated_at: null,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/offline-mode', (0, authorization_1.requirePermission)('settings.view'), (_req, res) => {
    res.json({ offline_mode: (0, offline_mode_1.isOfflineMode)() });
});
router.put('/offline-mode', settingsWriteRateLimit, (0, authorization_1.requirePermission)('offline-mode.manage'), (req, res) => {
    try {
        const value = req.body?.offline_mode;
        if (typeof value !== 'boolean') {
            return res.status(400).json({ error: 'offline_mode must be a boolean' });
        }
        (0, db_1.getDatabase)()
            .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
            .run(offline_mode_1.OFFLINE_MODE_SETTING, value ? 'true' : 'false', (0, db_1.now)());
        (0, posthog_1.syncPostHogIdentity)();
        if (value) {
            cloud_sync_1.cloudSync.suspendForOfflineMode();
            whatsapp.suspendForOfflineMode();
            google_drive_1.googleDrive.suspendForOfflineMode();
            (0, offline_mode_1.notifyOfflineModeEnabled)();
        }
        else {
            cloud_sync_1.cloudSync.reload();
            cloud_sync_1.cloudSync.refreshRegistrationProfile();
            whatsapp.initFromDb();
            telemetry_1.telemetry.resumeDailyChecks();
        }
        res.json({ offline_mode: (0, offline_mode_1.isOfflineMode)() });
    }
    catch (error) {
        console.error('[API] Offline mode update failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/card_transaction_id_required', settingsReadRateLimit, (0, authorization_1.requireAnyPermission)('settings.view', 'payments.take', 'orders.create', 'bills.read'), (_req, res) => {
    try {
        const setting = (0, db_1.getDatabase)()
            .prepare('SELECT * FROM settings WHERE key = ?')
            .get('card_transaction_id_required');
        if (setting)
            return res.json({ setting });
        return res.json({
            setting: {
                key: 'card_transaction_id_required',
                value: OPTIONAL_SETTING_DEFAULTS.card_transaction_id_required,
                updated_at: null,
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Generic key-value routes (wildcard — must be last) ─────────────────────
// Only non-sensitive keys may be updated via the wildcard route.
// Sensitive keys (cloud_*, tax_registration_number, etc.) must use their explicit routes above.
const ALLOWED_WILDCARD_KEYS = new Set([
    'business_name',
    'timezone',
    'currency',
    'country',
    'state_code',
    'business_address',
    'business_phone',
    'billing_type',
    'tables_required',
    'tax_registered',
    'bill_show_name',
    'bill_show_address',
    'bill_show_phone',
    'bill_show_tax_id',
    'bill_show_tax_breakdown',
    'bill_show_customer_name',
    'bill_show_customer_phone',
    'bill_show_table_number',
    'tax_scheme',
    'taxes_enabled',
    'loyalty_enabled',
    'language',
    'kds_default_view',
    'printer_method',
    'paper_size',
    'bill_template',
    'bill_footer_message',
    'printer_trim_decimals',
    'cash_drawer_pulse_enabled',
    'cash_drawer_pulse_methods',
    'telemetry_enabled',
    'diagnostics_consent',
    'diagnostics_transmission_enabled',
    'kds_enabled',
    'require_kitchen_delivered_before_settlement',
    'server_app_enabled',
    'kot_printing_enabled',
    'server_app_bill_printing_enabled',
    'split_checks_enabled',
    'card_transaction_id_required',
    'multi_counter_enabled',
    print_language_settings_1.BILL_LANGUAGE_POLICY_KEY,
    print_language_settings_1.KOT_LANGUAGE_POLICY_KEY,
    print_language_settings_1.Z_REPORT_LANGUAGE_POLICY_KEY,
    'currency_display',
    'number_digits',
    'calendar',
    'theme_mode',
    'orders_layout',
    'pos_category_sort',
    'pos_item_sort',
    'require_open_shift',
    'one_shift_per_staff',
    'auto_lock_minutes',
]);
/**
 * Settings whose payload needs schema validation the wildcard route cannot do.
 * Listed as an explicit deny so widening ALLOWED_WILDCARD_KEYS can never
 * quietly reopen the unvalidated path.
 */
const DEDICATED_SETTING_KEYS = new Set([charges_1.CUSTOM_CHARGES_SETTING_KEY]);
function isAllowedWildcardKey(key) {
    // Explicit deny: `custom_charges` is a validated JSON document owned by the
    // dedicated /charges routes, not a scalar the wildcard can write.
    if (DEDICATED_SETTING_KEYS.has(key))
        return false;
    return ALLOWED_WILDCARD_KEYS.has(key) || /^tax_plugin_request:[A-Z]{2}$/.test(key);
}
router.get('/', (0, authorization_1.requirePermission)('settings.view'), (req, res) => {
    try {
        const s = getAllSettings((0, db_1.getDatabase)());
        res.json({ settings: publicSettingsShape(s) });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/bill-templates', (0, authorization_1.requirePermission)('print-templates.view'), (_req, res) => {
    try {
        const plugins = (0, print_templates_1.listInstalledPrintTemplates)().map((template) => {
            let storedWidths = [];
            try {
                const parsed = JSON.parse(template.paper_widths_json);
                storedWidths = Array.isArray(parsed)
                    ? parsed.filter((width) => typeof width === 'string')
                    : [];
            }
            catch {
                /* Ignore malformed rows; install validation owns the contract. */
            }
            const paperColumns = storedWidths
                .map((width) => /^cols-(\d+)$/.exec(width)?.[1])
                .filter((width) => !!width)
                .map((width) => Number(width));
            return {
                id: template.template_id,
                displayName: template.display_name,
                country: template.country,
                jurisdiction: template.jurisdiction,
                paperColumns,
                status: template.status,
                packId: template.pack_id,
                packVersionId: template.pack_version_id,
            };
        });
        // Active merchant print templates for receipt formatting.
        const merchant = (0, merchant_print_templates_1.listMerchantPrintTemplates)().map((template) => ({
            id: template.id,
            displayName: template.name,
            origin: template.origin,
            derivedFrom: template.derived_from ? JSON.parse(template.derived_from) : null,
            documentType: template.document_type,
            schemaVersion: template.schema_version,
            status: template.status,
            updatedAt: template.updated_at,
        }));
        res.json({ core: [...print_templates_1.CORE_BILL_TEMPLATES], plugins, merchant });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
const PRINTING_BOOLEAN_KEYS = [
    'printer_trim_decimals',
    'bill_show_name',
    'bill_show_address',
    'bill_show_phone',
    'bill_show_tax_id',
    'bill_show_tax_breakdown',
    'bill_show_customer_name',
    'bill_show_customer_phone',
    'bill_show_table_number',
    'bill_delivery_show_customer_phone_always',
];
const OPTIONAL_PRINTING_BOOLEAN_KEYS = [
    'bill_show_logo',
    'auto_print_kot',
    'printer_use_unicode',
    'printer_arabic_shaping',
];
const PRINTING_BATCH_KEYS = new Set([
    ...PRINTING_BOOLEAN_KEYS,
    ...OPTIONAL_PRINTING_BOOLEAN_KEYS,
    print_language_settings_1.BILL_LANGUAGE_POLICY_KEY,
    print_language_settings_1.KOT_LANGUAGE_POLICY_KEY,
    print_language_settings_1.Z_REPORT_LANGUAGE_POLICY_KEY,
    'cash_drawer_pulse_enabled',
    'cash_drawer_pulse_methods',
]);
router.put('/printing', settingsWriteRateLimit, (0, authorization_1.requirePermission)('printers.manage'), (req, res) => {
    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ error: 'Printing settings payload must be an object' });
        }
        const values = payload;
        const unknownKey = Object.keys(values).find((key) => !PRINTING_BATCH_KEYS.has(key));
        if (unknownKey) {
            return res.status(400).json({ error: `Unknown printing setting: ${unknownKey}` });
        }
        for (const key of PRINTING_BOOLEAN_KEYS) {
            if (typeof values[key] !== 'boolean') {
                return res.status(400).json({ error: `${key} must be a boolean` });
            }
        }
        for (const key of OPTIONAL_PRINTING_BOOLEAN_KEYS) {
            if (values[key] !== undefined && typeof values[key] !== 'boolean') {
                return res.status(400).json({ error: `${key} must be a boolean` });
            }
        }
        const billLanguagePolicy = (0, print_language_settings_1.validateLanguagePolicySetting)(print_language_settings_1.BILL_LANGUAGE_POLICY_KEY, values[print_language_settings_1.BILL_LANGUAGE_POLICY_KEY]);
        if (!billLanguagePolicy.ok) {
            return res.status(400).json({ error: billLanguagePolicy.error });
        }
        const kotLanguagePolicy = (0, print_language_settings_1.validateLanguagePolicySetting)(print_language_settings_1.KOT_LANGUAGE_POLICY_KEY, values[print_language_settings_1.KOT_LANGUAGE_POLICY_KEY]);
        if (!kotLanguagePolicy.ok) {
            return res.status(400).json({ error: kotLanguagePolicy.error });
        }
        const hasZReportLanguagePolicy = Object.prototype.hasOwnProperty.call(values, print_language_settings_1.Z_REPORT_LANGUAGE_POLICY_KEY);
        const zReportLanguagePolicy = hasZReportLanguagePolicy
            ? (0, print_language_settings_1.validateLanguagePolicySetting)(print_language_settings_1.Z_REPORT_LANGUAGE_POLICY_KEY, values[print_language_settings_1.Z_REPORT_LANGUAGE_POLICY_KEY])
            : null;
        if (zReportLanguagePolicy && !zReportLanguagePolicy.ok) {
            return res.status(400).json({ error: zReportLanguagePolicy.error });
        }
        const hasCashDrawerEnabled = Object.prototype.hasOwnProperty.call(values, 'cash_drawer_pulse_enabled');
        const hasCashDrawerMethods = Object.prototype.hasOwnProperty.call(values, 'cash_drawer_pulse_methods');
        if (hasCashDrawerEnabled !== hasCashDrawerMethods) {
            return res.status(400).json({ error: 'Cash drawer settings must be provided together' });
        }
        if (hasCashDrawerEnabled && typeof values.cash_drawer_pulse_enabled !== 'boolean') {
            return res.status(400).json({ error: 'cash_drawer_pulse_enabled must be a boolean' });
        }
        if (hasCashDrawerMethods &&
            (!Array.isArray(values.cash_drawer_pulse_methods) ||
                values.cash_drawer_pulse_methods.some((method) => typeof method !== 'string' || method.trim().length === 0))) {
            return res
                .status(400)
                .json({ error: 'cash_drawer_pulse_methods must be a non-empty string array' });
        }
        const entries = {
            printer_trim_decimals: values.printer_trim_decimals ? 'true' : 'false',
            [print_language_settings_1.BILL_LANGUAGE_POLICY_KEY]: billLanguagePolicy.stored,
            [print_language_settings_1.KOT_LANGUAGE_POLICY_KEY]: kotLanguagePolicy.stored,
        };
        if (zReportLanguagePolicy?.ok) {
            entries[print_language_settings_1.Z_REPORT_LANGUAGE_POLICY_KEY] = zReportLanguagePolicy.stored;
        }
        for (const key of PRINTING_BOOLEAN_KEYS.slice(1)) {
            entries[key] = values[key] ? 'true' : 'false';
        }
        for (const key of OPTIONAL_PRINTING_BOOLEAN_KEYS) {
            if (values[key] !== undefined) {
                entries[key] = values[key] ? 'true' : 'false';
            }
        }
        if (hasCashDrawerEnabled) {
            entries.cash_drawer_pulse_enabled = values.cash_drawer_pulse_enabled ? 'true' : 'false';
            entries.cash_drawer_pulse_methods = JSON.stringify(values.cash_drawer_pulse_methods);
        }
        upsertSettings((0, db_1.getDatabase)(), entries);
        res.json({ settings: entries });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/:key', settingsReadRateLimit, (0, authorization_1.requirePermission)('settings.view'), (req, res) => {
    try {
        if (SENSITIVE_SETTING_KEYS.has(req.params.key) ||
            isGoogleDriveSettingKey(req.params.key)) {
            return res
                .status(403)
                .json({ error: 'This setting is sensitive and cannot be read directly' });
        }
        const key = String(req.params.key);
        const db = (0, db_1.getDatabase)();
        const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
        if (!setting) {
            const defaultValue = OPTIONAL_SETTING_DEFAULTS[key];
            if (defaultValue !== undefined) {
                return res.json({ setting: { key, value: defaultValue, updated_at: null } });
            }
            return res.status(404).json({ error: 'Setting not found' });
        }
        res.json({ setting });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.put('/:key', settingsWriteRateLimit, (0, authorization_1.requirePermission)('settings.manage'), (req, res) => {
    try {
        if (!isAllowedWildcardKey(req.params.key)) {
            return res.status(403).json({ error: 'This setting cannot be updated via wildcard route' });
        }
        const { value } = req.body;
        if (value === undefined) {
            return res.status(400).json({ error: 'Value is required' });
        }
        // Upgrades legacy string values to canonical structured JSON on save.
        if (req.params.key === 'bill_template' && !(0, print_templates_1.isAvailableBillTemplate)(value)) {
            return res.status(400).json({ error: 'Unsupported bill template' });
        }
        if (req.params.key === 'theme_mode' && !(0, title_bar_theme_1.isThemeMode)(value)) {
            return res.status(400).json({ error: 'Invalid theme_mode value' });
        }
        if (req.params.key === 'orders_layout' && !isOrdersLayout(value)) {
            return res.status(400).json({ error: 'orders_layout must be "split" or "cards"' });
        }
        if (req.params.key === 'pos_category_sort' && !(0, pos_sort_1.isPosCategorySort)(value)) {
            return res.status(400).json({ error: 'pos_category_sort must be "saved" or "name"' });
        }
        if (req.params.key === 'pos_item_sort' && !(0, pos_sort_1.isPosItemSort)(value)) {
            return res.status(400).json({
                error: 'pos_item_sort must be "saved", "name", "price_asc" or "price_desc"',
            });
        }
        let valueToPersist = value;
        if (req.params.key === 'auto_lock_minutes') {
            const normalizedAutoLock = normalizeAutoLockMinutes(value);
            if (!normalizedAutoLock) {
                return res.status(400).json({ error: 'auto_lock_minutes must be 0, 1, 5, 15, or 30' });
            }
            valueToPersist = normalizedAutoLock;
        }
        if (req.params.key === 'require_open_shift' ||
            req.params.key === 'one_shift_per_staff' ||
            req.params.key === 'card_transaction_id_required' ||
            req.params.key === 'multi_counter_enabled') {
            if (req.params.key === 'multi_counter_enabled') {
                const callerUser = req.user;
                if (callerUser?.role !== 'owner') {
                    return res
                        .status(403)
                        .json({ error: 'Only the store owner can modify counter configuration' });
                }
            }
            if (value !== true && value !== false && value !== 'true' && value !== 'false') {
                return res.status(400).json({ error: `${req.params.key} must be a boolean` });
            }
            valueToPersist = value === true || value === 'true' ? 'true' : 'false';
        }
        const diagnosticsChoice = req.params.key === 'diagnostics_consent' ||
            req.params.key === 'diagnostics_transmission_enabled';
        if (diagnosticsChoice)
            valueToPersist = boolFlag(value);
        if (req.params.key === 'currency') {
            valueToPersist = typeof value === 'string' ? value.trim().toUpperCase() : value;
            if (!(0, currency_1.isSyntacticallyValidCurrencyCode)(valueToPersist)) {
                return res.status(400).json({ error: 'Invalid currency' });
            }
        }
        if (req.params.key === 'bill_template') {
            valueToPersist = (0, print_templates_1.upgradeBillTemplateValue)(value);
        }
        if (typeof req.params.key === 'string' && print_language_settings_1.LANGUAGE_POLICY_SETTING_KEYS.has(req.params.key)) {
            const validation = (0, print_language_settings_1.validateLanguagePolicySetting)(req.params.key, value);
            if (!validation.ok) {
                return res.status(400).json({ error: validation.error });
            }
            valueToPersist = validation.stored;
        }
        const db = (0, db_1.getDatabase)();
        if (req.params.key === 'one_shift_per_staff' && valueToPersist === 'false') {
            const openCount = db
                .prepare(`SELECT COUNT(*) AS n FROM cash_sessions WHERE status = 'open'`)
                .get();
            if (Number(openCount?.n || 0) > 1) {
                return res.status(409).json({
                    error: 'Cannot disable one shift per staff member while multiple shifts are open',
                    code: 'multiple_shifts_open',
                });
            }
        }
        if (diagnosticsChoice &&
            valueToPersist === 'true' &&
            ['pending', 'processing', 'approved', 'completed', 'deleted', 'failed', 'unknown'].includes(getAllSettings(db).cloud_deletion_status || '')) {
            return res.status(409).json({ error: 'cloud_deletion_pending' });
        }
        if (req.params.key === 'currency') {
            const currentCurrency = getAllSettings(db).currency || '';
            if (valueToPersist !== currentCurrency) {
                return res.status(409).json({
                    error: 'currency_change_requires_reset',
                    current_currency: currentCurrency,
                    requested_currency: valueToPersist,
                });
            }
        }
        const wildcardKey = String(req.params.key);
        if ((0, countries_1.isLocalePreferenceKey)(wildcardKey)) {
            const countryCode = getAllSettings(db).country || '';
            if (typeof value !== 'string' ||
                !(0, countries_1.isLocalePreferenceSupported)(wildcardKey, value, countryCode)) {
                return res
                    .status(400)
                    .json({ error: `Invalid ${wildcardKey} for country ${countryCode}` });
            }
        }
        if (req.params.key === 'business_phone') {
            const effectiveCountry = getAllSettings(db).country || '';
            const phoneRes = (0, phone_1.normalizeOptionalPhone)(value, effectiveCountry);
            if (!phoneRes.valid) {
                return res.status(400).json({ error: phoneRes.error || 'Invalid business phone number' });
            }
            valueToPersist = phoneRes.e164 || '';
        }
        // Invalidate outstanding pairing tokens when KDS is disabled.
        if (req.params.key === 'kds_enabled') {
            const wasEnabled = getAllSettings(db).kds_enabled !== 'false';
            const turningOff = boolFlag(value) === 'false';
            if (wasEnabled && turningOff) {
                db.prepare('DELETE FROM kds_pairing_tokens').run();
            }
        }
        const saveSetting = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
        if (diagnosticsChoice) {
            const changeId = (0, crypto_1.randomUUID)();
            db.transaction(() => {
                saveSetting.run(req.params.key, valueToPersist, (0, db_1.now)());
                db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES ('diagnostics_settings_explicit', 'true', ?)
          ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at
        `).run((0, db_1.now)());
                db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES ('diagnostics_consent_sync_pending', 'true', ?)
          ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at
        `).run((0, db_1.now)());
                db.prepare(`
          INSERT INTO settings (key, value, updated_at) VALUES ('diagnostics_consent_change_id', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(changeId, (0, db_1.now)());
            })();
        }
        else {
            saveSetting.run(req.params.key, valueToPersist, (0, db_1.now)());
        }
        // Sync legacy anonymous_data_consent mirror with canonical telemetry_enabled.
        if (req.params.key === 'telemetry_enabled') {
            db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('anonymous_data_consent', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(value, (0, db_1.now)());
        }
        // Best-effort push of the effective diagnostics permission to FloAdmin.
        if (diagnosticsChoice) {
            const settings = getAllSettings(db);
            const enabled = settings.diagnostics_consent !== 'false' &&
                settings.diagnostics_transmission_enabled === 'true';
            void cloud_sync_1.cloudSync.setDiagnosticsConsent(enabled);
        }
        if (req.params.key === 'split_checks_enabled' && boolFlag(value) === 'true') {
            void (0, telemetry_1.sendEvent)('feature_used', { feature: 'split_checks', action: 'enabled' });
        }
        if (req.params.key === 'telemetry_enabled' ||
            req.params.key === 'email' ||
            req.params.key === 'diagnostics_consent' ||
            req.params.key === 'diagnostics_transmission_enabled') {
            (0, posthog_1.syncPostHogIdentity)();
        }
        const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key);
        res.json({ setting });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.settingsRoutes = router;
//# sourceMappingURL=settings.js.map