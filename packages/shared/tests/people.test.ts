import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  ageFrom,
  bloodGroupLabel,
  formatDmy,
  parseCsv,
  parseFlexibleDate,
  readStudentImport,
  studentFormSchema,
  studentImportTemplate,
  toCsv,
  validate,
} from '../src';

describe('csv', () => {
  it('reads quotes, commas, Windows line endings and a byte order mark', () => {
    const table = parseCsv('﻿Name,Note\r\n"Okeke, Chidi","He said ""hi"""\r\n\r\nAda,\n');
    expect(table).toEqual([
      ['Name', 'Note'],
      ['Okeke, Chidi', 'He said "hi"'],
      ['Ada', ''],
    ]);
  });

  it('round trips values and blocks spreadsheet formulas', () => {
    const csv = toCsv([['a,b', '=SUM(A1)', 'plain']]);
    expect(csv).toBe(`"a,b",'=SUM(A1),plain\r\n`);
    expect(parseCsv(csv)).toEqual([['a,b', "'=SUM(A1)", 'plain']]);
  });

  it('reads Nigerian and ISO dates, and rejects impossible ones', () => {
    expect(parseFlexibleDate('14/03/2014')).toBe('2014-03-14');
    expect(parseFlexibleDate('7.9.2026')).toBe('2026-09-07');
    expect(parseFlexibleDate('2026-09-07')).toBe('2026-09-07');
    expect(parseFlexibleDate('31/02/2020')).toBeNull();
    expect(parseFlexibleDate('March 2020')).toBeNull();
    expect(formatDmy('2026-09-07')).toBe('07/09/2026');
  });
});

describe('student import', () => {
  it('matches common header names and normalises values', () => {
    const { rows, missingColumns, unknownHeaders } = readStudentImport([
      ['Surname', 'First Name', 'Sex', 'DOB', 'Class', 'Parent Email', 'Relation', 'Favourite colour'],
      ['Okeke', 'Chidi', 'M', '14/03/2014', 'JSS 1A', 'ngozi@example.com', 'Aunt', 'Blue'],
      ['', 'Ada', 'girl', '2014/13/01', '', 'not an email', '', ''],
    ]);
    expect(missingColumns).toEqual([]);
    expect(unknownHeaders).toEqual(['Favourite colour']);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.values).toMatchObject({ last_name: 'Okeke', gender: 'male', date_of_birth: '2014-03-14', guardian_relationship: 'aunt_uncle' });
    expect(rows[1]!.line).toBe(3);
    expect(rows[1]!.errors).toEqual([
      'Last name is missing.',
      'Date of birth should look like 14/03/2014.',
      'Guardian email is not valid.',
    ]);
    expect(rows[1]!.values.gender).toBe('female');
  });

  it('reports missing required columns', () => {
    expect(readStudentImport([['Class'], ['JSS 1A']]).missingColumns).toEqual(['First name', 'Last name']);
  });

  it('offers a template that reads back cleanly with no dashes', () => {
    const template = studentImportTemplate();
    expect(template).not.toMatch(/[–—]/);
    expect(readStudentImport(parseCsv(template)).rows[0]!.errors).toEqual([]);
  });
});

describe('people helpers', () => {
  it('describes blood groups in words', () => {
    expect(bloodGroupLabel('O-')).toBe('O negative');
    expect(bloodGroupLabel('AB+')).toBe('AB positive');
  });

  it('works out age', () => {
    expect(ageFrom('2014-03-14', new Date(2026, 2, 13))).toBe(11);
    expect(ageFrom('2014-03-14', new Date(2026, 2, 14))).toBe(12);
    expect(ageFrom(null)).toBeNull();
  });

  it('refuses a birthday in the future', () => {
    const base = { firstName: 'A', middleName: '', lastName: 'B', gender: '', admissionNumber: '', admissionDate: '2026-09-07', campusId: '', classId: '', status: 'active', previousSchool: '' };
    expect(validate(studentFormSchema, { ...base, dateOfBirth: '2999-01-01' }).success).toBe(false);
    expect(validate(studentFormSchema, { ...base, dateOfBirth: '' }).success).toBe(true);
  });

  it('includes the health permissions', () => {
    expect(ALL_PERMISSION_KEYS).toContain('student_health.view');
    expect(ALL_PERMISSION_KEYS).toContain('student_health.edit');
  });
});
