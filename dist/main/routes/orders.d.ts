import { Request } from 'express';
import { checkPinRateLimit, isPinRateLimited, clearPinRateLimit, resetPinRateLimitForTests, withPinVerificationLock, PIN_MAX_ATTEMPTS, PIN_WINDOW_MS } from '../middleware/security';
export { checkPinRateLimit, isPinRateLimited, clearPinRateLimit, resetPinRateLimitForTests, withPinVerificationLock, PIN_MAX_ATTEMPTS, PIN_WINDOW_MS, };
export declare function resolveOrderWriteRateLimitMax(rawLimit?: string | undefined): number;
export declare function shouldSkipOrderWriteRateLimit(req: Request): boolean;
/**
 * Resolves the unified engine's charges for an order, carrying forward the
 * waivers already recorded on it so a recompute never silently un-waives a fee.
 * Returns null when the merchant configured nothing that matches this order, so
 * the row keeps the charge amounts it already carried.
 */
/** The order columns the charge engine reads. */
interface EngineChargeOrderRow {
    type?: string | null;
    charges_breakdown?: string | null;
    service_charge?: number | null;
    packaging_charge?: number | null;
}
export declare function resolveEngineCharges(order: EngineChargeOrderRow, subtotal: number, discountAmount: number): {
    appliedCharges: import("../services/charges").AppliedCharge[];
    ownsServiceChargeColumn: boolean;
    ownsPackagingChargeColumn: boolean;
    chargeColumnOverrides: {
        service_charge?: number;
        packaging_charge?: number;
    };
    columns: {
        service_charge: number;
        packaging_charge: number;
        other_charges: number;
    };
    chargesJson: string;
} | null;
export declare const orderRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=orders.d.ts.map