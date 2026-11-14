export type DeliveryProvider = 'swiggy' | 'zomato' | 'sandbox';
export type IntegrationMode = 'sandbox' | 'live' | 'disconnected';
export type DeliverySyncStatus = 'mapped' | 'unmapped' | 'error';
export type WebhookEventStatus = 'received' | 'processed' | 'failed' | 'ignored';
export type ExternalOrderStatus = 'received' | 'accepted' | 'preparing' | 'ready' | 'dispatched' | 'delivered' | 'cancelled' | 'rejected';
export type InternalOrderStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
export interface DeliveryPlatformConfig {
    provider: DeliveryProvider;
    display_name: string;
    is_enabled: boolean;
    mode: IntegrationMode;
    api_key_configured: boolean;
    api_secret_configured: boolean;
    merchant_id: string | null;
    store_id: string | null;
    auto_accept_orders: boolean;
    last_sync_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}
export interface DeliveryMenuMapping {
    id: number;
    provider: DeliveryProvider;
    external_item_id: string;
    external_variant_id: string | null;
    internal_product_id: string;
    internal_variant_id: string | null;
    external_name: string;
    product_name?: string;
    variant_name?: string | null;
    is_active: boolean;
    sync_status: DeliverySyncStatus;
    last_synced_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface DeliveryOrderTracking {
    id: number;
    internal_order_id: number;
    provider: DeliveryProvider;
    external_order_id: string;
    is_simulated: boolean;
    external_status: ExternalOrderStatus;
    internal_status: InternalOrderStatus;
    pickup_code: string | null;
    rider_name: string | null;
    rider_phone: string | null;
    estimated_delivery_time: string | null;
    delivery_address: string | null;
    raw_details_json: string | null;
    created_at: string;
    updated_at: string;
}
export interface DeliveryWebhookEvent {
    id: number;
    event_id: string;
    provider: DeliveryProvider;
    event_type: string;
    idempotency_key: string;
    payload_json: string;
    status: WebhookEventStatus;
    internal_order_id: number | null;
    external_order_id: string | null;
    retry_count: number;
    last_error: string | null;
    created_at: string;
    processed_at: string | null;
}
export interface NormalizedOrderItem {
    externalItemId: string;
    externalVariantId?: string | null;
    externalName: string;
    quantity: number;
    unitPrice?: number;
    customerCharge?: number;
    specialInstructions?: string | null;
    addons?: Array<{
        id?: string;
        name?: string;
        quantity?: number;
        price?: number;
    }>;
}
export interface NormalizedDeliveryOrder {
    provider: DeliveryProvider;
    externalOrderId: string;
    customerName?: string | null;
    customerPhone?: string | null;
    deliveryAddress?: string | null;
    deliveryNote?: string | null;
    specialInstructions?: string | null;
    deliveryCharge?: number;
    packagingCharge?: number;
    discountAmount?: number;
    subtotal?: number;
    total?: number;
    isPaid?: boolean;
    paymentMethod?: string | null;
    items: NormalizedOrderItem[];
    rawPayload?: unknown;
}
//# sourceMappingURL=types.d.ts.map