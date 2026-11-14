"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TAX_ID_LENGTH = void 0;
exports.computeDiscountTaxRatio = computeDiscountTaxRatio;
exports.getActiveCountryPack = getActiveCountryPack;
exports.getCountryPackByVersion = getCountryPackByVersion;
exports.isTaxModuleActiveForCountry = isTaxModuleActiveForCountry;
exports.resolveTaxIdFormat = resolveTaxIdFormat;
exports.validateTaxRegistrationNumber = validateTaxRegistrationNumber;
exports.previewCategoryRate = previewCategoryRate;
exports.hasConfiguredTaxCategories = hasConfiguredTaxCategories;
exports.getActiveTaxOverride = getActiveTaxOverride;
exports.getConfiguredChargeTaxCategories = getConfiguredChargeTaxCategories;
exports.normalizeChargeAmount = normalizeChargeAmount;
exports.calculateDocumentTaxes = calculateDocumentTaxes;
exports.calculateDocumentItemTaxes = calculateDocumentItemTaxes;
exports.calculateItemTax = calculateItemTax;
exports.calculateConfiguredChargeTaxes = calculateConfiguredChargeTaxes;
exports.aggregateTaxBreakdown = aggregateTaxBreakdown;
exports.aggregateTaxSnapshots = aggregateTaxSnapshots;
exports.invertTaxSnapshot = invertTaxSnapshot;
exports.invertTaxBreakdown = invertTaxBreakdown;
exports.scaleTaxBreakdowns = scaleTaxBreakdowns;
exports.scaleTaxSnapshots = scaleTaxSnapshots;
exports.combineItemAndChargeTaxes = combineItemAndChargeTaxes;
exports.allocateDocumentTaxRounding = allocateDocumentTaxRounding;
exports.rollupOrderTaxes = rollupOrderTaxes;
exports.calculateTaxPreview = calculateTaxPreview;
const decimal_js_1 = __importDefault(require("decimal.js"));
const db_1 = require("../db");
const item_price_override_1 = require("./item-price-override");
const product_variants_1 = require("./product-variants");
const bundled_1 = require("../tax-packs/bundled");
const countries_1 = require("../countries");
const charges_1 = require("./charges");
const TaxDecimal = decimal_js_1.default.clone({ precision: 40, rounding: decimal_js_1.default.ROUND_HALF_UP });
function computeDiscountTaxRatio(discountedSubtotal, subtotal) {
    const base = new TaxDecimal(subtotal);
    if (!base.isFinite() || base.lte(0))
        return new TaxDecimal(1);
    const discounted = decimal_js_1.default.max(0, decimal_js_1.default.min(new TaxDecimal(discountedSubtotal), base));
    return new TaxDecimal(discounted.toString()).div(base);
}
const tax_engine_1 = require("./tax-engine");
function round(value, decimals = 2) {
    if (typeof value !== 'number' || isNaN(value) || !isFinite(value))
        return 0;
    return Number(Math.round(Number(value + 'e' + decimals)) + 'e-' + decimals);
}
// Shared helper to retrieve the active country pack for tax calculation and categories API.
function getActiveCountryPack(country) {
    try {
        const db = (0, db_1.getDatabase)();
        const row = db
            .prepare(`
      SELECT version.pack_json
      FROM country_packs AS pack
      JOIN country_pack_versions AS version ON version.id = pack.active_version_id
      WHERE pack.country IN (?, '*') AND pack.status = 'active'
      ORDER BY CASE WHEN pack.country = ? THEN 0 ELSE 1 END, pack.updated_at DESC
      LIMIT 1
    `)
            .get(country, country);
        if (row)
            return JSON.parse(row.pack_json);
    }
    catch {
        // Fall back to immutable bundled pack JSON if DB migrations haven't run.
    }
    return (0, bundled_1.getBundledCountryPack)(country);
}
// Resolves a specific installed pack version for historical order items, falling back to the active pack.
function getCountryPackByVersion(packId, version, fallbackCountryCode = '') {
    if (typeof packId === 'string' &&
        packId.trim() &&
        typeof version === 'string' &&
        version.trim()) {
        try {
            const db = (0, db_1.getDatabase)();
            const row = db
                .prepare(`SELECT pack_json FROM country_pack_versions WHERE pack_id = ? AND version = ? LIMIT 1`)
                .get(packId.trim(), version.trim());
            if (row) {
                const parsed = JSON.parse(row.pack_json);
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rules)) {
                    return parsed;
                }
            }
        }
        catch {
            // Fall back to the active country pack if the historical version is unavailable.
        }
    }
    return getActiveCountryPack(fallbackCountryCode);
}
// Checks if taxation is enabled and backed by an official active country pack.
function isTaxModuleActiveForCountry(country) {
    if ((0, db_1.getSettingValue)('taxes_enabled') !== 'true')
        return false;
    try {
        return getActiveCountryPack(country).publisher !== 'local';
    }
    catch {
        return false;
    }
}
function resolveTaxIdFormat(country) {
    if (!isTaxModuleActiveForCountry(country))
        return null;
    return (getActiveCountryPack(country).registrationNumberFormat ||
        (0, countries_1.getCountryByCode)(country)?.taxIdFormat ||
        null);
}
// Bounds input length to 24 chars as a defense-in-depth safeguard against ReDoS backtracking.
exports.MAX_TAX_ID_LENGTH = 24;
function validateTaxRegistrationNumber(country, value) {
    const format = resolveTaxIdFormat(country);
    if (!format || !value)
        return { valid: true, format };
    const trimmed = value.trim();
    if (trimmed.length > exports.MAX_TAX_ID_LENGTH)
        return { valid: false, format };
    let regex;
    try {
        regex = new RegExp(format.pattern, 'i');
    }
    catch {
        return { valid: true, format: null };
    }
    return { valid: regex.test(trimmed), format };
}
// Computes a display-only preview tax rate for UI category pickers.
// Authoritative calculation always goes through TaxEngine.calculate.
function previewCategoryRate(pack, businessType, categoryId) {
    const category = pack.categories.find((candidate) => candidate.id === categoryId);
    if (!category)
        return null;
    const ruleById = new Map(pack.rules.map((rule) => [rule.id, rule]));
    const percentRules = category.ruleIds.reduce((acc, ruleId) => {
        const rule = ruleById.get(ruleId);
        if (!rule || rule.type !== 'percent' || !rule.categoryIds.includes(categoryId))
            return acc;
        const conditions = rule.conditions;
        if (conditions) {
            if (conditions.businessTypes && !conditions.businessTypes.includes(businessType))
                return acc;
            if (conditions.customerStateRelation === 'interstate')
                return acc;
        }
        acc.push(rule);
        return acc;
    }, []);
    if (percentRules.length === 0)
        return null;
    const percent = percentRules.reduce((sum, rule) => sum + Number(rule.rate || 0), 0);
    return {
        percent: Math.round(percent * 100) / 100,
        label: percentRules.map((rule) => `${rule.label} ${rule.rate}%`).join(' + '),
    };
}
function hasConfiguredTaxCategories(pack, businessType) {
    return pack.categories.some((category) => category.ruleIds.some((ruleId) => {
        const rule = pack.rules.find((candidate) => candidate.id === ruleId);
        return Boolean(rule &&
            (!rule.conditions?.businessTypes || rule.conditions.businessTypes.includes(businessType)));
    }));
}
function getActiveTaxOverride(entityType, entityId, packId) {
    try {
        const db = (0, db_1.getDatabase)();
        const row = db
            .prepare(`
      SELECT override.id, override.value_json
      FROM tax_overrides AS override
      JOIN country_packs AS pack ON pack.active_version_id = override.pack_version_id
      WHERE pack.id = ?
        AND override.entity_type = ?
        AND override.entity_id = ?
        AND override.field_name = 'tax_category_id'
      ORDER BY override.updated_at DESC
      LIMIT 1
    `)
            .get(packId, entityType, String(entityId));
        if (row) {
            const value = JSON.parse(row.value_json);
            const categoryId = typeof value === 'string' ? value : value?.categoryId;
            if (typeof categoryId === 'string' && categoryId) {
                return { id: row.id, categoryId };
            }
        }
    }
    catch {
        // An unavailable override table is possible only before migrations or
        // in isolated unit tests; normal checkout databases always have it.
    }
    return null;
}
const CHARGE_KINDS = ['packaging', 'delivery', 'service_charge'];
function getConfiguredChargeTaxCategories(country) {
    if ((0, db_1.getSettingValue)('taxes_enabled') !== 'true')
        return {};
    const pack = getActiveCountryPack(country);
    try {
        const rows = (0, db_1.getDatabase)()
            .prepare(`
      SELECT override.id, override.entity_type, override.value_json
      FROM tax_overrides AS override
      JOIN country_packs AS country_pack
        ON country_pack.active_version_id = override.pack_version_id
      WHERE country_pack.id = ?
        AND override.entity_type IN ('packaging', 'delivery', 'service_charge')
        AND override.entity_id IS NULL
        AND override.field_name = 'tax_category_id'
      ORDER BY override.updated_at DESC
    `)
            .all(pack.id);
        const configured = {};
        for (const row of rows) {
            if (configured[row.entity_type])
                continue;
            try {
                const value = JSON.parse(row.value_json);
                const categoryId = typeof value === 'string' ? value : value?.categoryId;
                if (typeof categoryId === 'string' && categoryId) {
                    configured[row.entity_type] = { categoryId, overrideId: row.id };
                }
            }
            catch { }
        }
        return configured;
    }
    catch {
        return {};
    }
}
function normalizeChargeAmount(value, kind) {
    if (value === undefined || value === null || value === '')
        return 0;
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw Object.assign(new Error(`${kind} charge must be a non-negative finite amount`), {
            statusCode: 400,
        });
    }
    try {
        const amount = new decimal_js_1.default(value);
        if (!amount.isFinite() || amount.isNegative()) {
            throw new Error(`${kind} charge must be a non-negative finite amount`);
        }
        const numericAmount = amount.toNumber();
        if (!Number.isFinite(numericAmount)) {
            throw new Error(`${kind} charge must be a non-negative finite amount`);
        }
        return numericAmount;
    }
    catch (error) {
        throw Object.assign(new Error(error.message || `${kind} charge is invalid`), {
            statusCode: 400,
        });
    }
}
function chargeAmount(context, kind) {
    const amountKey = kind === 'service_charge' ? 'service_charge' : `${kind}_charge`;
    return new decimal_js_1.default(normalizeChargeAmount(context[amountKey], kind));
}
function chargeCategoryId(context, kind) {
    const value = context[`${kind}_tax_category_id`];
    return typeof value === 'string' && value ? value : null;
}
/**
 * Evaluates document-scoped taxes across all items and configured charges in a
 * single TaxEngine.calculate invocation, preserving document remainder allocation.
 */
