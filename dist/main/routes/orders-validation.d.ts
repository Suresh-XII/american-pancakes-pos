/** Order and item notes validation functions. */
/** The read-only handle these validators need: a settings lookup and nothing more. */
type SettingsLookup = {
    prepare(sql: string): {
        get(...params: unknown[]): unknown;
    };
};
export declare function validateOrderNotes(db: SettingsLookup, notes: string | null | undefined): void;
export declare function validateItemNotes(db: SettingsLookup, notes: string | null | undefined): void;
/** Refuses a too-long new value; never rewrites a legacy row that is too long. */
export declare function validateCustomerAddress(db: SettingsLookup, address: string | null | undefined): void;
/** Free text bound for a printed document, so nothing unbounded is persisted. */
export declare function validateDeliveryAddress(db: SettingsLookup, address: string | null | undefined): void;
/** Courier-only free text, bounded for the slip like the delivery address. */
export declare function validateDeliveryNote(db: SettingsLookup, note: string | null | undefined): void;
/**
 * The method the courier expects to collect, never a record of payment. Null is
 * unknown; `pending` means the customer has not decided yet.
 */
export declare function resolveExpectedPaymentMethod(db: SettingsLookup, value: unknown): string | null;
/**
 * Resolves the explicit custom-method identity a caller sends alongside the name
 * snapshot. The ID is the durable marker, so it is resolved against the active
 * configuration here and the canonical name is stored with it; the optional name
 * is only checked for agreement and never invented. Null keeps the legacy
 * string/sentinel contract untouched.
 */
export declare function resolveExpectedPaymentMethodIdentity(db: SettingsLookup, methodId: unknown, methodName: unknown): {
    id: number;
    name: string;
} | null;
export declare function validateProductQuantity(product: {
    name?: string;
    sale_unit?: string;
    allow_fractional_quantity?: boolean | number;
    weight_precision?: number;
}, quantity: unknown): asserts quantity is number;
export {};
//# sourceMappingURL=orders-validation.d.ts.map