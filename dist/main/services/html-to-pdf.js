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
exports.MAX_PDF_HTML_BYTES = void 0;
exports.setHtmlToPdfRendererForTests = setHtmlToPdfRendererForTests;
exports.isAllowedPdfStagingRequestUrl = isAllowedPdfStagingRequestUrl;
exports.renderHtmlToPdfBuffer = renderHtmlToPdfBuffer;
const electron_1 = require("electron");
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
exports.MAX_PDF_HTML_BYTES = 15 * 1024 * 1024;
let rendererOverride = null;
function setHtmlToPdfRendererForTests(renderer) {
    rendererOverride = renderer;
}
function isAllowedPdfStagingRequestUrl(requestUrl, htmlPath) {
    if (typeof requestUrl !== 'string' || typeof htmlPath !== 'string' || !htmlPath) {
        return false;
    }
    if (requestUrl.startsWith('data:image/')) {
        return true;
    }
    if (!requestUrl.startsWith('file://')) {
        return false;
    }
    const isWindowsPath = process.platform === 'win32' || /^[a-zA-Z]:[\\/]/.test(htmlPath);
    if (isWindowsPath) {
        try {
            const parsed = new URL(requestUrl);
            if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) {
                return false;
            }
            if (parsed.hostname !== '' && parsed.hostname !== 'localhost') {
                return false;
            }
            const rawUrlPath = process.platform === 'win32'
                ? (0, node_url_1.fileURLToPath)(parsed)
                : decodeURIComponent(parsed.pathname).replace(/^\/([a-zA-Z]:[\\/])/, '$1');
            if (!/^[a-zA-Z]:[\\/]/.test(rawUrlPath)) {
                return false;
            }
            return (path.win32.resolve(rawUrlPath).toLowerCase() === path.win32.resolve(htmlPath).toLowerCase());
        }
        catch {
            return false;
        }
    }
    const resolvedHtmlPath = path.resolve(htmlPath);
    const htmlUrl = (0, node_url_1.pathToFileURL)(resolvedHtmlPath).href;
    if (requestUrl === htmlUrl) {
        return true;
    }
    try {
        const parsed = new URL(requestUrl);
        if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) {
            return false;
        }
        return path.resolve((0, node_url_1.fileURLToPath)(parsed)) === resolvedHtmlPath;
    }
    catch {
        return false;
    }
}
async function renderHtmlToPdfBuffer(input) {
    if (typeof input.html !== 'string' || input.html.length === 0)
        throw new Error('Invalid PDF request');
    if (Buffer.byteLength(input.html, 'utf8') > exports.MAX_PDF_HTML_BYTES)
        throw new Error('Document too large to export');
    const pageSize = input.pageSize === 'Letter' ? 'Letter' : 'A4';
    if (rendererOverride)
        return rendererOverride({ html: input.html, pageSize });
    const stagingDirectory = path.join(electron_1.app.getPath('userData'), 'pdf-staging');
    fs.mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });
    const htmlPath = path.join(stagingDirectory, `document-${crypto.randomUUID()}.html`);
    fs.writeFileSync(htmlPath, input.html, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const resolvedHtmlPath = path.resolve(htmlPath);
    const htmlUrl = (0, node_url_1.pathToFileURL)(resolvedHtmlPath).href;
    const pdfWindow = new electron_1.BrowserWindow({
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            javascript: false,
            partition: `qr-menu-pdf-${crypto.randomUUID()}`,
        },
    });
    pdfWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const allowed = details.url === htmlUrl || isAllowedPdfStagingRequestUrl(details.url, resolvedHtmlPath);
        callback({ cancel: !allowed });
    });
    pdfWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pdfWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
        await pdfWindow.loadFile(resolvedHtmlPath);
        return await pdfWindow.webContents.printToPDF({
            printBackground: true,
            pageSize,
            preferCSSPageSize: true,
        });
    }
    finally {
        try {
            fs.unlinkSync(resolvedHtmlPath);
        }
        catch { }
        if (!pdfWindow.isDestroyed())
            pdfWindow.destroy();
    }
}
//# sourceMappingURL=html-to-pdf.js.map