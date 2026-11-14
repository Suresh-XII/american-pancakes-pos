"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPosItemSort = exports.isPosCategorySort = exports.POS_ITEM_SORTS = exports.POS_CATEGORY_SORTS = void 0;
exports.readPosSortSettings = readPosSortSettings;
const pos_sort_1 = require("../../shared/pos-sort");
Object.defineProperty(exports, "POS_CATEGORY_SORTS", { enumerable: true, get: function () { return pos_sort_1.POS_CATEGORY_SORTS; } });
Object.defineProperty(exports, "POS_ITEM_SORTS", { enumerable: true, get: function () { return pos_sort_1.POS_ITEM_SORTS; } });
Object.defineProperty(exports, "isPosCategorySort", { enumerable: true, get: function () { return pos_sort_1.isPosCategorySort; } });
Object.defineProperty(exports, "isPosItemSort", { enumerable: true, get: function () { return pos_sort_1.isPosItemSort; } });
/** Falls back to the saved order when a stored value is missing or unrecognised. */
function readPosSortSettings(settings) {
    const category = settings.pos_category_sort;
    const item = settings.pos_item_sort;
    return {
        category_sort: (0, pos_sort_1.isPosCategorySort)(category) ? category : 'saved',
        item_sort: (0, pos_sort_1.isPosItemSort)(item) ? item : 'saved',
    };
}
//# sourceMappingURL=pos-sort.js.map