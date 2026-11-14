"use strict";
/** PostHog project configuration. Without a token the client sends nothing. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_POSTHOG_HOST = exports.POSTHOG_HOST_SETTING = exports.POSTHOG_PROJECT_TOKEN_SETTING = void 0;
exports.parsePostHogConfig = parsePostHogConfig;
exports.postHogEnvironment = postHogEnvironment;
exports.postHogNetworkSuppressed = postHogNetworkSuppressed;
exports.readPostHogConfig = readPostHogConfig;
exports.postHogConnectOrigin = postHogConnectOrigin;
const offline_mode_1 = require("./offline-mode");
const db_1 = require("../db");
const build_identity_1 = require("./build-identity");
exports.POSTHOG_PROJECT_TOKEN_SETTING = 'posthog_project_token';
exports.POSTHOG_HOST_SETTING = 'posthog_host';
exports.DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';
/** Accepts an http(s) origin. Credentials and any other scheme are rejected. */
function parsePostHogConfig(token, host) {
    const trimmedToken = token.trim();
    const trimmedHost = host.trim();
    if (!trimmedToken || !trimmedHost)
        return null;
    let url;
    try {
        url = new URL(trimmedHost);
    }
    catch {
        return null;
    }
    if (url.username || url.password)
        return null;
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return null;
    if (!url.hostname)
        return null;
    return { token: trimmedToken, host: url.origin };
}
/**
 * `production` for release builds, `development` with FLO_POSTHOG_DEV=1, else null (no connection).
 * Test suites run as plain Node, so they never connect even with a stubbed isPackaged.
 */
function postHogEnvironment() {
    if (process.env.CI)
        return null;
    if ((0, offline_mode_1.isOfflineMode)())
        return null;
    if (process.env.E2E_TASK_LOCAL_PORTS)
        return null;
    if (process.env.NODE_ENV === 'test')
        return null;
    if (process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK === '1')
        return null;
    if (process.type !== 'browser')
        return null;
    if (process.env.FLO_POSTHOG_DEV === '1')
        return 'development';
    return (0, build_identity_1.isOfficialReleaseBuild)() ? 'production' : null;
}
function postHogNetworkSuppressed() {
    return postHogEnvironment() === null;
}
/**
 * Token and host: FLO_POSTHOG_DEV_* in development, then the settings row, then
 * build-identity.json; the host defaults to EU Cloud.
 */
function readPostHogConfig() {
    try {
        const build = (0, build_identity_1.readBuildPostHogSettings)();
        const host = (0, db_1.getSettingValue)(exports.POSTHOG_HOST_SETTING)?.trim() || build.host || exports.DEFAULT_POSTHOG_HOST;
        const devToken = process.env.FLO_POSTHOG_DEV_TOKEN?.trim();
        if (devToken && postHogEnvironment() === 'development') {
            return parsePostHogConfig(devToken, process.env.FLO_POSTHOG_DEV_HOST?.trim() || host);
        }
        const token = (0, db_1.getSettingValue)(exports.POSTHOG_PROJECT_TOKEN_SETTING)?.trim() || build.token || '';
        return parsePostHogConfig(token, host);
    }
    catch {
        return null;
    }
}
/** Origin allowed on connect-src, or null when PostHog must not be contacted. */
function postHogConnectOrigin() {
    if (postHogNetworkSuppressed())
        return null;
    return readPostHogConfig()?.host ?? null;
}
//# sourceMappingURL=posthog-config.js.map