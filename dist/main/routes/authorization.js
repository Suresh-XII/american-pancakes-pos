"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizationRoutes = void 0;
const express_1 = require("express");
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const cloud_sync_1 = require("../services/cloud-sync");
const operation_failure_1 = require("../lib/operation-failure");
const authorization_1 = require("../services/authorization");
const authorization_2 = require("../services/authorization");
const orders_1 = require("./orders");
const permissions_1 = require("../../shared/permissions");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
const MAX_OVERRIDES = permissions_1.PERMISSION_DEFINITIONS.length;
function captureAuthorizationRejection(capturePoint) {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: capturePoint,
        outcome: 'not_applied',
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change an authorization decision.
    }
}
function captureAuthorizationInputRejection(validationCode) {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.authorization.input_validation',
        outcome: 'not_applied',
        facts: { validation_code: validationCode },
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change permission configuration responses.
    }
}
function actorId(req) {
    return String(req.user?.userId || '');
}
/**
 * Evaluates both post-write guards against `candidate` and reports whether the
 * response has already been sent, in the order that helps the caller. The store
 * first: no factor rescues a write that would strand it, so that refusal stays a
 * 400 naming the remedy. The actor second: a self-lockout is recoverable by
 * proving who you are, so it is a 428 naming the factor. Both run before the
 * write, so a refusal stores nothing.
 */
