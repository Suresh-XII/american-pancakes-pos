"use strict";
/** Tracks whether store country was user-chosen or defaulted, with OS locale signals. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCountryConfirmed = isCountryConfirmed;
exports.readCountryProvenance = readCountryProvenance;
exports.countryConfirmationPatch = countryConfirmationPatch;
const electron_1 = require("electron");
const db_1 = require("../db");
function normalizeCountry(value) {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
}
/** Returns true if a user has explicitly confirmed or changed the store's country. */
function isCountryConfirmed() {
    return ((0, db_1.getSettingValue)('country_confirmed_at') || '').trim() !== '';
}
/** Safely reads the operating system's region, locale, and timezone. */
function readOsLocale() {
    let osCountry = null;
    let osLocale = null;
    let osTimezone = null;
    try {
        osCountry = normalizeCountry(electron_1.app?.getLocaleCountryCode?.());
    }
    catch { /* signal unavailable */ }
    try {
        const locale = String(electron_1.app?.getLocale?.() || '').trim();
        osLocale = locale !== '' ? locale.slice(0, 35) : null;
    }
    catch { /* signal unavailable */ }
    try {
        const zone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim();
        osTimezone = zone !== '' ? zone.slice(0, 100) : null;
    }
    catch { /* signal unavailable */ }
    return { osCountry, osLocale, osTimezone };
}
function readCountryProvenance() {
    const confirmed = isCountryConfirmed();
    return {
        // Withheld when unconfirmed so remote registry preserves existing values.
        country: confirmed ? normalizeCountry((0, db_1.getSettingValue)('country')) : null,
        countrySource: confirmed ? 'user' : 'default',
        ...readOsLocale(),
    };
}
/** Generates a settings patch stamping country confirmation if explicitly chosen or changed. */
function countryConfirmationPatch(submitted, stored, explicit) {
    const stamp = { country_confirmed_at: new Date().toISOString() };
    if (explicit === true)
        return stamp;
    const code = normalizeCountry(typeof submitted === 'string' ? submitted : null);
    if (!code)
        return {};
    return code === normalizeCountry(stored) ? {} : stamp;
}
//# sourceMappingURL=country-provenance.js.map