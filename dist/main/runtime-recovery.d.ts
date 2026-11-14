export type RuntimeState = 'starting' | 'ready' | 'stopping' | 'failed';
export type RuntimeServices = {
    main: boolean;
    kds: boolean;
    serverApp: boolean;
};
export type RuntimeActivationAction = 'show' | 'create' | 'wait' | 'relaunch' | 'ignore';
export declare function isRuntimeHealthy(state: RuntimeState, services: RuntimeServices, shutdownRequested: boolean): boolean;
export declare function decideRuntimeActivationAction(input: {
    state: RuntimeState;
    hasWindow: boolean;
    services: RuntimeServices;
    shutdownRequested: boolean;
}): RuntimeActivationAction;
export declare function createRelaunchGate(onRelaunch: (reason: string) => void): (reason: string) => boolean;
/** Checks if current process argv carries relaunch flag to prevent infinite relaunch loops. */
export declare function hasRelaunchAttemptFlag(argv: readonly string[], attemptFlag: string): boolean;
/** Limits the attempt flag check until the runtime first successfully recovers. */
export declare function createRelaunchAttemptGuard(processCarriesAttemptFlag: boolean): {
    hasExhaustedAttempt: () => boolean;
    markRuntimeRecovered: () => void;
};
//# sourceMappingURL=runtime-recovery.d.ts.map