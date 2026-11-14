"use strict";
/** PrintDocument v1 classic thermal receipt renderer; maps print blocks to ESC/POS token lines. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPrintLanguageDirection = detectPrintLanguageDirection;
exports.buildBillPrintData = buildBillPrintData;
exports.buildBillPrintContext = buildBillPrintContext;
exports.renderBillDocumentToClassicLines = renderBillDocumentToClassicLines;
exports.renderClassicReceiptViaDocument = renderClassicReceiptViaDocument;
const db_1 = require("../db");
const countries_1 = require("../countries");
const tax_components_1 = require("../services/tax-components");
const print_labels_generated_1 = require("../print/print-labels.generated");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const raster_1 = require("../../shared/print/raster");
const image_raster_1 = require("../../shared/print/image-raster");
const width_1 = require("../../shared/print/width");
const formatting_helpers_1 = require("./formatting-helpers");
const print_1 = require("../../shared/print");
const charges_1 = require("../../shared/charges");
const order_item_status_1 = require("../../shared/order-item-status");
// Direction facts (registry-derived, no language unions).
/** Concepts whose generated strings are stable enough to reveal script. */
const DIRECTION_PROBE_CONCEPTS = [
    'print.thankYouShort',
    'receipt.reprint',
    'pos.subtotal',
    'receipt.item',
    'print.grandTotal',
];
/** Derive a language's base direction from its generated label strings. */
function detectPrintLanguageDirection(lang) {
    if (!(0, print_labels_generated_1.isGeneratedPrintLanguage)(lang))
        return 'ltr';
    const sample = DIRECTION_PROBE_CONCEPTS.map((conceptId) => (0, print_labels_generated_1.printLabel)(lang, conceptId)).join(' ');
    return (0, print_1.containsRtlScript)(sample) ? 'rtl' : 'ltr';
}
// PrintData / PrintContext normalization (caller-side, main-process layer).
function parsePaymentDetails(raw) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(value))
        return [];
    return value
        .filter((entry) => Boolean(entry) && typeof entry === 'object')
        .map((entry) => {
        const tendered = (0, print_1.optionalPaymentAmount)(entry.tendered_amount);
        const change = (0, print_1.optionalPaymentAmount)(entry.change_amount);
        return {
            method: String(entry.method ?? ''),
            amount: Number(entry.amount) || 0,
            ...(tendered !== undefined ? { tendered } : {}),
            ...(change !== undefined ? { change } : {}),
        };
    });
}
/** Normalize raw bill/order/business rows into authoritative PrintData. */
function buildBillPrintData(order, bill, business, isReprint) {
    const items = (Array.isArray(order?.items) ? order.items : []).filter((item) => !(0, order_item_status_1.isExcludedFromBillReceipt)(item?.status));
    return {
        isReprint,
        order: {
            orderNumber: String(order?.order_number ?? ''),
            createdAt: String(order?.created_at || bill?.created_at || ''),
            tableName: String(order?.table?.name ?? ''),
            onlinePlatform: String(order?.online_platform ?? ''),
            externalOrderId: String(order?.external_order_id ?? ''),
            deliveryAddress: String(order?.delivery_address ?? ''),
            items: items.map((item) => ({
                productName: (0, formatting_helpers_1.formatVariantItemHeading)(String(item?.product_name ?? ''), (0, formatting_helpers_1.parseVariantSelection)(item?.variant_selection)),
                quantity: Number(item?.quantity) || 0,
                unitPrice: Number(item?.unit_price ?? item?.price ?? 0) || 0,
                total: Number(item?.total) || 0,
                addons: (Array.isArray(item?.addons) ? item.addons : []).map((addon) => {
                    const addonQuantity = (addon !== null &&
                        typeof addon === 'object' &&
                        'quantity' in addon &&
                        typeof addon.quantity === 'number' &&
                        addon.quantity) ||
                        1;
                    return {
                        name: String(addon?.name ?? ''),
                        price: (Number(addon?.price) || 0) * addonQuantity * (Number(item?.quantity) || 0),
                        quantity: addonQuantity,
                    };
                }),
                specialInstructions: [item?.special_instructions, item?.serving_summary]
                    .filter((value) => typeof value === 'string' && value.trim())
                    .join(' · '),
            })),
        },
        bill: {
            billNumber: String(bill?.bill_number ?? ''),
            subtotal: Number(bill?.subtotal) || 0,
            discountAmount: Number(bill?.discount_amount) || 0,
            taxAmount: Number(bill?.tax_amount) || 0,
            total: Number(bill?.total) || 0,
            ...(Object.prototype.hasOwnProperty.call(bill || {}, 'service_charge')
                ? { serviceCharge: Number(bill?.service_charge) || 0 }
                : {}),
            deliveryCharge: Number(bill?.delivery_charge) || 0,
            packagingCharge: Number(bill?.packaging_charge) || 0,
            chargesBreakdown: bill?.charges_breakdown ?? null,
            taxComponents: (0, tax_components_1.resolveTaxComponents)({ ...bill, items }),
            payments: parsePaymentDetails(bill?.payment_details),
            pointsEarned: Number(business?.points_earned) || 0,
            pointsRedeemed: Number(business?.points_redeemed) || 0,
            pointsBalance: business?.points_balance === null || business?.points_balance === undefined
                ? null
                : Number(business.points_balance) || 0,
        },
        business: {
            name: String(business?.name ?? ''),
            address: String(business?.address ?? ''),
            phone: String(business?.phone ?? ''),
            taxRegistrationNumber: String(business?.taxRegistrationNumber ?? ''),
            taxIdLabel: (0, countries_1.getCountryByCode)(String(business?.country ?? ''))?.taxIdLabel || '',
            instagramHandle: String(business?.instagram_handle ?? ''),
            footerNote: String(business?.footer_note ?? ''),
            customerName: String(business?.customer_name ?? ''),
            customerPhone: String(business?.customer_phone ?? ''),
            showName: business?.show_name !== false,
            showAddress: business?.show_address !== false,
            showPhone: business?.show_phone !== false,
            showTaxId: business?.show_tax_id === true
                ? 'force'
                : business?.show_tax_id === false
                    ? 'never'
                    : 'auto',
            showTaxBreakdown: business?.show_tax_breakdown === true,
            showTableNumber: business?.show_table_number !== false,
            showCustomerName: business?.show_customer_name !== false,
            showCustomerPhone: business?.show_customer_phone !== false,
            showLogo: business?.show_logo === true,
            receiptLogo: typeof business?.receipt_logo === 'string' ? business.receipt_logo : '',
            receiptLogoRaster: typeof business?.receipt_logo_raster === 'string' ? business.receipt_logo_raster : '',
        },
    };
}
/** Build PrintContext for classic receipt: paper columns, languages, locale prefs. */
function buildBillPrintContext(opts) {
    const lang = (0, formatting_helpers_1.normalizePrintLanguage)(opts.language);
    const languages = opts.additionalLanguage !== undefined && opts.additionalLanguage !== lang
        ? [lang, (0, formatting_helpers_1.normalizePrintLanguage)(opts.additionalLanguage)]
        : [lang];
    const country = (0, countries_1.getCountryByCode)(String(opts.business?.country ?? ''));
    const currency = (0, countries_1.resolveTenantCurrency)(opts.business?.currency, opts.business?.country);
    const locale = country?.locale ?? 'en-US';
    return {
        columns: opts.columns,
        languages,
        baseDirection: detectPrintLanguageDirection(lang),
        locale,
        currency,
        // CLDR-derived only — a stored currency_symbol setting is not an input
        // (docs/reference/product-invariants.md: no per-store override of a snapshot value).
        currencySymbol: String((0, countries_1.getCurrencySymbol)(currency, locale) || currency),
        trimDecimals: opts.business?.trim_decimals === true,
        ...(opts.business?.timezone ? { timezone: String(opts.business.timezone) } : {}),
        resolveLabel: (conceptId, language) => (0, print_labels_generated_1.printLabel)(language, conceptId),
    };
}
function labelOf(label) {
    return label.primary;
}
/** Literal payment methods keep the legacy capitalize fallback. */
function paymentLabel(label) {
    return label.conceptId !== undefined ? label.primary : capitalize(label.primary);
}
function capitalize(text) {
    return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
function classicBannerLines(label, context) {
    const layout = (0, print_1.layoutStyledUnit)({
        label: {
            primary: `** ${label.primary} **`,
            ...(label.secondary ? { secondary: `** ${label.secondary} **` } : {}),
        },
        widthMultiplier: 2,
        field: 'reprint banner',
    }, context);
    const widthToken = layout.widthMultiplier === 2 ? '{DOUBLE_WIDTH}' : '';
    const closeWidthToken = layout.widthMultiplier === 2 ? '{/DOUBLE_WIDTH}' : '';
    return layout.lines.map((line) => `{CENTER}{BOLD}{DOUBLE_HEIGHT}${widthToken}${(0, formatting_helpers_1.normalizeThermalText)(line, context.capabilities)}${closeWidthToken}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}`);
}
/** Column header row, composed from the document's own header labels. */
function classicItemHeader(block, nameLen, amtLen, language, capabilities) {
    const qtyW = 4;
    const itemLabel = (0, formatting_helpers_1.normalizeThermalText)(labelOf(block.header.item), capabilities);
    const qtyLabel = (0, formatting_helpers_1.normalizeThermalText)(labelOf(block.header.quantity), capabilities);
    const amountLabel = (0, formatting_helpers_1.normalizeThermalText)(labelOf(block.header.amount), capabilities);
    const fit = (value, length) => capabilities?.raster.enabled === true && !(0, thermal_capabilities_1.isThermalTextRepresentable)(value, capabilities)
        ? value
        : (0, width_1.truncateToDisplayCells)(value, length);
    const item = (0, width_1.padToDisplayCells)(fit(itemLabel, nameLen), nameLen);
    const qty = (0, width_1.padToDisplayCells)(fit(qtyLabel, qtyW), qtyW);
    const amount = fit(amountLabel, Math.max(1, amtLen - 1));
    return item + qty + ' '.repeat(Math.max(0, amtLen - (0, width_1.displayCellWidth)(amount))) + amount;
}
/** Map a PrintDocument onto classic token-line layout. */
function renderBillDocumentToClassicLines(document, options) {
    const cols = options.columns;
    const lines = [];
    const blocks = document.blocks;
    const breakdownIndex = blocks.findIndex((block) => block.kind === 'tax-breakdown');
    const totalsIndex = blocks.findIndex((block) => block.kind === 'totals');
    const prefix = (0, formatting_helpers_1.resolveCurrencyPrefix)(options.currencySymbol, options.useUnicode, options.capabilities, options.preserveCurrencySymbol === true, options.currency);
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(options.currency);
    const trimDecimals = options.trimDecimals === true;
    const tzOptions = options.timezone ? { timeZone: options.timezone } : undefined;
    const dash = '-'.repeat(cols);
    const normalize = (text) => (0, formatting_helpers_1.normalizeThermalText)(text, options.capabilities);
    lines.push('{INIT}');
    const segments = new Map();
    const segmentOf = (kind) => {
        let segment = segments.get(kind);
        if (!segment) {
            segment = {
                pre: [],
                main: [],
                post: [],
                sourceLines: { pre: [], main: [], post: [] },
                sourceControlLines: { pre: [], main: [], post: [] },
                sourceLayouts: { pre: [], main: [], post: [] },
                groups: [],
                financialRanges: { pre: [], main: [], post: [] },
            };
            segments.set(kind, segment);
        }
        return segment;
    };
    const appendFinancial = (target, rendered, bold = false, sourceLabel, sourceValue) => {
        const tokenLines = bold ? rendered.map((line) => `{BOLD}${line}{/BOLD}`) : rendered;
        const start = target.main.length;
        target.main.push(...tokenLines);
        target.financialRanges.main.push({ start, count: tokenLines.length });
        target.sourceLines.main.push(sourceLabel !== undefined && sourceValue !== undefined
            ? `${sourceLabel} ${sourceValue.trimStart()}`
            : rendered.join(' '));
        target.sourceControlLines.main.push(tokenLines[0] ?? '');
        target.sourceLayouts.main.push(sourceLabel !== undefined && sourceValue !== undefined
            ? {
                kind: 'financial-summary',
                columns: [
                    { text: sourceLabel, align: 'left', widthRatio: Math.max(0.1, (cols - 12) / cols) },
                    {
                        text: sourceValue.trimStart(),
                        align: 'right',
                        widthRatio: Math.min(0.9, 12 / cols),
                    },
                ],
            }
            : undefined);
    };
    const renderGrandTotal = (block, target = segmentOf('totals')) => {
        const label = labelOf(block.grandTotal.label);
        const value = (0, formatting_helpers_1.formatCurrency)(block.grandTotal.amount, prefix, options.locale, trimDecimals, fractionDigits);
        appendFinancial(target, (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities), true, label, value);
    };
    const renderCharges = (block, target) => {
        // An engine breakdown is the itemised source of truth; the standard rows it
        // covers are skipped so the fee is never printed twice.
        const itemisedCharges = (0, charges_1.receiptChargeLines)(block.chargesBreakdown);
        const itemisedIds = new Set(itemisedCharges.map((charge) => charge.id));
        if (block.serviceCharge && !itemisedIds.has('service_charge')) {
            const label = labelOf(block.serviceCharge.label);
            const value = (0, formatting_helpers_1.formatCurrency)(block.serviceCharge.amount, prefix, options.locale, trimDecimals, fractionDigits);
            appendFinancial(target, (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities), false, label, value);
        }
        if (block.deliveryCharge) {
            const label = labelOf(block.deliveryCharge.label);
            const value = (0, formatting_helpers_1.formatCurrency)(block.deliveryCharge.amount, prefix, options.locale, trimDecimals, fractionDigits);
            appendFinancial(target, (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities), false, label, value);
        }
        if (block.packagingCharge && !itemisedIds.has('packaging_charge')) {
            const label = labelOf(block.packagingCharge.label);
            const value = (0, formatting_helpers_1.formatCurrency)(block.packagingCharge.amount, prefix, options.locale, trimDecimals, fractionDigits);
            appendFinancial(target, (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities), false, label, value);
        }
        for (const charge of itemisedCharges) {
            const value = (0, formatting_helpers_1.formatCurrency)(charge.amount, prefix, options.locale, trimDecimals, fractionDigits);
            appendFinancial(target, (0, formatting_helpers_1.financialRows)(charge.name, value, cols, options.language, options.capabilities), false, charge.name, value);
        }
    };
    for (const block of blocks) {
        switch (block.kind) {
            case 'business-header': {
                const segment = segmentOf('business-header');
                if (block.logoRaster) {
                    const widthDots = options.capabilities?.raster?.widthDots ?? (cols <= 32 ? 384 : 576);
                    const maxBandHeight = options.capabilities?.raster?.maxBandHeight ?? 200;
                    const bands = (0, image_raster_1.getLogoRasterBands)(block.logoRaster, widthDots, maxBandHeight);
                    if (bands.length > 0) {
                        const rawBytes = (0, raster_1.concatBytes)(bands.map((band) => (0, raster_1.encodeGsV0Band)(band, maxBandHeight)));
                        segment.main.push(`{RAW_BYTES:${Buffer.from(rawBytes).toString('base64')}}`);
                        segment.sourceLines.main.push('[Logo]');
                        segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                    }
                }
                if (block.name) {
                    segment.main.push('{STORE_NAME}{CENTER}{BOLD}{DOUBLE_HEIGHT}{DOUBLE_WIDTH}' +
                        (0, formatting_helpers_1.truncateShapedLine)(block.name.text, Math.floor(cols / 2), options.arabicShaping, options.language, options.capabilities) +
                        '{/DOUBLE_WIDTH}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}');
                    segment.sourceLines.main.push(block.name.text);
                    segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                }
                // Contact/tax facts are header-owned content; they travel with
                // the header block's position in reordered compositions.
                const footerLines = [];
                const footerSourceLines = [];
                if (block.address) {
                    footerLines.push(block.address.text);
                    footerSourceLines.push(block.address.text);
                }
                if (block.phone && block.phoneLabel) {
                    footerLines.push(normalize(labelOf(block.phoneLabel) + ': ' + block.phone.text));
                    footerSourceLines.push(labelOf(block.phoneLabel) + ': ' + block.phone.text);
                }
                if (block.taxId) {
                    footerLines.push(normalize(labelOf(block.taxId.label) + ': ' + block.taxId.value.text));
                    footerSourceLines.push(labelOf(block.taxId.label) + ': ' + block.taxId.value.text);
                }
                if (block.instagramHandle) {
                    footerLines.push(block.instagramHandle.text);
                    footerSourceLines.push(block.instagramHandle.text);
                }
                if (footerLines.length > 0) {
                    segment.post.push(dash);
                    const footerControlLines = [dash];
                    for (const footerLine of footerLines) {
                        const start = segment.post.length;
                        (0, formatting_helpers_1.pushCenteredWrapped)(segment.post, footerLine, cols, options.language, options.capabilities);
                        footerControlLines.push(segment.post[start] ?? '');
                    }
                    segment.sourceLines.post.push(dash, ...footerSourceLines);
                    segment.sourceControlLines.post.push(...footerControlLines);
                }
                break;
            }
            case 'customer': {
                const segment = segmentOf('customer');
                const start = segment.main.length;
                // The heading is what keeps a receipt that also prints the store address
                // from reading as carrying a second business address.
                if (block.heading) {
                    segment.main.push('{CENTER}{BOLD}' +
                        (0, formatting_helpers_1.truncateShapedLine)(labelOf(block.heading), cols, options.arabicShaping, options.language, options.capabilities) +
                        '{/BOLD}{/CENTER}');
                    segment.sourceLines.main.push(labelOf(block.heading));
                    segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                }
                if (block.name) {
                    segment.main.push('{CENTER}{FONT_B}' +
                        (0, formatting_helpers_1.truncateShapedLine)(block.name.text, cols, options.arabicShaping, options.language, options.capabilities) +
                        '{/FONT_B}{/CENTER}');
                    segment.sourceLines.main.push(block.name.text);
                    segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                }
                if (block.phone) {
                    const phone = options.maskCustomerPhone
                        ? (0, formatting_helpers_1.maskPhoneOnReceipt)(block.phone.text)
                        : block.phone.text;
                    segment.main.push('{CENTER}' + phone + '{/CENTER}');
                    segment.sourceLines.main.push(phone);
                    segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                }
                if (block.address) {
                    const labeled = labelOf(block.addressLabel) + ': ' + block.address.text;
                    // Wrapped, not truncated, so a long address stays readable end to end.
                    const addressStart = segment.main.length;
                    (0, formatting_helpers_1.pushWrapped)(segment.main, labeled, cols, options.language, options.capabilities);
                    segment.sourceLines.main.push(labeled);
                    segment.sourceControlLines.main.push(segment.main[addressStart] ?? '');
                }
                if (segment.main.length > start)
                    segment.groups.push({
                        groupId: 'customer',
                        start,
                        count: segment.main.length - start,
                        sourceLines: segment.sourceLines.main.slice(start),
                        sourceControlLines: segment.sourceControlLines.main.slice(start),
                    });
                break;
            }
            case 'document-meta': {
                const segment = segmentOf('document-meta');
                segment.main.push(dash);
                segment.sourceLines.main.push(dash);
                segment.sourceControlLines.main.push(dash);
                const defaultTitle = block.title.conceptId === 'print.taxInvoiceTitle'
                    ? (0, print_labels_generated_1.printLabel)(options.language, 'print.taxInvoiceTitle')
                    : (0, print_labels_generated_1.printLabel)(options.language, 'print.invoiceTitle');
                if (labelOf(block.title) !== defaultTitle) {
                    segment.main.push('{CENTER}' + normalize(labelOf(block.title)) + '{/CENTER}');
                    segment.sourceLines.main.push(labelOf(block.title));
                    segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                }
                segment.main.push('{CENTER}' +
                    normalize(labelOf(block.invoiceNumberLabel) + ' ' + block.invoiceNumber.text) +
                    '{/CENTER}');
                segment.sourceLines.main.push(labelOf(block.invoiceNumberLabel) + ' ' + block.invoiceNumber.text);
                segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                const date = (0, db_1.parseDbTimestamp)(block.timestamp.text);
                segment.main.push('{CENTER}' +
                    date.toLocaleDateString(options.locale + '-u-nu-latn', tzOptions) +
                    ' ' +
                    date.toLocaleTimeString(options.locale + '-u-nu-latn', tzOptions) +
                    '{/CENTER}');
                segment.sourceLines.main.push(date.toLocaleDateString(options.locale + '-u-nu-latn', tzOptions) +
                    ' ' +
                    date.toLocaleTimeString(options.locale + '-u-nu-latn', tzOptions));
                segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                if (block.table) {
                    segment.main.push('{CENTER}' +
                        (0, formatting_helpers_1.truncateShapedLine)(block.table.label.primary.replace('{name}', block.table.name.text), cols, options.arabicShaping, options.language, options.capabilities) +
                        '{/CENTER}');
                    segment.sourceLines.main.push(block.table.label.primary.replace('{name}', block.table.name.text));
                    segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                }
                segment.main.push(dash);
                segment.sourceLines.main.push(dash);
                segment.sourceControlLines.main.push(dash);
                break;
            }
            case 'item-table': {
                const segment = segmentOf('item-table');
                const amtLen = (0, formatting_helpers_1.itemAmountWidth)({
                    items: block.rows.map((row) => ({
                        total: row.amount,
                        addons: row.addons.map((addon) => ({ price: addon.price })),
                    })),
                }, prefix, options.locale, trimDecimals, cols, fractionDigits);
                const nameLen = (0, formatting_helpers_1.itemNameWidth)(cols, amtLen);
                segment.main.push(classicItemHeader(block, nameLen, amtLen, options.language, options.capabilities));
                segment.sourceLines.main.push([
                    labelOf(block.header.item),
                    labelOf(block.header.quantity),
                    labelOf(block.header.amount),
                ].join(' '));
                segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                segment.main.push(dash);
                segment.sourceLines.main.push(dash);
                segment.sourceControlLines.main.push(dash);
                for (const [rowIndex, row] of block.rows.entries()) {
                    const start = segment.main.length;
                    const rowLines = (0, formatting_helpers_1.itemRows)({ product_name: row.name.text, quantity: row.quantity, total: row.amount }, nameLen, amtLen, cols, prefix, options.locale, trimDecimals, options.language, fractionDigits, options.capabilities);
                    segment.financialRanges.main.push({ start, count: rowLines.length });
                    segment.main.push(...rowLines);
                    const amount = (0, formatting_helpers_1.formatCurrency)(row.amount, prefix, options.locale, trimDecimals, fractionDigits);
                    const sourceLines = [`${row.name.text} ${row.quantity} ${amount}`];
                    const sourceControlLines = [rowLines[0] ?? ''];
                    const sourceLayouts = [
                        {
                            kind: 'financial-item',
                            columns: [
                                { text: row.name.text, align: 'left', widthRatio: nameLen / cols },
                                { text: String(row.quantity), align: 'left', widthRatio: 4 / cols },
                                { text: amount.trimStart(), align: 'right', widthRatio: amtLen / cols },
                            ],
                        },
                    ];
                    const financialSourceLines = [true];
                    for (const addon of row.addons) {
                        const addonStart = segment.main.length;
                        const addonLines = (0, formatting_helpers_1.addonRows)({ name: addon.name.text, price: addon.price, quantity: addon.quantity }, nameLen, amtLen, cols, prefix, options.locale, trimDecimals, options.language, fractionDigits, options.capabilities);
                        segment.main.push(...addonLines);
                        if (addon.price) {
                            segment.financialRanges.main.push({ start: addonStart, count: addonLines.length });
                        }
                        const quantitySuffix = (addon.quantity ?? 1) > 1 ? ` x${addon.quantity}` : '';
                        const addonLabel = `  + ${addon.name.text}${quantitySuffix}`;
                        const addonAmount = addon.price
                            ? (0, formatting_helpers_1.formatCurrency)(addon.price, prefix, options.locale, trimDecimals, fractionDigits)
                            : '';
                        sourceLines.push(`${addonLabel}${addon.price ? ` ${addonAmount}` : ''}`);
                        sourceControlLines.push(addonLines[0] ?? '');
                        sourceLayouts.push(addon.price
                            ? {
                                kind: 'financial-summary',
                                columns: [
                                    { text: addonLabel, align: 'left', widthRatio: nameLen / cols },
                                    {
                                        text: addonAmount.trimStart(),
                                        align: 'right',
                                        widthRatio: (cols - nameLen) / cols,
                                    },
                                ],
                            }
                            : undefined);
                        financialSourceLines.push(Boolean(addon.price));
                    }
                    if (row.specialInstructions) {
                        const instructionLine = normalize('  ' +
                            labelOf(block.noteLabel) +
                            ': ' +
                            (0, formatting_helpers_1.truncate)(row.specialInstructions.text, cols - 8, options.language, options.capabilities));
                        segment.main.push(instructionLine);
                        sourceLines.push('  ' + labelOf(block.noteLabel) + ': ' + row.specialInstructions.text);
                        sourceControlLines.push(instructionLine);
                        sourceLayouts.push(undefined);
                        financialSourceLines.push(false);
                    }
                    if (segment.main.length > start) {
                        const group = {
                            groupId: `item-table-row-${rowIndex}`,
                            start,
                            count: segment.main.length - start,
                        };
                        segment.groups.push({
                            ...group,
                            sourceLines,
                            sourceControlLines,
                            sourceLayouts,
                            financialSourceLines,
                            financial: true,
                        });
                    }
                }
                segment.main.push(dash);
                segment.sourceLines.main.push(dash);
                segment.sourceControlLines.main.push(dash);
                break;
            }
            case 'tax-breakdown': {
                const segment = segmentOf('tax-breakdown');
                for (const line of block.lines) {
                    const rateSuffix = line.rate === null ? '' : ` @${line.rate}%`;
                    const rawLabel = labelOf(line.label) + rateSuffix;
                    const value = (0, formatting_helpers_1.formatCurrency)(line.amount, prefix, options.locale, trimDecimals, fractionDigits);
                    appendFinancial(segment, (0, formatting_helpers_1.taxBreakdownRows)(labelOf(line.label), line.rate, value, cols, options.language, options.capabilities), false, rawLabel, value);
                }
                // When breakdown follows totals, grand total closes the breakdown segment.
                if (block.lines.length > 0 && totalsIndex >= 0 && breakdownIndex > totalsIndex) {
                    const totalsBlock = blocks[totalsIndex];
                    renderCharges(totalsBlock, segment);
                    renderGrandTotal(totalsBlock, segment);
                }
                break;
            }
            case 'totals': {
                const segment = segmentOf('totals');
                if (block.pointsRedeemed) {
                    const label = labelOf(block.pointsRedeemed.label);
                    const value = '-' + block.pointsRedeemed.points + ' pts';
                    appendFinancial(segment, (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities), false, label, value);
                }
                {
                    const label = labelOf(block.subtotal.label);
                    const value = (0, formatting_helpers_1.formatCurrency)(block.subtotal.amount, prefix, options.locale, trimDecimals, fractionDigits);
                    appendFinancial(segment, (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities), false, label, value);
                }
                if (block.discount) {
                    const label = labelOf(block.discount.label);
                    const value = '-' +
                        (0, formatting_helpers_1.formatCurrency)(block.discount.amount, prefix, options.locale, trimDecimals, fractionDigits);
                    appendFinancial(segment, (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities), false, label, value);
                }
                const hasBreakdownLines = blocks.some((candidate) => candidate.kind === 'tax-breakdown' && candidate.lines.length > 0);
                if (!hasBreakdownLines && block.tax) {
                    const label = labelOf(block.tax.label);
                    const value = (0, formatting_helpers_1.formatCurrency)(block.tax.amount, prefix, options.locale, trimDecimals, fractionDigits);
                    appendFinancial(segment, (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities), false, label, value);
                }
                if (!hasBreakdownLines || breakdownIndex < totalsIndex) {
                    renderCharges(block, segment);
                }
                if (!hasBreakdownLines) {
                    renderGrandTotal(block);
                }
                else if (breakdownIndex < totalsIndex) {
                    renderGrandTotal(block);
                }
                // Loyalty earned/balance is totals-owned content.
                if (block.pointsEarned || block.pointsBalance) {
                    segment.post.push(dash);
                    segment.sourceLines.post.push(dash);
                    segment.sourceControlLines.post.push(dash);
                    segment.sourceLayouts.post.push(undefined);
                    if (block.pointsEarned) {
                        const label = labelOf(block.pointsEarned.label);
                        const value = String(block.pointsEarned.points);
                        const rendered = (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities);
                        const start = segment.post.length;
                        segment.post.push(...rendered);
                        segment.financialRanges.post.push({ start, count: rendered.length });
                        segment.sourceLines.post.push(`${label} ${value.trimStart()}`);
                        segment.sourceControlLines.post.push(rendered[0] ?? '');
                        segment.sourceLayouts.post.push({
                            kind: 'financial-summary',
                            columns: [
                                { text: label, align: 'left' },
                                { text: value.trimStart(), align: 'right' },
                            ],
                        });
                    }
                    if (block.pointsBalance) {
                        const label = labelOf(block.pointsBalance.label);
                        const value = String(block.pointsBalance.points);
                        const rendered = (0, formatting_helpers_1.financialRows)(label, value, cols, options.language, options.capabilities);
                        const start = segment.post.length;
                        segment.post.push(...rendered);
                        segment.financialRanges.post.push({ start, count: rendered.length });
                        segment.sourceLines.post.push(`${label} ${value.trimStart()}`);
                        segment.sourceControlLines.post.push(rendered[0] ?? '');
                        segment.sourceLayouts.post.push({
                            kind: 'financial-summary',
                            columns: [
                                { text: label, align: 'left', widthRatio: Math.max(0.1, (cols - 12) / cols) },
                                { text: value.trimStart(), align: 'right', widthRatio: Math.min(0.9, 12 / cols) },
                            ],
                        });
                    }
                }
                break;
            }
            case 'payments': {
                const segment = segmentOf('payments');
                const pushPaymentRow = (rawLabel, amount) => {
                    const methodLabel = (0, formatting_helpers_1.truncate)(rawLabel, cols - 12, options.language, options.capabilities);
                    const value = (0, formatting_helpers_1.formatCurrency)(amount, prefix, options.locale, trimDecimals, fractionDigits);
                    const rendered = (0, formatting_helpers_1.financialRows)(methodLabel, value, cols, options.language, options.capabilities);
                    const start = segment.main.length;
                    segment.main.push(...rendered);
                    segment.financialRanges.main.push({ start, count: rendered.length });
                    segment.sourceLines.main.push(`${rawLabel} ${value.trimStart()}`);
                    segment.sourceControlLines.main.push(rendered[0] ?? '');
                    segment.sourceLayouts.main.push({
                        kind: 'financial-summary',
                        columns: [
                            { text: rawLabel, align: 'left', widthRatio: Math.max(0.1, (cols - 12) / cols) },
                            { text: value.trimStart(), align: 'right', widthRatio: Math.min(0.9, 12 / cols) },
                        ],
                    });
                };
                for (const line of block.lines) {
                    for (const row of (0, print_1.paymentDisplayRows)(line)) {
                        pushPaymentRow(paymentLabel(row.label), row.amount);
                    }
                }
                break;
            }
            case 'message': {
                const segment = segmentOf('message');
                if (block.reprintBanner) {
                    const bannerLines = classicBannerLines(block.reprintBanner, {
                        logicalColumns: cols,
                        direction: document.direction.base,
                        languages: document.languages,
                        capabilities: options.capabilities,
                    });
                    segment.pre.push(...bannerLines);
                    segment.sourceLines.pre.push(...bannerLines.map((line) => line.replace(/\{[^}]+\}/g, '')));
                    segment.sourceControlLines.pre.push(...bannerLines);
                }
                if (block.onlineOrderBanner) {
                    const banner = block.onlineOrderBanner;
                    const bannerLines = classicBannerLines(banner.label, {
                        logicalColumns: cols,
                        direction: document.direction.base,
                        languages: document.languages,
                        capabilities: options.capabilities,
                    });
                    segment.pre.push(...bannerLines);
                    segment.sourceLines.pre.push(...bannerLines.map((line) => line.replace(/\{[^}]+\}/g, '')));
                    segment.sourceControlLines.pre.push(...bannerLines);
                    if (banner.platform.text) {
                        segment.pre.push('{CENTER}' + normalize(banner.platform.text) + '{/CENTER}');
                        segment.sourceLines.pre.push(banner.platform.text);
                        segment.sourceControlLines.pre.push(segment.pre.at(-1) ?? '');
                    }
                    if (banner.externalOrderId.text) {
                        segment.pre.push('{CENTER}#' + normalize(banner.externalOrderId.text) + '{/CENTER}');
                        segment.sourceLines.pre.push('#' + banner.externalOrderId.text);
                        segment.sourceControlLines.pre.push(segment.pre.at(-1) ?? '');
                    }
                }
                if (block.thankYou &&
                    labelOf(block.thankYou) !== (0, print_labels_generated_1.printLabel)(options.language, 'print.thankYouShort')) {
                    segment.main.push('{CENTER}' + normalize(labelOf(block.thankYou)) + '{/CENTER}');
                    segment.sourceLines.main.push(labelOf(block.thankYou));
                    segment.sourceControlLines.main.push(segment.main.at(-1) ?? '');
                }
                if (block.footerNote) {
                    const start = segment.post.length;
                    (0, formatting_helpers_1.pushCenteredWrapped)(segment.post, block.footerNote.text, cols, options.language, options.capabilities);
                    segment.sourceLines.post.push(block.footerNote.text);
                    segment.sourceControlLines.post.push(segment.post[start] ?? '');
                }
                break;
            }
        }
    }
    // Assemble canonical blocks in legacy segment arrangement or template order.
    const CANONICAL_LAYOUT = [
        'business-header',
        'customer',
        'document-meta',
        'item-table',
        'totals',
        'tax-breakdown',
        'payments',
        'message',
    ];
    const canonicalRank = new Map(CANONICAL_LAYOUT.map((kind, index) => [kind, index]));
    let lastRank = -1;
    const isCanonicalRelativeOrder = blocks.every((block) => {
        const rank = canonicalRank.get(block.kind);
        if (rank === undefined || rank <= lastRank)
            return false;
        lastRank = rank;
        return true;
    });
    const emit = (kind, part) => {
        const segment = segments.get(kind);
        if (!segment)
            return;
        const start = lines.length;
        lines.push(...segment[part]);
        if (options.financialLineRanges) {
            for (const range of segment.financialRanges[part])
                options.financialLineRanges.push({
                    lineIndex: start + range.start,
                    lineCount: range.count,
                });
        }
        if (options.rasterGroups && segment[part].length > 0) {
            if (part === 'main' && segment.groups.length > 0) {
                for (const group of segment.groups) {
                    options.rasterGroups.push({
                        groupId: group.groupId,
                        lineIndex: start + group.start,
                        lineCount: group.count,
                        ...(group.sourceLines ? { sourceLines: group.sourceLines } : {}),
                        ...(group.sourceControlLines ? { sourceControlLines: group.sourceControlLines } : {}),
                        ...(group.sourceLayouts ? { sourceLayouts: group.sourceLayouts } : {}),
                        ...(group.financialSourceLines
                            ? { financialSourceLines: group.financialSourceLines }
                            : {}),
                        ...(group.financial ? { financial: true } : {}),
                    });
                }
            }
            else {
                const financial = kind === 'totals' || kind === 'tax-breakdown' || kind === 'payments';
                options.rasterGroups.push({
                    groupId: kind,
                    lineIndex: start,
                    lineCount: segment[part].length,
                    sourceLines: segment.sourceLines[part],
                    sourceControlLines: segment.sourceControlLines[part],
                    ...(segment.sourceLayouts[part].length > 0
                        ? { sourceLayouts: segment.sourceLayouts[part] }
                        : {}),
                    ...(financial ? { financial: true } : {}),
                });
            }
        }
    };
    if (isCanonicalRelativeOrder) {
        // Pinned legacy arrangement where bold grand total closes breakdown segment.
        emit('message', 'pre');
        emit('business-header', 'main');
        emit('customer', 'main');
        emit('document-meta', 'main');
        emit('item-table', 'main');
        emit('totals', 'main');
        emit('tax-breakdown', 'main');
        emit('payments', 'main');
        emit('message', 'main');
        emit('totals', 'post');
        emit('business-header', 'post');
        emit('message', 'post');
    }
    else {
        // Strict template order: each block's complete content at its own
        // position — nothing moves across merchant-selected positions.
        for (const block of blocks) {
            const segment = segments.get(block.kind);
            if (!segment)
                continue;
            emit(block.kind, 'pre');
            emit(block.kind, 'main');
            emit(block.kind, 'post');
        }
    }
    (0, formatting_helpers_1.appendPoweredByFooter)(lines, cols);
    lines.push('{CUT}');
    return lines;
}
/** Full document-driven classic preview pipeline: data -> document -> lines -> bytes. */
function renderClassicReceiptViaDocument(order, bill, business, opts) {
    const semanticBusiness = opts.maskCustomerPhone
        ? {
            ...(business || {}),
            customer_phone: (0, formatting_helpers_1.maskPhoneOnReceipt)(String(business?.customer_phone ?? '')),
        }
        : business;
    const printData = buildBillPrintData(order, bill, semanticBusiness, opts.isReprint);
    const printContext = buildBillPrintContext({
        columns: opts.columns,
        language: opts.language,
        ...(opts.additionalLanguage !== undefined
            ? { additionalLanguage: opts.additionalLanguage }
            : {}),
        business: semanticBusiness,
    });
    const document = (0, print_1.buildBillDocument)(printData, printContext);
    const warnings = [];
    const rasterGroups = [];
    const financialLineRanges = [];
    const lines = renderBillDocumentToClassicLines(document, {
        columns: opts.columns,
        language: printContext.languages[0],
        locale: printContext.locale,
        ...(printContext.timezone !== undefined ? { timezone: printContext.timezone } : {}),
        currency: printContext.currency,
        currencySymbol: printContext.currencySymbol,
        trimDecimals: printContext.trimDecimals,
        useUnicode: opts.useUnicode,
        arabicShaping: opts.arabicShaping,
        cutMode: opts.cutMode,
        capabilities: opts.capabilities,
        maskCustomerPhone: false,
        preserveCurrencySymbol: opts.preserveCurrencySymbol,
        rasterGroups,
        financialLineRanges,
    });
    const data = (0, formatting_helpers_1.buildEscPos)(lines, opts.useUnicode, {
        cutMode: opts.cutMode,
        arabicShaping: opts.arabicShaping,
        columns: opts.columns,
        language: opts.language,
        capabilities: opts.capabilities,
        financialLineRanges,
    }, warnings);
    return { document, lines, data, warnings, rasterGroups };
}
//# sourceMappingURL=document-classic.js.map