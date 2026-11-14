"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRuntimeHealthy = isRuntimeHealthy;
exports.decideRuntimeActivationAction = decideRuntimeActivationAction;
exports.createRelaunchGate = createRelaunchGate;
exports.hasRelaunchAttemptFlag = hasRelaunchAttemptFlag;
exports.createRelaunchAttemptGuard = createRelaunchAttemptGuard;
function isRuntimeHealthy(state, services, shutdownRequested) {
    return state === 'ready'
        && !shutdownRequested
        && services.main
        && services.kds
        && services.serverApp;
}
function decideRuntimeActivationAction(input) {
    if (input.shutdownRequested || input.state === 'stopping')
        return 'ignore';
    if (input.state === 'failed')
        return 'relaunch';
    if (input.state === 'starting')
        return 'wait';
    if (!isRuntimeHealthy(input.state, input.services, input.shutdownRequested))
        return 'relaunch';
    return input.hasWindow ? 'show' : 'create';
}
function createRelaunchGate(onRelaunch) {
    let relaunchRequested = false;
    return (reason) => {
        if (relaunchRequested)
            return false;
        relaunchRequested = true;
        onRelaunch(reason);
        return true;
    };
}
/** Checks if current process argv carries relaunch flag to prevent infinite relaunch loops. */
function hasRelaunchAttemptFlag(argv, attemptFlag) {
    return argv.includes(attemptFlag);
}
/** Limits the attempt flag check until the runtime first successfully recovers. */
function createRelaunchAttemptGuard(processCarriesAttemptFlag) {
    let recovered = false;
    return {
        hasExhaustedAttempt: () => processCarriesAttemptFlag && !recovered,
        markRuntimeRecovered: () => { recovered = true; },
    };
}
//# sourceMappingURL=runtime-recovery.js.map