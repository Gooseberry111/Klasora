/**
 * Phase 2 data access: school profile, campuses, academic calendar,
 * departments, classes, subjects and staff invitations. The database enforces
 * every rule (RLS, plan limits, date ranges); these functions turn its answers
 * into friendly messages.
 */
import type {
  AcademicTerm,
  AcademicYear,
  AcademicYearInput,
  Campus,
  CampusInput,
  ClassInput,
  ClassSubject,
  CreatedInvitation,
  Department,
  DepartmentInput,
  Invitation,
  School,
  SchoolClass,
  SchoolMember,
  SchoolProfileInput,
  SetupProgress,
  Subject,
  SubjectInput,
  TermInput,
} from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { AppError, toAppError, unwrap } from '@/lib/errors';

const blank = (value: string) => (value.trim() === '' ? null : value.trim());

/** Deletes one row and explains why when nothing was removed. */
async function deleteRow(table: string, id: string, messages: { fallback: string; inUse: string; blocked?: string }) {
  const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('id', id);
  if (error) throw toAppError(error, { fallback: messages.fallback, inUse: messages.inUse });
  if (count === 0) throw new AppError(messages.blocked ?? messages.fallback);
}

// -----------------------------------------------------------------------------
// Progress
// -----------------------------------------------------------------------------
export async function fetchSetupProgress(schoolId: string): Promise<SetupProgress> {
  const { data, error } = await supabase.rpc('get_setup_progress', { p_school_id: schoolId });
  if (error) throw toAppError(error, { fallback: "We couldn't load your setup progress. Please refresh the page." });
  const row = (data as SetupProgress[] | null)?.[0];
  if (!row) throw new AppError("We couldn't load your setup progress. Please refresh the page.");
  return row;
}

export async function markSetupComplete(schoolId: string, complete: boolean): Promise<void> {
  const { error } = await supabase
    .from('schools')
    .update({ setup_completed_at: complete ? new Date().toISOString() : null })
    .eq('id', schoolId);
  if (error) throw toAppError(error, { fallback: "We couldn't update your setup guide." });
}

// -----------------------------------------------------------------------------
// School profile and logo
// -----------------------------------------------------------------------------
export async function updateSchoolProfile(schoolId: string, input: SchoolProfileInput): Promise<School> {
  const response = await supabase
    .from('schools')
    .update({
      name: input.name,
      motto: blank(input.motto),
      registration_number: blank(input.registrationNumber),
      email: input.email,
      phone: input.phone,
      website: blank(input.website),
      country: input.country,
      state: input.state,
      city: input.city,
      address: input.address,
      timezone: input.timezone,
    })
    .eq('id', schoolId)
    .select('*')
    .single();
  return unwrap(response, { fallback: "We couldn't save your school profile. Please check the details and try again." }) as School;
}

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export async function uploadSchoolLogo(schoolId: string, file: File): Promise<School> {
  if (!LOGO_TYPES.includes(file.type)) throw new AppError('Choose a PNG, JPG, WEBP or SVG image.');
  if (file.size > 2 * 1024 * 1024) throw new AppError('Choose an image smaller than 2 MB.');

  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  const path = `${schoolId}/logo_${Date.now()}.${extension}`;
  const upload = await supabase.storage.from('school-logos').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) throw new AppError("We couldn't upload this logo. Please try a different image.", 'upload_failed', upload.error);

  const { data } = supabase.storage.from('school-logos').getPublicUrl(path);
  const response = await supabase.from('schools').update({ logo_url: data.publicUrl }).eq('id', schoolId).select('*').single();
  return unwrap(response, { fallback: "We uploaded the logo but couldn't save it to your profile." }) as School;
}

export async function removeSchoolLogo(schoolId: string): Promise<School> {
  const response = await supabase.from('schools').update({ logo_url: null }).eq('id', schoolId).select('*').single();
  return unwrap(response, { fallback: "We couldn't remove the logo. Please try again." }) as School;
}

// -----------------------------------------------------------------------------
// Campuses
// -----------------------------------------------------------------------------
export async function listCampuses(schoolId: string): Promise<Campus[]> {
  const response = await supabase
    .from('campuses')
    .select('*')
    .eq('school_id', schoolId)
    .order('is_main', { ascending: false })
    .order('name');
  return unwrap(response, { fallback: "We couldn't load your campuses." }) as Campus[];
}

