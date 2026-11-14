"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POS_ITEM_SORTS = exports.POS_CATEGORY_SORTS = void 0;
exports.isPosCategorySort = isPosCategorySort;
exports.isPosItemSort = isPosItemSort;
exports.POS_CATEGORY_SORTS = ['saved', 'name'];
exports.POS_ITEM_SORTS = ['saved', 'name', 'price_asc', 'price_desc'];
function isPosCategorySort(value) {
    return exports.POS_CATEGORY_SORTS.some((option) => option === value);
}
function isPosItemSort(value) {
    return exports.POS_ITEM_SORTS.some((option) => option === value);
}
//# sourceMappingURL=pos-sort.js.map