function preflightOverrides(req, res, candidate) {
    try {
        (0, authorization_2.assertAdministrationReachable)((0, db_1.getDatabase)(), candidate);
    }
    catch (error) {
        if (!(error instanceof authorization_2.AdministrationUnreachableError))
            throw error;
        captureAuthorizationRejection('fc.backend.authorization.administration_guard');
        res.status(400).json({ error: error.message, code: 'administration_unreachable' });
        return true;
    }
    const actor = actorId(req);
    try {
        (0, authorization_2.assertActorKeepsOwnAdministration)(actor, candidate);
        return false;
    }
    catch (error) {
        if (!(error instanceof authorization_2.SelfPrivilegeChangeError))
            throw error;
        // The shared limiter every other override-PIN path uses, on the same key
        // shape. It counts this attempt whether or not a PIN came with it, so
        // omitting one cannot buy unlimited guesses at a four to six digit factor.
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        if (!(0, orders_1.checkPinRateLimit)(`pin:${clientIp}:authorization-self-privilege`)) {
            res.status(429).json({ error: 'Too many PIN attempts. Try again in 15 minutes.' });
            return true;
        }
        // An account with no PIN can never satisfy the factor, so demanding one
        // would lock the owner out of the one action that lets them continue.
        const pinHash = (0, db_1.getDatabase)().prepare('SELECT pin_hash FROM users WHERE id = ?').get(actor)?.pin_hash;
        if (!pinHash) {
            captureAuthorizationRejection('fc.backend.authorization.self_lockout_guard');
            res.status(409).json({
                error: 'Set a PIN on your own account in Staff before removing your own administrative access.',
                code: 'self_privilege_change_factor_unavailable',
            });
            return true;
        }
        const presented = req.body?.override_pin;
        if ((0, db_1.verifyPin)(pinHash, presented))
            return false;
        if (presented) {
            captureAuthorizationRejection('fc.backend.authorization.self_lockout_guard');
            res
                .status(403)
                .json({ error: 'Invalid owner PIN', code: 'self_privilege_change_factor_invalid' });
            return true;
        }
        captureAuthorizationRejection('fc.backend.authorization.self_lockout_guard');
        res.status(428).json({
            error: error.message,
            code: 'self_privilege_change_requires_factor',
            requires: 'pin',
        });
        return true;
    }
}
function parseOverrides(value) {
    if (!Array.isArray(value) || value.length > MAX_OVERRIDES)
        return null;
    const parsed = new Map();
    for (const entry of value) {
        if (!entry || typeof entry !== 'object' || !(0, permissions_1.isPermissionId)(entry.permission_id))
            return null;
        if (entry.effect !== 'allow' && entry.effect !== 'deny')
            return null;
        const definition = permissions_1.PERMISSION_DEFINITIONS.find(({ id }) => id === entry.permission_id);
        if (!definition?.configurable || parsed.has(entry.permission_id))
            return null;
        parsed.set(entry.permission_id, entry.effect);
    }
    return parsed;
}
function serializeOverrides(overrides) {
    return [...overrides.entries()]
        .filter(([permissionId]) => permissions_1.PERMISSION_DEFINITIONS.find(({ id }) => id === permissionId)?.configurable)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([permissionId, effect]) => ({ permission_id: permissionId, effect }));
}
function rolePayload(role) {
    const resolved = (0, authorization_2.resolveRolePermissions)(role);
    const db = (0, db_1.getDatabase)();
    const rows = db
        .prepare('SELECT permission_id, effect FROM role_permission_overrides WHERE role = ? ORDER BY permission_id')
        .all(role);
    return {
        role,
        revision: (0, authorization_2.rolePermissionRevision)(role),
        overrides: rows.filter(({ permission_id }) => (0, permissions_1.isPermissionId)(permission_id) &&
            permissions_1.PERMISSION_DEFINITIONS.find(({ id }) => id === permission_id)?.configurable),
        permissions: permissions_1.PERMISSION_DEFINITIONS.map((definition) => ({
            permission_id: definition.id,
            allowed: resolved.decisions[definition.id].allowed,
            source: resolved.decisions[definition.id].source,
        })),
    };
}
function userPayload(userId) {
    const db = (0, db_1.getDatabase)();
    const user = db
        .prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?')
        .get(userId);
    if (!user || !(0, role_permissions_1.isRole)(user.role))
        return null;
    const resolved = (0, authorization_2.resolveEffectivePermissions)(userId);
    const overrides = (0, authorization_2.readUserPermissionOverrides)(userId);
    return {
        user,
        revision: (0, authorization_2.userPermissionRevision)(userId),
        overrides: serializeOverrides(overrides),
        permissions: permissions_1.PERMISSION_DEFINITIONS.map((definition) => ({
            permission_id: definition.id,
            allowed: resolved?.decisions[definition.id].allowed ?? false,
            source: resolved?.decisions[definition.id].source ?? 'shipped_default',
        })),
    };
}
function writeAudit(actorUserId, batchId, targetType, targetId, permissionId, previousEffect, nextEffect) {
    (0, db_1.getDatabase)()
        .prepare(`
    INSERT INTO authorization_audit_log (
      batch_id, actor_user_id, target_type, target_id, permission_id,
      previous_effect, next_effect, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
        .run(batchId, actorUserId, targetType, targetId, permissionId, previousEffect, nextEffect, (0, db_1.now)());
}
router.use((0, authorization_1.requirePermission)('authorization.manage'));
router.get('/catalog', (_req, res) => {
    res.json({ permissions: permissions_1.PERMISSION_DEFINITIONS, roles: role_permissions_1.ROLE_KEYS });
});
router.get('/roles', (_req, res) => {
    res.json({ roles: role_permissions_1.ROLE_KEYS.map((role) => rolePayload(role)) });
});
router.put('/roles/:role', (req, res) => {
    const role = String(req.params.role);
    if (!(0, role_permissions_1.isRole)(role)) {
        captureAuthorizationInputRejection('invalid_role');
        return res.status(400).json({ error: 'Invalid role', code: 'invalid_role' });
    }
    const overrides = parseOverrides(req.body?.overrides);
    if (!overrides) {
        captureAuthorizationInputRejection('invalid_overrides');
        return res
            .status(400)
            .json({ error: 'Invalid permission overrides', code: 'invalid_permission_overrides' });
    }
    if (typeof req.body?.revision !== 'string') {
        captureAuthorizationInputRejection('missing_revision');
        return res.status(400).json({ error: 'revision is required', code: 'revision_required' });
    }
    if (req.body.revision !== (0, authorization_2.rolePermissionRevision)(role)) {
        captureAuthorizationRejection('fc.backend.authorization.revision_conflict');
        return res.status(409).json({
            error: 'Permissions changed in another session',
            code: 'revision_conflict',
            role: rolePayload(role),
        });
    }
    const db = (0, db_1.getDatabase)();
    const actor = actorId(req);
    const batchId = (0, node_crypto_1.randomUUID)();
    if (preflightOverrides(req, res, { kind: 'role_overrides', role, overrides }))
        return;
    db.transaction(() => {
        const previous = new Map();
        const rows = db
            .prepare('SELECT permission_id, effect FROM role_permission_overrides WHERE role = ?')
            .all(role);
        for (const row of rows)
            if ((0, permissions_1.isPermissionId)(row.permission_id))
                previous.set(row.permission_id, row.effect);
        db.prepare('DELETE FROM role_permission_overrides WHERE role = ?').run(role);
        const insert = db.prepare(`
      INSERT INTO role_permission_overrides (role, permission_id, effect, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        for (const [permissionId, effect] of overrides)
            insert.run(role, permissionId, effect, actor, (0, db_1.now)(), (0, db_1.now)());
        const changed = new Set([...previous.keys(), ...overrides.keys()]);
        for (const permissionId of changed) {
            const before = previous.get(permissionId) ?? null;
            const after = overrides.get(permissionId) ?? null;
            if (before !== after)
                writeAudit(actor, batchId, 'role', role, permissionId, before, after);
        }
    })();
    res.json({ role: rolePayload(role) });
});
router.get('/users', (_req, res) => {
    const users = (0, db_1.getDatabase)()
        .prepare(`
    SELECT id, name, email, role, (pin_hash IS NOT NULL) AS has_pin, is_active, created_at, updated_at
    FROM users ORDER BY role, name
  `)
        .all();
    res.json({ users });
});
router.get('/users/:userId', (req, res) => {
    const payload = userPayload(String(req.params.userId));
    if (!payload)
        return res.status(404).json({ error: 'Staff member not found', code: 'staff_not_found' });
    res.json(payload);
});
router.put('/users/:userId', (req, res) => {
    const userId = String(req.params.userId);
    if (!userPayload(userId))
        return res.status(404).json({ error: 'Staff member not found', code: 'staff_not_found' });
    const overrides = parseOverrides(req.body?.overrides);
    if (!overrides) {
        captureAuthorizationInputRejection('invalid_overrides');
        return res
            .status(400)
            .json({ error: 'Invalid permission overrides', code: 'invalid_permission_overrides' });
    }
    if (typeof req.body?.revision !== 'string') {
        captureAuthorizationInputRejection('missing_revision');
        return res.status(400).json({ error: 'revision is required', code: 'revision_required' });
    }
    if (req.body.revision !== (0, authorization_2.userPermissionRevision)(userId)) {
        captureAuthorizationRejection('fc.backend.authorization.revision_conflict');
        return res.status(409).json({
            error: 'Permissions changed in another session',
            code: 'revision_conflict',
            user: userPayload(userId),
        });
    }
    const db = (0, db_1.getDatabase)();
    const actor = actorId(req);
    const batchId = (0, node_crypto_1.randomUUID)();
    if (preflightOverrides(req, res, { kind: 'user_overrides', userId, overrides }))
        return;
    db.transaction(() => {
        const previous = (0, authorization_2.readUserPermissionOverrides)(userId);
        db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(userId);
        const insert = db.prepare(`
      INSERT INTO user_permission_overrides (user_id, permission_id, effect, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        for (const [permissionId, effect] of overrides)
            insert.run(userId, permissionId, effect, actor, (0, db_1.now)(), (0, db_1.now)());
        const changed = new Set([...previous.keys(), ...overrides.keys()]);
        for (const permissionId of changed) {
            const before = previous.get(permissionId) ?? null;
            const after = overrides.get(permissionId) ?? null;
            if (before !== after)
                writeAudit(actor, batchId, 'user', userId, permissionId, before, after);
        }
    })();
    res.json(userPayload(userId));
});
router.delete('/users/:userId/overrides', (req, res) => {
    const userId = String(req.params.userId);
    const payload = userPayload(userId);
    if (!payload)
        return res.status(404).json({ error: 'Staff member not found', code: 'staff_not_found' });
    if (typeof req.body?.revision !== 'string') {
        captureAuthorizationInputRejection('missing_revision');
        return res.status(400).json({ error: 'revision is required', code: 'revision_required' });
    }
    if (req.body.revision !== payload.revision) {
        captureAuthorizationRejection('fc.backend.authorization.revision_conflict');
        return res.status(409).json({
            error: 'Permissions changed in another session',
            code: 'revision_conflict',
            user: payload,
        });
    }
    const actor = actorId(req);
    const db = (0, db_1.getDatabase)();
    const batchId = (0, node_crypto_1.randomUUID)();
    if (preflightOverrides(req, res, { kind: 'user_overrides', userId, overrides: new Map() }))
        return;
    db.transaction(() => {
        const previous = (0, authorization_2.readUserPermissionOverrides)(userId);
        db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(userId);
        for (const [permissionId, effect] of previous)
            writeAudit(actor, batchId, 'user', userId, permissionId, effect, null);
    })();
    res.json(userPayload(userId));
});
router.get('/audit', (req, res) => {
    const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit || '50'), 10) || 50));
    const beforeId = Number.parseInt(String(req.query.before_id || ''), 10);
    const rows = Number.isInteger(beforeId) && beforeId > 0
        ? (0, db_1.getDatabase)()
            .prepare(`
        SELECT audit.*, users.name AS actor_name
        FROM authorization_audit_log audit
        LEFT JOIN users ON users.id = audit.actor_user_id
        WHERE audit.id < ? ORDER BY audit.id DESC LIMIT ?
      `)
            .all(beforeId, limit)
        : (0, db_1.getDatabase)()
            .prepare(`
        SELECT audit.*, users.name AS actor_name
        FROM authorization_audit_log audit
        LEFT JOIN users ON users.id = audit.actor_user_id
        ORDER BY audit.id DESC LIMIT ?
      `)
            .all(limit);
    res.json({ audit: rows });
});
exports.authorizationRoutes = router;
//# sourceMappingURL=authorization.js.map