function campusRow(input: CampusInput) {
  return {
    name: input.name,
    code: input.code,
    address: blank(input.address),
    contact_phone: blank(input.contactPhone),
    status: input.status,
  };
}

export async function saveCampus(schoolId: string, input: CampusInput, id?: string): Promise<Campus> {
  const query = id
    ? supabase.from('campuses').update(campusRow(input)).eq('id', id)
    : supabase.from('campuses').insert({ school_id: schoolId, ...campusRow(input) });
  const response = await query.select('*').single();
  return unwrap(response, {
    fallback: "We couldn't save this campus. Please check the details and try again.",
    conflict: 'Another campus already uses this code.',
  }) as Campus;
}

export async function setMainCampus(campusId: string): Promise<void> {
  const { error } = await supabase.rpc('set_main_campus', { p_campus_id: campusId });
  if (error) throw toAppError(error, { fallback: "We couldn't change the main campus." });
}

export function deleteCampus(id: string) {
  return deleteRow('campuses', id, {
    fallback: "We couldn't remove this campus.",
    inUse: 'This campus still has classes or people assigned. Move them first, or mark the campus inactive.',
    blocked: "The main campus can't be removed. Make another campus the main campus first.",
  });
}

// -----------------------------------------------------------------------------
// Academic years and terms
// -----------------------------------------------------------------------------
export async function listAcademicYears(schoolId: string): Promise<AcademicYear[]> {
  const response = await supabase
    .from('academic_years')
    .select('*')
    .eq('school_id', schoolId)
    .order('start_date', { ascending: false });
  return unwrap(response, { fallback: "We couldn't load your academic years." }) as AcademicYear[];
}

export async function listTerms(schoolId: string): Promise<AcademicTerm[]> {
  const response = await supabase
    .from('academic_terms')
    .select('*')
    .eq('school_id', schoolId)
    .order('sequence');
  return unwrap(response, { fallback: "We couldn't load your terms." }) as AcademicTerm[];
}

export async function saveAcademicYear(schoolId: string, input: AcademicYearInput, id?: string): Promise<AcademicYear> {
  const row = { name: input.name, start_date: input.startDate, end_date: input.endDate, status: input.status };
  const query = id
    ? supabase.from('academic_years').update(row).eq('id', id)
    : supabase.from('academic_years').insert({ school_id: schoolId, ...row });
  const response = await query.select('*').single();
  return unwrap(response, {
    fallback: "We couldn't save this academic year. Please check the dates and try again.",
    conflict: 'An academic year with this name already exists.',
  }) as AcademicYear;
}

export async function saveTerm(schoolId: string, yearId: string, input: TermInput, id?: string): Promise<AcademicTerm> {
  const row = {
    name: input.name,
    sequence: input.sequence,
    start_date: input.startDate,
    end_date: input.endDate,
    status: input.status,
  };
  const query = id
    ? supabase.from('academic_terms').update(row).eq('id', id)
    : supabase.from('academic_terms').insert({ school_id: schoolId, academic_year_id: yearId, ...row });
  const response = await query.select('*').single();
  return unwrap(response, {
    fallback: "We couldn't save this period. Please check the dates and try again.",
    conflict: 'This year already has a period with that name or position.',
  }) as AcademicTerm;
}

export async function setCurrentYear(yearId: string): Promise<void> {
  const { error } = await supabase.rpc('set_current_academic_year', { p_year_id: yearId });
  if (error) throw toAppError(error, { fallback: "We couldn't change the current academic year." });
}

export async function setCurrentTerm(termId: string): Promise<void> {
  const { error } = await supabase.rpc('set_current_term', { p_term_id: termId });
  if (error) throw toAppError(error, { fallback: "We couldn't change the current period." });
}

export function deleteAcademicYear(id: string) {
  return deleteRow('academic_years', id, {
    fallback: "We couldn't delete this academic year.",
    inUse: 'Classes are linked to this academic year. Move or remove them first.',
    blocked: "The current academic year can't be deleted. Make another year current first.",
  });
}

export function deleteTerm(id: string) {
  return deleteRow('academic_terms', id, {
    fallback: "We couldn't delete this period.",
    inUse: 'Records are linked to this period, so it cannot be deleted.',
    blocked: "The current period can't be deleted. Make another one current first.",
  });
}

