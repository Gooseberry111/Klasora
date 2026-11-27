import { describe, expect, it } from 'vitest';
import {
  academicVocabulary,
  academicYearName,
  academicYearSchema,
  buildSetupSteps,
  classPresets,
  classSchema,
  codeSchema,
  setupCompletion,
  subjectPresets,
  validate,
  type SetupProgress,
} from '../src';

const empty: SetupProgress = {
  campuses: 1,
  academic_years: 0,
  has_current_year: false,
  terms: 0,
  has_current_term: false,
  departments: 0,
  classes: 0,
  subjects: 0,
  class_subjects: 0,
  members: 1,
  pending_invitations: 0,
  has_logo: false,
  setup_completed_at: null,
};

describe('academic vocabulary', () => {
  it('speaks the language of each structure', () => {
    expect(academicVocabulary('classes_grades')).toMatchObject({ period: 'Term', group: 'Class', subject: 'Subject' });
    expect(academicVocabulary('sectioned_school')).toMatchObject({ unit: 'Section', unitKind: 'section' });
    expect(academicVocabulary('faculties_departments')).toMatchObject({ period: 'Semester', subject: 'Course', usesFaculties: true });
    expect(academicVocabulary('programmes_semesters').unit).toBe('Programme');
  });

  it('suggests three terms or two semesters', () => {
    expect(academicVocabulary('classes_grades').periodNames).toHaveLength(3);
    expect(academicVocabulary('faculties_departments').periodNames).toHaveLength(2);
  });

  it('never uses a dash in any label', () => {
    for (const structure of ['classes_grades', 'sectioned_school', 'faculties_departments', 'programmes_semesters'] as const) {
      const words = academicVocabulary(structure);
      for (const value of Object.values(words).flat()) {
        if (typeof value === 'string') expect(value).not.toMatch(/[-–—]/);
      }
    }
  });
});

describe('presets', () => {
  it('offers Nigerian class levels for each institution type', () => {
    expect(classPresets('secondary').map((p) => p.level)).toEqual(['JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3']);
    expect(classPresets('primary_secondary').length).toBeGreaterThan(15);
    expect(classPresets('university')[0]?.level).toBe('100 Level');
  });

  it('keeps preset levels in ascending order', () => {
    const orders = classPresets('primary_secondary').map((p) => p.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('gives each subject preset a unique valid code', () => {
    const presets = subjectPresets('primary_secondary');
    expect(new Set(presets.map((p) => p.code)).size).toBe(presets.length);
    for (const p of presets) expect(codeSchema.safeParse(p.code).success).toBe(true);
    expect(subjectPresets('university')).toEqual([]);
  });

  it('names sessions with a slash', () => {
    expect(academicYearName(new Date(2026, 8, 7))).toBe('2026/2027');
    expect(academicYearName(new Date(2027, 2, 1))).toBe('2026/2027');
  });
});

describe('setup guide', () => {
  const words = academicVocabulary('classes_grades');

  it('starts with nothing required done', () => {
    const steps = buildSetupSteps(empty, words);
    expect(setupCompletion(steps)).toBe(0);
    expect(steps.find((s) => s.key === 'campuses')?.done).toBe(true);
  });

  it('reaches 100% when every required step is done', () => {
    const done = buildSetupSteps(
      { ...empty, has_logo: true, has_current_year: true, terms: 3, classes: 6, subjects: 10, pending_invitations: 2 },
      words,
    );
    expect(setupCompletion(done)).toBe(100);
  });

  it('uses the school vocabulary in titles', () => {
    const steps = buildSetupSteps(empty, academicVocabulary('faculties_departments'));
    expect(steps.find((s) => s.key === 'subjects')?.title).toBe('Add courses');
    expect(steps.find((s) => s.key === 'calendar')?.title).toContain('semesters');
  });
});

describe('setup schemas', () => {
  it('rejects a session that ends before it starts', () => {
    const result = validate(academicYearSchema, { name: '2026/2027', startDate: '2027-07-01', endDate: '2026-09-01', status: 'planned' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.endDate).toMatch(/after the start date/);
  });

  it('normalises codes and checks capacity', () => {
    expect(codeSchema.parse(' mth ')).toBe('MTH');
    const base = {
      name: 'JSS 1A',
      level: 'JSS 1',
      levelOrder: 21,
      campusId: 'x',
      departmentId: null,
      academicYearId: null,
      classTeacherMembershipId: null,
      status: 'active',
    };
    expect(validate(classSchema, { ...base, capacity: '40' }).success).toBe(true);
    expect(validate(classSchema, { ...base, capacity: '0' }).success).toBe(false);
    expect(validate(classSchema, { ...base, capacity: '' }).success).toBe(true);
  });
});
