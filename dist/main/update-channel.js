"use strict";
/** Resolves updater channel based on running version and beta opt-in settings. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BETA_CHANNEL_SETTING_KEY = void 0;
exports.resolveUpdateChannel = resolveUpdateChannel;
exports.parseStoredBetaChannelEnabled = parseStoredBetaChannelEnabled;
/** Setting key persisting the in-app beta channel opt-in. */
exports.BETA_CHANNEL_SETTING_KEY = 'updates.beta_channel_enabled';
/** Resolves effective updater channel from running version and persisted opt-in. */
function resolveUpdateChannel(inputs) {
    const betaBuild = inputs.versionPrereleaseChannel === 'beta';
    if (inputs.betaOptIn) {
        return { channel: 'beta', allowPrerelease: true, allowDowngrade: betaBuild };
    }
    return { channel: null, allowPrerelease: false, allowDowngrade: false };
}
/** Parses stored setting value for beta opt-in, defaulting by build type. */
function parseStoredBetaChannelEnabled(value, defaultForBetaBuild = false) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return defaultForBetaBuild;
}
//# sourceMappingURL=update-channel.js.map