/**
 * Words and starter presets that adapt to how an institution is organised.
 * A primary school sees "Terms", "Classes" and "Subjects"; a university sees
 * "Semesters", "Levels", "Courses" and "Faculties". Clients never hard code
 * these labels.
 */
import type { AcademicStructure, InstitutionType } from './constants';

export type DepartmentKind = 'department' | 'section' | 'faculty';

export interface AcademicVocabulary {
  /** "Term" or "Semester". */
  period: string;
  periods: string;
  /** "Class", "Level" and so on. */
  group: string;
  groups: string;
  /** "Subject" or "Course". */
  subject: string;
  subjects: string;
  /** The kind of unit the structure is organised into. */
  unitKind: DepartmentKind;
  unit: string;
  units: string;
  /** Faculties appear as a parent level above departments. */
  usesFaculties: boolean;
  /** Suggested period names, in order. */
  periodNames: string[];
}

export function academicVocabulary(structure: AcademicStructure): AcademicVocabulary {
  switch (structure) {
    case 'sectioned_school':
      return {
        period: 'Term', periods: 'Terms',
        group: 'Class', groups: 'Classes',
        subject: 'Subject', subjects: 'Subjects',
        unitKind: 'section', unit: 'Section', units: 'Sections',
        usesFaculties: false,
        periodNames: ['First Term', 'Second Term', 'Third Term'],
      };
    case 'faculties_departments':
      return {
        period: 'Semester', periods: 'Semesters',
        group: 'Level', groups: 'Levels',
        subject: 'Course', subjects: 'Courses',
        unitKind: 'department', unit: 'Department', units: 'Departments',
        usesFaculties: true,
        periodNames: ['First Semester', 'Second Semester'],
      };
    case 'programmes_semesters':
      return {
        period: 'Semester', periods: 'Semesters',
        group: 'Class', groups: 'Classes',
        subject: 'Course', subjects: 'Courses',
        unitKind: 'department', unit: 'Programme', units: 'Programmes',
        usesFaculties: false,
        periodNames: ['First Semester', 'Second Semester'],
      };
    case 'classes_grades':
    default:
      return {
        period: 'Term', periods: 'Terms',
        group: 'Class', groups: 'Classes',
        subject: 'Subject', subjects: 'Subjects',
        unitKind: 'department', unit: 'Department', units: 'Departments',
        usesFaculties: false,
        periodNames: ['First Term', 'Second Term', 'Third Term'],
      };
  }
}

export const DEPARTMENT_KIND_LABELS: Record<DepartmentKind, string> = {
  department: 'Department',
  section: 'Section',
  faculty: 'Faculty',
};

export interface ClassPreset {
  /** Group heading shown in the picker, such as "Junior secondary". */
  group: string;
  /** Level name, such as "JSS 1". */
  level: string;
  /** Sort position across the whole school. */
  order: number;
}

const NURSERY: ClassPreset[] = [
  { group: 'Nursery', level: 'Creche', order: 1 },
  { group: 'Nursery', level: 'Pre Nursery', order: 2 },
  { group: 'Nursery', level: 'Nursery 1', order: 3 },
  { group: 'Nursery', level: 'Nursery 2', order: 4 },
  { group: 'Nursery', level: 'Kindergarten', order: 5 },
];
const PRIMARY: ClassPreset[] = [1, 2, 3, 4, 5, 6].map((n) => ({ group: 'Primary', level: `Primary ${n}`, order: 10 + n }));
const JUNIOR: ClassPreset[] = [1, 2, 3].map((n) => ({ group: 'Junior secondary', level: `JSS ${n}`, order: 20 + n }));
const SENIOR: ClassPreset[] = [1, 2, 3].map((n) => ({ group: 'Senior secondary', level: `SS ${n}`, order: 30 + n }));
const UNIVERSITY: ClassPreset[] = [100, 200, 300, 400, 500].map((n, i) => ({
  group: 'Undergraduate',
  level: `${n} Level`,
  order: 40 + i,
}));
const COLLEGE: ClassPreset[] = [
  { group: 'National Diploma', level: 'ND 1', order: 41 },
  { group: 'National Diploma', level: 'ND 2', order: 42 },
  { group: 'Higher National Diploma', level: 'HND 1', order: 43 },
  { group: 'Higher National Diploma', level: 'HND 2', order: 44 },
];

