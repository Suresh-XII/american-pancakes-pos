"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffRoutes = void 0;
/** Staff management API (alias for /api/users). */
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const security_1 = require("../middleware/security");
const password_policy_1 = require("../../shared/password-policy");
const authorization_1 = require("../services/authorization");
const authorization_2 = require("../services/authorization");
const cloud_sync_1 = require("../services/cloud-sync");
const posthog_1 = require("../services/posthog");
const operation_failure_1 = require("../lib/operation-failure");
const auth_1 = require("./auth");
const role_permissions_1 = require("../../shared/role-permissions");
const router = (0, express_1.Router)();
/**
 * staff.privileged.manage is owner-only and not configurable, so the outer
 * staff gate must admit it too: gating only on staff.operational.manage let one
 * override turn a protected permission into an inert one.
 */
const requireStaffWrite = (0, authorization_1.requireAnyPermission)('staff.operational.manage', 'staff.privileged.manage');
const VALID_ROLES = role_permissions_1.ROLE_KEYS;
const STAFF_SELECT_FIELDS = 'id, name, email, role, (pin_hash IS NOT NULL) AS has_pin, is_active, created_at, updated_at';
function captureAdministrationAccessGuard() {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.staff.administration_access_guard',
        outcome: 'not_applied',
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change a protected staff decision.
    }
}
function captureStaffValidation(capturePoint, validationCode) {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: capturePoint,
        outcome: 'not_applied',
        facts: { validation_code: validationCode },
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change staff validation responses.
    }
}
function captureStaffTargetAccessDenied(action) {
    const failure = (0, operation_failure_1.serializeOperationFailure)({
        capture_point: 'fc.backend.staff.target_access_denied',
        outcome: 'not_applied',
        facts: { action },
    });
    try {
        if (failure)
            cloud_sync_1.cloudSync.captureOperationFailure(failure);
    }
    catch {
        // Diagnostics cannot change staff authorization decisions.
    }
}
function canModifyTargetStaff(requesterId, targetRole) {
    if ((0, role_permissions_1.hasRole)(targetRole, role_permissions_1.ROLE_ACCESS.ownerManager)) {
        return (0, authorization_1.hasPermission)(requesterId, 'staff.privileged.manage');
    }
    return (0, authorization_1.hasPermission)(requesterId, 'staff.operational.manage');
}
function isOperationalRole(role) {
    return (0, role_permissions_1.hasRole)(role, role_permissions_1.OPERATIONAL_ROLES);
}
function hasNonEmptyPin(pin) {
    return pin !== undefined && pin !== null && String(pin).length > 0;
}
function isValidPin(pin) {
    return /^\d{4,6}$/.test(String(pin));
}
function normalizeStaffEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}
function syncRegisteredOwnerEmail(db, previousOwnerEmail, nextOwnerEmail) {
    const currentSettingRow = db.prepare("SELECT value FROM settings WHERE key = 'email'").get();
    const currentSettingEmail = normalizeStaffEmail(currentSettingRow?.value);
    const normalizedPrev = normalizeStaffEmail(previousOwnerEmail);
    const normalizedNext = normalizeStaffEmail(nextOwnerEmail);
    let targetEmail = '';
    if (normalizedNext && (!currentSettingEmail || currentSettingEmail === normalizedPrev)) {
        targetEmail = normalizedNext;
    }
    else {
        const matchesActiveOwner = currentSettingEmail
            ? Boolean(db
                .prepare("SELECT 1 FROM users WHERE lower(email) = ? AND role = 'owner' AND is_active = 1 LIMIT 1")
                .get(currentSettingEmail))
            : false;
        if (matchesActiveOwner)
            return false;
        if (normalizedNext) {
            targetEmail = normalizedNext;
        }
        else {
            const fallbackOwner = db
                .prepare("SELECT email FROM users WHERE role = 'owner' AND is_active = 1 AND email IS NOT NULL AND trim(email) != '' ORDER BY created_at ASC, id ASC LIMIT 1")
                .get();
            targetEmail = normalizeStaffEmail(fallbackOwner?.email);
        }
    }
    if (!targetEmail || targetEmail === currentSettingEmail)
        return false;
    db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('email', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(targetEmail, (0, db_1.now)());
    return true;
}
function normalizeStationIds(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) ||
        value.length > 100 ||
        value.some((id) => typeof id !== 'string' || id.trim().length === 0 || id.length > 128)) {
        return null;
    }
    return [...new Set(value.map((id) => id.trim()))];
}
// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', (0, authorization_1.requirePermission)('staff.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        let query = `SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE 1=1`;
        const params = [];
        if (req.query.role) {
            if (typeof req.query.role !== 'string' || !VALID_ROLES.includes(req.query.role)) {
                return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
            }
            query += ' AND role = ?';
            params.push(req.query.role);
        }
        if (req.query.active === 'true') {
            query += ' AND is_active = 1';
        }
        if (req.query.active === 'false') {
            query += ' AND is_active = 0';
        }
        query += ' ORDER BY role, name';
        const staff = db.prepare(query).all(...params);
        res.json({ staff });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Approvers directory (minimal projection for operational modals) ─────────
