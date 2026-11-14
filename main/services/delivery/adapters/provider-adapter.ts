import {
  DeliveryProvider,
  ExternalOrderStatus,
  InternalOrderStatus,
  NormalizedDeliveryOrder,
} from '../types';

export interface WebhookValidationResult {
  isValid: boolean;
  reason?: string;
}

export interface OrderStatusUpdateResult {
  success: boolean;
  simulated: boolean;
  message?: string;
}

export interface DeliveryProviderAdapter {
  readonly providerId: DeliveryProvider;
  readonly displayName: string;

  /** Whether live official partner API access is supported. */
  isLiveSupported(): boolean;

  /** Validate incoming webhook signature. */
  validateWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    rawPayload: string | unknown,
    secret?: string,
  ): WebhookValidationResult;

  /** Parse platform-specific payload into standard normalized delivery order format. */
  parseIncomingOrder(payload: unknown): NormalizedDeliveryOrder;

  /** Map external platform status to internal FloCafe POS status. */
  mapExternalStatus(externalStatus: string): InternalOrderStatus;

  /** Map internal FloCafe POS status to external platform status. */
  mapInternalStatus(internalStatus: string): ExternalOrderStatus | null;

  /** Update external order status on delivery platform. */
  updateOrderStatus(
    externalOrderId: string,
    targetStatus: ExternalOrderStatus,
    metadata?: Record<string, unknown>,
  ): Promise<OrderStatusUpdateResult>;
}
