<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { Check, ChevronsUpDown, CircleHelp, LogOut, Menu, Moon, Plus, Sun, UserRound, X } from 'lucide-vue-next';
import { INSTITUTION_TYPE_LABELS } from '@klasora/shared';
import KLogo from '@/components/ui/KLogo.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KDropdown from '@/components/ui/KDropdown.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KTour from '@/components/tour/KTour.vue';
import WelcomeModal from '@/components/tour/WelcomeModal.vue';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { useThemeStore } from '@/stores/theme';
import { useTourStore } from '@/stores/tour';
import { visibleNavigation, NAVIGATION } from '@/navigation';
import { WEB_WELCOME_TOUR, welcomeTourSteps } from '@/lib/tours';

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const theme = useThemeStore();
const tour = useTourStore();
const route = useRoute();
const router = useRouter();

const mobileNavOpen = ref(false);
watch(() => route.fullPath, () => {
  if (!tour.active) mobileNavOpen.value = false;
});

const slug = computed(() => String(route.params.slug ?? ''));
const sections = computed(() =>
  visibleNavigation((p) => workspace.can(p), NAVIGATION, workspace.words, { isGuardian: workspace.isGuardian, isStudent: workspace.isStudent }),
);
const school = computed(() => workspace.currentSchool);
const roleNames = computed(() => workspace.currentRoles.map((r) => r.name).join(', '));
const isAdmin = computed(() => workspace.canAny(['settings.edit', 'academics.create', 'staff.create']));

function isActive(routeName: string) {
  return route.matched.some((r) => r.name === routeName) || route.meta.navParent === routeName;
}

function toggleTheme() {
  const next = theme.isDark ? 'light' : 'dark';
  theme.setMode(next);
  void auth.updateProfile({ theme: next }).catch(() => undefined);
}

async function signOut() {
  await auth.signOut();
  workspace.reset();
  await router.push({ name: 'login' });
}

// ---------------------------------------------------------------------------
// First run welcome and guided tour
// ---------------------------------------------------------------------------
const welcomeOpen = ref(false);

function maybeWelcome() {
  if (auth.profile && school.value && !auth.hasCompletedTour(WEB_WELCOME_TOUR) && !tour.active) {
    welcomeOpen.value = true;
  }
}
onMounted(maybeWelcome);
watch(() => [auth.profile?.id, school.value?.id], maybeWelcome);

async function startTour() {
  welcomeOpen.value = false;
  if (route.name !== 'dashboard') await router.push({ name: 'dashboard', params: { slug: slug.value } });
  // Let the dashboard render so its cards can be highlighted.
  setTimeout(() => {
    tour.start(WEB_WELCOME_TOUR, welcomeTourSteps(workspace.words, school.value?.name ?? 'your school'), () => {
      mobileNavOpen.value = false;
      void auth.completeTour(WEB_WELCOME_TOUR);
    });
  }, 350);
}

function skipWelcome() {
  welcomeOpen.value = false;
  void auth.completeTour(WEB_WELCOME_TOUR);
}

// Sidebar steps need the drawer open on small screens.
watch(
  () => tour.current,
  (step) => {
    if (!step) return;
    const small = window.matchMedia('(max-width: 1023px)').matches;
    if (small) mobileNavOpen.value = Boolean(step.inSidebar);
  },
);
</script>

