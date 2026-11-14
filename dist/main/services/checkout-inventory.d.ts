import { getDatabase } from '../db';
type Database = ReturnType<typeof getDatabase>;
/** Consumes snapshots exactly once. Legacy rows are intentionally ignored. */
export declare function consumeCheckoutInventory(db: Database, orderId: number, actorUserId: string, completionReference: string): void;
export {};
//# sourceMappingURL=checkout-inventory.d.ts.map