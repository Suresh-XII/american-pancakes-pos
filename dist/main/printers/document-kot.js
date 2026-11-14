"use strict";
/** PrintDocument v1 kitchen order ticket renderer; maps KotDocument onto ESC/POS token-line layout. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildKotPrintData = buildKotPrintData;
exports.buildKotPrintContext = buildKotPrintContext;
exports.renderKotDocumentToLines = renderKotDocumentToLines;
exports.renderKotViaDocument = renderKotViaDocument;
const db_1 = require("../db");
const print_labels_generated_1 = require("../print/print-labels.generated");
const formatting_helpers_1 = require("./formatting-helpers");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const document_classic_1 = require("./document-classic");
const width_1 = require("../../shared/print/width");
const print_1 = require("../../shared/print");
// Normalization (caller-side, main-process layer).
/** Normalize raw order/items/station rows into an authoritative KOT snapshot. */
function buildKotPrintData(order, items, stationName) {
    const ticketItems = Array.isArray(items)
        ? items.filter((item) => (0, print_1.isKotItemPending)(item?.status))
        : [];
    return {
        stationName: String(stationName ?? ''),
        order: {
            orderNumber: String(order?.order_number ?? ''),
            createdAt: String(order?.created_at ?? ''),
            tableName: String(order?.table?.name ?? ''),
            orderType: String(order?.type ?? '').trim(),
            customerName: String(order?.customer?.name ?? order?.customer_name ?? '').trim(),
            orderNotes: [order?.special_instructions, order?.order_notes, order?.orderNotes, order?.notes]
                .find((val) => typeof val === 'string' && val.trim().length > 0)
                ?.trim() ?? '',
        },
        items: ticketItems.map((item) => ({
            productName: (0, formatting_helpers_1.formatVariantItemHeading)(String(item?.product_name ?? ''), (0, formatting_helpers_1.parseVariantSelection)(item?.variant_selection)),
            quantity: Number(item?.quantity) || 0,
            addons: parseKotAddons(item?.addons).map((addon) => ({
                name: String(addon?.name ?? ''),
                ...(typeof addon?.quantity === 'number' &&
                    Number.isFinite(addon.quantity) &&
                    addon.quantity > 0
                    ? { quantity: addon.quantity }
                    : {}),
            })),
            specialInstructions: String(item?.special_instructions ?? ''),
        })),
    };
}
function parseKotAddons(value) {
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
    return candidates.filter((addon) => Boolean(addon) &&
        typeof addon === 'object' &&
        typeof addon.name === 'string');
}
/** Build PrintContext for a kitchen ticket using pre-resolved language policy. */
function buildKotPrintContext(opts) {
    return {
        columns: opts.columns,
        languages: [opts.language],
        baseDirection: (0, document_classic_1.detectPrintLanguageDirection)(opts.language),
        locale: 'en-US',
        currency: '',
        currencySymbol: '',
        trimDecimals: false,
        ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
        resolveLabel: (conceptId, language) => (0, print_labels_generated_1.printLabel)(language, conceptId),
    };
}
/** Typed accessor for one block kind within a KOT document. */
function kotBlock(document, kind) {
    return document.blocks.find((block) => block.kind === kind);
}
function labelOf(label) {
    return label.primary;
}
/** Interpolate the ICU {name} placeholder of pos.tableLabel inline (#440). */
function formatTableLabel(label, tableName) {
    return labelOf(label).replace('{name}', tableName);
}
// Use localized header metadata if supported; fallback to ASCII labels.
const UNSUPPORTED_METADATA_PLACEHOLDER = '[UNSUPPORTED]';
function thermalSafeText(value, fallback, language, arabicShaping, capabilities) {
    const merged = (0, thermal_capabilities_1.mergeThermalCapabilities)(capabilities ?? thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES, arabicShaping);
    if (merged.raster.enabled === true && !(0, thermal_capabilities_1.isThermalTextRepresentable)(value, merged))
        return value;
    return (0, thermal_capabilities_1.thermalTextFallback)(value, fallback, merged);
}
function thermalSafeMetadataValue(value, language, arabicShaping, capabilities) {
    return thermalSafeText(value, UNSUPPORTED_METADATA_PLACEHOLDER, language, arabicShaping, capabilities);
}
function formatOrderNumberLabel(label, orderNumber, language, arabicShaping, capabilities) {
    const localized = labelOf(label).replace('{number}', orderNumber);
    const fallbackOrderNumber = thermalSafeMetadataValue(orderNumber, language, arabicShaping, capabilities);
    return thermalSafeText(localized, `Order #${fallbackOrderNumber}`, language, arabicShaping, capabilities);
}
function kotHeaderLines(header, options, sourceLines, sourceControlLines) {
    const cols = options.columns;
    const lines = [];
    const tzOptions = options.timezone ? { timeZone: options.timezone } : undefined;
    const thermalCapabilities = (0, thermal_capabilities_1.mergeThermalCapabilities)(options.capabilities, options.arabicShaping);
    const banner = thermalSafeText(labelOf(header.banner), 'KITCHEN ORDER TICKET', options.language, options.arabicShaping, options.capabilities);
    const station = thermalSafeText(`${labelOf(header.stationLabel)}: ${header.stationName.text}`, `Station: ${thermalSafeMetadataValue(header.stationName.text, options.language, options.arabicShaping, options.capabilities)}`, options.language, options.arabicShaping, options.capabilities);
    const table = header.table
        ? thermalSafeText(formatTableLabel(header.table.label, header.table.name.text), `Table: ${thermalSafeMetadataValue(header.table.name.text, options.language, options.arabicShaping, options.capabilities)}`, options.language, options.arabicShaping, options.capabilities)
        : null;
    const orderType = header.orderType
        ? (() => {
            const localized = `${labelOf(header.orderType.label)}: ${header.orderType.value.text}`;
            const fallback = `Type: ${header.orderType.code.replace(/_/g, ' ').trim().toUpperCase()}`;
            return (0, thermal_capabilities_1.shouldUseOrderTypeFallback)(localized, thermalCapabilities)
                ? fallback
                : thermalSafeText(localized, fallback, options.language, options.arabicShaping, options.capabilities);
        })()
        : null;
    const time = (0, db_1.parseDbTimestamp)(header.timestamp.text).toLocaleTimeString((options.locale ?? 'en-US') + '-u-nu-latn', tzOptions);
    const timeLine = thermalSafeText(`${labelOf(header.timeLabel)}: ${time}`, `Time: ${(0, db_1.parseDbTimestamp)(header.timestamp.text).toLocaleTimeString('en-US-u-nu-latn', tzOptions)}`, options.language, options.arabicShaping, options.capabilities);
    lines.push('{CENTER}{BOLD}' +
        (0, formatting_helpers_1.truncateShapedLine)(banner, cols, options.arabicShaping, options.language, options.capabilities) +
        '{/BOLD}{/CENTER}');
    sourceLines?.push(labelOf(header.banner));
    sourceControlLines?.push(lines.at(-1) ?? '');
    lines.push('');
    sourceLines?.push('');
    sourceControlLines?.push('');
    lines.push((0, formatting_helpers_1.truncateShapedLine)(station, cols, options.arabicShaping, options.language, options.capabilities));
    sourceLines?.push(`${labelOf(header.stationLabel)}: ${header.stationName.text}`);
    sourceControlLines?.push(lines.at(-1) ?? '');
    lines.push((0, formatting_helpers_1.truncateShapedLine)(formatOrderNumberLabel(header.orderNumberLabel, header.orderNumber.text, options.language, options.arabicShaping, options.capabilities), cols, options.arabicShaping, options.language, options.capabilities));
    sourceLines?.push(labelOf(header.orderNumberLabel).replace('{number}', header.orderNumber.text));
    sourceControlLines?.push(lines.at(-1) ?? '');
    if (table) {
        lines.push((0, formatting_helpers_1.truncateShapedLine)(table, cols, options.arabicShaping, options.language, options.capabilities));
        sourceLines?.push(formatTableLabel(header.table.label, header.table.name.text));
        sourceControlLines?.push(lines.at(-1) ?? '');
    }
    if (orderType) {
        lines.push((0, formatting_helpers_1.truncateShapedLine)(orderType, cols, options.arabicShaping, options.language, options.capabilities));
        sourceLines?.push(`${labelOf(header.orderType.label)}: ${header.orderType.value.text}`);
        sourceControlLines?.push(lines.at(-1) ?? '');
    }
    if (header.customer) {
        const customer = thermalSafeText(`${labelOf(header.customer.label)}: ${header.customer.name.text}`, `Customer: ${thermalSafeMetadataValue(header.customer.name.text, options.language, options.arabicShaping, options.capabilities)}`, options.language, options.arabicShaping, options.capabilities);
        lines.push((0, formatting_helpers_1.truncateShapedLine)(customer, cols, options.arabicShaping, options.language, options.capabilities));
        sourceLines?.push(`${labelOf(header.customer.label)}: ${header.customer.name.text}`);
        sourceControlLines?.push(lines.at(-1) ?? '');
    }
    lines.push((0, formatting_helpers_1.truncateShapedLine)(timeLine, cols, options.arabicShaping, options.language, options.capabilities));
    sourceLines?.push(`${labelOf(header.timeLabel)}: ${time}`);
    sourceControlLines?.push(lines.at(-1) ?? '');
    if (header.orderNotes) {
        const noteLabel = thermalSafeText(labelOf(header.orderNotes.label), 'Note', options.language, options.arabicShaping, options.capabilities);
        const noteText = `${noteLabel}: ${header.orderNotes.text.text}`;
        const wrapped = [];
        (0, formatting_helpers_1.pushWrapped)(wrapped, noteText, Math.max(1, cols - 6), options.language, options.capabilities);
        lines.push('');
        sourceLines?.push('');
        sourceControlLines?.push(lines.at(-1) ?? '');
        wrapped.forEach((text, index) => {
            lines.push('{DOUBLE_HEIGHT}{BOLD}' + (index === 0 ? '!! ' : '   ') + text + '{/BOLD}{/DOUBLE_HEIGHT}');
            sourceLines?.push((index === 0 ? '!! ' : '   ') + text);
            sourceControlLines?.push(lines.at(-1) ?? '');
        });
    }
    return lines;
}
function kotItemLines(row, cols, arabicShaping, language, capabilities) {
    const lines = [];
    const itemPrefix = row.quantity + 'x  ';
    lines.push('{DOUBLE_HEIGHT}{BOLD}' +
        itemPrefix +
        (0, formatting_helpers_1.truncateShapedLine)(row.name.text, Math.max(1, cols - (0, width_1.displayCellWidth)(itemPrefix)), arabicShaping, language, capabilities) +
        '{/BOLD}{/DOUBLE_HEIGHT}');
    for (const addon of row.addons) {
        const quantity = addon.quantity ?? 1;
        const quantitySuffix = quantity > 1 ? ` x${quantity}` : '';
        const name = (0, formatting_helpers_1.truncate)(addonName(addon), Math.max(1, cols - 4 - (0, width_1.displayCellWidth)(quantitySuffix)), language, capabilities);
        lines.push('  + ' + name + quantitySuffix);
    }
    if (row.specialInstructions) {
        lines.push('  >> ' +
            (0, formatting_helpers_1.truncateShapedLine)(row.specialInstructions.text, Math.max(1, cols - 8), arabicShaping, language, capabilities));
    }
    return lines;
}
function addonName(addon) {
    return addon.text;
}
/** Map a KotDocument onto the legacy KOT token-line layout. */
function renderKotDocumentToLines(document, options) {
    const lines = [];
    const header = kotBlock(document, 'kot-header');
    const items = kotBlock(document, 'kot-items');
    const cols = options.columns;
    const bar = '='.repeat(cols);
    lines.push('{INIT}');
    if (header) {
        const headerStart = lines.length;
        const headerSourceLines = [];
        const headerSourceControlLines = [];
        lines.push(...kotHeaderLines(header, options, headerSourceLines, headerSourceControlLines));
        options.rasterGroups?.push({
            groupId: 'kot-header',
            lineIndex: headerStart,
            lineCount: lines.length - headerStart,
            sourceLines: headerSourceLines,
            sourceControlLines: headerSourceControlLines,
        });
    }
    lines.push(bar);
    lines.push('');
    if (items) {
        for (const [rowIndex, row] of items.rows.entries()) {
            const rowStart = lines.length;
            const rowLines = kotItemLines(row, cols, options.arabicShaping, options.language, options.capabilities);
            lines.push(...rowLines);
            const sourceLines = [`${row.quantity}x  ${row.name.text}`];
            const sourceControlLines = [rowLines[0] ?? ''];
            let rowLineOffset = 1;
            for (const addon of row.addons) {
                const quantitySuffix = (addon.quantity ?? 1) > 1 ? ` x${addon.quantity}` : '';
                sourceLines.push(`  + ${addon.text}${quantitySuffix}`);
                sourceControlLines.push(rowLines[rowLineOffset] ?? '');
                rowLineOffset += 1;
            }
            if (row.specialInstructions) {
                sourceLines.push('  >> ' + row.specialInstructions.text);
                sourceControlLines.push(rowLines[rowLineOffset] ?? '');
            }
            if (options.rasterGroups) {
                const group = {
                    groupId: `kot-items-row-${rowIndex}`,
                    lineIndex: rowStart,
                    lineCount: lines.length - rowStart,
                };
                options.rasterGroups.push({ ...group, sourceLines, sourceControlLines });
            }
        }
    }
    lines.push('');
    lines.push(bar);
    lines.push('{CUT}');
    return lines;
}
/** Full document-driven KOT pipeline: data -> document -> lines -> bytes. */
function renderKotViaDocument(order, items, stationName, opts) {
    const printData = buildKotPrintData(order, items, stationName);
    const printContext = buildKotPrintContext({
        columns: opts.columns,
        language: opts.language,
        ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
    });
    const document = (0, print_1.buildKotDocument)(printData, printContext);
    const warnings = [];
    const rasterGroups = [];
    const lines = renderKotDocumentToLines(document, {
        columns: opts.columns,
        language: opts.language,
        ...(opts.locale !== undefined ? { locale: opts.locale } : {}),
        ...(printContext.timezone !== undefined ? { timezone: printContext.timezone } : {}),
        useUnicode: opts.useUnicode,
        arabicShaping: opts.arabicShaping,
        cutMode: opts.cutMode,
        capabilities: opts.capabilities,
        rasterGroups,
    });
    const data = (0, formatting_helpers_1.buildEscPos)(lines, opts.useUnicode, {
        cutMode: opts.cutMode,
        arabicShaping: opts.arabicShaping,
        columns: opts.columns,
        language: opts.language,
        capabilities: opts.capabilities,
    }, warnings);
    return { document, lines, data, warnings, rasterGroups };
}
//# sourceMappingURL=document-kot.js.map