function calculateDocumentTaxes(tenant, input) {
    const items = input.items || [];
    const customer = input.customer || null;
    const chargeContext = input.chargeContext || null;
    const itemResults = items.map(() => ({
        tax_amount: 0,
        tax_breakdown: [],
        tax_type: 'none',
        tax_snapshot: null,
    }));
    const chargeTaxes = {
        taxAmount: 0,
        exclusiveTaxAmount: 0,
        breakdowns: [],
        snapshotJson: [],
    };
    if (!tenant.taxes_enabled || (items.length === 0 && !chargeContext)) {
        return { itemResults, chargeTaxes };
    }
    const pack = input.packOverride ?? getActiveCountryPack(tenant.country);
    const itemEntries = [];
    for (let idx = 0; idx < items.length; idx++) {
        const entry = items[idx];
        const taxCategoryId = entry.product.tax_category_id ?? entry.product.tax_category ?? null;
        const merchantOverride = entry.product.id !== undefined && entry.product.id !== null && pack
            ? getActiveTaxOverride('product', entry.product.id, pack.id)
            : null;
        if (!taxCategoryId && !merchantOverride) {
            continue;
        }
        if (!pack) {
            throw Object.assign(new Error(`Tax calculation failed: no active tax pack for country ${tenant.country}`), { statusCode: 400 });
        }
        if ((entry.taxableAmount ?? 0) < 0) {
            continue;
        }
        const lineId = entry.lineId ||
            (items.length === 1 && !chargeContext
                ? 'legacy-item-adapter'
                : `line-${String(idx + 1).padStart(4, '0')}`);
        itemEntries.push({
            itemIndex: idx,
            merchantOverride,
            engineLine: {
                lineId,
                kind: 'product',
                quantity: '1',
                unitPrice: String(entry.taxableAmount),
                merchantCategoryId: merchantOverride?.categoryId,
                productCategoryId: taxCategoryId || undefined,
                taxBehavior: entry.product.tax_behavior || 'country_default',
            },
        });
    }
    const activeCharges = [];
    if (chargeContext) {
        for (const kind of CHARGE_KINDS) {
            const amount = chargeAmount(chargeContext, kind);
            const categoryId = chargeCategoryId(chargeContext, kind);
            if (!amount.isZero() && !amount.isNegative() && categoryId) {
                activeCharges.push({ kind, amount, categoryId });
            }
        }
    }
    if (activeCharges.length > 0 && !pack) {
        throw Object.assign(new Error(`Tax calculation failed: no active tax pack for country ${tenant.country}`), { statusCode: 400 });
    }
    const allEngineLines = [
        ...itemEntries.map((e) => e.engineLine),
        ...activeCharges.map((charge) => ({
            lineId: `charge:${charge.kind}`,
            kind: charge.kind,
            quantity: '1',
            unitPrice: charge.amount.toString(),
            merchantCategoryId: charge.categoryId,
            taxBehavior: 'country_default',
        })),
    ];
    if (allEngineLines.length === 0) {
        return { itemResults, chargeTaxes };
    }
    let calculation;
    try {
        calculation = tax_engine_1.TaxEngine.calculate({
            pack: pack,
            currency: tenant.currency,
            country: tenant.country,
            businessType: tenant.business_type,
            storeStateCode: tenant.state_code,
            transactionDate: new Date().toISOString(),
            customer: customer
                ? {
                    registrationNumber: customer.taxRegistrationNumber || customer.tax_registration_number,
                    stateCode: customer.customer_state_code,
                }
                : null,
            lines: allEngineLines,
        });
    }
    catch (engineError) {
        throw Object.assign(new Error(`Tax calculation failed: ${engineError.message}`), {
            statusCode: 400,
        });
    }
    for (let k = 0; k < itemEntries.length; k++) {
        const line = calculation.lines[k];
        const entry = itemEntries[k];
        if (line.taxBehavior !== 'exempt' && line.components.length === 0) {
            throw Object.assign(new Error(`Tax calculation failed: no tax rules apply to category ${line.categoryId} for business type ${tenant.business_type}`), { statusCode: 400 });
        }
        itemResults[entry.itemIndex] = {
            tax_amount: Number(line.taxAmount),
            tax_breakdown: line.components.map((component) => ({
                title: component.label,
                rate: Number(component.rate || 0),
                amount: Number(component.amount),
            })),
            tax_type: line.taxBehavior === 'exempt' ? 'none' : line.taxBehavior,
            tax_snapshot: {
                ...calculation.snapshot,
                country: tenant.country,
                currency: tenant.currency,
                payableRounding: pack.payableRounding,
                lines: [line],
                merchantOverridesApplied: entry.merchantOverride
                    ? [
                        {
                            overrideId: entry.merchantOverride.id,
                            entityType: 'product',
                            entityId: String(items[entry.itemIndex].product.id),
                            fieldName: 'tax_category_id',
                            categoryId: entry.merchantOverride.categoryId,
                        },
                    ]
                    : [],
            },
        };
    }
    let chargeTaxAmount = new decimal_js_1.default(0);
    let chargeExclusiveTaxAmount = new decimal_js_1.default(0);
    const chargeBreakdowns = [];
    const chargeSnapshotJson = [];
    for (let idx = 0; idx < activeCharges.length; idx++) {
        const k = itemEntries.length + idx;
        const line = calculation.lines[k];
        const charge = activeCharges[idx];
        if (line.taxBehavior !== 'exempt' && line.components.length === 0) {
            throw Object.assign(new Error(`Tax calculation failed: no tax rules apply to ${charge.kind} category ${line.categoryId}`), { statusCode: 400 });
        }
        const lineTax = new decimal_js_1.default(line.taxAmount);
        chargeTaxAmount = chargeTaxAmount.plus(lineTax);
        if (line.taxBehavior !== 'inclusive')
            chargeExclusiveTaxAmount = chargeExclusiveTaxAmount.plus(lineTax);
        chargeBreakdowns.push(line.components.map((component) => ({
            title: component.label,
            rate: Number(component.rate || 0),
            amount: Number(component.amount),
        })));
        chargeSnapshotJson.push(JSON.stringify({
            ...calculation.snapshot,
            lines: [line],
            chargeKind: charge.kind,
            configuredCategoryId: charge.categoryId,
        }));
    }
    chargeTaxes.taxAmount = chargeTaxAmount.toNumber();
    chargeTaxes.exclusiveTaxAmount = chargeExclusiveTaxAmount.toNumber();
    chargeTaxes.breakdowns = chargeBreakdowns;
    chargeTaxes.snapshotJson = chargeSnapshotJson;
    return { itemResults, chargeTaxes };
}
/** Evaluates taxes across multiple items, returning item tax results. */
function calculateDocumentItemTaxes(tenant, items, customer = null, chargeContext, packOverride) {
    return calculateDocumentTaxes(tenant, { items, chargeContext, customer, packOverride })
        .itemResults;
}
/** Single-item adapter for legacy callers evaluating an isolated item. */
function calculateItemTax(tenant, product, taxableAmount, customer, packOverride) {
    return calculateDocumentItemTaxes(tenant, [{ lineId: 'legacy-item-adapter', product, taxableAmount }], customer, undefined, packOverride)[0];
}
/** Adapter evaluating configured charges in isolation when no items are present. */
function calculateConfiguredChargeTaxes(tenant, context, customer = null, packOverride) {
    return calculateDocumentTaxes(tenant, {
        items: [],
        chargeContext: context,
        customer,
        packOverride,
    }).chargeTaxes;
}
function aggregateTaxBreakdown(itemBreakdowns, minorFactor = 100) {
    const merged = {};
    for (const breakdown of itemBreakdowns) {
        if (!Array.isArray(breakdown))
            continue;
        for (const line of breakdown) {
            if (!line || typeof line.amount !== 'number' || !Number.isFinite(line.amount))
                continue;
            const key = `${line.title}_${line.rate}`;
            if (!merged[key]) {
                merged[key] = { title: line.title, rate: line.rate, amount: 0 };
            }
            merged[key].amount = round(merged[key].amount + line.amount, 4);
        }
    }
    return Object.values(merged).map((line) => ({
        ...line,
        amount: round(line.amount, Math.log10(minorFactor)),
    }));
}
// Aggregates item-level tax snapshots into an order/bill-level snapshot array.
function aggregateTaxSnapshots(itemSnapshotsJson) {
    const snapshots = itemSnapshotsJson
        .map((raw) => {
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    })
        .filter((snapshot) => snapshot !== null);
    return snapshots.length > 0 ? JSON.stringify(snapshots) : null;
}
// Inverts tax snapshot line amounts for negative void/refund adjustment rows.
function invertTaxSnapshot(raw) {
    if (!raw)
        return null;
    try {
        const snapshot = JSON.parse(raw);
        if (!snapshot || !Array.isArray(snapshot.lines))
            return null;
        const negate = (value) => {
            if (typeof value !== 'string' && typeof value !== 'number')
                return value;
            return new decimal_js_1.default(value).negated().toString();
        };
        snapshot.lines = snapshot.lines.map((line) => ({
            ...line,
            lineId: `${line.lineId}:void-adjustment`,
            grossAmount: negate(line.grossAmount),
            taxableBase: negate(line.taxableBase),
            taxAmount: negate(line.taxAmount),
            components: Array.isArray(line.components)
                ? line.components.map((component) => ({
                    ...component,
                    amount: negate(component.amount),
                    roundingRemainder: negate(component.roundingRemainder),
                }))
                : line.components,
        }));
        return JSON.stringify(snapshot);
    }
    catch {
        return null;
    }
}
function invertTaxBreakdown(raw) {
    if (!raw)
        return null;
    try {
        const breakdown = JSON.parse(raw);
        if (!Array.isArray(breakdown))
            return null;
        return JSON.stringify(breakdown.map((component) => ({
            ...component,
            amount: new decimal_js_1.default(component.amount || 0).negated().toNumber(),
        })));
    }
    catch {
        return null;
    }
}
function scaleTaxBreakdowns(breakdowns, ratio, targetTaxAmount, minorFactor = 100) {
    const decimals = Math.log10(minorFactor);
    const cloned = breakdowns.map((breakdown) => Array.isArray(breakdown) ? breakdown.map((component) => ({ ...component })) : breakdown);
    const entries = [];
    const scale = decimal_js_1.default.isDecimal(ratio) ? new TaxDecimal(ratio.toString()) : new TaxDecimal(ratio);
    cloned.forEach((breakdown, outerIndex) => {
        if (!Array.isArray(breakdown))
            return;
        breakdown.forEach((component, innerIndex) => {
            const rawAmount = new TaxDecimal(component.amount || 0)
                .mul(scale)
                .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP);
            const rounded = rawAmount.toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
            entries.push({
                component,
                rounded,
                remainder: rawAmount.minus(rounded),
                outerIndex,
                innerIndex,
            });
        });
    });
    if (entries.length === 0)
        return cloned;
    const roundedTotal = entries.reduce((sum, entry) => sum.plus(entry.rounded), new decimal_js_1.default(0));
    const minorDelta = new decimal_js_1.default(targetTaxAmount)
        .minus(roundedTotal)
        .mul(minorFactor)
        .toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP)
        .toNumber();
    const direction = Math.sign(minorDelta);
    const allocationOrder = [...entries].sort((left, right) => {
        const remainderOrder = direction >= 0
            ? right.remainder.comparedTo(left.remainder)
            : left.remainder.comparedTo(right.remainder);
        if (remainderOrder !== 0)
            return remainderOrder;
        const titleOrder = String(left.component.title || '').localeCompare(String(right.component.title || ''));
        if (titleOrder !== 0)
            return titleOrder;
        return left.outerIndex - right.outerIndex || left.innerIndex - right.innerIndex;
    });
    for (let index = 0; index < Math.abs(minorDelta); index++) {
        const entry = allocationOrder[index % allocationOrder.length];
        entry.rounded = entry.rounded.plus(direction / minorFactor);
    }
    for (const entry of entries)
        entry.component.amount = entry.rounded.toNumber();
    return cloned;
}
function scaleTaxSnapshots(snapshotsJson, ratio, minorFactor = 100) {
    const snapshots = snapshotsJson.flatMap((raw) => {
        if (!raw)
            return [];
        try {
            const snapshot = JSON.parse(raw);
            return snapshot && Array.isArray(snapshot.lines) ? [snapshot] : [];
        }
        catch {
            return [];
        }
    });
    const scale = decimal_js_1.default.isDecimal(ratio) ? new TaxDecimal(ratio.toString()) : new TaxDecimal(ratio);
    if (scale.eq(1)) {
        return snapshots.map((snapshot) => JSON.stringify(snapshot));
    }
    const decimals = Math.log10(minorFactor);
    const entries = [];
    for (const snapshot of snapshots) {
        for (const line of snapshot.lines) {
            if (!Array.isArray(line.components))
                continue;
            for (const component of line.components) {
                const raw = new TaxDecimal(component.amount || 0)
                    .mul(scale)
                    .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP);
                const rounded = raw.toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
                entries.push({ component, line, raw, rounded, remainder: raw.minus(rounded) });
            }
        }
    }
    if (entries.length > 0) {
        const targetTaxAmount = entries
            .reduce((sum, entry) => sum.plus(new TaxDecimal(entry.component.amount || 0)), new TaxDecimal(0))
            .mul(scale)
            .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP)
            .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
        const roundedTotal = entries.reduce((sum, entry) => sum.plus(entry.rounded), new decimal_js_1.default(0));
        const centsDelta = targetTaxAmount
            .minus(roundedTotal)
            .mul(minorFactor)
            .toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP)
            .toNumber();
        const direction = Math.sign(centsDelta);
        const ordered = [...entries].sort((left, right) => {
            const remainderOrder = direction >= 0
                ? right.remainder.comparedTo(left.remainder)
                : left.remainder.comparedTo(right.remainder);
            if (remainderOrder !== 0)
                return remainderOrder;
            const labelLeft = String(left.component.label ??
                left.component.title ??
                left.component.name ??
                left.component.ruleId ??
                '');
            const labelRight = String(right.component.label ??
                right.component.title ??
                right.component.name ??
                right.component.ruleId ??
                '');
            const labelOrder = labelLeft.localeCompare(labelRight);
            if (labelOrder !== 0)
                return labelOrder;
            const ruleOrder = String(left.component.ruleId || '').localeCompare(String(right.component.ruleId || ''));
            if (ruleOrder !== 0)
                return ruleOrder;
            return String(left.line.lineId || '').localeCompare(String(right.line.lineId || ''));
        });
        for (let index = 0; index < Math.abs(centsDelta); index += 1) {
            const entry = ordered[index % ordered.length];
            entry.rounded = entry.rounded.plus(direction / minorFactor);
        }
        for (const entry of entries) {
            entry.component.amount = entry.rounded.toFixed(decimals);
            entry.component.roundingRemainder = entry.raw.minus(entry.rounded).toString();
        }
    }
    for (const snapshot of snapshots) {
        for (const line of snapshot.lines) {
            const scaleValue = (value) => {
                if (typeof value !== 'string' && typeof value !== 'number')
                    return value;
                return new TaxDecimal(value)
                    .mul(scale)
                    .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP)
                    .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP)
                    .toFixed(decimals);
            };
            line.grossAmount = scaleValue(line.grossAmount);
            line.taxableBase = scaleValue(line.taxableBase);
            if (Array.isArray(line.components)) {
                line.taxAmount = line.components
                    .reduce((sum, component) => sum.plus(component.amount || 0), new decimal_js_1.default(0))
                    .toFixed(decimals);
            }
            else {
                line.taxAmount = scaleValue(line.taxAmount);
            }
        }
    }
    return snapshots.map((snapshot) => JSON.stringify(snapshot));
}
function combineItemAndChargeTaxes(args) {
    const scaledBreakdowns = scaleTaxBreakdowns(args.itemBreakdowns, args.itemTaxRatio, args.itemTaxAmount, args.minorFactor);
    const scaledSnapshots = scaleTaxSnapshots(args.itemSnapshots, args.itemTaxRatio, args.minorFactor);
    const nonEmptyBreakdowns = [...scaledBreakdowns, ...args.chargeTaxes.breakdowns].filter((breakdown) => Array.isArray(breakdown) && breakdown.length > 0);
    return {
        taxAmount: new decimal_js_1.default(args.itemTaxAmount).plus(args.chargeTaxes.taxAmount).toNumber(),
        exclusiveTaxAmount: new decimal_js_1.default(args.itemExclusiveTaxAmount)
            .plus(args.chargeTaxes.exclusiveTaxAmount)
            .toNumber(),
        breakdowns: nonEmptyBreakdowns,
        snapshotJson: aggregateTaxSnapshots([...scaledSnapshots, ...args.chargeTaxes.snapshotJson]),
    };
}
/** Scales raw item tax components before document-scope remainder allocation across items and charges. */
function allocateDocumentTaxRounding(args) {
    const ratio = args.itemTaxRatio ?? new decimal_js_1.default(1);
    const isScaled = !ratio.eq(1);
    const resolvePlaces = (currencyCode, fallbackPlaces) => {
        const code = args.currency || currencyCode || '';
        if (code)
            return (0, countries_1.getCurrencyFractionDigits)(code);
        if (args.minorFactor !== undefined && args.minorFactor > 0) {
            return Math.round(Math.log10(args.minorFactor));
        }
        if (typeof fallbackPlaces === 'number' &&
            Number.isInteger(fallbackPlaces) &&
            fallbackPlaces >= 0) {
            return fallbackPlaces;
        }
        return (0, countries_1.getCurrencyFractionDigits)('');
    };
    const itemOutputs = args.items.map(() => ({
        handled: false,
        taxAmount: 0,
        breakdown: [],
        snapshotJson: null,
    }));
    const nextChargeTaxes = {
        taxAmount: args.chargeTaxes.taxAmount,
        exclusiveTaxAmount: args.chargeTaxes.exclusiveTaxAmount,
        breakdowns: [...args.chargeTaxes.breakdowns],
        snapshotJson: [...args.chargeTaxes.snapshotJson],
    };
    const groups = new Map();
    const itemSnapshots = new Map();
    const chargeSnapshots = new Map();
    let orderCounter = 0;
    args.items.forEach((itemInput, idx) => {
        if (!itemInput.snapshot)
            return;
        let snap = null;
        try {
            snap =
                typeof itemInput.snapshot === 'string'
                    ? JSON.parse(itemInput.snapshot)
                    : JSON.parse(JSON.stringify(itemInput.snapshot));
        }
        catch {
            return;
        }
        if (snap?.taxRounding?.scope !== 'document' ||
            !Array.isArray(snap.lines) ||
            snap.lines.length === 0) {
            return;
        }
        itemSnapshots.set(idx, snap);
        const line = snap.lines[0];
        if (itemInput.lineIdOverride) {
            line.lineId = itemInput.lineIdOverride;
        }
        if (isScaled) {
            const places = resolvePlaces(snap.currency, snap.taxRounding.decimalPlaces);
            const scaleLineAmount = (val) => typeof val === 'string' || typeof val === 'number'
                ? new TaxDecimal(val)
                    .mul(new TaxDecimal(ratio))
                    .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP)
                    .toDecimalPlaces(places, decimal_js_1.default.ROUND_HALF_UP)
                    .toFixed(places)
                : val;
            line.grossAmount = scaleLineAmount(line.grossAmount);
            line.taxableBase = scaleLineAmount(line.taxableBase);
        }
        const taxRoundingKey = JSON.stringify(snap.taxRounding);
        const groupKey = `${snap.packId}\0${taxRoundingKey}`;
        let group = groups.get(groupKey);
        if (!group) {
            group = {
                taxRounding: snap.taxRounding,
                currency: snap.currency,
                components: [],
                affectedItemIndices: new Set(),
                affectedChargeIndices: new Set(),
            };
            groups.set(groupKey, group);
        }
        group.affectedItemIndices.add(idx);
        for (const comp of line.components || []) {
            const unscaledRaw = new TaxDecimal(comp.amount).plus(comp.roundingRemainder || '0');
            const raw = isScaled
                ? new decimal_js_1.default(unscaledRaw
                    .mul(new TaxDecimal(ratio))
                    .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP)
                    .toString())
                : new decimal_js_1.default(unscaledRaw.toString());
            group.components.push({
                comp,
                raw,
                rounded: new decimal_js_1.default(0),
                remainder: new decimal_js_1.default(0),
                line,
                orderIdx: orderCounter++,
            });
        }
    });
    if (nextChargeTaxes.snapshotJson.length > 0) {
        nextChargeTaxes.snapshotJson.forEach((snapJson, cIdx) => {
            let snap = null;
            try {
                snap = JSON.parse(snapJson);
            }
            catch {
                return;
            }
            if (snap?.taxRounding?.scope !== 'document' ||
                !Array.isArray(snap.lines) ||
                snap.lines.length === 0) {
                return;
            }
            chargeSnapshots.set(cIdx, snap);
            const line = snap.lines[0];
            const taxRoundingKey = JSON.stringify(snap.taxRounding);
            const groupKey = `${snap.packId}\0${taxRoundingKey}`;
            let group = groups.get(groupKey);
            if (!group) {
                group = {
                    taxRounding: snap.taxRounding,
                    currency: snap.currency,
                    components: [],
                    affectedItemIndices: new Set(),
                    affectedChargeIndices: new Set(),
                };
                groups.set(groupKey, group);
            }
            group.affectedChargeIndices.add(cIdx);
            for (const comp of line.components || []) {
                const raw = new decimal_js_1.default(comp.amount).plus(comp.roundingRemainder || '0');
                group.components.push({
                    comp,
                    raw,
                    rounded: new decimal_js_1.default(0),
                    remainder: new decimal_js_1.default(0),
                    line,
                    orderIdx: orderCounter++,
                });
            }
        });
    }
    for (const group of groups.values()) {
        const places = resolvePlaces(group.currency, group.taxRounding.decimalPlaces);
        const quantum = new decimal_js_1.default(10).pow(-places);
        const sumRaw = group.components.reduce((sum, c) => sum.plus(c.raw), new decimal_js_1.default(0));
        const target = (0, tax_engine_1.roundPlaces)(sumRaw, places, group.taxRounding.method);
        for (const entry of group.components) {
            entry.rounded = entry.raw.toDecimalPlaces(places, decimal_js_1.default.ROUND_FLOOR);
            entry.remainder = entry.raw.minus(entry.rounded);
        }
        const sumRounded = group.components.reduce((sum, c) => sum.plus(c.rounded), new decimal_js_1.default(0));
        let units = target.minus(sumRounded).div(quantum).toDecimalPlaces(0, decimal_js_1.default.ROUND_HALF_UP);
        const ordered = [...group.components].sort((left, right) => {
            const remainderOrder = right.remainder.comparedTo(left.remainder);
            if (remainderOrder !== 0)
                return remainderOrder;
            const ruleOrder = (left.comp.ruleId || '').localeCompare(right.comp.ruleId || '');
            if (ruleOrder !== 0)
                return ruleOrder;
            const lineOrder = (left.line.lineId || '').localeCompare(right.line.lineId || '');
            if (lineOrder !== 0)
                return lineOrder;
            return left.orderIdx - right.orderIdx;
        });
        let uIndex = 0;
        while (units.gt(0) && ordered.length > 0) {
            const entry = ordered[uIndex % ordered.length];
            entry.rounded = entry.rounded.plus(quantum);
            units = units.minus('1');
            uIndex += 1;
        }
        for (const entry of group.components) {
            entry.comp.amount = entry.rounded.toFixed(places);
            entry.comp.roundingRemainder = (0, tax_engine_1.canonical)(entry.raw.minus(entry.rounded));
        }
        for (const itemIdx of group.affectedItemIndices) {
            const snap = itemSnapshots.get(itemIdx);
            if (!snap || !Array.isArray(snap.lines) || snap.lines.length === 0)
                continue;
            const line = snap.lines[0];
            const lineTax = (line.components || []).reduce((sum, c) => sum.plus(new decimal_js_1.default(c.amount)), new decimal_js_1.default(0));
            line.taxAmount = lineTax.toFixed(places);
            itemOutputs[itemIdx] = {
                handled: true,
                taxAmount: lineTax.toNumber(),
                breakdown: (line.components || []).map((c) => ({
                    title: c.label || '',
                    rate: Number(c.rate || 0),
                    amount: Number(c.amount),
                })),
                snapshotJson: JSON.stringify(snap),
            };
        }
        for (const cIdx of group.affectedChargeIndices) {
            const snap = chargeSnapshots.get(cIdx);
            if (!snap || !Array.isArray(snap.lines) || snap.lines.length === 0)
                continue;
            const line = snap.lines[0];
            const lineTax = (line.components || []).reduce((sum, c) => sum.plus(new decimal_js_1.default(c.amount)), new decimal_js_1.default(0));
            line.taxAmount = lineTax.toFixed(places);
            nextChargeTaxes.snapshotJson[cIdx] = JSON.stringify(snap);
            nextChargeTaxes.breakdowns[cIdx] = (line.components || []).map((c) => ({
                title: c.label || '',
                rate: Number(c.rate || 0),
                amount: Number(c.amount),
            }));
        }
    }
    if (chargeSnapshots.size > 0 && nextChargeTaxes.snapshotJson.length > 0) {
        let chargeTaxAmount = new decimal_js_1.default(0);
        let chargeExclusiveTaxAmount = new decimal_js_1.default(0);
        for (const snapStr of nextChargeTaxes.snapshotJson) {
            try {
                const cSnap = JSON.parse(snapStr);
                for (const cLine of cSnap.lines || []) {
                    const lTax = new decimal_js_1.default(cLine.taxAmount || '0');
                    chargeTaxAmount = chargeTaxAmount.plus(lTax);
                    if (cLine.taxBehavior !== 'inclusive') {
                        chargeExclusiveTaxAmount = chargeExclusiveTaxAmount.plus(lTax);
                    }
                }
            }
            catch { }
        }
        nextChargeTaxes.taxAmount = chargeTaxAmount.toNumber();
        nextChargeTaxes.exclusiveTaxAmount = chargeExclusiveTaxAmount.toNumber();
    }
    return { itemOutputs, chargeTaxes: nextChargeTaxes };
}
/** Rolls up item and charge taxes, scaling document-scoped raw item components before rounding. */
function rollupOrderTaxes(args) {
    const { items, chargeTaxes, currency, decimals, minorFactor, itemTaxRatio, taxesEnabled } = args;
    const toSnapshotString = (snap, lineIdOverride) => {
        if (!snap)
            return null;
        if (!lineIdOverride)
            return typeof snap === 'string' ? snap : JSON.stringify(snap);
        try {
            const parsed = (typeof snap === 'string' ? JSON.parse(snap) : JSON.parse(JSON.stringify(snap)));
            if (parsed && Array.isArray(parsed.lines) && parsed.lines[0]) {
                parsed.lines[0].lineId = lineIdOverride;
                return JSON.stringify(parsed);
            }
        }
        catch { }
        return typeof snap === 'string' ? snap : JSON.stringify(snap);
    };
    if (itemTaxRatio.eq(1)) {
        let totalTax = new decimal_js_1.default(0);
        let exclusiveTax = new decimal_js_1.default(0);
        const breakdowns = [];
        const snapshots = [];
        for (const item of items) {
            const itemTax = new decimal_js_1.default(item.taxAmount || 0);
            totalTax = totalTax.plus(itemTax);
            if (item.taxType !== 'inclusive') {
                exclusiveTax = exclusiveTax.plus(itemTax);
            }
            if (item.breakdown && item.breakdown.length > 0) {
                breakdowns.push(item.breakdown);
            }
            snapshots.push(toSnapshotString(item.snapshot, item.lineIdOverride));
        }
        const itemTaxAmount = totalTax.toNumber();
        const itemExclusiveTaxAmount = exclusiveTax.toNumber();
        return {
            itemTaxAmount,
            itemExclusiveTaxAmount,
            taxRollup: combineItemAndChargeTaxes({
                itemTaxAmount,
                itemExclusiveTaxAmount,
                itemBreakdowns: breakdowns,
                itemSnapshots: snapshots,
                itemTaxRatio: 1,
                chargeTaxes,
                minorFactor,
            }),
        };
    }
    const discountedAlloc = taxesEnabled
        ? allocateDocumentTaxRounding({
            items: items.map((it) => ({
                snapshot: it.snapshot,
                lineIdOverride: it.lineIdOverride,
            })),
            chargeTaxes,
            currency,
            itemTaxRatio,
        })
        : null;
    const rollupChargeTaxes = discountedAlloc ? discountedAlloc.chargeTaxes : chargeTaxes;
    let docTotalTax = new decimal_js_1.default(0);
    let docExclusiveTax = new decimal_js_1.default(0);
    let nonDocTotalTax = new decimal_js_1.default(0);
    let nonDocExclusiveTax = new decimal_js_1.default(0);
    const nonDocBreakdowns = [];
    const nonDocSnapshots = [];
    const nonDocBreakdownSlots = [];
    const nonDocSnapshotSlots = [];
    const combinedBreakdowns = [];
    const combinedSnapshots = [];
    items.forEach((item, idx) => {
        const out = discountedAlloc?.itemOutputs[idx];
        if (out?.handled) {
            const itemTax = new decimal_js_1.default(out.taxAmount);
            docTotalTax = docTotalTax.plus(itemTax);
            if (item.taxType !== 'inclusive') {
                docExclusiveTax = docExclusiveTax.plus(itemTax);
            }
            if (out.breakdown.length > 0) {
                combinedBreakdowns.push(out.breakdown);
            }
            combinedSnapshots.push(out.snapshotJson);
        }
        else {
            const itemTax = new decimal_js_1.default(item.taxAmount || 0);
            nonDocTotalTax = nonDocTotalTax.plus(itemTax);
            if (item.taxType !== 'inclusive') {
                nonDocExclusiveTax = nonDocExclusiveTax.plus(itemTax);
            }
            if (item.breakdown && item.breakdown.length > 0) {
                nonDocBreakdownSlots.push(combinedBreakdowns.length);
                combinedBreakdowns.push([]);
                nonDocBreakdowns.push(item.breakdown);
            }
            nonDocSnapshotSlots.push(combinedSnapshots.length);
            combinedSnapshots.push(null);
            nonDocSnapshots.push(toSnapshotString(item.snapshot, item.lineIdOverride));
        }
    });
    const ratioScale = new TaxDecimal(itemTaxRatio.toString());
    const scaledNonDocTax = new TaxDecimal(nonDocTotalTax.toString())
        .mul(ratioScale)
        .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP)
        .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
    const scaledNonDocExclusiveTax = new TaxDecimal(nonDocExclusiveTax.toString())
        .mul(ratioScale)
        .toSignificantDigits(20, decimal_js_1.default.ROUND_HALF_UP)
        .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
    if (nonDocBreakdownSlots.length > 0) {
        const scaledBreakdowns = scaleTaxBreakdowns(nonDocBreakdowns, itemTaxRatio, scaledNonDocTax.toNumber(), minorFactor);
        nonDocBreakdownSlots.forEach((slotIdx, i) => {
            combinedBreakdowns[slotIdx] = scaledBreakdowns[i] || [];
        });
    }
    if (nonDocSnapshotSlots.length > 0) {
        const scaledSnapshots = scaleTaxSnapshots(nonDocSnapshots, itemTaxRatio, minorFactor);
        let snapCursor = 0;
        nonDocSnapshotSlots.forEach((slotIdx, i) => {
            combinedSnapshots[slotIdx] = nonDocSnapshots[i]
                ? (scaledSnapshots[snapCursor++] ?? null)
                : null;
        });
    }
    const itemTaxAmount = docTotalTax.plus(scaledNonDocTax).toNumber();
    const itemExclusiveTaxAmount = docExclusiveTax.plus(scaledNonDocExclusiveTax).toNumber();
    return {
        itemTaxAmount,
        itemExclusiveTaxAmount,
        taxRollup: combineItemAndChargeTaxes({
            itemTaxAmount,
            itemExclusiveTaxAmount,
            itemBreakdowns: combinedBreakdowns,
            itemSnapshots: combinedSnapshots,
            itemTaxRatio: 1,
            chargeTaxes: rollupChargeTaxes,
            minorFactor,
        }),
    };
}
// Tax preview endpoint handler
async function calculateTaxPreview(req, res) {
    try {
        const { items, customer_id, packaging_charge, delivery_charge, service_charge, discount_type, discount_value, online_platform, order_type, waived_charge_ids, opted_in_charge_ids, } = req.body;
        const hasOrderChargeContext = order_type !== undefined ||
            waived_charge_ids !== undefined ||
            opted_in_charge_ids !== undefined;
        if (hasOrderChargeContext && !charges_1.VALID_CHARGE_ORDER_TYPES.includes(order_type)) {
            res
                .status(400)
                .json({ error: `order_type must be one of ${charges_1.VALID_CHARGE_ORDER_TYPES.join(', ')}` });
            return;
        }
        if ([waived_charge_ids, opted_in_charge_ids].some((list) => list !== undefined &&
            list !== null &&
            (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')))) {
            res
                .status(400)
                .json({ error: 'waived_charge_ids and opted_in_charge_ids must be arrays of charge ids' });
            return;
        }
        if (!Array.isArray(items) || items.length === 0) {
            res.status(400).json({ error: 'Items are required' });
            return;
        }
        const db = (0, db_1.getDatabase)();
        // Get settings
        const settings = {};
        db.prepare('SELECT key, value FROM settings')
            .all()
            .forEach((row) => {
            settings[row.key] = row.value;
        });
        const tenantInfo = {
            country: settings.country || '',
            business_type: settings.business_type || 'restaurant',
            state_code: settings.state_code || '',
            taxes_enabled: settings.taxes_enabled === 'true',
        };
        const currency = (0, countries_1.resolveTenantCurrency)(settings.currency, tenantInfo.country);
        tenantInfo.currency = currency;
        const decimals = (0, countries_1.getCurrencyFractionDigits)(currency);
        const minorFactor = (0, countries_1.getCurrencyMinorUnitFactor)(currency);
        const customer = customer_id
            ? db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id)
            : null;
        // Same pricing rule as order placement, including the online platform price.
        const isOnlineOrder = typeof online_platform === 'string' && online_platform.trim().length > 0;
        const itemResults = [];
        let totalSubtotalDec = new decimal_js_1.default(0);
        const resolvedItems = [];
        for (const itemData of items) {
            if (!itemData || typeof itemData !== 'object' || !itemData.product_id) {
                continue;
            }
            const product = db
                .prepare('SELECT * FROM products WHERE id = ?')
                .get(itemData.product_id);
            if (!product) {
                console.warn(`[TaxPreview] Product with ID ${itemData.product_id} not found in database.`);
                continue;
            }
            // The cashier is quoted from the same catalog lookup the order is priced
            // from, so a variant basket cannot be quoted at the parent price.
            const variant = (0, product_variants_1.resolveOrderItemVariant)(db, product, itemData, isOnlineOrder);
            const menuUnitPrice = variant
                ? (0, product_variants_1.variantUnitPrice)(variant, isOnlineOrder)
                : parseFloat(product.price) || 0;
            // A cart line the owner has overridden is quoted at its normalized override price.
            const overridePrice = Number(itemData.price_override?.price);
            const unitPrice = itemData.price_override && Number.isFinite(overridePrice) && overridePrice >= 0
                ? (0, item_price_override_1.normalizeOverridePrice)(overridePrice, decimals)
                : menuUnitPrice;
            const rawQty = Number(itemData.quantity);
            const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
            const rawDisc = Number(itemData.discount_amount);
            const itemDiscount = Number.isFinite(rawDisc) && rawDisc >= 0 ? rawDisc : 0;
            let subtotal = unitPrice * quantity;
            if (itemData.addons) {
                for (const addon of itemData.addons) {
                    subtotal += (addon.price || 0) * (addon.quantity || 1) * quantity;
                }
            }
            subtotal = Math.max(0, subtotal - itemDiscount);
            resolvedItems.push({
                product,
                variant,
                unitPrice,
                quantity,
                itemDiscount,
                subtotal,
            });
            totalSubtotalDec = totalSubtotalDec.plus(subtotal);
        }
        const totalSubtotal = totalSubtotalDec.toNumber();
        let packaging = normalizeChargeAmount(packaging_charge, 'packaging');
        const delivery = normalizeChargeAmount(delivery_charge, 'delivery');
        let service = normalizeChargeAmount(service_charge, 'service_charge');
        let discountAmount = new decimal_js_1.default(0);
        if (discount_type !== undefined || discount_value !== undefined) {
            if (!['percentage', 'amount'].includes(discount_type)) {
                res.status(400).json({ error: 'discount_type must be percentage or amount' });
                return;
            }
            const parsedDiscount = Number(discount_value);
            if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0) {
                res.status(400).json({ error: 'discount_value must be a finite non-negative number' });
                return;
            }
            const subtotalDecimal = totalSubtotalDec;
            if (discount_type === 'percentage') {
                if (parsedDiscount > 100) {
                    res.status(400).json({ error: 'discount_value must not exceed 100 percent' });
                    return;
                }
                discountAmount = subtotalDecimal.mul(parsedDiscount).div(100);
            }
            else {
                discountAmount = decimal_js_1.default.min(new decimal_js_1.default(parsedDiscount), subtotalDecimal);
            }
            discountAmount = discountAmount.toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP);
        }
        let appliedCharges;
        let otherCharges = new decimal_js_1.default(0);
        if (hasOrderChargeContext) {
            const resolvedCharges = (0, charges_1.buildAppliedCharges)({
                currency,
                orderType: order_type,
                subtotal: totalSubtotal,
                discountAmount: discountAmount.toNumber(),
                waivedIds: waived_charge_ids ?? [],
                optedInIds: opted_in_charge_ids ?? [],
            });
            if (resolvedCharges.ownsPackagingChargeColumn)
                packaging = resolvedCharges.columns.packaging_charge;
            if (resolvedCharges.ownsServiceChargeColumn)
                service = resolvedCharges.columns.service_charge;
            appliedCharges = resolvedCharges.charges;
            if (resolvedCharges.configured)
                otherCharges = new decimal_js_1.default(resolvedCharges.columns.other_charges);
        }
        const chargeCategories = getConfiguredChargeTaxCategories(tenantInfo.country);
        const chargeContext = {
            packaging_charge: packaging,
            delivery_charge: delivery,
            service_charge: service,
            packaging_tax_category_id: chargeCategories.packaging?.categoryId || null,
            delivery_tax_category_id: chargeCategories.delivery?.categoryId || null,
            service_charge_tax_category_id: chargeCategories.service_charge?.categoryId || null,
        };
        const { itemResults: documentTaxResults, chargeTaxes } = calculateDocumentTaxes(tenantInfo, {
            items: resolvedItems.map((item, idx) => ({
                lineId: `line-${String(idx + 1).padStart(4, '0')}`,
                product: item.product,
                taxableAmount: item.subtotal,
            })),
            chargeContext,
            customer: customer || null,
        });
        for (let i = 0; i < resolvedItems.length; i++) {
            const item = resolvedItems[i];
            const taxResult = documentTaxResults[i];
            itemResults.push({
                product_id: item.product.id,
                product_name: item.product.name,
                quantity: item.quantity,
                unit_price: item.unitPrice,
                subtotal: round(item.subtotal, decimals),
                discount_amount: item.itemDiscount,
                tax_amount: taxResult.tax_amount,
                tax_breakdown: taxResult.tax_breakdown,
                tax_type: taxResult.tax_type,
                total: round(item.subtotal + (taxResult.tax_type === 'inclusive' ? 0 : taxResult.tax_amount), decimals),
            });
        }
        const subtotalDecimal = totalSubtotalDec;
        const discountedSubtotal = decimal_js_1.default.max(0, subtotalDecimal.minus(discountAmount));
        const taxRatio = discountAmount.gt(0) && subtotalDecimal.gt(0)
            ? computeDiscountTaxRatio(discountedSubtotal, subtotalDecimal)
            : new decimal_js_1.default(1);
        const { taxRollup } = rollupOrderTaxes({
            items: documentTaxResults.map((taxResult, idx) => ({
                taxAmount: taxResult.tax_amount,
                taxType: taxResult.tax_type,
                breakdown: taxResult.tax_breakdown || null,
                snapshot: taxResult.tax_snapshot || null,
                lineIdOverride: `line-${String(idx + 1).padStart(4, '0')}`,
            })),
            chargeTaxes,
            currency,
            decimals,
            minorFactor,
            itemTaxRatio: taxRatio,
            taxesEnabled: tenantInfo.taxes_enabled,
        });
        const aggregatedBreakdown = aggregateTaxBreakdown(taxRollup.breakdowns, minorFactor);
        const exactTotal = discountedSubtotal
            .plus(taxRollup.exclusiveTaxAmount)
            .plus(packaging)
            .plus(delivery)
            .plus(service)
            .plus(otherCharges)
            .toDecimalPlaces(decimals, decimal_js_1.default.ROUND_HALF_UP)
            .toNumber();
        const pack = getActiveCountryPack(tenantInfo.country);
        const { total, adjustment: roundOff } = (0, tax_engine_1.applyPayableRounding)(exactTotal, pack, currency);
        if (!Number.isSafeInteger(Math.round(total * minorFactor))) {
            throw new charges_1.ChargeValidationError('Order total exceeds the supported currency precision');
        }
        res.json({
            items: itemResults,
            summary: {
                subtotal: round(totalSubtotal, decimals),
                discount_amount: discountAmount.toNumber(),
                discounted_subtotal: discountedSubtotal.toNumber(),
                tax_amount: round(taxRollup.taxAmount, decimals),
                tax_breakdown: aggregatedBreakdown,
                packaging_charge: packaging,
                delivery_charge: delivery,
                service_charge: service,
                round_off: roundOff,
                total,
                ...(appliedCharges ? { charges_breakdown: appliedCharges } : {}),
            },
        });
    }
    catch (error) {
        console.error('[Tax] Preview error:', error);
        res
            .status(error.statusCode || 500)
            .json({ error: error.statusCode ? error.message : 'Internal server error' });
    }
}
//# sourceMappingURL=tax.js.map