/**
 * Role-based access control: deny-by-default permissions, invitations, and
 * protection against privilege escalation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ROLE_DEFAULT_PERMISSIONS } from '@klasora/shared';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

let db: TestDatabase;
let owner: { id: string; email: string };
let schoolId: string;

const perms = async (userId: string, school = schoolId) =>
  (await db.rows<{ p: string[] }>(userId, `select public.get_my_permissions($1) as p`, [school]))[0]!.p;

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await db.createUser();
  schoolId = await db.registerSchool(owner.id, { name: 'RBAC Academy' });
});

describe('effective permissions', () => {
  it('gives the owner every permission', async () => {
    const [{ count }] = (await db.admin<{ count: number }>(`select count(*)::int as count from public.permissions`)) as [
      { count: number },
    ];
    expect(await perms(owner.id)).toHaveLength(count);
  });

  it('gives each built-in role exactly its template permissions', async () => {
    for (const roleKey of ['school_admin', 'principal', 'teacher', 'accountant', 'parent', 'student'] as const) {
      const member = await db.addMember(owner.id, schoolId, roleKey);
      expect((await perms(member.id)).sort(), roleKey).toEqual([...SYSTEM_ROLE_DEFAULT_PERMISSIONS[roleKey]].sort());
    }
  });

  it('combines permissions across several roles in the same school', async () => {
    const person = await db.addMember(owner.id, schoolId, 'teacher');
    const token = await db.invite(owner.id, schoolId, person.email, await db.roleId(schoolId, 'accountant'));
    await db.rows(person.id, `select public.accept_invitation($1)`, [token]);
    const p = await perms(person.id);
    expect(p).toContain('attendance.create');
    expect(p).toContain('finance.create');
  });

  it('removes all access when a membership is deactivated', async () => {
    const teacher = await db.addMember(owner.id, schoolId, 'teacher');
    const [m] = await db.admin<{ id: string }>(
      `select id from public.school_memberships where user_id = $1 and school_id = $2`,
      [teacher.id, schoolId],
    );
    await db.rows(owner.id, `select public.update_membership($1, null, 'inactive')`, [m!.id]);
    expect(await perms(teacher.id)).toEqual([]);
    expect(await db.rows(teacher.id, `select 1 from public.campuses where school_id = $1`, [schoolId])).toHaveLength(0);
  });
});

describe('default role boundaries', () => {
  it('teachers cannot edit school settings or create campuses', async () => {
    const teacher = await db.addMember(owner.id, schoolId, 'teacher');
    const updated = await db.rows(teacher.id, `update public.schools set name = 'Nope' where id = $1 returning id`, [schoolId]);
    expect(updated).toHaveLength(0);
    await expectSqlError(
      db.rows(teacher.id, `insert into public.campuses (school_id, name, code) values ($1, 'X', 'X')`, [schoolId]),
      '42501',
    );
  });

  it('teachers cannot see the member list, invitations or billing', async () => {
    const teacher = await db.addMember(owner.id, schoolId, 'teacher');
    const memberships = await db.rows<{ user_id: string }>(
      teacher.id,
      `select user_id from public.school_memberships where school_id = $1`,
      [schoolId],
    );
    expect(memberships.every((m) => m.user_id === teacher.id)).toBe(true);
    expect(await db.rows(teacher.id, `select 1 from public.invitations`)).toHaveLength(0);
    expect(await db.rows(teacher.id, `select 1 from public.school_subscriptions`)).toHaveLength(0);
  });

  it('parents and students hold no school-wide permissions', async () => {
    const parent = await db.addMember(owner.id, schoolId, 'parent');
    expect(await perms(parent.id)).toEqual([]);
    expect(await db.rows(parent.id, `select 1 from public.audit_logs`)).toHaveLength(0);
  });

  it('school administrators can update school settings', async () => {
    const admin = await db.addMember(owner.id, schoolId, 'school_admin');
    const rows = await db.rows(admin.id, `update public.schools set city = 'Lekki' where id = $1 returning id`, [schoolId]);
    expect(rows).toHaveLength(1);
  });

  it('invitation token hashes are never readable', async () => {
    await expectSqlError(db.rows(owner.id, `select token_hash from public.invitations`), '42501');
  });
});

describe('invitations', () => {
  it('only the invited, verified email can accept', async () => {
    const invitee = await db.createUser();
    const stranger = await db.createUser();
    const token = await db.invite(owner.id, schoolId, invitee.email, await db.roleId(schoolId, 'teacher'));

    const message = await expectSqlError(db.rows(stranger.id, `select public.accept_invitation($1)`, [token]), 'KL403');
    expect(message).toMatch(/different email/);

    await db.rows(invitee.id, `select public.accept_invitation($1)`, [token]);
    await expectSqlError(db.rows(invitee.id, `select public.accept_invitation($1)`, [token]), 'KL409');
  });

  it('matches email case-insensitively', async () => {
    const invitee = await db.createUser({ email: 'mixed.case@klasora.test' });
    const token = await db.invite(owner.id, schoolId, 'Mixed.Case@Klasora.TEST', await db.roleId(schoolId, 'teacher'));
    const [row] = await db.rows<{ school: string }>(invitee.id, `select public.accept_invitation($1) as school`, [token]);
    expect(row?.school).toBe(schoolId);
  });

  it('requires the invitee to have verified their email', async () => {
    const invitee = await db.createUser({ confirmed: false });
    const token = await db.invite(owner.id, schoolId, invitee.email, await db.roleId(schoolId, 'teacher'));
    await expectSqlError(db.rows(invitee.id, `select public.accept_invitation($1)`, [token]), 'KL403');
  });

  it('rejects expired, revoked and unknown tokens', async () => {
    const invitee = await db.createUser();
    const role = await db.roleId(schoolId, 'teacher');

    const expired = await db.invite(owner.id, schoolId, invitee.email, role);
    await db.admin(`update public.invitations set expires_at = now() - interval '1 minute' where status = 'pending' and email = $1`, [invitee.email]);
    await expectSqlError(db.rows(invitee.id, `select public.accept_invitation($1)`, [expired]), 'KL409');
    const [preview] = await db.rows<{ status: string }>(null, `select status from public.get_invitation_preview($1)`, [expired]);
    expect(preview?.status).toBe('expired');

    const fresh = await db.invite(owner.id, schoolId, invitee.email, role); // replaces the expired one
    const [inv] = await db.admin<{ id: string }>(`select id from public.invitations where status = 'pending' and email = $1`, [invitee.email]);
    await db.rows(owner.id, `select public.revoke_invitation($1)`, [inv!.id]);
    await expectSqlError(db.rows(invitee.id, `select public.accept_invitation($1)`, [fresh]), 'KL409');

    await expectSqlError(db.rows(invitee.id, `select public.accept_invitation('not-a-real-token')`), 'KL404');
  });

  it('previews an invitation for anonymous visitors holding the token only', async () => {
    const token = await db.invite(owner.id, schoolId, 'preview@klasora.test', await db.roleId(schoolId, 'principal'));
    const [preview] = await db.rows<{ school_name: string; role_name: string; status: string }>(
      null,
      `select school_name, role_name, status from public.get_invitation_preview($1)`,
      [token],
    );
    expect(preview).toEqual({ school_name: 'RBAC Academy', role_name: 'Principal / Head Teacher', status: 'pending' });
    expect(await db.rows(null, `select * from public.get_invitation_preview('guess')`)).toHaveLength(0);
  });

  it('teachers cannot invite anyone', async () => {
    const teacher = await db.addMember(owner.id, schoolId, 'teacher');
    await expectSqlError(
      db.invite(teacher.id, schoolId, 'friend@klasora.test', await db.roleId(schoolId, 'teacher')),
      'KL403',
    );
  });

  it('nobody can be invited as the owner', async () => {
    await expectSqlError(
      db.invite(owner.id, schoolId, 'heir@klasora.test', await db.roleId(schoolId, 'owner')),
      'KL403',
    );
  });
});

describe('privilege escalation is blocked', () => {
  let admin: { id: string; email: string };

  beforeAll(async () => {
    admin = await db.addMember(owner.id, schoolId, 'school_admin');
  });

  it('users cannot write memberships or role permissions directly', async () => {
    const ownerRole = await db.roleId(schoolId, 'owner');
    await expectSqlError(
      db.rows(admin.id, `insert into public.school_memberships (school_id, user_id, role_id) values ($1, $2, $3)`, [
        schoolId, admin.id, ownerRole,
      ]),
      '42501',
    );
    await expectSqlError(
      db.rows(admin.id, `update public.school_memberships set role_id = $1 where user_id = auth.uid()`, [ownerRole]),
      '42501',
    );
    await expectSqlError(
      db.rows(admin.id, `insert into public.role_permissions (school_id, role_id, permission_id)
                         select $1, $2, id from public.permissions where permission_key = 'billing.edit'`, [
        schoolId, await db.roleId(schoolId, 'school_admin'),
      ]),
      '42501',
    );
  });

  it('cannot change the permissions of their own role', async () => {
    // Give the admin role roles.edit first (as owner) so the check under test is the self-role rule.
    const adminRole = await db.roleId(schoolId, 'school_admin');
    const current = await db.admin<{ k: string }>(
      `select unnest(app.role_permission_keys($1)) as k`, [adminRole],
    );
    await db.rows(owner.id, `select public.set_role_permissions($1, $2)`, [
      adminRole, [...current.map((r) => r.k), 'roles.create', 'roles.edit'],
    ]);
    const message = await expectSqlError(
      db.rows(admin.id, `select public.set_role_permissions($1, array['billing.edit'])`, [adminRole]),
      'KL403',
    );
    expect(message).toMatch(/built-in roles|assigned to you/);
  });

  it('cannot grant a custom role permissions they do not hold', async () => {
    const [role] = await db.rows<{ id: string }>(
      admin.id,
      `insert into public.roles (school_id, name, description) values ($1, 'Exams Officer', 'Runs exams') returning id`,
      [schoolId],
    );
    await db.rows(admin.id, `select public.set_role_permissions($1, array['examinations.view', 'examinations.create'])`, [role!.id]);

    const message = await expectSqlError(
      db.rows(admin.id, `select public.set_role_permissions($1, array['examinations.view', 'billing.edit'])`, [role!.id]),
      'KL403',
    );
    expect(message).toMatch(/billing\.edit/);
  });

  it('cannot assign a role more powerful than their own', async () => {
    const [custom] = await db.admin<{ id: string }>(
      `insert into public.roles (school_id, name) values ($1, 'Billing Lead') returning id`, [schoolId],
    );
    await db.rows(owner.id, `select public.set_role_permissions($1, array['billing.view', 'billing.edit'])`, [custom!.id]);
    const message = await expectSqlError(
      db.invite(admin.id, schoolId, 'lead@klasora.test', custom!.id),
      'KL403',
    );
    expect(message).toMatch(/more access/);
  });

  it('cannot change their own membership', async () => {
    const [m] = await db.admin<{ id: string }>(
      `select m.id from public.school_memberships m where m.user_id = $1 and m.school_id = $2`,
      [admin.id, schoolId],
    );
    await expectSqlError(
      db.rows(admin.id, `select public.update_membership($1, null, 'active')`, [m!.id]),
      'KL403',
    );
  });

  it('cannot demote or deactivate the owner', async () => {
    const [m] = await db.admin<{ id: string }>(
      `select id from public.school_memberships where user_id = $1 and school_id = $2`, [owner.id, schoolId],
    );
    const adminRole = await db.roleId(schoolId, 'school_admin');
    const current = await db.admin<{ k: string }>(`select unnest(app.role_permission_keys($1)) as k`, [adminRole]);
    await db.rows(owner.id, `select public.set_role_permissions($1, $2)`, [
      adminRole, [...new Set([...current.map((r) => r.k), 'staff.edit'])],
    ]);
    const message = await expectSqlError(
      db.rows(admin.id, `select public.update_membership($1, null, 'suspended')`, [m!.id]),
      'KL403',
    );
    expect(message).toMatch(/Owner/);
  });

  it('cannot rename or delete built-in roles', async () => {
    const teacherRole = await db.roleId(schoolId, 'teacher');
    expect(await db.rows(owner.id, `update public.roles set name = 'Tutor' where id = $1 returning id`, [teacherRole])).toHaveLength(0);
    expect(await db.rows(owner.id, `delete from public.roles where id = $1 returning id`, [teacherRole])).toHaveLength(0);
  });

  it('cannot create a role flagged as a system role', async () => {
    await expectSqlError(
      db.rows(owner.id, `insert into public.roles (school_id, name, is_system_role, role_key) values ($1, 'Fake', true, 'owner')`, [schoolId]),
      '42501',
    );
  });

  it('cannot change the owner role\'s permissions, even as owner', async () => {
    await expectSqlError(
      db.rows(owner.id, `select public.set_role_permissions($1, array[]::text[])`, [await db.roleId(schoolId, 'owner')]),
      'KL403',
    );
  });

  it('rejects unknown permission keys', async () => {
    const message = await expectSqlError(
      db.rows(owner.id, `select public.set_role_permissions($1, array['students.view', 'students.teleport'])`, [
        await db.roleId(schoolId, 'teacher'),
      ]),
      'KL400',
    );
    expect(message).toMatch(/students\.teleport/);
  });

  it('a role in use cannot be deleted', async () => {
    const [role] = await db.rows<{ id: string }>(
      owner.id,
      `insert into public.roles (school_id, name) values ($1, 'Librarian') returning id`,
      [schoolId],
    );
    const librarian = await db.createUser();
    const token = await db.invite(owner.id, schoolId, librarian.email, role!.id);
    await db.rows(librarian.id, `select public.accept_invitation($1)`, [token]);
    // ON DELETE RESTRICT raises restrict_violation (23001).
    await expectSqlError(db.rows(owner.id, `delete from public.roles where id = $1`, [role!.id]), '23001');
  });
});
