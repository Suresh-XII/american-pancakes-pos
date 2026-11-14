export interface CounterRow {
    id: string;
    name: string;
    role: 'ordering' | 'payment' | 'combined';
    is_active: number;
    sort_order: number;
    created_at: string;
    updated_at: string;
}
export declare const counterRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=counters.d.ts.map