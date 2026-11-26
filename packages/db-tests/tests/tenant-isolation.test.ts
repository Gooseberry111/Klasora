/**
 * The most important guarantee in Klasora: one school can never see or change
 * another school's data, regardless of what the client sends.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

let db: TestDatabase;
let ownerA: { id: string; email: string };
let ownerB: { id: string; email: string };
let schoolA: string;
let schoolB: string;
let campusB: string;

beforeAll(async () => {
  db = await createTestDatabase();
  ownerA = await db.createUser();
  ownerB = await db.createUser();
  schoolA = await db.registerSchool(ownerA.id, { name: 'School A' });
  schoolB = await db.registerSchool(ownerB.id, { name: 'School B' });
  const [campus] = await db.admin<{ id: string }>(`select id from public.campuses where school_id = $1`, [schoolB]);
  campusB = campus!.id;
});

describe('reads are confined to your own school', () => {
  const tables = ['schools', 'campuses', 'roles', 'role_permissions', 'school_memberships', 'school_subscriptions'];

  for (const table of tables) {
    it(`School A's owner cannot read School B's ${table}`, async () => {
      const column = table === 'schools' ? 'id' : 'school_id';
      const rows = await db.rows(ownerA.id, `select 1 from public.${table} where ${column} = $1`, [schoolB]);
      expect(rows).toHaveLength(0);
    });
  }

  it('reveals no audit entries from another school', async () => {
    const rows = await db.rows(ownerA.id, `select 1 from public.audit_logs where school_id = $1`, [schoolB]);
    expect(rows).toHaveLength(0);
  });

  it('returns no permissions for a school you do not belong to', async () => {
    const [row] = await db.rows<{ perms: string[] }>(ownerA.id, `select public.get_my_permissions($1) as perms`, [schoolB]);
    expect(row?.perms).toEqual([]);
  });

  it('does not expose School B owner\'s profile to School A', async () => {
    const rows = await db.rows(ownerA.id, `select 1 from public.profiles where id = $1`, [ownerB.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('writes are confined to your own school', () => {
  it('cannot update School B\'s profile', async () => {
    const rows = await db.rows(ownerA.id, `update public.schools set name = 'Hijacked' where id = $1 returning id`, [schoolB]);
    expect(rows).toHaveLength(0);
    const [school] = await db.admin<{ name: string }>(`select name from public.schools where id = $1`, [schoolB]);
    expect(school?.name).toBe('School B');
  });

  it('cannot insert a campus into School B by supplying its school_id', async () => {
    await expectSqlError(
      db.rows(ownerA.id, `insert into public.campuses (school_id, name, code) values ($1, 'Rogue', 'ROGUE')`, [schoolB]),
      '42501',
    );
  });

  it('cannot delete School B\'s campuses', async () => {
    const rows = await db.rows(ownerA.id, `delete from public.campuses where id = $1 returning id`, [campusB]);
    expect(rows).toHaveLength(0);
  });

  it('cannot create a custom role in School B', async () => {
    await expectSqlError(
      db.rows(ownerA.id, `insert into public.roles (school_id, name) values ($1, 'Spy')`, [schoolB]),
      '42501',
    );
  });

  it('cannot invite people into School B', async () => {
    const role = await db.roleId(schoolB, 'teacher');
    await expectSqlError(db.invite(ownerA.id, schoolB, 'mole@evil.test', role), 'KL403');
  });

  it('cannot use a School B role when inviting into School A', async () => {
    const foreignRole = await db.roleId(schoolB, 'school_admin');
    const message = await expectSqlError(db.invite(ownerA.id, schoolA, 'x@evil.test', foreignRole), 'KL400');
    expect(message).toMatch(/does not belong to this school/);
  });

  it('cannot change permissions of School B roles', async () => {
    const role = await db.roleId(schoolB, 'teacher');
    await expectSqlError(
      db.rows(ownerA.id, `select public.set_role_permissions($1, array['finance.view'])`, [role]),
      'KL404',
    );
  });

  it('cannot move a record into another school, even with access to both', async () => {
    const both = await db.createUser();
    const s1 = await db.registerSchool(both.id, { name: 'Twin One' });
    const s2 = await db.registerSchool(both.id, { name: 'Twin Two' });
    const [campus] = await db.rows<{ id: string }>(
      both.id,
      `insert into public.campuses (school_id, name, code) values ($1, 'Annex', 'ANNEX') returning id`,
      [s1],
    );
    // The column grant forbids changing school_id at all; the trigger is a second line of defence.
    await expectSqlError(
      db.rows(both.id, `update public.campuses set school_id = $1 where id = $2`, [s2, campus!.id]),
      '42501',
    );
    await expectSqlError(
      db.admin(`update public.campuses set school_id = $1 where id = $2`, [s2, campus!.id]),
      'KL400',
    );
  });

  it('rejects composite references across tenants at the schema level', async () => {
    const roleB = await db.roleId(schoolB, 'teacher');
    await expectSqlError(
      db.admin(
        `insert into public.school_memberships (school_id, user_id, role_id) values ($1, $2, $3)`,
        [schoolA, ownerA.id, roleB],
      ),
      '23503',
    );
  });
});

describe('platform administrators do not silently bypass school data controls', () => {
  it('a super admin can list schools but cannot read their roles, memberships or campuses', async () => {
    const admin = await db.createUser();
    await db.admin(`insert into public.platform_admins (user_id, platform_role) values ($1, 'super_admin')`, [admin.id]);

    const schools = await db.rows(admin.id, `select id from public.schools where id = $1`, [schoolB]);
    expect(schools).toHaveLength(1);

    for (const table of ['campuses', 'roles', 'role_permissions', 'school_memberships']) {
      const rows = await db.rows(admin.id, `select 1 from public.${table} where school_id = $1`, [schoolB]);
      expect(rows, table).toHaveLength(0);
    }
  });

  it('only super admins can change a school\'s status', async () => {
    const support = await db.createUser();
    await db.admin(`insert into public.platform_admins (user_id, platform_role) values ($1, 'support_admin')`, [support.id]);
    await expectSqlError(
      db.rows(support.id, `select public.platform_set_school_status($1, 'suspended')`, [schoolB]),
      'KL403',
    );
    await expectSqlError(
      db.rows(ownerB.id, `select public.platform_set_school_status($1, 'active')`, [schoolB]),
      'KL403',
    );
  });
});

describe('suspended schools are read-only', () => {
  it('keeps data readable but blocks changes', async () => {
    const owner = await db.createUser();
    const schoolId = await db.registerSchool(owner.id, { name: 'Paused School' });
    const admin = await db.createUser();
    await db.admin(`insert into public.platform_admins (user_id, platform_role) values ($1, 'super_admin')`, [admin.id]);
    await db.rows(admin.id, `select public.platform_set_school_status($1, 'suspended')`, [schoolId]);

    const campuses = await db.rows(owner.id, `select id from public.campuses where school_id = $1`, [schoolId]);
    expect(campuses).toHaveLength(1);

    await expectSqlError(
      db.rows(owner.id, `insert into public.campuses (school_id, name, code) values ($1, 'New', 'NEW')`, [schoolId]),
      '42501',
    );
    const updated = await db.rows(owner.id, `update public.schools set name = 'Renamed' where id = $1 returning id`, [schoolId]);
    expect(updated).toHaveLength(0);
  });
});
