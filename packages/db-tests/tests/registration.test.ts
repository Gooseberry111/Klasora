import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

describe('auth → profile', () => {
  it('creates a profile with the same id when an auth user is created', async () => {
    const user = await db.createUser({ firstName: 'Amaka', lastName: 'Eze' });
    const [profile] = await db.rows<{ id: string; first_name: string; email: string }>(
      user.id,
      `select id, first_name, email from public.profiles where id = auth.uid()`,
    );
    expect(profile).toMatchObject({ id: user.id, first_name: 'Amaka', email: user.email });
  });

  it('lets users edit their own name but not their email', async () => {
    const user = await db.createUser();
    await db.rows(user.id, `update public.profiles set first_name = 'Tunde' where id = auth.uid()`);
    const [row] = await db.admin<{ first_name: string }>(`select first_name from public.profiles where id = $1`, [user.id]);
    expect(row?.first_name).toBe('Tunde');

    await expectSqlError(
      db.rows(user.id, `update public.profiles set email = 'spoof@evil.test' where id = auth.uid()`),
      '42501',
    );
  });

  it('keeps the profile email in sync with the auth email', async () => {
    const user = await db.createUser();
    await db.admin(`update auth.users set email = 'NEW.Address@klasora.test' where id = $1`, [user.id]);
    const [row] = await db.admin<{ email: string }>(`select email from public.profiles where id = $1`, [user.id]);
    expect(row?.email).toBe('new.address@klasora.test');
  });

  it('hides other people\'s profiles from unrelated users', async () => {
    const a = await db.createUser();
    const b = await db.createUser();
    const rows = await db.rows(a.id, `select id from public.profiles where id = $1`, [b.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('register_school', () => {
  it('provisions a complete workspace atomically', async () => {
    const owner = await db.createUser();
    const schoolId = await db.registerSchool(owner.id, { name: 'Greenfield Academy, Ikeja!' });

    const [school] = await db.admin<{ slug: string; status: string; created_by: string; default_currency: string; timezone: string }>(
      `select slug, status, created_by, default_currency, timezone from public.schools where id = $1`,
      [schoolId],
    );
    expect(school).toMatchObject({
      slug: 'greenfield-academy-ikeja',
      status: 'active',
      created_by: owner.id,
      default_currency: 'NGN',
      timezone: 'Africa/Lagos',
    });

    const campuses = await db.admin<{ code: string; is_main: boolean }>(
      `select code, is_main from public.campuses where school_id = $1`,
      [schoolId],
    );
    expect(campuses).toEqual([{ code: 'MAIN', is_main: true }]);

    const roles = await db.admin<{ role_key: string }>(
      `select role_key from public.roles where school_id = $1 order by role_key`,
      [schoolId],
    );
    expect(roles.map((r) => r.role_key)).toEqual([
      'accountant', 'owner', 'parent', 'principal', 'school_admin', 'student', 'teacher',
    ]);

    const [membership] = await db.admin<{ role_key: string; status: string }>(
      `select r.role_key, m.status from public.school_memberships m
       join public.roles r on r.id = m.role_id where m.school_id = $1 and m.user_id = $2`,
      [schoolId, owner.id],
    );
    expect(membership).toEqual({ role_key: 'owner', status: 'active' });

    const [subscription] = await db.admin<{ status: string; code: string; trial_days: number }>(
      `select s.status, p.code, extract(day from s.trial_ends_at - s.starts_at)::int as trial_days
       from public.school_subscriptions s join public.subscription_plans p on p.id = s.plan_id
       where s.school_id = $1`,
      [schoolId],
    );
    expect(subscription).toEqual({ status: 'trialing', code: 'starter', trial_days: 14 });
  });

  it('gives each school a unique slug even with identical names', async () => {
    const a = await db.createUser();
    const b = await db.createUser();
    const s1 = await db.registerSchool(a.id, { name: 'Unity College' });
    const s2 = await db.registerSchool(b.id, { name: 'Unity College' });
    const rows = await db.admin<{ slug: string }>(
      `select slug from public.schools where id in ($1, $2)`,
      [s1, s2],
    );
    expect(new Set(rows.map((r) => r.slug)).size).toBe(2);
  });

  it('rejects anonymous callers', async () => {
    await expectSqlError(db.registerSchool(null as unknown as string), '42501');
  });

  it('requires a verified email address', async () => {
    const user = await db.createUser({ confirmed: false });
    const message = await expectSqlError(db.registerSchool(user.id), 'KL403');
    expect(message).toMatch(/verify your email/);
  });

  it('rejects plans that are not self-serve', async () => {
    const user = await db.createUser();
    const message = await expectSqlError(db.registerSchool(user.id, { planCode: 'enterprise' }), 'KL400');
    expect(message).toMatch(/plan is not available/);
  });

  it('rejects unsupported countries', async () => {
    const user = await db.createUser();
    await expectSqlError(db.registerSchool(user.id, { country: 'ZZ' }), 'KL400');
  });

  it('limits registrations to three per user per day', async () => {
    const user = await db.createUser();
    for (let i = 0; i < 3; i++) await db.registerSchool(user.id, { name: `Rate School ${i}` });
    await expectSqlError(db.registerSchool(user.id, { name: 'Rate School 4' }), 'KL429');
  });

  it('allows one person to own several schools and see all of them', async () => {
    const user = await db.createUser();
    const s1 = await db.registerSchool(user.id, { name: 'Multi One' });
    const s2 = await db.registerSchool(user.id, { name: 'Multi Two' });
    const rows = await db.rows<{ id: string }>(user.id, `select id from public.schools order by name`);
    expect(rows.map((r) => r.id).sort()).toEqual([s1, s2].sort());
  });

  it('cannot be bypassed with a direct insert', async () => {
    const user = await db.createUser();
    await expectSqlError(
      db.rows(
        user.id,
        `insert into public.schools (name, slug, institution_type, email, phone, state, city, address)
         values ('Rogue', 'rogue', 'primary', 'r@r.test', '08030000000', 'Lagos', 'Ikeja', 'Somewhere')`,
      ),
      '42501',
    );
  });
});

describe('public plan catalogue', () => {
  it('shows active plans to anonymous visitors but no schools', async () => {
    const plans = await db.rows<{ code: string; monthly_price: string | null }>(
      null,
      `select code, monthly_price from public.subscription_plans order by sort_order`,
    );
    expect(plans.map((p) => p.code)).toEqual(['starter', 'growth', 'enterprise']);
    expect(Number(plans[0]?.monthly_price)).toBe(1_500_000);

    await expectSqlError(db.rows(null, `select id from public.schools`), '42501');
  });
});