// -----------------------------------------------------------------------------
// Departments, sections and faculties
// -----------------------------------------------------------------------------
export async function listDepartments(schoolId: string): Promise<Department[]> {
  const response = await supabase.from('departments').select('*').eq('school_id', schoolId).order('name');
  return unwrap(response, { fallback: "We couldn't load your departments." }) as Department[];
}

export async function saveDepartment(schoolId: string, input: DepartmentInput, id?: string): Promise<Department> {
  const row = {
    name: input.name,
    code: blank(input.code),
    kind: input.kind,
    parent_id: input.parentId || null,
    campus_id: input.campusId || null,
    description: blank(input.description),
  };
  const query = id
    ? supabase.from('departments').update(row).eq('id', id)
    : supabase.from('departments').insert({ school_id: schoolId, ...row });
  const response = await query.select('*').single();
  return unwrap(response, {
    fallback: "We couldn't save this. Please check the details and try again.",
    conflict: 'Another entry already uses this name or code.',
  }) as Department;
}

export function deleteDepartment(id: string) {
  return deleteRow('departments', id, {
    fallback: "We couldn't delete this.",
    inUse: 'Departments still belong to this faculty. Move or delete them first.',
  });
}

// -----------------------------------------------------------------------------
// Classes
// -----------------------------------------------------------------------------
export async function listClasses(schoolId: string): Promise<SchoolClass[]> {
  const response = await supabase
    .from('classes')
    .select('*')
    .eq('school_id', schoolId)
    .order('level_order')
    .order('name');
  return unwrap(response, { fallback: "We couldn't load your classes." }) as SchoolClass[];
}

export async function getClass(schoolId: string, id: string): Promise<SchoolClass | null> {
  const { data, error } = await supabase.from('classes').select('*').eq('school_id', schoolId).eq('id', id).maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this class." });
  return (data as SchoolClass | null) ?? null;
}

function classRow(input: ClassInput) {
  return {
    name: input.name,
    level: blank(input.level),
    level_order: input.levelOrder,
    campus_id: input.campusId,
    department_id: input.departmentId || null,
    academic_year_id: input.academicYearId || null,
    class_teacher_membership_id: input.classTeacherMembershipId || null,
    capacity: input.capacity === '' ? null : Number(input.capacity),
    status: input.status,
  };
}

export async function saveClass(schoolId: string, input: ClassInput, id?: string): Promise<SchoolClass> {
  const query = id
    ? supabase.from('classes').update(classRow(input)).eq('id', id)
    : supabase.from('classes').insert({ school_id: schoolId, ...classRow(input) });
  const response = await query.select('*').single();
  return unwrap(response, {
    fallback: "We couldn't save this class. Please check the details and try again.",
    conflict: 'A class with this name already exists on this campus for that year.',
  }) as SchoolClass;
}

/** Creates several classes at once (from presets). Existing names are skipped. */
export async function createClasses(
  schoolId: string,
  rows: { name: string; level: string; level_order: number; campus_id: string; academic_year_id: string | null }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const response = await supabase
    .from('classes')
    .upsert(
      rows.map((r) => ({ school_id: schoolId, ...r })),
      { onConflict: 'school_id,campus_id,academic_year_id,name', ignoreDuplicates: true },
    )
    .select('id');
  const created = unwrap(response, { fallback: "We couldn't add these classes. Please try again." }) as { id: string }[];
  return created.length;
}

export function deleteClass(id: string) {
  return deleteRow('classes', id, {
    fallback: "We couldn't delete this class.",
    inUse: 'Students or records are linked to this class. Mark it inactive instead.',
  });
}

// -----------------------------------------------------------------------------
// Subjects and class assignments
// -----------------------------------------------------------------------------
export async function listSubjects(schoolId: string): Promise<Subject[]> {
  const response = await supabase.from('subjects').select('*').eq('school_id', schoolId).order('name');
  return unwrap(response, { fallback: "We couldn't load your subjects." }) as Subject[];
}

export async function saveSubject(schoolId: string, input: SubjectInput, id?: string): Promise<Subject> {
  const row = {
    name: input.name,
    code: input.code,
    department_id: input.departmentId || null,
    description: blank(input.description),
    status: input.status,
  };
  const query = id
    ? supabase.from('subjects').update(row).eq('id', id)
    : supabase.from('subjects').insert({ school_id: schoolId, ...row });
  const response = await query.select('*').single();
  return unwrap(response, {
    fallback: "We couldn't save this. Please check the details and try again.",
    conflict: 'Another entry already uses this name or code.',
  }) as Subject;
}

