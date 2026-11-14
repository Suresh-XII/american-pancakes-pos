"use strict";
/**
 * Renderer-independent PrintDocument v1 (#442, epic #438).
 *
 * A PrintDocument is the authoritative SEMANTIC representation of a printed
 * receipt: an ordered list of blocks (business header, document meta,
 * customer, item table, tax breakdown, totals, payments, messages). It is
 * produced by pure builders from caller-supplied normalized snapshots and
 * consumed by renderers that choose physical layout (ESC/POS token lines,
 * HTML, …). No transport APIs and no byte tokens (`{CENTER}` etc.) exist in
 * this model.
 *
 * PURITY RULES (same contract as the rest of `shared/print/`, see README.md):
 *   - Types + pure functions only. No Electron, DOM, Node built-ins, DB,
 *     filesystem, network, or transport IO of any kind.
 *   - Builders perform NO database IO and NO financial recomputation. Tax
 *     components, totals and payment amounts arrive as printed truth inside
 *     {@link PrintData}; builders only apply presence/show decisions.
 *   - Labels are carried as concept references plus already-resolved strings
 *     (resolved through the injected {@link PrintContext.resolveLabel}
 *     catalog lookup) or explicit bilingual pairs — never pre-concatenated
 *     `"A / B"` strings.
 *   - Every block carries its resolved base direction; embedded values are
 *     annotated via the direction kernel so LTR islands (invoice numbers,
 *     phone numbers, amounts) stay distinguishable inside RTL documents.
 *
 * First consumer: the classic thermal receipt rendered through the backend
 * preview pipeline (#442). Merchant template schemas (#447/#448) and other
 * renderers adopt this model in later issues; schema documentation is owned
 * by #449.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DELIVERY_SLIP_NOTE_CHARS = void 0;
exports.bilingualLabel = bilingualLabel;
exports.directionalText = directionalText;
exports.getBlock = getBlock;
exports.optionalPaymentAmount = optionalPaymentAmount;
exports.projectCashTender = projectCashTender;
exports.paymentDisplayRows = paymentDisplayRows;
exports.buildBillDocument = buildBillDocument;
exports.isKotItemPending = isKotItemPending;
exports.shouldShowCustomerNumber = shouldShowCustomerNumber;
exports.clampDeliverySlipText = clampDeliverySlipText;
exports.sanitizeDeliverySlipPaymentMethod = sanitizeDeliverySlipPaymentMethod;
exports.deliverySlipExpectedPaymentText = deliverySlipExpectedPaymentText;
exports.resolveDeliverySlipPaymentSummary = resolveDeliverySlipPaymentSummary;
exports.isPrintDocument = isPrintDocument;
exports.isKotDocument = isKotDocument;
exports.buildKotDocument = buildKotDocument;
exports.isDeliverySlipDocument = isDeliverySlipDocument;
exports.buildDeliverySlipDocument = buildDeliverySlipDocument;
const direction_1 = require("./direction");
const width_1 = require("./width");
/** Build a {@link SemanticLabel} from an explicit bilingual pair. */
function bilingualLabel(text, conceptId) {
    return Object.freeze({
        ...(conceptId !== undefined ? { conceptId } : {}),
        ...(text.secondary !== undefined ? { secondary: text.secondary } : {}),
        primary: text.primary,
    });
}
/** Annotate `text` with its value-scope direction for a document base direction. */
function directionalText(text, base) {
    return Object.freeze({ text, direction: (0, direction_1.resolveValueDirection)(text, base) });
}
/** Typed accessor for one block kind within a document. */
function getBlock(document, kind) {
    return document.blocks.find((block) => block.kind === kind);
}
/** Concept ids for known payment methods; unknown methods stay literal. */
const PAYMENT_METHOD_CONCEPTS = Object.freeze({
    cash: 'pos.methodCash',
    card: 'pos.methodCard',
    upi: 'pos.methodUpi',
    wallet: 'pos.methodWallet',
});
const KOT_ORDER_TYPE_CONCEPTS = Object.freeze({
    dine_in: 'pos.orderTypeDineIn',
    delivery: 'pos.orderTypeDelivery',
    online: 'pos.orderTypeOnline',
    takeaway: 'pos.orderTypeTakeaway',
});
function resolveSemanticLabel(labels, conceptId) {
    return Object.freeze({
        conceptId,
        primary: labels.ctx.resolveLabel(conceptId, labels.primary),
        ...(labels.secondary !== undefined
            ? { secondary: labels.ctx.resolveLabel(conceptId, labels.secondary) }
            : {}),
    });
}
function literalLabel(primary) {
    return Object.freeze({ primary });
}
function paymentLabel(labels, method) {
    const conceptId = PAYMENT_METHOD_CONCEPTS[method.toLowerCase()];
    return conceptId !== undefined ? resolveSemanticLabel(labels, conceptId) : literalLabel(method);
}
function kotOrderTypeValue(labels, value) {
    const conceptId = KOT_ORDER_TYPE_CONCEPTS[value];
    if (conceptId === undefined)
        return value.replace(/_/g, ' ').trim().toUpperCase();
    return resolveSemanticLabel(labels, conceptId).primary;
}
function toTruncatedCount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}
function optionalDirectional(text, base) {
    if (text === undefined || text === null || String(text).length === 0)
        return null;
    return directionalText(String(text), base);
}
function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
/** Coerce a persisted optional payment amount; absent or invalid values stay undefined. */
function optionalPaymentAmount(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '')
        return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}
/**
 * Project the optional tender fields of one cash payment. Rows print only when
 * the tender exceeded the applied amount or the persisted change is positive,
 * so exact payments and legacy records without the optional fields keep their
 * existing output and never show derived change.
 */
