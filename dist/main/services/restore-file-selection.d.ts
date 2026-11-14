export declare function rememberRestoreFileSelection(selectedPath: string): {
    path: string;
    token: string;
};
export declare function clearRestoreFileSelection(): void;
/** Returns the picked path for a matching token without consuming it, otherwise null. */
export declare function peekRestoreFileSelection(token: string): string | null;
/** Returns the picked path once for a matching token, otherwise null. */
export declare function consumeRestoreFileSelection(token: string): string | null;
//# sourceMappingURL=restore-file-selection.d.ts.map