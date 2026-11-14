import { getDatabase } from '../db';
export declare function parseCustomer(c: any): any;
export declare function getWalletBalance(customerId: string | number | null): number;
export declare const CUSTOMER_TOP_ITEMS_LIMIT = 5;
export interface CustomerTopItem {
    product_id: string;
    product_name: string;
    total_quantity: number;
    order_count: number;
    available: boolean;
}
/**
 * Customer's top bought products on completed orders (grouped by product, terminal items excluded).
 * Excludes orders whose bills were all refunded; `available` mirrors the POS catalog filter.
 */
export declare function getCustomerTopItems(db: ReturnType<typeof getDatabase>, customerId: string, limit?: number): CustomerTopItem[];
export declare const customerRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=customers.d.ts.map