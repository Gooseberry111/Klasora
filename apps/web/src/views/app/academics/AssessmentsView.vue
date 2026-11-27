<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { AlertTriangle, CheckCheck, ChevronRight, ClipboardList, Inbox, Plus, Send } from 'lucide-vue-next';
import {
  ASSESSMENT_STATUS_LABELS,
  ASSESSMENT_TYPES,
  ASSESSMENT_TYPE_LABELS,
  assessmentSchema,
  validate,
  type Assessment,
  type AssessmentInput,
  type AssessmentScore,
  type AssessmentStatus,
  type FieldErrors,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KTabs from '@/components/ui/KTabs.vue';
import { listAssessments, listScores, publishAssessments, reviewAssessment, saveAssessment } from '@/services/academics';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

const { schoolId, slug, can, words, feedback, attempt } = useSchool();
const teaching = useTeaching();
const isApprover = computed(() => can('examinations.approve'));

const termId = ref('');
const classFilter = ref('');
watch(teaching.currentTerm, (t) => {
  if (!termId.value && t) termId.value = t.id;
}, { immediate: true });

const assessments = ref<Assessment[]>([]);
const scores = ref<AssessmentScore[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    assessments.value = await listAssessments(schoolId.value, { termId: termId.value || undefined });
    scores.value = await listScores(assessments.value.map((a) => a.id));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([schoolId, termId], load, { immediate: true });

const tab = ref('all');
const awaiting = computed(() => assessments.value.filter((a) => a.status === 'submitted' || a.status === 'approved'));
const tabs = computed(() => [
  { key: 'all', label: 'All assessments', icon: ClipboardList },
  ...(isApprover.value ? [{ key: 'review', label: 'Review and publish', icon: Inbox, count: awaiting.value.length }] : []),
]);

const visible = computed(() => assessments.value.filter((a) => !classFilter.value || a.class_id === classFilter.value));
/** Assessments grouped by class and subject, with the weight they add up to. */
const groups = computed(() => {
  const map = new Map<string, { classId: string; subjectId: string; items: Assessment[]; weight: number }>();
  for (const a of visible.value) {
    const key = `${a.class_id}:${a.subject_id}`;
    const g = map.get(key) ?? { classId: a.class_id, subjectId: a.subject_id, items: [], weight: 0 };
    g.items.push(a);
    g.weight += Number(a.weight);
    map.set(key, g);
  }
  return [...map.values()].sort((x, y) => teaching.className(x.classId).localeCompare(teaching.className(y.classId)) || teaching.subjectName(x.subjectId).localeCompare(teaching.subjectName(y.subjectId)));
});
const entered = (id: string) => scores.value.filter((s) => s.assessment_id === id && (s.score !== null || s.is_absent)).length;

const statusTone: Record<AssessmentStatus, 'neutral' | 'info' | 'warning' | 'success' | 'brand'> = {
  draft: 'neutral', submitted: 'info', returned: 'warning', approved: 'success', published: 'brand',
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
const open = ref(false);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<AssessmentInput>({ title: '', assessmentType: 'continuous', classId: '', subjectId: '', termId: '', maximumScore: 20, weight: 20, assessmentDate: '' });
const classOptions = computed(() => teaching.classesFor('examinations.create').map((c) => ({ value: c.id, label: c.name })));
const subjectOptions = computed(() => teaching.subjectsFor(form.classId, 'examinations.create').map((s) => ({ value: s.id, label: s.name })));
watch(subjectOptions, (opts) => {
  if (!opts.some((o) => o.value === form.subjectId)) form.subjectId = opts[0]?.value ?? '';
});
watch(() => form.assessmentType, (t) => {
  if (t === 'examination') Object.assign(form, { maximumScore: 100, weight: 60 });
});

function openForm() {
  Object.assign(form, { title: '', assessmentType: 'continuous', classId: classFilter.value || classOptions.value[0]?.value || '', subjectId: '', termId: termId.value, maximumScore: 20, weight: 20, assessmentDate: '' });
  errors.value = {};
  open.value = true;
}

async function submit() {
  const result = validate(assessmentSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(() => saveAssessment(schoolId.value, result.data), 'Assessment created. Record scores next.');
  saving.value = false;
  if (saved) {
    open.value = false;
    await load();
  }
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------
const chosen = ref<Set<string>>(new Set());
const working = ref(false);
function toggle(id: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(id);
  else next.delete(id);
  chosen.value = next;
}

async function approveAndPublish(publish: boolean) {
  const ids = [...chosen.value];
  if (!ids.length) return;
  if (publish) {
    const ok = await feedback.confirm({
      title: `Publish ${ids.length} result${ids.length === 1 ? '' : 's'}?`,
      description: 'Students and guardians allowed to see results will see these scores straight away.',
      confirmLabel: 'Publish',
      tone: 'primary',
    });
    if (!ok) return;
  }
  working.value = true;
  await attempt(async () => {
    for (const id of ids) {
      const a = assessments.value.find((x) => x.id === id);
      if (a?.status === 'submitted') await reviewAssessment(id, true, '');
    }
    if (publish) await publishAssessments(ids);
  }, publish ? 'Results published.' : 'Results approved.');
  working.value = false;
  chosen.value = new Set();
  await load();
}
</script>

<template>
  <div>
    <KPageHeader
      :icon="ClipboardList"
      eyebrow="Academics"
      title="Assessments"
      :description="`Continuous assessments, tests and examinations for each ${words.subject.toLowerCase()}. Teachers record scores; the principal reviews and publishes them.`"
    >
      <template #actions>
        <KButton v-if="can('examinations.create') && classOptions.length" :icon="Plus" @click="openForm">New assessment</KButton>
      </template>
    </KPageHeader>

    <div class="mb-5 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row">
      <div class="sm:w-64">
        <KSelect v-model="termId" :label="words.period" :options="teaching.terms.value.map((t) => ({ value: t.id, label: teaching.termLabel(t.id) }))" placeholder="Choose" />
      </div>
      <div class="sm:w-56">
        <KSelect v-model="classFilter" :label="words.group" :options="[{ value: '', label: 'All' }, ...teaching.classesFor('examinations.view').map((c) => ({ value: c.id, label: c.name }))]" />
      </div>
    </div>

    <KAlert v-if="!teaching.terms.value.length && teaching.loaded.value" tone="info" class="mb-5" :title="`Set up your ${words.periods.toLowerCase()} first`">
      Assessments belong to a {{ words.period.toLowerCase() }}. <RouterLink :to="{ name: 'academic-calendar', params: { slug } }" class="font-medium underline">Open academic sessions</RouterLink>
    </KAlert>
    <KAlert v-if="error" tone="danger" class="mb-5">{{ error }}</KAlert>

    <KTabs v-if="tabs.length > 1" v-model="tab" :tabs="tabs" label="Assessments" class="mb-5" />

    <KSkeleton v-if="loading" :lines="8" />

    <!-- All assessments, grouped -->
    <template v-else-if="tab === 'all'">
      <div v-if="!groups.length" class="rounded-card border border-line bg-surface shadow-card">
        <KEmptyState :icon="ClipboardList" title="No assessments yet" description="Create your continuous assessments and examination for this term. Their weights should add up to 100.">
          <KButton v-if="can('examinations.create') && classOptions.length" :icon="Plus" @click="openForm">New assessment</KButton>
        </KEmptyState>
      </div>
      <div v-else class="space-y-4">
        <section v-for="g in groups" :key="`${g.classId}${g.subjectId}`" class="rounded-card border border-line bg-surface shadow-card">
          <header class="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <h2 class="text-[15px] font-semibold">{{ teaching.subjectName(g.subjectId) }}</h2>
            <KBadge tone="brand">{{ teaching.className(g.classId) }}</KBadge>
            <span :class="['ml-auto flex items-center gap-1 text-[12.5px] font-medium', g.weight === 100 ? 'text-success-ink' : 'text-warning-ink']">
              <AlertTriangle v-if="g.weight !== 100" :size="14" aria-hidden="true" />
              Weights add up to {{ g.weight }}{{ g.weight === 100 ? '' : ' (should be 100)' }}
            </span>
          </header>
          <ul class="divide-y divide-line">
            <li v-for="a in g.items" :key="a.id">
              <RouterLink :to="{ name: 'assessment-detail', params: { slug, assessmentId: a.id } }" class="group flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-surface-muted/50">
                <div class="min-w-0 flex-1">
                  <p class="font-medium group-hover:text-brand-ink">{{ a.title }}</p>
                  <p class="text-[12.5px] text-ink-muted">{{ ASSESSMENT_TYPE_LABELS[a.assessment_type] }}, out of {{ Number(a.maximum_score) }}, counts {{ Number(a.weight) }}%</p>
                </div>
                <span class="text-[12.5px] text-ink-muted tabular-nums">{{ entered(a.id) }} scores</span>
                <KBadge :tone="statusTone[a.status]" dot>{{ ASSESSMENT_STATUS_LABELS[a.status] }}</KBadge>
                <ChevronRight :size="16" class="text-ink-subtle" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </section>
      </div>
    </template>

    <!-- Review queue -->
    <template v-else>
      <div v-if="!awaiting.length" class="rounded-card border border-line bg-surface shadow-card">
        <KEmptyState :icon="Inbox" title="Nothing to review" description="Results that teachers submit appear here for you to approve and publish." />
      </div>
      <div v-else class="rounded-card border border-line bg-surface shadow-card">
        <div class="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <KCheckbox
            :model-value="chosen.size === awaiting.length"
            :indeterminate="chosen.size > 0 && chosen.size < awaiting.length"
            label="Select all"
            @update:model-value="chosen = $event ? new Set(awaiting.map((a) => a.id)) : new Set()"
          />
          <div class="ml-auto flex gap-2">
            <KButton size="sm" variant="secondary" :icon="CheckCheck" :disabled="!chosen.size" :loading="working" @click="approveAndPublish(false)">Approve</KButton>
            <KButton size="sm" :icon="Send" :disabled="!chosen.size" :loading="working" @click="approveAndPublish(true)">Approve and publish</KButton>
          </div>
        </div>
        <ul class="divide-y divide-line">
          <li v-for="a in awaiting" :key="a.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <KCheckbox :model-value="chosen.has(a.id)" :aria-label="`Select ${a.title}`" @update:model-value="toggle(a.id, $event)" />
            <div class="min-w-0 flex-1">
              <RouterLink :to="{ name: 'assessment-detail', params: { slug, assessmentId: a.id } }" class="font-medium hover:text-brand-ink">{{ a.title }}</RouterLink>
              <p class="text-[12.5px] text-ink-muted">{{ teaching.subjectName(a.subject_id) }}, {{ teaching.className(a.class_id) }}, {{ entered(a.id) }} scores</p>
            </div>
            <KBadge :tone="statusTone[a.status]" dot>{{ ASSESSMENT_STATUS_LABELS[a.status] }}</KBadge>
          </li>
        </ul>
      </div>
    </template>

    <KModal v-model:open="open" title="New assessment" description="For example First CA, Mid term test or Examination." size="lg">
      <form id="assessment-form" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submit">
        <div class="sm:col-span-2"><KInput v-model="form.title" label="Name" placeholder="First CA" :error="errors.title" required autofocus /></div>
        <KSelect v-model="form.assessmentType" label="Type" :options="ASSESSMENT_TYPES.map((t) => ({ value: t, label: ASSESSMENT_TYPE_LABELS[t] }))" />
        <KSelect v-model="form.termId" :label="words.period" :options="teaching.terms.value.map((t) => ({ value: t.id, label: teaching.termLabel(t.id) }))" :error="errors.termId" />
        <KSelect v-model="form.classId" :label="words.group" :options="classOptions" :error="errors.classId" />
        <KSelect v-model="form.subjectId" :label="words.subject" :options="subjectOptions" placeholder="Choose" :error="errors.subjectId" />
        <KInput :model-value="String(form.maximumScore)" label="Highest possible score" inputmode="decimal" :error="errors.maximumScore" @update:model-value="form.maximumScore = Number($event)" />
        <KInput :model-value="String(form.weight)" label="Counts towards the total (%)" inputmode="decimal" hint="Weights for a subject should add up to 100." :error="errors.weight" @update:model-value="form.weight = Number($event)" />
        <KInput v-model="form.assessmentDate" type="date" label="Date" optional />
      </form>
      <template #footer>
        <KButton variant="secondary" @click="open = false">Cancel</KButton>
        <KButton type="submit" form="assessment-form" :loading="saving">Create</KButton>
      </template>
    </KModal>
  </div>
</template>
