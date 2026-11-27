import type { Component } from 'vue';
import {
  Baby,
  ChartColumnBig,
  FileText,
  Tags,
  Wallet,
  Bell,
  Megaphone,
  MessagesSquare,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  FileSpreadsheet,
  NotebookPen,
  Trophy,
  BookOpen,
  GraduationCap,
  HeartHandshake,
  Building2,
  CalendarRange,
  LayoutDashboard,
  ListChecks,
  Network,
  School,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-vue-next';
import type { AcademicVocabulary, PermissionKey } from '@klasora/shared';

export interface NavItem {
  label: string;
  /** Overrides `label` with wording that suits the school (Courses instead of Subjects). */
  vocab?: (words: AcademicVocabulary) => string;
  routeName: string;
  icon: Component;
  /** The user needs at least one of these permissions to see the item. Omit for everyone. */
  anyOf?: PermissionKey[];
  /** Shown only to people linked to children as a guardian. */
  guardiansOnly?: boolean;
  /** Also shown to these people, who hold no school wide permissions. */
  alsoFor?: ('guardian' | 'student')[];
}

export interface NavigationContext {
  isGuardian?: boolean;
  isStudent?: boolean;
}

export interface NavSection {
  id: string;
  heading: string;
  items: NavItem[];
}

/**
 * Sidebar definition. Only modules that exist are listed; later phases add
 * Students, Finance and Communication here, so there are never links to
 * unfinished screens.
 */
export const NAVIGATION: NavSection[] = [
  {
    id: 'overview',
    heading: 'Overview',
    items: [
      { label: 'Dashboard', routeName: 'dashboard', icon: LayoutDashboard },
      { label: 'My children', routeName: 'children', icon: Baby, guardiansOnly: true },
      { label: 'Fees', routeName: 'fees', icon: Wallet, guardiansOnly: true },
      { label: 'My results', routeName: 'my-results', icon: Trophy, alsoFor: ['student'], anyOf: [] },
      {
        label: 'Setup guide',
        routeName: 'setup',
        icon: ListChecks,
        anyOf: ['settings.edit', 'academics.create', 'staff.create'],
      },
    ],
  },
  {
    id: 'school-management',
    heading: 'School management',
    items: [
      { label: 'Students', routeName: 'students', icon: GraduationCap, anyOf: ['students.view'] },
      { label: 'Parents and guardians', routeName: 'guardians', icon: HeartHandshake, anyOf: ['students.view'] },
      { label: 'Teachers and staff', routeName: 'staff', icon: Users, anyOf: ['staff.view'] },
      { label: 'Classes', vocab: (w) => w.groups, routeName: 'classes', icon: School, anyOf: ['academics.view'] },
      { label: 'Campuses', routeName: 'campuses', icon: Building2, anyOf: ['settings.view'] },
    ],
  },
  {
    id: 'academics',
    heading: 'Academics',
    items: [
      { label: 'Timetable', routeName: 'timetable', icon: CalendarClock, anyOf: ['academics.view'], alsoFor: ['student', 'guardian'] },
      { label: 'Attendance', routeName: 'attendance', icon: CalendarCheck, anyOf: ['attendance.view'] },
      { label: 'Assignments', routeName: 'assignments', icon: NotebookPen, anyOf: ['assignments.view'], alsoFor: ['student'] },
      { label: 'Assessments', routeName: 'assessments', icon: ClipboardList, anyOf: ['examinations.view'] },
      { label: 'Results and report cards', routeName: 'results', icon: FileSpreadsheet, anyOf: ['examinations.view'] },
      { label: 'Academic sessions', routeName: 'academic-calendar', icon: CalendarRange, anyOf: ['academics.view'] },
      {
        label: 'Departments',
        vocab: (w) => (w.usesFaculties ? 'Faculties and departments' : w.units),
        routeName: 'departments',
        icon: Network,
        anyOf: ['academics.view'],
      },
      { label: 'Subjects', vocab: (w) => w.subjects, routeName: 'subjects', icon: BookOpen, anyOf: ['academics.view'] },
    ],
  },
  {
    id: 'communication',
    heading: 'Communication',
    items: [
      { label: 'Announcements', routeName: 'announcements', icon: Megaphone },
      { label: 'Messages', routeName: 'messages', icon: MessagesSquare },
      { label: 'Notifications', routeName: 'notifications', icon: Bell },
    ],
  },
  {
    id: 'finance',
    heading: 'Finance',
    items: [
      { label: 'Fee structures', routeName: 'fee-structures', icon: Tags, anyOf: ['finance.view'] },
      { label: 'Invoices', routeName: 'invoices', icon: FileText, anyOf: ['finance.view'] },
      { label: 'Payments', routeName: 'payments', icon: Wallet, anyOf: ['finance.view'] },
      { label: 'Financial reports', routeName: 'finance', icon: ChartColumnBig, anyOf: ['finance.view'] },
    ],
  },
  {
    id: 'system',
    heading: 'System',
    items: [
      { label: 'User roles', routeName: 'roles', icon: ShieldCheck, anyOf: ['roles.view'] },
      { label: 'School settings', routeName: 'settings', icon: Settings, anyOf: ['settings.view'] },
      { label: 'My account', routeName: 'account', icon: UserRound },
    ],
  },
];

/** Filters the navigation to what the current user may open; drops empty sections. */
export function visibleNavigation(
  can: (permission: PermissionKey) => boolean,
  sections = NAVIGATION,
  words?: AcademicVocabulary,
  context: NavigationContext = {},
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => {
          if (item.guardiansOnly) return Boolean(context.isGuardian);
          const forMe = (item.alsoFor ?? []).some((who) => (who === 'guardian' ? context.isGuardian : context.isStudent));
          return forMe || !item.anyOf || (item.anyOf.length > 0 && item.anyOf.some((p) => can(p)));
        })
        .map((item) => (words && item.vocab ? { ...item, label: item.vocab(words) } : item)),
    }))
    .filter((section) => section.items.length > 0);
}
