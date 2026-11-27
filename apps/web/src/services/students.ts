/**
 * Phase 3 data access: students, health details, guardians, enrolment,
 * import, files and staff profiles. RLS decides what each person sees; these
 * functions shape requests and turn database answers into friendly messages.
 */
import type {
  ChildSummary,
  ClassEnrollment,
  CreatedInvitation,
  Guardian,
  GuardianFormInput,
  GuardianLinkInput,
  PeopleCounts,
  StaffProfile,
  StaffProfileInput,
  Student,
  StudentDetails,
  StudentDetailsInput,
  StudentFormInput,
  StudentGuardian,
} from '@klasora/shared';
import { isoDate } from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { AppError, toAppError, unwrap } from '@/lib/errors';

const blank = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === '' ? null : v.trim());
const BUCKET = 'student-files';

// -----------------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------------
export async function listStudents(schoolId: string): Promise<Student[]> {
  const response = await supabase
    .from('students')
    .select('*')
    .eq('school_id', schoolId)
    .order('last_name')
    .order('first_name')
    .limit(5000);
  return unwrap(response, { fallback: "We couldn't load your students. Please try again." }) as Student[];
}

export async function getStudent(schoolId: string, id: string): Promise<Student | null> {
  const { data, error } = await supabase.from('students').select('*').eq('school_id', schoolId).eq('id', id).maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this student." });
  return (data as Student | null) ?? null;
}

function detailsPayload(d: StudentDetailsInput) {
  return {
    home_address: blank(d.homeAddress),
    blood_group: blank(d.bloodGroup),
    genotype: blank(d.genotype),
    medical_conditions: blank(d.medicalConditions),
    allergies: blank(d.allergies),
    medications: blank(d.medications),
    accessibility_needs: blank(d.accessibilityNeeds),
    emergency_contact_name: blank(d.emergencyContactName),
    emergency_contact_phone: blank(d.emergencyContactPhone),
    emergency_contact_relationship: blank(d.emergencyContactRelationship),
  };
}

export interface NewGuardian {
  guardian_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  occupation?: string;
  relationship: string;
}