<template>
  <div class="min-h-dvh">
    <!-- Mobile scrim -->
    <Transition enter-active-class="transition-opacity duration-200" enter-from-class="opacity-0" leave-active-class="transition-opacity duration-150" leave-to-class="opacity-0">
      <div v-if="mobileNavOpen && !tour.active" class="fixed inset-0 z-30 bg-[#0b1322]/55 backdrop-blur-[1px] lg:hidden" aria-hidden="true" @click="mobileNavOpen = false" />
    </Transition>

    <!-- Sidebar -->
    <aside
      :class="[
        'k-bg-sidebar fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col overflow-hidden text-navy-ink transition-transform duration-200 lg:translate-x-0',
        mobileNavOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
      ]"
      aria-label="Main navigation"
    >
      <div class="k-dots-light pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <div class="pointer-events-none absolute -top-24 -left-20 size-72 rounded-full bg-[#2563EB]/25 blur-3xl" aria-hidden="true" />

      <div class="relative flex h-16 shrink-0 items-center justify-between px-5">
        <RouterLink :to="{ name: 'dashboard', params: { slug } }" class="rounded-md">
          <KLogo :size="30" inverted />
        </RouterLink>
        <button
          type="button"
          class="flex size-8 items-center justify-center rounded-md text-navy-muted hover:bg-white/5 hover:text-white lg:hidden"
          aria-label="Close navigation"
          @click="mobileNavOpen = false"
        >
          <X :size="18" aria-hidden="true" />
        </button>
      </div>

      <!-- School switcher -->
      <div class="relative px-3 pb-2" data-tour="school-switcher">
        <KDropdown label="Switch school" align="left" width-class="w-[248px]">
          <template #trigger="{ toggle, open, menuId }">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-left shadow-inner shadow-white/[0.02] transition-colors hover:bg-white/[0.09]"
              aria-haspopup="menu"
              :aria-expanded="open"
              :aria-controls="menuId"
              @click.stop="toggle"
            >
              <KAvatar :name="school?.name ?? 'School'" :src="school?.logo_url" :size="34" square />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13.5px] font-semibold text-white">{{ school?.name }}</span>
                <span class="block truncate text-[12px] text-navy-muted">{{ roleNames }}</span>
              </span>
              <ChevronsUpDown :size="16" class="shrink-0 text-navy-muted" aria-hidden="true" />
            </button>
          </template>
          <p class="px-2.5 pt-1.5 pb-1 text-[11.5px] font-medium tracking-wide text-ink-subtle uppercase">Your schools</p>
          <RouterLink
            v-for="s in workspace.schools"
            :key="s.id"
            :to="{ name: 'dashboard', params: { slug: s.slug } }"
            role="menuitem"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
          >
            <KAvatar :name="s.name" :src="s.logo_url" :size="28" square />
            <span class="min-w-0 flex-1">
              <span class="block truncate">{{ s.name }}</span>
              <span class="block truncate text-[12px] text-ink-muted">{{ INSTITUTION_TYPE_LABELS[s.institution_type] }}</span>
            </span>
            <Check v-if="s.id === workspace.currentSchoolId" :size="15" class="text-brand" aria-hidden="true" />
          </RouterLink>
          <div class="my-1.5 border-t border-line" />
          <RouterLink
            :to="{ name: 'register' }"
            role="menuitem"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
          >
            <Plus :size="16" class="text-ink-muted" aria-hidden="true" />
            Register another institution
          </RouterLink>
        </KDropdown>
      </div>

      <nav class="relative min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <div v-for="section in sections" :key="section.id" class="mt-5 first:mt-3" :data-tour="`nav-section-${section.id}`">
          <p class="px-3 pb-2 text-[10.5px] font-semibold tracking-[0.12em] text-navy-muted/90 uppercase">{{ section.heading }}</p>
          <ul class="space-y-0.5">
            <li v-for="item in section.items" :key="item.routeName">
              <RouterLink
                :to="{ name: item.routeName, params: { slug } }"
                :data-tour="`nav-${item.routeName}`"
                :class="[
                  'group relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-all duration-150',
                  isActive(item.routeName)
                    ? 'bg-gradient-to-r from-[#2563EB]/35 to-[#2563EB]/10 text-white shadow-[inset_0_0_0_1px_rgb(96_165_250_/_0.22)]'
                    : 'text-navy-ink hover:bg-white/[0.06] hover:text-white',
                ]"
                :aria-current="isActive(item.routeName) ? 'page' : undefined"
              >
                <span
                  v-if="isActive(item.routeName)"
                  class="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-[#60A5FA] shadow-[0_0_10px_rgb(96_165_250_/_0.9)]"
                  aria-hidden="true"
                />
                <component
                  :is="item.icon"
                  :size="18"
                  :class="isActive(item.routeName) ? 'text-[#93C5FD]' : 'text-navy-muted transition-colors group-hover:text-navy-ink'"
                  aria-hidden="true"
                />
                {{ item.label }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </nav>

      <div class="relative m-3 hidden rounded-xl border border-white/10 bg-white/[0.04] p-3.5 [@media(min-height:820px)]:block">
        <p class="text-[12.5px] font-semibold text-white">Education, connected.</p>
        <p class="mt-0.5 text-[12px] text-navy-muted">Need a hand? Replay the tour from Help at any time.</p>
      </div>
    </aside>

    <!-- Main column -->
    <div class="flex min-h-dvh flex-col lg:pl-[272px]">
      <header class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line/80 bg-surface/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink lg:hidden"
          aria-label="Open navigation"
          :aria-expanded="mobileNavOpen"
          @click="mobileNavOpen = true"
        >
          <Menu :size="20" aria-hidden="true" />
        </button>
        <div class="flex min-w-0 items-center gap-2.5 lg:hidden">
          <KAvatar :name="school?.name ?? 'School'" :src="school?.logo_url" :size="26" square />
          <span class="truncate text-sm font-semibold">{{ school?.name }}</span>
        </div>
        <p class="hidden truncate text-[13px] text-ink-muted lg:block">
          <span class="font-medium text-ink">{{ school?.name }}</span>
          <span v-if="route.meta.title && route.name !== 'dashboard'"> / {{ route.meta.title }}</span>
        </p>

        <div class="ml-auto flex items-center gap-1">
          <button
            type="button"
            data-tour="help-button"
            class="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
            @click="startTour"
          >
            <CircleHelp :size="18" aria-hidden="true" />
            <span class="hidden sm:inline">Help</span>
          </button>
          <button
            type="button"
            data-tour="theme-toggle"
            class="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
            :aria-label="theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleTheme"
          >
            <Sun v-if="theme.isDark" :size="18" aria-hidden="true" />
            <Moon v-else :size="18" aria-hidden="true" />
          </button>

          <div class="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />

          <div data-tour="account-menu">
            <KDropdown label="Account menu">
              <template #trigger="{ toggle, open, menuId }">
                <button
                  type="button"
                  class="flex items-center gap-2.5 rounded-xl py-1 pr-2 pl-1 hover:bg-surface-muted"
                  aria-haspopup="menu"
                  :aria-expanded="open"
                  :aria-controls="menuId"
                  @click.stop="toggle"
                >
                  <KAvatar :name="auth.displayName" :src="auth.profile?.avatar_url" :size="32" />
                  <span class="hidden text-left sm:block">
                    <span class="block max-w-[160px] truncate text-[13.5px] leading-tight font-semibold">{{ auth.displayName }}</span>
                    <span class="block max-w-[160px] truncate text-[12px] leading-tight text-ink-muted">{{ auth.user?.email }}</span>
                  </span>
                </button>
              </template>
              <div class="px-2.5 pt-1.5 pb-2 sm:hidden">
                <p class="truncate text-sm font-medium">{{ auth.displayName }}</p>
                <p class="truncate text-[12px] text-ink-muted">{{ auth.user?.email }}</p>
              </div>
              <RouterLink
                :to="{ name: 'account', params: { slug } }"
                role="menuitem"
                class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
              >
                <UserRound :size="16" class="text-ink-muted" aria-hidden="true" />
                My account
              </RouterLink>
              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
                @click="startTour"
              >
                <CircleHelp :size="16" class="text-ink-muted" aria-hidden="true" />
                Take the tour
              </button>
              <div class="my-1.5 border-t border-line" />
              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-danger-ink hover:bg-danger-soft focus:bg-danger-soft focus:outline-none"
                @click="signOut"
              >
                <LogOut :size="16" aria-hidden="true" />
                Sign out
              </button>
            </KDropdown>
          </div>
        </div>
      </header>

      <main class="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
        <KAlert v-if="school && school.status === 'suspended'" tone="warning" title="This school is suspended" class="mb-6">
          You can view existing records, but changes are paused. Contact Klasora support to restore full access.
        </KAlert>
        <RouterView />
      </main>
    </div>

    <WelcomeModal
      v-model:open="welcomeOpen"
      :first-name="auth.firstName"
      :school-name="school?.name ?? 'Your school'"
      :is-admin="isAdmin"
      @start="startTour"
      @skip="skipWelcome"
    />
    <KTour />
  </div>
</template>
