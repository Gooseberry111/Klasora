/**
 * Phase 4: timetables, attendance, assignments, assessments, results and
 * report cards. Covers who may record what, the approval workflow, and that
 * families only ever see their own child's published records.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

type User = { id: string; email: string };

let db: TestDatabase;
let owner: User;
let admin: User;
let principal: User;
let teacherA: User;
let teacherB: User;
let parent: User;
let studentUser: User;
let schoolId: string;
let classA: string;
let classB: string;
let maths: string;
let termId: string;
let ada: string; // in class A, has a student account and a guardian
let bayo: string; // in class A
let chika: string; // in class B

const today = new Date().toISOString().slice(0, 10);

async function membership(userId: string) {
  const [row] = await db.admin<{ id: string }>(`select id from public.school_memberships where school_id = $1 and user_id = $2`, [schoolId, userId]);
  return row!.id;
}

async function register(first: string, classId: string, guardianEmail?: string) {
  const [row] = await db.rows<{ id: string }>(
    admin.id,
    `select public.register_student($1, $2::jsonb, null, $3::jsonb, $4) as id`,
    [
      schoolId,
      JSON.stringify({ first_name: first, last_name: 'Test', admission_date: '2026-09-01' }),
      JSON.stringify(guardianEmail ? [{ first_name: 'Parent', last_name: first, email: guardianEmail, relationship: 'mother' }] : []),
      classId,
    ],
  );
  return row!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await db.createUser();
  schoolId = await db.registerSchool(owner.id, { name: 'Bright Future School', planCode: 'growth' });
  admin = await db.addMember(owner.id, schoolId, 'school_admin');
  principal = await db.addMember(owner.id, schoolId, 'principal');
  teacherA = await db.addMember(owner.id, schoolId, 'teacher');
  teacherB = await db.addMember(owner.id, schoolId, 'teacher');

  const [year] = await db.rows<{ id: string }>(owner.id, `insert into public.academic_years (school_id, name, start_date, end_date) values ($1, '2026/2027', '2026-09-01', '2027-07-31') returning id`, [schoolId]);
  const [term] = await db.rows<{ id: string }>(owner.id, `insert into public.academic_terms (school_id, academic_year_id, name, sequence, start_date, end_date) values ($1, $2, 'First Term', 1, '2026-09-01', '2026-12-18') returning id`, [schoolId, year!.id]);
  termId = term!.id;

  const campus = (await db.admin<{ id: string }>(`select id from public.campuses where school_id = $1`, [schoolId]))[0]!.id;
  const [a] = await db.rows<{ id: string }>(owner.id, `insert into public.classes (school_id, campus_id, name, class_teacher_membership_id) values ($1, $2, 'JSS 1A', $3) returning id`, [schoolId, campus, await membership(teacherA.id)]);
  const [b] = await db.rows<{ id: string }>(owner.id, `insert into public.classes (school_id, campus_id, name, class_teacher_membership_id) values ($1, $2, 'JSS 1B', $3) returning id`, [schoolId, campus, await membership(teacherB.id)]);
  classA = a!.id;
  classB = b!.id;
  const [subject] = await db.rows<{ id: string }>(owner.id, `insert into public.subjects (school_id, name, code) values ($1, 'Mathematics', 'MTH') returning id`, [schoolId]);
  maths = subject!.id;
  await db.rows(owner.id, `insert into public.class_subjects (school_id, class_id, subject_id, teacher_membership_id) values ($1, $2, $3, $4)`, [schoolId, classA, maths, await membership(teacherA.id)]);

  ada = await register('Ada', classA, 'ada.parent@example.com');
  bayo = await register('Bayo', classA);
  chika = await register('Chika', classB);

  // Ada's mother joins the parent portal; Ada gets her own student account.
  parent = await db.createUser({ email: 'ada.parent@example.com' });
  const [guardian] = await db.admin<{ guardian_id: string }>(`select guardian_id from public.student_guardians where student_id = $1`, [ada]);
  const [gInvite] = await db.rows<{ token: string }>(admin.id, `select token from public.invite_guardian($1)`, [guardian!.guardian_id]);
  await db.rows(parent.id, `select public.accept_invitation($1)`, [gInvite!.token]);

  studentUser = await db.createUser({ email: 'ada.student@example.com' });
  const [sInvite] = await db.rows<{ token: string }>(admin.id, `select token from public.invite_student($1, 'ada.student@example.com')`, [ada]);
  await db.rows(studentUser.id, `select public.accept_invitation($1)`, [sInvite!.token]);
});

describe('student accounts', () => {
  it('links the student account to the student record', async () => {
    const [me] = await db.rows<{ student_id: string; class_name: string }>(studentUser.id, `select * from public.get_my_student($1)`, [schoolId]);
    expect(me).toMatchObject({ student_id: ada, class_name: 'JSS 1A' });
    const visible = await db.rows<{ id: string }>(studentUser.id, `select id from public.students where school_id = $1`, [schoolId]);
    expect(visible.map((r) => r.id)).toEqual([ada]);
  });
});

describe('timetable', () => {
  async function addPeriod(userId: string, classId: string, day: number, start: string, end: string, teacher: User | null, room: string | null) {
    return db.rows(
      userId,
      `insert into public.timetable_entries (school_id, class_id, subject_id, teacher_membership_id, day_of_week, start_time, end_time, room)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [schoolId, classId, maths, teacher ? await membership(teacher.id) : null, day, start, end, room],
    );
  }

  it('accepts a period and refuses clashes for the class, the teacher and the room', async () => {
    await addPeriod(admin.id, classA, 1, '08:00', '08:40', teacherA, 'Lab 1');
    expect(await expectSqlError(addPeriod(admin.id, classA, 1, '08:20', '09:00', null, null), 'KL409')).toContain('JSS 1A already has');
    expect(await expectSqlError(addPeriod(admin.id, classB, 1, '08:30', '09:10', teacherA, null), 'KL409')).toContain('is already teaching JSS 1A');
    expect(await expectSqlError(addPeriod(admin.id, classB, 1, '08:10', '08:30', teacherB, 'lab 1'), 'KL409')).toContain('Lab 1 is already being used');
    await addPeriod(admin.id, classB, 1, '08:40', '09:20', teacherA, 'Lab 1');
  });

  it('refuses an end time before the start time', async () => {
    await expectSqlError(addPeriod(admin.id, classA, 2, '10:00', '09:00', null, null), 'KL400');
  });

  it('shows a family only their own class timetable, and stops teachers editing it', async () => {
    const seen = await db.rows<{ class_id: string }>(parent.id, `select class_id from public.timetable_entries where school_id = $1`, [schoolId]);
    expect(new Set(seen.map((r) => r.class_id))).toEqual(new Set([classA]));
    await expectSqlError(addPeriod(teacherA.id, classA, 3, '08:00', '08:40', null, null), '42501');
  });
});

describe('attendance', () => {
  const register_ = (userId: string, classId: string, records: unknown[], submit = false, date = today) =>
    db.rows<{ id: string }>(userId, `select public.save_attendance($1, $2, 'daily', null, $3::jsonb, $4) as id`, [classId, date, JSON.stringify(records), submit]);

  it('lets the class teacher take and submit the register once', async () => {
    await register_(teacherA.id, classA, [{ student_id: ada, status: 'present' }, { student_id: bayo, status: 'absent', remarks: 'Sick' }]);
    await register_(teacherA.id, classA, [{ student_id: ada, status: 'late' }, { student_id: bayo, status: 'absent', remarks: 'Sick' }], true);
    const sessions = await db.admin(`select 1 from public.attendance_sessions where class_id = $1`, [classA]);
    expect(sessions).toHaveLength(1);
    const records = await db.admin<{ status: string }>(`select status from public.attendance_records where student_id = $1`, [ada]);
    expect(records.map((r) => r.status)).toEqual(['late']);
  });

  it('stops other teachers, future dates and late changes by the teacher', async () => {
    await expectSqlError(register_(teacherB.id, classA, [{ student_id: ada, status: 'present' }]), 'KL403');
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await expectSqlError(register_(teacherA.id, classA, [], false, tomorrow), 'KL400');
    expect(await expectSqlError(register_(teacherA.id, classA, [{ student_id: ada, status: 'present' }]), 'KL403')).toContain('already been submitted');
    await register_(admin.id, classA, [{ student_id: ada, status: 'present' }]);
    await expectSqlError(register_(admin.id, classA, [{ student_id: chika, status: 'present' }]), 'KL400');
  });

  it('shows records only to the right people', async () => {
    expect(await db.rows(parent.id, `select * from public.student_attendance($1, '2026-01-01', '2030-01-01')`, [ada])).toHaveLength(1);
    await expectSqlError(db.rows(parent.id, `select * from public.student_attendance($1, '2026-01-01', '2030-01-01')`, [bayo]), 'KL404');
    expect(await db.rows(teacherB.id, `select 1 from public.attendance_records where student_id = $1`, [bayo])).toHaveLength(0);
    const [report] = await db.rows<{ present: number; absent: number; total: number }>(
      principal.id,
      `select * from public.attendance_report($1, $2, $2)`,
      [schoolId, today],
    );
    expect(report).toMatchObject({ present: 1, absent: 1, total: 2 });
  });
});

describe('assignments and submissions', () => {
  let assignment: string;

  it('keeps drafts from families and lets only the class teachers set work', async () => {
    const [row] = await db.rows<{ id: string }>(
      teacherA.id,
      `insert into public.assignments (school_id, class_id, subject_id, title, due_at, maximum_score)
       values ($1, $2, $3, 'Fractions', now() + interval '2 days', 20) returning id`,
      [schoolId, classA, maths],
    );
    assignment = row!.id;
    expect(await db.rows(parent.id, `select 1 from public.assignments where id = $1`, [assignment])).toHaveLength(0);
    await db.rows(teacherA.id, `update public.assignments set status = 'published' where id = $1`, [assignment]);
    expect(await db.rows(parent.id, `select 1 from public.assignments where id = $1`, [assignment])).toHaveLength(1);
    await expectSqlError(
      db.rows(teacherB.id, `insert into public.assignments (school_id, class_id, subject_id, title, due_at) values ($1, $2, $3, 'X', now())`, [schoolId, classA, maths]),
      '42501',
    );
  });

  it('lets the student submit, the teacher grade, and blocks changes after grading', async () => {
    await db.rows(studentUser.id, `select public.submit_assignment($1, 'My working', '{}')`, [assignment]);
    await expectSqlError(db.rows(teacherA.id, `select public.grade_submission($1, $2, 25, null)`, [assignment, ada]), 'KL400');
    await db.rows(teacherA.id, `select public.grade_submission($1, $2, 18, 'Well done')`, [assignment, ada]);
    await expectSqlError(db.rows(studentUser.id, `select public.submit_assignment($1, 'Again', '{}')`, [assignment]), 'KL409');
    // Work handed in on paper can be graded directly.
    await db.rows(teacherA.id, `select public.grade_submission($1, $2, 12, null)`, [assignment, bayo]);
    const mine = await db.rows<{ student_id: string }>(studentUser.id, `select student_id from public.assignment_submissions`);
    expect(mine.map((r) => r.student_id)).toEqual([ada]);
  });

  it('refuses late work unless allowed', async () => {
    const [row] = await db.rows<{ id: string }>(
      teacherA.id,
      `insert into public.assignments (school_id, class_id, subject_id, title, due_at, status) values ($1, $2, $3, 'Overdue', now() - interval '1 hour', 'published') returning id`,
      [schoolId, classA, maths],
    );
    await expectSqlError(db.rows(studentUser.id, `select public.submit_assignment($1, 'Late', '{}')`, [row!.id]), 'KL409');
    await db.rows(teacherA.id, `update public.assignments set allow_late = true where id = $1`, [row!.id]);
    await db.rows(studentUser.id, `select public.submit_assignment($1, 'Late', '{}')`, [row!.id]);
    const [sub] = await db.admin<{ is_late: boolean }>(`select is_late from public.assignment_submissions where assignment_id = $1`, [row!.id]);
    expect(sub!.is_late).toBe(true);
  });

  it('only lets the student upload into their own submission folder, before grading', async () => {
    const [row] = await db.rows<{ id: string }>(
      teacherA.id,
      `insert into public.assignments (school_id, class_id, subject_id, title, due_at, status) values ($1, $2, $3, 'Essay', now() + interval '1 day', 'published') returning id`,
      [schoolId, classA, maths],
    );
    const upload = (userId: string, path: string) =>
      db.rows(userId, `insert into storage.objects (bucket_id, name) values ('academic-files', $1)`, [path]);
    await upload(studentUser.id, `${schoolId}/submissions/${row!.id}/${ada}/work.pdf`);
    await expectSqlError(upload(studentUser.id, `${schoolId}/submissions/${row!.id}/${bayo}/work.pdf`), '42501');
    // Graded work is closed to new files.
    await expectSqlError(upload(studentUser.id, `${schoolId}/submissions/${assignment}/${ada}/again.pdf`), '42501');
    // Teachers attach files to their own assignments; families cannot.
    await upload(teacherA.id, `${schoolId}/assignments/${row!.id}/sheet.pdf`);
    await expectSqlError(upload(parent.id, `${schoolId}/assignments/${row!.id}/x.pdf`), '42501');
    const parentSees = await db.rows<{ name: string }>(parent.id, `select name from storage.objects where bucket_id = 'academic-files' order by name`);
    expect(parentSees.map((r) => r.name)).toEqual([`${schoolId}/assignments/${row!.id}/sheet.pdf`, `${schoolId}/submissions/${row!.id}/${ada}/work.pdf`]);
  });
});

describe('assessments, approval and results', () => {
  let ca: string;
  let exam: string;

  async function createAssessment(title: string, type: string, max: number, weight: number) {
    const [row] = await db.rows<{ id: string }>(
      teacherA.id,
      `insert into public.assessments (school_id, term_id, class_id, subject_id, title, assessment_type, maximum_score, weight)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [schoolId, termId, classA, maths, title, type, max, weight],
    );
    return row!.id;
  }
  const save = (userId: string, id: string, scores: unknown[]) => db.rows(userId, `select public.save_scores($1, $2::jsonb)`, [id, JSON.stringify(scores)]);

  it('lets the subject teacher record scores and nobody else', async () => {
    ca = await createAssessment('First CA', 'continuous', 20, 40);
    exam = await createAssessment('Examination', 'examination', 100, 60);
    await save(teacherA.id, ca, [{ student_id: ada, score: 15 }, { student_id: bayo, score: 10 }]);
    await save(teacherA.id, exam, [{ student_id: ada, score: 80 }, { student_id: bayo, is_absent: true }]);
    await expectSqlError(save(teacherA.id, ca, [{ student_id: ada, score: 21 }]), 'KL400');
    await expectSqlError(save(teacherB.id, ca, [{ student_id: ada, score: 1 }]), 'KL404');
    expect(await db.rows(parent.id, `select 1 from public.assessment_scores where student_id = $1`, [ada])).toHaveLength(0);
  });

  it('runs the review workflow', async () => {
    await db.rows(teacherA.id, `select public.submit_assessment($1)`, [ca]);
    expect(await expectSqlError(save(teacherA.id, ca, [{ student_id: ada, score: 16 }]), 'KL403')).toContain('submitted for review');
    await expectSqlError(db.rows(principal.id, `select public.review_assessment($1, false, '')`, [ca]), 'KL400');
    await db.rows(principal.id, `select public.review_assessment($1, false, 'Check Bayo''s score')`, [ca]);
    await save(teacherA.id, ca, [{ student_id: bayo, score: 11 }]);
    await db.rows(teacherA.id, `select public.submit_assessment($1)`, [ca]);
    await db.rows(teacherA.id, `select public.submit_assessment($1)`, [exam]);
    await expectSqlError(db.rows(teacherA.id, `select public.review_assessment($1, true)`, [ca]), 'KL403');
    await expectSqlError(db.rows(principal.id, `select public.publish_assessments(array[$1]::uuid[])`, [ca]), 'KL409');
    await db.rows(principal.id, `select public.review_assessment($1, true)`, [ca]);
    await db.rows(principal.id, `select public.review_assessment($1, true)`, [exam]);
    await db.rows(principal.id, `select public.publish_assessments(array[$1, $2]::uuid[])`, [ca, exam]);
  });

  it('gives families only published results, with weighted totals and grades', async () => {
    const results = await db.rows<{ total: string; grade: string; subject_position: number | null }>(
      parent.id,
      `select * from public.get_student_results($1, $2)`,
      [ada, termId],
    );
    // (15 / 20 x 40) + (80 / 100 x 60) = 30 + 48 = 78
    expect(results).toHaveLength(1);
    expect(Number(results[0]!.total)).toBe(78);
    expect(results[0]!.grade).toBe('A');
    expect(results[0]!.subject_position).toBeNull();
    expect(await db.rows(parent.id, `select 1 from public.assessment_scores where student_id = $1`, [ada])).toHaveLength(2);
    await expectSqlError(db.rows(parent.id, `select * from public.get_student_results($1, $2)`, [bayo, termId]), 'KL404');
  });

  it('shows class positions only when the school turns them on', async () => {
    await db.admin(`update public.schools set show_class_positions = true where id = $1`, [schoolId]);
    const [row] = await db.rows<{ subject_position: number }>(studentUser.id, `select * from public.get_student_results($1, $2)`, [ada, termId]);
    expect(row!.subject_position).toBe(1);
  });

  it('uses the school\'s own grading scale', async () => {
    await db.rows(owner.id, `update public.grading_bands set min_score = 80 where school_id = $1 and grade = 'A'`, [schoolId]);
    const [row] = await db.rows<{ grade: string }>(parent.id, `select grade from public.get_student_results($1, $2)`, [ada, termId]);
    expect(row!.grade).toBe('B');
    await db.rows(owner.id, `update public.grading_bands set min_score = 70 where school_id = $1 and grade = 'A'`, [schoolId]);
  });

  it('hides results from a guardian who is not allowed to see them', async () => {
    await db.admin(`update public.student_guardians set can_view_results = false where student_id = $1`, [ada]);
    await expectSqlError(db.rows(parent.id, `select * from public.get_student_results($1, $2)`, [ada, termId]), 'KL404');
    await db.admin(`update public.student_guardians set can_view_results = true where student_id = $1`, [ada]);
  });

  it('lets only approvers change published scores, and audits the change', async () => {
    await expectSqlError(save(teacherA.id, ca, [{ student_id: ada, score: 14 }]), 'KL403');
    await save(principal.id, ca, [{ student_id: ada, score: 14 }]);
    const logs = await db.admin(`select 1 from public.audit_logs where entity_type = 'assessment_scores' and actor_user_id = $1`, [principal.id]);
    expect(logs.length).toBeGreaterThan(0);
    await save(principal.id, ca, [{ student_id: ada, score: 15 }]);
  });
});

describe('report cards', () => {
  it('lets the class teacher prepare them and the principal comment and publish', async () => {
    await expectSqlError(db.rows(teacherB.id, `select public.generate_report_cards($1, $2)`, [classA, termId]), 'KL404');
    const [made] = await db.rows<{ n: number }>(teacherA.id, `select public.generate_report_cards($1, $2) as n`, [classA, termId]);
    expect(made!.n).toBe(2);
    const [card] = await db.admin<{ id: string; average: string; attendance: { absent: number; total: number }; position: number }>(
      `select id, average, attendance, position from public.report_cards where student_id = $1`,
      [ada],
    );
    expect(Number(card!.average)).toBe(78);
    expect(card!.position).toBe(1);
    expect(card!.attendance.total).toBe(1);

    await db.rows(teacherA.id, `select public.save_report_comment($1, 'teacher', 'A hardworking pupil.')`, [card!.id]);
    await expectSqlError(db.rows(teacherA.id, `select public.save_report_comment($1, 'principal', 'Hi')`, [card!.id]), 'KL403');
    await db.rows(principal.id, `select public.save_report_comment($1, 'principal', 'Keep it up.')`, [card!.id]);

    expect(await db.rows(parent.id, `select 1 from public.report_cards where student_id = $1`, [ada])).toHaveLength(0);
    await expectSqlError(db.rows(teacherA.id, `select public.publish_report_cards($1, $2)`, [classA, termId]), 'KL403');
    await db.rows(principal.id, `select public.publish_report_cards($1, $2)`, [classA, termId]);
    expect(await db.rows(parent.id, `select 1 from public.report_cards where student_id = $1`, [ada])).toHaveLength(1);
    expect(await db.rows(parent.id, `select 1 from public.report_cards where student_id = $1`, [bayo])).toHaveLength(0);
    await expectSqlError(db.rows(teacherA.id, `select public.save_report_comment($1, 'teacher', 'Changed')`, [card!.id]), 'KL403');
  });
});
