"use strict";
/** Manages per-document renderer readiness and fail-safe window display. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initWindowReadiness = initWindowReadiness;
exports.beginRendererDocument = beginRendererDocument;
exports.getRendererReadinessEpoch = getRendererReadinessEpoch;
exports.isFullDocumentMainFrameNavigation = isFullDocumentMainFrameNavigation;
exports.registerRendererDocument = registerRendererDocument;
exports.getRendererDocumentNonce = getRendererDocumentNonce;
exports.markWindowRendererReady = markWindowRendererReady;
exports.isWindowRendererReady = isWindowRendererReady;
exports.isRendererReadinessFailSafeShown = isRendererReadinessFailSafeShown;
exports.isCurrentRendererFrame = isCurrentRendererFrame;
const RENDERER_READINESS_FAILSAFE_MS = 10_000;
const DOCUMENT_NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let rendererReadinessEpoch = 0;
let readyEpoch = null;
let rendererDocumentNonce = null;
let rendererReadinessFailSafeShown = false;
let showWindowFn = null;
let failsafeTimer = null;
let failsafeMs = RENDERER_READINESS_FAILSAFE_MS;
/** Registers the callback used to surface the window (fail-safe path). */
function initWindowReadiness(showWindow, options) {
    showWindowFn = showWindow;
    failsafeMs = Math.max(0, options?.failsafeMs ?? RENDERER_READINESS_FAILSAFE_MS);
}
function clearReadinessFailSafe() {
    if (failsafeTimer !== null) {
        clearTimeout(failsafeTimer);
        failsafeTimer = null;
    }
}
/** Begins a fresh readiness epoch and arms the window display fail-safe. */
function beginRendererDocument() {
    rendererReadinessEpoch += 1;
    readyEpoch = null;
    rendererDocumentNonce = null;
    rendererReadinessFailSafeShown = false;
    clearReadinessFailSafe();
    const epoch = rendererReadinessEpoch;
    failsafeTimer = setTimeout(() => {
        failsafeTimer = null;
        if (epoch !== rendererReadinessEpoch)
            return;
        if (readyEpoch === epoch)
            return;
        rendererReadinessFailSafeShown = true;
        if (showWindowFn) {
            console.error(`[Window] Renderer readiness FAIL-SAFE fired for epoch ${epoch}: ` +
                'the renderer never confirmed its window-control surface (getStatus ' +
                'rejected/hung, or the document failed to mount controls). Showing ' +
                'the window anyway - visible-without-controls beats invisible.');
            showWindowFn();
        }
    }, failsafeMs);
    return epoch;
}
function getRendererReadinessEpoch() {
    return rendererReadinessEpoch;
}
/** True only for a main-frame navigation that creates a new document. */
function isFullDocumentMainFrameNavigation(details) {
    return details.isMainFrame && !details.isSameDocument;
}
function registerRendererDocument(documentNonce) {
    if (typeof documentNonce !== 'string' || !DOCUMENT_NONCE_PATTERN.test(documentNonce))
        return false;
    rendererDocumentNonce = documentNonce;
    return true;
}
function getRendererDocumentNonce() {
    return rendererDocumentNonce;
}
/** Records a valid readiness report matching the current epoch. */
function markWindowRendererReady(epoch, documentNonce) {
    if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 1)
        return false;
    if (epoch !== rendererReadinessEpoch)
        return false;
    if (documentNonce !== rendererDocumentNonce)
        return false;
    readyEpoch = epoch;
    clearReadinessFailSafe();
    return true;
}
/** True when the current document's control surface has confirmed ready. */
function isWindowRendererReady() {
    return readyEpoch === rendererReadinessEpoch && readyEpoch !== null && rendererReadinessEpoch > 0;
}
function isRendererReadinessFailSafeShown() {
    return rendererReadinessFailSafeShown;
}
function isCurrentRendererFrame(senderFrame, currentFrame) {
    return Boolean(senderFrame
        && currentFrame
        && senderFrame.detached !== true
        && currentFrame.detached !== true
        && typeof senderFrame.frameToken === 'string'
        && senderFrame.frameToken === currentFrame.frameToken);
}
//# sourceMappingURL=window-readiness.js.map