function projectCashTender(payment) {
    if (payment.method.toLowerCase() !== 'cash')
        return null;
    const tendered = optionalPaymentAmount(payment.tendered);
    const change = optionalPaymentAmount(payment.change);
    const overTendered = tendered !== undefined && tendered > payment.amount;
    const positiveChange = change !== undefined && change > 0 ? change : 0;
    if (!overTendered && positiveChange === 0)
        return null;
    return { tendered: tendered ?? payment.amount, change: positiveChange };
}
/**
 * Rows to print for one payment line: the applied amount first, then the
 * cash-received and change rows when the payment projects them. Every
 * renderer walks this list so the row order stays identical across surfaces.
 */
function paymentDisplayRows(line) {
    return [
        { label: line.label, amount: line.amount },
        ...(line.tendered ? [line.tendered] : []),
        ...(line.change ? [line.change] : []),
    ];
}
/**
 * Build a PrintDocument v1 from normalized print data. Pure: reads only its
 * arguments; performs no IO and no financial recomputation (totals, taxes
 * and payments are copied verbatim from `printData.bill`).
 */
function buildBillDocument(printData, printContext) {
    const { bill, order, business } = printData;
    const base = printContext.baseDirection;
    const labels = {
        ctx: printContext,
        primary: printContext.languages[0],
        ...(printContext.languages.length > 1 ? { secondary: printContext.languages[1] } : {}),
    };
    const taxComponents = bill.taxComponents.filter((component) => toFiniteNumber(component.amount) !== 0);
    const hasTax = toFiniteNumber(bill.taxAmount) !== 0 || taxComponents.length > 0;
    const showBreakdown = business.showTaxBreakdown && taxComponents.length > 0;
    const showTaxIdLine = business.taxRegistrationNumber.length > 0 &&
        (business.showTaxId === 'force' || (business.showTaxId === 'auto' && hasTax));
    const header = Object.freeze({
        kind: 'business-header',
        direction: base,
        logo: business.showLogo && business.receiptLogo ? business.receiptLogo : null,
        logoRaster: business.showLogo && business.receiptLogoRaster ? business.receiptLogoRaster : null,
        name: business.showName ? optionalDirectional(business.name, base) : null,
        address: business.showAddress ? optionalDirectional(business.address, base) : null,
        phone: business.showPhone ? optionalDirectional(business.phone, base) : null,
        instagramHandle: optionalDirectional(business.instagramHandle, base),
        taxId: showTaxIdLine
            ? Object.freeze({
                label: literalLabel(business.taxIdLabel.length > 0 ? business.taxIdLabel : 'Tax ID'),
                value: directionalText(business.taxRegistrationNumber, base),
            })
            : null,
        phoneLabel: business.showPhone && business.phone.length > 0
            ? resolveSemanticLabel(labels, 'receipt.phone')
            : null,
    });
    const meta = Object.freeze({
        kind: 'document-meta',
        direction: base,
        title: resolveSemanticLabel(labels, hasTax ? 'print.taxInvoiceTitle' : 'print.invoiceTitle'),
        invoiceNumberLabel: resolveSemanticLabel(labels, 'print.invoiceNumber'),
        billNumberLabel: resolveSemanticLabel(labels, 'receipt.billNumber'),
        dateLabel: resolveSemanticLabel(labels, 'receipt.date'),
        invoiceNumber: directionalText(bill.billNumber.length > 0 ? bill.billNumber : order.orderNumber, base),
        timestamp: directionalText(order.createdAt, base),
        table: business.showTableNumber && order.tableName.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.tableLabel'),
                name: directionalText(order.tableName, base),
            })
            : null,
    });
    // A delivery address is what makes this a customer-details block, so it drives the heading too.
    const deliveryAddress = order.deliveryAddress.trim();
    const customer = Object.freeze({
        kind: 'customer',
        direction: base,
        heading: deliveryAddress.length > 0 ? resolveSemanticLabel(labels, 'print.customerDetails') : null,
        name: business.showCustomerName ? optionalDirectional(business.customerName, base) : null,
        phone: business.showCustomerPhone ? optionalDirectional(business.customerPhone, base) : null,
        address: deliveryAddress.length > 0 ? directionalText(deliveryAddress, base) : null,
        nameLabel: resolveSemanticLabel(labels, 'pos.customer'),
        phoneLabel: resolveSemanticLabel(labels, 'print.numberShort'),
        addressLabel: resolveSemanticLabel(labels, 'print.deliverySlip.address'),
    });
    const items = Object.freeze({
        kind: 'item-table',
        direction: base,
        header: Object.freeze({
            item: resolveSemanticLabel(labels, 'receipt.item'),
            quantity: resolveSemanticLabel(labels, 'receipt.qty'),
            rate: resolveSemanticLabel(labels, 'receipt.rate'),
            amount: resolveSemanticLabel(labels, 'receipt.amount'),
        }),
        noteLabel: resolveSemanticLabel(labels, 'print.note'),
        rows: Object.freeze(order.items.map((item) => Object.freeze({
            direction: base,
            name: directionalText(item.productName, base),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.total,
            addons: Object.freeze(item.addons.map((addon) => Object.freeze({
                name: directionalText(addon.name, base),
                price: addon.price,
                quantity: addon.quantity,
            }))),
            specialInstructions: optionalDirectional(item.specialInstructions, base),
        }))),
    });
    const breakdown = Object.freeze({
        kind: 'tax-breakdown',
        direction: base,
        heading: resolveSemanticLabel(labels, 'receipt.taxDetails'),
        lines: Object.freeze((showBreakdown ? taxComponents : []).map((component) => Object.freeze({
            label: literalLabel(component.title),
            rate: component.rate,
            amount: component.amount,
        }))),
    });
    const totals = Object.freeze({
        kind: 'totals',
        direction: base,
        subtotal: Object.freeze({
            label: resolveSemanticLabel(labels, 'pos.subtotal'),
            amount: bill.subtotal,
        }),
        discount: bill.discountAmount > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.discount'),
                amount: bill.discountAmount,
            })
            : null,
        tax: !showBreakdown && toFiniteNumber(bill.taxAmount) !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.tax'),
                amount: bill.taxAmount,
            })
            : null,
        serviceCharge: toFiniteNumber(bill.serviceCharge) !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'receipt.serviceCharge'),
                amount: toFiniteNumber(bill.serviceCharge),
            })
            : null,
        deliveryCharge: toFiniteNumber(bill.deliveryCharge) !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.delivery'),
                amount: toFiniteNumber(bill.deliveryCharge),
            })
            : null,
        packagingCharge: toFiniteNumber(bill.packagingCharge) !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.packaging'),
                amount: toFiniteNumber(bill.packagingCharge),
            })
            : null,
        chargesBreakdown: typeof bill.chargesBreakdown === 'string' ? bill.chargesBreakdown : null,
        grandTotal: Object.freeze({
            label: resolveSemanticLabel(labels, 'print.grandTotal'),
            amount: bill.total,
        }),
        pointsRedeemed: bill.pointsRedeemed > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.pointsRedeemed'),
                points: bill.pointsRedeemed,
            })
            : null,
        pointsEarned: bill.pointsEarned > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.pointsEarned'),
                points: bill.pointsEarned,
            })
            : null,
        pointsBalance: bill.pointsBalance !== null && bill.pointsBalance !== 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.pointsBalance'),
                points: bill.pointsBalance,
            })
            : null,
    });
    const payments = Object.freeze({
        kind: 'payments',
        direction: base,
        heading: resolveSemanticLabel(labels, 'receipt.payments'),
        lines: Object.freeze(bill.payments
            .filter((payment) => payment.method.length > 0)
            .map((payment) => {
            const line = {
                method: payment.method,
                label: paymentLabel(labels, payment.method),
                amount: payment.amount,
            };
            const tender = projectCashTender(payment);
            if (tender === null)
                return Object.freeze(line);
            return Object.freeze({
                ...line,
                tendered: Object.freeze({
                    label: resolveSemanticLabel(labels, 'receipt.cashReceived'),
                    amount: tender.tendered,
                }),
                ...(tender.change > 0
                    ? {
                        change: Object.freeze({
                            label: resolveSemanticLabel(labels, 'pos.changeReturned'),
                            amount: tender.change,
                        }),
                    }
                    : {}),
            });
        })),
    });
    const hasOnlineOrderInfo = order.onlinePlatform.length > 0 || order.externalOrderId.length > 0;
    const messages = Object.freeze({
        kind: 'message',
        direction: base,
        reprintBanner: printData.isReprint ? resolveSemanticLabel(labels, 'receipt.reprint') : null,
        onlineOrderBanner: hasOnlineOrderInfo
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'receipt.onlineOrder'),
                platform: directionalText(order.onlinePlatform, base),
                externalOrderId: directionalText(order.externalOrderId, base),
            })
            : null,
        footerNote: business.footerNote.length > 0 ? directionalText(business.footerNote, base) : null,
        thankYou: resolveSemanticLabel(labels, 'print.thankYouShort'),
        taxIncluded: resolveSemanticLabel(labels, 'receipt.taxIncluded'),
    });
    return Object.freeze({
        version: 1,
        direction: (0, direction_1.resolveDirectionSpec)(base),
        languages: printContext.languages,
        blocks: Object.freeze([
            header,
            customer,
            meta,
            items,
            totals,
            breakdown,
            payments,
            messages,
        ]),
    });
}
// ---------------------------------------------------------------------------
// KOT document variant (kitchen order ticket) — #443
// ---------------------------------------------------------------------------
/** Whether an order item belongs on a new kitchen ticket. */
function isKotItemPending(status) {
    return status !== 'served' && status !== 'ready';
}
function shouldShowCustomerNumber(visibility) {
    if (visibility.showOnReceipts)
        return true;
    return visibility.alwaysForDeliveryOrders && visibility.orderType.trim() === 'delivery';
}
/**
 * The order note is bounded on the way in by `max_order_notes_length` (a tenant
 * setting, 200 by default), so a raised setting or a legacy row can carry more than
 * a slip should spend. The address clamps for the same reason: an unbounded field
 * turns a courier sheet into a roll, and text that ends without saying so reads as
 * the whole instruction.
 *
 * Declared here, not in a renderer, because the slip renders three ways — the
 * backend ESC/POS pipeline, the browser WebUSB encoder, and the browser web-print
 * fragment. All three import this number, so a merchant gets the same courier sheet
 * whichever printer they own.
 */
