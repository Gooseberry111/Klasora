/**
 * The school setup guide: the steps a new institution works through, in
 * order, with completion worked out from real data (get_setup_progress).
 * Shared so the web and mobile apps show the same checklist.
 */
import type { PermissionKey } from './permissions';
import type { AcademicVocabulary } from './vocabulary';

export interface SetupProgress {
  campuses: number;
  academic_years: number;
  has_current_year: boolean;
  terms: number;
  has_current_term: boolean;
  departments: number;
  classes: number;
  subjects: number;
  class_subjects: number;
  members: number;
  pending_invitations: number;
  has_logo: boolean;
  setup_completed_at: string | null;
}

export type SetupStepKey =
  | 'profile'
  | 'campuses'
  | 'calendar'
  | 'structure'
  | 'classes'
  | 'subjects'
  | 'staff';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  description: string;
  /** Route name in the web app. */
  routeName: string;
  done: boolean;
  /** Optional steps do not hold back completion. */
  optional: boolean;
  /** People need one of these to work on the step. */
  anyOf: PermissionKey[];
  /** Short status such as "3 classes". */
  summary: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildSetupSteps(progress: SetupProgress, words: AcademicVocabulary): SetupStep[] {
  return [
    {
      key: 'profile',
      title: 'Complete your school profile',
      description: 'Add your logo, motto and contact details so they appear across Klasora.',
      routeName: 'settings',
      done: progress.has_logo,
      optional: false,
      anyOf: ['settings.edit'],
      summary: progress.has_logo ? 'Logo added' : 'No logo yet',
    },
    {
      key: 'campuses',
      title: 'Review your campuses',
      description: 'Your main campus is ready. Add other locations if your school has more than one.',
      routeName: 'campuses',
      done: progress.campuses > 0,
      optional: true,
      anyOf: ['settings.edit'],
      summary: plural(progress.campuses, 'campus', 'campuses'),
    },
    {
      key: 'calendar',
      title: `Set up the academic year and ${words.periods.toLowerCase()}`,
      description: `Create this session, add its ${words.periods.toLowerCase()} and mark the current one.`,
      routeName: 'academic-calendar',
      done: progress.has_current_year && progress.terms > 0,
      optional: false,
      anyOf: ['academics.create', 'academics.edit'],
      summary: progress.has_current_year
        ? plural(progress.terms, words.period.toLowerCase(), words.periods.toLowerCase())
        : 'No current session',
    },
    {
      key: 'structure',
      title: `Add your ${words.units.toLowerCase()}`,
      description: `Group classes and ${words.subjects.toLowerCase()} by ${words.unit.toLowerCase()}. You can skip this for a small school.`,
      routeName: 'departments',
      done: progress.departments > 0,
      optional: true,
      anyOf: ['academics.create'],
      summary: plural(progress.departments, words.unit.toLowerCase(), words.units.toLowerCase()),
    },
    {
      key: 'classes',
      title: `Create your ${words.groups.toLowerCase()}`,
      description: `Add every ${words.group.toLowerCase()} with its campus, capacity and class teacher.`,
      routeName: 'classes',
      done: progress.classes > 0,
      optional: false,
      anyOf: ['academics.create'],
      summary: plural(progress.classes, words.group.toLowerCase(), words.groups.toLowerCase()),
    },
    {
      key: 'subjects',
      title: `Add ${words.subjects.toLowerCase()}`,
      description: `List what you teach, then assign ${words.subjects.toLowerCase()} to each ${words.group.toLowerCase()}.`,
      routeName: 'subjects',
      done: progress.subjects > 0,
      optional: false,
      anyOf: ['academics.create'],
      summary: plural(progress.subjects, words.subject.toLowerCase(), words.subjects.toLowerCase()),
    },
    {
      key: 'staff',
      title: 'Invite your staff',
      description: 'Send invitations to teachers, administrators and your bursar.',
      routeName: 'staff',
      done: progress.members > 1 || progress.pending_invitations > 0,
      optional: false,
      anyOf: ['staff.create'],
      summary:
        progress.pending_invitations > 0
          ? `${plural(progress.members, 'member', 'members')}, ${progress.pending_invitations} invited`
          : plural(progress.members, 'member', 'members'),
    },
  ];
}

/** Percentage of required steps completed, from 0 to 100. */
export function setupCompletion(steps: SetupStep[]): number {
  const required = steps.filter((s) => !s.optional);
  if (required.length === 0) return 100;
  return Math.round((required.filter((s) => s.done).length / required.length) * 100);
}
