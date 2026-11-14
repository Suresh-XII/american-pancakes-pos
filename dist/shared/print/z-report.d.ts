import type { DirectionalText, SemanticLabel } from './document';
import { type DirectionSpec } from './direction';
import type { LabelResolver } from './document';
import type { ResolvedPrintLanguages, TextDirection } from './types';
export interface ZReportPaymentSnapshot {
    readonly method: string;
    readonly count: number;
    readonly totalCents?: number;
    readonly total?: number;
}
export interface ZReportTaxSnapshot {
    readonly title?: string;
    readonly label?: string;
    readonly amount: number;
}
export interface ZReportStaffSnapshot {
    readonly name?: string;
    readonly userId?: string;
    readonly orderCount?: number;
    readonly orders?: number;
    readonly revenueCents?: number;
    readonly revenue?: number;
}
/** Stored cash-closure truth normalized for the print document builder. */
export interface ZReportPrintData {
    readonly zNumber: string | number;
    readonly businessDate: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly openingFloatCents: number;
    readonly payInCents: number;
    readonly payOutCents: number;
    readonly safeDropCents: number;
    readonly paymentMethods: readonly ZReportPaymentSnapshot[];
    readonly refundCount: number;
    readonly refundedCents: number;
    readonly taxComponents: readonly ZReportTaxSnapshot[];
    readonly staffSales: readonly ZReportStaffSnapshot[];
    readonly expectedCashCents: number;
    readonly countedCashCents: number;
    readonly varianceCents: number;
    readonly closedByName: string;
    readonly businessName: string;
    readonly businessAddress: string;
    readonly taxRegistrationNumber: string;
    readonly isReprint: boolean;
}
export interface ZReportContext {
    readonly languages: ResolvedPrintLanguages;
    readonly baseDirection: TextDirection;
    readonly resolveLabel: LabelResolver;
}
export interface ZReportPeriodRow {
    readonly label: SemanticLabel;
    readonly value: DirectionalText;
}
export interface ZReportPaymentRow {
    readonly method: string;
    readonly label: SemanticLabel;
    readonly countLabel: SemanticLabel;
    readonly count: number;
    readonly totalCents: number;
}
export interface ZReportAmountRow {
    readonly label: SemanticLabel;
    readonly amount: number;
}
export interface ZReportCountAmountBlock {
    readonly heading: SemanticLabel;
    readonly countLabel: SemanticLabel;
    readonly count: number;
    readonly totalLabel: SemanticLabel;
    readonly totalCents: number;
}
export interface ZReportSection<T> {
    readonly heading: SemanticLabel;
    readonly none: SemanticLabel;
    readonly rows: readonly T[];
}
export interface ZReportDocument {
    readonly version: 1;
    readonly direction: DirectionSpec;
    readonly languages: ResolvedPrintLanguages;
    readonly header: {
        readonly title: SemanticLabel;
        readonly zNumber: DirectionalText;
        readonly reprintMarker: SemanticLabel | null;
        readonly businessName: DirectionalText | null;
        readonly businessAddress: DirectionalText | null;
        readonly taxRegistrationNumber: DirectionalText | null;
    };
    readonly period: readonly ZReportPeriodRow[];
    readonly openingFloat: {
        readonly label: SemanticLabel;
        readonly cents: number;
    };
    readonly cashMovements: {
        readonly heading: SemanticLabel;
        readonly payIn: {
            readonly label: SemanticLabel;
            readonly cents: number;
        };
        readonly payOut: {
            readonly label: SemanticLabel;
            readonly cents: number;
        };
        readonly safeDrop: {
            readonly label: SemanticLabel;
            readonly cents: number;
        };
    };
    readonly payments: ZReportSection<ZReportPaymentRow>;
    readonly refunds: ZReportCountAmountBlock;
    readonly tax: ZReportSection<ZReportAmountRow>;
    readonly staff: ZReportSection<ZReportPaymentRow>;
    readonly cash: {
        readonly expected: {
            readonly label: SemanticLabel;
            readonly cents: number;
        };
        readonly counted: {
            readonly label: SemanticLabel;
            readonly cents: number;
        };
        readonly variance: {
            readonly label: SemanticLabel;
            readonly cents: number;
        };
    };
    readonly operator: {
        readonly label: SemanticLabel;
        readonly name: DirectionalText | null;
        readonly signatureLabel: SemanticLabel;
    };
    readonly footer: SemanticLabel;
}
/** Build a typed, localized Z-report document from stored closure truth. */
export declare function buildZReportDocument(data: ZReportPrintData, context: ZReportContext): ZReportDocument;
//# sourceMappingURL=z-report.d.ts.map