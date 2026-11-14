declare const router: import("express-serve-static-core").Router;
export declare function withRefundPinLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
export declare function resetRefundPinLocksForTests(): void;
export { router as refundRoutes };
//# sourceMappingURL=refunds.d.ts.map