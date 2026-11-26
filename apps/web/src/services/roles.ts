import type { PermissionKey, Role, RoleFormInput, SystemRoleKey } from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { toAppError, unwrap } from '@/lib/errors';

export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  role_key: SystemRoleKey | null;
  is_system_role: boolean;
  member_count: number;
  permission_count: number;
  created_at: string;
}

export interface RoleMember {
  membership_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: 'active' | 'inactive' | 'suspended';
  joined_at: string | null;
}

export async function listRoleSummaries(schoolId: string): Promise<RoleSummary[]> {
  const { data, error } = await supabase.rpc('list_role_summaries', { p_school_id: schoolId });
  if (error) throw toAppError(error, { fallback: "We couldn't load your school's roles. Please try again." });
  return (data ?? []) as RoleSummary[];
}

export async function getRole(schoolId: string, roleId: string): Promise<Role | null> {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .eq('school_id', schoolId)
    .eq('id', roleId)
    .maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this role. Please try again." });
  return (data as Role | null) ?? null;
}

export async function getRolePermissions(roleId: string): Promise<PermissionKey[]> {
  const { data, error } = await supabase.rpc('get_role_permissions', { p_role_id: roleId });
  if (error) throw toAppError(error, { fallback: "We couldn't load this role's permissions." });
  return (data ?? []) as PermissionKey[];
}

export async function listRoleMembers(roleId: string): Promise<RoleMember[]> {
  const { data, error } = await supabase.rpc('list_role_members', { p_role_id: roleId });
  if (error) throw toAppError(error, { fallback: "We couldn't load the people with this role." });
  return (data ?? []) as RoleMember[];
}

export async function createRole(schoolId: string, input: RoleFormInput): Promise<Role> {
  const response = await supabase
    .from('roles')
    .insert({ school_id: schoolId, name: input.name, description: input.description || null })
    .select('*')
    .single();
  return unwrap(response, {
    fallback: "We couldn't create this role. Please try again.",
    conflict: 'A role with this name already exists in your school.',
  }) as Role;
}

export async function updateRole(roleId: string, input: RoleFormInput): Promise<Role> {
  const response = await supabase
    .from('roles')
    .update({ name: input.name, description: input.description || null })
    .eq('id', roleId)
    .select('*')
    .single();
  return unwrap(response, {
    fallback: "We couldn't save this role. You may not have permission to edit it.",
    conflict: 'A role with this name already exists in your school.',
  }) as Role;
}

export async function deleteRole(roleId: string): Promise<void> {
  const { error, count } = await supabase.from('roles').delete({ count: 'exact' }).eq('id', roleId);
  if (error) {
    throw toAppError(error, {
      fallback: "We couldn't delete this role. Please try again.",
      inUse: 'This role is still assigned to people. Move them to another role before deleting it.',
    });
  }
  if (count === 0) {
    throw toAppError(null, { fallback: "This role couldn't be deleted. Built-in roles can't be removed." });
  }
}

export async function setRolePermissions(roleId: string, keys: PermissionKey[]): Promise<void> {
  const { error } = await supabase.rpc('set_role_permissions', { p_role_id: roleId, p_permission_keys: keys });
  if (error) throw toAppError(error, { fallback: "We couldn't save these permissions. Please try again." });
}
