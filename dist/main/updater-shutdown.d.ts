import type { RequestOptions } from 'http';
import { CancellationToken } from 'builder-util-runtime';
import { type StoredUpdateStatus, type UpdateErrorPhase } from './update-state';
export type UpdateShutdownState = {
    setInstallingUpdate: (value: boolean) => void;
    setQuitting: (value: boolean) => void;
};
type UpdateAuthorizationResult = {
    ok: true;
} | {
    ok: false;
    error: string;
};
type RestartAndInstallResult = {
    success: true;
} | {
    success: false;
    error: string;
};
type RestartAndInstallOptions = {
    isInstallReady: () => boolean;
    authorize: (pin: string | undefined) => UpdateAuthorizationResult;
    runCleanup: () => Promise<void>;
    quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void;
    updateState: UpdateShutdownState;
    onInstallFailure: (error: unknown) => void;
    warn: (message: string) => void;
    error: (message: string, error: unknown) => void;
};
type AutoUpdaterErrorHandlerOptions = {
    getPhase: () => UpdateErrorPhase;
    setPhase: (phase: UpdateErrorPhase) => void;
    isInstallReady: () => boolean;
    isInstallingUpdate: () => boolean;
    isOfflineSuppressed?: () => boolean;
    isStaleCheckSuppressed?: () => boolean;
    setUpdateStatus: (next: StoredUpdateStatus) => void;
    onInstallFailure: (error: unknown) => void;
    logInfo: (message: string, detail?: unknown) => void;
};
export type UpdateCheckTracker = {
    beginCheck: (runCheck: (checkId: number) => Promise<unknown> | unknown) => number | null;
    invalidateActiveCheck: () => void;
    canAcceptCheckEvent: (checkId?: number) => boolean;
    hasPendingInvalidatedCheck: () => boolean;
};
export declare function createUpdateCheckTracker(options?: {
    shouldRunDeferredCheck?: () => boolean;
}): UpdateCheckTracker;
export type UpdateRequestExecutor = {
    request: (options: RequestOptions, cancellationToken?: CancellationToken, data?: {
        [name: string]: unknown;
    } | null) => Promise<string | null>;
};
export declare function linkUpdateCheckRequests(executor: UpdateRequestExecutor, getCheckToken: () => CancellationToken | null): void;
type SuspendUpdaterForOfflineModeOptions = {
    getPhase: () => UpdateErrorPhase;
    setPhase: (phase: UpdateErrorPhase) => void;
    getStatus: () => StoredUpdateStatus;
    setUpdateStatus: (next: StoredUpdateStatus) => void;
    cancelDownload: () => void;
    invalidateCheck?: () => void;
};
export declare function createSuspendUpdaterForOfflineMode({ getPhase, setPhase, getStatus, setUpdateStatus, cancelDownload, invalidateCheck, }: SuspendUpdaterForOfflineModeOptions): () => void;
export declare function createAutoUpdaterErrorHandler({ getPhase, setPhase, isInstallReady, isInstallingUpdate, isOfflineSuppressed, isStaleCheckSuppressed, setUpdateStatus, onInstallFailure, logInfo, }: AutoUpdaterErrorHandlerOptions): (error: unknown) => void;
export declare function createRestartAndInstallHandler({ isInstallReady, authorize, runCleanup, quitAndInstall, updateState, onInstallFailure, warn, error, }: RestartAndInstallOptions): (event: unknown, pin?: unknown) => Promise<RestartAndInstallResult>;
export {};
//# sourceMappingURL=updater-shutdown.d.ts.map