/** Class levels commonly used in Nigerian institutions of each type. */
export function classPresets(type: InstitutionType): ClassPreset[] {
  switch (type) {
    case 'nursery':
      return NURSERY;
    case 'primary':
      return [...NURSERY, ...PRIMARY];
    case 'secondary':
      return [...JUNIOR, ...SENIOR];
    case 'primary_secondary':
      return [...NURSERY, ...PRIMARY, ...JUNIOR, ...SENIOR];
    case 'university':
      return UNIVERSITY;
    case 'college':
    case 'vocational':
      return COLLEGE;
    default:
      return [...PRIMARY, ...JUNIOR, ...SENIOR];
  }
}

export interface SubjectPreset {
  name: string;
  code: string;
}

const BASIC_SUBJECTS: SubjectPreset[] = [
  { name: 'English Language', code: 'ENG' },
  { name: 'Mathematics', code: 'MTH' },
  { name: 'Basic Science', code: 'BSC' },
  { name: 'Basic Technology', code: 'BTE' },
  { name: 'Social Studies', code: 'SST' },
  { name: 'Civic Education', code: 'CVE' },
  { name: 'Christian Religious Studies', code: 'CRS' },
  { name: 'Islamic Religious Studies', code: 'IRS' },
  { name: 'Computer Studies', code: 'CMP' },
  { name: 'Cultural and Creative Arts', code: 'CCA' },
  { name: 'Physical and Health Education', code: 'PHE' },
  { name: 'French', code: 'FRE' },
  { name: 'Yoruba', code: 'YOR' },
  { name: 'Igbo', code: 'IGB' },
  { name: 'Hausa', code: 'HAU' },
];
const SENIOR_SUBJECTS: SubjectPreset[] = [
  { name: 'Physics', code: 'PHY' },
  { name: 'Chemistry', code: 'CHM' },
  { name: 'Biology', code: 'BIO' },
  { name: 'Further Mathematics', code: 'FMT' },
  { name: 'Economics', code: 'ECO' },
  { name: 'Government', code: 'GOV' },
  { name: 'Literature in English', code: 'LIT' },
  { name: 'Geography', code: 'GEO' },
  { name: 'Financial Accounting', code: 'ACC' },
  { name: 'Commerce', code: 'COM' },
  { name: 'Agricultural Science', code: 'AGR' },
  { name: 'Technical Drawing', code: 'TDR' },
];
const EARLY_YEARS: SubjectPreset[] = [
  { name: 'Literacy', code: 'LIT' },
  { name: 'Numeracy', code: 'NUM' },
  { name: 'Phonics', code: 'PHO' },
  { name: 'Rhymes and Songs', code: 'RHY' },
  { name: 'Creative Arts', code: 'ART' },
  { name: 'Social Habits', code: 'SOC' },
];

/** Common subjects for each institution type. Universities define their own courses. */
export function subjectPresets(type: InstitutionType): SubjectPreset[] {
  switch (type) {
    case 'nursery':
      return EARLY_YEARS;
    case 'primary':
      return BASIC_SUBJECTS;
    case 'secondary':
    case 'primary_secondary':
      return [...BASIC_SUBJECTS, ...SENIOR_SUBJECTS];
    default:
      return [];
  }
}

/** Suggested sections for a sectioned school. */
export const SECTION_PRESETS = ['Nursery', 'Primary', 'Junior Secondary', 'Senior Secondary'];

/**
 * The academic year name for a start date, in the Nigerian style "2026/2027".
 * A slash, never a dash.
 */
export function academicYearName(start: Date): string {
  const year = start.getMonth() >= 7 ? start.getFullYear() : start.getFullYear() - 1;
  return `${year}/${year + 1}`;
}
