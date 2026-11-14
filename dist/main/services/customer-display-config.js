"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOMER_DISPLAY_DEFAULTS = exports.CUSTOMER_DISPLAY_STATUSES = exports.CUSTOMER_DISPLAY_KEY = void 0;
exports.parseCustomerDisplayConfig = parseCustomerDisplayConfig;
exports.readStoredCustomerDisplayConfig = readStoredCustomerDisplayConfig;
exports.CUSTOMER_DISPLAY_KEY = 'customer_display';
exports.CUSTOMER_DISPLAY_STATUSES = ['pending', 'preparing', 'ready'];
exports.CUSTOMER_DISPLAY_DEFAULTS = {
    statuses: [...exports.CUSTOMER_DISPLAY_STATUSES],
    refresh_seconds: 3,
    show_updated: true,
};
/** Returns the normalized config, or null when the payload is malformed. */
function parseCustomerDisplayConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const { statuses, refresh_seconds, show_updated } = value;
    if (!Array.isArray(statuses) ||
        statuses.length === 0 ||
        !statuses.every((status) => exports.CUSTOMER_DISPLAY_STATUSES.includes(status))) {
        return null;
    }
    if (typeof refresh_seconds !== 'number' ||
        !Number.isInteger(refresh_seconds) ||
        refresh_seconds < 2 ||
        refresh_seconds > 60) {
        return null;
    }
    if (typeof show_updated !== 'boolean')
        return null;
    return {
        statuses: exports.CUSTOMER_DISPLAY_STATUSES.filter((status) => statuses.includes(status)),
        refresh_seconds,
        show_updated,
    };
}
/** Parses a stored settings value, falling back to defaults when absent or invalid. */
function readStoredCustomerDisplayConfig(raw) {
    if (!raw)
        return { ...exports.CUSTOMER_DISPLAY_DEFAULTS };
    try {
        return parseCustomerDisplayConfig(JSON.parse(raw)) ?? { ...exports.CUSTOMER_DISPLAY_DEFAULTS };
    }
    catch {
        return { ...exports.CUSTOMER_DISPLAY_DEFAULTS };
    }
}
//# sourceMappingURL=customer-display-config.js.map