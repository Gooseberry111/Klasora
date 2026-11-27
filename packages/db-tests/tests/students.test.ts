/**
 * Phase 3: students, guardians, enrolment and staff profiles. These tests pin
 * down who can see which child, which is the most sensitive rule in Klasora.
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
let outsider: User;
let schoolId: string;
let otherSchool: string;
let classA: string;
let classB: string;
let studentA: string;
let studentB: string;
let guardianA: string;

async function membershipId(userId: string) {
  const [row] = await db.admin<{ id: string }>(
    `select id from public.school_memberships where school_id = $1 and user_id = $2`,
    [schoolId, userId],
  );
  return row!.id;
}

async function createClass(name: string, teacher: User, capacity: number | null = null) {
  const [row] = await db.rows<{ id: string }>(
    owner.id,
    `insert into public.classes (school_id, campus_id, name, class_teacher_membership_id, capacity)
     select $1, id, $2, $3, $4 from public.campuses where school_id = $1 and is_main returning id`,
    [schoolId, name, await membershipId(teacher.id), capacity],
  );
  return row!.id;
}

async function register(userId: string, student: Record<string, unknown>, guardians: unknown[] = [], classId: string | null = null, details: unknown = null) {
  const [row] = await db.rows<{ id: string }>(
    userId,
    `select public.register_student($1, $2::jsonb, $3::jsonb, $4::jsonb, $5) as id`,
    [schoolId, JSON.stringify(student), details ? JSON.stringify(details) : null, JSON.stringify(guardians), classId],
  );
  return row!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await db.createUser();
  schoolId = await db.registerSchool(owner.id, { name: 'Sunrise Academy' });
  admin = await db.addMember(owner.id, schoolId, 'school_admin');
  principal = await db.addMember(owner.id, schoolId, 'principal');
  teacherA = await db.addMember(owner.id, schoolId, 'teacher');
  teacherB = await db.addMember(owner.id, schoolId, 'teacher');
  outsider = await db.createUser();
  otherSchool = await db.registerSchool(outsider.id, { name: 'Other School' });
  classA = await createClass('JSS 1A', teacherA, 2);
  classB = await createClass('JSS 1B', teacherB);
});

describe('registering students', () => {
  it('creates a student with a generated admission number, guardian and class', async () => {
    studentA = await register(
      admin.id,
      { first_name: 'Chidi', last_name: 'Okeke', admission_date: '2026-09-07', gender: 'male' },
      [{ first_name: 'Ngozi', last_name: 'Okeke', email: 'ngozi.okeke@example.com', relationship: 'mother' }],
      classA,
      { medical_conditions: 'Asthma', genotype: 'AS' },
    );
    const [student] = await db.admin<{ admission_number: string }>(`select admission_number from public.students where id = $1`, [studentA]);
    expect(student!.admission_number).toBe('SA/2026/0001');
    const enrolments = await db.admin(`select 1 from public.class_enrollments where student_id = $1 and status = 'active'`, [studentA]);
    expect(enrolments).toHaveLength(1);
    const [link] = await db.admin<{ guardian_id: string; is_primary: boolean }>(
      `select guardian_id, is_primary from public.student_guardians where student_id = $1`,
      [studentA],
    );
    expect(link!.is_primary).toBe(true);
    guardianA = link!.guardian_id;
  });

  it('reuses a guardian with the same email for a sibling', async () => {
    const sibling = await register(admin.id, { first_name: 'Ada', last_name: 'Okeke' }, [
      { first_name: 'Ngozi', last_name: 'Okeke', email: 'NGOZI.OKEKE@example.com', relationship: 'mother' },
    ]);
    const guardians = await db.admin(`select 1 from public.guardians where school_id = $1`, [schoolId]);
    expect(guardians).toHaveLength(1);
    const [link] = await db.admin<{ guardian_id: string }>(`select guardian_id from public.student_guardians where student_id = $1`, [sibling]);
    expect(link!.guardian_id).toBe(guardianA);
  });

  it('rejects a duplicate admission number', async () => {
    const message = await expectSqlError(register(admin.id, { first_name: 'X', last_name: 'Y', admission_number: 'sa/2026/0001' }), 'KL409');
    expect(message).toContain('already in use');
  });

  it('does not let a teacher register students or record health details without permission', async () => {
    await expectSqlError(register(teacherA.id, { first_name: 'X', last_name: 'Y' }), 'KL403');
    await expectSqlError(register(principal.id, { first_name: 'X', last_name: 'Y' }), 'KL403');
  });
});

describe('who can see a student', () => {
  beforeAll(async () => {
    studentB = await register(admin.id, { first_name: 'Bola', last_name: 'Ade' }, [], classB);
  });

  it('lets a teacher see only students in classes they teach', async () => {
    const seenByA = await db.rows<{ id: string }>(teacherA.id, `select id from public.students where school_id = $1`, [schoolId]);
    expect(seenByA.map((r) => r.id)).toEqual([studentA]);
    const seenByB = await db.rows<{ id: string }>(teacherB.id, `select id from public.students where school_id = $1`, [schoolId]);
    expect(seenByB.map((r) => r.id)).toEqual([studentB]);
  });

  it('keeps health details from teachers but shows them to the principal', async () => {
    expect(await db.rows(teacherA.id, `select 1 from public.student_details where student_id = $1`, [studentA])).toHaveLength(0);
    const [row] = await db.rows<{ medical_conditions: string }>(principal.id, `select medical_conditions from public.student_details where student_id = $1`, [studentA]);
    expect(row!.medical_conditions).toBe('Asthma');
    const updated = await db.rows(principal.id, `update public.student_details set allergies = 'Nuts' where student_id = $1 returning 1`, [studentA]);
    expect(updated).toHaveLength(0);
  });

  it('audits health changes without copying the medical text', async () => {
    await db.rows(admin.id, `update public.student_details set allergies = 'Peanuts' where student_id = $1`, [studentA]);
    const logs = await db.admin<{ new_data: { changed_fields: string[] } }>(
      `select new_data from public.audit_logs where entity_type = 'student_details' and entity_id = $1 order by created_at desc`,
      [studentA],
    );
    expect(logs[0]!.new_data.changed_fields).toEqual(['allergies']);
    expect(JSON.stringify(logs)).not.toContain('Peanuts');
    expect(JSON.stringify(logs)).not.toContain('Asthma');
  });

  it('keeps students invisible to other schools', async () => {
    expect(await db.rows(outsider.id, `select 1 from public.students where school_id = $1`, [schoolId])).toHaveLength(0);
    expect(await db.rows(outsider.id, `select 1 from public.guardians where school_id = $1`, [schoolId])).toHaveLength(0);
    await expectSqlError(
      db.rows(outsider.id, `select public.register_student($1, '{"first_name":"X","last_name":"Y"}'::jsonb)`, [schoolId]),
      'KL403',
    );
  });
});

describe('guardian portal access', () => {
  let parent: User;

  it('links the guardian record when the invitation is accepted', async () => {
    parent = await db.createUser({ email: 'ngozi.okeke@example.com' });
    const [invite] = await db.rows<{ token: string }>(admin.id, `select token from public.invite_guardian($1)`, [guardianA]);
    await db.rows(parent.id, `select public.accept_invitation($1)`, [invite!.token]);
    const [guardian] = await db.admin<{ user_id: string }>(`select user_id from public.guardians where id = $1`, [guardianA]);
    expect(guardian!.user_id).toBe(parent.id);
  });

  it('shows the guardian only their own children', async () => {
    const children = await db.rows<{ first_name: string }>(parent.id, `select first_name from public.get_my_children($1)`, [schoolId]);
    expect(children.map((c) => c.first_name).sort()).toEqual(['Ada', 'Chidi']);
    const visible = await db.rows<{ id: string }>(parent.id, `select id from public.students where school_id = $1`, [schoolId]);
    expect(visible.map((r) => r.id)).not.toContain(studentB);
    expect(visible).toHaveLength(2);
  });

  it('lets the guardian see their child\'s health details but not edit them', async () => {
    expect(await db.rows(parent.id, `select 1 from public.student_details where student_id = $1`, [studentA])).toHaveLength(1);
    expect(await db.rows(parent.id, `update public.students set first_name = 'Hacked' where id = $1 returning 1`, [studentA])).toHaveLength(0);
  });

  it('never shows staff profiles to a guardian', async () => {
    await db.rows(owner.id, `insert into public.staff_profiles (school_id, user_id, job_title, staff_number) values ($1, $2, 'Maths teacher', 'SA/T/001')`, [schoolId, teacherA.id]);
    expect(await db.rows(parent.id, `select 1 from public.staff_profiles where school_id = $1`, [schoolId])).toHaveLength(0);
    expect(await db.rows(teacherA.id, `select 1 from public.staff_profiles where school_id = $1`, [schoolId])).toHaveLength(1);
    expect(await db.rows(teacherB.id, `select 1 from public.staff_profiles where school_id = $1`, [schoolId])).toHaveLength(0);
  });

  it('refuses a second invitation once the guardian has access', async () => {
    await expectSqlError(db.rows(admin.id, `select * from public.invite_guardian($1)`, [guardianA]), 'KL409');
  });
});

describe('class enrolment history', () => {
  it('keeps the old class when a student moves', async () => {
    await db.rows(admin.id, `select public.enroll_students($1, array[$2]::uuid[])`, [classB, studentA]);
    const history = await db.admin<{ class_id: string; status: string }>(
      `select class_id, status from public.class_enrollments where student_id = $1 order by created_at`,
      [studentA],
    );
    expect(history.map((h) => h.status)).toEqual(['transferred', 'active']);
    expect(history[1]!.class_id).toBe(classB);
  });

  it('stops enrolment when a class is full', async () => {
    const one = await register(admin.id, { first_name: 'One', last_name: 'A' }, [], classA);
    await register(admin.id, { first_name: 'Two', last_name: 'A' }, [], classA);
    const message = await expectSqlError(register(admin.id, { first_name: 'Three', last_name: 'A' }, [], classA), 'KL409');
    expect(message).toContain('full');
    await db.rows(admin.id, `select public.end_enrollment($1)`, [one]);
    await register(admin.id, { first_name: 'Three', last_name: 'A' }, [], classA);
  });

  it('only lets student editors change enrolments', async () => {
    await expectSqlError(db.rows(teacherA.id, `select public.enroll_students($1, array[$2]::uuid[])`, [classA, studentB]), 'KL403');
  });
});

describe('import', () => {
  it('imports every row or none', async () => {
    const before = await db.admin(`select 1 from public.students where school_id = $1`, [schoolId]);
    const message = await expectSqlError(
      db.rows(admin.id, `select public.import_students($1, $2::jsonb)`, [
        schoolId,
        JSON.stringify([
          { first_name: 'Imported', last_name: 'One', class: 'jss 1b' },
          { first_name: 'Imported', last_name: 'Two', class: 'SS 9Z' },
        ]),
      ]),
      'KL400',
    );
    expect(message).toBe('Row 2: there is no class called SS 9Z.');
    expect(await db.admin(`select 1 from public.students where school_id = $1`, [schoolId])).toHaveLength(before.length);

    const [ok] = await db.rows<{ n: number }>(admin.id, `select public.import_students($1, $2::jsonb) as n`, [
      schoolId,
      JSON.stringify([
        { first_name: 'Imported', last_name: 'One', class: 'jss 1b', guardian_first_name: 'Tunde', guardian_last_name: 'One', guardian_email: 'tunde@example.com' },
        { first_name: 'Imported', last_name: 'Two', gender: 'female', date_of_birth: '2014-03-02' },
      ]),
    ]);
    expect(ok!.n).toBe(2);
  });
});

describe('files', () => {
  it('lets a teacher read a photo but not documents, and a guardian read both', async () => {
    const photo = `${schoolId}/${studentB}/photo/a.png`;
    const doc = `${schoolId}/${studentB}/documents/birth.pdf`;
    await db.rows(admin.id, `insert into storage.objects (bucket_id, name) values ('student-files', $1), ('student-files', $2)`, [photo, doc]);
    const asTeacherB = await db.rows<{ name: string }>(teacherB.id, `select name from storage.objects where bucket_id = 'student-files'`);
    expect(asTeacherB.map((r) => r.name)).toEqual([photo]);
    expect(await db.rows(outsider.id, `select 1 from storage.objects where bucket_id = 'student-files'`)).toHaveLength(0);
    await expectSqlError(
      db.rows(teacherB.id, `insert into storage.objects (bucket_id, name) values ('student-files', $1)`, [`${schoolId}/${studentB}/photo/b.png`]),
      '42501',
    );
    await expectSqlError(
      db.rows(outsider.id, `insert into storage.objects (bucket_id, name) values ('student-files', $1)`, [`${otherSchool}/${studentB}/photo/c.png`]),
      '42501',
    );
  });
});

describe('plan limits and counts', () => {
  it('stops registration past the plan\'s student limit', async () => {
    const [count] = await db.admin<{ n: number }>(
      `select count(*)::int as n from public.students where school_id = $1 and status in ('active', 'applicant')`,
      [schoolId],
    );
    await db.admin(`update public.subscription_plans set maximum_students = $1 where code = 'starter'`, [count!.n]);
    const message = await expectSqlError(register(admin.id, { first_name: 'Over', last_name: 'Limit' }), 'KL409');
    expect(message).toContain('Upgrade your plan');
    await db.admin(`update public.subscription_plans set maximum_students = 300 where code = 'starter'`);
  });

  it('reports people counts to staff and refuses guardians', async () => {
    const [counts] = await db.rows<{ teachers: number; guardians_with_access: number }>(owner.id, `select * from public.get_people_counts($1)`, [schoolId]);
    expect(counts).toMatchObject({ teachers: 2, guardians_with_access: 1 });
    await expectSqlError(db.rows(teacherA.id, `select * from public.get_people_counts($1)`, [schoolId]), 'KL403');
  });
});
