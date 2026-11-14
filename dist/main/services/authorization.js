"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelfPrivilegeChangeError = exports.AdministrationUnreachableError = exports.ADMINISTRATIVE_PERMISSION_IDS = void 0;
exports.readUserPermissionOverrides = readUserPermissionOverrides;
exports.resolveRolePermissions = resolveRolePermissions;
exports.rolePermissionRevision = rolePermissionRevision;
exports.userPermissionRevision = userPermissionRevision;
exports.effectivePermissionRevision = effectivePermissionRevision;
exports.resolveEffectivePermissions = resolveEffectivePermissions;
exports.hasPermission = hasPermission;
exports.requirePermission = requirePermission;
exports.requireAnyPermission = requireAnyPermission;
exports.reachesAdministration = reachesAdministration;
exports.assertAdministrationReachable = assertAdministrationReachable;
exports.hasActiveAdministrator = hasActiveAdministrator;
exports.assertActorKeepsOwnAdministration = assertActorKeepsOwnAdministration;
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const permissions_1 = require("../../shared/permissions");
const role_permissions_1 = require("../../shared/role-permissions");
function effectAllows(effect) {
    return effect === 'allow';
}
function protectedDecision(permissionId, role) {
    if (permissionId === 'authorization.manage' || permissionId === 'staff.privileged.manage') {
        return { allowed: role === 'owner', source: 'protected_rule' };
    }
    return null;
}
function readRoleOverrides(role) {
    const rows = (0, db_1.getDatabase)().prepare('SELECT permission_id, effect FROM role_permission_overrides WHERE role = ?').all(role);
    const overrides = new Map();
    for (const row of rows) {
        if ((0, permissions_1.isPermissionId)(row.permission_id))
            overrides.set(row.permission_id, row.effect);
    }
    return overrides;
}
function readUserPermissionOverrides(userId) {
    const rows = (0, db_1.getDatabase)().prepare('SELECT permission_id, effect FROM user_permission_overrides WHERE user_id = ?').all(userId);
    const overrides = new Map();
    for (const row of rows) {
        if ((0, permissions_1.isPermissionId)(row.permission_id))
            overrides.set(row.permission_id, row.effect);
    }
    return overrides;
}
function resolveRolePermissions(role) {
    const roleOverrides = readRoleOverrides(role);
    const permissionIds = new Set();
    const decisions = {};
    for (const definition of permissions_1.PERMISSION_DEFINITIONS) {
        const protectedResult = protectedDecision(definition.id, role);
        const effect = roleOverrides.get(definition.id);
        const decision = protectedResult
            ?? (effect
                ? { allowed: effectAllows(effect), source: 'role_override' }
                : { allowed: (0, permissions_1.permissionDefaultAllows)(definition.id, role), source: 'shipped_default' });
        decisions[definition.id] = decision;
        if (decision.allowed)
            permissionIds.add(definition.id);
    }
    return { role, permissionIds, decisions };
}
function overrideRevision(scope, overrides) {
    const serialized = [...overrides.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([permissionId, effect]) => `${permissionId}:${effect}`)
        .join('|');
    return (0, node_crypto_1.createHash)('sha256').update(`${scope}|${serialized}`).digest('hex');
}
function rolePermissionRevision(role) {
    return overrideRevision(`role:${role}`, readRoleOverrides(role));
}
function userPermissionRevision(userId) {
    return overrideRevision(`user:${userId}`, readUserPermissionOverrides(userId));
}
function effectivePermissionRevision(userId) {
    const resolved = resolveEffectivePermissions(userId);
    if (!resolved)
        return overrideRevision(`inactive:${userId}`, new Map());
    return (0, node_crypto_1.createHash)('sha256')
        .update(`${resolved.role}|${rolePermissionRevision(resolved.role)}|${userPermissionRevision(userId)}`)
        .digest('hex');
}
/** Resolves current database state; JWT role/permission claims are never authoritative. */
function resolveEffectivePermissions(userId) {
    if (!userId)
        return null;
    const db = (0, db_1.getDatabase)();
    const user = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(userId);
    if (!user || user.is_active !== 1 || !(0, role_permissions_1.isRole)(user.role))
        return null;
    const rolePermissions = resolveRolePermissions(user.role);
    const userOverrides = readUserPermissionOverrides(userId);
    const permissionIds = new Set();
    const decisions = {};
    for (const definition of permissions_1.PERMISSION_DEFINITIONS) {
        const permissionId = definition.id;
        const protectedResult = protectedDecision(permissionId, user.role);
        let decision;
        if (protectedResult) {
            decision = protectedResult;
        }
        else if (userOverrides.has(permissionId)) {
            decision = { allowed: effectAllows(userOverrides.get(permissionId)), source: 'user_override' };
        }
        else {
            decision = rolePermissions.decisions[permissionId];
        }
        decisions[permissionId] = decision;
        if (decision.allowed)
            permissionIds.add(permissionId);
    }
    return { userId: user.id, role: user.role, permissionIds, decisions };
}
function hasPermission(userId, permissionId) {
    return resolveEffectivePermissions(userId)?.permissionIds.has(permissionId) === true;
}
/** Permission middleware for migration away from requireRole. */
function requirePermission(permissionId) {
    return (req, res, next) => {
        const userId = String(req.user?.userId || '');
        if (!userId)
            return res.status(401).json({ error: 'Authentication required', code: 'authentication_required' });
        if (!hasPermission(userId, permissionId)) {
            return res.status(403).json({ error: 'Insufficient permissions', code: 'permission_denied', permission: permissionId });
        }
        next();
    };
}
function requireAnyPermission(...permissionIds) {
    return (req, res, next) => {
        const userId = String(req.user?.userId || '');
        if (!userId)
            return res.status(401).json({ error: 'Authentication required', code: 'authentication_required' });
        const effective = resolveEffectivePermissions(userId);
        if (!effective || !permissionIds.some((permissionId) => effective.permissionIds.has(permissionId))) {
            return res.status(403).json({ error: 'Insufficient permissions', code: 'permission_denied' });
        }
        next();
    };
}
/**
 * The administrative surface an install must never lose: the permission editor,
 * owner/manager account control, the gate on every staff mutation, and store
 * configuration. Losing all four strands the store.
 */
