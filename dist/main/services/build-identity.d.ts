export declare function resolveBuildIdentity(metadata: unknown, packaged: boolean): string;
/** A packaged release-workflow build. Local packages and CI test packages are not. */
export declare function resolveOfficialRelease(metadata: unknown, packaged: boolean): boolean;
export interface BuildPostHogSettings {
    token?: string;
    host?: string;
}
/** The PostHog project a release workflow stamped into the build, if any. */
export declare function resolveBuildPostHogSettings(metadata: unknown): BuildPostHogSettings;
export declare function readBuildPostHogSettings(): BuildPostHogSettings;
export declare function isOfficialReleaseBuild(): boolean;
export declare function getBuildIdentity(): string;
//# sourceMappingURL=build-identity.d.ts.map