"use strict";
/** PrintDocument v1 compact thermal receipt renderer; maps print blocks to ESC/POS token lines. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBillDocumentToCompactLines = renderBillDocumentToCompactLines;
exports.renderCompactReceiptViaDocument = renderCompactReceiptViaDocument;
const db_1 = require("../db");
const countries_1 = require("../countries");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const charges_1 = require("../../shared/charges");
const width_1 = require("../../shared/print/width");
const formatting_helpers_1 = require("./formatting-helpers");
const document_classic_1 = require("./document-classic");
const print_1 = require("../../shared/print");
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
function compactBannerLines(label, context) {
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
function compactItemHeader(block, nameLen, amtLen, language, capabilities) {
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
/** Map a PrintDocument onto compact token-line layout. */
function renderBillDocumentToCompactLines(document, options) {
    const cols = options.columns;
    const lines = [];
    const header = (0, print_1.getBlock)(document, 'business-header');
    const meta = (0, print_1.getBlock)(document, 'document-meta');
    const customer = (0, print_1.getBlock)(document, 'customer');
    const items = (0, print_1.getBlock)(document, 'item-table');
    const breakdown = (0, print_1.getBlock)(document, 'tax-breakdown');
    const totals = (0, print_1.getBlock)(document, 'totals');
    const payments = (0, print_1.getBlock)(document, 'payments');
    const messages = (0, print_1.getBlock)(document, 'message');
    const prefix = (0, formatting_helpers_1.resolveCurrencyPrefix)(options.currencySymbol, options.useUnicode, options.capabilities, options.preserveCurrencySymbol === true, options.currency);
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(options.currency);
    const trimDecimals = options.trimDecimals === true;
    const tzOptions = options.timezone ? { timeZone: options.timezone } : undefined;
    const bar = '='.repeat(cols);
    const dash = '-'.repeat(cols);
    const normalize = (text) => (0, formatting_helpers_1.normalizeThermalText)(text, options.capabilities);
    const markGroup = (groupId, start, sourceLines, sourceControlLines, financial = false, sourceLayouts) => {
        if (options.rasterGroups && lines.length > start)
            options.rasterGroups.push({
                groupId,
                lineIndex: start,
                lineCount: lines.length - start,
                ...(sourceLines ? { sourceLines } : {}),
                ...(sourceControlLines ? { sourceControlLines } : {}),
                ...(sourceLayouts ? { sourceLayouts } : {}),
                ...(financial ? { financial: true } : {}),
            });
    };
    const recordFinancialLines = (start, rendered, financial = true) => {
        if (!financial)
            return;
        if (!options.financialLineRanges)
            return;
        rendered.forEach((line, offset) => {
            options.financialLineRanges.push({ lineIndex: start + offset, lineCount: 1 });
        });
    };
    lines.push('{INIT}');
    // Reprint banner (MessageBlock).
    const messageStart = lines.length;
    const messageSourceLines = [];
    const messageSourceControlLines = [];
    if (messages?.reprintBanner) {
        const bannerLines = compactBannerLines(messages.reprintBanner, {
            logicalColumns: cols,
            direction: document.direction.base,
            languages: document.languages,
            capabilities: options.capabilities,
        });
        lines.push(...bannerLines);
        messageSourceLines.push(...bannerLines.map((line) => line.replace(/\{[^}]+\}/g, '')));
        messageSourceControlLines.push(...bannerLines);
    }
    // Online-order banner (#284, MessageBlock).
    if (messages?.onlineOrderBanner) {
        const banner = messages.onlineOrderBanner;
        const bannerLines = compactBannerLines(banner.label, {
            logicalColumns: cols,
            direction: document.direction.base,
            languages: document.languages,
            capabilities: options.capabilities,
        });
        lines.push(...bannerLines);
        messageSourceLines.push(...bannerLines.map((line) => line.replace(/\{[^}]+\}/g, '')));
        messageSourceControlLines.push(...bannerLines);
        if (banner.platform.text) {
            lines.push('{CENTER}' + normalize(banner.platform.text) + '{/CENTER}');
            messageSourceLines.push(banner.platform.text);
            messageSourceControlLines.push(lines.at(-1) ?? '');
        }
        if (banner.externalOrderId.text) {
            lines.push('{CENTER}#' + normalize(banner.externalOrderId.text) + '{/CENTER}');
            messageSourceLines.push('#' + banner.externalOrderId.text);
            messageSourceControlLines.push(lines.at(-1) ?? '');
        }
    }
    markGroup('message', messageStart, messageSourceLines, messageSourceControlLines);
    // Business header (store name only — compact keeps contact facts in the footer).
    const headerStart = lines.length;
    if (header?.name)
        lines.push('{STORE_NAME}{CENTER}{BOLD}' +
            (0, formatting_helpers_1.truncateShapedLine)(header.name.text, cols, options.arabicShaping, options.language, options.capabilities) +
            '{/BOLD}{/CENTER}');
    markGroup('business-header', headerStart, header?.name ? [header.name.text] : [], header?.name ? [lines[headerStart] ?? ''] : []);
    lines.push(bar);
    // Document meta.
    const metaStart = lines.length;
    const metaSourceLines = [];
    if (meta) {
        lines.push(normalize(labelOf(meta.billNumberLabel) + ': ' + meta.invoiceNumber.text));
        metaSourceLines.push(labelOf(meta.billNumberLabel) + ': ' + meta.invoiceNumber.text);
        const date = (0, db_1.parseDbTimestamp)(meta.timestamp.text);
        const dateText = date.toLocaleDateString(options.locale + '-u-nu-latn', tzOptions) +
            ' ' +
            date.toLocaleTimeString(options.locale + '-u-nu-latn', tzOptions);
        lines.push(normalize(labelOf(meta.dateLabel) + ': ' + dateText));
        metaSourceLines.push(labelOf(meta.dateLabel) + ': ' + dateText);
        if (meta.table) {
            lines.push((0, formatting_helpers_1.truncateShapedLine)(meta.table.label.primary.replace('{name}', meta.table.name.text), cols, options.arabicShaping, options.language, options.capabilities));
            metaSourceLines.push(meta.table.label.primary.replace('{name}', meta.table.name.text));
        }
    }
    markGroup('document-meta', metaStart, metaSourceLines);
    const customerStart = lines.length;
    const customerSourceLines = [];
    const customerSourceControlLines = [];
    if (customer?.heading) {
        lines.push(normalize(labelOf(customer.heading)));
        customerSourceLines.push(labelOf(customer.heading));
        customerSourceControlLines.push(lines.at(-1) ?? '');
    }
    if (customer?.name) {
        lines.push((0, formatting_helpers_1.truncateShapedLine)(labelOf(customer.nameLabel) + ': ' + customer.name.text, cols, options.arabicShaping, options.language, options.capabilities));
        customerSourceLines.push(labelOf(customer.nameLabel) + ': ' + customer.name.text);
        customerSourceControlLines.push(lines.at(-1) ?? '');
    }
    if (customer?.phone) {
        const phone = options.maskCustomerPhone
            ? (0, formatting_helpers_1.maskPhoneOnReceipt)(customer.phone.text)
            : customer.phone.text;
        lines.push(normalize(labelOf(customer.phoneLabel) + ': ' + phone));
        customerSourceLines.push(labelOf(customer.phoneLabel) + ': ' + phone);
        customerSourceControlLines.push(lines.at(-1) ?? '');
    }
    if (customer?.address) {
        // Wrapped, not truncated: the compact layout still has to carry a full address.
        const labeled = labelOf(customer.addressLabel) + ': ' + customer.address.text;
        const addressStart = lines.length;
        (0, formatting_helpers_1.pushWrapped)(lines, labeled, cols, options.language, options.capabilities);
        customerSourceLines.push(labeled);
        customerSourceControlLines.push(lines[addressStart] ?? '');
    }
    if (options.rasterGroups && lines.length > customerStart)
        options.rasterGroups.push({
            groupId: 'customer',
            lineIndex: customerStart,
            lineCount: lines.length - customerStart,
            sourceLines: customerSourceLines,
            sourceControlLines: customerSourceControlLines,
        });
    lines.push(dash);
    // Item table.
    if (items) {
        const amtLen = (0, formatting_helpers_1.itemAmountWidth)({
            items: items.rows.map((row) => ({
                total: row.amount,
                addons: row.addons.map((addon) => ({ price: addon.price })),
            })),
        }, prefix, options.locale, trimDecimals, cols, fractionDigits);
        const nameLen = (0, formatting_helpers_1.itemNameWidth)(cols, amtLen);
        lines.push(compactItemHeader(items, nameLen, amtLen, options.language, options.capabilities));
        lines.push(dash);
        for (const [rowIndex, row] of items.rows.entries()) {
            const rowStart = lines.length;
            const rowLines = (0, formatting_helpers_1.itemRows)({ product_name: row.name.text, quantity: row.quantity, total: row.amount }, nameLen, amtLen, cols, prefix, options.locale, trimDecimals, options.language, fractionDigits, options.capabilities);
            lines.push(...rowLines);
            recordFinancialLines(rowStart, rowLines);
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
                const addonLines = (0, formatting_helpers_1.addonRows)({ name: addon.name.text, price: addon.price, quantity: addon.quantity }, nameLen, amtLen, cols, prefix, options.locale, trimDecimals, options.language, fractionDigits, options.capabilities);
                const addonStart = lines.length;
                lines.push(...addonLines);
                if (addon.price)
                    recordFinancialLines(addonStart, addonLines);
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
                    labelOf(items.noteLabel) +
                    ': ' +
                    (0, formatting_helpers_1.truncate)(row.specialInstructions.text, cols - 8, options.language, options.capabilities));
                lines.push(instructionLine);
                sourceLines.push('  ' + labelOf(items.noteLabel) + ': ' + row.specialInstructions.text);
                sourceControlLines.push(instructionLine);
                sourceLayouts.push(undefined);
                financialSourceLines.push(false);
            }
            if (options.rasterGroups && lines.length > rowStart) {
                const group = {
                    groupId: `item-table-row-${rowIndex}`,
                    lineIndex: rowStart,
                    lineCount: lines.length - rowStart,
                };
                options.rasterGroups.push({
                    ...group,
                    sourceLines,
                    sourceControlLines,
                    sourceLayouts,
                    financialSourceLines,
                    financial: true,
                });
            }
        }
    }
    lines.push(dash);
    // Totals (compact has no loyalty points section).
    const totalsStart = lines.length;
    const totalsSourceLines = [];
    const totalsSourceControlLines = [];
    const totalsSourceLayouts = [];
    const pushTotalRow = (rendered, bold = false, sourceLabel, sourceValue) => {
        const start = lines.length;
        const tokenLines = bold ? rendered.map((line) => `{BOLD}${line}{/BOLD}`) : rendered;
        lines.push(...tokenLines);
        recordFinancialLines(start, tokenLines);
        totalsSourceLines.push(sourceLabel !== undefined && sourceValue !== undefined
            ? `${sourceLabel} ${sourceValue.trimStart()}`
            : rendered.join(' '));
        totalsSourceControlLines.push(tokenLines[0] ?? '');
        totalsSourceLayouts.push(sourceLabel !== undefined && sourceValue !== undefined
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
    if (totals) {
        const subtotalValue = (0, formatting_helpers_1.formatCurrency)(totals.subtotal.amount, prefix, options.locale, trimDecimals, fractionDigits);
        pushTotalRow((0, formatting_helpers_1.financialRows)(labelOf(totals.subtotal.label), subtotalValue, cols, options.language, options.capabilities), false, labelOf(totals.subtotal.label), subtotalValue);
        if (totals.discount) {
            const discountValue = '-' +
                (0, formatting_helpers_1.formatCurrency)(totals.discount.amount, prefix, options.locale, trimDecimals, fractionDigits);
            pushTotalRow((0, formatting_helpers_1.financialRows)(labelOf(totals.discount.label), discountValue, cols, options.language, options.capabilities), false, labelOf(totals.discount.label), discountValue);
        }
        if (breakdown && breakdown.lines.length > 0) {
            for (const line of breakdown.lines) {
                const rateSuffix = line.rate === null ? '' : ` @${line.rate}%`;
                const rawLabel = labelOf(line.label) + rateSuffix;
                const value = (0, formatting_helpers_1.formatCurrency)(line.amount, prefix, options.locale, trimDecimals, fractionDigits);
                pushTotalRow((0, formatting_helpers_1.taxBreakdownRows)(labelOf(line.label), line.rate, value, cols, options.language, options.capabilities), false, rawLabel, value);
            }
        }
        else if (totals.tax) {
            const value = (0, formatting_helpers_1.formatCurrency)(totals.tax.amount, prefix, options.locale, trimDecimals, fractionDigits);
            pushTotalRow((0, formatting_helpers_1.financialRows)(labelOf(totals.tax.label), value, cols, options.language, options.capabilities), false, labelOf(totals.tax.label), value);
        }
        const itemisedCharges = (0, charges_1.receiptChargeLines)(totals.chargesBreakdown);
        const itemisedIds = new Set(itemisedCharges.map((charge) => charge.id));
        if (totals.serviceCharge && !itemisedIds.has('service_charge')) {
            const value = (0, formatting_helpers_1.formatCurrency)(totals.serviceCharge.amount, prefix, options.locale, trimDecimals, fractionDigits);
            pushTotalRow((0, formatting_helpers_1.financialRows)(labelOf(totals.serviceCharge.label), value, cols, options.language, options.capabilities), false, labelOf(totals.serviceCharge.label), value);
        }
        if (totals.deliveryCharge) {
            const value = (0, formatting_helpers_1.formatCurrency)(totals.deliveryCharge.amount, prefix, options.locale, trimDecimals, fractionDigits);
            pushTotalRow((0, formatting_helpers_1.financialRows)(labelOf(totals.deliveryCharge.label), value, cols, options.language, options.capabilities), false, labelOf(totals.deliveryCharge.label), value);
        }
        if (totals.packagingCharge && !itemisedIds.has('packaging_charge')) {
            const value = (0, formatting_helpers_1.formatCurrency)(totals.packagingCharge.amount, prefix, options.locale, trimDecimals, fractionDigits);
            pushTotalRow((0, formatting_helpers_1.financialRows)(labelOf(totals.packagingCharge.label), value, cols, options.language, options.capabilities), false, labelOf(totals.packagingCharge.label), value);
        }
        // Itemised engine charges: a bill without a breakdown keeps the legacy rows.
        for (const charge of itemisedCharges) {
            const value = (0, formatting_helpers_1.formatCurrency)(charge.amount, prefix, options.locale, trimDecimals, fractionDigits);
            pushTotalRow((0, formatting_helpers_1.financialRows)(charge.name, value, cols, options.language, options.capabilities), false, charge.name, value);
        }
        const grandTotalValue = (0, formatting_helpers_1.formatCurrency)(totals.grandTotal.amount, prefix, options.locale, trimDecimals, fractionDigits);
        pushTotalRow((0, formatting_helpers_1.financialRows)(labelOf(totals.grandTotal.label), grandTotalValue, cols, options.language, options.capabilities), true, labelOf(totals.grandTotal.label), grandTotalValue);
    }
    markGroup('totals', totalsStart, totalsSourceLines, totalsSourceControlLines, true, totalsSourceLayouts);
    // Payments.
    const paymentsStart = lines.length;
    const paymentSourceLines = [];
    const paymentSourceControlLines = [];
    const paymentSourceLayouts = [];
    if (payments && payments.lines.length > 0) {
        lines.push(dash);
        paymentSourceLines.push(dash);
        paymentSourceControlLines.push(dash);
        paymentSourceLayouts.push(undefined);
        const pushPaymentRow = (rawLabel, amount) => {
            const methodLabel = (0, formatting_helpers_1.truncate)(rawLabel, cols - 12, options.language, options.capabilities);
            const value = (0, formatting_helpers_1.formatCurrency)(amount, prefix, options.locale, trimDecimals, fractionDigits);
            const rendered = (0, formatting_helpers_1.financialRows)(methodLabel, value, cols, options.language, options.capabilities);
            recordFinancialLines(lines.length, rendered);
            lines.push(...rendered);
            paymentSourceLines.push(`${rawLabel} ${value.trimStart()}`);
            paymentSourceControlLines.push(rendered[0] ?? '');
            paymentSourceLayouts.push({
                kind: 'financial-summary',
                columns: [
                    { text: rawLabel, align: 'left', widthRatio: Math.max(0.1, (cols - 12) / cols) },
                    { text: value.trimStart(), align: 'right', widthRatio: Math.min(0.9, 12 / cols) },
                ],
            });
        };
        for (const line of payments.lines) {
            for (const row of (0, print_1.paymentDisplayRows)(line)) {
                pushPaymentRow(paymentLabel(row.label), row.amount);
            }
        }
    }
    markGroup('payments', paymentsStart, paymentSourceLines, paymentSourceControlLines, true, paymentSourceLayouts);
    // Footer contact details.
    lines.push(bar);
    const businessFooterStart = lines.length;
    const businessFooterSourceLines = [];
    const businessFooterSourceControlLines = [];
    if (header?.address) {
        const start = lines.length;
        (0, formatting_helpers_1.pushWrapped)(lines, header.address.text, cols, options.language, options.capabilities);
        businessFooterSourceLines.push(header.address.text);
        businessFooterSourceControlLines.push(lines[start] ?? '');
    }
    if (header?.phone && header.phoneLabel) {
        const start = lines.length;
        (0, formatting_helpers_1.pushWrapped)(lines, labelOf(header.phoneLabel) + ': ' + header.phone.text, cols, options.language, options.capabilities);
        businessFooterSourceLines.push(labelOf(header.phoneLabel) + ': ' + header.phone.text);
        businessFooterSourceControlLines.push(lines[start] ?? '');
    }
    if (header?.taxId) {
        const start = lines.length;
        (0, formatting_helpers_1.pushWrapped)(lines, labelOf(header.taxId.label) + ': ' + header.taxId.value.text, cols, options.language, options.capabilities);
        businessFooterSourceLines.push(labelOf(header.taxId.label) + ': ' + header.taxId.value.text);
        businessFooterSourceControlLines.push(lines[start] ?? '');
    }
    markGroup('business-header', businessFooterStart, businessFooterSourceLines, businessFooterSourceControlLines);
    const messageFooterStart = lines.length;
    const messageFooterSourceLines = [];
    const messageFooterSourceControlLines = [];
    if (messages?.footerNote) {
        const start = lines.length;
        (0, formatting_helpers_1.pushCenteredWrapped)(lines, messages.footerNote.text, cols, options.language, options.capabilities);
        messageFooterSourceLines.push(messages.footerNote.text);
        messageFooterSourceControlLines.push(lines[start] ?? '');
    }
    else if (messages?.thankYou) {
        lines.push('{CENTER}' + normalize(labelOf(messages.thankYou)) + '{/CENTER}');
        messageFooterSourceLines.push(labelOf(messages.thankYou));
        messageFooterSourceControlLines.push(lines.at(-1) ?? '');
    }
    markGroup('message', messageFooterStart, messageFooterSourceLines, messageFooterSourceControlLines);
    (0, formatting_helpers_1.appendPoweredByFooter)(lines, cols);
    lines.push('{CUT}');
    return lines;
}
/** Full document-driven compact pipeline: data -> document -> lines -> bytes. */
function renderCompactReceiptViaDocument(order, bill, business, opts) {
    const semanticBusiness = opts.maskCustomerPhone
        ? {
            ...(business || {}),
            customer_phone: (0, formatting_helpers_1.maskPhoneOnReceipt)(String(business?.customer_phone ?? '')),
        }
        : business;
    const printData = (0, document_classic_1.buildBillPrintData)(order, bill, semanticBusiness, opts.isReprint);
    const printContext = (0, document_classic_1.buildBillPrintContext)({
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
    const lines = renderBillDocumentToCompactLines(document, {
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
//# sourceMappingURL=document-compact.js.map