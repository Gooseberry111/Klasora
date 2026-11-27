/**
 * Phase 4 data access: timetable, attendance, assignments, submissions,
 * assessments, grading, results and report cards.
 */
import type {
  Assessment,
  AssessmentInput,
  AssessmentScore,
  Assignment,
  AssignmentInput,
  AssignmentSubmission,
  AttendanceRecord,
  AttendanceReportRow,
  AttendanceSession,
  AttendanceSessionType,
  AttendanceStatus,
  ClassResultRow,
  CreatedInvitation,
  GradingBand,
  MyStudent,
  ReportCard,
  StudentAttendanceRow,
  StudentResultRow,
  TimetableEntry,
  TimetableEntryInput,
} from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { AppError, toAppError, unwrap } from '@/lib/errors';

const FILES = 'academic-files';
const blank = (v: string) => (v.trim() === '' ? null : v.trim());

// -----------------------------------------------------------------------------
// Student portal
// -----------------------------------------------------------------------------
export async function fetchMyStudent(schoolId: string): Promise<MyStudent | null> {
  const { data, error } = await supabase.rpc('get_my_student', { p_school_id: schoolId });
  if (error) return null;
  return ((data as MyStudent[] | null) ?? [])[0] ?? null;
}

export async function inviteStudent(studentId: string, email: string): Promise<CreatedInvitation> {
  const { data, error } = await supabase.rpc('invite_student', { p_student_id: studentId, p_email: email });
  if (error) throw toAppError(error, { fallback: "We couldn't create this invitation." });
  const row = (data as CreatedInvitation[] | null)?.[0];
  if (!row) throw new AppError("We couldn't create this invitation.");
  return row;
}

// -----------------------------------------------------------------------------
// Timetable
// -----------------------------------------------------------------------------
export async function listTimetable(schoolId: string, filter: { classIds?: string[]; teacherMembershipIds?: string[] } = {}): Promise<TimetableEntry[]> {
  let query = supabase.from('timetable_entries').select('*').eq('school_id', schoolId);
  if (filter.classIds) query = query.in('class_id', filter.classIds.length ? filter.classIds : ['00000000-0000-0000-0000-000000000000']);
  if (filter.teacherMembershipIds) query = query.in('teacher_membership_id', filter.teacherMembershipIds.length ? filter.teacherMembershipIds : ['00000000-0000-0000-0000-000000000000']);
  const response = await query.order('day_of_week').order('start_time');
  return unwrap(response, { fallback: "We couldn't load the timetable." }) as TimetableEntry[];
}

export async function saveTimetableEntry(schoolId: string, yearId: string | null, input: TimetableEntryInput, id?: string): Promise<TimetableEntry> {
  const row = {
    subject_id: input.subjectId || null,
    label: blank(input.label),
    teacher_membership_id: input.teacherMembershipId || null,
    day_of_week: input.dayOfWeek,
    start_time: input.startTime,
    end_time: input.endTime,
    room: blank(input.room),
  };
  const query = id
    ? supabase.from('timetable_entries').update(row).eq('id', id)
    : supabase.from('timetable_entries').insert({ school_id: schoolId, class_id: input.classId, academic_year_id: yearId, ...row });
  const response = await query.select('*').single();
  return unwrap(response, { fallback: "We couldn't save this period. Please check the times and try again." }) as TimetableEntry;
}

export async function deleteTimetableEntry(id: string): Promise<void> {
  const { error } = await supabase.from('timetable_entries').delete().eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't remove this period." });
}

