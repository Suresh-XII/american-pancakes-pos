/** Anonymous usage telemetry using a randomized local UUID, independent of cloud sync. */
export declare const TELEMETRY_URL = "https://telemetry.flopos.com/collect";
/** How this instance was launched, so a merchant install is distinguishable from a developer's run. */
export type RunMode = 'packaged' | 'dev';
/**
 * Where the running binary came from. `linux_package` is the honest fallback for
 * a native Linux install whose distro is unreadable or unrecognised, so an
 * unknown distribution is never reported as `deb` or `rpm`.
 */
export type InstallSource = 'github' | 'ms_store' | 'mac_app_store' | 'snap' | 'appimage' | 'flatpak' | 'deb' | 'rpm' | 'linux_package' | 'dev';
/**
 * Maps `/etc/os-release` contents to a native Linux package format. `ID` is
 * authoritative; `ID_LIKE` carries the parent families, which is how a
 * derivative such as Rocky Linux or Linux Mint still resolves. Anything else
 * reports `linux_package` rather than a guess.
 */
export declare function linuxPackageFromOsRelease(contents: string): 'deb' | 'rpm' | 'linux_package';
/** `packaged` for a real merchant install, `dev` for `npm run dev` and non-Electron hosts. */
export declare function getRunMode(): RunMode;
/** Classifies the distribution channel the running binary was installed from. */
export declare function getInstallSource(): InstallSource;
export declare function isTelemetrySuppressed(): boolean;
export declare function sendEvent(eventType: string, payload?: Record<string, unknown>): Promise<boolean>;
export type AnonymousDiagnosticDisposition = 'accepted' | 'duplicate' | 'rejected' | 'invalid_ack' | 'report_id_mismatch' | 'network_error';
export type AnonymousDiagnosticResult = {
    disposition: AnonymousDiagnosticDisposition;
    retry_after_ms?: number;
};
/** Sends a store-unlinked count report through the existing anonymous collector. */
export declare function sendAnonymousDiagnosticReport(report: Record<string, unknown>): Promise<AnonymousDiagnosticResult>;
export declare function isTelemetryDailyTimerActive(): boolean;
export declare const telemetry: {
    start(): void;
    resumeDailyChecks(): void;
    stop(): Promise<void>;
};
//# sourceMappingURL=telemetry.d.ts.map