router.get('/approvers', (0, authorization_1.requireAnyPermission)('staff.view', 'pos.use', 'orders.read', 'orders.create', 'orders.status.update', 'orders.discount.apply', 'orders.item.void', 'orders.item.cancel', 'payments.take', 'bills.discount.apply', 'refunds.initiate', 'refunds.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const approvers = db
            .prepare(`
          SELECT id, name, role, is_active, CASE WHEN pin_hash IS NOT NULL THEN 1 ELSE 0 END as has_pin
          FROM users
          WHERE is_active = 1 AND role IN ('owner', 'manager') AND pin_hash IS NOT NULL
          ORDER BY name ASC
        `)
            .all();
        res.json({ approvers, staff: approvers });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Get one ───────────────────────────────────────────────────────────────────
router.get('/:id', (0, authorization_1.requirePermission)('staff.view'), (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const member = db
            .prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`)
            .get(req.params.id);
        if (!member) {
            return res.status(404).json({ error: 'Staff member not found' });
        }
        const performance = db
            .prepare(`
      SELECT COUNT(*) as orders_served, COALESCE(SUM(total), 0) as total_sales
      FROM orders
      WHERE user_id = ? AND date(created_at) = date('now')
    `)
            .get(req.params.id);
        res.json({ staff: { ...member, performance } });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', requireStaffWrite, (0, security_1.authRateLimit)(), (req, res) => {
    try {
        const { name, email, password, role, pin, station_ids } = req.body;
        const normalizedEmail = normalizeStaffEmail(email);
        const normalizedStationIds = normalizeStationIds(station_ids);
        if (!name || !normalizedEmail || !password || !role) {
            captureStaffValidation('fc.backend.staff.create.validation', 'required_fields');
            return res.status(400).json({ error: 'name, email, password, and role are required' });
        }
        if (!(0, auth_1.isValidEmail)(normalizedEmail)) {
            captureStaffValidation('fc.backend.staff.create.validation', 'email_invalid');
            return res.status(400).json({ error: 'Enter a valid email address' });
        }
        if (!(0, security_1.validatePassword)(password)) {
            captureStaffValidation('fc.backend.staff.create.validation', 'password_policy');
            return res.status(400).json({
                error: password_policy_1.PASSWORD_POLICY_MESSAGE,
            });
        }
        if (!VALID_ROLES.includes(role)) {
            captureStaffValidation('fc.backend.staff.create.validation', 'role_invalid');
            return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
        }
        if (normalizedStationIds === null) {
            captureStaffValidation('fc.backend.staff.create.validation', 'station_list_invalid');
            return res
                .status(400)
                .json({ error: 'station_ids must contain at most 100 valid station IDs' });
        }
        if (role !== 'chef' && normalizedStationIds.length > 0) {
            captureStaffValidation('fc.backend.staff.create.validation', 'station_role_mismatch');
            return res
                .status(400)
                .json({ error: 'Kitchen stations can only be assigned to chef accounts' });
        }
        const requesterId = req.user.userId;
        // requireStaffWrite admits either permission, so the target role decides
        // which one the creator actually needs. This mirrors canModifyTargetStaff,
        // otherwise an account denied staff.operational.manage could create a
        // cashier yet be refused when it tried to edit, deactivate or reactivate
        // that same cashier.
        const requiredToCreate = isOperationalRole(role)
            ? 'staff.operational.manage'
            : 'staff.privileged.manage';
        if (!(0, authorization_1.hasPermission)(requesterId, requiredToCreate)) {
            captureStaffTargetAccessDenied('create_target');
            return res.status(403).json({
                error: isOperationalRole(role)
                    ? 'This account cannot create operational staff accounts'
                    : `This account can only create operational staff accounts (${role_permissions_1.OPERATIONAL_ROLES.join(', ')})`,
            });
        }
        if (hasNonEmptyPin(pin) && !isValidPin(pin)) {
            captureStaffValidation('fc.backend.staff.create.validation', 'pin_invalid');
            return res.status(400).json({ error: 'PIN must be between 4 and 6 numeric digits' });
        }
        const db = (0, db_1.getDatabase)();
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
        if (existing) {
            const failure = (0, operation_failure_1.serializeOperationFailure)({
                capture_point: 'fc.backend.staff.duplicate_email',
                outcome: 'not_applied',
            });
            try {
                if (failure)
                    cloud_sync_1.cloudSync.captureOperationFailure(failure);
            }
            catch {
                // Diagnostics cannot change the duplicate-email response.
            }
            return res.status(400).json({ error: 'Email already in use' });
        }
        if (normalizedStationIds.length > 0) {
            const placeholders = normalizedStationIds.map(() => '?').join(',');
            const activeStations = db
                .prepare(`SELECT id FROM kitchen_stations WHERE is_active = 1 AND id IN (${placeholders})`)
                .all(...normalizedStationIds);
            if (activeStations.length !== normalizedStationIds.length) {
                captureStaffValidation('fc.backend.staff.create.validation', 'station_unavailable');
                return res
                    .status(400)
                    .json({ error: 'One or more station_ids do not match an active kitchen station' });
            }
        }
        const id = (0, node_crypto_1.randomUUID)();
        const hashedPassword = bcryptjs_1.default.hashSync(password, 10);
        const hashedPin = hasNonEmptyPin(pin) ? bcryptjs_1.default.hashSync(String(pin), 10) : null;
        const createStaff = db.transaction(() => {
            db.prepare(`
        INSERT INTO users (id, name, email, password, role, pin_hash, station_assignments_configured, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, name, normalizedEmail, hashedPassword, role, hashedPin, normalizedStationIds.length > 0 ? 1 : 0, (0, db_1.now)(), (0, db_1.now)());
            if (normalizedStationIds.length > 0) {
                const insertAssignment = db.prepare('INSERT INTO station_users (user_id, station_id, created_at) VALUES (?, ?, ?)');
                for (const stationId of normalizedStationIds)
                    insertAssignment.run(id, stationId, (0, db_1.now)());
            }
        });
        createStaff();
        const member = db.prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`).get(id);
        res.status(201).json({
            staff: {
                ...member,
                ...(role === 'chef' ? { station_ids: normalizedStationIds } : {}),
            },
        });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Update ────────────────────────────────────────────────────────────────────
router.put('/:id', requireStaffWrite, (0, security_1.authRateLimit)(), (req, res) => {
    try {
        const { name, email, password, role, pin, is_active } = req.body;
        const emailProvided = email !== undefined;
        const normalizedEmail = emailProvided ? normalizeStaffEmail(email) : undefined;
        const db = (0, db_1.getDatabase)();
        if (is_active !== undefined) {
            captureStaffValidation('fc.backend.staff.update.validation', 'status_change_requires_action');
            return res
                .status(400)
                .json({ error: 'Use /deactivate or /reactivate endpoints to change account status' });
        }
        const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!member) {
            return res.status(404).json({ error: 'Staff member not found' });
        }
        const requesterId = req.user.userId;
        if (!canModifyTargetStaff(requesterId, member.role)) {
            captureStaffTargetAccessDenied('update_privileged');
            return res
                .status(403)
                .json({ error: 'This account cannot modify privileged staff accounts' });
        }
        if (role !== undefined) {
            if (!VALID_ROLES.includes(role)) {
                captureStaffValidation('fc.backend.staff.update.validation', 'role_invalid');
                return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
            }
            if (role !== member.role && !(0, authorization_1.hasPermission)(requesterId, 'staff.privileged.manage')) {
                captureStaffTargetAccessDenied('role_change');
                return res.status(403).json({ error: 'Only owners can change roles' });
            }
        }
        const targetRole = role ?? member.role;
        if (hasNonEmptyPin(pin) && !isValidPin(pin)) {
            captureStaffValidation('fc.backend.staff.update.validation', 'pin_invalid');
            return res.status(400).json({ error: 'PIN must be between 4 and 6 numeric digits' });
        }
        if (emailProvided && !normalizedEmail) {
            captureStaffValidation('fc.backend.staff.update.validation', 'email_missing');
            return res.status(400).json({ error: 'email is required' });
        }
        if (normalizedEmail && !(0, auth_1.isValidEmail)(normalizedEmail)) {
            captureStaffValidation('fc.backend.staff.update.validation', 'email_invalid');
            return res.status(400).json({ error: 'Enter a valid email address' });
        }
        if (normalizedEmail && normalizedEmail !== member.email) {
            const existing = db
                .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
                .get(normalizedEmail, req.params.id);
            if (existing) {
                const failure = (0, operation_failure_1.serializeOperationFailure)({
                    capture_point: 'fc.backend.staff.update.duplicate_email',
                    outcome: 'not_applied',
                });
                try {
                    if (failure)
                        cloud_sync_1.cloudSync.captureOperationFailure(failure);
                }
                catch {
                    // Diagnostics cannot change the duplicate-email response.
                }
                return res.status(400).json({ error: 'Email already in use' });
            }
        }
        if (password && !(0, security_1.validatePassword)(password)) {
            captureStaffValidation('fc.backend.staff.update.validation', 'password_policy');
            return res.status(400).json({
                error: password_policy_1.PASSWORD_POLICY_MESSAGE,
            });
        }
        const passwordChanged = Boolean(password && (!member.password || !bcryptjs_1.default.compareSync(password, member.password)));
        const hashedPassword = passwordChanged ? bcryptjs_1.default.hashSync(password, 10) : member.password;
        const pinChanged = pin !== undefined &&
            (hasNonEmptyPin(pin)
                ? !member.pin_hash || !bcryptjs_1.default.compareSync(String(pin), member.pin_hash)
                : Boolean(member.pin_hash));
        const hashedPin = pin !== undefined
            ? hasNonEmptyPin(pin)
                ? pinChanged
                    ? bcryptjs_1.default.hashSync(String(pin), 10)
                    : member.pin_hash
                : null
            : member.pin_hash;
        // Revoke outstanding sessions only when credentials actually change.
        const credentialsChanged = passwordChanged || pinChanged;
        const tokensValidAfter = credentialsChanged ? (0, db_1.now)() : member.tokens_valid_after;
        const demotesActiveOwner = member.role === 'owner' && member.is_active === 1 && targetRole !== 'owner';
        (0, authorization_2.assertAdministrationReachable)(db, {
            kind: 'user_state',
            userId: String(req.params.id),
            role: targetRole,
            isActive: member.is_active === 1,
        });
        let ownerEmailSynced = false;
        const result = db.transaction(() => {
            const updateResult = db
                .prepare(`
        UPDATE users SET
          name       = COALESCE(?, name),
          email      = COALESCE(?, email),
          password   = ?,
          role       = COALESCE(?, role),
          pin_hash   = ?,
          tokens_valid_after = ?,
          updated_at = ?
        WHERE id = ?
          AND (
            ? = 0
            OR (SELECT COUNT(*) FROM users WHERE role = 'owner' AND is_active = 1) > 1
          )
      `)
                .run(name || null, normalizedEmail || null, hashedPassword, role || null, hashedPin, tokensValidAfter, (0, db_1.now)(), req.params.id, demotesActiveOwner ? 1 : 0);
            if (updateResult.changes > 0 &&
                member.is_active === 1 &&
                (member.role === 'owner' || targetRole === 'owner')) {
                ownerEmailSynced = syncRegisteredOwnerEmail(db, member.role === 'owner' ? member.email : undefined, targetRole === 'owner' ? normalizedEmail || member.email : undefined);
            }
            return updateResult;
        })();
        if (result.changes === 0) {
            captureAdministrationAccessGuard();
            return res.status(400).json({
                error: 'Cannot change the role of the last active owner. Create or promote another active owner first.',
            });
        }
        (0, security_1.invalidateUserAuthCache)(req.params.id);
        (0, posthog_1.syncPostHogIdentity)();
        if (ownerEmailSynced) {
            try {
                cloud_sync_1.cloudSync.refreshRegistrationProfile();
            }
            catch {
                // Cloud profile refresh is best-effort and must not fail staff updates.
            }
        }
        const updated = db
            .prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`)
            .get(req.params.id);
        res.json({ staff: updated });
    }
    catch (error) {
        if (error instanceof authorization_2.AdministrationUnreachableError) {
            captureAdministrationAccessGuard();
            return res.status(400).json({ error: error.message, code: 'administration_unreachable' });
        }
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Staff are deactivated rather than hard-deleted to preserve order and print log references.
router.post('/:id/deactivate', requireStaffWrite, (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!member)
            return res.status(404).json({ error: 'Staff member not found' });
        if (member.is_active === 0)
            return res.status(400).json({ error: 'Already deactivated' });
        if (!canModifyTargetStaff(req.user.userId, member.role)) {
            captureStaffTargetAccessDenied('deactivate_privileged');
            return res
                .status(403)
                .json({ error: 'This account cannot deactivate or reactivate privileged staff accounts' });
        }
        const changedAt = (0, db_1.now)();
        (0, authorization_2.assertAdministrationReachable)(db, {
            kind: 'user_state',
            userId: String(req.params.id),
            role: member.role,
            isActive: false,
        });
        let ownerEmailSynced = false;
        const result = db.transaction(() => {
            const updateResult = db
                .prepare(`
        UPDATE users SET is_active = 0, tokens_valid_after = ?, updated_at = ?
        WHERE id = ? AND is_active = 1
          AND (role != 'owner' OR (SELECT COUNT(*) FROM users WHERE role = 'owner' AND is_active = 1) > 1)
      `)
                .run(changedAt, changedAt, req.params.id);
            if (updateResult.changes > 0 && member.role === 'owner') {
                ownerEmailSynced = syncRegisteredOwnerEmail(db);
            }
            return updateResult;
        })();
        if (result.changes === 0) {
            captureAdministrationAccessGuard();
            return res.status(400).json({ error: 'Cannot deactivate the last owner account' });
        }
        (0, security_1.invalidateUserAuthCache)(req.params.id);
        if (ownerEmailSynced) {
            try {
                cloud_sync_1.cloudSync.refreshRegistrationProfile();
            }
            catch {
                // Cloud profile refresh is best-effort and must not fail staff deactivation.
            }
        }
        const updated = db
            .prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`)
            .get(req.params.id);
        res.json({ staff: updated });
    }
    catch (error) {
        if (error instanceof authorization_2.AdministrationUnreachableError) {
            captureAdministrationAccessGuard();
            return res.status(400).json({ error: error.message, code: 'administration_unreachable' });
        }
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/:id/reactivate', requireStaffWrite, (req, res) => {
    try {
        const db = (0, db_1.getDatabase)();
        const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!member)
            return res.status(404).json({ error: 'Staff member not found' });
        if (member.is_active === 1)
            return res.status(400).json({ error: 'Already active' });
        if (!canModifyTargetStaff(req.user.userId, member.role)) {
            captureStaffTargetAccessDenied('reactivate_privileged');
            return res
                .status(403)
                .json({ error: 'This account cannot deactivate or reactivate privileged staff accounts' });
        }
        db.prepare('UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?').run((0, db_1.now)(), req.params.id);
        (0, security_1.invalidateUserAuthCache)(req.params.id);
        const updated = db
            .prepare(`SELECT ${STAFF_SELECT_FIELDS} FROM users WHERE id = ?`)
            .get(req.params.id);
        res.json({ staff: updated });
    }
    catch (error) {
        console.error('[API] Internal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.staffRoutes = router;
//# sourceMappingURL=staff.js.map