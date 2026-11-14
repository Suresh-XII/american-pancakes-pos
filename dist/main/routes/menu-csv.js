"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.menuCsvRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const node_crypto_1 = require("node:crypto");
const authorization_1 = require("../services/authorization");
const inventory_1 = require("../services/inventory");
const cloud_sync_1 = require("../services/cloud-sync");
const operation_failure_1 = require("../lib/operation-failure");
const tax_1 = require("../services/tax");
const countries_1 = require("../countries");
const csv_1 = require("../lib/csv");
const router = (0, express_1.Router)();
exports.menuCsvRoutes = router;
const TEXT_HEADER_FIELDS = new Set([
    'name',
    'parent',
    'description',
    'color',
    'icon',
    'sku',
    'category',
    'category_parent',
    'tags',
    'group_name',
    'addon_name',
]);
function resolveCsvRowEncoding(row) {
    const marker = row[csv_1.FLO_CSV_ENCODING_COLUMN] ?? '';
    if (marker === '') {
        return { ok: true, mode: 'unmarked' };
    }
    if (marker === csv_1.FLO_CSV_ENCODING_QUOTE_V1) {
        return { ok: true, mode: 'quote-v1' };
    }
    return {
        ok: false,
        error: `unsupported ${csv_1.FLO_CSV_ENCODING_COLUMN} "${marker}"`,
    };
}
function formatProductTagsForCsv(rawTags) {
    if (!rawTags)
        return '';
    try {
        const parsed = JSON.parse(rawTags);
        return Array.isArray(parsed) ? parsed.join(',') : String(rawTags);
    }
    catch {
        return String(rawTags);
    }
}
function captureInvalidMenuCsvInput() {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.menu_csv.import.invalid_input',
        outcome: 'not_applied',
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change CSV import responses.
    }
}
function captureMenuCsvRowRejections(failedCount, changedCount) {
    if (failedCount === 0)
        return;
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.menu_csv.import.row_rejections',
        outcome: changedCount > 0 ? 'partial' : 'not_applied',
        facts: { failed_count: failedCount, changed_count: changedCount },
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change CSV import responses.
    }
}
const VALID_TAX_BEHAVIORS = ['country_default', 'inclusive', 'exclusive', 'exempt'];
// Throws RegionalNotConfiguredError (mapped to 409 by csvImportErrorResponse)
// when the store has no resolvable country yet.
function currentRegionalSnapshot() {
    return (0, countries_1.resolveRegionalSnapshot)({
        country: (0, db_1.getSettingValue)('country') ?? undefined,
        currency: (0, db_1.getSettingValue)('currency') ?? undefined,
        timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
        currency_display: (0, db_1.getSettingValue)('currency_display') ?? undefined,
        number_digits: (0, db_1.getSettingValue)('number_digits') ?? undefined,
        calendar: (0, db_1.getSettingValue)('calendar') ?? undefined,
    });
}
// Keep CSV imports below Express' default 100 KiB JSON body limit while also
// bounding the parser's work when it is mounted outside the production server.
const MAX_CSV_BYTES = 100_000;
const MAX_CSV_ROWS = 10_000;
const MAX_CSV_COLUMNS = 64;
const MAX_CSV_CELL_LENGTH = 10_000;
const NUMBER_TOKEN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
class CsvImportError extends Error {
    statusCode = 400;
    constructor(message) {
        super(message);
        this.name = 'CsvImportError';
    }
}
// ─── CSV helpers ─────────────────────────────────────────────────────────────
function parseCSV(text) {
    if (typeof text !== 'string')
        throw new CsvImportError('CSV data must be a string');
    if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
        throw new CsvImportError(`CSV exceeds the ${MAX_CSV_BYTES}-byte size limit`);
    }
    const rows = [];
    let fields = [];
    let field = '';
    let inQuotes = false;
    let afterClosingQuote = false;
    let lineNumber = 1;
    const append = (value) => {
        field += value;
        if (field.length > MAX_CSV_CELL_LENGTH) {
            throw new CsvImportError(`CSV cell on row ${lineNumber} exceeds the ${MAX_CSV_CELL_LENGTH}-character length limit`);
        }
    };
    const pushField = () => {
        if (fields.length >= MAX_CSV_COLUMNS) {
            throw new CsvImportError(`CSV row ${lineNumber} exceeds the ${MAX_CSV_COLUMNS}-cell limit`);
        }
        fields.push(field);
        field = '';
    };
    const pushRow = () => {
        pushField();
        if (fields.some((value) => value.trim())) {
            rows.push(fields);
            if (rows.length > MAX_CSV_ROWS) {
                throw new CsvImportError(`CSV exceeds the ${MAX_CSV_ROWS}-row limit`);
            }
        }
        fields = [];
        field = '';
    };
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"' && text[i + 1] === '"') {
                append('"');
                i++;
            }
            else if (char === '"') {
                inQuotes = false;
                afterClosingQuote = true;
            }
            else {
                append(char);
                if (char === '\n')
                    lineNumber++;
                else if (char === '\r') {
                    if (text[i + 1] === '\n') {
                        append('\n');
                        i++;
                    }
                    lineNumber++;
                }
            }
            continue;
        }
        if (afterClosingQuote) {
            if (char === ',') {
                pushField();
                afterClosingQuote = false;
            }
            else if (char === '\n' || char === '\r') {
                pushRow();
                if (char === '\r' && text[i + 1] === '\n')
                    i++;
                lineNumber++;
                afterClosingQuote = false;
            }
            else {
                throw new CsvImportError(`Malformed CSV: unexpected character after closing quote on row ${lineNumber}`);
            }
            continue;
        }
        if (char === '"') {
            if (field.length !== 0) {
                throw new CsvImportError(`Malformed CSV: unexpected quote on row ${lineNumber}`);
            }
            inQuotes = true;
        }
        else if (char === ',') {
            pushField();
        }
        else if (char === '\n' || char === '\r') {
            pushRow();
            if (char === '\r' && text[i + 1] === '\n')
                i++;
            lineNumber++;
        }
        else {
            append(char);
        }
    }
    if (inQuotes) {
        throw new CsvImportError(`Malformed CSV: unterminated quoted field on row ${lineNumber}`);
    }
    if (field.length > 0 || fields.length > 0 || afterClosingQuote)
        pushRow();
    return rows;
}
function toObjects(rows) {
    if (rows.length < 2)
        return [];
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    return rows.slice(1).map((row, index) => {
        if (row.length > headers.length) {
            throw new CsvImportError(`CSV row ${index + 2} has ${row.length} cells; expected at most ${headers.length}`);
        }
        const obj = {};
        headers.forEach((h, i) => {
            const rawCell = row[i] ?? '';
            obj[h] =
                TEXT_HEADER_FIELDS.has(h) && /^\s+[=+\-@]/.test(rawCell)
                    ? rawCell.trimEnd()
                    : rawCell.trim();
        });
        return obj;
    });
}
function parseNumericField(raw, fieldName, options = {}) {
    const rawValue = raw ?? '';
    const trimmed = rawValue.trim();
    if (trimmed === '') {
        if (options.optional)
            return { ok: true, value: options.defaultValue ?? 0 };
        return { ok: false, error: `invalid ${fieldName} "${rawValue}"` };
    }
    const value = options.localized
        ? ((0, countries_1.canonicalizeLocalizedAmount)(trimmed, options.localized) ?? '')
        : trimmed;
    if (!value || !NUMBER_TOKEN.test(value))
        return { ok: false, error: `invalid ${fieldName} "${rawValue}"` };
    const parsed = Number(value);
    if (!Number.isFinite(parsed) ||
        (options.integer && !Number.isInteger(parsed)) ||
        (options.min !== undefined && parsed < options.min) ||
        (options.max !== undefined && parsed > options.max)) {
        return { ok: false, error: `invalid ${fieldName} "${rawValue}"` };
    }
    return { ok: true, value: parsed };
}
function csvImportErrorResponse(res, error) {
    if (error instanceof countries_1.RegionalNotConfiguredError) {
        return res.status(409).json({ error: 'regional_not_configured' });
    }
    if (error instanceof CsvImportError) {
        captureInvalidMenuCsvInput();
        return res.status(error.statusCode).json({
            error: error.message,
            errors: [error.message],
            created: 0,
            updated: 0,
            reactivated: 0,
            skipped: 0,
            failed: 1,
            groups_created: 0,
            addons_created: 0,
            groups_reactivated: 0,
            addons_reactivated: 0,
        });
    }
    console.error('[API] Menu CSV import failed:', error);
    return res.status(500).json({ error: 'Menu CSV import failed' });
}
function isTruthy(v) {
    return ['yes', 'true', '1'].includes((v || '').toLowerCase());
}
// An imported stock figure is a catalog write, so it moves through the ledger
// exactly like the product and variant paths do. A bare column write would leave
// a stock value with no movement behind it, which the restore validator rejects.
function applyImportedAddonStock(db, addonId, stockQuantity, referenceType, referenceId, actorUserId) {
    const current = db.prepare('SELECT stock_quantity FROM addons WHERE id = ?').get(addonId);
    const quantityDelta = stockQuantity - Number(current?.stock_quantity ?? 0);
    if (quantityDelta === 0)
        return;
    (0, inventory_1.adjustProductStock)(db, {
        productId: null,
        addonId,
        quantityDelta,
        movementType: 'adjustment',
        referenceType,
        referenceId,
        reason: 'Add-on stock imported from menu CSV',
        actorUserId,
    });
}
// ─── Templates ───────────────────────────────────────────────────────────────
const TEMPLATES = {
    categories: [
        'name,parent,description,color,icon,sort_order',
        'Beverages,,Hot and cold drinks,blue,☕,1',
        'Hot Drinks,Beverages,Freshly brewed coffee and tea,amber,☕,1',
        'Food,,Snacks and meals,green,🍔,2',
        'Desserts,,Sweet treats,pink,🍰,3',
        'Combos,,Meal deals and bundles,amber,🎁,4',
    ].join('\n'),
    products: [
        'id,sku,name,category,category_parent,price,description,cost,tax_category,tax_behavior,cashback_percent,tags,is_active',
        ',,Cappuccino,Beverages,,150,Rich espresso with steamed milk,50,,,,"veg,bestseller",yes',
        ',,Espresso,Beverages,,100,,40,,,,veg,yes',
        ',,Cold Coffee,Beverages,,130,Chilled blended coffee,45,,,,"veg,new_arrival",yes',
        ',,Classic Burger,Food,,250,Juicy patty with lettuce and tomato,100,,,,non_veg,yes',
        ',,Veg Sandwich,Food,,180,Fresh vegetables in toasted bread,60,,,,"veg,new_arrival",yes',
        ',,Chocolate Cake,Desserts,,120,Rich chocolate slice,,,,,veg,yes',
    ].join('\n'),
    addons: [
        'group_name,addon_name,price,group_required,group_min_select,group_max_select,track_inventory,stock_quantity,low_stock_threshold',
        'Size,Small,0,no,1,1,no,0,0',
        'Size,Regular,20,no,1,1,no,0,0',
        'Size,Large,40,no,1,1,no,0,0',
        'Milk Type,Full Cream,0,yes,1,1,no,0,0',
        'Milk Type,Oat Milk,30,yes,1,1,no,0,0',
        'Milk Type,Almond Milk,40,yes,1,1,no,0,0',
        'Extras,Extra Shot,30,no,0,3,no,0,0',
        'Extras,Extra Sugar,0,no,0,3,no,0,0',
        'Temperature,Hot,0,yes,1,1,no,0,0',
        'Temperature,Cold (Iced),10,yes,1,1,no,0,0',
    ].join('\n'),
};
router.get('/template/:type', (0, authorization_1.requirePermission)('catalog.import-export'), (req, res) => {
    const type = req.params.type;
    const csv = TEMPLATES[type];
    if (!csv)
        return res.status(404).json({ error: 'Unknown template type' });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-template.csv"`);
    res.send(csv);
});
// ─── Export ──────────────────────────────────────────────────────────────────
router.get('/export/categories', (0, authorization_1.requirePermission)('catalog.import-export'), (_req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db
            .prepare(`SELECT c.*, p.name AS parent_name
           FROM categories c
           LEFT JOIN categories p ON c.parent_id = p.id AND p.deleted_at IS NULL
           WHERE c.deleted_at IS NULL
           ORDER BY CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END, COALESCE(p.sort_order, c.sort_order), c.sort_order, c.name`)
            .all();
        const lines = [`name,parent,description,color,icon,sort_order,${csv_1.FLO_CSV_ENCODING_COLUMN}`];
        for (const c of rows)
            lines.push((0, csv_1.toQuoteV1CsvRow)([
                c.name,
                c.parent_name ?? '',
                c.description,
                c.color,
                c.icon,
                c.sort_order,
                csv_1.FLO_CSV_ENCODING_QUOTE_V1,
            ]));
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="categories-export.csv"');
        res.send(lines.join('\n'));
    }
    catch (err) {
        console.error('[API] Menu CSV export failed:', err);
        res.status(500).json({ error: 'Menu CSV export failed' });
    }
});
router.get('/export/products', (0, authorization_1.requirePermission)('catalog.import-export'), (_req, res) => {
    try {
        const regionalSnapshot = currentRegionalSnapshot();
        const db = (0, db_1.getDatabase)();
        const rows = db
            .prepare(`SELECT p.*, c.name AS category_name, cp.name AS category_parent_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN categories cp ON c.parent_id = cp.id AND cp.deleted_at IS NULL
         WHERE p.deleted_at IS NULL
         ORDER BY COALESCE(cp.sort_order, c.sort_order), c.sort_order, p.sort_order, p.name`)
            .all();
        const lines = [
            `id,sku,name,category,category_parent,price,description,cost,tax_category,tax_behavior,cashback_percent,tags,is_active,${csv_1.FLO_CSV_ENCODING_COLUMN}`,
        ];
        for (const p of rows) {
            const tags = formatProductTagsForCsv(p.tags);
            lines.push((0, csv_1.toQuoteV1CsvRow)([
                p.id,
                p.sku,
                p.name,
                p.category_name,
                p.category_parent_name ?? '',
                (0, countries_1.formatAmountForCsv)(p.price, regionalSnapshot),
                p.description,
                (0, countries_1.formatAmountForCsv)(p.cost || 0, regionalSnapshot),
                p.tax_category_id ?? '',
                p.tax_behavior ?? '',
                p.cb_percent !== null ? p.cb_percent : '',
                tags,
                p.is_active ? 'yes' : 'no',
                csv_1.FLO_CSV_ENCODING_QUOTE_V1,
            ]));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="products-export.csv"');
        res.send(lines.join('\n'));
    }
    catch (err) {
        if (err instanceof countries_1.RegionalNotConfiguredError)
            return res.status(409).json({ error: 'regional_not_configured' });
        console.error('[API] Menu CSV export failed:', err);
        res.status(500).json({ error: 'Menu CSV export failed' });
    }
});
router.get('/export/addons', (0, authorization_1.requirePermission)('catalog.import-export'), (_req, res) => {
    try {
        const regionalSnapshot = currentRegionalSnapshot();
        const db = (0, db_1.getDatabase)();
        const groups = db
            .prepare('SELECT * FROM addon_groups WHERE is_active = 1 ORDER BY sort_order, name')
            .all();
        const lines = [
            `group_name,addon_name,price,group_required,group_min_select,group_max_select,track_inventory,stock_quantity,low_stock_threshold,${csv_1.FLO_CSV_ENCODING_COLUMN}`,
        ];
        for (const g of groups) {
            const addons = db
                .prepare('SELECT * FROM addons WHERE addon_group_id = ? AND is_active = 1 ORDER BY sort_order, name')
                .all(g.id);
            for (const a of addons)
                lines.push((0, csv_1.toQuoteV1CsvRow)([
                    g.name,
                    a.name,
                    (0, countries_1.formatAmountForCsv)(a.price, regionalSnapshot),
                    g.is_required ? 'yes' : 'no',
                    g.min_selection,
                    g.max_selection,
                    a.track_inventory ? 'yes' : 'no',
                    Number(a.stock_quantity ?? 0),
                    Number(a.low_stock_threshold ?? 0),
                    csv_1.FLO_CSV_ENCODING_QUOTE_V1,
                ]));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="addons-export.csv"');
        res.send(lines.join('\n'));
    }
    catch (err) {
        if (err instanceof countries_1.RegionalNotConfiguredError)
            return res.status(409).json({ error: 'regional_not_configured' });
        console.error('[API] Menu CSV export failed:', err);
        res.status(500).json({ error: 'Menu CSV export failed' });
    }
});
// ─── Import ──────────────────────────────────────────────────────────────────
router.post('/import/categories', (0, authorization_1.requirePermission)('catalog.import-export'), (req, res) => {
    try {
        const { csv } = req.body;
        if (typeof csv !== 'string' || !csv) {
            captureInvalidMenuCsvInput();
            return res.status(400).json({ error: 'No CSV data provided' });
        }
        const parsedCsv = parseCSV(csv);
        const headers = new Set((parsedCsv[0] || []).map((header) => header.trim().toLowerCase()));
        const hasParentColumn = headers.has('parent');
        const rows = toObjects(parsedCsv);
        if (!rows.length) {
            captureInvalidMenuCsvInput();
            return res.status(400).json({ error: 'CSV has no data rows' });
        }
        const db = (0, db_1.getDatabase)();
        const updated = 0, reactivated = 0;
        let created = 0, skipped = 0, failed = 0, changedRows = 0;
        const errorsByRow = [];
        const failRow = (index, message) => {
            failed++;
            errorsByRow.push({ index, message });
        };
        db.transaction(() => {
            const parsedRows = [];
            for (let i = 0; i < rows.length; i++) {
                const rawRow = rows[i];
                const rowNum = i + 2;
                const encoding = resolveCsvRowEncoding(rawRow);
                if (!encoding.ok) {
                    failRow(i, `Row ${rowNum}: ${encoding.error}`);
                    continue;
                }
                const r = encoding.mode === 'quote-v1'
                    ? {
                        ...rawRow,
                        name: (0, csv_1.decodeQuoteV1Field)(rawRow.name ?? ''),
                        parent: (0, csv_1.decodeQuoteV1Field)(rawRow.parent ?? ''),
                        description: (0, csv_1.decodeQuoteV1Field)(rawRow.description ?? ''),
                        color: (0, csv_1.decodeQuoteV1Field)(rawRow.color ?? ''),
                        icon: (0, csv_1.decodeQuoteV1Field)(rawRow.icon ?? ''),
                    }
                    : rawRow;
                if (!r.name || !r.name.trim()) {
                    failRow(i, `Row ${rowNum}: missing name`);
                    continue;
                }
                const sortOrder = parseNumericField(r.sort_order, 'sort_order', {
                    optional: true,
                    defaultValue: 0,
                    integer: true,
                });
                if (!sortOrder.ok) {
                    failRow(i, `Row ${rowNum} (${r.name}): ${sortOrder.error}`);
                    continue;
                }
                const nameNorm = r.name.trim().toLowerCase();
                const parentRaw = (r.parent ?? '').trim();
                const parentNorm = parentRaw.toLowerCase();
                parsedRows.push({
                    index: i,
                    rowNum,
                    r,
                    nameNorm,
                    parentRaw,
                    parentNorm,
                    sortOrder: sortOrder.value,
                    rejected: false,
                });
            }
            const rawDbCategories = db
                .prepare('SELECT id, name, parent_id, is_active FROM categories WHERE deleted_at IS NULL')
                .all();
            const liveCategoryIds = new Set(rawDbCategories.map((c) => c.id));
            const dbCategories = rawDbCategories.map((c) => {
                const rawParentId = c.parent_id ? c.parent_id.trim() || null : null;
                const effectiveParentId = rawParentId && liveCategoryIds.has(rawParentId) ? rawParentId : null;
                return {
                    id: c.id,
                    name: c.name,
                    parent_id: effectiveParentId,
                    has_dangling_parent: Boolean(rawParentId && !liveCategoryIds.has(rawParentId)),
                    is_active: c.is_active,
                };
            });
            const csvChildParentNorms = new Map();
            const csvRootNorms = new Set();
            for (const item of parsedRows) {
                if (item.parentNorm) {
                    const set = csvChildParentNorms.get(item.nameNorm) || new Set();
                    set.add(item.parentNorm);
                    csvChildParentNorms.set(item.nameNorm, set);
                }
                else {
                    csvRootNorms.add(item.nameNorm);
                }
            }
            const isRootNorm = (norm) => csvRootNorms.has(norm) ||
                dbCategories.some((c) => c.parent_id === null && c.name.trim().toLowerCase() === norm);
            const hasCycleTo = (startParentNorm, targetNorm) => {
                const queue = [startParentNorm];
                const visited = new Set();
                while (queue.length > 0) {
                    const current = queue.shift();
                    if (isRootNorm(current))
                        continue;
                    if (current === targetNorm)
                        return true;
                    if (visited.has(current))
                        continue;
                    visited.add(current);
                    for (const next of csvChildParentNorms.get(current) || []) {
                        if (!isRootNorm(next))
                            queue.push(next);
                    }
                    for (const dbCat of dbCategories) {
                        if (dbCat.name.trim().toLowerCase() === current && dbCat.parent_id) {
                            const parentCat = dbCategories.find((c) => c.id === dbCat.parent_id);
                            if (parentCat && parentCat.parent_id !== null) {
                                const parentNorm = parentCat.name.trim().toLowerCase();
                                if (!isRootNorm(parentNorm))
                                    queue.push(parentNorm);
                            }
                        }
                    }
                }
                return false;
            };
            for (const item of parsedRows) {
                if (!item.parentNorm || isRootNorm(item.parentNorm))
                    continue;
                if (item.parentNorm === item.nameNorm) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): category cannot be its own parent`);
                    item.rejected = true;
                    continue;
                }
                if (hasCycleTo(item.parentNorm, item.nameNorm)) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): parent category "${item.parentRaw}" creates a cycle`);
                    item.rejected = true;
                    continue;
                }
                if (csvChildParentNorms.has(item.parentNorm)) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): parent category "${item.parentRaw}" is a subcategory (maximum 2 levels supported)`);
                    item.rejected = true;
                }
            }
            const seenSiblings = new Set();
            // Pass 1: root category rows (no parent specified)
            for (const item of parsedRows) {
                if (item.rejected || item.parentNorm)
                    continue;
                const siblingKey = `ROOT::${item.nameNorm}`;
                if (seenSiblings.has(siblingKey)) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): duplicate sibling category name "${item.r.name}"`);
                    item.rejected = true;
                    continue;
                }
                if (!hasParentColumn) {
                    const allMatches = dbCategories.filter((c) => c.name.trim().toLowerCase() === item.nameNorm);
                    if (allMatches.length > 1) {
                        failRow(item.index, `Row ${item.rowNum} (${item.r.name}): category "${item.r.name}" is ambiguous; specify parent`);
                        item.rejected = true;
                        continue;
                    }
                }
                const rootMatches = dbCategories.filter((c) => c.parent_id === null && c.name.trim().toLowerCase() === item.nameNorm);
                const targetMatches = !hasParentColumn && rootMatches.length === 0
                    ? dbCategories.filter((c) => c.name.trim().toLowerCase() === item.nameNorm)
                    : rootMatches;
                if (targetMatches.length > 1) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): category "${item.r.name}" is ambiguous`);
                    item.rejected = true;
                    continue;
                }
                if (targetMatches.length === 1) {
                    const existing = targetMatches[0];
                    if (existing.name !== item.r.name) {
                        failRow(item.index, `Row ${item.rowNum} (${item.r.name}): duplicate sibling category name "${item.r.name}"`);
                        item.rejected = true;
                        continue;
                    }
                    seenSiblings.add(siblingKey);
                    skipped++;
                    continue;
                }
                const id = (0, node_crypto_1.randomUUID)();
                const slug = item.r.name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '');
                db.prepare(`INSERT INTO categories (id, name, slug, description, parent_id, color, icon, sort_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?)`).run(id, item.r.name, slug, item.r.description || null, item.r.color || null, item.r.icon || null, item.sortOrder, (0, db_1.now)(), (0, db_1.now)());
                dbCategories.push({
                    id,
                    name: item.r.name,
                    parent_id: null,
                    has_dangling_parent: false,
                    is_active: 1,
                });
                seenSiblings.add(siblingKey);
                created++;
                changedRows++;
            }
            // Pass 2: child category rows (parent specified)
            for (const item of parsedRows) {
                if (item.rejected || !item.parentNorm)
                    continue;
                const rootParents = dbCategories.filter((c) => c.parent_id === null && c.name.trim().toLowerCase() === item.parentNorm);
                if (rootParents.length > 1) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): parent category "${item.parentRaw}" is ambiguous`);
                    item.rejected = true;
                    continue;
                }
                if (rootParents.length === 0) {
                    const nonRootMatch = dbCategories.some((c) => c.parent_id !== null && c.name.trim().toLowerCase() === item.parentNorm);
                    failRow(item.index, nonRootMatch
                        ? `Row ${item.rowNum} (${item.r.name}): parent category "${item.parentRaw}" is a subcategory (maximum 2 levels supported)`
                        : `Row ${item.rowNum} (${item.r.name}): parent category "${item.parentRaw}" not found`);
                    item.rejected = true;
                    continue;
                }
                const parentCat = rootParents[0];
                const siblingKey = `${parentCat.id}::${item.nameNorm}`;
                if (seenSiblings.has(siblingKey)) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): duplicate sibling category name "${item.r.name}" under "${item.parentRaw}"`);
                    item.rejected = true;
                    continue;
                }
                const childMatches = dbCategories.filter((c) => c.parent_id === parentCat.id && c.name.trim().toLowerCase() === item.nameNorm);
                if (childMatches.length > 1) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): category "${item.r.name}" under "${item.parentRaw}" is ambiguous`);
                    item.rejected = true;
                    continue;
                }
                if (childMatches.length === 1) {
                    const existingChild = childMatches[0];
                    if (existingChild.name !== item.r.name) {
                        failRow(item.index, `Row ${item.rowNum} (${item.r.name}): duplicate sibling category name "${item.r.name}" under "${item.parentRaw}"`);
                        item.rejected = true;
                        continue;
                    }
                    seenSiblings.add(siblingKey);
                    skipped++;
                    continue;
                }
                if (parentCat.has_dangling_parent) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): parent category "${item.parentRaw}" is a subcategory (maximum 2 levels supported)`);
                    item.rejected = true;
                    continue;
                }
                if (!parentCat.is_active) {
                    failRow(item.index, `Row ${item.rowNum} (${item.r.name}): parent category "${item.parentRaw}" is inactive`);
                    item.rejected = true;
                    continue;
                }
                const id = (0, node_crypto_1.randomUUID)();
                const slug = item.r.name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '');
                db.prepare(`INSERT INTO categories (id, name, slug, description, parent_id, color, icon, sort_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, item.r.name, slug, item.r.description || null, parentCat.id, item.r.color || null, item.r.icon || null, item.sortOrder, (0, db_1.now)(), (0, db_1.now)());
                dbCategories.push({
                    id,
                    name: item.r.name,
                    parent_id: parentCat.id,
                    has_dangling_parent: false,
                    is_active: 1,
                });
                seenSiblings.add(siblingKey);
                created++;
                changedRows++;
            }
        })();
        const errors = errorsByRow.sort((a, b) => a.index - b.index).map((entry) => entry.message);
        captureMenuCsvRowRejections(failed, changedRows);
        res.json({ created, updated, reactivated, skipped, failed, errors });
    }
    catch (err) {
        return csvImportErrorResponse(res, err);
    }
});
router.post('/import/products', (0, authorization_1.requirePermission)('catalog.import-export'), (req, res) => {
    try {
        const { csv } = req.body;
        if (typeof csv !== 'string' || !csv) {
            captureInvalidMenuCsvInput();
            return res.status(400).json({ error: 'No CSV data provided' });
        }
        const parsedCsv = parseCSV(csv);
        const headers = new Set((parsedCsv[0] || []).map((header) => header.trim().toLowerCase()));
        const hasCategoryParentColumn = headers.has('category_parent');
        const hasTaxCategoryColumn = headers.has('tax_category');
        const hasTaxBehaviorColumn = headers.has('tax_behavior');
        const rows = toObjects(parsedCsv);
        if (!rows.length) {
            captureInvalidMenuCsvInput();
            return res.status(400).json({ error: 'CSV has no data rows' });
        }
        const db = (0, db_1.getDatabase)();
        const rawCatRows = db
            .prepare('SELECT id, name, parent_id, is_active FROM categories WHERE deleted_at IS NULL')
            .all();
        const liveCatIds = new Set(rawCatRows.map((c) => c.id));
        const catRows = rawCatRows.map((c) => {
            const rawParentId = c.parent_id ? c.parent_id.trim() || null : null;
            const effectiveParentId = rawParentId && liveCatIds.has(rawParentId) ? rawParentId : null;
            return {
                id: c.id,
                name: c.name,
                raw_parent_id: rawParentId,
                parent_id: effectiveParentId,
                is_active: Boolean(c.is_active),
            };
        });
        const catById = new Map(catRows.map((c) => [c.id, c]));
        const isCategoryChainActive = (targetId) => {
            const target = catById.get(targetId);
            if (!target || !target.is_active)
                return false;
            const seen = new Set([target.id]);
            let nextParentId = target.raw_parent_id;
            while (nextParentId && !seen.has(nextParentId)) {
                seen.add(nextParentId);
                const ancestor = catById.get(nextParentId);
                if (!ancestor || !ancestor.is_active)
                    return false;
                nextParentId = ancestor.raw_parent_id;
            }
            return true;
        };
        const country = (0, db_1.getSettingValue)('country') || '';
        const businessType = (0, db_1.getSettingValue)('business_type') || 'restaurant';
        const activePack = (0, tax_1.getActiveCountryPack)(country);
        const taxCategoriesConfigured = (0, tax_1.hasConfiguredTaxCategories)(activePack, businessType);
        const taxCategoryIds = new Set(activePack.categories.map((category) => category.id));
        const regionalSnapshot = currentRegionalSnapshot();
        let created = 0, updated = 0, reactivated = 0, skipped = 0, failed = 0, changedRows = 0;
        const errors = [];
        const findExistingProduct = db.prepare(`SELECT p.id, p.category_id, p.name, p.sku, p.description, p.tags, p.is_active,
                c.name AS category_name, cp.name AS category_parent_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN categories cp ON c.parent_id = cp.id AND cp.deleted_at IS NULL
         WHERE p.id = ? AND p.deleted_at IS NULL`);
        db.transaction(() => {
            for (let i = 0; i < rows.length; i++) {
                const rawRow = rows[i];
                const encoding = resolveCsvRowEncoding(rawRow);
                if (!encoding.ok) {
                    failed++;
                    errors.push(`Row ${i + 2}: ${encoding.error}`);
                    continue;
                }
                let r;
                let existingProduct;
                if (encoding.mode === 'quote-v1') {
                    r = {
                        ...rawRow,
                        id: (0, csv_1.decodeQuoteV1Field)(rawRow.id ?? ''),
                        sku: (0, csv_1.decodeQuoteV1Field)(rawRow.sku ?? ''),
                        name: (0, csv_1.decodeQuoteV1Field)(rawRow.name ?? ''),
                        category: (0, csv_1.decodeQuoteV1Field)(rawRow.category ?? ''),
                        category_parent: (0, csv_1.decodeQuoteV1Field)(rawRow.category_parent ?? ''),
                        description: (0, csv_1.decodeQuoteV1Field)(rawRow.description ?? ''),
                        tax_category: (0, csv_1.decodeQuoteV1Field)(rawRow.tax_category ?? ''),
                        tax_behavior: (0, csv_1.decodeQuoteV1Field)(rawRow.tax_behavior ?? ''),
                        tags: (0, csv_1.decodeQuoteV1Field)(rawRow.tags ?? ''),
                    };
                    if (r.id) {
                        existingProduct = findExistingProduct.get(r.id);
                    }
                }
                else {
                    if (rawRow.id) {
                        existingProduct = findExistingProduct.get(rawRow.id);
                    }
                    if (existingProduct) {
                        r = {
                            ...rawRow,
                            id: existingProduct.id,
                            sku: (0, csv_1.decodeLegacyProvenField)(rawRow.sku ?? '', existingProduct.sku),
                            name: (0, csv_1.decodeLegacyProvenField)(rawRow.name ?? '', existingProduct.name),
                            category: (0, csv_1.decodeLegacyProvenField)(rawRow.category ?? '', existingProduct.category_name),
                            category_parent: (0, csv_1.decodeLegacyProvenField)(rawRow.category_parent ?? '', existingProduct.category_parent_name),
                            description: (0, csv_1.decodeLegacyProvenField)(rawRow.description ?? '', existingProduct.description),
                            tags: (0, csv_1.decodeLegacyProvenField)(rawRow.tags ?? '', formatProductTagsForCsv(existingProduct.tags)),
                        };
                    }
                    else {
                        r = rawRow;
                    }
                }
                if (!r.name || !r.name.trim()) {
                    failed++;
                    errors.push(`Row ${i + 2}: missing name`);
                    continue;
                }
                const priceResult = parseNumericField(r.price, 'price', {
                    min: 0,
                    localized: regionalSnapshot,
                });
                if (!priceResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.name}): ${priceResult.error}`);
                    continue;
                }
                const price = priceResult.value;
                const costResult = parseNumericField(r.cost, 'cost', {
                    optional: true,
                    defaultValue: 0,
                    min: 0,
                    localized: regionalSnapshot,
                });
                if (!costResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.name}): ${costResult.error}`);
                    continue;
                }
                const cost = costResult.value;
                let categoryId = null;
                const categoryRaw = (r.category ?? '').trim();
                const categoryParentRaw = (r.category_parent ?? '').trim();
                if (!categoryRaw && categoryParentRaw) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.name}): category is required when category_parent is provided`);
                    continue;
                }
                if (categoryRaw) {
                    const catNorm = categoryRaw.toLowerCase();
                    if (categoryParentRaw) {
                        const parentNorm = categoryParentRaw.toLowerCase();
                        const rootMatches = catRows.filter((c) => c.parent_id === null && c.name.trim().toLowerCase() === parentNorm);
                        if (rootMatches.length > 1) {
                            failed++;
                            errors.push(`Row ${i + 2} (${r.name}): category_parent "${r.category_parent}" is ambiguous`);
                            continue;
                        }
                        if (rootMatches.length === 1) {
                            const childMatches = catRows.filter((c) => c.parent_id === rootMatches[0].id && c.name.trim().toLowerCase() === catNorm);
                            if (childMatches.length === 0) {
                                failed++;
                                errors.push(`Row ${i + 2} (${r.name}): category "${r.category}" under parent "${r.category_parent}" not found — import categories first`);
                                continue;
                            }
                            if (childMatches.length > 1) {
                                failed++;
                                errors.push(`Row ${i + 2} (${r.name}): category "${r.category}" under parent "${r.category_parent}" is ambiguous`);
                                continue;
                            }
                            categoryId = childMatches[0].id;
                        }
                        else {
                            const nonRootParents = catRows.filter((c) => c.parent_id !== null && c.name.trim().toLowerCase() === parentNorm);
                            if (nonRootParents.length === 0) {
                                failed++;
                                errors.push(`Row ${i + 2} (${r.name}): category_parent "${r.category_parent}" not found — import categories first`);
                                continue;
                            }
                            const nonRootParentIds = new Set(nonRootParents.map((p) => p.id));
                            const legacyPairMatches = catRows.filter((c) => c.parent_id !== null &&
                                nonRootParentIds.has(c.parent_id) &&
                                c.name.trim().toLowerCase() === catNorm);
                            if (legacyPairMatches.length === 0) {
                                failed++;
                                errors.push(`Row ${i + 2} (${r.name}): category_parent "${r.category_parent}" is not a root category`);
                                continue;
                            }
                            if (legacyPairMatches.length > 1) {
                                failed++;
                                errors.push(`Row ${i + 2} (${r.name}): category "${r.category}" under parent "${r.category_parent}" is ambiguous`);
                                continue;
                            }
                            categoryId = legacyPairMatches[0].id;
                        }
                    }
                    else {
                        const rootMatches = hasCategoryParentColumn
                            ? catRows.filter((c) => c.parent_id === null && c.name.trim().toLowerCase() === catNorm)
                            : [];
                        if (rootMatches.length === 1) {
                            categoryId = rootMatches[0].id;
                        }
                        else if (rootMatches.length > 1) {
                            failed++;
                            errors.push(`Row ${i + 2} (${r.name}): category "${r.category}" is ambiguous`);
                            continue;
                        }
                        else {
                            const matches = catRows.filter((c) => c.name.trim().toLowerCase() === catNorm);
                            if (matches.length === 0) {
                                failed++;
                                errors.push(`Row ${i + 2} (${r.name}): category "${r.category}" not found — import categories first`);
                                continue;
                            }
                            if (matches.length > 1) {
                                failed++;
                                errors.push(`Row ${i + 2} (${r.name}): category "${r.category}" is ambiguous — specify category_parent`);
                                continue;
                            }
                            categoryId = matches[0].id;
                        }
                    }
                }
                if (categoryId !== null) {
                    const retainedCategoryId = existingProduct?.category_id
                        ? existingProduct.category_id.trim() || null
                        : null;
                    if (categoryId !== retainedCategoryId && !isCategoryChainActive(categoryId)) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): category "${r.category}" is inactive or has an inactive parent`);
                        continue;
                    }
                }
                let tagsJson = null;
                if (r.tags) {
                    const arr = r.tags
                        .split(',')
                        // quote-v1 round-trips stored tags verbatim; trimming would strip
                        // the restored formula-safety whitespace and break reversibility.
                        .map((t) => (encoding.mode === 'quote-v1' ? t : t.trim()))
                        .filter(Boolean);
                    if (arr.length)
                        tagsJson = JSON.stringify(arr);
                }
                const isActive = !r.is_active || isTruthy(r.is_active) ? 1 : 0;
                let cbPercent = null;
                if (r.cashback_percent !== undefined &&
                    r.cashback_percent !== null &&
                    r.cashback_percent.trim() !== '') {
                    const cashbackResult = parseNumericField(r.cashback_percent, 'cashback_percent', {
                        min: 0,
                        max: 100,
                    });
                    if (!cashbackResult.ok) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): ${cashbackResult.error}`);
                        continue;
                    }
                    cbPercent = cashbackResult.value;
                }
                const sku = r.sku || null;
                let taxCategoryId = null;
                if (r.tax_category) {
                    if (!taxCategoriesConfigured) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): the active country pack (${activePack.id}) has no configured tax rules for business type ${businessType}`);
                        continue;
                    }
                    if (!taxCategoryIds.has(r.tax_category)) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): tax_category "${r.tax_category}" is not defined in the active country pack (${activePack.id})`);
                        continue;
                    }
                    taxCategoryId = r.tax_category;
                }
                let taxBehavior = hasTaxBehaviorColumn ? 'country_default' : null;
                if (r.tax_behavior) {
                    if (!VALID_TAX_BEHAVIORS.includes(r.tax_behavior)) {
                        failed++;
                        errors.push(`Row ${i + 2} (${r.name}): tax_behavior "${r.tax_behavior}" must be one of: ${VALID_TAX_BEHAVIORS.join(', ')}`);
                        continue;
                    }
                    taxBehavior = r.tax_behavior;
                }
                // If an id is provided and matches an existing product, update it.
                if (existingProduct) {
                    db.prepare(`UPDATE products SET name=?, category_id=?, price=?, description=?, cost=?,
           tax_type=?, tax_rate=?,
           tax_category_id=CASE WHEN ? = 1 THEN ? ELSE tax_category_id END,
           tax_behavior=CASE WHEN ? = 1 THEN ? ELSE tax_behavior END,
           cb_percent=?, tags=?, is_active=?, sku=?, updated_at=?
           WHERE id=?`).run(r.name, categoryId, price, r.description || null, cost, 'none', 0, hasTaxCategoryColumn ? 1 : 0, taxCategoryId, hasTaxBehaviorColumn ? 1 : 0, taxBehavior, cbPercent, tagsJson, isActive, sku, (0, db_1.now)(), existingProduct.id);
                    if (existingProduct.is_active === 0 && isActive === 1)
                        reactivated++;
                    else
                        updated++;
                    changedRows++;
                    continue;
                }
                // No id or unrecognized id — insert as new, skip if name+category duplicate.
                const exists = db
                    .prepare('SELECT id FROM products WHERE name = ? AND category_id IS ? AND deleted_at IS NULL')
                    .get(r.name, categoryId);
                if (exists) {
                    skipped++;
                    continue;
                }
                db.prepare(`INSERT INTO products (id, name, category_id, price, description, cost, tax_type, tax_rate,
         tax_category_id, tax_behavior, cb_percent, tags, is_active, sku, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run((0, db_1.generateShortId)('products'), r.name, categoryId, price, r.description || null, cost, 'none', 0, taxCategoryId, taxBehavior || 'country_default', cbPercent, tagsJson, isActive, sku, (0, db_1.now)(), (0, db_1.now)());
                created++;
                changedRows++;
            }
        })();
        captureMenuCsvRowRejections(failed, changedRows);
        res.json({ created, updated, reactivated, skipped, failed, errors });
    }
    catch (err) {
        return csvImportErrorResponse(res, err);
    }
});
router.post('/import/addons', (0, authorization_1.requirePermission)('catalog.import-export'), (req, res) => {
    try {
        const { csv } = req.body;
        if (typeof csv !== 'string' || !csv) {
            captureInvalidMenuCsvInput();
            return res.status(400).json({ error: 'No CSV data provided' });
        }
        const parsedCsv = parseCSV(csv);
        const headers = new Set((parsedCsv[0] || []).map((header) => header.trim().toLowerCase()));
        const hasGroupRequiredColumn = headers.has('group_required');
        const hasGroupMinColumn = headers.has('group_min_select');
        const hasGroupMaxColumn = headers.has('group_max_select');
        const hasTrackInventoryColumn = headers.has('track_inventory');
        const hasStockQuantityColumn = headers.has('stock_quantity');
        const hasLowStockThresholdColumn = headers.has('low_stock_threshold');
        const rawRows = toObjects(parsedCsv);
        if (!rawRows.length) {
            captureInvalidMenuCsvInput();
            return res.status(400).json({ error: 'CSV has no data rows' });
        }
        const db = (0, db_1.getDatabase)();
        const regionalSnapshot = currentRegionalSnapshot();
        const actorUserId = String(req.user?.userId || '');
        let groupsCreated = 0, groupsUpdated = 0, addonsCreated = 0;
        let groupsReactivated = 0, addonsReactivated = 0, addonsUpdated = 0;
        let skipped = 0, failed = 0, changedRows = 0;
        const errors = [];
        const groupCache = {};
        const findExistingAddon = db.prepare(`SELECT a.id, a.name AS addon_name, a.addon_group_id, g.name AS group_name
         FROM addons a
         JOIN addon_groups g ON g.id = a.addon_group_id
         WHERE a.id = ?`);
        const findExistingGroupById = db.prepare('SELECT id, name FROM addon_groups WHERE id = ?');
        const preparedRows = rawRows.map((rawRow) => {
            const encoding = resolveCsvRowEncoding(rawRow);
            if (!encoding.ok) {
                return { encodingError: encoding.error, row: rawRow };
            }
            if (encoding.mode === 'quote-v1') {
                return {
                    encodingError: null,
                    row: {
                        ...rawRow,
                        group_name: (0, csv_1.decodeQuoteV1Field)(rawRow.group_name ?? ''),
                        addon_name: (0, csv_1.decodeQuoteV1Field)(rawRow.addon_name ?? ''),
                    },
                };
            }
            let groupName = rawRow.group_name ?? '';
            let addonName = rawRow.addon_name ?? '';
            const addonId = rawRow.id || rawRow.addon_id || '';
            const groupId = rawRow.group_id || rawRow.addon_group_id || '';
            if (addonId) {
                const existingAddon = findExistingAddon.get(addonId);
                if (existingAddon) {
                    groupName = (0, csv_1.decodeLegacyProvenField)(groupName, existingAddon.group_name);
                    addonName = (0, csv_1.decodeLegacyProvenField)(addonName, existingAddon.addon_name);
                }
            }
            if (groupId) {
                const existingGroup = findExistingGroupById.get(groupId);
                if (existingGroup) {
                    groupName = (0, csv_1.decodeLegacyProvenField)(groupName, existingGroup.name);
                }
            }
            return {
                encodingError: null,
                row: {
                    ...rawRow,
                    group_name: groupName,
                    addon_name: addonName,
                },
            };
        });
        const groupPlans = new Map();
        for (const { encodingError, row } of preparedRows) {
            if (encodingError)
                continue;
            if (!row.group_name?.trim() || !row.addon_name?.trim())
                continue;
            const priceResult = parseNumericField(row.price, 'price', {
                min: 0,
                localized: regionalSnapshot,
            });
            const minResult = parseNumericField(row.group_min_select, 'group_min_select', {
                optional: true,
                defaultValue: 0,
                integer: true,
                min: 0,
            });
            const maxResult = parseNumericField(row.group_max_select, 'group_max_select', {
                optional: true,
                defaultValue: 1,
                integer: true,
                min: 0,
            });
            const stockResult = parseNumericField(row.stock_quantity, 'stock_quantity', {
                optional: true,
                defaultValue: 0,
                min: 0,
            });
            const thresholdResult = parseNumericField(row.low_stock_threshold, 'low_stock_threshold', {
                optional: true,
                defaultValue: 0,
                min: 0,
            });
            if (!priceResult.ok ||
                !minResult.ok ||
                !maxResult.ok ||
                !stockResult.ok ||
                !thresholdResult.ok)
                continue;
            const key = row.group_name.toLowerCase();
            let plan = groupPlans.get(key);
            if (!plan) {
                const existing = db
                    .prepare('SELECT id, is_active, is_required, min_selection, max_selection FROM addon_groups WHERE name = ?')
                    .get(row.group_name);
                const activeAddons = existing
                    ? db
                        .prepare('SELECT name FROM addons WHERE addon_group_id = ? AND is_active = 1')
                        .all(existing.id)
                    : [];
                const minSelection = hasGroupMinColumn ? minResult.value : (existing?.min_selection ?? 0);
                const maxSelection = hasGroupMaxColumn ? maxResult.value : (existing?.max_selection ?? 1);
                if (minSelection > maxSelection)
                    continue;
                plan = {
                    existing,
                    activeAddonNames: new Set(activeAddons.map((addon) => addon.name)),
                    activeAddonCount: activeAddons.length,
                    importedAddonNames: new Set(),
                    minSelection,
                    maxSelection,
                    boundsError: null,
                };
                groupPlans.set(key, plan);
            }
            const rowMinSelection = hasGroupMinColumn
                ? minResult.value
                : (plan.existing?.min_selection ?? 0);
            const rowMaxSelection = hasGroupMaxColumn
                ? maxResult.value
                : (plan.existing?.max_selection ?? 1);
            if (rowMinSelection > rowMaxSelection)
                continue;
            plan.importedAddonNames.add(row.addon_name);
        }
        for (const plan of groupPlans.values()) {
            const finalActiveAddonCount = plan.activeAddonCount +
                [...plan.importedAddonNames].filter((name) => !plan.activeAddonNames.has(name)).length;
            if (plan.minSelection > plan.maxSelection) {
                plan.boundsError = 'group_min_select must not exceed group_max_select';
            }
            else if (plan.minSelection > finalActiveAddonCount) {
                plan.boundsError = `group_min_select cannot exceed the final number of active add-ons (${finalActiveAddonCount})`;
            }
        }
        db.transaction(() => {
            for (let i = 0; i < preparedRows.length; i++) {
                const { encodingError, row: r } = preparedRows[i];
                if (encodingError) {
                    failed++;
                    errors.push(`Row ${i + 2}: ${encodingError}`);
                    continue;
                }
                let rowChanged = false;
                if (!r.group_name?.trim() || !r.addon_name?.trim()) {
                    failed++;
                    errors.push(`Row ${i + 2}: missing group_name or addon_name`);
                    continue;
                }
                const priceResult = parseNumericField(r.price, 'price', {
                    min: 0,
                    localized: regionalSnapshot,
                });
                if (!priceResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${priceResult.error}`);
                    continue;
                }
                const price = priceResult.value;
                const minResult = parseNumericField(r.group_min_select, 'group_min_select', {
                    optional: true,
                    defaultValue: 0,
                    integer: true,
                    min: 0,
                });
                if (!minResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${minResult.error}`);
                    continue;
                }
                const maxResult = parseNumericField(r.group_max_select, 'group_max_select', {
                    optional: true,
                    defaultValue: 1,
                    integer: true,
                    min: 0,
                });
                if (!maxResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${maxResult.error}`);
                    continue;
                }
                const stockResult = parseNumericField(r.stock_quantity, 'stock_quantity', {
                    optional: true,
                    defaultValue: 0,
                    min: 0,
                });
                if (!stockResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${stockResult.error}`);
                    continue;
                }
                const stockQuantity = stockResult.value;
                const thresholdResult = parseNumericField(r.low_stock_threshold, 'low_stock_threshold', {
                    optional: true,
                    defaultValue: 0,
                    min: 0,
                });
                if (!thresholdResult.ok) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${thresholdResult.error}`);
                    continue;
                }
                const lowStockThreshold = thresholdResult.value;
                const trackInventory = isTruthy(r.track_inventory) ? 1 : 0;
                const key = r.group_name.toLowerCase();
                const groupPlan = groupPlans.get(key);
                const effectiveMinSelection = hasGroupMinColumn
                    ? minResult.value
                    : (groupPlan?.existing?.min_selection ?? 0);
                const effectiveMaxSelection = hasGroupMaxColumn
                    ? maxResult.value
                    : (groupPlan?.existing?.max_selection ?? 1);
                if (effectiveMinSelection > effectiveMaxSelection) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): group_min_select must not exceed group_max_select`);
                    continue;
                }
                if (groupPlan?.boundsError) {
                    failed++;
                    errors.push(`Row ${i + 2} (${r.group_name}/${r.addon_name}): ${groupPlan.boundsError}`);
                    continue;
                }
                let groupId = groupCache[key];
                if (!groupId) {
                    const existing = db
                        .prepare('SELECT id, is_active, is_required, min_selection, max_selection FROM addon_groups WHERE name = ?')
                        .get(r.group_name);
                    if (existing) {
                        groupId = existing.id;
                        const isRequired = hasGroupRequiredColumn
                            ? isTruthy(r.group_required)
                                ? 1
                                : 0
                            : existing.is_required;
                        const minSelection = hasGroupMinColumn ? minResult.value : existing.min_selection;
                        const maxSelection = hasGroupMaxColumn ? maxResult.value : existing.max_selection;
                        const settingsChanged = existing.is_required !== isRequired ||
                            existing.min_selection !== minSelection ||
                            existing.max_selection !== maxSelection;
                        if (existing.is_active === 0) {
                            db.prepare(`UPDATE addon_groups SET is_required = ?, min_selection = ?, max_selection = ?, is_active = 1, updated_at = ? WHERE id = ?`).run(isRequired, minSelection, maxSelection, (0, db_1.now)(), groupId);
                            groupsReactivated++;
                            rowChanged = true;
                        }
                        else if (settingsChanged) {
                            db.prepare(`UPDATE addon_groups SET is_required = ?, min_selection = ?, max_selection = ?, updated_at = ? WHERE id = ?`).run(isRequired, minSelection, maxSelection, (0, db_1.now)(), groupId);
                            groupsUpdated++;
                            rowChanged = true;
                        }
                    }
                    else {
                        groupId = (0, node_crypto_1.randomUUID)();
                        db.prepare(`INSERT INTO addon_groups (id, name, is_required, min_selection, max_selection, is_active, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`).run(groupId, r.group_name, hasGroupRequiredColumn && isTruthy(r.group_required) ? 1 : 0, hasGroupMinColumn ? minResult.value : 0, hasGroupMaxColumn ? maxResult.value : 1, (0, db_1.now)(), (0, db_1.now)());
                        groupsCreated++;
                        rowChanged = true;
                    }
                    groupCache[key] = groupId;
                }
                const addonExists = db
                    .prepare('SELECT id, is_active, price, track_inventory, low_stock_threshold FROM addons WHERE addon_group_id = ? AND name = ?')
                    .get(groupId, r.addon_name);
                if (addonExists) {
                    if (addonExists.is_active === 0) {
                        // A pre-inventory spreadsheet carries neither inventory column, so
                        // tracking is only touched when the merchant's file actually states it.
                        db.prepare(`UPDATE addons SET is_active = 1, price = ?,
             track_inventory = CASE WHEN ? = 1 THEN ? ELSE track_inventory END,
             low_stock_threshold = CASE WHEN ? = 1 THEN ? ELSE low_stock_threshold END,
             updated_at = ? WHERE id = ?`).run(price, hasTrackInventoryColumn ? 1 : 0, trackInventory, hasLowStockThresholdColumn ? 1 : 0, lowStockThreshold, (0, db_1.now)(), addonExists.id);
                        addonsReactivated++;
                        rowChanged = true;
                        if (hasStockQuantityColumn) {
                            applyImportedAddonStock(db, addonExists.id, stockQuantity, 'manual_adjustment', addonExists.id, actorUserId);
                        }
                    }
                    else {
                        const nextTrackInventory = hasTrackInventoryColumn
                            ? trackInventory
                            : addonExists.track_inventory;
                        const nextThreshold = hasLowStockThresholdColumn
                            ? lowStockThreshold
                            : Number(addonExists.low_stock_threshold ?? 0);
                        const detailsChanged = Number(addonExists.price) !== price ||
                            addonExists.track_inventory !== nextTrackInventory ||
                            Number(addonExists.low_stock_threshold ?? 0) !== nextThreshold;
                        if (detailsChanged) {
                            db.prepare(`UPDATE addons SET price = ?, track_inventory = ?, low_stock_threshold = ?, updated_at = ? WHERE id = ?`).run(price, nextTrackInventory, nextThreshold, (0, db_1.now)(), addonExists.id);
                        }
                        const stockBefore = hasStockQuantityColumn
                            ? Number(db
                                .prepare('SELECT stock_quantity FROM addons WHERE id = ?')
                                .get(addonExists.id).stock_quantity ?? 0)
                            : 0;
                        const stockChanged = hasStockQuantityColumn && stockBefore !== stockQuantity;
                        if (stockChanged) {
                            applyImportedAddonStock(db, addonExists.id, stockQuantity, 'manual_adjustment', addonExists.id, actorUserId);
                        }
                        if (detailsChanged || stockChanged) {
                            addonsUpdated++;
                            rowChanged = true;
                        }
                        else {
                            skipped++;
                        }
                    }
                    if (rowChanged)
                        changedRows++;
                    continue;
                }
                const addonId = (0, node_crypto_1.randomUUID)();
                db.prepare(`INSERT INTO addons (id, addon_group_id, name, price, is_active, sort_order, track_inventory, stock_quantity, low_stock_threshold, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, 0, ?, ?, ?)`).run(addonId, groupId, r.addon_name, price, trackInventory, lowStockThreshold, (0, db_1.now)(), (0, db_1.now)());
                if (stockQuantity !== 0) {
                    applyImportedAddonStock(db, addonId, stockQuantity, 'opening_balance', addonId, actorUserId);
                }
                addonsCreated++;
                changedRows++;
            }
        })();
        captureMenuCsvRowRejections(failed, changedRows);
        const created = groupsCreated + addonsCreated;
        const reactivated = groupsReactivated + addonsReactivated;
        res.json({
            created,
            updated: groupsUpdated + addonsUpdated,
            reactivated,
            skipped,
            failed,
            groups_created: groupsCreated,
            groups_updated: groupsUpdated,
            addons_created: addonsCreated,
            addons_updated: addonsUpdated,
            groups_reactivated: groupsReactivated,
            addons_reactivated: addonsReactivated,
            errors,
        });
    }
    catch (err) {
        return csvImportErrorResponse(res, err);
    }
});
//# sourceMappingURL=menu-csv.js.map