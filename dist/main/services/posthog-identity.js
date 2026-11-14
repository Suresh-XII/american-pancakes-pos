"use strict";
/**
 * PostHog identities per sharing level: `full` is the account (a hash of the store email),
 * `anonymous` is the device (a hash of a stored random seed), `off` is a random id per launch.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT_ANALYTICS_LEVELS = exports.PRODUCT_ANALYTICS_LEVEL_SETTING = void 0;
exports.readInstallRef = readInstallRef;
exports.accountRefForEmail = accountRefForEmail;
exports.readAccountRef = readAccountRef;
exports.parseProductAnalyticsLevel = parseProductAnalyticsLevel;
exports.readProductAnalyticsLevel = readProductAnalyticsLevel;
exports.productAnalyticsChoicePending = productAnalyticsChoicePending;
exports.resolvePostHogIdentity = resolvePostHogIdentity;
exports.pendingAlias = pendingAlias;
exports.markAliased = markAliased;
const crypto_1 = require("crypto");
const db_1 = require("../db");
exports.PRODUCT_ANALYTICS_LEVEL_SETTING = 'product_analytics_level';
exports.PRODUCT_ANALYTICS_LEVELS = ['full', 'anonymous', 'off'];
const INSTALL_SEED_SETTING = 'posthog_install_seed';
const ACCOUNT_REF_SETTING = 'posthog_account_ref';
const ALIASED_SETTING = 'posthog_aliased';
const LAUNCH_ID = (0, crypto_1.randomUUID)();
function ref(namespace, value) {
    return (0, crypto_1.createHash)('sha256').update(`flocafe-${namespace}:${value}`).digest('hex').slice(0, 16);
}
/** The device: a hash of a random seed generated once and kept in this database. */
function readInstallRef() {
    let seed = (0, db_1.getSettingValue)(INSTALL_SEED_SETTING);
    if (!seed) {
        seed = (0, crypto_1.randomUUID)();
        (0, db_1.upsertSettings)({ [INSTALL_SEED_SETTING]: seed });
    }
    return ref('install', seed);
}
function normalizedEmail(value) {
    if (typeof value !== 'string')
        return undefined;
    const email = value.trim().toLowerCase();
    return email.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined;
}
function accountRefForEmail(email) {
    const normalized = normalizedEmail(email);
    return normalized ? ref('account', normalized) : undefined;
}
/**
 * The customer account, also used as `store_ref`. The first key this database derives is kept,
 * so editing the store email later does not split the person; a reinstall derives it again.
 */
function readAccountRef() {
    const stored = (0, db_1.getSettingValue)(ACCOUNT_REF_SETTING);
    if (stored && /^[0-9a-f]{16}$/.test(stored))
        return stored;
    const owner = (0, db_1.getDatabase)()
        .prepare('SELECT email FROM users ORDER BY rowid ASC LIMIT 1')
        .get();
    const account = accountRefForEmail((0, db_1.getSettingValue)('email') ?? '') ?? accountRefForEmail(owner?.email ?? '');
    if (account)
        (0, db_1.upsertSettings)({ [ACCOUNT_REF_SETTING]: account });
    return account;
}
function parseProductAnalyticsLevel(value) {
    return exports.PRODUCT_ANALYTICS_LEVELS.includes(value)
        ? value
        : null;
}
function onboarded() {
    return (0, db_1.getSettingValue)('onboarding_completed') === 'true';
}
/** Telemetry off wins. An onboarded store that has not chosen yet shares anonymously. */
function readProductAnalyticsLevel() {
    if (!(0, db_1.isTelemetryEnabled)())
        return 'off';
    const stored = parseProductAnalyticsLevel((0, db_1.getSettingValue)(exports.PRODUCT_ANALYTICS_LEVEL_SETTING));
    if (stored === 'full')
        return 'full';
    return stored || onboarded() ? 'anonymous' : 'off';
}
/** The owner still has to answer the one-time sharing question. */
function productAnalyticsChoicePending() {
    return ((0, db_1.isTelemetryEnabled)() &&
        onboarded() &&
        !parseProductAnalyticsLevel((0, db_1.getSettingValue)(exports.PRODUCT_ANALYTICS_LEVEL_SETTING)));
}
function resolvePostHogIdentity(level) {
    if (level === 'off')
        return { distinctId: `anon_${LAUNCH_ID}`, identified: false };
    const installRef = readInstallRef();
    const accountRef = level === 'full' ? readAccountRef() : undefined;
    return accountRef
        ? { distinctId: `acct_${accountRef}`, identified: true, installRef, accountRef }
        : { distinctId: `inst_${installRef}`, identified: false, installRef };
}
/** The device id still needs aliasing into this account. Each pair is aliased once. */
function pendingAlias(identity) {
    if (!identity.accountRef || !identity.installRef)
        return null;
    const pair = `${identity.accountRef}|${identity.installRef}`;
    return (0, db_1.getSettingValue)(ALIASED_SETTING) === pair ? null : `inst_${identity.installRef}`;
}
function markAliased(identity) {
    if (identity.accountRef && identity.installRef) {
        (0, db_1.upsertSettings)({ [ALIASED_SETTING]: `${identity.accountRef}|${identity.installRef}` });
    }
}
//# sourceMappingURL=posthog-identity.js.map