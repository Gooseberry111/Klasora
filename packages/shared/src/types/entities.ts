/**
 * Row types for Klasora's tables, exactly as PostgREST returns them
 * (snake_case, timestamps as ISO strings, bigint money as number).
 *
 * Once a Supabase project is linked, `npm run db:types` generates
 * `database.generated.ts`; these hand-written types remain the stable domain
 * contract the apps import.
 */
import type {
  AcademicStructure,
  InstitutionType,
  InvitationStatus,
  MembershipStatus,
  PlatformRole,
  RecordStatus,
  SchoolStatus,
  SubscriptionStatus,
  ThemePreference,
} from '../constants';
import type { PermissionAction, SystemRoleKey } from '../permissions';
import type { DepartmentKind } from '../vocabulary';

type Uuid = string;
type Timestamp = string;

export interface Profile {
  id: Uuid;
  auth_user_id: Uuid;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  preferred_language: string;
  timezone: string;
  theme: ThemePreference;
  /** Product tours this person has finished, such as 'web_welcome_v1'. */
  completed_tours: string[];
  /** Show message and result details in push notifications on the lock screen. */
  push_previews: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface School {
  id: Uuid;
  name: string;
  slug: string;
  institution_type: InstitutionType;
  academic_structure: AcademicStructure;
  registration_number: string | null;
  email: string;
  phone: string;
  website: string | null;
  logo_url: string | null;
  country: string;
  state: string;
  city: string;
  address: string;
  timezone: string;
  default_currency: string;
  status: SchoolStatus;
  motto: string | null;
  setup_completed_at: Timestamp | null;
  created_by: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Campus {
  id: Uuid;
  school_id: Uuid;
  name: string;
  code: string;
  address: string | null;
  contact_phone: string | null;
  status: RecordStatus;
  is_main: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Role {
  id: Uuid;
  school_id: Uuid;
  name: string;
  description: string | null;
  role_key: SystemRoleKey | null;
  is_system_role: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Permission {
  id: Uuid;
  permission_key: string;
  module: string;
  action: PermissionAction;
  description: string;
  created_at: Timestamp;
}

export interface RolePermission {
  id: Uuid;
  school_id: Uuid;
  role_id: Uuid;
  permission_id: Uuid;
  allowed: boolean;
  created_at: Timestamp;
}

export interface SchoolMembership {
  id: Uuid;
  school_id: Uuid;
  user_id: Uuid;
  role_id: Uuid;
  campus_id: Uuid | null;
  status: MembershipStatus;
  invited_by: Uuid | null;
  joined_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Invitation {
  id: Uuid;
  school_id: Uuid;
  email: string;
  role_id: Uuid;
  campus_id: Uuid | null;
  status: InvitationStatus;
  invited_by: Uuid | null;
  expires_at: Timestamp;
  accepted_by: Uuid | null;
  accepted_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PlatformAdmin {
  id: Uuid;
  user_id: Uuid;
  platform_role: PlatformRole;
  status: RecordStatus;
  created_by: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AuditLog {
  id: Uuid;
  school_id: Uuid | null;
  actor_user_id: Uuid | null;
  action: 'insert' | 'update' | 'delete' | string;
  entity_type: string;
  entity_id: Uuid | null;
  previous_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: Timestamp;
}

export interface PlanFeatureLimits {
  custom_roles?: boolean;
  finance?: boolean;
  advanced_reports?: boolean;
  mobile_app?: boolean;
  parent_portal?: boolean;
  api_access?: boolean;
  [feature: string]: boolean | number | string | undefined;
}

export interface SubscriptionPlan {
  id: Uuid;
  code: string;
  name: string;
  description: string;
  /** Minor units (kobo). `null` means custom pricing. */
  monthly_price: number | null;
  currency: string;
  /** `null` means unlimited. */
  maximum_students: number | null;
  maximum_staff: number | null;
  maximum_campuses: number | null;
  storage_limit_mb: number | null;
  feature_limits: PlanFeatureLimits;
  support_level: string;
  trial_days: number;
  is_self_serve: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SchoolSubscription {
  id: Uuid;
  school_id: Uuid;
  plan_id: Uuid;
  billing_interval: 'monthly';
  status: SubscriptionStatus;
  starts_at: Timestamp;
  renews_at: Timestamp | null;
  trial_ends_at: Timestamp | null;
  grace_period_ends_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** A membership joined with its school and role, as loaded for the workspace switcher. */
export interface MembershipWithContext extends SchoolMembership {
  school: Pick<School, 'id' | 'name' | 'slug' | 'logo_url' | 'status' | 'institution_type' | 'academic_structure'>;
  role: Pick<Role, 'id' | 'name' | 'role_key' | 'is_system_role'>;
}

/** Row returned by `public.get_invitation_preview`. */
export interface InvitationPreview {
  school_name: string;
  role_name: string;
  email: string;
  status: InvitationStatus;
  expires_at: Timestamp;
}

/** Row returned by `public.create_invitation`. */
export interface CreatedInvitation {
  invitation_id: Uuid;
  token: string;
}

// -----------------------------------------------------------------------------
// Phase 2: school setup
// -----------------------------------------------------------------------------

export type AcademicPeriodStatus = 'planned' | 'active' | 'completed';

export interface AcademicYear {
  id: Uuid;
  school_id: Uuid;
  name: string;
  /** ISO date (YYYY MM DD). */
  start_date: string;
  end_date: string;
  status: AcademicPeriodStatus;
  is_current: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AcademicTerm {
  id: Uuid;
  school_id: Uuid;
  academic_year_id: Uuid;
  name: string;
  sequence: number;
  start_date: string;
  end_date: string;
  status: AcademicPeriodStatus;
  is_current: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Department {
  id: Uuid;
  school_id: Uuid;
  campus_id: Uuid | null;
  parent_id: Uuid | null;
  kind: DepartmentKind;
  name: string;
  code: string | null;
  description: string | null;
  status: RecordStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SchoolClass {
  id: Uuid;
  school_id: Uuid;
  campus_id: Uuid;
  department_id: Uuid | null;
  academic_year_id: Uuid | null;
  name: string;
  level: string | null;
  level_order: number;
  class_teacher_membership_id: Uuid | null;
  capacity: number | null;
  status: RecordStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Subject {
  id: Uuid;
  school_id: Uuid;
  department_id: Uuid | null;
  name: string;
  code: string;
  description: string | null;
  status: RecordStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ClassSubject {
  id: Uuid;
  school_id: Uuid;
  class_id: Uuid;
  subject_id: Uuid;
  teacher_membership_id: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Row returned by `public.list_school_members`. */
export interface SchoolMember {
  membership_id: Uuid;
  user_id: Uuid;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url: string | null;
  role_id: Uuid;
  role_name: string;
  role_key: SystemRoleKey | null;
  campus_id: Uuid | null;
  status: MembershipStatus;
  joined_at: Timestamp | null;
}