exports.ADMINISTRATIVE_PERMISSION_IDS = [
    'authorization.manage',
    'staff.privileged.manage',
    'staff.operational.manage',
    'settings.manage',
];
class AdministrationUnreachableError extends Error {
    constructor() {
        // Names the invariant and the action that resolves it, and blames the store
        // rather than the actor: most of the time the actor is not who is locked out.
        super('This change would leave no account able to manage staff, permissions, or store settings. '
            + 'Grant another active owner these permissions first.');
        this.name = 'AdministrationUnreachableError';
    }
}
exports.AdministrationUnreachableError = AdministrationUnreachableError;
class SelfPrivilegeChangeError extends Error {
    constructor() {
        super('This change would remove your own access to staff, permissions, or store settings. '
            + 'Confirm your owner PIN to apply it.');
        this.name = 'SelfPrivilegeChangeError';
    }
}
exports.SelfPrivilegeChangeError = SelfPrivilegeChangeError;
function reachesAdministration(permissionIds) {
    return exports.ADMINISTRATIVE_PERMISSION_IDS.every((permissionId) => permissionIds.has(permissionId));
}
const NO_OVERRIDES = new Map();
/** Mirrors resolveEffectivePermissions for a single permission id. */
function effectiveAllows(permissionId, role, userOverrides, roleOverrides) {
    const protectedResult = protectedDecision(permissionId, role);
    if (protectedResult)
        return protectedResult.allowed;
    const effect = userOverrides.get(permissionId) ?? roleOverrides.get(permissionId);
    return effect ? effectAllows(effect) : (0, permissions_1.permissionDefaultAllows)(permissionId, role);
}
/**
 * Guards a write that could leave the store unadministrable. Evaluated against
 * the post-write state, so `candidate` describes the overrides or the account
 * the caller is about to store, never what is already on disk.
 */