exports.MAX_DELIVERY_SLIP_NOTE_CHARS = 200;
/**
 * Clamp free text to a print budget, walking whole grapheme clusters so a cut never
 * lands inside a surrogate pair or a combining sequence.
 *
 * This lives beside the budget rather than in a renderer because the slip has three
 * of them. When each clamped for itself they disagreed: the backend counted UTF-16
 * units, the browser paths counted code points, and any note containing an emoji
 * printed twice as long on the browser while a truncation marker claimed otherwise.
 * The number and the algorithm that applies it have to travel together.
 */
function clampDeliverySlipText(text, maxChars = exports.MAX_DELIVERY_SLIP_NOTE_CHARS) {
    if (text.length <= maxChars)
        return { text, truncatedChars: 0 };
    const kept = [];
    let units = 0;
    for (const cluster of (0, width_1.graphemeSegments)(text)) {
        const size = cluster.length;
        if (units + size > maxChars)
            break;
        kept.push(cluster);
        units += size;
    }
    const keptText = kept.join('');
    return { text: keptText, truncatedChars: text.length - keptText.length };
}
/** Keep custom payment names bounded and safe for printer command parsers. */
function sanitizeDeliverySlipPaymentMethod(value) {
    if (typeof value !== 'string')
        return '';
    return value
        .replace(/[\u0000-\u001f\u007f{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
}
/**
 * Expected collection method for an unpaid balance, rendered identically across all slip paths.
 */
function deliverySlipExpectedPaymentText(expectedMethod, resolveLabel, expectedMethodIsCustom = false) {
    const method = sanitizeDeliverySlipPaymentMethod(expectedMethod);
    // A configured method named "Pending" or "Unknown" was recorded as its own
    // identity, so its historical name prints literally instead of collapsing
    // into the localized sentinel for that word.
    if (expectedMethodIsCustom) {
        return `${resolveLabel('print.deliverySlip.expectedPayment')}: ${method || resolveLabel('common.unknown')}`;
    }
    const normalized = method.toLowerCase();
    if (normalized === 'cash')
        return resolveLabel('print.deliverySlip.cashOnDelivery');
    const methodConcept = PAYMENT_METHOD_CONCEPTS[normalized];
    const value = !method
        ? resolveLabel('common.unknown')
        : normalized === 'pending'
            ? resolveLabel('orders.pending')
            : methodConcept !== undefined
                ? resolveLabel(methodConcept)
                : method;
    return `${resolveLabel('print.deliverySlip.expectedPayment')}: ${value}`;
}
function resolveDeliverySlipPaymentSummary(orderTotal, billOrBills, minorUnitFactor = 100) {
    const bills = Array.isArray(billOrBills) ? billOrBills : billOrBills ? [billOrBills] : [];
    const factor = Number.isSafeInteger(minorUnitFactor) && minorUnitFactor > 0 ? minorUnitFactor : 100;
    const closedStatuses = new Set(['paid', 'refunded', 'partially_refunded']);
    const refundBills = bills.filter((bill) => bill.payment_status === 'refunded' || bill.payment_status === 'partially_refunded');
    const allPaid = bills.length > 0 && bills.every((bill) => bill.payment_status === 'paid');
    const allRefunded = bills.length > 0 && bills.every((bill) => bill.payment_status === 'refunded');
    const toMinorUnits = (value) => {
        const amount = optionalPaymentAmount(value);
        return amount === undefined || amount < 0 ? undefined : Math.round(amount * factor);
    };
    const sumAmounts = (values) => {
        const minors = values.map(toMinorUnits);
        return minors.some((amount) => amount === undefined)
            ? undefined
            : minors.reduce((sum, amount) => sum + amount, 0) / factor;
    };
    const balances = bills.map((bill) => {
        const paymentStatus = String(bill.payment_status ?? '');
        return (bill.balance ??
            (closedStatuses.has(paymentStatus) ? 0 : bills.length === 1 ? orderTotal : undefined));
    });
    const orderTotalMinorUnits = bills.length === 0 ? toMinorUnits(orderTotal) : undefined;
    const amountDue = bills.length > 0
        ? sumAmounts(balances)
        : orderTotalMinorUnits === undefined
            ? undefined
            : orderTotalMinorUnits / factor;
    let status;
    let paymentAmount;
    if (allRefunded) {
        status = 'refunded';
        paymentAmount = 0;
    }
    else if (refundBills.length > 0) {
        status = 'partially_refunded';
        paymentAmount = 0;
    }
    else if (allPaid) {
        status = 'paid';
        paymentAmount = sumAmounts(bills.map((bill) => bill.total ?? (bills.length === 1 ? orderTotal : undefined)));
    }
    else {
        status = 'unpaid';
        paymentAmount = amountDue;
    }
    if (paymentAmount === undefined || paymentAmount < 0 || amountDue === undefined)
        return undefined;
    const paymentMethods = [];
    if (status === 'paid') {
        for (const bill of bills) {
            const existingMethodCount = paymentMethods.length;
            let paymentDetails = bill.payment_details;
            if (typeof paymentDetails === 'string') {
                try {
                    paymentDetails = JSON.parse(paymentDetails);
                }
                catch {
                    paymentDetails = null;
                }
            }
            const paymentLines = Array.isArray(paymentDetails)
                ? paymentDetails
                : paymentDetails && typeof paymentDetails === 'object'
                    ? [paymentDetails]
                    : [];
            for (const line of paymentLines) {
                if (!line || typeof line !== 'object')
                    continue;
                const method = sanitizeDeliverySlipPaymentMethod(line.method);
                if (method &&
                    !paymentMethods.some((existing) => existing.toLowerCase() === method.toLowerCase())) {
                    paymentMethods.push(method);
                }
            }
            const billMethod = sanitizeDeliverySlipPaymentMethod(bill.payment_method);
            if (paymentMethods.length === existingMethodCount &&
                billMethod &&
                !paymentMethods.some((existing) => existing.toLowerCase() === billMethod.toLowerCase())) {
                paymentMethods.push(billMethod);
            }
        }
    }
    return Object.freeze({
        status,
        ...(status === 'paid' && paymentMethods.length > 1
            ? { methods: Object.freeze(paymentMethods) }
            : status === 'paid' && paymentMethods.length === 1
                ? { method: paymentMethods[0] }
                : {}),
        amount: paymentAmount,
        amountDue,
    });
}
function isRecord(value) {
    return !!value && typeof value === 'object';
}
function isDirection(value) {
    return value === 'ltr' || value === 'rtl';
}
function isDirectionSpec(value) {
    return (isRecord(value) &&
        isDirection(value.base) &&
        isDirection(value.document) &&
        isDirection(value.block) &&
        isDirection(value.value));
}
function isLanguages(value) {
    return (Array.isArray(value) &&
        (value.length === 1 || value.length === 2) &&
        value.every((language) => typeof language === 'string' && language.length > 0));
}
function isSemanticLabel(value) {
    return (isRecord(value) &&
        typeof value.primary === 'string' &&
        (value.conceptId === undefined || typeof value.conceptId === 'string') &&
        (value.secondary === undefined || typeof value.secondary === 'string'));
}
function isDirectionalText(value) {
    return isRecord(value) && typeof value.text === 'string' && isDirection(value.direction);
}
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isOptionalDirectionalText(value) {
    return value === null || isDirectionalText(value);
}
function isPrintDocumentBlock(value) {
    if (!isRecord(value) || !isDirection(value.direction) || typeof value.kind !== 'string')
        return false;
    switch (value.kind) {
        case 'business-header':
            return (isOptionalDirectionalText(value.name) &&
                isOptionalDirectionalText(value.address) &&
                isOptionalDirectionalText(value.phone) &&
                isOptionalDirectionalText(value.instagramHandle) &&
                (value.taxId === null ||
                    (isRecord(value.taxId) &&
                        isSemanticLabel(value.taxId.label) &&
                        isDirectionalText(value.taxId.value))) &&
                (value.phoneLabel === null || isSemanticLabel(value.phoneLabel)));
        case 'document-meta':
            return (isSemanticLabel(value.title) &&
                isSemanticLabel(value.invoiceNumberLabel) &&
                isSemanticLabel(value.billNumberLabel) &&
                isSemanticLabel(value.dateLabel) &&
                isDirectionalText(value.invoiceNumber) &&
                isDirectionalText(value.timestamp) &&
                (value.table === null ||
                    (isRecord(value.table) &&
                        isSemanticLabel(value.table.label) &&
                        isDirectionalText(value.table.name))));
        case 'customer':
            return ((value.heading === null || isSemanticLabel(value.heading)) &&
                isOptionalDirectionalText(value.name) &&
                isOptionalDirectionalText(value.phone) &&
                isOptionalDirectionalText(value.address) &&
                isSemanticLabel(value.nameLabel) &&
                isSemanticLabel(value.phoneLabel) &&
                isSemanticLabel(value.addressLabel));
        case 'item-table':
            return (isRecord(value.header) &&
                isSemanticLabel(value.header.item) &&
                isSemanticLabel(value.header.quantity) &&
                isSemanticLabel(value.header.rate) &&
                isSemanticLabel(value.header.amount) &&
                isSemanticLabel(value.noteLabel) &&
                Array.isArray(value.rows) &&
                value.rows.every((row) => isRecord(row) &&
                    isDirection(row.direction) &&
                    isDirectionalText(row.name) &&
                    isFiniteNumber(row.quantity) &&
                    (row.unitPrice === undefined || isFiniteNumber(row.unitPrice)) &&
                    isFiniteNumber(row.amount) &&
                    Array.isArray(row.addons) &&
                    row.addons.every((addon) => isRecord(addon) &&
                        isDirectionalText(addon.name) &&
                        isFiniteNumber(addon.price) &&
                        (addon.quantity === undefined || isFiniteNumber(addon.quantity))) &&
                    isOptionalDirectionalText(row.specialInstructions)));
        case 'tax-breakdown':
            return (isSemanticLabel(value.heading) &&
                Array.isArray(value.lines) &&
                value.lines.every((line) => isRecord(line) &&
                    isSemanticLabel(line.label) &&
                    (line.rate === null || isFiniteNumber(line.rate)) &&
                    isFiniteNumber(line.amount)));
        case 'totals':
            return (['subtotal', 'grandTotal'].every((key) => isRecord(value[key]) &&
                isSemanticLabel(value[key].label) &&
                isFiniteNumber(value[key].amount)) &&
                ['discount', 'tax', 'serviceCharge', 'deliveryCharge', 'packagingCharge'].every((key) => value[key] === null ||
                    (isRecord(value[key]) &&
                        isSemanticLabel(value[key].label) &&
                        isFiniteNumber(value[key].amount))) &&
                (value.chargesBreakdown === null || typeof value.chargesBreakdown === 'string') &&
                ['pointsRedeemed', 'pointsEarned', 'pointsBalance'].every((key) => value[key] === null ||
                    (isRecord(value[key]) &&
                        isSemanticLabel(value[key].label) &&
                        isFiniteNumber(value[key].points))));
        case 'payments':
            return (isSemanticLabel(value.heading) &&
                Array.isArray(value.lines) &&
                value.lines.every((line) => isRecord(line) &&
                    typeof line.method === 'string' &&
                    isSemanticLabel(line.label) &&
                    isFiniteNumber(line.amount) &&
                    (line.tendered === undefined ||
                        (isRecord(line.tendered) &&
                            isSemanticLabel(line.tendered.label) &&
                            isFiniteNumber(line.tendered.amount))) &&
                    (line.change === undefined ||
                        (isRecord(line.change) &&
                            isSemanticLabel(line.change.label) &&
                            isFiniteNumber(line.change.amount)))));
        case 'message':
            return ((value.reprintBanner === null || isSemanticLabel(value.reprintBanner)) &&
                (value.onlineOrderBanner === null ||
                    (isRecord(value.onlineOrderBanner) &&
                        isSemanticLabel(value.onlineOrderBanner.label) &&
                        isDirectionalText(value.onlineOrderBanner.platform) &&
                        isDirectionalText(value.onlineOrderBanner.externalOrderId))) &&
                isOptionalDirectionalText(value.footerNote) &&
                (value.thankYou === null || isSemanticLabel(value.thankYou)) &&
                isSemanticLabel(value.taxIncluded));
        default:
            return false;
    }
}
function isPrintDocument(value) {
    const blockKinds = new Set([
        'business-header',
        'document-meta',
        'customer',
        'item-table',
        'tax-breakdown',
        'totals',
        'payments',
        'message',
    ]);
    return (isRecord(value) &&
        value.version === 1 &&
        isDirectionSpec(value.direction) &&
        isLanguages(value.languages) &&
        Array.isArray(value.blocks) &&
        value.blocks.length === blockKinds.size &&
        value.blocks.every(isPrintDocumentBlock) &&
        value.blocks.every((block) => isRecord(block) && blockKinds.has(block.kind)) &&
        new Set(value.blocks.map((block) => (isRecord(block) ? block.kind : undefined))).size ===
            value.blocks.length);
}
function isKotDocumentBlock(value) {
    if (!isRecord(value) || !isDirection(value.direction) || typeof value.kind !== 'string')
        return false;
    if (value.kind === 'kot-header') {
        return (isSemanticLabel(value.banner) &&
            isSemanticLabel(value.stationLabel) &&
            isDirectionalText(value.stationName) &&
            isSemanticLabel(value.orderNumberLabel) &&
            isDirectionalText(value.orderNumber) &&
            (value.table === null ||
                (isRecord(value.table) &&
                    isSemanticLabel(value.table.label) &&
                    isDirectionalText(value.table.name))) &&
            (value.orderType === null ||
                (isRecord(value.orderType) &&
                    isSemanticLabel(value.orderType.label) &&
                    isDirectionalText(value.orderType.value) &&
                    typeof value.orderType.code === 'string')) &&
            (value.customer === null ||
                (isRecord(value.customer) &&
                    isSemanticLabel(value.customer.label) &&
                    isDirectionalText(value.customer.name))) &&
            isSemanticLabel(value.timeLabel) &&
            isDirectionalText(value.timestamp) &&
            (value.orderNotes === undefined ||
                value.orderNotes === null ||
                (isRecord(value.orderNotes) &&
                    isSemanticLabel(value.orderNotes.label) &&
                    isDirectionalText(value.orderNotes.text))));
    }
    if (value.kind !== 'kot-items' || !Array.isArray(value.rows))
        return false;
    return value.rows.every((row) => isRecord(row) &&
        isFiniteNumber(row.quantity) &&
        isDirectionalText(row.name) &&
        Array.isArray(row.addons) &&
        row.addons.every((addon) => isRecord(addon) &&
            isDirectionalText(addon) &&
            (addon.quantity === undefined || isFiniteNumber(addon.quantity))) &&
        isOptionalDirectionalText(row.specialInstructions));
}
function isKotDocument(value) {
    return (isRecord(value) &&
        value.version === 1 &&
        isDirectionSpec(value.direction) &&
        isLanguages(value.languages) &&
        value.languages.length === 1 &&
        Array.isArray(value.blocks) &&
        value.blocks.length === 2 &&
        isRecord(value.blocks[0]) &&
        value.blocks[0].kind === 'kot-header' &&
        isRecord(value.blocks[1]) &&
        value.blocks[1].kind === 'kot-items' &&
        value.blocks.filter((block) => isRecord(block) && block.kind === 'kot-header').length === 1 &&
        value.blocks.filter((block) => isRecord(block) && block.kind === 'kot-items').length === 1 &&
        value.blocks.every(isKotDocumentBlock));
}
/**
 * Build a KotDocument v1 from normalized kitchen-ticket data. Pure: reads
 * only its arguments and performs no IO or recomputation.
 */
function buildKotDocument(printData, printContext) {
    const base = printContext.baseDirection;
    const primary = printContext.languages[0];
    const labels = { ctx: printContext, primary };
    const header = Object.freeze({
        kind: 'kot-header',
        direction: base,
        banner: resolveSemanticLabel(labels, 'print.kot.banner'),
        stationLabel: resolveSemanticLabel(labels, 'print.kot.station'),
        stationName: directionalText(String(printData.stationName ?? ''), base),
        orderNumberLabel: resolveSemanticLabel(labels, 'pos.orderNumber'),
        orderNumber: directionalText(String(printData.order?.orderNumber ?? ''), base),
        table: typeof printData.order?.tableName === 'string' && printData.order.tableName.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.tableLabel'),
                name: directionalText(printData.order.tableName, base),
            })
            : null,
        orderType: typeof printData.order?.orderType === 'string' && printData.order.orderType.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.kot.type'),
                value: directionalText(kotOrderTypeValue(labels, printData.order.orderType), base),
                code: printData.order.orderType,
            })
            : null,
        customer: typeof printData.order?.customerName === 'string' && printData.order.customerName.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'pos.customer'),
                name: directionalText(printData.order.customerName, base),
            })
            : null,
        timeLabel: resolveSemanticLabel(labels, 'print.time'),
        timestamp: directionalText(String(printData.order?.createdAt ?? ''), base),
        orderNotes: typeof printData.order?.orderNotes === 'string' &&
            printData.order.orderNotes.trim().length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.note'),
                text: directionalText(printData.order.orderNotes.trim(), base),
            })
            : null,
    });
    const items = Object.freeze({
        kind: 'kot-items',
        direction: base,
        rows: Object.freeze((Array.isArray(printData.items) ? printData.items : []).map((item) => Object.freeze({
            quantity: Number(item?.quantity) || 0,
            name: directionalText(String(item?.productName ?? ''), base),
            addons: Object.freeze((item?.addons ?? new Array())
                .filter((addon) => typeof addon?.name === 'string' && addon.name.length > 0)
                .map((addon) => Object.freeze({
                ...directionalText(String(addon.name), base),
                ...(typeof addon.quantity === 'number' &&
                    Number.isFinite(addon.quantity) &&
                    addon.quantity > 0
                    ? { quantity: addon.quantity }
                    : {}),
            }))),
            specialInstructions: optionalDirectional(item?.specialInstructions, base),
        }))),
    });
    return Object.freeze({
        version: 1,
        direction: (0, direction_1.resolveDirectionSpec)(base),
        languages: printContext.languages,
        blocks: Object.freeze([header, items]),
    });
}
function isDeliverySlipDocumentBlock(value) {
    if (!isRecord(value) || !isDirection(value.direction) || typeof value.kind !== 'string')
        return false;
    if (value.kind === 'delivery-slip-contact') {
        return ((value.name === null || isDirectionalText(value.name)) &&
            (value.phone === null || isDirectionalText(value.phone)) &&
            (value.address === null || isDirectionalText(value.address)) &&
            (value.addressSource === null ||
                value.addressSource === 'order' ||
                value.addressSource === 'customer') &&
            isFiniteNumber(value.addressTruncatedChars) &&
            isSemanticLabel(value.nameLabel) &&
            isSemanticLabel(value.phoneLabel) &&
            isSemanticLabel(value.addressLabel));
    }
    if (value.kind === 'delivery-slip-header') {
        return (isSemanticLabel(value.banner) &&
            isSemanticLabel(value.title) &&
            isSemanticLabel(value.orderNumberLabel) &&
            isDirectionalText(value.orderNumber) &&
            (value.orderType === null ||
                (isRecord(value.orderType) &&
                    isSemanticLabel(value.orderType.label) &&
                    isDirectionalText(value.orderType.value) &&
                    typeof value.orderType.code === 'string')) &&
            isSemanticLabel(value.timeLabel) &&
            isDirectionalText(value.timestamp));
    }
    if (value.kind === 'delivery-slip-notes') {
        return (isOptionalDirectionalText(value.note) &&
            isSemanticLabel(value.label) &&
            isFiniteNumber(value.noteTruncatedChars) &&
            isOptionalDirectionalText(value.deliveryNote) &&
            isSemanticLabel(value.deliveryNoteLabel) &&
            isFiniteNumber(value.deliveryNoteTruncatedChars));
    }
    if (value.kind === 'delivery-slip-payment') {
        return ((value.status === 'paid' ||
            value.status === 'unpaid' ||
            value.status === 'refunded' ||
            value.status === 'partially_refunded') &&
            isSemanticLabel(value.label) &&
            (value.methodLabel === undefined || isSemanticLabel(value.methodLabel)) &&
            (value.methodName === undefined || isDirectionalText(value.methodName)) &&
            isDirectionalText(value.amountText) &&
            (value.detailsText === undefined || isDirectionalText(value.detailsText)));
    }
    if (value.kind !== 'delivery-slip-items' || !Array.isArray(value.rows))
        return false;
    return value.rows.every((row) => isRecord(row) &&
        isDirectionalText(row.name) &&
        isFiniteNumber(row.quantity) &&
        Array.isArray(row.addons) &&
        row.addons.every((addon) => isRecord(addon) &&
            isDirectionalText(addon) &&
            (addon.quantity === undefined || isFiniteNumber(addon.quantity))) &&
        isOptionalDirectionalText(row.specialInstructions));
}
function isDeliverySlipDocument(value) {
    if (!isRecord(value) ||
        value.version !== 1 ||
        !isDirectionSpec(value.direction) ||
        !isLanguages(value.languages) ||
        value.languages.length !== 1 ||
        !Array.isArray(value.blocks) ||
        !value.blocks.every(isDeliverySlipDocumentBlock))
        return false;
    // Header first, exactly one contact, optional notes and payment, items last.
    const kinds = value.blocks.map((block) => block.kind);
    const count = (kind) => kinds.filter((entry) => entry === kind).length;
    const at = (kind) => kinds.indexOf(kind);
    if (count('delivery-slip-header') !== 1 ||
        count('delivery-slip-contact') !== 1 ||
        count('delivery-slip-items') !== 1) {
        return false;
    }
    if (count('delivery-slip-notes') > 1)
        return false;
    if (count('delivery-slip-payment') > 1)
        return false;
    if (at('delivery-slip-header') !== 0 || at('delivery-slip-items') !== kinds.length - 1)
        return false;
    if (at('delivery-slip-contact') > at('delivery-slip-items'))
        return false;
    const notesAt = at('delivery-slip-notes');
    const paymentAt = at('delivery-slip-payment');
    if (notesAt !== -1 &&
        !(at('delivery-slip-contact') < notesAt && notesAt < at('delivery-slip-items')))
        return false;
    if (paymentAt !== -1 &&
        !(at('delivery-slip-contact') < paymentAt && paymentAt < at('delivery-slip-items')))
        return false;
    return notesAt === -1 || paymentAt === -1 || notesAt < paymentAt;
}
function buildDeliverySlipDocument(printData, printContext) {
    const base = printContext.baseDirection;
    const labels = { ctx: printContext, primary: printContext.languages[0] };
    const orderTypeCode = String(printData.order?.orderType ?? '').trim();
    const header = Object.freeze({
        kind: 'delivery-slip-header',
        direction: base,
        banner: resolveSemanticLabel(labels, 'print.deliverySlip.banner'),
        title: resolveSemanticLabel(labels, 'print.deliverySlip.title'),
        orderNumberLabel: resolveSemanticLabel(labels, 'pos.orderNumber'),
        orderNumber: directionalText(String(printData.order?.orderNumber ?? ''), base),
        orderType: orderTypeCode.length > 0
            ? Object.freeze({
                label: resolveSemanticLabel(labels, 'print.kot.type'),
                value: directionalText(kotOrderTypeValue(labels, orderTypeCode), base),
                code: orderTypeCode,
            })
            : null,
        timeLabel: resolveSemanticLabel(labels, 'print.time'),
        timestamp: directionalText(String(printData.order?.createdAt ?? ''), base),
    });
    const address = String(printData.contact?.address ?? '');
    const contact = Object.freeze({
        kind: 'delivery-slip-contact',
        direction: base,
        name: optionalDirectional(printData.contact?.name, base),
        phone: optionalDirectional(printData.contact?.phone, base),
        address: optionalDirectional(address, base),
        addressSource: address.length > 0 ? (printData.contact?.addressSource ?? 'customer') : null,
        addressTruncatedChars: address.length > 0 ? toTruncatedCount(printData.contact?.addressTruncatedChars) : 0,
        nameLabel: resolveSemanticLabel(labels, 'pos.customer'),
        phoneLabel: resolveSemanticLabel(labels, 'print.numberShort'),
        addressLabel: resolveSemanticLabel(labels, 'print.deliverySlip.address'),
    });
    const note = String(printData.note ?? '').trim();
    const deliveryNote = String(printData.deliveryNote ?? '').trim();
    const notes = Object.freeze({
        kind: 'delivery-slip-notes',
        direction: base,
        note: optionalDirectional(note, base),
        label: resolveSemanticLabel(labels, 'print.note'),
        noteTruncatedChars: toTruncatedCount(printData.noteTruncatedChars),
        deliveryNote: optionalDirectional(deliveryNote, base),
        deliveryNoteLabel: resolveSemanticLabel(labels, 'print.deliverySlip.deliveryNote'),
        deliveryNoteTruncatedChars: toTruncatedCount(printData.deliveryNoteTruncatedChars),
    });
    const paymentData = printData.payment;
    const paymentMethods = (paymentData?.methods ?? [])
        .map(sanitizeDeliverySlipPaymentMethod)
        .filter(Boolean);
    const hasMultiplePaymentMethods = paymentMethods.length > 1;
    const paymentMethod = sanitizeDeliverySlipPaymentMethod(paymentData?.method ?? paymentMethods[0]);
    const paymentStatusLabel = paymentData?.status === 'paid'
        ? 'print.deliverySlip.paid'
        : paymentData?.status === 'refunded'
            ? 'print.deliverySlip.refunded'
            : paymentData?.status === 'partially_refunded'
                ? 'print.deliverySlip.partiallyRefunded'
                : paymentData?.amount === 0
                    ? 'print.deliverySlip.amountDue'
                    : 'print.deliverySlip.toCollect';
    const paymentBlock = paymentData &&
        (paymentData.status === 'paid' ||
            paymentData.status === 'unpaid' ||
            paymentData.status === 'refunded' ||
            paymentData.status === 'partially_refunded') &&
        Number.isFinite(paymentData.amount) &&
        paymentData.amount >= 0 &&
        typeof paymentData.formattedAmount === 'string'
        ? Object.freeze({
            kind: 'delivery-slip-payment',
            direction: base,
            status: paymentData.status,
            label: resolveSemanticLabel(labels, paymentStatusLabel),
            ...(paymentData.status === 'paid' && hasMultiplePaymentMethods
                ? {
                    methodLabel: resolveSemanticLabel(labels, 'print.deliverySlip.multiplePaymentMethods'),
                }
                : paymentData.status === 'paid' && paymentMethod
                    ? { methodLabel: paymentLabel(labels, paymentMethod) }
                    : {}),
            ...(paymentData.status === 'paid' && paymentMethod
                ? { methodName: directionalText(paymentMethod, base) }
                : {}),
            amountText: directionalText(paymentData.status === 'refunded' || paymentData.status === 'partially_refunded'
                ? ''
                : paymentData.formattedAmount, base),
            ...(paymentData.status === 'paid' && typeof paymentData.formattedAmountDue === 'string'
                ? {
                    detailsText: directionalText(`${resolveSemanticLabel(labels, 'print.deliverySlip.amountDue').primary}: ${paymentData.formattedAmountDue}`, base),
                }
                : paymentData.status === 'unpaid' && paymentData.amount > 0
                    ? {
                        detailsText: directionalText(deliverySlipExpectedPaymentText(paymentData.expectedMethod, (conceptId) => resolveSemanticLabel(labels, conceptId).primary, paymentData.expectedMethodIsCustom === true), base),
                    }
                    : paymentData.status === 'refunded' || paymentData.status === 'partially_refunded'
                        ? {
                            detailsText: directionalText(`${resolveSemanticLabel(labels, 'print.deliverySlip.amountDue').primary}: ${paymentData.formattedAmountDue ?? ''}`, base),
                        }
                        : {}),
        })
        : null;
    const items = Object.freeze({
        kind: 'delivery-slip-items',
        direction: base,
        rows: Object.freeze((Array.isArray(printData.items) ? printData.items : []).map((item) => Object.freeze({
            direction: base,
            name: directionalText(String(item?.productName ?? ''), base),
            quantity: Number(item?.quantity) || 0,
            addons: Object.freeze((item?.addons ?? [])
                .filter((addon) => typeof addon?.name === 'string' && addon.name.length > 0)
                .map((addon) => Object.freeze({
                ...directionalText(String(addon.name), base),
                ...(typeof addon.quantity === 'number' &&
                    Number.isFinite(addon.quantity) &&
                    addon.quantity > 0
                    ? { quantity: addon.quantity }
                    : {}),
            }))),
            specialInstructions: optionalDirectional(item?.specialInstructions, base),
        }))),
    });
    const blocks = [header, contact];
    if (note.length > 0 ||
        notes.noteTruncatedChars > 0 ||
        deliveryNote.length > 0 ||
        notes.deliveryNoteTruncatedChars > 0) {
        blocks.push(notes);
    }
    if (paymentBlock)
        blocks.push(paymentBlock);
    blocks.push(items);
    return Object.freeze({
        version: 1,
        direction: (0, direction_1.resolveDirectionSpec)(base),
        languages: printContext.languages,
        blocks: Object.freeze(blocks),
    });
}
//# sourceMappingURL=document.js.map