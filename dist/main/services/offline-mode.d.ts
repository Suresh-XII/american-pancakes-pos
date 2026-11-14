export declare const OFFLINE_MODE_SETTING = "offline_mode";
export declare class OfflineModeError extends Error {
    readonly code = "offline_mode";
    constructor(feature: string);
}
/** True when the owner switched every optional outbound connection off. */
export declare function isOfflineMode(): boolean;
/** AbortSignal that aborts whenever the owner switches Offline mode on. */
export declare function getOfflineModeAbortSignal(): AbortSignal;
/** Runs `listener` whenever the owner switches Offline mode on, so live connections can close. */
export declare function onOfflineModeEnabled(listener: () => void): void;
export declare function notifyOfflineModeEnabled(): void;
export declare function assertOnlineAllowed(feature: string): void;
//# sourceMappingURL=offline-mode.d.ts.map