// -----------------------------------------------------------------------------
// Attendance
// -----------------------------------------------------------------------------
export async function getAttendanceSession(
  classId: string,
  date: string,
  sessionType: AttendanceSessionType,
  subjectId: string | null,
): Promise<{ session: AttendanceSession | null; records: AttendanceRecord[] }> {
  let query = supabase.from('attendance_sessions').select('*').eq('class_id', classId).eq('attendance_date', date).eq('session_type', sessionType);
  query = subjectId ? query.eq('subject_id', subjectId) : query.is('subject_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this register." });
  const session = (data as AttendanceSession | null) ?? null;
  if (!session) return { session: null, records: [] };
  const response = await supabase.from('attendance_records').select('*').eq('session_id', session.id);
  return { session, records: unwrap(response, { fallback: "We couldn't load this register." }) as AttendanceRecord[] };
}

export async function saveAttendance(params: {
  classId: string;
  date: string;
  sessionType: AttendanceSessionType;
  subjectId: string | null;
  records: { student_id: string; status: AttendanceStatus; remarks?: string }[];
  submit: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('save_attendance', {
    p_class_id: params.classId,
    p_date: params.date,
    p_session_type: params.sessionType,
    p_subject_id: params.subjectId,
    p_records: params.records,
    p_submit: params.submit,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't save the register. Please try again." });
  return data as string;
}

export async function attendanceReport(schoolId: string, from: string, to: string, classId?: string): Promise<AttendanceReportRow[]> {
  const { data, error } = await supabase.rpc('attendance_report', { p_school_id: schoolId, p_from: from, p_to: to, p_class_id: classId ?? null });
  if (error) throw toAppError(error, { fallback: "We couldn't load attendance figures." });
  return (data ?? []) as AttendanceReportRow[];
}

export async function studentAttendance(studentId: string, from: string, to: string): Promise<StudentAttendanceRow[]> {
  const { data, error } = await supabase.rpc('student_attendance', { p_student_id: studentId, p_from: from, p_to: to });
  if (error) throw toAppError(error, { fallback: "We couldn't load attendance." });
  return (data ?? []) as StudentAttendanceRow[];
}

/** Submitted registers in a date range (to show which classes still need marking). */
export async function listSessions(schoolId: string, from: string, to: string): Promise<AttendanceSession[]> {
  const response = await supabase.from('attendance_sessions').select('*').eq('school_id', schoolId).gte('attendance_date', from).lte('attendance_date', to);
  return unwrap(response, { fallback: "We couldn't load registers." }) as AttendanceSession[];
}

// -----------------------------------------------------------------------------
// Assignments
// -----------------------------------------------------------------------------
export async function listAssignments(schoolId: string, classIds?: string[]): Promise<Assignment[]> {
  let query = supabase.from('assignments').select('*').eq('school_id', schoolId);
  if (classIds) query = query.in('class_id', classIds.length ? classIds : ['00000000-0000-0000-0000-000000000000']);
  const response = await query.order('due_at', { ascending: false }).limit(1000);
  return unwrap(response, { fallback: "We couldn't load assignments." }) as Assignment[];
}

export async function getAssignment(id: string): Promise<Assignment | null> {
  const { data, error } = await supabase.from('assignments').select('*').eq('id', id).maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this assignment." });
  return (data as Assignment | null) ?? null;
}

export async function saveAssignment(
  schoolId: string,
  input: AssignmentInput,
  extras: { status: Assignment['status']; teacherMembershipId: string | null; attachmentPaths: string[] },
  id?: string,
): Promise<Assignment> {
  const row = {
    subject_id: input.subjectId,
    title: input.title,
    description: blank(input.description),
    due_at: new Date(`${input.dueDate}T${input.dueTime}:00`).toISOString(),
    maximum_score: input.maximumScore === '' ? null : Number(input.maximumScore),
    allow_late: input.allowLate,
    status: extras.status,
    attachment_paths: extras.attachmentPaths,
  };
  const query = id
    ? supabase.from('assignments').update(row).eq('id', id)
    : supabase.from('assignments').insert({ school_id: schoolId, class_id: input.classId, teacher_membership_id: extras.teacherMembershipId, ...row });
  const response = await query.select('*').single();
  return unwrap(response, { fallback: "We couldn't save this assignment. You can only set work for classes you teach." }) as Assignment;
}

export async function setAssignmentStatus(id: string, status: Assignment['status']): Promise<void> {
  const { error } = await supabase.from('assignments').update({ status }).eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't update this assignment." });
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error, count } = await supabase.from('assignments').delete({ count: 'exact' }).eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't delete this assignment." });
  if (count === 0) throw new AppError("You can't delete this assignment.");
}

export async function listSubmissions(assignmentIds: string[]): Promise<AssignmentSubmission[]> {
  if (!assignmentIds.length) return [];
  const response = await supabase.from('assignment_submissions').select('*').in('assignment_id', assignmentIds);
  return unwrap(response, { fallback: "We couldn't load submissions." }) as AssignmentSubmission[];
}

export async function submitAssignment(assignmentId: string, body: string, files: string[]): Promise<void> {
  const { error } = await supabase.rpc('submit_assignment', { p_assignment_id: assignmentId, p_body: body, p_files: files });
  if (error) throw toAppError(error, { fallback: "We couldn't hand in your work. Please try again." });
}

export async function gradeSubmission(assignmentId: string, studentId: string, score: number | null, feedback: string, returnForCorrection = false): Promise<void> {
  const { error } = await supabase.rpc('grade_submission', {
    p_assignment_id: assignmentId,
    p_student_id: studentId,
    p_score: score,
    p_feedback: feedback,
    p_return: returnForCorrection,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't save this grade." });
}

const ALLOWED = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

/** Uploads a file under the given folder and returns its storage path. */
export async function uploadAcademicFile(folder: string, file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new AppError('Attach a PDF, Word, PowerPoint, text file or an image.');
  if (file.size > 20 * 1024 * 1024) throw new AppError('Choose a file smaller than 20 MB.');
  const safe = file.name.replace(/[^A-Za-z0-9._ ]/g, '_').slice(-80);
  const path = `${folder}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from(FILES).upload(path, file, { contentType: file.type });
  if (error) throw new AppError("We couldn't upload this file.", 'upload_failed', error);
  return path;
}

export async function academicFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(FILES).createSignedUrl(path, 300);
  if (error || !data) throw new AppError("We couldn't open this file.");
  return data.signedUrl;
}

export const fileName = (path: string) => path.split('/').pop()!.replace(/^\d+_/, '');

// -----------------------------------------------------------------------------
// Assessments
// -----------------------------------------------------------------------------
export async function listAssessments(schoolId: string, filter: { classId?: string; termId?: string } = {}): Promise<Assessment[]> {
  let query = supabase.from('assessments').select('*').eq('school_id', schoolId);
  if (filter.classId) query = query.eq('class_id', filter.classId);
  if (filter.termId) query = query.eq('term_id', filter.termId);
  const response = await query.order('created_at', { ascending: false }).limit(1000);
  return unwrap(response, { fallback: "We couldn't load assessments." }) as Assessment[];
}

export async function getAssessment(id: string): Promise<Assessment | null> {
  const { data, error } = await supabase.from('assessments').select('*').eq('id', id).maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this assessment." });
  return (data as Assessment | null) ?? null;
}

export async function saveAssessment(schoolId: string, input: AssessmentInput, id?: string): Promise<Assessment> {
  const row = {
    title: input.title,
    assessment_type: input.assessmentType,
    maximum_score: input.maximumScore,
    weight: input.weight,
    assessment_date: input.assessmentDate || null,
  };
  const query = id
    ? supabase.from('assessments').update(row).eq('id', id)
    : supabase.from('assessments').insert({ school_id: schoolId, term_id: input.termId, class_id: input.classId, subject_id: input.subjectId, ...row });
  const response = await query.select('*').single();
  return unwrap(response, { fallback: "We couldn't save this assessment. You can only create assessments for subjects you teach." }) as Assessment;
}

export async function deleteAssessment(id: string): Promise<void> {
  const { error, count } = await supabase.from('assessments').delete({ count: 'exact' }).eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't delete this assessment." });
  if (count === 0) throw new AppError('Only draft or returned assessments can be deleted.');
}

export async function listScores(assessmentIds: string[]): Promise<AssessmentScore[]> {
  if (!assessmentIds.length) return [];
  const response = await supabase.from('assessment_scores').select('*').in('assessment_id', assessmentIds);
  return unwrap(response, { fallback: "We couldn't load scores." }) as AssessmentScore[];
}

export async function saveScores(assessmentId: string, scores: { student_id: string; score: number | null; is_absent: boolean; remarks: string }[]): Promise<void> {
  const { error } = await supabase.rpc('save_scores', { p_assessment_id: assessmentId, p_scores: scores });
  if (error) throw toAppError(error, { fallback: "We couldn't save these scores." });
}

export async function submitAssessment(id: string) {
  const { error } = await supabase.rpc('submit_assessment', { p_assessment_id: id });
  if (error) throw toAppError(error, { fallback: "We couldn't submit these results." });
}

export async function reviewAssessment(id: string, approve: boolean, note: string) {
  const { error } = await supabase.rpc('review_assessment', { p_assessment_id: id, p_approve: approve, p_note: note || null });
  if (error) throw toAppError(error, { fallback: "We couldn't record your review." });
}

export async function publishAssessments(ids: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('publish_assessments', { p_assessment_ids: ids });
  if (error) throw toAppError(error, { fallback: "We couldn't publish these results." });
  return data as number;
}

// -----------------------------------------------------------------------------
// Grading and results
// -----------------------------------------------------------------------------
export async function listGradingBands(schoolId: string): Promise<GradingBand[]> {
  const response = await supabase.from('grading_bands').select('*').eq('school_id', schoolId).order('min_score', { ascending: false });
  return unwrap(response, { fallback: "We couldn't load the grading scale." }) as GradingBand[];
}

/** Replaces the school's grading scale with these bands, all at once. */
export async function saveGradingBands(schoolId: string, bands: { grade: string; min_score: number; remark: string }[]): Promise<void> {
  const { error } = await supabase.rpc('set_grading_scale', { p_school_id: schoolId, p_bands: bands });
  if (error) throw toAppError(error, { fallback: "We couldn't save the grading scale." });
}

export async function setShowPositions(schoolId: string, show: boolean): Promise<void> {
  const { error } = await supabase.from('schools').update({ show_class_positions: show }).eq('id', schoolId);
  if (error) throw toAppError(error, { fallback: "We couldn't save this setting." });
}

export async function getShowPositions(schoolId: string): Promise<boolean> {
  const { data } = await supabase.from('schools').select('show_class_positions').eq('id', schoolId).maybeSingle();
  return Boolean((data as { show_class_positions?: boolean } | null)?.show_class_positions);
}

export async function classResults(classId: string, termId: string, publishedOnly = false): Promise<ClassResultRow[]> {
  const { data, error } = await supabase.rpc('get_class_results', { p_class_id: classId, p_term_id: termId, p_published_only: publishedOnly });
  if (error) throw toAppError(error, { fallback: "We couldn't load these results." });
  return ((data ?? []) as ClassResultRow[]).map((r) => ({ ...r, total: Number(r.total) }));
}

export async function studentResults(studentId: string, termId: string): Promise<StudentResultRow[]> {
  const { data, error } = await supabase.rpc('get_student_results', { p_student_id: studentId, p_term_id: termId });
  if (error) throw toAppError(error, { fallback: "We couldn't load results." });
  return ((data ?? []) as StudentResultRow[]).map((r) => ({ ...r, total: Number(r.total), class_average: Number(r.class_average) }));
}

// -----------------------------------------------------------------------------
// Report cards
// -----------------------------------------------------------------------------
export async function listReportCards(schoolId: string, filter: { classId?: string; termId?: string; studentId?: string }): Promise<ReportCard[]> {
  let query = supabase.from('report_cards').select('*').eq('school_id', schoolId);
  if (filter.classId) query = query.eq('class_id', filter.classId);
  if (filter.termId) query = query.eq('term_id', filter.termId);
  if (filter.studentId) query = query.eq('student_id', filter.studentId);
  const response = await query;
  return (unwrap(response, { fallback: "We couldn't load report cards." }) as ReportCard[]).map((c) => ({
    ...c,
    average: c.average === null ? null : Number(c.average),
  }));
}

export async function getReportCard(id: string): Promise<ReportCard | null> {
  const { data, error } = await supabase.from('report_cards').select('*').eq('id', id).maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this report card." });
  const card = data as ReportCard | null;
  return card ? { ...card, average: card.average === null ? null : Number(card.average) } : null;
}

export async function generateReportCards(classId: string, termId: string): Promise<number> {
  const { data, error } = await supabase.rpc('generate_report_cards', { p_class_id: classId, p_term_id: termId });
  if (error) throw toAppError(error, { fallback: "We couldn't prepare report cards." });
  return data as number;
}

export async function saveReportComment(id: string, kind: 'teacher' | 'principal', comment: string): Promise<void> {
  const { error } = await supabase.rpc('save_report_comment', { p_report_card_id: id, p_kind: kind, p_comment: comment });
  if (error) throw toAppError(error, { fallback: "We couldn't save this comment." });
}

export async function publishReportCards(classId: string, termId: string): Promise<number> {
  const { data, error } = await supabase.rpc('publish_report_cards', { p_class_id: classId, p_term_id: termId });
  if (error) throw toAppError(error, { fallback: "We couldn't publish report cards." });
  return data as number;
}
