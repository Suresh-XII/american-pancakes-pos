/** Manages per-document renderer readiness and fail-safe window display. */
/** Registers the callback used to surface the window (fail-safe path). */
export declare function initWindowReadiness(showWindow: () => void, options?: {
    failsafeMs?: number;
}): void;
/** Begins a fresh readiness epoch and arms the window display fail-safe. */
export declare function beginRendererDocument(): number;
export declare function getRendererReadinessEpoch(): number;
/** True only for a main-frame navigation that creates a new document. */
export declare function isFullDocumentMainFrameNavigation(details: {
    isMainFrame: boolean;
    isSameDocument: boolean;
}): boolean;
export declare function registerRendererDocument(documentNonce: unknown): boolean;
export declare function getRendererDocumentNonce(): string | null;
/** Records a valid readiness report matching the current epoch. */
export declare function markWindowRendererReady(epoch: unknown, documentNonce: unknown): boolean;
/** True when the current document's control surface has confirmed ready. */
export declare function isWindowRendererReady(): boolean;
export declare function isRendererReadinessFailSafeShown(): boolean;
export declare function isCurrentRendererFrame(senderFrame: {
    frameToken?: string;
    detached?: boolean;
} | null | undefined, currentFrame: {
    frameToken?: string;
    detached?: boolean;
} | null | undefined): boolean;
//# sourceMappingURL=window-readiness.d.ts.map