function assertAdministrationReachable(db, candidate) {
    const roleOverridesByRole = new Map();
    for (const row of db.prepare('SELECT role, permission_id, effect FROM role_permission_overrides').all()) {
        if (!(0, role_permissions_1.isRole)(row.role) || !(0, permissions_1.isPermissionId)(row.permission_id))
            continue;
        const overrides = roleOverridesByRole.get(row.role) ?? new Map();
        overrides.set(row.permission_id, row.effect);
        roleOverridesByRole.set(row.role, overrides);
    }
    const userOverridesByUser = new Map();
    for (const row of db.prepare('SELECT user_id, permission_id, effect FROM user_permission_overrides').all()) {
        if (!(0, permissions_1.isPermissionId)(row.permission_id))
            continue;
        const overrides = userOverridesByUser.get(row.user_id) ?? new Map();
        overrides.set(row.permission_id, row.effect);
        userOverridesByUser.set(row.user_id, overrides);
    }
    const users = db.prepare('SELECT id, role, is_active FROM users').all();
    for (const user of users) {
        const restated = candidate.kind === 'user_state' && candidate.userId === user.id ? candidate : null;
        const role = restated ? restated.role : user.role;
        const isActive = restated ? restated.isActive : user.is_active === 1;
        if (!isActive || !(0, role_permissions_1.isRole)(role))
            continue;
        const roleOverrides = candidate.kind === 'role_overrides' && candidate.role === role
            ? candidate.overrides
            : roleOverridesByRole.get(role) ?? NO_OVERRIDES;
        const userOverrides = candidate.kind === 'user_overrides' && candidate.userId === user.id
            ? candidate.overrides
            : userOverridesByUser.get(user.id) ?? NO_OVERRIDES;
        const administrative = new Set(exports.ADMINISTRATIVE_PERMISSION_IDS.filter((permissionId) => effectiveAllows(permissionId, role, userOverrides, roleOverrides)));
        if (reachesAdministration(administrative))
            return;
    }
    throw new AdministrationUnreachableError();
}
/**
 * Whether any active account can still reach the administrative surface. The
 * counterpart to assertAdministrationReachable: the guard asks this to refuse
 * stranding an install, and recovery asks it whether the install is stranded.
 */
function hasActiveAdministrator() {
    const rows = (0, db_1.getDatabase)().prepare('SELECT id FROM users WHERE is_active = 1').all();
    return rows.some(({ id }) => {
        const effective = resolveEffectivePermissions(id);
        return effective !== null && reachesAdministration(effective.permissionIds);
    });
}
/**
 * Guards a write that would take an administrative capability away from the
 * actor making it. Same four capabilities and the same post-write evaluation
 * assertAdministrationReachable performs, scoped to one account: the store may
 * survive the actor's self-lockout, but the actor still has to prove who they
 * are before removing their own way back in.
 */
function assertActorKeepsOwnAdministration(actorUserId, candidate) {
    const actor = resolveEffectivePermissions(actorUserId);
    if (!actor)
        return;
    const roleOverrides = candidate.kind === 'role_overrides' && candidate.role === actor.role
        ? candidate.overrides
        : readRoleOverrides(actor.role);
    const userOverrides = candidate.kind === 'user_overrides' && candidate.userId === actorUserId
        ? candidate.overrides
        : readUserPermissionOverrides(actorUserId);
    const losesOwnAccess = exports.ADMINISTRATIVE_PERMISSION_IDS.some((permissionId) => actor.permissionIds.has(permissionId)
        && !effectiveAllows(permissionId, actor.role, userOverrides, roleOverrides));
    if (losesOwnAccess)
        throw new SelfPrivilegeChangeError();
}
//# sourceMappingURL=authorization.js.map