export declare function fetchPinnedHttps(rawUrl: string, resolvedAddress: string, signal?: AbortSignal): Promise<{
    status: number;
    headers: Headers;
    body: Buffer;
}>;
/** Batch loads category and addon group relations for a list of products. */
export declare function loadProductRelationsBatch(db: any, products: any[], options?: {
    includeInactiveVariants?: boolean;
}): Map<any, any>;
export declare const productRoutes: import("express-serve-static-core").Router;
//# sourceMappingURL=products.d.ts.map