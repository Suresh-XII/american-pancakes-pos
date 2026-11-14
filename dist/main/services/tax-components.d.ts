export interface DisplayTaxComponent {
    title: string;
    rate: number | null;
    amount: number;
}
interface TaxSource {
    tax_snapshot?: unknown;
    tax_breakdown?: unknown;
}
interface TaxDocument extends TaxSource {
    tax_amount?: unknown;
    items?: Array<TaxSource & {
        status?: string | null;
    }>;
}
/** Resolves receipt/report tax components without double-counting across snapshots. */
export declare function resolveTaxComponents(document: TaxDocument): DisplayTaxComponent[];
export declare function mergeDisplayTaxComponents(lists: DisplayTaxComponent[][]): DisplayTaxComponent[];
export declare function aggregateTaxComponents(documents: TaxDocument[]): DisplayTaxComponent[];
export {};
//# sourceMappingURL=tax-components.d.ts.map