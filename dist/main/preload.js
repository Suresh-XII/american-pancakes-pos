"use strict";
const { contextBridge, ipcRenderer } = require('electron');
const documentNonce = globalThis.crypto.randomUUID();
ipcRenderer.sendSync('window-document', documentNonce);
contextBridge.exposeInMainWorld('electronAPI', {
    backupDatabase: (pin) => ipcRenderer.invoke('backup-database', pin),
    restoreBackup: (pin, backupPath) => ipcRenderer.invoke('restore-backup', pin, backupPath),
    pickRestoreFile: () => ipcRenderer.invoke('pick-restore-file'),
    dbHealthCheck: () => ipcRenderer.invoke('db-health-check'),
    dbApplySafeFixes: (pin, findingIds) => ipcRenderer.invoke('db-apply-safe-fixes', pin, findingIds),
    dbInitialize: (pin, confirmationPhrase) => ipcRenderer.invoke('db-initialize', { pin, confirmationPhrase }),
    getMasterPinStatus: () => ipcRenderer.invoke('master-pin-status'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
    // Pushes resolved dark mode state to main for native title bar updates.
    setThemeEffective: (isDark) => ipcRenderer.invoke('set-theme-effective', isDark),
    getKdsInfo: () => ipcRenderer.invoke('get-kds-info'),
    openKdsWindow: () => ipcRenderer.invoke('open-kds-window'),
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    getLogTail: () => ipcRenderer.invoke('get-log-tail'),
    // Fire-and-forget: reports a caught renderer render exception (see the
    // dashboard error boundary) to anonymous telemetry via main.
    reportRendererError: (report) => ipcRenderer.invoke('report-renderer-error', report),
    getPostHogBootstrap: () => ipcRenderer.invoke('get-posthog-bootstrap'),
    getStatus: () => ipcRenderer.invoke('get-status'),
    openWhatsAppShare: (url) => ipcRenderer.invoke('whatsapp-open-share', url),
    windowReady: (payload) => ipcRenderer.invoke('window-ready', { ...payload, documentNonce }),
    // Narrow window-control surface for the renderer title bar's HTML fallback
    // controls and the POS topbar's native window-state toggle.
    windowAction: (action) => ipcRenderer.invoke('window-action', action),
    getWindowState: () => ipcRenderer.invoke('get-window-state'),
    onWindowStateChanged: (callback) => {
        const handler = (_event, state) => callback(state);
        ipcRenderer.on('window-state-changed', handler);
        return () => {
            ipcRenderer.removeListener('window-state-changed', handler);
        };
    },
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    rasterizePrintDocument: (request) => ipcRenderer.invoke('rasterize-print-document', request),
    rasterizeKotDocument: (request) => ipcRenderer.invoke('rasterize-kot-document', request),
    saveHtmlAsPdf: (request) => ipcRenderer.invoke('save-html-as-pdf', request),
    getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
    getBetaChannel: () => ipcRenderer.invoke('updates:get-beta-channel'),
    setBetaChannel: (enabled) => ipcRenderer.invoke('updates:set-beta-channel', enabled),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    getAutoUpdateCheck: () => ipcRenderer.invoke('updates:get-auto-check'),
    setAutoUpdateCheck: (enabled) => ipcRenderer.invoke('updates:set-auto-check', enabled),
    restartAndInstall: (pin) => ipcRenderer.invoke('restart-and-install', pin),
    onUpdateStatus: (callback) => {
        const handler = (_event, status) => callback(status);
        ipcRenderer.on('update-status', handler);
        return () => {
            ipcRenderer.removeListener('update-status', handler);
        };
    },
    // Windows/Linux title-bar menu row. The labels come from the main-process
    // application menu; each click pops that entry's real submenu.
    getApplicationMenu: () => ipcRenderer.invoke('get-application-menu'),
    openApplicationMenu: (key, x, y) => ipcRenderer.invoke('open-application-menu', key, x, y),
    onMenuAction: (callback) => {
        const channels = [
            'new-order',
            'quick-search',
            'backup-database',
            'menu-restore-from-file',
            'view-orders',
            'report-daily',
            'report-sales',
            'report-x',
            'report-z',
            'go-pos',
            'go-dashboard',
            'go-orders',
            'go-kds',
            'go-tables',
            'go-products',
            'go-inventory',
            'go-customers',
            'go-staff',
            'settings-business',
            'settings-tax',
            'settings-printer',
            'settings-kitchen',
            'menu-db-health-check',
            'menu-db-initialize',
            'menu-master-pin',
        ];
        const handlers = [];
        channels.forEach((channel) => {
            const handler = () => callback(channel);
            ipcRenderer.on(channel, handler);
            handlers.push(() => ipcRenderer.removeListener(channel, handler));
        });
        return () => {
            handlers.forEach((remove) => remove());
        };
    },
    platform: process.platform,
});
//# sourceMappingURL=preload.js.map