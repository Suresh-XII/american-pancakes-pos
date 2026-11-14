import { getDatabase } from '../../db';
import { DeliveryProviderAdapter } from './adapters/provider-adapter';
import { DeliveryMenuMapping, DeliveryOrderTracking, DeliveryPlatformConfig, DeliveryProvider, DeliveryWebhookEvent, ExternalOrderStatus, InternalOrderStatus, NormalizedDeliveryOrder, WebhookEventStatus } from './types';
interface ProductDbRow {
    id: string;
    name: string;
    sku: string | null;
    price: number;
    tax_rate?: number;
    tax_type?: string;
    is_active: number;
    deleted_at?: string | null;
}
interface VariantDbRow {
    id: string;
    product_id: string;
    name: string;
    price: number;
    online_price?: number | null;
    recipe_multiplier?: number;
    is_active: number;
}
interface OrderDbRow {
    id: number;
    order_number: string;
    status: string;
    total: number;
    subtotal: number;
    online_platform?: string | null;
    external_order_id?: string | null;
    created_at: string;
    updated_at: string;
}
export declare function getDeliveryAdapter(provider: DeliveryProvider): DeliveryProviderAdapter;
export declare function getDeliveryPlatformConfigs(db: ReturnType<typeof getDatabase>): DeliveryPlatformConfig[];
export declare function getDeliveryPlatformConfig(db: ReturnType<typeof getDatabase>, provider: DeliveryProvider): DeliveryPlatformConfig | null;
export declare function updateDeliveryPlatformConfig(db: ReturnType<typeof getDatabase>, provider: DeliveryProvider, input: {
    is_enabled?: boolean | number;
    mode?: 'sandbox' | 'live' | 'disconnected';
    auto_accept_orders?: boolean | number;
    merchant_id?: string | null;
    store_id?: string | null;
    notes?: string | null;
}, _actorUserId: string): DeliveryPlatformConfig;
export declare function listDeliveryMenuMappings(db: ReturnType<typeof getDatabase>, provider?: DeliveryProvider): DeliveryMenuMapping[];
export declare function createDeliveryMenuMapping(db: ReturnType<typeof getDatabase>, input: {
    provider: DeliveryProvider;
    external_item_id: string;
    external_variant_id?: string | null;
    internal_product_id: string;
    internal_variant_id?: string | null;
    external_name: string;
    is_active?: boolean | number;
}, _actorUserId: string): DeliveryMenuMapping;
export declare function updateDeliveryMenuMapping(db: ReturnType<typeof getDatabase>, id: number, input: {
    external_name?: string;
    internal_product_id?: string;
    internal_variant_id?: string | null;
    is_active?: boolean | number;
}, _actorUserId: string): DeliveryMenuMapping;
export declare function deleteDeliveryMenuMapping(db: ReturnType<typeof getDatabase>, id: number, _actorUserId: string): void;
export declare function resolveExternalMenuItem(db: ReturnType<typeof getDatabase>, provider: DeliveryProvider, externalItemId: string, externalVariantId?: string | null): {
    mapping: DeliveryMenuMapping;
    product: ProductDbRow;
    variant: VariantDbRow | null;
};
export declare function ingestDeliveryOrder(db: ReturnType<typeof getDatabase>, normalized: NormalizedDeliveryOrder, actorUserId: string): {
    order: OrderDbRow;
    tracking: DeliveryOrderTracking;
    isDuplicate: boolean;
};
export declare function syncDeliveryOrderStatus(db: ReturnType<typeof getDatabase>, orderId: number, targetStatus: InternalOrderStatus | ExternalOrderStatus, _actorUserId: string): Promise<{
    order: OrderDbRow;
    tracking: DeliveryOrderTracking;
    externalResult: {
        success: boolean;
        simulated: boolean;
        message?: string;
    };
}>;
export declare function processDeliveryWebhook(db: ReturnType<typeof getDatabase>, provider: DeliveryProvider, headers: Record<string, string | string[] | undefined>, payload: unknown): Promise<{
    eventId: number;
    status: WebhookEventStatus;
    message?: string;
    orderId?: number;
}>;
export declare function retryDeliveryWebhookEvent(db: ReturnType<typeof getDatabase>, eventId: number, _actorUserId: string): Promise<{
    success: boolean;
    event: DeliveryWebhookEvent;
}>;
export declare function listDeliveryWebhookEvents(db: ReturnType<typeof getDatabase>, filters?: {
    provider?: DeliveryProvider;
    status?: string;
    limit?: number;
}): DeliveryWebhookEvent[];
export declare function getDeliveryOrderTracking(db: ReturnType<typeof getDatabase>, orderId: number): DeliveryOrderTracking | null;
export {};
//# sourceMappingURL=delivery-service.d.ts.map