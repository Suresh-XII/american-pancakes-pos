import type { BrowserWindow, IpcMain } from 'electron';
import { type StoredUpdateStatus, type UpdateErrorPhase } from './update-state';
import type { TitleBarMode } from './window-options';
export type DirectUpdateIpcOptions = {
    ipcMain: Pick<IpcMain, 'handle'>;
    getMainWindow: () => BrowserWindow | null;
    getServerPort: () => number;
    getStoredUpdateStatus: () => StoredUpdateStatus;
    getStagedUpdateReady: () => boolean;
    getUpdaterPhase: () => UpdateErrorPhase;
    getAppVersion: () => string;
    checkForUpdates: () => void;
    downloadUpdate: () => Promise<unknown> | unknown;
    readAutoUpdateCheckEnabled: () => boolean;
    writeAutoUpdateCheckEnabled: (enabled: boolean) => void;
    readBetaChannelEnabled: () => boolean;
    writeBetaChannelEnabled: (enabled: boolean) => void;
    enqueueBetaChannelTransition: <T>(action: () => Promise<T>) => Promise<T>;
    configureAutoUpdaterChannel: (enabled: boolean) => void;
    setUpdateStatus: (status: StoredUpdateStatus) => void;
    restartAndInstallHandler: (event: unknown, pin?: unknown) => Promise<{
        success: boolean;
        error?: string;
    }>;
    isServerRunning: () => boolean;
    isKdsServerRunning: () => boolean;
    isServerAppRunning: () => boolean;
    getResolvedTitleBarMode: () => TitleBarMode;
    getRendererReadinessEpoch: () => number;
    getRendererDocumentNonce: () => string | null | undefined;
    getCurrentEffectiveIsDark: () => boolean;
    setCurrentEffectiveIsDark: (isDark: boolean) => void;
    applyTitleBarOverlayTheme: (win: BrowserWindow, isDark: boolean, platform: NodeJS.Platform) => void;
    resolveTitleBarOverlayColors: (isDark: boolean) => {
        color: string;
        symbolColor: string;
    };
    withDatabaseRequest: <T>(action: () => T | Promise<T>) => Promise<T>;
    log?: {
        info: (msg: string) => void;
        warn: (msg: string, ...args: unknown[]) => void;
        error: (msg: string, ...args: unknown[]) => void;
    };
    validateSender?: (event: unknown) => boolean;
};
export type DirectUpdateHandlers = Record<string, (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>>;
export declare function createDirectUpdateIpcHandlers(options: DirectUpdateIpcOptions): DirectUpdateHandlers;
export declare function registerDirectUpdateIpcHandlers(options: DirectUpdateIpcOptions): void;
//# sourceMappingURL=update-ipc.d.ts.map