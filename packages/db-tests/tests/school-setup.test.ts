/**
 * Phase 2: academic calendar, structure, classes and subjects. Each rule here
 * is enforced by the database, so it holds no matter which client is used.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

let db: TestDatabase;
let owner: { id: string; email: string };
let teacher: { id: string; email: string };
let parent: { id: string; email: string };
let schoolId: string;
let mainCampus: string;
let otherOwner: { id: string; email: string };
let otherSchool: string;
let otherCampus: string;

async function createYear(userId: string, name: string, start = '2026-09-01', end = '2027-07-31') {
  const [row] = await db.rows<{ id: string }>(
    userId,
    `insert into public.academic_years (school_id, name, start_date, end_date)
     values ($1, $2, $3, $4) returning id`,
    [schoolId, name, start, end],
  );
  return row!.id;
}

async function createTerm(yearId: string, name: string, sequence: number, start: string, end: string) {
  const [row] = await db.rows<{ id: string }>(
    owner.id,
    `insert into public.academic_terms (school_id, academic_year_id, name, sequence, start_date, end_date)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [schoolId, yearId, name, sequence, start, end],
  );
  return row!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await db.createUser();
  schoolId = await db.registerSchool(owner.id, { name: 'Setup Academy' });
  teacher = await db.addMember(owner.id, schoolId, 'teacher');
  parent = await db.addMember(owner.id, schoolId, 'parent');
  const [campus] = await db.admin<{ id: string }>(`select id from public.campuses where school_id = $1`, [schoolId]);
  mainCampus = campus!.id;

  otherOwner = await db.createUser();
  otherSchool = await db.registerSchool(otherOwner.id, { name: 'Other School' });
  const [oc] = await db.admin<{ id: string }>(`select id from public.campuses where school_id = $1`, [otherSchool]);
  otherCampus = oc!.id;
});

describe('academic years and terms', () => {
  it('lets the owner create a year and terms inside it', async () => {
    const year = await createYear(owner.id, '2026/2027');
    await createTerm(year, 'First Term', 1, '2026-09-07', '2026-12-18');
    const terms = await db.rows(teacher.id, `select name from public.academic_terms where academic_year_id = $1`, [year]);
    expect(terms).toHaveLength(1);
  });

  it('rejects a term that falls outside its year', async () => {
    const [year] = await db.admin<{ id: string }>(`select id from public.academic_years where name = '2026/2027'`);
    const message = await expectSqlError(createTerm(year!.id, 'Bad Term', 2, '2027-07-01', '2027-08-30'), 'KL400');
    expect(message).toContain('within the academic year');
  });

  it('rejects an end date before the start date', async () => {
    await expectSqlError(createYear(owner.id, 'Backwards', '2027-07-01', '2026-09-01'), '23514');
  });

  it('keeps exactly one current year and term', async () => {
    const [year] = await db.admin<{ id: string }>(`select id from public.academic_years where name = '2026/2027'`);
    const [term] = await db.admin<{ id: string }>(`select id from public.academic_terms where name = 'First Term'`);
    const next = await createYear(owner.id, '2027/2028', '2027-09-01', '2028-07-31');

    await db.rows(owner.id, `select public.set_current_term($1)`, [term!.id]);
    let current = await db.admin<{ id: string }>(
      `select id from public.academic_years where school_id = $1 and is_current`,
      [schoolId],
    );
    expect(current.map((r) => r.id)).toEqual([year!.id]);

    await db.rows(owner.id, `select public.set_current_academic_year($1)`, [next]);
    current = await db.admin(`select id from public.academic_years where school_id = $1 and is_current`, [schoolId]);
    expect(current.map((r) => r.id)).toEqual([next]);
    // The old year's term is no longer current.
    const currentTerms = await db.admin(`select 1 from public.academic_terms where school_id = $1 and is_current`, [schoolId]);
    expect(currentTerms).toHaveLength(0);
  });

  it('does not let a teacher change the calendar', async () => {
    await expectSqlError(createYear(teacher.id, 'Teacher Year'), '42501');
    const [year] = await db.admin<{ id: string }>(`select id from public.academic_years where name = '2026/2027'`);
    await expectSqlError(db.rows(teacher.id, `select public.set_current_academic_year($1)`, [year!.id]), 'KL403');
  });

  it('does not delete the current year', async () => {
    const [year] = await db.admin<{ id: string }>(`select id from public.academic_years where is_current and school_id = $1`, [schoolId]);
    const deleted = await db.rows(owner.id, `delete from public.academic_years where id = $1 returning id`, [year!.id]);
    expect(deleted).toHaveLength(0);
  });

  it('shows the calendar to every member, but only to members', async () => {
    const asParent = await db.rows(parent.id, `select 1 from public.academic_years where school_id = $1`, [schoolId]);
    expect(asParent.length).toBeGreaterThan(0);
    const asOutsider = await db.rows(otherOwner.id, `select 1 from public.academic_years where school_id = $1`, [schoolId]);
    expect(asOutsider).toHaveLength(0);
    const asAnon = db.rows(null, `select 1 from public.academic_years`);
    await expectSqlError(asAnon, '42501');
  });
});

describe('departments, sections and faculties', () => {
  it('lets a department sit inside a faculty, but not inside a department', async () => {
    const [faculty] = await db.rows<{ id: string }>(
      owner.id,
      `insert into public.departments (school_id, kind, name) values ($1, 'faculty', 'Faculty of Science') returning id`,
      [schoolId],
    );
    const [dept] = await db.rows<{ id: string }>(
      owner.id,
      `insert into public.departments (school_id, kind, name, parent_id) values ($1, 'department', 'Physics', $2) returning id`,
      [schoolId, faculty!.id],
    );
    await expectSqlError(
      db.rows(
        owner.id,
        `insert into public.departments (school_id, kind, name, parent_id) values ($1, 'department', 'Optics', $2)`,
        [schoolId, dept!.id],
      ),
      'KL400',
    );
  });

  it('cannot attach a department to another school\'s campus', async () => {
    await expectSqlError(
      db.rows(
        owner.id,
        `insert into public.departments (school_id, name, campus_id) values ($1, 'Arts', $2)`,
        [schoolId, otherCampus],
      ),
      '23503',
    );
  });
});

describe('classes and subjects', () => {
  let classId: string;
  let subjectId: string;

  it('lets the owner create a class with a class teacher', async () => {
    const [membership] = await db.admin<{ id: string }>(
      `select id from public.school_memberships where school_id = $1 and user_id = $2`,
      [schoolId, teacher.id],
    );
    const [row] = await db.rows<{ id: string }>(
      owner.id,
      `insert into public.classes (school_id, campus_id, name, level, level_order, class_teacher_membership_id, capacity)
       values ($1, $2, 'JSS 1A', 'JSS 1', 7, $3, 40) returning id`,
      [schoolId, mainCampus, membership!.id],
    );
    classId = row!.id;
    expect(classId).toBeTruthy();
  });

  it('rejects duplicate class names on the same campus and year', async () => {
    await expectSqlError(
      db.rows(owner.id, `insert into public.classes (school_id, campus_id, name) values ($1, $2, 'JSS 1A')`, [
        schoolId,
        mainCampus,
      ]),
      '23505',
    );
  });

  it('cannot use another school\'s campus or staff member', async () => {
    await expectSqlError(
      db.rows(owner.id, `insert into public.classes (school_id, campus_id, name) values ($1, $2, 'Rogue')`, [
        schoolId,
        otherCampus,
      ]),
      '23503',
    );
    const [foreign] = await db.admin<{ id: string }>(
      `select id from public.school_memberships where school_id = $1`,
      [otherSchool],
    );
    await expectSqlError(
      db.rows(owner.id, `update public.classes set class_teacher_membership_id = $1 where id = $2`, [foreign!.id, classId]),
      '23503',
    );
  });

  it('assigns subjects to classes once each', async () => {
    const [subject] = await db.rows<{ id: string }>(
      owner.id,
      `insert into public.subjects (school_id, name, code) values ($1, 'Mathematics', 'MTH') returning id`,
      [schoolId],
    );
    subjectId = subject!.id;
    await db.rows(owner.id, `insert into public.class_subjects (school_id, class_id, subject_id) values ($1, $2, $3)`, [
      schoolId,
      classId,
      subjectId,
    ]);
    await expectSqlError(
      db.rows(owner.id, `insert into public.class_subjects (school_id, class_id, subject_id) values ($1, $2, $3)`, [
        schoolId,
        classId,
        subjectId,
      ]),
      '23505',
    );
  });

  it('lets teachers view the structure but not change it', async () => {
    const classes = await db.rows(teacher.id, `select 1 from public.classes where school_id = $1`, [schoolId]);
    expect(classes).toHaveLength(1);
    await expectSqlError(
      db.rows(teacher.id, `insert into public.subjects (school_id, name, code) values ($1, 'Art', 'ART')`, [schoolId]),
      '42501',
    );
    const updated = await db.rows(teacher.id, `update public.classes set name = 'Hacked' where id = $1 returning id`, [classId]);
    expect(updated).toHaveLength(0);
  });

  it('shows class names (but nothing about pupils) to every member of the school', async () => {
    const rows = await db.rows(parent.id, `select 1 from public.classes where school_id = $1`, [schoolId]);
    expect(rows).toHaveLength(1);
    expect(await db.rows(parent.id, `select 1 from public.class_subjects where school_id = $1`, [schoolId])).toHaveLength(0);
    expect(await db.rows(otherOwner.id, `select 1 from public.classes where school_id = $1`, [schoolId])).toHaveLength(0);
  });

  it('records changes in the audit log', async () => {
    const rows = await db.admin(
      `select 1 from public.audit_logs where entity_type = 'classes' and entity_id = $1 and actor_user_id = $2`,
      [classId, owner.id],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('keeps another school out entirely', async () => {
    for (const table of ['departments', 'classes', 'subjects', 'class_subjects']) {
      const rows = await db.rows(otherOwner.id, `select 1 from public.${table} where school_id = $1`, [schoolId]);
      expect(rows, table).toHaveLength(0);
    }
  });
});

describe('campuses', () => {
  it('enforces the plan\'s campus limit', async () => {
    const message = await expectSqlError(
      db.rows(owner.id, `insert into public.campuses (school_id, name, code) values ($1, 'Annex', 'ANNEX')`, [schoolId]),
      'KL409',
    );
    expect(message).toContain('Upgrade your plan');
  });

  it('moves the main campus and keeps it active', async () => {
    const growthOwner = await db.createUser();
    const growth = await db.registerSchool(growthOwner.id, { name: 'Growth School', planCode: 'growth' });
    const [annex] = await db.rows<{ id: string }>(
      growthOwner.id,
      `insert into public.campuses (school_id, name, code) values ($1, 'Annex', 'ANNEX') returning id`,
      [growth],
    );
    await db.rows(growthOwner.id, `select public.set_main_campus($1)`, [annex!.id]);
    const main = await db.admin<{ id: string }>(`select id from public.campuses where school_id = $1 and is_main`, [growth]);
    expect(main.map((r) => r.id)).toEqual([annex!.id]);

    await expectSqlError(
      db.rows(growthOwner.id, `update public.campuses set status = 'inactive' where id = $1`, [annex!.id]),
      'KL400',
    );
  });
});

describe('directory and progress RPCs', () => {
  it('lists members for people who manage staff, and refuses others', async () => {
    const rows = await db.rows<{ role_key: string }>(owner.id, `select * from public.list_school_members($1)`, [schoolId]);
    expect(rows.map((r) => r.role_key).sort()).toEqual(['owner', 'parent', 'teacher']);
    await expectSqlError(db.rows(teacher.id, `select * from public.list_school_members($1)`, [schoolId]), 'KL403');
  });

  it('reports setup progress to members only', async () => {
    const [progress] = await db.rows<{ classes: number; subjects: number; members: number; has_current_year: boolean }>(
      teacher.id,
      `select * from public.get_setup_progress($1)`,
      [schoolId],
    );
    expect(progress).toMatchObject({ classes: 1, subjects: 1, members: 3, has_current_year: true });
    await expectSqlError(db.rows(otherOwner.id, `select * from public.get_setup_progress($1)`, [schoolId]), 'KL404');
  });
});

describe('profile and storage', () => {
  it('lets a person record finished tours on their own profile only', async () => {
    const updated = await db.rows(
      teacher.id,
      `update public.profiles set completed_tours = array['web_welcome_v1'] where id = $1 returning id`,
      [teacher.id],
    );
    expect(updated).toHaveLength(1);
    const other = await db.rows(
      teacher.id,
      `update public.profiles set completed_tours = array['x'] where id = $1 returning id`,
      [owner.id],
    );
    expect(other).toHaveLength(0);
  });

  it('lets only school managers upload into their school\'s logo folder', async () => {
    await db.rows(owner.id, `insert into storage.objects (bucket_id, name) values ('school-logos', $1)`, [
      `${schoolId}/logo.png`,
    ]);
    await expectSqlError(
      db.rows(otherOwner.id, `insert into storage.objects (bucket_id, name) values ('school-logos', $1)`, [
        `${schoolId}/evil.png`,
      ]),
      '42501',
    );
    await expectSqlError(
      db.rows(teacher.id, `insert into storage.objects (bucket_id, name) values ('school-logos', $1)`, [
        `${schoolId}/teacher.png`,
      ]),
      '42501',
    );
    await expectSqlError(
      db.rows(owner.id, `insert into storage.objects (bucket_id, name) values ('school-logos', 'not-a-school/logo.png')`),
      '42501',
    );
  });
});
