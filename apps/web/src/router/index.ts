import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';
import type { PermissionKey } from '@klasora/shared';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { readPendingRegistration } from '@/services/registration';

declare module 'vue-router' {
  interface RouteMeta {
    /** Only for signed-out visitors (login, register). */
    guestOnly?: boolean;
    /** Requires a session. */
    requiresAuth?: boolean;
    /** Requires at least one of these permissions in the active school. */
    anyOf?: PermissionKey[];
    /** Sidebar item to highlight for nested pages. */
    navParent?: string;
    title?: string;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, _from, saved) => saved ?? (to.hash ? { el: to.hash } : { top: 0 }),
  routes: [
    { path: '/', name: 'home', redirect: { name: 'schools' } },

    // Authentication
    { path: '/login', name: 'login', component: () => import('@/views/auth/LoginView.vue'), meta: { guestOnly: true, title: 'Sign in' } },
    { path: '/register', name: 'register', component: () => import('@/views/auth/RegisterView.vue'), meta: { title: 'Register your institution' } },
    { path: '/forgot-password', name: 'forgot-password', component: () => import('@/views/auth/ForgotPasswordView.vue'), meta: { guestOnly: true, title: 'Reset your password' } },
    { path: '/reset-password', name: 'reset-password', component: () => import('@/views/auth/ResetPasswordView.vue'), meta: { title: 'Choose a new password' } },
    { path: '/verify-email', name: 'verify-email', component: () => import('@/views/auth/VerifyEmailView.vue'), meta: { title: 'Verify your email' } },
    { path: '/auth/callback', name: 'auth-callback', component: () => import('@/views/auth/AuthCallbackView.vue'), meta: { title: 'Signing you in' } },
    { path: '/invite/:token', name: 'invitation', component: () => import('@/views/auth/AcceptInvitationView.vue'), meta: { title: 'Invitation' } },
    { path: '/onboarding/finish', name: 'finish-registration', component: () => import('@/views/auth/FinishRegistrationView.vue'), meta: { requiresAuth: true, title: 'Setting up your school' } },

    // Workspace selection
    { path: '/schools', name: 'schools', component: () => import('@/views/SchoolPickerView.vue'), meta: { requiresAuth: true, title: 'Your schools' } },

    // School workspace
    {
      path: '/s/:slug',
      component: () => import('@/layouts/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'dashboard', component: () => import('@/views/app/DashboardView.vue'), meta: { title: 'Dashboard' } },
        { path: 'setup', name: 'setup', component: () => import('@/views/app/SetupGuideView.vue'), meta: { anyOf: ['settings.edit', 'academics.create', 'staff.create'], title: 'Setup guide' } },
        { path: 'students', name: 'students', component: () => import('@/views/app/students/StudentsView.vue'), meta: { anyOf: ['students.view'], title: 'Students' } },
        { path: 'students/new', name: 'student-new', component: () => import('@/views/app/students/StudentFormView.vue'), meta: { anyOf: ['students.create'], navParent: 'students', title: 'Register a student' } },
        { path: 'students/import', name: 'student-import', component: () => import('@/views/app/students/StudentImportView.vue'), meta: { anyOf: ['students.create'], navParent: 'students', title: 'Import students' } },
        { path: 'students/:studentId', name: 'student-detail', component: () => import('@/views/app/students/StudentProfileView.vue'), meta: { navParent: 'students', title: 'Student' } },
        { path: 'students/:studentId/edit', name: 'student-edit', component: () => import('@/views/app/students/StudentFormView.vue'), meta: { anyOf: ['students.edit'], navParent: 'students', title: 'Edit student' } },
        { path: 'guardians', name: 'guardians', component: () => import('@/views/app/students/GuardiansView.vue'), meta: { anyOf: ['students.view'], title: 'Parents and guardians' } },
        { path: 'children', name: 'children', component: () => import('@/views/app/students/MyChildrenView.vue'), meta: { title: 'My children' } },
        { path: 'timetable', name: 'timetable', component: () => import('@/views/app/academics/TimetableView.vue'), meta: { title: 'Timetable' } },
        { path: 'attendance', name: 'attendance', component: () => import('@/views/app/academics/AttendanceView.vue'), meta: { anyOf: ['attendance.view'], title: 'Attendance' } },
        { path: 'assignments', name: 'assignments', component: () => import('@/views/app/academics/AssignmentsView.vue'), meta: { title: 'Assignments' } },
        { path: 'assignments/:assignmentId', name: 'assignment-detail', component: () => import('@/views/app/academics/AssignmentDetailView.vue'), meta: { navParent: 'assignments', title: 'Assignment' } },
        { path: 'assessments', name: 'assessments', component: () => import('@/views/app/academics/AssessmentsView.vue'), meta: { anyOf: ['examinations.view'], title: 'Assessments' } },
        { path: 'assessments/:assessmentId', name: 'assessment-detail', component: () => import('@/views/app/academics/AssessmentDetailView.vue'), meta: { anyOf: ['examinations.view'], navParent: 'assessments', title: 'Assessment' } },
        { path: 'results', name: 'results', component: () => import('@/views/app/academics/ResultsView.vue'), meta: { anyOf: ['examinations.view'], title: 'Results and report cards' } },
        { path: 'report-cards/:reportCardId', name: 'report-card', component: () => import('@/views/app/academics/ReportCardView.vue'), meta: { navParent: 'results', title: 'Report card' } },
        { path: 'my-results', name: 'my-results', component: () => import('@/views/app/academics/MyResultsView.vue'), meta: { title: 'My results' } },
        { path: 'announcements', name: 'announcements', component: () => import('@/views/app/communication/AnnouncementsView.vue'), meta: { title: 'Announcements' } },
        { path: 'announcements/:announcementId', name: 'announcement-detail', component: () => import('@/views/app/communication/AnnouncementDetailView.vue'), meta: { navParent: 'announcements', title: 'Announcement' } },
        { path: 'messages', name: 'messages', component: () => import('@/views/app/communication/MessagesView.vue'), meta: { title: 'Messages' } },
        { path: 'notifications', name: 'notifications', component: () => import('@/views/app/communication/NotificationsView.vue'), meta: { title: 'Notifications' } },
        { path: 'staff/:userId', name: 'staff-detail', component: () => import('@/views/app/StaffProfileView.vue'), meta: { anyOf: ['staff.view'], navParent: 'staff', title: 'Staff profile' } },
        { path: 'staff', name: 'staff', component: () => import('@/views/app/StaffView.vue'), meta: { anyOf: ['staff.view'], title: 'Teachers and staff' } },
        { path: 'classes', name: 'classes', component: () => import('@/views/app/ClassesView.vue'), meta: { anyOf: ['academics.view'], title: 'Classes' } },
        { path: 'classes/:classId', name: 'class-detail', component: () => import('@/views/app/ClassDetailView.vue'), meta: { anyOf: ['academics.view'], navParent: 'classes', title: 'Class' } },
        { path: 'campuses', name: 'campuses', component: () => import('@/views/app/CampusesView.vue'), meta: { anyOf: ['settings.view'], title: 'Campuses' } },
        { path: 'academic-sessions', name: 'academic-calendar', component: () => import('@/views/app/AcademicCalendarView.vue'), meta: { anyOf: ['academics.view'], title: 'Academic sessions' } },
        { path: 'departments', name: 'departments', component: () => import('@/views/app/DepartmentsView.vue'), meta: { anyOf: ['academics.view'], title: 'Departments' } },
        { path: 'subjects', name: 'subjects', component: () => import('@/views/app/SubjectsView.vue'), meta: { anyOf: ['academics.view'], title: 'Subjects' } },
        { path: 'settings', name: 'settings', component: () => import('@/views/app/SchoolSettingsView.vue'), meta: { anyOf: ['settings.view'], title: 'School settings' } },
        { path: 'roles', name: 'roles', component: () => import('@/views/app/RolesView.vue'), meta: { anyOf: ['roles.view'], title: 'User roles' } },
        { path: 'roles/:roleId', name: 'role-detail', component: () => import('@/views/app/RoleDetailView.vue'), meta: { anyOf: ['roles.view'], navParent: 'roles', title: 'Role' } },
        { path: 'account', name: 'account', component: () => import('@/views/app/AccountView.vue'), meta: { title: 'My account' } },
        { path: 'forbidden', name: 'forbidden', component: () => import('@/views/app/ForbiddenView.vue'), meta: { title: 'No access' } },
      ],
    },

    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue'), meta: { title: 'Page not found' } },
  ],
});