export async function createSubjects(schoolId: string, rows: { name: string; code: string }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const response = await supabase
    .from('subjects')
    .upsert(
      rows.map((r) => ({ school_id: schoolId, ...r })),
      { onConflict: 'school_id,code', ignoreDuplicates: true },
    )
    .select('id');
  const created = unwrap(response, { fallback: "We couldn't add these subjects. Please try again." }) as { id: string }[];
  return created.length;
}

export function deleteSubject(id: string) {
  return deleteRow('subjects', id, {
    fallback: "We couldn't delete this.",
    inUse: 'Records are linked to this subject. Mark it inactive instead.',
  });
}

export async function listClassSubjects(schoolId: string, classId?: string): Promise<ClassSubject[]> {
  let query = supabase.from('class_subjects').select('*').eq('school_id', schoolId);
  if (classId) query = query.eq('class_id', classId);
  const response = await query;
  return unwrap(response, { fallback: "We couldn't load the class subjects." }) as ClassSubject[];
}

export async function assignSubjects(schoolId: string, classId: string, subjectIds: string[]): Promise<void> {
  if (subjectIds.length === 0) return;
  const { error } = await supabase
    .from('class_subjects')
    .upsert(
      subjectIds.map((subject_id) => ({ school_id: schoolId, class_id: classId, subject_id })),
      { onConflict: 'class_id,subject_id', ignoreDuplicates: true },
    );
  if (error) throw toAppError(error, { fallback: "We couldn't assign these subjects. Please try again." });
}

export async function setSubjectTeacher(classSubjectId: string, membershipId: string | null): Promise<void> {
  const { error } = await supabase
    .from('class_subjects')
    .update({ teacher_membership_id: membershipId })
    .eq('id', classSubjectId);
  if (error) throw toAppError(error, { fallback: "We couldn't change the teacher." });
}

export async function removeClassSubject(id: string): Promise<void> {
  const { error } = await supabase.from('class_subjects').delete().eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't remove this subject from the class." });
}

// -----------------------------------------------------------------------------
// Staff and invitations
// -----------------------------------------------------------------------------
export async function listMembers(schoolId: string): Promise<SchoolMember[]> {
  const { data, error } = await supabase.rpc('list_school_members', { p_school_id: schoolId });
  if (error) throw toAppError(error, { fallback: "We couldn't load the people in your school." });
  return (data ?? []) as SchoolMember[];
}

export type InvitationWithRole = Invitation & { role: { name: string } | null };

export async function listInvitations(schoolId: string): Promise<InvitationWithRole[]> {
  const response = await supabase
    .from('invitations')
    .select('id, school_id, email, role_id, campus_id, status, invited_by, expires_at, accepted_by, accepted_at, created_at, updated_at, role:roles!invitations_role_fk ( name )')
    .eq('school_id', schoolId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return unwrap(response, { fallback: "We couldn't load pending invitations." }) as unknown as InvitationWithRole[];
}

export async function createInvitation(
  schoolId: string,
  input: { email: string; roleId: string; campusId: string | null },
): Promise<CreatedInvitation> {
  const { data, error } = await supabase.rpc('create_invitation', {
    p_school_id: schoolId,
    p_email: input.email,
    p_role_id: input.roleId,
    p_campus_id: input.campusId,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't create this invitation. Please try again." });
  const row = (data as CreatedInvitation[] | null)?.[0];
  if (!row) throw new AppError("We couldn't create this invitation. Please try again.");
  return row;
}

/**
 * Asks the `send-invitation` Edge Function to email the link. Returns false
 * when email delivery is not set up, so the caller can offer the link instead.
 */
export async function emailInvitation(invitationId: string, token: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('send-invitation', {
      body: { invitationId, token },
    });
    return !error && (data as { sent?: boolean } | null)?.sent === true;
  } catch {
    return false;
  }
}

export async function revokeInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: id });
  if (error) throw toAppError(error, { fallback: "We couldn't cancel this invitation." });
}

export async function updateMembership(
  membershipId: string,
  changes: { roleId?: string; status?: 'active' | 'inactive' | 'suspended' },
): Promise<void> {
  const { error } = await supabase.rpc('update_membership', {
    p_membership_id: membershipId,
    p_role_id: changes.roleId ?? null,
    p_status: changes.status ?? null,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't update this person's access." });
}
