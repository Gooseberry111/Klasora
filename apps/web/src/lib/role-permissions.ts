/**
 * Client-side mirror of the rules enforced by `public.set_role_permissions`.
 * Used only to explain and disable controls, the database re-checks every
 * change, so a tampered client still cannot escalate privileges.
 */
import type { PermissionKey, Role } from '@klasora/shared';

export interface EditorContext {
  canEditRoles: boolean;
  isOwner: boolean;
  myRoleIds: Set<string>;
  myPermissions: Set<PermissionKey>;
  schoolWritable: boolean;
}

export type RoleEditability = { editable: true } | { editable: false; reason: string };

export function roleEditability(role: Pick<Role, 'id' | 'role_key' | 'is_system_role'>, ctx: EditorContext): RoleEditability {
  if (role.role_key === 'owner') {
    return { editable: false, reason: 'The School Owner role always has full access and cannot be changed.' };
  }
  if (!ctx.schoolWritable) {
    return { editable: false, reason: 'This school is suspended, so roles cannot be changed right now.' };
  }
  if (!ctx.canEditRoles) {
    return { editable: false, reason: "You can view this role, but you don't have permission to change roles." };
  }
  if (role.is_system_role && !ctx.isOwner) {
    return { editable: false, reason: 'Only the school owner can change the permissions of standard roles.' };
  }
  if (!ctx.isOwner && ctx.myRoleIds.has(role.id)) {
    return { editable: false, reason: "You can't change the permissions of a role that is assigned to you." };
  }
  return { editable: true };
}

/** Non-owners may only grant or remove permissions they hold themselves. */
export function canTogglePermission(key: PermissionKey, ctx: EditorContext): boolean {
  return ctx.isOwner || ctx.myPermissions.has(key);
}

export function sameKeys(a: Iterable<string>, b: Iterable<string>): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const key of setA) if (!setB.has(key)) return false;
  return true;
}
