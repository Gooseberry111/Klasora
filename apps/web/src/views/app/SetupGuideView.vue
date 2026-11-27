<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ArrowRight,
  BookOpen,
  Building2,
  CalendarRange,
  Check,
  ImagePlus,
  ListChecks,
  Network,
  PartyPopper,
  School,
  UserPlus,
} from 'lucide-vue-next';
import { buildSetupSteps, setupCompletion, type SetupProgress, type SetupStepKey } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KProgressRing from '@/components/ui/KProgressRing.vue';
import KIconTile, { type IconTone } from '@/components/ui/KIconTile.vue';
import { fetchSetupProgress, markSetupComplete } from '@/services/setup';
import { useSchool } from '@/composables/useSchool';

const { workspace, schoolId, slug, words, can, attempt } = useSchool();

const progress = ref<SetupProgress | null>(null);
const loading = ref(true);
const error = ref('');
const saving = ref(false);

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    progress.value = await fetchSetupProgress(schoolId.value);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const allSteps = computed(() => (progress.value ? buildSetupSteps(progress.value, words.value) : []));
const completion = computed(() => setupCompletion(allSteps.value));
const doneCount = computed(() => allSteps.value.filter((s) => s.done).length);

const visual: Record<SetupStepKey, { icon: typeof School; tone: IconTone }> = {
  profile: { icon: ImagePlus, tone: 'brand' },
  campuses: { icon: Building2, tone: 'info' },
  calendar: { icon: CalendarRange, tone: 'violet' },
  structure: { icon: Network, tone: 'neutral' },
  classes: { icon: School, tone: 'warning' },
  subjects: { icon: BookOpen, tone: 'success' },
  staff: { icon: UserPlus, tone: 'brand' },
};

const finished = computed(() => Boolean(progress.value?.setup_completed_at));

async function toggleComplete(complete: boolean) {
  saving.value = true;
  await attempt(async () => {
    await markSetupComplete(schoolId.value, complete);
    await load();
  }, complete ? 'Setup marked as complete. Nice work!' : 'The setup guide is back on your dashboard.');
  saving.value = false;
}
</script>

<template>
  <div>
    <KPageHeader
      :icon="ListChecks"
      eyebrow="Getting started"
      :title="`Set up ${workspace.currentSchool?.name ?? 'your school'}`"
      description="Work through these steps in any order. Klasora checks your progress automatically, so there is nothing to tick off by hand."
    />

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <ol class="space-y-3">
        <template v-if="loading">
          <li v-for="n in 6" :key="n" class="rounded-card border border-line bg-surface p-5"><KSkeleton :lines="2" /></li>
        </template>
        <li
          v-for="(step, index) in allSteps"
          v-else
          :key="step.key"
          :class="[
            'k-fade-up group relative flex flex-col gap-4 rounded-card border bg-surface p-5 shadow-card transition-[border-color,box-shadow] sm:flex-row sm:items-center',
            step.done ? 'border-success/30' : 'border-line hover:border-line-strong hover:shadow-hover',
          ]"
          :style="{ animationDelay: `${index * 40}ms` }"
        >
          <div class="flex items-start gap-4 sm:flex-1 sm:items-center">
            <div class="relative">
              <KIconTile :icon="visual[step.key].icon" :tone="visual[step.key].tone" :solid="!step.done" :size="46" />
              <span
                v-if="step.done"
                class="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full bg-success text-white ring-2 ring-surface"
                aria-hidden="true"
              >
                <Check :size="12" :stroke-width="3" />
              </span>
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-[12px] font-semibold text-ink-subtle">Step {{ index + 1 }}</p>
                <KBadge v-if="step.done" tone="success" dot>Done</KBadge>
                <KBadge v-else-if="step.optional" tone="neutral">Optional</KBadge>
              </div>
              <h2 class="mt-0.5 text-[15.5px] font-semibold text-ink">{{ step.title }}</h2>
              <p class="mt-0.5 text-[13.5px] text-ink-muted">{{ step.description }}</p>
              <p class="mt-1.5 text-[12.5px] font-medium text-ink-subtle">{{ step.summary }}</p>
            </div>
          </div>
          <KButton
            v-if="step.anyOf.some((p) => can(p))"
            :variant="step.done ? 'secondary' : 'primary'"
            :icon-right="ArrowRight"
            :to="{ name: step.routeName, params: { slug } }"
            class="shrink-0"
          >
            {{ step.done ? 'Review' : 'Start' }}
          </KButton>
          <p v-else class="shrink-0 text-[12.5px] text-ink-subtle">Ask an administrator</p>
        </li>
      </ol>

      <aside class="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div class="k-bg-hero relative overflow-hidden rounded-card p-6 text-white shadow-hover">
          <div class="k-dots-light pointer-events-none absolute inset-0" aria-hidden="true" />
          <div class="relative flex items-center gap-4">
            <KProgressRing :value="completion" :size="84" light />
            <div>
              <p class="text-[13px] text-[#C7D2E3]">Overall progress</p>
              <p class="text-[17px] font-semibold">{{ doneCount }} of {{ allSteps.length }} steps</p>
            </div>
          </div>
          <p class="relative mt-4 text-[13px] leading-relaxed text-[#C7D2E3]">
            Required steps count towards your progress. Optional steps are there when you need them.
          </p>
        </div>

        <div v-if="completion === 100 && can('settings.edit')" class="rounded-card border border-success/30 bg-success-soft p-5">
          <PartyPopper :size="22" class="text-success-ink" aria-hidden="true" />
          <p class="mt-2 text-[14.5px] font-semibold text-success-ink">Your school is ready</p>
          <p class="mt-1 text-[13px] text-success-ink/90">
            {{ finished ? 'The guide is hidden from your dashboard.' : 'Hide the guide from your dashboard when you are happy with everything.' }}
          </p>
          <KButton
            class="mt-4"
            size="sm"
            :variant="finished ? 'secondary' : 'primary'"
            :loading="saving"
            @click="toggleComplete(!finished)"
          >
            {{ finished ? 'Show it on my dashboard again' : 'Finish setup' }}
          </KButton>
        </div>

        <div class="rounded-card border border-line bg-surface p-5 shadow-card">
          <p class="text-[14px] font-semibold">Good to know</p>
          <ul class="mt-3 space-y-2.5 text-[13px] text-ink-muted">
            <li class="flex gap-2"><Check :size="15" class="mt-0.5 shrink-0 text-brand" aria-hidden="true" /> You can change anything later.</li>
            <li class="flex gap-2"><Check :size="15" class="mt-0.5 shrink-0 text-brand" aria-hidden="true" /> {{ words.groups }} and {{ words.subjects.toLowerCase() }} can be added in bulk from common templates.</li>
            <li class="flex gap-2"><Check :size="15" class="mt-0.5 shrink-0 text-brand" aria-hidden="true" /> Invited staff only see what their role allows.</li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>
