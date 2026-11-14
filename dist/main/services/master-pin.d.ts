export declare function isMasterPinAvailable(): boolean;
export declare function isMasterPinSet(): boolean;
/** Sets the master PIN for the first time (first-run setup). */
export declare function setMasterPin(pin: string): void;
/** Overwrites the master PIN for first-run setup or authenticated owner recovery. */
export declare function resetMasterPin(pin: string): void;
export declare function verifyMasterPin(pin: string): boolean;
export declare function isMasterPinRateLimited(key: string): boolean;
export declare function recordMasterPinFailedAttempt(key: string): boolean;
export declare function resetMasterPinRateLimit(key: string): void;
export declare function checkMasterPinRateLimit(key: string): boolean;
export type MasterPinAuthResult = {
    ok: true;
    status?: undefined;
    error?: undefined;
} | {
    ok: false;
    status: number;
    error: string;
};
/** Authorizes master PIN for Express middleware and ipcMain handlers. */
export declare function authorizeMasterPin(pin: string | undefined, rateLimitKey: string): MasterPinAuthResult;
//# sourceMappingURL=master-pin.d.ts.map