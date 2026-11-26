import { describe, expect, it } from 'vitest';
import type { PermissionKey, SubscriptionPlan } from '@klasora/shared';
import { AppError, toAppError } from './errors';
import { canTogglePermission, roleEditability, sameKeys, type EditorContext } from './role-permissions';
import { describeLimit, describeStorage, planHighlights } from './plans';
import { greetingFor } from './time';
import { visibleNavigation } from '@/navigation';

describe('toAppError', () => {
  const ctx = { fallback: "We couldn't save this student. Please check the required fields and try again." };

  it('shows Klasora database messages verbatim', () => {
    const error = toAppError({ code: 'KL403', message: 'You cannot change your own role or status.' }, ctx);
    expect(error.message).toBe('You cannot change your own role or status.');
    expect(error.code).toBe('KL403');
  });

  it('never exposes raw Postgres codes', () => {
    expect(toAppError({ code: '42501', message: 'new row violates row-level security policy' }, ctx).message).toMatch(
      /don't have permission/,
    );
    expect(toAppError({ code: '23505', message: 'duplicate key' }, { ...ctx, conflict: 'A role with this name already exists.' }).message).toBe(
      'A role with this name already exists.',
    );
    expect(toAppError({ code: '23001', message: 'restrict' }, { ...ctx, inUse: 'Still assigned.' }).message).toBe('Still assigned.');
    expect(toAppError({ code: '23514', message: 'check' }, ctx).message).toMatch(/not valid/);
  });

  it('maps Supabase Auth errors to plain language', () => {
    expect(toAppError({ code: 'invalid_credentials', message: 'Invalid login credentials' }, ctx).message).toBe(
      'The email or password is incorrect.',
    );
    expect(toAppError({ message: 'Email not confirmed' }, ctx).message).toMatch(/confirm your email/);
    expect(toAppError({ status: 429, message: 'Too many' }, ctx).message).toMatch(/Too many attempts/);
  });

  it('recognises network failures', () => {
    expect(toAppError(new TypeError('Failed to fetch'), ctx).message).toMatch(/couldn't reach Klasora/);
  });

  it('falls back to the caller-provided message', () => {
    expect(toAppError({ code: 'XX000', message: 'internal' }, ctx).message).toBe(ctx.fallback);
    const original = new AppError('Already friendly');
    expect(toAppError(original, ctx)).toBe(original);
  });
});

describe('role editing rules (mirror of set_role_permissions)', () => {
  const base: EditorContext = {
    canEditRoles: true,
    isOwner: false,
    myRoleIds: new Set(['my-role']),
    myPermissions: new Set<PermissionKey>(['students.view', 'roles.edit']),
    schoolWritable: true,
  };
  const custom = { id: 'custom', role_key: null, is_system_role: false };
  const builtIn = { id: 'teacher', role_key: 'teacher' as const, is_system_role: true };

  it('locks the owner role for everyone', () => {
    expect(roleEditability({ id: 'o', role_key: 'owner', is_system_role: true }, { ...base, isOwner: true }).editable).toBe(false);
  });

  it('lets only owners edit built-in roles', () => {
    expect(roleEditability(builtIn, base).editable).toBe(false);
    expect(roleEditability(builtIn, { ...base, isOwner: true }).editable).toBe(true);
  });

  it('blocks editing your own role and editing without roles.edit', () => {
    expect(roleEditability({ ...custom, id: 'my-role' }, base).editable).toBe(false);
    expect(roleEditability(custom, { ...base, canEditRoles: false }).editable).toBe(false);
    expect(roleEditability(custom, { ...base, schoolWritable: false }).editable).toBe(false);
    expect(roleEditability(custom, base).editable).toBe(true);
  });

  it('only allows toggling permissions you hold, unless you are the owner', () => {
    expect(canTogglePermission('students.view', base)).toBe(true);
    expect(canTogglePermission('billing.edit', base)).toBe(false);
    expect(canTogglePermission('billing.edit', { ...base, isOwner: true })).toBe(true);
  });

  it('compares permission sets ignoring order', () => {
    expect(sameKeys(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameKeys(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('navigation', () => {
  it('hides modules the user lacks permission for and keeps public items', () => {
    const none = visibleNavigation(() => false);
    const items = none.flatMap((s) => s.items.map((i) => i.routeName));
    expect(items).toContain('dashboard');
    expect(items).toContain('account');
    expect(items).not.toContain('roles');

    const withRoles = visibleNavigation((p) => p === 'roles.view').flatMap((s) => s.items.map((i) => i.routeName));
    expect(withRoles).toContain('roles');
  });
});

describe('plan presentation', () => {
  it('describes limits from stored values', () => {
    expect(describeLimit(300, 'student')).toBe('Up to 300 students');
    expect(describeLimit(1, 'campus', 'campuses')).toBe('1 campus');
    expect(describeLimit(null, 'campus', 'campuses')).toBe('Unlimited campuses');
    expect(describeStorage(25600)).toBe('25 GB storage');
  });

  it('derives highlights from feature flags', () => {
    const plan = {
      storage_limit_mb: 5120,
      support_level: 'priority',
      feature_limits: { parent_portal: true, advanced_reports: false },
    } as unknown as SubscriptionPlan;
    expect(planHighlights(plan)).toEqual(['5 GB storage', 'Parent and student portals', 'Priority support']);
  });
});

describe('greetingFor', () => {
  it('uses the school time zone', () => {
    const utcEight = new Date('2026-11-26T08:00:00Z'); // 09:00 in Lagos
    expect(greetingFor(utcEight, 'Africa/Lagos')).toBe('Good morning');
    expect(greetingFor(new Date('2026-11-26T14:00:00Z'), 'Africa/Lagos')).toBe('Good afternoon');
    expect(greetingFor(new Date('2026-11-26T19:00:00Z'), 'Africa/Lagos')).toBe('Good evening');
  });
});
