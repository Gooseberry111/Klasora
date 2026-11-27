import type {
  Campus,
  MembershipWithContext,
  PermissionKey,
  School,
  SchoolSubscription,
  SubscriptionPlan,
} from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { toAppError, unwrap } from '@/lib/errors';

const MEMBERSHIP_SELECT = `
  id, school_id, user_id, role_id, campus_id, status, invited_by, joined_at, created_at, updated_at,
  school:schools ( id, name, slug, logo_url, status, institution_type, academic_structure ),
  role:roles!school_memberships_role_fk ( id, name, role_key, is_system_role )
`;

/** All active memberships for the signed-in user, across every school. */
export async function fetchMyMemberships(userId: string): Promise<MembershipWithContext[]> {
  const response = await supabase
    .from('school_memberships')
    .select(MEMBERSHIP_SELECT)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  const rows = unwrap(response, { fallback: "We couldn't load your schools. Please try again." });
  // A membership whose school is hidden (for example, archived) comes back with school = null.
  return (rows as unknown as MembershipWithContext[]).filter((m) => m.school && m.role);
}

export async function fetchMyPermissions(schoolId: string): Promise<PermissionKey[]> {
  const response = await supabase.rpc('get_my_permissions', { p_school_id: schoolId });
  if (response.error) {
    throw toAppError(response.error, { fallback: "We couldn't load your access for this school." });
  }
  return (response.data ?? []) as PermissionKey[];
}

export async function fetchSchool(schoolId: string): Promise<School> {
  const response = await supabase.from('schools').select('*').eq('id', schoolId).single();
  return unwrap(response, { fallback: "We couldn't load this school's details." }) as School;
}

export interface SchoolOverview {
  campuses: Campus[];
  activeMembers: number | null;
  roleCount: number;
  customRoleCount: number;
  subscription: (SchoolSubscription & { plan: Pick<SubscriptionPlan, 'name' | 'code'> | null }) | null;
}

/**
 * Real figures for the dashboard. Each query is permission-aware:
 * RLS returns nothing the caller may not see, and we skip queries the caller
 * is known not to have access to.
 */
export async function fetchSchoolOverview(
  schoolId: string,
  access: { canViewStaff: boolean; canViewBilling: boolean },
): Promise<SchoolOverview> {
  const fallback = "We couldn't load your school overview. Please refresh the page.";

  const [campusesRes, rolesRes, membersRes, subscriptionRes] = await Promise.all([
    supabase.from('campuses').select('*').eq('school_id', schoolId).order('is_main', { ascending: false }).order('name'),
    supabase.from('roles').select('id, is_system_role').eq('school_id', schoolId),
    access.canViewStaff
      ? supabase
          .from('school_memberships')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', schoolId)
          .eq('status', 'active')
      : Promise.resolve(null),
    access.canViewBilling
      ? supabase
          .from('school_subscriptions')
          .select('*, plan:subscription_plans ( name, code )')
          .eq('school_id', schoolId)
          .maybeSingle()
      : Promise.resolve(null),
  ]);

  if (campusesRes.error) throw toAppError(campusesRes.error, { fallback });
  if (rolesRes.error) throw toAppError(rolesRes.error, { fallback });
  if (membersRes?.error) throw toAppError(membersRes.error, { fallback });
  if (subscriptionRes?.error) throw toAppError(subscriptionRes.error, { fallback });

  const roles = rolesRes.data ?? [];
  return {
    campuses: (campusesRes.data ?? []) as Campus[],
    activeMembers: membersRes ? (membersRes.count ?? 0) : null,
    roleCount: roles.length,
    customRoleCount: roles.filter((r) => !r.is_system_role).length,
    subscription: (subscriptionRes?.data ?? null) as SchoolOverview['subscription'],
  };
}