export async function registerStudent(
  schoolId: string,
  student: StudentFormInput,
  details: StudentDetailsInput | null,
  guardians: NewGuardian[],
): Promise<string> {
  const { data, error } = await supabase.rpc('register_student', {
    p_school_id: schoolId,
    p_student: {
      first_name: student.firstName,
      middle_name: student.middleName,
      last_name: student.lastName,
      gender: student.gender,
      date_of_birth: student.dateOfBirth,
      admission_number: student.admissionNumber,
      admission_date: student.admissionDate,
      campus_id: student.campusId,
      status: student.status,
      previous_school: student.previousSchool,
    },
    p_details: details ? detailsPayload(details) : null,
    p_guardians: guardians,
    p_class_id: student.classId || null,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't register this student. Please check the details and try again.", conflict: 'This admission number is already in use.' });
  return data as string;
}

export async function updateStudent(id: string, student: StudentFormInput): Promise<Student> {
  const response = await supabase
    .from('students')
    .update({
      first_name: student.firstName,
      middle_name: blank(student.middleName),
      last_name: student.lastName,
      gender: student.gender || null,
      date_of_birth: blank(student.dateOfBirth),
      admission_number: student.admissionNumber.trim(),
      admission_date: student.admissionDate,
      campus_id: student.campusId,
      status: student.status,
      previous_school: blank(student.previousSchool),
    })
    .eq('id', id)
    .select('*')
    .single();
  return unwrap(response, {
    fallback: "We couldn't save these changes. Please check the details and try again.",
    conflict: 'This admission number is already in use.',
  }) as Student;
}

export async function deleteStudent(id: string): Promise<void> {
  const { error, count } = await supabase.from('students').delete({ count: 'exact' }).eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't delete this student.", inUse: 'Records are linked to this student. Mark them as withdrawn instead.' });
  if (count === 0) throw new AppError("You don't have permission to delete students.");
}

export async function getStudentDetails(studentId: string): Promise<StudentDetails | null> {
  const { data, error } = await supabase.from('student_details').select('*').eq('student_id', studentId).maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load health and welfare details." });
  return (data as StudentDetails | null) ?? null;
}

export async function saveStudentDetails(schoolId: string, studentId: string, input: StudentDetailsInput): Promise<StudentDetails> {
  const response = await supabase
    .from('student_details')
    .upsert({ student_id: studentId, school_id: schoolId, ...detailsPayload(input) }, { onConflict: 'student_id' })
    .select('*')
    .single();
  return unwrap(response, { fallback: "We couldn't save health and welfare details." }) as StudentDetails;
}

export async function importStudents(schoolId: string, rows: Record<string, string>[]): Promise<number> {
  const { data, error } = await supabase.rpc('import_students', { p_school_id: schoolId, p_rows: rows });
  if (error) throw toAppError(error, { fallback: "We couldn't import this file. Nothing was saved." });
  return data as number;
}

export async function fetchPeopleCounts(schoolId: string): Promise<PeopleCounts> {
  const { data, error } = await supabase.rpc('get_people_counts', { p_school_id: schoolId });
  if (error) throw toAppError(error, { fallback: "We couldn't load your school's figures." });
  return ((data as PeopleCounts[] | null) ?? [])[0]!;
}

export async function fetchMyChildren(schoolId: string): Promise<ChildSummary[]> {
  const { data, error } = await supabase.rpc('get_my_children', { p_school_id: schoolId });
  if (error) throw toAppError(error, { fallback: "We couldn't load your children." });
  return (data ?? []) as ChildSummary[];
}

// -----------------------------------------------------------------------------
// Enrolment
// -----------------------------------------------------------------------------
export async function listEnrollments(schoolId: string, filter: { studentId?: string; classId?: string; activeOnly?: boolean } = {}): Promise<ClassEnrollment[]> {
  let query = supabase.from('class_enrollments').select('*').eq('school_id', schoolId);
  if (filter.studentId) query = query.eq('student_id', filter.studentId);
  if (filter.classId) query = query.eq('class_id', filter.classId);
  if (filter.activeOnly) query = query.eq('status', 'active');
  const response = await query.order('start_date', { ascending: false });
  return unwrap(response, { fallback: "We couldn't load class enrolments." }) as ClassEnrollment[];
}

export async function enrollStudents(classId: string, studentIds: string[], startDate?: string): Promise<number> {
  const { data, error } = await supabase.rpc('enroll_students', {
    p_class_id: classId,
    p_student_ids: studentIds,
    p_start_date: startDate ?? isoDate(new Date()),
  });
  if (error) throw toAppError(error, { fallback: "We couldn't enrol these students." });
  return data as number;
}

export async function endEnrollment(studentId: string, status: 'withdrawn' | 'completed' = 'withdrawn'): Promise<void> {
  const { error } = await supabase.rpc('end_enrollment', { p_student_id: studentId, p_status: status });
  if (error) throw toAppError(error, { fallback: "We couldn't remove this student from the class." });
}

// -----------------------------------------------------------------------------
// Guardians
// -----------------------------------------------------------------------------
export async function listGuardians(schoolId: string): Promise<Guardian[]> {
  const response = await supabase.from('guardians').select('*').eq('school_id', schoolId).order('last_name').order('first_name').limit(5000);
  return unwrap(response, { fallback: "We couldn't load parents and guardians." }) as Guardian[];
}

export async function listStudentGuardians(schoolId: string, studentId?: string): Promise<StudentGuardian[]> {
  let query = supabase.from('student_guardians').select('*').eq('school_id', schoolId);
  if (studentId) query = query.eq('student_id', studentId);
  const response = await query;
  return unwrap(response, { fallback: "We couldn't load guardian links." }) as StudentGuardian[];
}

function guardianRow(input: GuardianFormInput) {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    email: blank(input.email)?.toLowerCase() ?? null,
    phone: blank(input.phone),
    occupation: blank(input.occupation),
    address: blank(input.address),
  };
}

export async function saveGuardian(schoolId: string, input: GuardianFormInput, id?: string): Promise<Guardian> {
  const query = id
    ? supabase.from('guardians').update(guardianRow(input)).eq('id', id)
    : supabase.from('guardians').insert({ school_id: schoolId, ...guardianRow(input) });
  const response = await query.select('*').single();
  return unwrap(response, {
    fallback: "We couldn't save this guardian. Please check the details and try again.",
    conflict: 'A guardian with this email address already exists. Link the existing guardian instead.',
  }) as Guardian;
}

export async function deleteGuardian(id: string): Promise<void> {
  const { error, count } = await supabase.from('guardians').delete({ count: 'exact' }).eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't remove this guardian." });
  if (count === 0) throw new AppError("You don't have permission to remove guardians.");
}

export async function linkGuardian(schoolId: string, studentId: string, guardianId: string, link: GuardianLinkInput): Promise<void> {
  if (link.isPrimary) await clearPrimary(studentId);
  const { error } = await supabase.from('student_guardians').insert({
    school_id: schoolId,
    student_id: studentId,
    guardian_id: guardianId,
    relationship: link.relationship,
    is_primary: link.isPrimary,
    is_emergency_contact: link.isEmergencyContact,
    can_view_results: link.canViewResults,
    can_view_finances: link.canViewFinances,
    can_receive_notifications: link.canReceiveNotifications,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't link this guardian.", conflict: 'This guardian is already linked to the student.' });
}

async function clearPrimary(studentId: string) {
  const { error } = await supabase.from('student_guardians').update({ is_primary: false }).eq('student_id', studentId).eq('is_primary', true);
  if (error) throw toAppError(error, { fallback: "We couldn't update the primary guardian." });
}

export async function updateGuardianLink(link: StudentGuardian, changes: GuardianLinkInput): Promise<void> {
  if (changes.isPrimary && !link.is_primary) await clearPrimary(link.student_id);
  const { error } = await supabase
    .from('student_guardians')
    .update({
      relationship: changes.relationship,
      is_primary: changes.isPrimary,
      is_emergency_contact: changes.isEmergencyContact,
      can_view_results: changes.canViewResults,
      can_view_finances: changes.canViewFinances,
      can_receive_notifications: changes.canReceiveNotifications,
    })
    .eq('id', link.id);
  if (error) throw toAppError(error, { fallback: "We couldn't save this guardian link." });
}

export async function unlinkGuardian(linkId: string): Promise<void> {
  const { error } = await supabase.from('student_guardians').delete().eq('id', linkId);
  if (error) throw toAppError(error, { fallback: "We couldn't remove this guardian from the student." });
}

export async function inviteGuardian(guardianId: string): Promise<CreatedInvitation> {
  const { data, error } = await supabase.rpc('invite_guardian', { p_guardian_id: guardianId });
  if (error) throw toAppError(error, { fallback: "We couldn't create this invitation." });
  const row = (data as CreatedInvitation[] | null)?.[0];
  if (!row) throw new AppError("We couldn't create this invitation.");
  return row;
}

/** Guardian ids with a pending, unexpired portal invitation. */
export async function listPendingGuardianInvites(schoolId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('invitations')
    .select('guardian_id')
    .eq('school_id', schoolId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .not('guardian_id', 'is', null);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => (r as { guardian_id: string }).guardian_id));
}

// -----------------------------------------------------------------------------
// Photos and documents (private bucket, signed URLs)
// -----------------------------------------------------------------------------
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function uploadStudentPhoto(schoolId: string, studentId: string, file: File): Promise<Student> {
  if (!IMAGE_TYPES.includes(file.type)) throw new AppError('Choose a PNG, JPG or WEBP photo.');
  if (file.size > 5 * 1024 * 1024) throw new AppError('Choose a photo smaller than 5 MB.');
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${schoolId}/${studentId}/photo/${Date.now()}.${ext}`;
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) throw new AppError("We couldn't upload this photo. Please try another image.", 'upload_failed', upload.error);
  const response = await supabase.from('students').update({ photo_path: path }).eq('id', studentId).select('*').single();
  return unwrap(response, { fallback: "We uploaded the photo but couldn't save it to the profile." }) as Student;
}

/** Signed URLs for photo paths, valid for an hour. Missing or forbidden files are skipped. */
export async function signedPhotoUrls(paths: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (unique.length === 0) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(unique, 3600);
  const result: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) result[item.path] = item.signedUrl;
  return result;
}

export interface StudentDocument {
  name: string;
  path: string;
  size: number;
  createdAt: string | null;
}

export async function listStudentDocuments(schoolId: string, studentId: string): Promise<StudentDocument[]> {
  const folder = `${schoolId}/${studentId}/documents`;
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw new AppError("We couldn't load documents.");
  return (data ?? [])
    .filter((f) => f.id)
    .map((f) => ({
      name: f.name.replace(/^\d+_/, ''),
      path: `${folder}/${f.name}`,
      size: (f.metadata as { size?: number } | null)?.size ?? 0,
      createdAt: f.created_at ?? null,
    }));
}

export async function uploadStudentDocument(schoolId: string, studentId: string, file: File): Promise<void> {
  if (![...IMAGE_TYPES, 'application/pdf'].includes(file.type)) throw new AppError('Choose a PDF or an image.');
  if (file.size > 10 * 1024 * 1024) throw new AppError('Choose a file smaller than 10 MB.');
  const safe = file.name.replace(/[^A-Za-z0-9._ ]/g, '_').slice(-80);
  const { error } = await supabase.storage.from(BUCKET).upload(`${schoolId}/${studentId}/documents/${Date.now()}_${safe}`, file, {
    contentType: file.type,
  });
  if (error) throw new AppError("We couldn't upload this document.", 'upload_failed', error);
}

export async function documentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data) throw new AppError("We couldn't open this document.");
  return data.signedUrl;
}

export async function deleteStudentDocument(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new AppError("We couldn't delete this document.");
}

// -----------------------------------------------------------------------------
// Activity history (needs audit.view)
// -----------------------------------------------------------------------------
export interface ActivityEntry {
  id: string;
  action: string;
  entity_type: string;
  actor_user_id: string | null;
  previous_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

export async function listStudentActivity(schoolId: string, studentId: string): Promise<ActivityEntry[]> {
  const response = await supabase
    .from('audit_logs')
    .select('id, action, entity_type, actor_user_id, previous_data, new_data, created_at')
    .eq('school_id', schoolId)
    .or(`entity_id.eq.${studentId},new_data->>student_id.eq.${studentId},previous_data->>student_id.eq.${studentId}`)
    .order('created_at', { ascending: false })
    .limit(100);
  return unwrap(response, { fallback: "We couldn't load the activity history." }) as ActivityEntry[];
}

// -----------------------------------------------------------------------------
// Staff profiles
// -----------------------------------------------------------------------------
export async function listStaffProfiles(schoolId: string): Promise<StaffProfile[]> {
  const response = await supabase.from('staff_profiles').select('*').eq('school_id', schoolId);
  return unwrap(response, { fallback: "We couldn't load staff profiles." }) as StaffProfile[];
}

export async function saveStaffProfile(schoolId: string, userId: string, input: StaffProfileInput): Promise<StaffProfile> {
  const response = await supabase
    .from('staff_profiles')
    .upsert(
      {
        school_id: schoolId,
        user_id: userId,
        staff_number: blank(input.staffNumber),
        job_title: blank(input.jobTitle),
        department_id: input.departmentId || null,
        employment_type: input.employmentType,
        employment_status: input.employmentStatus,
        employment_start_date: blank(input.employmentStartDate),
        qualifications: blank(input.qualifications),
      },
      { onConflict: 'school_id,user_id' },
    )
    .select('*')
    .single();
  return unwrap(response, { fallback: "We couldn't save this staff profile.", conflict: 'Another staff member already has this staff number.' }) as StaffProfile;
}
