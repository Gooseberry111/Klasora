/**
 * Phase 4: timetables, attendance, assignments, assessments, results and
 * report cards. Row types mirror the database; helpers are shared by the
 * web and mobile apps so both calculate the same way.
 */
import { z } from 'zod';

type Uuid = string;
type Timestamp = string;

// -----------------------------------------------------------------------------
// Timetable
// -----------------------------------------------------------------------------
export const WEEK_DAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 7, label: 'Sunday', short: 'Sun' },
] as const;

export interface TimetableEntry {
  id: Uuid;
  school_id: Uuid;
  academic_year_id: Uuid | null;
  class_id: Uuid;
  subject_id: Uuid | null;
  label: string | null;
  teacher_membership_id: Uuid | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Minutes since midnight for "08:30" or "08:30:00". */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "08:30:00" becomes "8:30am". */
export function formatTime(value: string): string {
  const minutes = timeToMinutes(value);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

/** Monday is 1 and Sunday is 7, matching the database. */
export function isoWeekday(date = new Date()): number {
  return ((date.getDay() + 6) % 7) + 1;
}

export const timetableEntrySchema = z
  .object({
    classId: z.string().min(1, { error: 'Choose a class.' }),
    subjectId: z.string(),
    label: z.string().trim().max(60),
    teacherMembershipId: z.string(),
    dayOfWeek: z.coerce.number().int().min(1).max(7),
    startTime: z.string().regex(/^\d{2}:\d{2}/, { error: 'Choose a start time.' }),
    endTime: z.string().regex(/^\d{2}:\d{2}/, { error: 'Choose an end time.' }),
    room: z.string().trim().max(60),
  })
  .refine((v) => v.subjectId !== '' || v.label !== '', { error: 'Choose a subject, or name the period (for example Break).', path: ['subjectId'] })
  .refine((v) => timeToMinutes(v.endTime) > timeToMinutes(v.startTime), { error: 'The end time must be after the start time.', path: ['endTime'] });
export type TimetableEntryInput = z.infer<typeof timetableEntrySchema>;

// -----------------------------------------------------------------------------
// Attendance
// -----------------------------------------------------------------------------
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
};
export const ATTENDANCE_SESSION_LABELS = { daily: 'Daily register', morning: 'Morning', afternoon: 'Afternoon', subject: 'Subject lesson' } as const;
export type AttendanceSessionType = keyof typeof ATTENDANCE_SESSION_LABELS;

export interface AttendanceSession {
  id: Uuid;
  school_id: Uuid;
  class_id: Uuid;
  attendance_date: string;
  session_type: AttendanceSessionType;
  subject_id: Uuid | null;
  status: 'draft' | 'submitted';
  recorded_by: Uuid | null;
  submitted_by: Uuid | null;
  submitted_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AttendanceRecord {
  id: Uuid;
  school_id: Uuid;
  session_id: Uuid;
  student_id: Uuid;
  status: AttendanceStatus;
  remarks: string | null;
  recorded_by: Uuid | null;
  recorded_at: Timestamp;
}

/** Row from `attendance_report`: one class on one day. */
export interface AttendanceReportRow {
  class_id: Uuid;
  attendance_date: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
}

/** Row from `student_attendance`. */
export interface StudentAttendanceRow {
  attendance_date: string;
  session_type: AttendanceSessionType;
  subject_id: Uuid | null;
  status: AttendanceStatus;
  remarks: string | null;
  class_id: Uuid;
}

/** Share of sessions attended (present or late), as a whole percentage. */
export function attendanceRate(counts: { present: number; late: number; total: number }): number | null {
  return counts.total > 0 ? Math.round(((counts.present + counts.late) / counts.total) * 100) : null;
}

/** Monday to Sunday of the week containing `date`, as ISO dates. */
export function weekRange(date = new Date()): { from: string; to: string } {
  const start = new Date(date);
  start.setDate(date.getDate() - (isoWeekday(date) - 1));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}

export function monthRange(date = new Date()): { from: string; to: string } {
  return {
    from: isoDate(new Date(date.getFullYear(), date.getMonth(), 1)),
    to: isoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// Assignments
// -----------------------------------------------------------------------------
export interface Assignment {
  id: Uuid;
  school_id: Uuid;
  class_id: Uuid;
  subject_id: Uuid;
  teacher_membership_id: Uuid | null;
  title: string;
  description: string | null;
  attachment_paths: string[];
  due_at: Timestamp;
  maximum_score: number | null;
  allow_late: boolean;
  status: 'draft' | 'published' | 'closed' | 'graded';
  published_at: Timestamp | null;
  created_by: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AssignmentSubmission {
  id: Uuid;
  school_id: Uuid;
  assignment_id: Uuid;
  student_id: Uuid;
  body: string | null;
  attachment_paths: string[];
  status: 'submitted' | 'returned' | 'graded';
  submitted_at: Timestamp | null;
  is_late: boolean;
  score: number | null;
  feedback: string | null;
  graded_by: Uuid | null;
  graded_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** What people see: Draft, Open, Past due, Closed or Graded. */
export type AssignmentState = 'draft' | 'open' | 'past_due' | 'closed' | 'graded';
export const ASSIGNMENT_STATE_LABELS: Record<AssignmentState, string> = {
  draft: 'Draft',
  open: 'Open',
  past_due: 'Past due',
  closed: 'Closed',
  graded: 'Graded',
};

export function assignmentState(a: Pick<Assignment, 'status' | 'due_at'>, now = new Date()): AssignmentState {
  if (a.status === 'draft') return 'draft';
  if (a.status === 'graded') return 'graded';
  if (a.status === 'closed') return 'closed';
  return new Date(a.due_at) < now ? 'past_due' : 'open';
}

export const SUBMISSION_STATUS_LABELS = { submitted: 'Submitted', returned: 'Returned for correction', graded: 'Graded' } as const;

export const assignmentSchema = z.object({
  title: z.string().trim().min(1, { error: 'Give the assignment a title.' }).max(200),
  description: z.string().trim().max(10000),
  classId: z.string().min(1, { error: 'Choose a class.' }),
  subjectId: z.string().min(1, { error: 'Choose a subject.' }),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Choose the due date.' }),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/, { error: 'Choose the due time.' }),
  maximumScore: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 1000), {
      error: 'Enter a number up to 1000, or leave it empty for ungraded work.',
    }),
  allowLate: z.boolean(),
});
export type AssignmentInput = z.infer<typeof assignmentSchema>;

// -----------------------------------------------------------------------------
// Assessments and results
// -----------------------------------------------------------------------------
export const ASSESSMENT_TYPES = ['continuous', 'test', 'project', 'practical', 'examination'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
export const ASSESSMENT_TYPE_LABELS: Record<AssessmentType, string> = {
  continuous: 'Continuous assessment',
  test: 'Test',
  project: 'Project',
  practical: 'Practical',
  examination: 'Examination',
};

export type AssessmentStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'published';
export const ASSESSMENT_STATUS_LABELS: Record<AssessmentStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting review',
  returned: 'Returned for correction',
  approved: 'Approved',
  published: 'Published',
};

export interface Assessment {
  id: Uuid;
  school_id: Uuid;
  academic_year_id: Uuid | null;
  term_id: Uuid;
  class_id: Uuid;
  subject_id: Uuid;
  title: string;
  assessment_type: AssessmentType;
  maximum_score: number;
  weight: number;
  assessment_date: string | null;
  status: AssessmentStatus;
  review_note: string | null;
  submitted_by: Uuid | null;
  submitted_at: Timestamp | null;
  reviewed_by: Uuid | null;
  reviewed_at: Timestamp | null;
  published_by: Uuid | null;
  published_at: Timestamp | null;
  created_by: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AssessmentScore {
  id: Uuid;
  school_id: Uuid;
  assessment_id: Uuid;
  student_id: Uuid;
  score: number | null;
  is_absent: boolean;
  remarks: string | null;
  recorded_by: Uuid | null;
  recorded_at: Timestamp;
}

export interface GradingBand {
  id: Uuid;
  school_id: Uuid;
  grade: string;
  min_score: number;
  remark: string | null;
}

/** The band for a score out of 100, using the school's own scale. */
export function gradeFor(bands: Pick<GradingBand, 'grade' | 'min_score' | 'remark'>[], score: number | null) {
  if (score === null || Number.isNaN(score)) return null;
  return [...bands].sort((a, b) => Number(b.min_score) - Number(a.min_score)).find((b) => score >= Number(b.min_score)) ?? null;
}

/** Row from `get_class_results`. */
export interface ClassResultRow {
  student_id: Uuid;
  subject_id: Uuid;
  total: number;
  grade: string | null;
  remark: string | null;
  subject_position: number | null;
}

/** Row from `get_student_results`. */
export interface StudentResultRow {
  subject_id: Uuid;
  subject_name: string;
  subject_code: string;
  total: number;
  grade: string | null;
  remark: string | null;
  subject_position: number | null;
  class_average: number;
  class_size: number;
}

export interface ReportCardSubject {
  subject_id: Uuid;
  name: string;
  code: string;
  total: number;
  grade: string | null;
  remark: string | null;
  position: number | null;
}

export interface ReportCard {
  id: Uuid;
  school_id: Uuid;
  student_id: Uuid;
  class_id: Uuid;
  academic_year_id: Uuid | null;
  term_id: Uuid;
  average: number | null;
  grade: string | null;
  position: number | null;
  class_size: number | null;
  subjects: ReportCardSubject[];
  attendance: { present?: number; late?: number; absent?: number; excused?: number; total?: number };
  teacher_comment: string | null;
  principal_comment: string | null;
  status: 'draft' | 'published';
  generated_at: Timestamp;
  published_by: Uuid | null;
  published_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Row from `get_my_student`. */
export interface MyStudent {
  student_id: Uuid;
  first_name: string;
  last_name: string;
  admission_number: string;
  photo_path: string | null;
  class_id: Uuid | null;
  class_name: string | null;
}

export const assessmentSchema = z.object({
  title: z.string().trim().min(1, { error: 'Give the assessment a name, like First CA.' }).max(120),
  assessmentType: z.enum(ASSESSMENT_TYPES),
  classId: z.string().min(1, { error: 'Choose a class.' }),
  subjectId: z.string().min(1, { error: 'Choose a subject.' }),
  termId: z.string().min(1, { error: 'Choose the term.' }),
  maximumScore: z.coerce.number({ error: 'Enter the highest possible score.' }).positive({ error: 'Enter a score above 0.' }).max(1000),
  weight: z.coerce.number({ error: 'Enter how much it counts.' }).positive({ error: 'Enter a weight above 0.' }).max(100, { error: 'A weight cannot exceed 100.' }),
  assessmentDate: z.string(),
});
export type AssessmentInput = z.infer<typeof assessmentSchema>;

/** Ordinal for positions: 1st, 2nd, 3rd, 11th, 22nd. */
export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
