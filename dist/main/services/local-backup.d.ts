/** Daily automatic database backups kept outside the app's data folder. */
export declare const LOCAL_BACKUP_SETTING_KEY = "local_backup_enabled";
export declare const LOCAL_BACKUP_RETENTION = 5;
export declare function getLocalBackupDir(): string;
export declare function isLocalBackupEnabled(): boolean;
export declare function setLocalBackupEnabled(enabled: boolean): void;
export declare function localBackupFileName(at: Date): string;
export declare function parseLocalBackupTime(fileName: string): number | null;
/**
 * Newest first. Files dated ahead of the clock sort last: their time cannot be trusted.
 * Only files this service wrote are ever listed.
 */
export declare function listLocalBackups(dir?: string, nowMs?: number): string[];
export declare function getLastLocalBackupAt(dir?: string): string | null;
export declare function isLocalBackupDue(newestFileName: string | undefined, nowMs?: number): boolean;
/** Keeps the newest backups by listing order; `justWritten` is always kept. */
export declare function pruneLocalBackups(dir: string, keep?: number, justWritten?: string): string[];
/** Copies a finished backup into the local backup folder and applies retention. Best effort. */
export declare function retainBackupLocally(sourcePath: string): string | null;
declare class LocalBackupService {
    private timer;
    private startupTimer;
    private running;
    private abortController;
    private stopping;
    start(): void;
    stop(): Promise<void>;
    cancel(): void;
    runIfDue(): Promise<void>;
    private backupIfDue;
}
export declare const localBackup: LocalBackupService;
export {};
//# sourceMappingURL=local-backup.d.ts.map