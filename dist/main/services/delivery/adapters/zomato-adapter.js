"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZomatoAdapter = void 0;
class ZomatoAdapter {
    providerId = 'zomato';
    displayName = 'Zomato';
    isLiveSupported() {
        // Official partner API access has not yet been granted.
        return false;
    }
    validateWebhookSignature(_headers, _rawPayload, _secret) {
        // Live signature verification requires official Zomato partner API documentation & secret.
        return {
            isValid: false,
            reason: 'Official Zomato partner webhook signature verification pending official partner onboarding.',
        };
    }
    parseIncomingOrder(payload) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid Zomato order payload');
        }
        const data = payload;
        const orderId = String(data.order_id || data.orderId || data.id || '').trim();
        if (!orderId) {
            throw new Error('Zomato order payload missing external order id');
        }
        const items = [];
        const rawItems = Array.isArray(data.items) ? data.items : (Array.isArray(data.order_items) ? data.order_items : []);
        for (const item of rawItems) {
            const extId = String(item.item_id || item.itemId || item.id || '').trim();
            const extVarId = item.variant_id || item.variantId ? String(item.variant_id || item.variantId).trim() : null;
            const extName = String(item.name || item.item_name || 'Zomato Item').trim();
            const qty = Number(item.quantity || 1);
            const unitPrice = item.unit_price !== undefined ? Number(item.unit_price) : (item.price !== undefined ? Number(item.price) : undefined);
            items.push({
                externalItemId: extId,
                externalVariantId: extVarId,
                externalName: extName,
                quantity: qty > 0 ? qty : 1,
                unitPrice,
                specialInstructions: item.instructions || item.notes ? String(item.instructions || item.notes) : null,
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
            provider: this.providerId,
            externalOrderId: orderId,
            customerName: null,
            customerPhone: null,
            deliveryAddress: data.delivery_address ? String(data.delivery_address) : (data.deliveryAddress ? String(data.deliveryAddress) : (data.address ? String(data.address) : null)),
            deliveryNote: data.delivery_note ? String(data.delivery_note) : (data.deliveryNote ? String(data.deliveryNote) : null),
            specialInstructions: data.special_instructions ? String(data.special_instructions) : (data.specialInstructions ? String(data.specialInstructions) : null),
            deliveryCharge: data.delivery_charge !== undefined ? Number(data.delivery_charge) : undefined,
            packagingCharge: data.packaging_charge !== undefined ? Number(data.packaging_charge) : undefined,
            discountAmount: data.discount_amount !== undefined ? Number(data.discount_amount) : undefined,
            subtotal: data.subtotal !== undefined ? Number(data.subtotal) : undefined,
            total: data.total !== undefined ? Number(data.total) : undefined,
            isPaid: data.payment_status === 'paid' || data.is_paid === true,
            paymentMethod: data.payment_method ? String(data.payment_method) : 'Zomato Online',
            items,
            rawPayload: payload,
        };
    }
    mapExternalStatus(externalStatus) {
        const s = String(externalStatus || '').toLowerCase().trim();
        switch (s) {
            case 'received':
            case 'placed':
            case 'order_placed':
            case 'pending':
                return 'pending';
            case 'accepted':
            case 'confirmed':
            case 'preparing':
            case 'in_kitchen':
                return 'preparing';
            case 'ready':
            case 'ready_for_pickup':
            case 'food_ready':
                return 'ready';
            case 'dispatched':
            case 'picked_up':
            case 'on_the_way':
            case 'out_for_delivery':
                return 'served';
            case 'delivered':
            case 'completed':
                return 'completed';
            case 'cancelled':
            case 'rejected':
            case 'failed':
                return 'cancelled';
            default:
                return 'pending';
        }
    }
    mapInternalStatus(internalStatus) {
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
    async updateOrderStatus(externalOrderId, targetStatus) {
        if (!this.isLiveSupported()) {
            return {
                success: true,
                simulated: true,
                message: `Zomato order #${externalOrderId} status mapped to "${targetStatus}". Live API update skipped: official partner credentials pending.`,
            };
        }
        throw new Error('Live Zomato connectivity is not yet available.');
    }
}
exports.ZomatoAdapter = ZomatoAdapter;
//# sourceMappingURL=zomato-adapter.js.map