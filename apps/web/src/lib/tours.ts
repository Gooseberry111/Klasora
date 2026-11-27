import {
  Baby,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  FileSpreadsheet,
  NotebookPen,
  Trophy,
  Building2,
  CircleHelp,
  GraduationCap,
  HeartHandshake,
  LayoutDashboard,
  ListChecks,
  MoonStar,
  Rocket,
  Settings2,
  UserRound,
  Users,
} from 'lucide-vue-next';
import type { AcademicVocabulary } from '@klasora/shared';
import type { TourStep } from '@/stores/tour';

export const WEB_WELCOME_TOUR = 'web_welcome_v1';

/**
 * The first run walkthrough of the web app. It visits each area in order;
 * steps for areas the person cannot open are removed automatically.
 */
export function welcomeTourSteps(words: AcademicVocabulary, schoolName: string): TourStep[] {
  return [
    {
      target: 'school-switcher',
      inSidebar: true,
      icon: Building2,
      title: 'This is your school',
      body: `You are working in ${schoolName}. If you belong to more than one school, open this menu to switch between them or register another institution.`,
    },
    {
      target: 'nav-dashboard',
      inSidebar: true,
      icon: LayoutDashboard,
      title: 'Your dashboard',
      body: 'Start every day here. It shows the current session, key figures for your school and anything that needs your attention.',
    },
    {
      target: 'nav-children',
      inSidebar: true,
      icon: Baby,
      title: 'Your children',
      body: 'Every child linked to you is here. Open a profile to see their class, guardians and, as your school turns them on, attendance and results.',
    },
    {
      target: 'nav-my-results',
      inSidebar: true,
      icon: Trophy,
      title: 'Your results',
      body: 'See your published results and download your report card each term.',
    },
    {
      target: 'nav-setup',
      inSidebar: true,
      icon: ListChecks,
      title: 'Setup guide',
      body: `New schools begin here. Follow the checklist to add your logo, academic calendar, ${words.groups.toLowerCase()}, ${words.subjects.toLowerCase()} and staff. Progress is saved as you go.`,
    },
    {
      target: 'nav-students',
      inSidebar: true,
      icon: GraduationCap,
      title: 'Students',
      body: `Register students one by one or import a spreadsheet, place them in ${words.groups.toLowerCase()}, and keep guardians, health details and documents on each profile.`,
    },
    {
      target: 'nav-guardians',
      inSidebar: true,
      icon: HeartHandshake,
      title: 'Parents and guardians',
      body: 'See every guardian and invite them to the parent portal, where they follow only their own children.',
    },
    {
      target: 'nav-section-school-management',
      inSidebar: true,
      icon: Users,
      title: 'School management',
      body: `Invite and manage staff, create ${words.groups.toLowerCase()} with their class teachers and students, and look after your campuses.`,
    },
    {
      target: 'nav-section-academics',
      inSidebar: true,
      icon: GraduationCap,
      title: 'Academics',
      body: `Plan sessions and ${words.periods.toLowerCase()}, organise ${words.units.toLowerCase()} and keep your list of ${words.subjects.toLowerCase()} up to date.`,
    },
    {
      target: 'nav-timetable',
      inSidebar: true,
      icon: CalendarClock,
      title: 'Timetable',
      body: 'The weekly timetable for every class. Klasora warns you about clashes for classes, teachers and rooms.',
    },
    {
      target: 'nav-attendance',
      inSidebar: true,
      icon: CalendarCheck,
      title: 'Attendance',
      body: 'Take the register in a few taps each morning, then follow daily, weekly and monthly attendance.',
    },
    {
      target: 'nav-assignments',
      inSidebar: true,
      icon: NotebookPen,
      title: 'Assignments',
      body: 'Teachers set work with attachments and deadlines; students hand it in online and get feedback.',
    },
    {
      target: 'nav-assessments',
      inSidebar: true,
      icon: ClipboardList,
      title: 'Assessments',
      body: 'Record continuous assessments and examinations. The principal reviews and publishes them before families see anything.',
    },
    {
      target: 'nav-results',
      inSidebar: true,
      icon: FileSpreadsheet,
      title: 'Results and report cards',
      body: 'Weighted totals and grades on your own grading scale, and report cards to comment on, publish and download as PDF.',
    },
    {
      target: 'nav-section-system',
      inSidebar: true,
      icon: Settings2,
      title: 'System',
      body: 'Control who can do what with user roles, edit your school profile and logo, and manage your own account.',
    },
    {
      target: 'dashboard-setup',
      icon: Rocket,
      title: 'Track your progress',
      body: 'This card shows how much of your setup is done and what to do next. Click any step to jump straight to it.',
    },
    {
      target: 'theme-toggle',
      icon: MoonStar,
      title: 'Light or dark',
      body: 'Prefer a darker screen in the evening? Switch themes here. Klasora remembers your choice on every device.',
    },
    {
      target: 'account-menu',
      icon: UserRound,
      title: 'Your account',
      body: 'Update your name, phone number and password, or sign out.',
    },
    {
      target: 'help-button',
      icon: CircleHelp,
      title: 'Help is always here',
      body: 'Want to see this tour again? Click Help at any time. You are ready to go.',
    },
  ];
}
