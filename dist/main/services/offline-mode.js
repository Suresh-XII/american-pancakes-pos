"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfflineModeError = exports.OFFLINE_MODE_SETTING = void 0;
exports.isOfflineMode = isOfflineMode;
exports.getOfflineModeAbortSignal = getOfflineModeAbortSignal;
exports.onOfflineModeEnabled = onOfflineModeEnabled;
exports.notifyOfflineModeEnabled = notifyOfflineModeEnabled;
exports.assertOnlineAllowed = assertOnlineAllowed;
const db_1 = require("../db");
exports.OFFLINE_MODE_SETTING = 'offline_mode';
class OfflineModeError extends Error {
    code = 'offline_mode';
    constructor(feature) {
        super(`${feature} is unavailable while Offline mode is on`);
        this.name = 'OfflineModeError';
    }
}
exports.OfflineModeError = OfflineModeError;
/** True when the owner switched every optional outbound connection off. */
function isOfflineMode() {
    if (process.env.FLO_MATRIX_OFFLINE === '1')
        return true;
    try {
        return (0, db_1.getSettingValue)(exports.OFFLINE_MODE_SETTING) === 'true';
    }
    catch {
        return false;
    }
}
const enabledListeners = new Set();
let offlineAbortController = new AbortController();
/** AbortSignal that aborts whenever the owner switches Offline mode on. */
function getOfflineModeAbortSignal() {
    if (isOfflineMode()) {
        return AbortSignal.abort(new OfflineModeError('Network request'));
    }
    return offlineAbortController.signal;
}
/** Runs `listener` whenever the owner switches Offline mode on, so live connections can close. */
function onOfflineModeEnabled(listener) {
    enabledListeners.add(listener);
}
function notifyOfflineModeEnabled() {
    offlineAbortController.abort(new OfflineModeError('Network request'));
    offlineAbortController = new AbortController();
    for (const listener of enabledListeners) {
        try {
            listener();
        }
        catch (error) {
            console.error('[OfflineMode] Listener failed:', error);
        }
    }
}
function assertOnlineAllowed(feature) {
    if (isOfflineMode())
        throw new OfflineModeError(feature);
}
//# sourceMappingURL=offline-mode.js.map