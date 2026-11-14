"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildZReportDocument = buildZReportDocument;
const document_1 = require("./document");
const direction_1 = require("./direction");
const PAYMENT_METHOD_CONCEPTS = Object.freeze({
    cash: 'pos.methodCash',
    card: 'pos.methodCard',
    upi: 'pos.methodUpi',
    wallet: 'pos.methodWallet',
});
function label(context, conceptId) {
    const primary = context.languages[0];
    const secondary = context.languages[1];
    return Object.freeze({
        conceptId,
        primary: context.resolveLabel(conceptId, primary),
        ...(secondary ? { secondary: context.resolveLabel(conceptId, secondary) } : {}),
    });
}
function literalLabel(value) {
    return Object.freeze({ primary: value });
}
function optionalValue(value, direction) {
    return value.length > 0 ? (0, document_1.directionalText)(value, direction) : null;
}
function paymentLabel(context, method) {
    const concept = PAYMENT_METHOD_CONCEPTS[method.toLowerCase()];
    return concept ? label(context, concept) : literalLabel(method);
}
function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}
/** Build a typed, localized Z-report document from stored closure truth. */
function buildZReportDocument(data, context) {
    const direction = context.baseDirection;
    const periodLabel = (conceptId, value) => Object.freeze({
        label: label(context, conceptId),
        value: (0, document_1.directionalText)(value, direction),
    });
    const paymentRows = data.paymentMethods.map((row) => Object.freeze({
        method: row.method,
        label: paymentLabel(context, row.method),
        countLabel: label(context, 'print.zReport.paymentCount'),
        count: numberOrZero(row.count),
        totalCents: numberOrZero(row.totalCents ?? row.total),
    }));
    const taxRows = data.taxComponents.map((row) => Object.freeze({
        label: literalLabel(String(row.title ?? row.label ?? '')),
        amount: numberOrZero(row.amount),
    }));
    const staffRows = data.staffSales.map((row) => Object.freeze({
        method: String(row.name ?? row.userId ?? ''),
        label: literalLabel(String(row.name ?? row.userId ?? '')),
        countLabel: label(context, 'print.zReport.paymentCount'),
        count: numberOrZero(row.orderCount ?? row.orders),
        totalCents: numberOrZero(row.revenueCents ?? row.revenue),
    }));
    return Object.freeze({
        version: 1,
        direction: (0, direction_1.resolveDirectionSpec)(direction),
        languages: context.languages,
        header: Object.freeze({
            title: label(context, 'print.zReport.title'),
            zNumber: (0, document_1.directionalText)(String(data.zNumber), direction),
            reprintMarker: data.isReprint ? label(context, 'receipt.reprint') : null,
            businessName: optionalValue(data.businessName, direction),
            businessAddress: optionalValue(data.businessAddress, direction),
            taxRegistrationNumber: optionalValue(data.taxRegistrationNumber, direction),
        }),
        period: Object.freeze([
            periodLabel('print.zReport.businessDate', data.businessDate),
            periodLabel('print.zReport.periodStart', data.periodStart),
            periodLabel('print.zReport.periodEnd', data.periodEnd),
        ]),
        openingFloat: Object.freeze({ label: label(context, 'print.zReport.openingFloat'), cents: numberOrZero(data.openingFloatCents) }),
        cashMovements: Object.freeze({
            heading: label(context, 'print.zReport.cashMovements'),
            payIn: Object.freeze({ label: label(context, 'print.zReport.payIn'), cents: numberOrZero(data.payInCents) }),
            payOut: Object.freeze({ label: label(context, 'print.zReport.payOut'), cents: numberOrZero(data.payOutCents) }),
            safeDrop: Object.freeze({ label: label(context, 'print.zReport.safeDrop'), cents: numberOrZero(data.safeDropCents) }),
        }),
        payments: Object.freeze({
            heading: label(context, 'print.zReport.payments'),
            none: label(context, 'print.zReport.none'),
            rows: Object.freeze(paymentRows),
        }),
        refunds: Object.freeze({
            heading: label(context, 'print.zReport.refunds'),
            countLabel: label(context, 'print.zReport.count'),
            count: numberOrZero(data.refundCount),
            totalLabel: label(context, 'print.zReport.amount'),
            totalCents: numberOrZero(data.refundedCents),
        }),
        tax: Object.freeze({
            heading: label(context, 'print.zReport.tax'),
            none: label(context, 'print.zReport.none'),
            rows: Object.freeze(taxRows),
        }),
        staff: Object.freeze({
            heading: label(context, 'print.zReport.staff'),
            none: label(context, 'print.zReport.none'),
            rows: Object.freeze(staffRows),
        }),
        cash: Object.freeze({
            expected: Object.freeze({ label: label(context, 'print.zReport.expectedCash'), cents: numberOrZero(data.expectedCashCents) }),
            counted: Object.freeze({ label: label(context, 'print.zReport.countedCash'), cents: numberOrZero(data.countedCashCents) }),
            variance: Object.freeze({ label: label(context, 'print.zReport.variance'), cents: numberOrZero(data.varianceCents) }),
        }),
        operator: Object.freeze({
            label: label(context, 'print.zReport.closedBy'),
            name: optionalValue(data.closedByName, direction),
            signatureLabel: label(context, 'print.zReport.operatorSignature'),
        }),
        footer: label(context, 'print.zReport.footer'),
    });
}
//# sourceMappingURL=z-report.js.map