import {
  DeliveryProviderAdapter,
  OrderStatusUpdateResult,
  WebhookValidationResult,
} from './provider-adapter';
import {
  DeliveryProvider,
  ExternalOrderStatus,
  InternalOrderStatus,
  NormalizedDeliveryOrder,
  NormalizedOrderItem,
} from '../types';

interface RawSandboxItem {
  id?: unknown;
  item_id?: unknown;
  itemId?: unknown;
  external_item_id?: unknown;
  externalItemId?: unknown;
  name?: unknown;
  item_name?: unknown;
  external_name?: unknown;
  variant_id?: unknown;
  variantId?: unknown;
  external_variant_id?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  price?: unknown;
  special_instructions?: unknown;
  instructions?: unknown;
  notes?: unknown;
  addons?: Array<{ id?: unknown; name?: unknown; quantity?: unknown; price?: unknown }>;
}

interface RawSandboxOrder {
  id?: unknown;
  order_id?: unknown;
  orderId?: unknown;
  external_order_id?: unknown;
  provider?: unknown;
  items?: RawSandboxItem[];
  customer?: { name?: unknown; phone?: unknown };
  customer_name?: unknown;
  customer_phone?: unknown;
  delivery_address?: unknown;
  deliveryAddress?: unknown;
  delivery_note?: unknown;
  deliveryNote?: unknown;
  special_instructions?: unknown;
  specialInstructions?: unknown;
  delivery_charge?: unknown;
  packaging_charge?: unknown;
  discount_amount?: unknown;
  subtotal?: unknown;
  total?: unknown;
  is_paid?: unknown;
  payment_method?: unknown;
}

export class SandboxAdapter implements DeliveryProviderAdapter {
  readonly providerId: DeliveryProvider = 'sandbox';
  readonly displayName = 'Sandbox Simulator';

  isLiveSupported(): boolean {
    return false;
  }

  validateWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    _rawPayload: string | unknown,
    secret?: string,
  ): WebhookValidationResult {
    // In sandbox mode, test requests pass signature if secret is matched or test header provided
    const provided = headers['x-sandbox-signature'] || headers['x-delivery-signature'];
    if (secret && provided && provided !== secret && provided !== 'valid-sandbox-signature') {
      return { isValid: false, reason: 'Invalid sandbox webhook signature' };
    }
    return { isValid: true };
  }

  parseIncomingOrder(payload: unknown): NormalizedDeliveryOrder {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid Sandbox order payload');
    }
    const data = payload as RawSandboxOrder;
    const orderId = String(data.external_order_id || data.order_id || data.orderId || data.id || '').trim();
    if (!orderId) {
      throw new Error('Sandbox order payload missing external order id');
    }

    const items: NormalizedOrderItem[] = [];
    const rawItems = Array.isArray(data.items) ? data.items : [];
    for (const item of rawItems) {
      const extId = String(item.external_item_id || item.item_id || item.itemId || item.id || '').trim();
      const extVarId = item.external_variant_id || item.variant_id || item.variantId
        ? String(item.external_variant_id || item.variant_id || item.variantId).trim()
        : null;
      const extName = String(item.external_name || item.name || item.item_name || 'Simulated Item').trim();
      const qty = Number(item.quantity || 1);
      const unitPrice = item.unit_price !== undefined ? Number(item.unit_price) : (item.price !== undefined ? Number(item.price) : undefined);

      items.push({
        externalItemId: extId,
        externalVariantId: extVarId,
        externalName: extName,
        quantity: qty > 0 ? qty : 1,
        unitPrice,
        specialInstructions: item.special_instructions || item.instructions || item.notes ? String(item.special_instructions || item.instructions || item.notes) : null,
        addons: Array.isArray(item.addons)
          ? item.addons.map((a) => ({
              id: a.id ? String(a.id) : undefined,
              name: String(a.name || 'Addon'),
              quantity: Number(a.quantity || 1),
              price: a.price !== undefined ? Number(a.price) : undefined,
            }))
          : undefined,
      });
    }

    return {
      provider: (data.provider as DeliveryProvider) || this.providerId,
      externalOrderId: orderId,
      customerName: null,
      customerPhone: null,
      deliveryAddress: data.delivery_address ? String(data.delivery_address) : (data.deliveryAddress ? String(data.deliveryAddress) : '123 Sandbox Lane, Test City'),
      deliveryNote: data.delivery_note ? String(data.delivery_note) : (data.deliveryNote ? String(data.deliveryNote) : 'Ring bell, sandbox delivery'),
      specialInstructions: data.special_instructions ? String(data.special_instructions) : (data.specialInstructions ? String(data.specialInstructions) : null),
      deliveryCharge: data.delivery_charge !== undefined ? Number(data.delivery_charge) : 0,
      packagingCharge: data.packaging_charge !== undefined ? Number(data.packaging_charge) : undefined,
      discountAmount: data.discount_amount !== undefined ? Number(data.discount_amount) : 0,
      subtotal: data.subtotal !== undefined ? Number(data.subtotal) : undefined,
      total: data.total !== undefined ? Number(data.total) : undefined,
      isPaid: data.is_paid !== undefined ? Boolean(data.is_paid) : true,
      paymentMethod: data.payment_method ? String(data.payment_method) : 'Sandbox Prepaid',
      items,
      rawPayload: payload,
    };
  }

  mapExternalStatus(externalStatus: string): InternalOrderStatus {
    const s = String(externalStatus || '').toLowerCase().trim();
    switch (s) {
      case 'received':
      case 'pending':
        return 'pending';
      case 'accepted':
      case 'preparing':
        return 'preparing';
      case 'ready':
        return 'ready';
      case 'dispatched':
      case 'served':
        return 'served';
      case 'delivered':
      case 'completed':
        return 'completed';
      case 'cancelled':
      case 'rejected':
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  mapInternalStatus(internalStatus: string): ExternalOrderStatus | null {
    switch (internalStatus) {
      case 'pending':
        return 'received';
      case 'preparing':
        return 'preparing';
      case 'ready':
        return 'ready';
      case 'served':
        return 'dispatched';
      case 'completed':
        return 'delivered';
      case 'cancelled':
        return 'cancelled';
      default:
        return null;
    }
  }

  async updateOrderStatus(
    externalOrderId: string,
    targetStatus: ExternalOrderStatus,
  ): Promise<OrderStatusUpdateResult> {
    return {
      success: true,
      simulated: true,
      message: `[Sandbox] Order #${externalOrderId} status updated to ${targetStatus}`,
    };
  }
}
