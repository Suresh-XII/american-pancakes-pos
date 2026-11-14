"use strict";
/** Order and item notes validation functions. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOrderNotes = validateOrderNotes;
exports.validateItemNotes = validateItemNotes;
exports.validateCustomerAddress = validateCustomerAddress;
exports.validateDeliveryAddress = validateDeliveryAddress;
exports.validateDeliveryNote = validateDeliveryNote;
exports.resolveExpectedPaymentMethod = resolveExpectedPaymentMethod;
exports.resolveExpectedPaymentMethodIdentity = resolveExpectedPaymentMethodIdentity;
exports.validateProductQuantity = validateProductQuantity;
const DEFAULT_MAX_ORDER_NOTES_LENGTH = 200;
const DEFAULT_MAX_ITEM_NOTES_LENGTH = 100;
const DEFAULT_MAX_CUSTOMER_ADDRESS_LENGTH = 300;
const DEFAULT_MAX_DELIVERY_ADDRESS_LENGTH = 300;
const DEFAULT_MAX_DELIVERY_NOTE_LENGTH = 200;
/** Built-in methods a courier can collect at the door; wallet and loyalty settle in-store. */
const COURIER_COLLECTIBLE_METHODS = ['cash', 'card', 'upi'];
function validateNoteLength(db, settingKey, defaultLimit, notes, label) {
    if (!notes)
        return;
    const rawValue = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey)?.value;
    const parsed = parseInt(rawValue || '', 10);
    const maxLength = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimit;
    if (notes.length > maxLength) {
        throw new Error(`${label} exceed maximum length of ${maxLength} characters`);
    }
}
function validateOrderNotes(db, notes) {
    validateNoteLength(db, 'max_order_notes_length', DEFAULT_MAX_ORDER_NOTES_LENGTH, notes, 'Order notes');
}
function validateItemNotes(db, notes) {
    validateNoteLength(db, 'max_item_notes_length', DEFAULT_MAX_ITEM_NOTES_LENGTH, notes, 'Item notes');
}
/** Refuses a too-long new value; never rewrites a legacy row that is too long. */
function validateCustomerAddress(db, address) {
    validateNoteLength(db, 'max_customer_address_length', DEFAULT_MAX_CUSTOMER_ADDRESS_LENGTH, address, 'Customer address');
}
/** Free text bound for a printed document, so nothing unbounded is persisted. */
function validateDeliveryAddress(db, address) {
    validateNoteLength(db, 'max_delivery_address_length', DEFAULT_MAX_DELIVERY_ADDRESS_LENGTH, address, 'Delivery address');
}
/** Courier-only free text, bounded for the slip like the delivery address. */
function validateDeliveryNote(db, note) {
    validateNoteLength(db, 'max_delivery_note_length', DEFAULT_MAX_DELIVERY_NOTE_LENGTH, note, 'Delivery note');
}
/**
 * The method the courier expects to collect, never a record of payment. Null is
 * unknown; `pending` means the customer has not decided yet.
 */
function resolveExpectedPaymentMethod(db, value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'string')
        throw new Error('expected_payment_method must be a string');
    const method = value.trim();
    const normalized = method.toLowerCase();
    if (normalized === '' || normalized === 'unknown')
        return null;
    if (normalized === 'pending' || normalized === 'cash' || normalized === 'card')
        return normalized;
    const custom = db
        .prepare('SELECT name FROM payment_methods WHERE name = ? COLLATE NOCASE AND is_active = 1')
        .get(method);
    if (custom?.name)
        return custom.name;
    if (normalized === 'upi')
        return 'UPI';
    throw new Error('expected_payment_method must be unknown, pending, cash, card, upi, or an active payment method');
}
/**
 * Resolves the explicit custom-method identity a caller sends alongside the name
 * snapshot. The ID is the durable marker, so it is resolved against the active
 * configuration here and the canonical name is stored with it; the optional name
 * is only checked for agreement and never invented. Null keeps the legacy
 * string/sentinel contract untouched.
 */
function resolveExpectedPaymentMethodIdentity(db, methodId, methodName) {
    if (methodId === undefined || methodId === null)
        return null;
    if (typeof methodId !== 'number' || !Number.isSafeInteger(methodId) || methodId <= 0) {
        throw new Error('expected_payment_method_id must be a positive integer');
    }
    const method = db
        .prepare('SELECT id, name FROM payment_methods WHERE id = ? AND is_active = 1')
        .get(methodId);
    if (!method) {
        throw new Error('expected_payment_method_id must reference an active payment method');
    }
    if (methodName !== undefined && methodName !== null && typeof methodName !== 'string') {
        throw new Error('expected_payment_method must be a string');
    }
    const suppliedName = typeof methodName === 'string' ? methodName.trim() : '';
    if (suppliedName && suppliedName.toLowerCase() !== method.name.toLowerCase()) {
        throw new Error('expected_payment_method does not match expected_payment_method_id');
    }
    return { id: method.id, name: method.name };
}
function validateProductQuantity(product, quantity) {
    const productName = product.name || 'product';
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
        throw Object.assign(new Error(`Invalid quantity for ${productName}: must be a positive number`), { statusCode: 400, diagnosticCode: 'quantity_invalid' });
    }
    if (Number.isInteger(quantity))
        return;
    if (!['kg', 'g', 'lb', 'ml', 'cl', 'l', 'fl oz', 'oz'].includes(product.sale_unit || 'each') ||
        Number(product.allow_fractional_quantity) !== 1) {
        throw Object.assign(new Error(`Invalid quantity for ${productName}: fractional quantities are not allowed`), { statusCode: 400, diagnosticCode: 'quantity_invalid' });
    }
    const precision = Number.isInteger(product.weight_precision)
        ? Math.min(Math.max(Number(product.weight_precision), 0), 4)
        : 3;
    const scale = 10 ** precision;
    if (Math.abs(quantity * scale - Math.round(quantity * scale)) > 1e-8) {
        throw Object.assign(new Error(`Invalid quantity for ${productName}: use at most ${precision} decimal places`), { statusCode: 400, diagnosticCode: 'quantity_invalid' });
    }
}
//# sourceMappingURL=orders-validation.js.map