import { getDatabase } from '../db';
export declare function getEffectiveOrderItems(db: any, orderId: string): any[];
export declare function routeItemsToStations(db: any, orderItems: any[]): {
    stationName: string;
    printer: any;
    items: any[];
}[];
export declare const printerRoutes: import("express-serve-static-core").Router;
/** Tenant-configured language for print labels, defaulting to 'en'. */
export declare function tenantLanguage(db: ReturnType<typeof getDatabase>): string;
/**
 * Automatically prints KOT tickets via configured backend printers when a
 * scheduled order is released to the kitchen and `auto_print_kot` is enabled.
 */
export declare function autoPrintReleasedOrderKot(db: ReturnType<typeof getDatabase>, orderId: string | number): Promise<boolean>;
//# sourceMappingURL=printers.d.ts.map