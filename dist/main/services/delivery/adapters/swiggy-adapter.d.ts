import { DeliveryProviderAdapter, OrderStatusUpdateResult, WebhookValidationResult } from './provider-adapter';
import { DeliveryProvider, ExternalOrderStatus, InternalOrderStatus, NormalizedDeliveryOrder } from '../types';
export declare class SwiggyAdapter implements DeliveryProviderAdapter {
    readonly providerId: DeliveryProvider;
    readonly displayName = "Swiggy";
    isLiveSupported(): boolean;
    validateWebhookSignature(_headers: Record<string, string | string[] | undefined>, _rawPayload: string | unknown, _secret?: string): WebhookValidationResult;
    parseIncomingOrder(payload: unknown): NormalizedDeliveryOrder;
    mapExternalStatus(externalStatus: string): InternalOrderStatus;
    mapInternalStatus(internalStatus: string): ExternalOrderStatus | null;
    updateOrderStatus(externalOrderId: string, targetStatus: ExternalOrderStatus): Promise<OrderStatusUpdateResult>;
}
//# sourceMappingURL=swiggy-adapter.d.ts.map