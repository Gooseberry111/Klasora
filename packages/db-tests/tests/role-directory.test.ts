import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

let db: TestDatabase;
let owner: { id: string };
let schoolId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await db.createUser({ firstName: 'Ngozi', lastName: 'Adeyemi' });
  schoolId = await db.registerSchool(owner.id, { name: 'Directory School' });
});

describe('list_role_summaries', () => {
  it('returns built-in roles first with accurate counts', async () => {
    await db.addMember(owner.id, schoolId, 'teacher');
    await db.addMember(owner.id, schoolId, 'teacher');
    const rows = await db.rows<{ role_key: string | null; member_count: number; permission_count: number }>(
      owner.id,
      `select role_key, member_count, permission_count from public.list_role_summaries($1)`,
      [schoolId],
    );
    expect(rows.map((r) => r.role_key)).toEqual([
      'owner', 'school_admin', 'principal', 'teacher', 'accountant', 'parent', 'student',
    ]);
    const teacher = rows.find((r) => r.role_key === 'teacher')!;
    expect(teacher.member_count).toBe(2);
    expect(teacher.permission_count).toBe(12);
    expect(rows.find((r) => r.role_key === 'owner')!.member_count).toBe(1);
  });

  it('is refused to members without roles.view or staff.view', async () => {
    const parent = await db.addMember(owner.id, schoolId, 'parent');
    await expectSqlError(db.rows(parent.id, `select * from public.list_role_summaries($1)`, [schoolId]), 'KL403');
  });

  it('is refused to other schools', async () => {
    const outsider = await db.createUser();
    await db.registerSchool(outsider.id, { name: 'Outsider School' });
    await expectSqlError(db.rows(outsider.id, `select * from public.list_role_summaries($1)`, [schoolId]), 'KL403');
  });
});

describe('list_role_members and get_role_permissions', () => {
  it('lists members of a role with their names', async () => {
    const rows = await db.rows<{ first_name: string }>(
      owner.id,
      `select first_name from public.list_role_members($1)`,
      [await db.roleId(schoolId, 'owner')],
    );
    expect(rows).toEqual([{ first_name: 'Ngozi' }]);
  });

  it('returns a role\'s permission keys to members only', async () => {
    const teacherRole = await db.roleId(schoolId, 'teacher');
    const [row] = await db.rows<{ keys: string[] }>(owner.id, `select public.get_role_permissions($1) as keys`, [teacherRole]);
    expect(row?.keys).toContain('attendance.create');

    const outsider = await db.createUser();
    await expectSqlError(db.rows(outsider.id, `select public.get_role_permissions($1)`, [teacherRole]), 'KL404');
    await expectSqlError(db.rows(outsider.id, `select * from public.list_role_members($1)`, [teacherRole]), 'KL404');
  });
});
