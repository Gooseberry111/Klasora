import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSION_KEYS, SYSTEM_ROLE_DEFAULT_PERMISSIONS, SYSTEM_ROLE_KEYS } from '@klasora/shared';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

describe('shared catalogue matches the database', () => {
  it('has the same permission keys', async () => {
    const rows = await db.admin<{ permission_key: string }>(`select permission_key from public.permissions`);
    expect(rows.map((r) => r.permission_key).sort()).toEqual([...ALL_PERMISSION_KEYS].sort());
  });

  it('has the same built-in roles and default permissions', async () => {
    const templates = await db.admin<{ role_key: string }>(`select role_key from public.system_role_templates`);
    expect(templates.map((t) => t.role_key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());

    for (const [roleKey, keys] of Object.entries(SYSTEM_ROLE_DEFAULT_PERMISSIONS)) {
      const rows = await db.admin<{ permission_key: string }>(
        `select permission_key from public.system_role_template_permissions where role_key = $1`,
        [roleKey],
      );
      expect(rows.map((r) => r.permission_key).sort(), roleKey).toEqual([...keys].sort());
    }
  });
});

describe('audit log', () => {
  let owner: { id: string };
  let schoolId: string;

  beforeAll(async () => {
    owner = await db.createUser();
    schoolId = await db.registerSchool(owner.id, { name: 'Audit High' });
  });

  it('records who changed what, with before and after values', async () => {
    await db.rows(owner.id, `update public.schools set city = 'Yaba' where id = $1`, [schoolId]);
    const [entry] = await db.rows<{ actor_user_id: string; action: string; previous_city: string; new_city: string }>(
      owner.id,
      `select actor_user_id, action, previous_data ->> 'city' as previous_city, new_data ->> 'city' as new_city
       from public.audit_logs where school_id = $1 and entity_type = 'schools' and action = 'update'
       order by created_at desc limit 1`,
      [schoolId],
    );
    expect(entry).toEqual({ actor_user_id: owner.id, action: 'update', previous_city: 'Ikeja', new_city: 'Yaba' });
  });

  it('logs registration side effects (roles, membership, subscription)', async () => {
    const rows = await db.admin<{ entity_type: string }>(
      `select distinct entity_type from public.audit_logs where school_id = $1`,
      [schoolId],
    );
    expect(rows.map((r) => r.entity_type)).toEqual(
      expect.arrayContaining(['schools', 'campuses', 'roles', 'role_permissions', 'school_memberships', 'school_subscriptions']),
    );
  });

  it('never stores invitation token hashes', async () => {
    const teacherRole = await db.roleId(schoolId, 'teacher');
    await db.invite(owner.id, schoolId, 'hash.check@klasora.test', teacherRole);
    const rows = await db.admin<{ has_hash: boolean }>(
      `select (new_data ? 'token_hash') as has_hash from public.audit_logs where entity_type = 'invitations'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.has_hash)).toBe(true);
  });

  it('is append-only, even for the database owner', async () => {
    await expectSqlError(db.admin(`update public.audit_logs set action = 'tampered'`), 'KL403');
    await expectSqlError(db.admin(`delete from public.audit_logs`), 'KL403');
    await expectSqlError(db.admin(`truncate public.audit_logs`), 'KL403');
  });

  it('cannot be written through the API', async () => {
    await expectSqlError(
      db.rows(owner.id, `insert into public.audit_logs (school_id, action, entity_type) values ($1, 'fake', 'x')`, [schoolId]),
      '42501',
    );
  });

  it('is visible to users with audit.view and hidden from others', async () => {
    const teacher = await db.addMember(owner.id, schoolId, 'teacher');
    const admin = await db.addMember(owner.id, schoolId, 'school_admin');
    expect(await db.rows(teacher.id, `select 1 from public.audit_logs where school_id = $1`, [schoolId])).toHaveLength(0);
    expect((await db.rows(admin.id, `select 1 from public.audit_logs where school_id = $1`, [schoolId])).length).toBeGreaterThan(0);
  });
});
