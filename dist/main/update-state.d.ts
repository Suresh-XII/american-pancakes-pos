/** Update-state model and error classification for the app self-updater. */
/** Every state the updater can be in. Do not add states beyond this list without an approved issue. */
export declare const UPDATE_STATES: readonly ["not-checked-yet", "checking", "up-to-date", "available", "downloading", "ready-to-install", "check-failed", "offline", "store-managed", "linux-managed", "dev-mode"];
export type UpdateState = (typeof UPDATE_STATES)[number];
export interface RuntimeArtifactDescriptor {
    defaultApp: boolean;
    packaged: boolean;
    unpackedMarker: boolean;
}
export declare function isDevelopmentOrUnpackedArtifact(artifact: RuntimeArtifactDescriptor): boolean;
/** Why a check or download failed, when known. */
export type UpdateFailureReason = 'manifest-missing' | 'download-failed' | 'unknown';
/** Phase in which an error occurred to disambiguate check vs download errors. */
export type UpdateErrorPhase = 'check' | 'download';
export interface StoredUpdateStatus {
    status: UpdateState;
    /** Version of the available/downloaded update (not the running version). */
    version?: string;
    releaseDate?: string;
    releaseNotes?: unknown;
    percent?: number;
    reason?: UpdateFailureReason;
    /** Raw error detail; renderers show it only as a secondary details line. */
    error?: string;
}
export interface ClassifiedUpdateError {
    state: Extract<UpdateState, 'check-failed' | 'offline'>;
    reason: UpdateFailureReason;
    /** Human-readable raw error message for the details line / main.log. */
    detail: string;
}
export declare function isMissingUpdateConfigError(err: unknown): boolean;
/** Classify an electron-updater error into an honest user-facing state. */
export declare function classifyUpdateError(err: unknown, phase?: UpdateErrorPhase): ClassifiedUpdateError;
/** Initial stored state before any check has ever run. */
export declare function initialUpdateState(): StoredUpdateStatus;
declare const ONE_SHOT_STATES: readonly ["store-managed", "linux-managed", "dev-mode"];
export type OneShotUpdateState = (typeof ONE_SHOT_STATES)[number];
export declare function isOneShotUpdateState(state: UpdateState): state is OneShotUpdateState;
/** Build stored state for a one-shot startup detection that persists across reloads. */
export declare function oneShotUpdateState(state: OneShotUpdateState): StoredUpdateStatus;
export declare function missingUpdateConfigState(isDevelopmentArtifact: boolean, detail: string): StoredUpdateStatus;
export declare function isInstallReady(stored: StoredUpdateStatus, stagedUpdateReady: boolean): boolean;
export declare function isUpdateCheckInFlight(stored: StoredUpdateStatus, phase: UpdateErrorPhase): boolean;
export declare function canAcceptUpdateCheckResult(stored: StoredUpdateStatus, phase: UpdateErrorPhase, offlineMode: boolean, checkActive?: boolean): boolean;
/** Downloads start only after the user accepts an available update. */
export declare function canStartUpdateDownload(stored: StoredUpdateStatus, phase: UpdateErrorPhase, stagedUpdateReady: boolean): boolean;
/** Setting key for the automatic startup update check; manual checks always work. */
export declare const AUTO_UPDATE_CHECK_SETTING_KEY = "updates.auto_check_enabled";
export declare function parseStoredAutoUpdateCheckEnabled(value: string | null | undefined): boolean;
/** Payload shape returned by the `get-update-status` IPC handler. */
export interface IpcUpdateStatusPayload {
    status: StoredUpdateStatus['status'];
    version?: string;
    percent?: number;
    reason?: UpdateFailureReason;
    error?: string;
    info: {
        version: string;
    };
}
/** Derives the IPC response payload from the stored update state. */
export declare function toIpcUpdateStatus(stored: StoredUpdateStatus, currentVersion: string): IpcUpdateStatusPayload;
export {};
//# sourceMappingURL=update-state.d.ts.map