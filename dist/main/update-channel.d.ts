/** Resolves updater channel based on running version and beta opt-in settings. */
/** Setting key persisting the in-app beta channel opt-in. */
export declare const BETA_CHANNEL_SETTING_KEY = "updates.beta_channel_enabled";
/** The only prerelease identifier FloCafe treats as a real update channel (#503). */
export type SupportedPrereleaseChannel = 'beta';
export interface ResolvedUpdateChannel {
    /** Value assigned to autoUpdater.channel; null leaves the default feed. */
    channel: SupportedPrereleaseChannel | null;
    allowPrerelease: boolean;
    allowDowngrade: boolean;
}
export interface UpdateChannelInputs {
    /** Prerelease identifier of running semver (e.g. 'beta'), or null for stable. */
    versionPrereleaseChannel: string | null;
    /** Persisted in-app opt-in ("join the beta channel" switch). */
    betaOptIn: boolean;
}
/** Resolves effective updater channel from running version and persisted opt-in. */
export declare function resolveUpdateChannel(inputs: UpdateChannelInputs): ResolvedUpdateChannel;
/** Parses stored setting value for beta opt-in, defaulting by build type. */
export declare function parseStoredBetaChannelEnabled(value: string | null | undefined, defaultForBetaBuild?: boolean): boolean;
//# sourceMappingURL=update-channel.d.ts.map