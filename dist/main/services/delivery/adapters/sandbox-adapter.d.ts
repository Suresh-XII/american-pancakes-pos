import { DeliveryProviderAdapter, OrderStatusUpdateResult, WebhookValidationResult } from './provider-adapter';
import { DeliveryProvider, ExternalOrderStatus, InternalOrderStatus, NormalizedDeliveryOrder } from '../types';
export declare class SandboxAdapter implements DeliveryProviderAdapter {
    readonly providerId: DeliveryProvider;
    readonly displayName = "Sandbox Simulator";
    isLiveSupported(): boolean;
    validateWebhookSignature(headers: Record<string, string | string[] | undefined>, _rawPayload: string | unknown, secret?: string): WebhookValidationResult;
    parseIncomingOrder(payload: unknown): NormalizedDeliveryOrder;
    mapExternalStatus(externalStatus: string): InternalOrderStatus;
    mapInternalStatus(internalStatus: string): ExternalOrderStatus | null;
    updateOrderStatus(externalOrderId: string, targetStatus: ExternalOrderStatus): Promise<OrderStatusUpdateResult>;
}
//# sourceMappingURL=sandbox-adapter.d.ts.map