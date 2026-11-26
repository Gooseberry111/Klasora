<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { Building2, Check, ChevronsUpDown, LogOut, Menu, Moon, Plus, Sun, UserRound, X } from 'lucide-vue-next';
import { INSTITUTION_TYPE_LABELS, type InstitutionType } from '@klasora/shared';
import KLogo from '@/components/ui/KLogo.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KDropdown from '@/components/ui/KDropdown.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { useThemeStore } from '@/stores/theme';
import { visibleNavigation } from '@/navigation';

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const theme = useThemeStore();
const route = useRoute();
const router = useRouter();

const mobileNavOpen = ref(false);
watch(() => route.fullPath, () => (mobileNavOpen.value = false));

const slug = computed(() => String(route.params.slug ?? ''));
const sections = computed(() => visibleNavigation((p) => workspace.can(p)));
const school = computed(() => workspace.currentSchool);
const roleNames = computed(() => workspace.currentRoles.map((r) => r.name).join(' · '));
const schoolInitials = computed(() => school.value?.name ?? 'School');

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
</script>

<template>
  <div class="min-h-dvh bg-canvas">
    <!-- Mobile scrim -->
    <Transition enter-active-class="transition-opacity duration-200" enter-from-class="opacity-0" leave-active-class="transition-opacity duration-150" leave-to-class="opacity-0">
      <div v-if="mobileNavOpen" class="fixed inset-0 z-30 bg-[#0b1322]/50 lg:hidden" aria-hidden="true" @click="mobileNavOpen = false" />
    </Transition>

    <!-- Sidebar -->
    <aside
      :class="[
        'fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col bg-navy text-navy-ink transition-transform duration-200 lg:translate-x-0',
        mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
      aria-label="Main navigation"
    >
      <div class="flex h-16 shrink-0 items-center justify-between px-5">
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
      <div class="px-3 pb-3">
        <KDropdown label="Switch school" align="left" width-class="w-[244px]">
          <template #trigger="{ toggle, open, menuId }">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-[10px] border border-navy-line bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
              aria-haspopup="menu"
              :aria-expanded="open"
              :aria-controls="menuId"
              @click.stop="toggle"
            >
              <KAvatar :name="schoolInitials" :src="school?.logo_url" :size="32" square />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13.5px] font-medium text-white">{{ school?.name }}</span>
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
            <KAvatar :name="s.name" :src="s.logo_url" :size="26" square />
            <span class="min-w-0 flex-1">
              <span class="block truncate">{{ s.name }}</span>
              <span class="block truncate text-[12px] text-ink-muted">
                {{ INSTITUTION_TYPE_LABELS[s.institution_type as InstitutionType] }}
              </span>
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

      <nav class="flex-1 overflow-y-auto px-3 pb-6">
        <div v-for="section in sections" :key="section.heading" class="mt-4 first:mt-1">
          <p class="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-navy-muted uppercase">{{ section.heading }}</p>
          <ul class="space-y-0.5">
            <li v-for="item in section.items" :key="item.routeName">
              <RouterLink
                :to="{ name: item.routeName, params: { slug } }"
                :class="[
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                  isActive(item.routeName) ? 'bg-navy-active text-white' : 'text-navy-ink hover:bg-white/[0.05] hover:text-white',
                ]"
                :aria-current="isActive(item.routeName) ? 'page' : undefined"
              >
                <span
                  v-if="isActive(item.routeName)"
                  class="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-full bg-[#3B82F6]"
                  aria-hidden="true"
                />
                <component
                  :is="item.icon"
                  :size="18"
                  :class="isActive(item.routeName) ? 'text-[#60A5FA]' : 'text-navy-muted group-hover:text-navy-ink'"
                  aria-hidden="true"
                />
                {{ item.label }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </nav>

      <div class="border-t border-navy-line px-5 py-4 text-[12px] text-navy-muted">
        Klasora · Education, connected.
      </div>
    </aside>

    <!-- Main column -->
    <div class="flex min-h-dvh flex-col lg:pl-[268px]">
      <header class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6 lg:px-8">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink lg:hidden"
          aria-label="Open navigation"
          :aria-expanded="mobileNavOpen"
          @click="mobileNavOpen = true"
        >
          <Menu :size="20" aria-hidden="true" />
        </button>
        <div class="flex min-w-0 items-center gap-2 lg:hidden">
          <Building2 :size="16" class="shrink-0 text-ink-subtle" aria-hidden="true" />
          <span class="truncate text-sm font-medium">{{ school?.name }}</span>
        </div>

        <div class="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
            :aria-label="theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleTheme"
          >
            <Sun v-if="theme.isDark" :size="18" aria-hidden="true" />
            <Moon v-else :size="18" aria-hidden="true" />
          </button>

          <KDropdown label="Account menu">
            <template #trigger="{ toggle, open, menuId }">
              <button
                type="button"
                class="flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 hover:bg-surface-muted"
                aria-haspopup="menu"
                :aria-expanded="open"
                :aria-controls="menuId"
                @click.stop="toggle"
              >
                <KAvatar :name="auth.displayName" :src="auth.profile?.avatar_url" :size="32" />
                <span class="hidden text-left sm:block">
                  <span class="block max-w-[160px] truncate text-[13.5px] leading-tight font-medium">{{ auth.displayName }}</span>
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
              class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-danger-ink hover:bg-danger-soft focus:bg-danger-soft focus:outline-none"
              @click="signOut"
            >
              <LogOut :size="16" aria-hidden="true" />
              Sign out
            </button>
          </KDropdown>
        </div>
      </header>

      <main class="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <KAlert v-if="school && school.status === 'suspended'" tone="warning" title="This school is suspended" class="mb-6">
          You can view existing records, but changes are paused. Contact Klasora support to restore full access.
        </KAlert>
        <RouterView />
      </main>
    </div>
  </div>
</template>
