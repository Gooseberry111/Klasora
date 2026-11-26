<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ChevronRight, LogOut, Plus, School } from 'lucide-vue-next';
import { INSTITUTION_TYPE_LABELS, type InstitutionType } from '@klasora/shared';
import KLogo from '@/components/ui/KLogo.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KButton from '@/components/ui/KButton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KBadge from '@/components/ui/KBadge.vue';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref('');

const notice = computed(() => {
  if (route.query.notice === 'no-access') return "You don't have access to that school, or it no longer exists.";
  if (route.query.notice === 'load-failed') return "We couldn't load that page. Check your connection and try again.";
  return '';
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await workspace.loadMemberships(true);
    // One school and nothing to explain: go straight in.
    if (workspace.schools.length === 1 && !notice.value) {
      await router.replace({ name: 'dashboard', params: { slug: workspace.schools[0]!.slug } });
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function signOut() {
  await auth.signOut();
  workspace.reset();
  await router.replace({ name: 'login' });
}

onMounted(load);
</script>

<template>
  <div class="min-h-dvh bg-canvas">
    <header class="flex h-16 items-center justify-between border-b border-line bg-surface px-5 sm:px-8">
      <KLogo :size="30" />
      <KButton variant="ghost" size="sm" :icon="LogOut" @click="signOut">Sign out</KButton>
    </header>

    <main class="mx-auto max-w-2xl px-5 py-10 sm:py-14">
      <h1 class="k-page-title">Welcome, {{ auth.firstName }}</h1>
      <p class="mt-1.5 text-[14.5px] text-ink-muted">Choose a school to continue.</p>

      <KAlert v-if="notice" tone="warning" class="mt-6">{{ notice }}</KAlert>
      <KAlert v-if="error" tone="danger" class="mt-6">
        {{ error }}
        <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
      </KAlert>

      <div class="mt-7 overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div v-if="loading" class="space-y-5 p-5">
          <div v-for="n in 2" :key="n" class="flex items-center gap-3">
            <div class="size-11 animate-pulse rounded-lg bg-surface-muted" />
            <div class="flex-1"><KSkeleton :lines="2" /></div>
          </div>
        </div>

        <KEmptyState
          v-else-if="workspace.schools.length === 0"
          :icon="School"
          title="You're not part of a school yet"
          description="Register your institution to create a workspace. If a school invited you, open the link in your invitation email."
        >
          <KButton :icon="Plus" :to="{ name: 'register' }">Register an institution</KButton>
        </KEmptyState>

        <ul v-else class="divide-y divide-line">
          <li v-for="school in workspace.schools" :key="school.id">
            <RouterLink
              :to="{ name: 'dashboard', params: { slug: school.slug } }"
              class="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-surface-muted/70 focus-visible:bg-surface-muted"
            >
              <KAvatar :name="school.name" :src="school.logo_url" :size="44" square />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ school.name }}</p>
                <p class="mt-0.5 truncate text-[13px] text-ink-muted">
                  {{ INSTITUTION_TYPE_LABELS[school.institution_type as InstitutionType] }} ·
                  {{ school.roles.map((r) => r.name).join(', ') }}
                </p>
              </div>
              <KBadge v-if="school.status === 'suspended'" tone="warning">Suspended</KBadge>
              <ChevronRight :size="18" class="text-ink-subtle" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </div>

      <div v-if="!loading && workspace.schools.length > 0" class="mt-5">
        <KButton variant="secondary" :icon="Plus" :to="{ name: 'register' }">Register another institution</KButton>
      </div>
    </main>
  </div>
</template>
