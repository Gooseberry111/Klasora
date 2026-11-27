/**
 * Students, guardians and staff profiles: labels, row types and the CSV
 * format used for importing and exporting students.
 */
import type { MembershipStatus } from './constants';

export const STUDENT_STATUSES = ['applicant', 'active', 'suspended', 'graduated', 'withdrawn', 'transferred'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  applicant: 'Applicant',
  active: 'Active',
  suspended: 'Suspended',
  graduated: 'Graduated',
  withdrawn: 'Withdrawn',
  transferred: 'Transferred out',
};

export const GENDERS = ['female', 'male'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = { female: 'Female', male: 'Male' };

export const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'guardian', 'grandparent', 'sibling', 'aunt_uncle', 'sponsor', 'other'] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];
export const RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  grandparent: 'Grandparent',
  sibling: 'Sibling',
  aunt_uncle: 'Aunt or uncle',
  sponsor: 'Sponsor',
  other: 'Other',
};

/** Stored as the usual codes; always displayed in words. */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export function bloodGroupLabel(code: string): string {
  const sign = code.endsWith('+') ? 'positive' : 'negative';
  return `${code.slice(0, -1)} ${sign}`;
}

export const GENOTYPES = ['AA', 'AS', 'AC', 'SS', 'SC', 'CC'] as const;

export const ENROLLMENT_STATUS_LABELS = {
  active: 'Current',
  completed: 'Completed',
  withdrawn: 'Withdrawn',
  transferred: 'Moved class',
} as const;
export type EnrollmentStatus = keyof typeof ENROLLMENT_STATUS_LABELS;

export const EMPLOYMENT_STATUS_LABELS = { active: 'Active', on_leave: 'On leave', left: 'Left the school' } as const;
export type EmploymentStatus = keyof typeof EMPLOYMENT_STATUS_LABELS;
export const EMPLOYMENT_TYPE_LABELS = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract', volunteer: 'Volunteer' } as const;
export type EmploymentType = keyof typeof EMPLOYMENT_TYPE_LABELS;

type Uuid = string;
type Timestamp = string;

export interface Student {
  id: Uuid;
  school_id: Uuid;
  campus_id: Uuid;
  user_id: Uuid | null;
  admission_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  gender: Gender | null;
  admission_date: string;
  status: StudentStatus;
  photo_path: string | null;
  previous_school: string | null;
  created_by: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface StudentDetails {
  student_id: Uuid;
  school_id: Uuid;
  home_address: string | null;
  blood_group: BloodGroup | null;
  genotype: string | null;
  medical_conditions: string | null;
  allergies: string | null;
  medications: string | null;
  accessibility_needs: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  updated_at: Timestamp;
}

export interface Guardian {
  id: Uuid;
  school_id: Uuid;
  user_id: Uuid | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  occupation: string | null;
  address: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface StudentGuardian {
  id: Uuid;
  school_id: Uuid;
  student_id: Uuid;
  guardian_id: Uuid;
  relationship: GuardianRelationship;
  is_primary: boolean;
  is_emergency_contact: boolean;
  can_view_results: boolean;
  can_view_finances: boolean;
  can_receive_notifications: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ClassEnrollment {
  id: Uuid;
  school_id: Uuid;
  student_id: Uuid;
  class_id: Uuid;
  academic_year_id: Uuid | null;
  start_date: string;
  end_date: string | null;
  status: EnrollmentStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface StaffProfile {
  id: Uuid;
  school_id: Uuid;
  user_id: Uuid;
  staff_number: string | null;
  job_title: string | null;
  department_id: Uuid | null;
  employment_type: EmploymentType;
  employment_status: EmploymentStatus;
  employment_start_date: string | null;
  qualifications: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Row returned by `public.get_my_children`. */
export interface ChildSummary {
  student_id: Uuid;
  first_name: string;
  last_name: string;
  admission_number: string;
  photo_path: string | null;
  status: StudentStatus;
  class_id: Uuid | null;
  class_name: string | null;
  relationship: GuardianRelationship;
}

/** Row returned by `public.get_people_counts`. */
export interface PeopleCounts {
  active_students: number;
  all_students: number;
  guardians: number;
  guardians_with_access: number;
  teachers: number;
  staff: number;
}


export function studentName(s: { first_name: string; middle_name?: string | null; last_name: string }, withMiddle = false): string {
  return [s.first_name, withMiddle ? s.middle_name : null, s.last_name].filter(Boolean).join(' ');
}

/** Whole years between a date of birth and today. */
export function ageFrom(dateOfBirth: string | null, today = new Date()): number | null {
  if (!dateOfBirth) return null;
  const [y, m, d] = dateOfBirth.split(/\D/).map(Number);
  if (!y || !m || !d) return null;
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}
