import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_MODULES,
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  administratorStepSchema,
  formatMoney,
  institutionStepSchema,
  isPermissionKey,
  loginSchema,
  parseMoneyToMinor,
  permissionKey,
  validate,
} from '../src';

describe('permission catalogue', () => {
  it('builds unique module.action keys', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
    expect(ALL_PERMISSION_KEYS).toContain('students.view');
    expect(ALL_PERMISSION_KEYS).toContain('examinations.approve');
    expect(ALL_PERMISSION_KEYS).not.toContain('reports.delete');
  });

  it('only references real permissions in role templates', () => {
    for (const keys of Object.values(SYSTEM_ROLE_DEFAULT_PERMISSIONS)) {
      for (const key of keys) expect(isPermissionKey(key)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('keeps finance and billing away from teachers and parents by default', () => {
    const teacher = SYSTEM_ROLE_DEFAULT_PERMISSIONS.teacher;
    expect(teacher.some((k) => k.startsWith('finance.') || k.startsWith('billing.'))).toBe(false);
    expect(teacher).not.toContain('students.view');
    expect(SYSTEM_ROLE_DEFAULT_PERMISSIONS.parent).toEqual([]);
    expect(SYSTEM_ROLE_DEFAULT_PERMISSIONS.student).toEqual([]);
  });

  it('never lets accountants alter examination results', () => {
    expect(SYSTEM_ROLE_DEFAULT_PERMISSIONS.accountant.some((k) => k.startsWith('examinations.'))).toBe(false);
  });

  it('returns null for actions a module does not support', () => {
    expect(permissionKey('reports', 'delete')).toBeNull();
    expect(permissionKey('finance', 'approve')).toBe('finance.approve');
    expect(Object.keys(PERMISSION_MODULES)).toHaveLength(14);
  });
});

describe('validation schemas', () => {
  it('normalises email on login', () => {
    const result = validate(loginSchema, { email: '  Ada@School.NG ', password: 'x' });
    expect(result.success && result.data.email).toBe('ada@school.ng');
  });

  it('returns friendly field errors for an incomplete institution step', () => {
    const result = validate(institutionStepSchema, {
      name: 'A',
      institutionType: 'primary',
      email: 'not-an-email',
      phone: '12',
      country: 'NG',
      state: '',
      city: 'Lagos',
      address: '12 Allen Avenue, Ikeja',
      website: 'example',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.name).toMatch(/name of your institution/);
      expect(result.errors.email).toMatch(/valid email/);
      expect(result.errors.phone).toMatch(/valid phone/);
      expect(result.errors.state).toBeDefined();
      expect(result.errors.website).toMatch(/https/);
    }
  });

  it('accepts a complete institution step with an empty website', () => {
    const result = validate(institutionStepSchema, {
      name: 'Greenfield Academy',
      institutionType: 'primary_secondary',
      email: 'office@greenfield.example',
      phone: '+234 803 000 0000',
      country: 'NG',
      state: 'Lagos',
      city: 'Ikeja',
      address: '12 Allen Avenue, Ikeja',
      website: '',
    });
    expect(result.success).toBe(true);
  });

  it('requires matching passwords with a letter and a number', () => {
    const base = { firstName: 'Ada', lastName: 'Obi', email: 'ada@x.com', phone: '08030000000' };
    const weak = validate(administratorStepSchema, { ...base, password: 'password', confirmPassword: 'password' });
    expect(!weak.success && weak.errors.password).toMatch(/letter and one number/);
    const mismatch = validate(administratorStepSchema, { ...base, password: 'pass1234', confirmPassword: 'pass12345' });
    expect(!mismatch.success && mismatch.errors.confirmPassword).toMatch(/do not match/);
    const ok = validate(administratorStepSchema, { ...base, password: 'pass1234', confirmPassword: 'pass1234' });
    expect(ok.success).toBe(true);
  });
});

describe('money helpers', () => {
  it('formats kobo as naira', () => {
    expect(formatMoney(1_500_000, 'NGN')).toBe('₦15,000');
    expect(formatMoney(1_500_050, 'NGN')).toBe('₦15,000.50');
  });

  it('parses major units into integer minor units without float drift', () => {
    expect(parseMoneyToMinor('15,000', 'NGN')).toBe(1_500_000);
    expect(parseMoneyToMinor('0.29', 'NGN')).toBe(29);
    expect(parseMoneyToMinor('10.555', 'NGN')).toBeNull();
    expect(parseMoneyToMinor('abc', 'NGN')).toBeNull();
  });
});