async function guard(to: RouteLocationNormalized) {
  const auth = useAuthStore();
  const workspace = useWorkspaceStore();
  await auth.init();

  const requiresAuth = to.matched.some((r) => r.meta.requiresAuth);

  if (requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'schools' };
  }

  // A school registered before email verification is finished on first sign-in.
  if (
    auth.isAuthenticated &&
    to.name !== 'finish-registration' &&
    to.name !== 'invitation' &&
    readPendingRegistration(auth.user?.user_metadata)
  ) {
    return { name: 'finish-registration' };
  }

  const slug = to.params.slug;
  if (typeof slug === 'string' && slug) {
    const isMember = await workspace.activate(slug);
    if (!isMember) return { name: 'schools', query: { notice: 'no-access' } };

    const required = to.meta.anyOf;
    if (required?.length && !workspace.canAny(required)) {
      return { name: 'forbidden', params: { slug } };
    }
  }
  return true;
}

router.beforeEach(async (to) => {
  try {
    return await guard(to);
  } catch {
    // Network/database failure while resolving access: fail closed.
    return to.name === 'schools' ? true : { name: 'schools', query: { notice: 'load-failed' } };
  }
});

router.afterEach((to) => {
  const workspace = useWorkspaceStore();
  const parts = [to.meta.title, workspace.currentSchool && to.params.slug ? workspace.currentSchool.name : null, 'Klasora'];
  document.title = parts.filter(Boolean).join(' · ');
});
