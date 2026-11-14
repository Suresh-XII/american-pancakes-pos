import { getDatabase } from '../db';
export type ServingType = 'dine_in' | 'parcel';
export type PackagingType = 'paper_plate' | 'parcel_box';
export type ServingAllocationInput = {
    serving_type: ServingType;
    quantity: number;
    packaging_profile_id?: string | null;
};
export interface PackagingMaterialRecord {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    base_unit: string;
    stock_quantity: number;
    low_stock_threshold: number | null;
    unit_cost: number | null;
    is_active: number;
    is_packaging: number;
    is_low_stock?: number;
    created_at: string;
    updated_at: string;
}
export interface PackagingProfileComponent {
    material_id: string;
    material_name?: string;
    quantity: number;
    base_unit?: string;
    unit_cost?: number | null;
    sku?: string | null;
    category?: string | null;
    is_active?: number;
    stock_quantity?: number;
}
export interface PackagingProfileRecord {
    id: string;
    name: string;
    description: string | null;
    notes: string | null;
    serving_type: ServingType;
    packaging_type: PackagingType;
    supply_id: string;
    units_per_serving: number;
    customer_charge_per_unit: number;
    is_active: number;
    is_default: number;
    components: PackagingProfileComponent[];
    created_at: string;
    updated_at: string;
}
interface ProfileDbRow {
    id: string;
    name: string;
    description: string | null;
    notes: string | null;
    serving_type: ServingType;
    packaging_type: PackagingType;
    supply_id: string;
    units_per_serving: number;
    customer_charge_per_unit: number;
    is_active: number;
    is_default: number;
    created_at: string;
    updated_at: string;
    supply_name?: string;
    unit_cost?: number | null;
    supply_is_active?: number;
}
export declare function normalizePackagingUnit(raw: unknown): string;
export declare function normalizeServingAllocations(raw: unknown, itemQuantity: number): ServingAllocationInput[];
type Profile = {
    id: string;
    name: string;
    serving_type: ServingType;
    packaging_type: PackagingType;
    supply_id: string;
    units_per_serving: number;
    customer_charge_per_unit: number;
    unit_cost: number | null;
    base_unit: string;
};
export declare function profileFor(db: ReturnType<typeof getDatabase>, id: string, servingType: ServingType): Profile;
export declare function listPackagingMaterials(db: ReturnType<typeof getDatabase>, filters?: {
    search?: string;
    category?: string;
    lowStockOnly?: boolean;
    includeInactive?: boolean;
}): PackagingMaterialRecord[];
export declare function getPackagingMaterial(db: ReturnType<typeof getDatabase>, id: string): PackagingMaterialRecord | null;
export declare function createPackagingMaterial(db: ReturnType<typeof getDatabase>, input: {
    name: string;
    sku?: string | null;
    category?: string | null;
    unit?: string;
    stock_quantity?: number;
    initial_stock?: number;
    low_stock_threshold?: number | null;
    unit_cost?: number | null;
    purchase_cost?: number | null;
    is_active?: boolean | number;
}, actorUserId: string): PackagingMaterialRecord;
export declare function updatePackagingMaterial(db: ReturnType<typeof getDatabase>, id: string, input: {
    name?: string;
    sku?: string | null;
    category?: string | null;
    unit?: string;
    low_stock_threshold?: number | null;
    unit_cost?: number | null;
    purchase_cost?: number | null;
    is_active?: boolean | number;
}, _actorUserId?: string): PackagingMaterialRecord;
export declare function deletePackagingMaterial(db: ReturnType<typeof getDatabase>, id: string, _actorUserId?: string): void;
export declare function getPackagingMaterialMovements(db: ReturnType<typeof getDatabase>, id: string, limit?: number): {
    material: {
        id: string;
        name: string;
    };
    movements: unknown[];
};
export declare function getProfileComponents(db: ReturnType<typeof getDatabase>, profileId: string): Array<{
    material_id: string;
    material_name: string;
    quantity: number;
    base_unit: string;
    unit_cost: number | null;
    packaging_type: string;
    sku: string | null;
    category: string | null;
    is_active: number;
    stock_quantity: number;
}>;
export declare function listPackagingProfiles(db: ReturnType<typeof getDatabase>, options?: {
    activeOnly?: boolean;
}): PackagingProfileRecord[];
export declare function getPackagingProfile(db: ReturnType<typeof getDatabase>, id: string): PackagingProfileRecord | null;
export declare function createPackagingProfile(db: ReturnType<typeof getDatabase>, input: {
    name: string;
    description?: string | null;
    notes?: string | null;
    serving_type?: ServingType;
    packaging_type?: PackagingType;
    customer_charge_per_unit?: number;
    is_active?: boolean | number;
    is_default?: boolean | number;
    components?: Array<{
        material_id: string;
        quantity: number;
    }>;
    supply_id?: string;
    units_per_serving?: number;
}, actorUserId: string): PackagingProfileRecord;
export declare function updatePackagingProfile(db: ReturnType<typeof getDatabase>, id: string, input: {
    name?: string;
    description?: string | null;
    notes?: string | null;
    serving_type?: ServingType;
    packaging_type?: PackagingType;
    customer_charge_per_unit?: number;
    is_active?: boolean | number;
    is_default?: boolean | number;
    components?: Array<{
        material_id: string;
        quantity: number;
    }>;
    supply_id?: string;
    units_per_serving?: number;
}, actorUserId: string): PackagingProfileRecord;
export declare function duplicatePackagingProfile(db: ReturnType<typeof getDatabase>, id: string, actorUserId: string): PackagingProfileRecord;
export declare function deletePackagingProfile(db: ReturnType<typeof getDatabase>, id: string, actorUserId: string): void;
export declare function getProductPackagingAssignments(db: ReturnType<typeof getDatabase>): {
    product_id: string;
    product_name: string;
    packaging_profile_id: string | null;
    profile_name: string | null;
    no_packaging: boolean;
    variants: {
        variant_id: string;
        variant_name: string;
        packaging_profile_id: string | null;
        profile_name: string | null;
        no_packaging: boolean;
    }[];
}[];
export declare function setProductPackagingAssignment(db: ReturnType<typeof getDatabase>, productId: number | string, input: {
    packaging_profile_id?: string | null;
    no_packaging?: boolean | number;
}): unknown;
export declare function setVariantPackagingAssignment(db: ReturnType<typeof getDatabase>, variantId: number | string, input: {
    packaging_profile_id?: string | null;
    no_packaging?: boolean | number;
}): unknown;
export declare function resolvePackagingProfile(db: ReturnType<typeof getDatabase>, params: {
    productId?: number | string | null;
    variantId?: number | string | null;
    explicitProfileId?: string | null;
    servingType: ServingType;
}): {
    profile: ProfileDbRow | null;
    noPackaging: boolean;
};
export declare function previewItemPackaging(db: ReturnType<typeof getDatabase>, raw: unknown, itemQuantity: number, productId?: number | string | null, variantId?: number | string | null, explicitProfileId?: string | null): number;
export declare function persistItemServingAndPackaging(args: {
    db: ReturnType<typeof getDatabase>;
    orderItemId: number | bigint;
    itemQuantity: number;
    allocations: unknown;
    actorUserId: string;
    productId?: number | string | null;
    variantId?: number | string | null;
    explicitProfileId?: string | null;
}): number;
export declare function getOrderPackaging(db: ReturnType<typeof getDatabase>, orderId: number | string): {
    order_id: number;
    order_status: string;
    payment_status: string;
    can_adjust: boolean;
    total_packaging_charge: number;
    order: {
        id: number;
        status: string;
        packaging_charge: number;
        total: number;
        subtotal: number;
    };
    allocations: unknown[];
    summary: {
        supply_id: string;
        material_name: string;
        unit: string;
        total_quantity: number;
        total_charge: number;
    }[];
};
export declare function adjustOrderPackaging(db: ReturnType<typeof getDatabase>, input: {
    orderId: number | string;
    adjustments: Array<{
        packaging_allocation_id?: number;
        order_item_id?: number | string;
        material_id?: string;
        quantity: number;
        notes?: string;
        customer_charge?: number;
    }>;
    actorUserId: string;
}): {
    order_id: number;
    order_status: string;
    payment_status: string;
    can_adjust: boolean;
    total_packaging_charge: number;
    order: {
        id: number;
        status: string;
        packaging_charge: number;
        total: number;
        subtotal: number;
    };
    allocations: unknown[];
    summary: {
        supply_id: string;
        material_name: string;
        unit: string;
        total_quantity: number;
        total_charge: number;
    }[];
};
export declare function getPackagingDashboard(db: ReturnType<typeof getDatabase>): {
    total_materials: number;
    low_stock_materials: number;
    active_profiles: number;
    assigned_products_count: number;
    low_stock_items: unknown[];
    recent_movements: unknown[];
};
export {};
//# sourceMappingURL=packaging.d.ts.map