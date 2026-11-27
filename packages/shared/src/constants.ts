/**
 * Enumerations shared by every Klasora client. Each list mirrors a Postgres enum
 * declared in `supabase/migrations/20261126000100_foundation.sql`.
 */

export const INSTITUTION_TYPES = [
  'nursery',
  'primary',
  'secondary',
  'primary_secondary',
  'college',
  'university',
  'vocational',
  'other',
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

export const INSTITUTION_TYPE_LABELS: Record<InstitutionType, string> = {
  nursery: 'Nursery / Preschool',
  primary: 'Primary school',
  secondary: 'Secondary school',
  primary_secondary: 'Primary & secondary school',
  college: 'College',
  university: 'University',
  vocational: 'Vocational / Technical institution',
  other: 'Other training institution',
};

export const ACADEMIC_STRUCTURES = [
  'classes_grades',
  'sectioned_school',
  'faculties_departments',
  'programmes_semesters',
] as const;
export type AcademicStructure = (typeof ACADEMIC_STRUCTURES)[number];

export const ACADEMIC_STRUCTURE_DETAILS: Record<AcademicStructure, { label: string; description: string }> = {
  classes_grades: {
    label: 'Classes and grades',
    description: 'A single sequence of classes or grades, organised by terms.',
  },
  sectioned_school: {
    label: 'Nursery, primary and secondary sections',
    description: 'Separate sections, each with its own classes, sharing one school.',
  },
  faculties_departments: {
    label: 'Faculties and departments',
    description: 'Faculties containing departments that run programmes and courses.',
  },
  programmes_semesters: {
    label: 'Programmes and semesters',
    description: 'Programmes made up of courses delivered across semesters.',
  },
};

/** The structure we suggest for each institution type during onboarding. */
export const SUGGESTED_STRUCTURE: Record<InstitutionType, AcademicStructure> = {
  nursery: 'classes_grades',
  primary: 'classes_grades',
  secondary: 'classes_grades',
  primary_secondary: 'sectioned_school',
  college: 'programmes_semesters',
  university: 'faculties_departments',
  vocational: 'programmes_semesters',
  other: 'classes_grades',
};

export const SCHOOL_STATUSES = ['pending_review', 'active', 'suspended', 'archived'] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'inactive', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const RECORD_STATUSES = ['active', 'inactive'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const PLATFORM_ROLES = ['super_admin', 'support_admin', 'finance_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'grace_period',
  'expired',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment due',
  grace_period: 'Grace period',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Countries offered at registration. Nigeria first; the list grows with expansion. */
export const COUNTRIES = [
  { code: 'NG', name: 'Nigeria', currency: 'NGN', timezone: 'Africa/Lagos' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', timezone: 'Africa/Accra' },
  { code: 'KE', name: 'Kenya', currency: 'KES', timezone: 'Africa/Nairobi' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', timezone: 'Africa/Johannesburg' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London' },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York' },
] as const;
export type CountryCode = (typeof COUNTRIES)[number]['code'];

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River',
  'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Federal Capital Territory', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
  'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;

export const ACADEMIC_PERIOD_STATUS_LABELS = {
  planned: 'Planned',
  active: 'In progress',
  completed: 'Completed',
} as const;

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Suspended',
};

/** Time zones offered in the school profile. */
export const TIMEZONES = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Europe/London',
  'America/New_York',
] as const;
