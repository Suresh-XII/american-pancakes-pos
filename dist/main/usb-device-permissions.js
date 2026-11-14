"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUsbDevicePermissions = registerUsbDevicePermissions;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Identifies unique physical USB device via vendorId, productId, and serialNumber. */
function persistableDeviceKey(device) {
    return device.serialNumber ? `${device.vendorId}:${device.productId}:${device.serialNumber}` : null;
}
function approvalsFilePath() {
    return path.join(electron_1.app.getPath('userData'), 'usb-printer-approvals.json');
}
function loadPersistedApprovals() {
    try {
        const raw = fs.readFileSync(approvalsFilePath(), 'utf8');
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
    }
    catch {
        return new Set();
    }
}
function savePersistedApprovals(keys) {
    try {
        fs.writeFileSync(approvalsFilePath(), JSON.stringify([...keys]), { mode: 0o600 });
    }
    catch (err) {
        console.warn('[Printer] Failed to persist USB device approval:', err);
    }
}
/** Registers Electron USB permission handlers scoped to the trusted origin. */
function registerUsbDevicePermissions(session, trustedOrigin) {
    const persistedApprovedKeys = loadPersistedApprovals();
    const sessionApprovedDeviceIds = new Set();
    const isApproved = (device) => {
        const persistKey = persistableDeviceKey(device);
        if (persistKey && persistedApprovedKeys.has(persistKey))
            return true;
        return sessionApprovedDeviceIds.has(device.deviceId);
    };
    const markApproved = (device) => {
        sessionApprovedDeviceIds.add(device.deviceId);
        const persistKey = persistableDeviceKey(device);
        if (persistKey) {
            persistedApprovedKeys.add(persistKey);
            savePersistedApprovals(persistedApprovedKeys);
        }
    };
    session.on('select-usb-device', (event, details, callback) => {
        event.preventDefault();
        if (details.frame?.origin !== trustedOrigin) {
            callback();
            return;
        }
        const device = details.deviceList[0];
        if (!device) {
            callback();
            return;
        }
        if (isApproved(device)) {
            callback(device.deviceId);
            return;
        }
        const deviceLabel = device.productName
            ? `${device.productName}${device.manufacturerName ? ` (${device.manufacturerName})` : ''}`
            : `USB device ${device.vendorId.toString(16).padStart(4, '0')}:${device.productId.toString(16).padStart(4, '0')}`;
        electron_1.dialog.showMessageBox({
            type: 'question',
            buttons: ['Allow', 'Deny'],
            defaultId: 0,
            cancelId: 1,
            title: 'Connect USB printer',
            message: 'FloCafe wants to connect to a USB device',
            detail: deviceLabel,
        }).then((result) => {
            if (result.response === 0) {
                markApproved(device);
                callback(device.deviceId);
            }
            else {
                callback();
            }
        }).catch(() => callback());
    });
    session.setDevicePermissionHandler((details) => {
        if (details.deviceType !== 'usb' || details.origin !== trustedOrigin)
            return false;
        return isApproved(details.device);
    });
}
//# sourceMappingURL=usb-device-permissions.js.map