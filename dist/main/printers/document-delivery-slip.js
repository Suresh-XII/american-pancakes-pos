"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DELIVERY_SLIP_ADDRESS_CHARS = exports.MAX_DELIVERY_SLIP_NOTE_CHARS = void 0;
exports.buildDeliverySlipPrintData = buildDeliverySlipPrintData;
exports.buildDeliverySlipPrintContext = buildDeliverySlipPrintContext;
exports.renderDeliverySlipDocumentToLines = renderDeliverySlipDocumentToLines;
exports.renderDeliverySlipViaDocument = renderDeliverySlipViaDocument;
const db_1 = require("../db");
const countries_1 = require("../countries");
const print_labels_generated_1 = require("../print/print-labels.generated");
const formatting_helpers_1 = require("./formatting-helpers");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const document_classic_1 = require("./document-classic");
const width_1 = require("../../shared/print/width");
const order_item_status_1 = require("../../shared/order-item-status");
const print_1 = require("../../shared/print");
Object.defineProperty(exports, "MAX_DELIVERY_SLIP_NOTE_CHARS", { enumerable: true, get: function () { return print_1.MAX_DELIVERY_SLIP_NOTE_CHARS; } });
exports.MAX_DELIVERY_SLIP_ADDRESS_CHARS = 300;
function parseSlipAddons(value) {
    let candidates = value;
    if (typeof value === 'string') {
        try {
            candidates = JSON.parse(value);
        }
        catch {
            candidates = null;
        }
    }
    if (!Array.isArray(candidates))
        return [];
    return candidates
        .filter((addon) => Boolean(addon) &&
        typeof addon === 'object' &&
        typeof addon.name === 'string')
        .map((addon) => ({
        name: addon.name,
        ...(typeof addon.quantity === 'number' &&
            Number.isFinite(addon.quantity) &&
            addon.quantity > 0
            ? { quantity: addon.quantity }
            : {}),
    }));
}
function buildDeliverySlipPrintData(order, items, contact, options = {}) {
    const orderAddress = typeof order?.delivery_address === 'string' ? order.delivery_address.trim() : '';
    const customerAddress = typeof contact?.address === 'string' ? contact.address.trim() : '';
    const { text: address, truncatedChars } = clampAddress(orderAddress.length > 0 ? orderAddress : customerAddress);
    const addressSource = address.length === 0
        ? null
        : orderAddress.length > 0
            ? 'order'
            : (contact?.addressSource ?? 'customer');
    const { text: note, truncatedChars: noteTruncatedChars } = (0, print_1.clampDeliverySlipText)(String(order?.special_instructions ?? '').trim());
    const { text: deliveryNote, truncatedChars: deliveryNoteTruncatedChars } = (0, print_1.clampDeliverySlipText)(String(order?.delivery_note ?? '').trim());
    const expectedMethod = (0, print_1.sanitizeDeliverySlipPaymentMethod)(order?.expected_payment_method);
    // The persisted identity, not today's method table, decides whether the stored
    // name prints literally - a later rename or deactivation cannot change it.
    const expectedMethodIsCustom = Number.isSafeInteger(Number(order?.expected_payment_method_id)) &&
        Number(order?.expected_payment_method_id) > 0;
    const ticketItems = Array.isArray(items)
        ? items.filter((item) => !(0, order_item_status_1.isTerminalItemStatus)(item?.status))
        : [];
    const paymentBills = Array.isArray(order?.bills) ? order.bills : order?.bill;
    const paymentSummary = (0, print_1.resolveDeliverySlipPaymentSummary)(order?.total, paymentBills, (0, countries_1.getCurrencyMinorUnitFactor)(String(options.currency ?? '')));
    const formatAmount = (amount) => (0, countries_1.formatMoney)(amount, String(options.currency ?? ''), options.locale ?? 'en-US', {
        currencyDisplay: options.currencyDisplay,
        digits: options.digits,
    });
    const payment = paymentSummary
        ? {
            ...paymentSummary,
            formattedAmount: formatAmount(paymentSummary.amount),
            formattedAmountDue: formatAmount(paymentSummary.amountDue),
            ...(expectedMethod ? { expectedMethod } : {}),
            ...(expectedMethodIsCustom ? { expectedMethodIsCustom: true } : {}),
        }
        : undefined;
    return {
        order: {
            orderNumber: String(order?.order_number ?? ''),
            createdAt: String(order?.created_at ?? ''),
            orderType: String(order?.type ?? '').trim(),
        },
        // Courier instruction for the whole delivery, printed once rather than per
        // item. Stored on every order; printed on none before this.
        note,
        noteTruncatedChars,
        deliveryNote,
        deliveryNoteTruncatedChars,
        contact: {
            name: String(contact?.name ?? order?.customer?.name ?? '').trim(),
            // The delivery override, or the receipt setting when it is off: both
            // documents then agree about the same merchant choice.
            phone: options.showCustomerPhone === false ? '' : String(contact?.phone ?? '').trim(),
            address,
            addressSource,
            addressTruncatedChars: truncatedChars,
        },
        ...(payment ? { payment } : {}),
        items: ticketItems.map((item) => ({
            productName: (0, formatting_helpers_1.formatVariantItemHeading)(String(item?.product_name ?? ''), (0, formatting_helpers_1.parseVariantSelection)(item?.variant_selection)),
            quantity: Number(item?.quantity) || 0,
            addons: parseSlipAddons(item?.addons),
            specialInstructions: String(item?.special_instructions ?? ''),
        })),
    };
}
function clampAddress(address) {
    return (0, print_1.clampDeliverySlipText)(address, exports.MAX_DELIVERY_SLIP_ADDRESS_CHARS);
}
function buildDeliverySlipPrintContext(opts) {
    return {
        columns: opts.columns,
        languages: [opts.language],
        baseDirection: (0, document_classic_1.detectPrintLanguageDirection)(opts.language),
        locale: opts.locale ?? 'en-US',
        currency: opts.currency ?? '',
        currencySymbol: opts.currencySymbol ?? '',
        trimDecimals: false,
        ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
        resolveLabel: (conceptId, language) => (0, print_labels_generated_1.printLabel)(language, conceptId),
    };
}
function slipBlock(document, kind) {
    return document.blocks.find((block) => block.kind === kind);
}
function labelOf(label) {
    return label.primary;
}
const UNSUPPORTED_METADATA_PLACEHOLDER = '[UNSUPPORTED]';
function thermalSafeText(value, fallback, arabicShaping, capabilities) {
    const merged = (0, thermal_capabilities_1.mergeThermalCapabilities)(capabilities ?? thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES, arabicShaping);
    if (merged.raster.enabled === true && !(0, thermal_capabilities_1.isThermalTextRepresentable)(value, merged))
        return value;
    return (0, thermal_capabilities_1.thermalTextFallback)(value, fallback, merged);
}
function thermalSafeMetadataValue(value, arabicShaping, capabilities) {
    return thermalSafeText(value, UNSUPPORTED_METADATA_PLACEHOLDER, arabicShaping, capabilities);
}
function slipHeaderLines(header, options, sourceLines, sourceControlLines) {
    const cols = options.columns;
    const lines = [];
    const tzOptions = options.timezone ? { timeZone: options.timezone } : undefined;
    const thermalCapabilities = (0, thermal_capabilities_1.mergeThermalCapabilities)(options.capabilities, options.arabicShaping);
    const banner = thermalSafeText(labelOf(header.banner), 'DELIVERY SLIP', options.arabicShaping, options.capabilities);
    lines.push('{CENTER}{BOLD}' +
        (0, formatting_helpers_1.truncateShapedLine)(banner, cols, options.arabicShaping, options.language, options.capabilities) +
        '{/BOLD}{/CENTER}');
    sourceLines.push(labelOf(header.banner));
    sourceControlLines.push(lines.at(-1) ?? '');
    lines.push('');
    sourceLines.push('');
    sourceControlLines.push('');
    const orderNumberLabel = thermalSafeText(labelOf(header.orderNumberLabel).replace('{number}', header.orderNumber.text), `Order #${thermalSafeMetadataValue(header.orderNumber.text, options.arabicShaping, options.capabilities)}`, options.arabicShaping, options.capabilities);
    lines.push((0, formatting_helpers_1.truncateShapedLine)(orderNumberLabel, cols, options.arabicShaping, options.language, options.capabilities));
    sourceLines.push(labelOf(header.orderNumberLabel).replace('{number}', header.orderNumber.text));
    sourceControlLines.push(lines.at(-1) ?? '');
    if (header.orderType) {
        const localized = `${labelOf(header.orderType.label)}: ${header.orderType.value.text}`;
        const fallback = `Type: ${header.orderType.code.replace(/_/g, ' ').trim().toUpperCase()}`;
        const orderType = (0, thermal_capabilities_1.shouldUseOrderTypeFallback)(localized, thermalCapabilities)
            ? fallback
            : thermalSafeText(localized, fallback, options.arabicShaping, options.capabilities);
        lines.push((0, formatting_helpers_1.truncateShapedLine)(orderType, cols, options.arabicShaping, options.language, options.capabilities));
        sourceLines.push(`${labelOf(header.orderType.label)}: ${header.orderType.value.text}`);
        sourceControlLines.push(lines.at(-1) ?? '');
    }
    const time = (0, db_1.parseDbTimestamp)(header.timestamp.text).toLocaleTimeString((options.locale ?? 'en-US') + '-u-nu-latn', tzOptions);
    const timeLine = thermalSafeText(`${labelOf(header.timeLabel)}: ${time}`, `Time: ${(0, db_1.parseDbTimestamp)(header.timestamp.text).toLocaleTimeString('en-US-u-nu-latn', tzOptions)}`, options.arabicShaping, options.capabilities);
    lines.push((0, formatting_helpers_1.truncateShapedLine)(timeLine, cols, options.arabicShaping, options.language, options.capabilities));
    sourceLines.push(`${labelOf(header.timeLabel)}: ${time}`);
    sourceControlLines.push(lines.at(-1) ?? '');
    return lines;
}
function slipContactLines(contact, options, sourceLines, sourceControlLines) {
    const cols = options.columns;
    const lines = [];
    if (contact.name) {
        lines.push('{CENTER}{FONT_B}' +
            (0, formatting_helpers_1.truncateShapedLine)(contact.name.text, cols, options.arabicShaping, options.language, options.capabilities) +
            '{/FONT_B}{/CENTER}');
        sourceLines.push(contact.name.text);
        sourceControlLines.push(lines.at(-1) ?? '');
    }
    if (contact.phone) {
        lines.push('{CENTER}' + contact.phone.text + '{/CENTER}');
        sourceLines.push(contact.phone.text);
        sourceControlLines.push(lines.at(-1) ?? '');
    }
    if (contact.address) {
        // Wrapped, not truncated: a wrapped address stays readable at every rung.
        // pushWrapped is the helper the receipt uses for the shop's own address.
        const labeled = thermalSafeText(`${labelOf(contact.addressLabel)}: `, 'Delivery address: ', options.arabicShaping, options.capabilities) + contact.address.text;
        const start = lines.length;
        (0, formatting_helpers_1.pushWrapped)(lines, labeled, cols, options.language, options.capabilities);
        sourceLines.push(labeled);
        sourceControlLines.push(lines[start] ?? '');
        if (contact.addressTruncatedChars > 0) {
            const marker = (0, print_labels_generated_1.printLabel)(options.language, 'print.deliverySlip.addressTruncated').replace('{count}', String(contact.addressTruncatedChars));
            (0, formatting_helpers_1.pushWrapped)(lines, marker, cols, options.language, options.capabilities);
            sourceLines.push(marker);
            sourceControlLines.push(lines.at(-1) ?? '');
        }
    }
    return lines;
}
function slipNoteLines(notes, options, sourceLines, sourceControlLines) {
    const lines = [];
    for (const [label, fallback, text, truncatedChars] of [
        [
            notes.deliveryNoteLabel,
            'Delivery note: ',
            notes.deliveryNote,
            notes.deliveryNoteTruncatedChars,
        ],
        [notes.label, 'Note: ', notes.note, notes.noteTruncatedChars],
    ]) {
        // Wrapped, never truncated: a courier instruction cut mid-sentence is worse
        // than one that runs long. pushWrapped is the same helper the address uses.
        if (text) {
            const labeled = thermalSafeText(`${labelOf(label)}: `, fallback, options.arabicShaping, options.capabilities) + text.text;
            const start = lines.length;
            (0, formatting_helpers_1.pushWrapped)(lines, labeled, options.columns, options.language, options.capabilities);
            sourceLines.push(labeled);
            sourceControlLines.push(lines[start] ?? '');
        }
        // A courier instruction that ends without saying it was cut reads as the whole
        // instruction, so the drop is stated on the paper rather than only in the data.
        if (truncatedChars > 0) {
            const marker = (0, print_labels_generated_1.printLabel)(options.language, 'print.deliverySlip.addressTruncated').replace('{count}', String(truncatedChars));
            (0, formatting_helpers_1.pushWrapped)(lines, marker, options.columns, options.language, options.capabilities);
            sourceLines.push(marker);
            sourceControlLines.push(lines.at(-1) ?? '');
        }
    }
    return lines;
}
function slipPaymentLines(payment, options) {
    const fallbackStatus = payment.status === 'paid'
        ? 'PAID'
        : payment.status === 'refunded'
            ? 'REFUNDED'
            : payment.status === 'partially_refunded'
                ? 'PARTIAL REFUND'
                : !payment.detailsText
                    ? 'AMOUNT DUE'
                    : 'TO COLLECT';
    const status = thermalSafeText(labelOf(payment.label), fallbackStatus, options.arabicShaping, options.capabilities);
    const method = payment.methodLabel?.primary ?? payment.methodName?.text ?? '';
    const totalLabel = thermalSafeText((0, print_labels_generated_1.printLabel)(options.language, 'pos.total'), 'Total', options.arabicShaping, options.capabilities);
    const summary = payment.status === 'paid'
        ? `${status}: ${method ? `${method} ` : ''}(${totalLabel}: ${payment.amountText.text})`
        : payment.status === 'unpaid' && payment.detailsText
            ? `${status}: ${payment.amountText.text} (${payment.detailsText.text})`
            : `${status}${payment.amountText.text ? `: ${payment.amountText.text}` : ''}`;
    const lines = [];
    (0, formatting_helpers_1.pushWrapped)(lines, summary, options.columns, options.language, options.capabilities);
    if (lines.length > 0)
        lines[0] = `{BOLD}${lines[0]}{/BOLD}`;
    if ((payment.status === 'paid' ||
        payment.status === 'refunded' ||
        payment.status === 'partially_refunded') &&
        payment.detailsText) {
        (0, formatting_helpers_1.pushWrapped)(lines, payment.detailsText.text, options.columns, options.language, options.capabilities);
    }
    return lines;
}
function slipItemLines(row, cols, arabicShaping, language, capabilities) {
    const lines = [];
    const itemPrefix = row.quantity + 'x  ';
    // These all arrive through directionalText, which already neutralised control
    // tokens, so the renderer only has to fit them to the column.
    lines.push('{BOLD}' +
        itemPrefix +
        (0, formatting_helpers_1.truncateShapedLine)(row.name.text, Math.max(1, cols - (0, width_1.displayCellWidth)(itemPrefix)), arabicShaping, language, capabilities) +
        '{/BOLD}');
    for (const addon of row.addons) {
        const quantity = addon.quantity ?? 1;
        const quantitySuffix = quantity > 1 ? ` x${quantity}` : '';
        const name = (0, formatting_helpers_1.truncate)(addon.text, Math.max(1, cols - 4 - (0, width_1.displayCellWidth)(quantitySuffix)), language, capabilities);
        lines.push('  + ' + name + quantitySuffix);
    }
    if (row.specialInstructions) {
        lines.push('  >> ' +
            (0, formatting_helpers_1.truncateShapedLine)(row.specialInstructions.text, Math.max(1, cols - 8), arabicShaping, language, capabilities));
    }
    return lines;
}
/** Map a DeliverySlipDocument onto the ESC/POS token-line layout. */
function renderDeliverySlipDocumentToLines(document, options) {
    const lines = [];
    const cols = options.columns;
    const bar = '='.repeat(cols);
    const header = slipBlock(document, 'delivery-slip-header');
    const contact = slipBlock(document, 'delivery-slip-contact');
    const notes = slipBlock(document, 'delivery-slip-notes');
    const payment = slipBlock(document, 'delivery-slip-payment');
    const items = slipBlock(document, 'delivery-slip-items');
    lines.push('{INIT}');
    if (header) {
        const headerStart = lines.length;
        const headerSourceLines = [];
        const headerControlLines = [];
        lines.push(...slipHeaderLines(header, options, headerSourceLines, headerControlLines));
        options.rasterGroups?.push({
            groupId: 'delivery-slip-header',
            lineIndex: headerStart,
            lineCount: lines.length - headerStart,
            sourceLines: headerSourceLines,
            sourceControlLines: headerControlLines,
        });
    }
    lines.push(bar);
    lines.push('');
    if (contact) {
        const contactStart = lines.length;
        const contactSourceLines = [];
        const contactControlLines = [];
        lines.push(...slipContactLines(contact, options, contactSourceLines, contactControlLines));
        options.rasterGroups?.push({
            groupId: 'delivery-slip-contact',
            lineIndex: contactStart,
            lineCount: lines.length - contactStart,
            sourceLines: contactSourceLines,
            sourceControlLines: contactControlLines,
        });
    }
    if (notes) {
        const notesStart = lines.length;
        const notesSourceLines = [];
        const notesControlLines = [];
        lines.push(...slipNoteLines(notes, options, notesSourceLines, notesControlLines));
        if (lines.length > notesStart) {
            options.rasterGroups?.push({
                groupId: 'delivery-slip-notes',
                lineIndex: notesStart,
                lineCount: lines.length - notesStart,
                sourceLines: notesSourceLines,
                sourceControlLines: notesControlLines,
            });
        }
    }
    if (payment) {
        lines.push('');
        const paymentStart = lines.length;
        const paymentLines = slipPaymentLines(payment, options);
        lines.push(...paymentLines);
        if (paymentLines.length > 0) {
            options.rasterGroups?.push({
                groupId: 'delivery-slip-payment',
                lineIndex: paymentStart,
                lineCount: paymentLines.length,
                sourceLines: paymentLines.map((line) => line.replace(/\{\/?BOLD\}/g, '')),
                sourceControlLines: paymentLines,
                financial: true,
            });
            options.financialLineRanges?.push({
                lineIndex: paymentStart,
                lineCount: paymentLines.length,
            });
            lines.push('-'.repeat(cols));
        }
    }
    if (items) {
        for (const [rowIndex, row] of items.rows.entries()) {
            const rowStart = lines.length;
            const rowLines = slipItemLines(row, cols, options.arabicShaping, options.language, options.capabilities);
            lines.push(...rowLines);
            const sourceLines = [`${row.quantity}x  ${row.name.text}`];
            const sourceControlLines = [rowLines[0] ?? ''];
            let offset = 1;
            for (const addon of row.addons) {
                const quantitySuffix = (addon.quantity ?? 1) > 1 ? ` x${addon.quantity}` : '';
                sourceLines.push(`  + ${addon.text}${quantitySuffix}`);
                sourceControlLines.push(rowLines[offset] ?? '');
                offset += 1;
            }
            if (row.specialInstructions) {
                sourceLines.push('  >> ' + row.specialInstructions.text);
                sourceControlLines.push(rowLines[offset] ?? '');
            }
            if (options.rasterGroups) {
                options.rasterGroups.push({
                    groupId: `delivery-slip-items-row-${rowIndex}`,
                    lineIndex: rowStart,
                    lineCount: lines.length - rowStart,
                    sourceLines,
                    sourceControlLines,
                });
            }
        }
    }
    lines.push('');
    lines.push(bar);
    lines.push('{CUT}');
    return lines;
}
/** Full document-driven delivery slip pipeline: data -> document -> lines -> bytes. */
function renderDeliverySlipViaDocument(order, items, contact, opts) {
    const printData = buildDeliverySlipPrintData(order, items, contact, opts);
    const printContext = buildDeliverySlipPrintContext({
        columns: opts.columns,
        language: opts.language,
        ...(opts.locale !== undefined ? { locale: opts.locale } : {}),
        ...(opts.currency !== undefined ? { currency: opts.currency } : {}),
        ...(opts.currencySymbol !== undefined ? { currencySymbol: opts.currencySymbol } : {}),
        ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
    });
    const document = (0, print_1.buildDeliverySlipDocument)(printData, printContext);
    const warnings = [];
    const rasterGroups = [];
    const financialLineRanges = [];
    const lines = renderDeliverySlipDocumentToLines(document, {
        columns: opts.columns,
        language: opts.language,
        ...(opts.locale !== undefined ? { locale: opts.locale } : {}),
        ...(printContext.timezone !== undefined ? { timezone: printContext.timezone } : {}),
        useUnicode: opts.useUnicode,
        arabicShaping: opts.arabicShaping,
        cutMode: opts.cutMode,
        capabilities: opts.capabilities,
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
//# sourceMappingURL=document-delivery-slip.js.map