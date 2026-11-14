export declare const TRANSIENT_LOAD_ERRORS: readonly [-102, -105, -106, -118];
export declare const MAX_LOAD_RETRIES = 10;
export declare const BASE_RETRY_DELAY_MS = 250;
export declare const MAX_RETRY_DELAY_MS = 2000;
export declare const BACKOFF_FACTOR = 1.5;
export declare function calculateRetryDelay(attempt: number, baseDelayMs?: number, maxDelayMs?: number, factor?: number): number;
export declare function isTransientLoadError(errorCode: number): boolean;
export interface WindowLoadRetryLogger {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
export interface WindowLoadRetryOptions {
    maxRetries?: number;
    transientErrors?: readonly number[];
    getRetryDelay?: (attempt: number) => number;
    log?: WindowLoadRetryLogger;
    onRetryExhausted?: (details: WindowLoadRetryExhaustedDetails) => void;
}
export interface WindowLoadRetryExhaustedDetails {
    errorCode: number;
    errorDescription: string;
    validatedURL?: string;
    retries: number;
}
import type { BrowserWindow } from 'electron';
export interface RetryableWebContentsLike {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
}
export interface RetryableWindowLike {
    isDestroyed: () => boolean;
    loadURL: (url: string) => Promise<void> | void;
    webContents: RetryableWebContentsLike;
}
export type RetryableWindow = BrowserWindow | RetryableWindowLike;
export interface WindowLoadRetryController {
    getRetries: () => number;
    getPendingTimer: () => NodeJS.Timeout | null;
    cancel: () => void;
    reset: () => void;
}
/** Retries window loads after transient connection failures up to a bounded budget. */
export declare function setupWindowLoadRetry(window: RetryableWindow, getTargetUrl: () => string, options?: WindowLoadRetryOptions): WindowLoadRetryController;
//# sourceMappingURL=window-load-retry.d.ts.map