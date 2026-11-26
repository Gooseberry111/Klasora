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
