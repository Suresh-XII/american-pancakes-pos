import type { RequestHandler } from 'express';
import { getDatabase } from '../db';
import { type PermissionEffect, type PermissionId } from '../../shared/permissions';
import { type Role } from '../../shared/role-permissions';
export type PermissionSource = 'shipped_default' | 'role_override' | 'user_override' | 'protected_rule';
export type PermissionDecision = {
    allowed: boolean;
    source: PermissionSource;
};
export type EffectivePermissionSet = {
    userId: string;
    role: Role;
    permissionIds: ReadonlySet<PermissionId>;
    decisions: Readonly<Record<PermissionId, PermissionDecision>>;
};
type Database = ReturnType<typeof getDatabase>;
export type PermissionOverride = {
    permissionId: PermissionId;
    effect: PermissionEffect;
};
export type RolePermissionSet = {
    role: Role;
    permissionIds: ReadonlySet<PermissionId>;
    decisions: Readonly<Record<PermissionId, PermissionDecision>>;
};
export declare function readUserPermissionOverrides(userId: string): Map<PermissionId, PermissionEffect>;
export declare function resolveRolePermissions(role: Role): RolePermissionSet;
export declare function rolePermissionRevision(role: Role): string;
export declare function userPermissionRevision(userId: string): string;
export declare function effectivePermissionRevision(userId: string): string;
/** Resolves current database state; JWT role/permission claims are never authoritative. */
export declare function resolveEffectivePermissions(userId: string): EffectivePermissionSet | null;
export declare function hasPermission(userId: string, permissionId: PermissionId): boolean;
/** Permission middleware for migration away from requireRole. */
export declare function requirePermission(permissionId: PermissionId): RequestHandler;
export declare function requireAnyPermission(...permissionIds: PermissionId[]): RequestHandler;
/**
 * The administrative surface an install must never lose: the permission editor,
 * owner/manager account control, the gate on every staff mutation, and store
 * configuration. Losing all four strands the store.
 */
export declare const ADMINISTRATIVE_PERMISSION_IDS: readonly ["authorization.manage", "staff.privileged.manage", "staff.operational.manage", "settings.manage"];
export declare class AdministrationUnreachableError extends Error {
    constructor();
}
export declare class SelfPrivilegeChangeError extends Error {
    constructor();
}
/** The one post-write state a permission-changing write may propose. */
export type AdministrationCandidate = {
    kind: 'role_overrides';
    role: Role;
    overrides: ReadonlyMap<PermissionId, PermissionEffect>;
} | {
    kind: 'user_overrides';
    userId: string;
    overrides: ReadonlyMap<PermissionId, PermissionEffect>;
} | {
    kind: 'user_state';
    userId: string;
    role: Role;
    isActive: boolean;
};
/**
 * The override shapes alone. An account's role and active flag are a different
 * kind of write, and a guard that only reads override tables must not accept
 * one and quietly evaluate the state already on disk.
 */
export type PermissionOverrideCandidate = Extract<AdministrationCandidate, {
    kind: 'role_overrides' | 'user_overrides';
}>;
export declare function reachesAdministration(permissionIds: ReadonlySet<PermissionId>): boolean;
/**
 * Guards a write that could leave the store unadministrable. Evaluated against
 * the post-write state, so `candidate` describes the overrides or the account
 * the caller is about to store, never what is already on disk.
 */
export declare function assertAdministrationReachable(db: Database, candidate: AdministrationCandidate): void;
/**
 * Whether any active account can still reach the administrative surface. The
 * counterpart to assertAdministrationReachable: the guard asks this to refuse
 * stranding an install, and recovery asks it whether the install is stranded.
 */
export declare function hasActiveAdministrator(): boolean;
/**
 * Guards a write that would take an administrative capability away from the
 * actor making it. Same four capabilities and the same post-write evaluation
 * assertAdministrationReachable performs, scoped to one account: the store may
 * survive the actor's self-lockout, but the actor still has to prove who they
 * are before removing their own way back in.
 */
export declare function assertActorKeepsOwnAdministration(actorUserId: string, candidate: PermissionOverrideCandidate): void;
export {};
//# sourceMappingURL=authorization.d.ts.map