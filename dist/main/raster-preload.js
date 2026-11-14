"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { contextBridge, ipcRenderer } = require('electron');
let readySent = false;
/** The raster surface exposes only request delivery and result submission. */
contextBridge.exposeInMainWorld('__floRaster', {
    onRequest: (callback) => {
        const handler = (_event, request) => callback(request);
        ipcRenderer.on('flo:raster-request', handler);
        if (!readySent) {
            readySent = true;
            ipcRenderer.send('flo:raster-ready');
        }
        return () => ipcRenderer.removeListener('flo:raster-request', handler);
    },
    sendResult: (result) => ipcRenderer.send('flo:raster-result', result),
});
//# sourceMappingURL=raster-preload.js.map