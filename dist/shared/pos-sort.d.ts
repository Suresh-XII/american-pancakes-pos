export declare const POS_CATEGORY_SORTS: readonly ["saved", "name"];
export declare const POS_ITEM_SORTS: readonly ["saved", "name", "price_asc", "price_desc"];
export type PosCategorySort = (typeof POS_CATEGORY_SORTS)[number];
export type PosItemSort = (typeof POS_ITEM_SORTS)[number];
export declare function isPosCategorySort(value: unknown): value is PosCategorySort;
export declare function isPosItemSort(value: unknown): value is PosItemSort;
//# sourceMappingURL=pos-sort.d.ts.map