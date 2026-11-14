import type { dialog as ElectronDialog, shell as ElectronShell } from 'electron';
import type { DowngradeBackupDiscovery, DowngradeRestoreOptions, DowngradeRestoreResult, SchemaVersionMismatchError } from './db';
export declare const FLOCAFE_RELEASES_URL = "https://github.com/FreeOpenSourcePOS/FloCafe/releases";
export interface DowngradeRecoveryLogger {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
export interface DowngradeRecoveryDeps {
    appVersion: string;
    dialog: Pick<typeof ElectronDialog, 'showMessageBox'>;
    shell: Pick<typeof ElectronShell, 'openExternal' | 'openPath'>;
    log: DowngradeRecoveryLogger;
    isShutdownRequested: () => boolean;
    discoverBackups: () => Promise<DowngradeBackupDiscovery>;
    planPreservedArchivePath: (newerDbVersion: number) => string;
    restoreBackup: (backupPath: string, options?: DowngradeRestoreOptions) => Promise<DowngradeRestoreResult>;
    getBackupDir: () => string;
    getDbPath: () => string;
}
export type DowngradeRecoveryOutcome = {
    outcome: 'exit';
} | {
    outcome: 'opened_releases';
    url: string;
} | {
    outcome: 'restored';
    result: DowngradeRestoreResult;
};
export declare function runDowngradeRecoveryFlow(mismatch: SchemaVersionMismatchError, deps: DowngradeRecoveryDeps): Promise<DowngradeRecoveryOutcome>;
//# sourceMappingURL=downgrade-recovery.d.ts.map