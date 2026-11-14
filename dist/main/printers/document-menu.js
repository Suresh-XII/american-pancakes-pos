"use strict";
/** Menu document builder and ESC/POS renderer. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMenuDocument = buildMenuDocument;
exports.renderMenuViaDocument = renderMenuViaDocument;
const print_labels_generated_1 = require("../print/print-labels.generated");
const print_1 = require("../../shared/print");
const width_1 = require("../../shared/print/width");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const formatting_helpers_1 = require("./formatting-helpers");
function buildMenuDocument(categories, products, options) {
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const visibleProducts = products
        .filter((product) => options.includeInactive === true || product.isActive)
        .filter((product) => options.includeOutOfStock === true || !product.trackInventory || product.stockQuantity > 0)
        .filter((product) => {
        if (options.includeHidden === true || !product.categoryId)
            return true;
        let currentId = product.categoryId;
        const seen = new Set();
        while (currentId && !seen.has(currentId)) {
            seen.add(currentId);
            const category = categoryById.get(currentId);
            if (!category || !category.isActive)
                return false;
            currentId = category.parentId;
        }
        return true;
    })
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    const toDirectionalText = (text) => (0, print_1.directionalText)((0, formatting_helpers_1.safePrinterText)(text), options.baseDirection);
    const toRows = (rows) => rows.map((product) => ({
        name: toDirectionalText(product.name),
        price: options.formatPrice(Number.isFinite(product.price) ? product.price : 0),
        details: [
            ...(options.includeDescriptions && product.description
                ? [toDirectionalText(product.description)]
                : []),
            ...(options.includeModifiers
                ? (product.modifiers || []).map((group) => toDirectionalText(`${group.name}: ${group.options.map((option) => `${option.name} (${options.formatPrice(option.price)})`).join(', ')}`))
                : []),
        ],
    }));
    const sortBySiblingOrder = (list) => list
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    const childrenByParent = new Map();
    const rootCategories = [];
    for (const category of categories) {
        const parentId = category.parentId || null;
        if (parentId && categoryById.has(parentId) && parentId !== category.id) {
            const list = childrenByParent.get(parentId) || [];
            list.push(category);
            childrenByParent.set(parentId, list);
        }
        else {
            rootCategories.push(category);
        }
    }
    const sections = [];
    const visitedCategoryIds = new Set();
    const visitSubtree = (root) => {
        if (visitedCategoryIds.has(root.id))
            return;
        visitedCategoryIds.add(root.id);
        const rootProducts = toRows(visibleProducts.filter((product) => product.categoryId === root.id));
        if (rootProducts.length > 0) {
            sections.push({
                rootCategoryId: root.id,
                name: toDirectionalText(root.name),
                parentName: null,
                products: rootProducts,
            });
        }
        const visitDescendants = (parentId) => {
            const children = sortBySiblingOrder(childrenByParent.get(parentId) || []);
            for (const child of children) {
                if (visitedCategoryIds.has(child.id))
                    continue;
                visitedCategoryIds.add(child.id);
                const childProducts = toRows(visibleProducts.filter((product) => product.categoryId === child.id));
                if (childProducts.length > 0) {
                    sections.push({
                        rootCategoryId: root.id,
                        name: toDirectionalText(child.name),
                        parentName: toDirectionalText(root.name),
                        products: childProducts,
                    });
                }
                visitDescendants(child.id);
            }
        };
        visitDescendants(root.id);
    };
    for (const root of sortBySiblingOrder(rootCategories)) {
        visitSubtree(root);
    }
    for (const category of sortBySiblingOrder(categories)) {
        if (visitedCategoryIds.has(category.id))
            continue;
        let entry = category;
        const chain = new Set([entry.id]);
        while (entry.parentId &&
            categoryById.has(entry.parentId) &&
            !chain.has(entry.parentId) &&
            !visitedCategoryIds.has(entry.parentId)) {
            entry = categoryById.get(entry.parentId);
            chain.add(entry.id);
        }
        visitSubtree(entry);
    }
    const uncategorized = visibleProducts.filter((product) => !product.categoryId || !categoryById.has(product.categoryId));
    if (uncategorized.length > 0)
        sections.push({
            rootCategoryId: null,
            name: null,
            parentName: null,
            products: toRows(uncategorized),
        });
    return {
        businessName: toDirectionalText(options.businessName),
        printedAt: (0, formatting_helpers_1.safePrinterText)(options.printedAt),
        sections,
        itemCount: sections.reduce((count, section) => count + section.products.length, 0),
    };
}
function renderMenuViaDocument(document, options) {
    const capabilities = options.capabilities ?? thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES;
    const warnings = [];
    const lines = ['{INIT}'];
    const header = (0, formatting_helpers_1.wrapText)((0, formatting_helpers_1.normalizeThermalText)(document.businessName.text, capabilities), options.columns);
    for (const line of header)
        lines.push(`{CENTER}${line}{/CENTER}`);
    lines.push(`{CENTER}{DOUBLE_HEIGHT}{BOLD}${(0, formatting_helpers_1.safePrinterText)((0, print_labels_generated_1.printLabel)(options.language, 'print.menu.title'))}{/BOLD}{/DOUBLE_HEIGHT}{/CENTER}`);
    lines.push(`{CENTER}${(0, formatting_helpers_1.truncateShapedLine)(document.printedAt, options.columns, options.arabicShaping === true, options.language, capabilities)}{/CENTER}`, '');
    let activeRootKey = null;
    for (const section of document.sections) {
        if (section.parentName) {
            const rootKey = section.rootCategoryId
                ? `id:${section.rootCategoryId}`
                : `name:${section.parentName.text}`;
            if (activeRootKey !== rootKey) {
                const parentTitle = (0, formatting_helpers_1.truncateShapedLine)(`--- ${section.parentName.text} ---`, options.columns, options.arabicShaping === true, options.language, capabilities);
                lines.push(`{BOLD}${parentTitle}{/BOLD}`);
                activeRootKey = rootKey;
            }
            if (section.name) {
                const subTitle = (0, formatting_helpers_1.truncateShapedLine)(`  ${section.name.text}`, options.columns, options.arabicShaping === true, options.language, capabilities);
                lines.push(`{BOLD}${subTitle}{/BOLD}`);
            }
        }
        else {
            activeRootKey = section.name
                ? section.rootCategoryId
                    ? `id:${section.rootCategoryId}`
                    : `name:${section.name.text}`
                : null;
            if (section.name) {
                const title = (0, formatting_helpers_1.truncateShapedLine)(`--- ${section.name.text} ---`, options.columns, options.arabicShaping === true, options.language, capabilities);
                lines.push(`{BOLD}${title}{/BOLD}`);
            }
        }
        for (const product of section.products) {
            const price = (0, formatting_helpers_1.truncateShapedLine)(product.price, Math.max(1, options.columns - 2), options.arabicShaping === true, options.language, capabilities);
            const priceWidth = (0, width_1.displayCellWidth)(price);
            const nameWidth = Math.max(1, options.columns - priceWidth - 1);
            const nameLines = (0, formatting_helpers_1.wrapText)((0, formatting_helpers_1.normalizeThermalText)(product.name.text, capabilities), nameWidth);
            const firstName = nameLines.shift() ?? '';
            const leaderCount = Math.max(0, options.columns - (0, width_1.displayCellWidth)(firstName) - priceWidth);
            lines.push(`${firstName}${'.'.repeat(leaderCount)}${price}`);
            for (const continuation of [
                ...nameLines,
                ...product.details.flatMap((detail) => (0, formatting_helpers_1.wrapText)((0, formatting_helpers_1.normalizeThermalText)(detail.text, capabilities), Math.max(1, options.columns - 2))),
            ]) {
                lines.push(`  ${(0, formatting_helpers_1.truncateShapedLine)(continuation, Math.max(1, options.columns - 2), options.arabicShaping === true, options.language, capabilities)}`);
            }
        }
        lines.push('');
    }
    for (const line of (0, formatting_helpers_1.wrapText)(`${(0, formatting_helpers_1.safePrinterText)((0, print_labels_generated_1.printLabel)(options.language, 'print.menu.totalItems'))}: ${document.itemCount}`, options.columns))
        lines.push(`{CENTER}${line}{/CENTER}`);
    lines.push('{CENTER}Powered by FloCafe{/CENTER}', '{FEED}', '{CUT}');
    const data = (0, formatting_helpers_1.buildEscPos)(lines, options.useUnicode === true, {
        cutMode: options.cutMode,
        arabicShaping: options.arabicShaping,
        columns: options.columns,
        language: options.language,
        capabilities,
    }, warnings);
    return { data, warnings, lines };
}
//# sourceMappingURL=document-menu.js.map