/** Menu document builder and ESC/POS renderer. */
import { type DirectionalText, type TextDirection } from '../../shared/print';
import { type ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { PrinterCutMode } from './profiles';
import { type PrintWarning } from './formatting-helpers';
export interface MenuCategoryInput {
    id: string;
    name: string;
    parentId?: string | null;
    isActive: boolean;
    sortOrder: number;
}
export interface MenuProductInput {
    description?: string | null;
    modifiers?: Array<{
        name: string;
        options: Array<{
            name: string;
            price: number;
        }>;
    }>;
    categoryId: string | null;
    name: string;
    price: number;
    isActive: boolean;
    trackInventory: boolean;
    stockQuantity: number;
    sortOrder: number;
}
export interface MenuPrintFilters {
    includeInactive?: boolean;
    includeOutOfStock?: boolean;
    includeHidden?: boolean;
    includeDescriptions?: boolean;
    includeModifiers?: boolean;
}
export interface MenuDocument {
    businessName: DirectionalText;
    printedAt: string;
    sections: Array<{
        rootCategoryId?: string | null;
        name: DirectionalText | null;
        parentName?: DirectionalText | null;
        products: Array<{
            name: DirectionalText;
            price: string;
            details: DirectionalText[];
        }>;
    }>;
    itemCount: number;
}
export declare function buildMenuDocument(categories: readonly MenuCategoryInput[], products: readonly MenuProductInput[], options: MenuPrintFilters & {
    businessName: string;
    printedAt: string;
    baseDirection: TextDirection;
    formatPrice: (price: number) => string;
}): MenuDocument;
export interface MenuDocumentRenderOptions {
    columns: number;
    language: string;
    useUnicode?: boolean;
    arabicShaping?: boolean;
    cutMode?: PrinterCutMode;
    capabilities?: ThermalPrinterCapabilities;
}
export declare function renderMenuViaDocument(document: MenuDocument, options: MenuDocumentRenderOptions): {
    data: Buffer;
    warnings: PrintWarning[];
    lines: string[];
};
//# sourceMappingURL=document-menu.d.ts.map