<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { CalendarCheck2, CalendarPlus, CalendarRange, Pencil, Plus, Sparkles, Star, Trash2, Wand2 } from 'lucide-vue-next';
import {
  ACADEMIC_PERIOD_STATUS_LABELS,
  academicYearName,
  academicYearSchema,
  termSchema,
  validate,
  type AcademicTerm,
  type AcademicYear,
  type AcademicYearInput,
  type FieldErrors,
  type TermInput,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import {
  deleteAcademicYear,
  deleteTerm,
  listAcademicYears,
  listTerms,
  saveAcademicYear,
  saveTerm,
  setCurrentTerm,
  setCurrentYear,
} from '@/services/setup';
import { formatDay, useSchool } from '@/composables/useSchool';

const { schoolId, can, words, writable, feedback, attempt } = useSchool();
const canCreate = computed(() => can('academics.create') && writable.value);
const canEdit = computed(() => can('academics.edit') && writable.value);
const canDelete = computed(() => can('academics.delete') && writable.value);

const years = ref<AcademicYear[]>([]);
const terms = ref<AcademicTerm[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    [years.value, terms.value] = await Promise.all([listAcademicYears(schoolId.value), listTerms(schoolId.value)]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const termsFor = (yearId: string) => terms.value.filter((t) => t.academic_year_id === yearId);
const statusOptions = Object.entries(ACADEMIC_PERIOD_STATUS_LABELS).map(([value, label]) => ({ value, label }));
const statusTone = (s: string) => (s === 'active' ? 'success' : s === 'completed' ? 'neutral' : 'info');

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Places a term on its year's timeline as a percentage offset and width. */
function segment(year: AcademicYear, term: AcademicTerm) {
  const start = Date.parse(year.start_date);
  const span = Date.parse(year.end_date) - start;
  const left = ((Date.parse(term.start_date) - start) / span) * 100;
  const width = ((Date.parse(term.end_date) - Date.parse(term.start_date)) / span) * 100;
  return { left: `${Math.max(0, left)}%`, width: `${Math.max(2, width)}%` };
}

function todayMarker(year: AcademicYear) {
  const start = Date.parse(year.start_date);
  const pct = ((Date.now() - start) / (Date.parse(year.end_date) - start)) * 100;
  return pct >= 0 && pct <= 100 ? `${pct}%` : null;
}

// ---------------------------------------------------------------------------
// Academic year form
// ---------------------------------------------------------------------------
const yearOpen = ref(false);
const editingYear = ref<AcademicYear | null>(null);
const yearForm = reactive<AcademicYearInput>({ name: '', startDate: '', endDate: '', status: 'planned' });
const yearErrors = ref<FieldErrors>({});
const saving = ref(false);

function openYear(year?: AcademicYear) {
  editingYear.value = year ?? null;
  if (year) {
    Object.assign(yearForm, { name: year.name, startDate: year.start_date, endDate: year.end_date, status: year.status });
  } else {
    // Suggest the next Nigerian session: September to July.
    const latest = years.value[0];
    const startYear = latest ? Number(latest.start_date.slice(0, 4)) + 1 : new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const start = new Date(startYear, 8, 8);
    Object.assign(yearForm, { name: academicYearName(start), startDate: iso(start), endDate: iso(new Date(startYear + 1, 6, 25)), status: 'planned' });
  }
  yearErrors.value = {};
  yearOpen.value = true;
}

async function submitYear() {
  const result = validate(academicYearSchema, yearForm);
  if (!result.success) {
    yearErrors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(
    () => saveAcademicYear(schoolId.value, result.data, editingYear.value?.id),
    editingYear.value ? 'Academic year updated.' : 'Academic year created.',
  );
  saving.value = false;
  if (!saved) return;
  yearOpen.value = false;
  // The first year a school creates becomes the current one.
  if (!editingYear.value && !years.value.some((y) => y.is_current) && canEdit.value) {
    await attempt(() => setCurrentYear(saved.id));
  }
  await load();
}

async function makeYearCurrent(year: AcademicYear) {
  await attempt(() => setCurrentYear(year.id), `${year.name} is now the current session.`);
  await load();
}

async function removeYear(year: AcademicYear) {
  const ok = await feedback.confirm({
    title: `Delete the ${year.name} session?`,
    description: `This also deletes its ${words.value.periods.toLowerCase()}. Sessions with classes linked to them cannot be deleted.`,
    confirmLabel: 'Delete session',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => deleteAcademicYear(year.id), 'Academic year deleted.');
  await load();
}

// ---------------------------------------------------------------------------
// Term form
// ---------------------------------------------------------------------------
const termOpen = ref(false);
const termYear = ref<AcademicYear | null>(null);
const editingTerm = ref<AcademicTerm | null>(null);
const termForm = reactive<TermInput>({ name: '', sequence: 1, startDate: '', endDate: '', status: 'planned' });
const termErrors = ref<FieldErrors>({});

function openTerm(year: AcademicYear, term?: AcademicTerm) {
  termYear.value = year;
  editingTerm.value = term ?? null;
  const existing = termsFor(year.id);
  if (term) {
    Object.assign(termForm, { name: term.name, sequence: term.sequence, startDate: term.start_date, endDate: term.end_date, status: term.status });
  } else {
    const sequence = existing.length + 1;
    const last = existing[existing.length - 1];
    const startDate = last ? iso(new Date(Date.parse(last.end_date) + 14 * 86_400_000)) : year.start_date;
    Object.assign(termForm, {
      name: words.value.periodNames[sequence - 1] ?? `${words.value.period} ${sequence}`,
      sequence,
      startDate: startDate > year.end_date ? year.start_date : startDate,
      endDate: year.end_date,
      status: 'planned',
    });
  }
  termErrors.value = {};
  termOpen.value = true;
}

async function submitTerm() {
  const result = validate(termSchema, termForm);
  if (!result.success) {
    termErrors.value = result.errors;
    return;
  }
  if (!termYear.value) return;
  saving.value = true;
  const saved = await attempt(
    () => saveTerm(schoolId.value, termYear.value!.id, result.data, editingTerm.value?.id),
    editingTerm.value ? `${words.value.period} updated.` : `${words.value.period} added.`,
  );
  saving.value = false;
  if (saved) {
    termOpen.value = false;
    await load();
  }
}

/** Splits the year into the usual periods, with a two week break between each. */
async function addStandardPeriods(year: AcademicYear) {
  const names = words.value.periodNames;
  const start = Date.parse(year.start_date);
  const end = Date.parse(year.end_date);
  const gap = 14 * 86_400_000;
  const length = (end - start - gap * (names.length - 1)) / names.length;
  saving.value = true;
  const ok = await attempt(async () => {
    for (const [i, name] of names.entries()) {
      const s = start + i * (length + gap);
      await saveTerm(schoolId.value, year.id, {
        name,
        sequence: i + 1,
        startDate: iso(new Date(s)),
        endDate: iso(new Date(s + length)),
        status: 'planned',
      });
    }
    return true;
  }, `${names.length} ${words.value.periods.toLowerCase()} added. Adjust their dates if needed.`);
  saving.value = false;
  if (ok) await load();
}

async function makeTermCurrent(term: AcademicTerm) {
  await attempt(() => setCurrentTerm(term.id), `${term.name} is now the current ${words.value.period.toLowerCase()}.`);
  await load();
}

async function removeTerm(term: AcademicTerm) {
  const ok = await feedback.confirm({
    title: `Delete ${term.name}?`,
    description: `This ${words.value.period.toLowerCase()} will be removed from the calendar.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => deleteTerm(term.id), `${words.value.period} deleted.`);
  await load();
}
</script>

<template>
  <div>
    <KPageHeader
      :icon="CalendarRange"
      eyebrow="Academics"
      title="Academic sessions"
      :description="`Plan each academic year and its ${words.periods.toLowerCase()}. The current ${words.period.toLowerCase()} is used for attendance, results and fees.`"
    >
      <template #actions>
        <KButton v-if="canCreate" :icon="CalendarPlus" @click="openYear()">New academic year</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <div v-if="loading" class="space-y-4">
      <div v-for="n in 2" :key="n" class="rounded-card border border-line bg-surface p-6"><KSkeleton :lines="5" /></div>
    </div>

    <div v-else-if="!years.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState
        :icon="CalendarRange"
        title="No academic years yet"
        :description="`Create your current session first. Klasora will suggest dates and can split it into ${words.periods.toLowerCase()} for you.`"
      >
        <KButton v-if="canCreate" :icon="Sparkles" @click="openYear()">Create your first session</KButton>
      </KEmptyState>
    </div>

    <div v-else class="space-y-5">
      <article
        v-for="year in years"
        :key="year.id"
        :class="[
          'k-fade-up overflow-hidden rounded-card border bg-surface shadow-card',
          year.is_current ? 'border-brand/40 ring-4 ring-brand/5' : 'border-line',
        ]"
      >
        <header class="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
          <KIconTile :icon="year.is_current ? CalendarCheck2 : CalendarRange" :tone="year.is_current ? 'brand' : 'neutral'" :solid="year.is_current" :size="44" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-[17px] font-semibold">{{ year.name }}</h2>
              <KBadge v-if="year.is_current" tone="brand"><Star :size="11" aria-hidden="true" /> Current session</KBadge>
              <KBadge :tone="statusTone(year.status)" dot>{{ ACADEMIC_PERIOD_STATUS_LABELS[year.status] }}</KBadge>
            </div>
            <p class="mt-0.5 text-[13px] text-ink-muted">{{ formatDay(year.start_date) }} to {{ formatDay(year.end_date) }}</p>
          </div>
          <div class="flex flex-wrap gap-1">
            <KButton v-if="canEdit && !year.is_current" size="sm" variant="subtle" :icon="Star" @click="makeYearCurrent(year)">Make current</KButton>
            <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" aria-label="Edit session" @click="openYear(year)">Edit</KButton>
            <KButton
              v-if="canDelete && !year.is_current"
              size="sm"
              variant="ghost"
              :icon="Trash2"
              class="text-danger-ink hover:bg-danger-soft hover:text-danger-ink"
              @click="removeYear(year)"
            >
              Delete
            </KButton>
          </div>
        </header>

        <div class="p-5">
          <!-- Timeline -->
          <div class="relative h-10 rounded-xl bg-surface-muted" role="img" :aria-label="`Timeline of ${year.name}`">
            <div
              v-for="(term, i) in termsFor(year.id)"
              :key="term.id"
              :class="[
                'absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-lg px-2.5 text-[12px] font-semibold whitespace-nowrap text-white shadow-sm',
                term.is_current ? 'k-bg-brand' : ['bg-[#7C3AED]', 'bg-[#0891B2]', 'bg-[#16A34A]', 'bg-[#D97706]'][i % 4],
              ]"
              :style="segment(year, term)"
            >
              <span class="truncate">{{ term.name }}</span>
            </div>
            <div
              v-if="todayMarker(year)"
              class="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-danger"
              :style="{ left: todayMarker(year)! }"
              title="Today"
            />
          </div>

          <ul v-if="termsFor(year.id).length" class="mt-4 divide-y divide-line rounded-xl border border-line">
            <li v-for="term in termsFor(year.id)" :key="term.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
              <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-[13px] font-semibold text-ink-muted">
                {{ term.sequence }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                  {{ term.name }}
                  <KBadge v-if="term.is_current" tone="brand">Current</KBadge>
                  <KBadge v-else :tone="statusTone(term.status)">{{ ACADEMIC_PERIOD_STATUS_LABELS[term.status] }}</KBadge>
                </p>
                <p class="text-[12.5px] text-ink-muted">{{ formatDay(term.start_date) }} to {{ formatDay(term.end_date) }}</p>
              </div>
              <div class="flex gap-1">
                <KButton v-if="canEdit && !term.is_current" size="sm" variant="ghost" @click="makeTermCurrent(term)">Set as current</KButton>
                <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${term.name}`" @click="openTerm(year, term)" />
                <KButton
                  v-if="canDelete && !term.is_current"
                  size="sm"
                  variant="ghost"
                  :icon="Trash2"
                  :aria-label="`Delete ${term.name}`"
                  class="text-danger-ink hover:bg-danger-soft hover:text-danger-ink"
                  @click="removeTerm(term)"
                />
              </div>
            </li>
          </ul>
          <div v-else class="mt-4 flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong bg-surface-muted/40 p-4 sm:flex-row sm:items-center">
            <p class="flex-1 text-[13.5px] text-ink-muted">
              No {{ words.periods.toLowerCase() }} yet. Add them one by one, or let Klasora split the session into {{ words.periodNames.length }} for you.
            </p>
            <KButton v-if="canCreate" size="sm" :icon="Wand2" :loading="saving" @click="addStandardPeriods(year)">
              Add {{ words.periodNames.length }} {{ words.periods.toLowerCase() }}
            </KButton>
          </div>

          <KButton v-if="canCreate && termsFor(year.id).length" class="mt-3" size="sm" variant="ghost" :icon="Plus" @click="openTerm(year)">
            Add {{ words.period.toLowerCase() }}
          </KButton>
        </div>
      </article>
    </div>

    <!-- Year form -->
    <KModal v-model:open="yearOpen" :title="editingYear ? `Edit ${editingYear.name}` : 'New academic year'" description="Nigerian sessions usually run from September to July.">
      <form id="year-form" class="space-y-4" novalidate @submit.prevent="submitYear">
        <KInput v-model="yearForm.name" label="Name" placeholder="2026/2027" :error="yearErrors.name" required autofocus />
        <div class="grid gap-4 sm:grid-cols-2">
          <KInput v-model="yearForm.startDate" type="date" label="Starts" :error="yearErrors.startDate" required />
          <KInput v-model="yearForm.endDate" type="date" label="Ends" :error="yearErrors.endDate" required />
        </div>
        <KSelect v-model="yearForm.status" label="Status" :options="statusOptions" />
      </form>
      <template #footer>
        <KButton variant="secondary" @click="yearOpen = false">Cancel</KButton>
        <KButton type="submit" form="year-form" :loading="saving">{{ editingYear ? 'Save changes' : 'Create session' }}</KButton>
      </template>
    </KModal>

    <!-- Term form -->
    <KModal
      v-model:open="termOpen"
      :title="editingTerm ? `Edit ${editingTerm.name}` : `Add a ${words.period.toLowerCase()}`"
      :description="termYear ? `Dates must fall within ${termYear.name} (${formatDay(termYear.start_date)} to ${formatDay(termYear.end_date)}).` : ''"
    >
      <form id="term-form" class="space-y-4" novalidate @submit.prevent="submitTerm">
        <div class="grid gap-4 sm:grid-cols-[1fr_110px]">
          <KInput v-model="termForm.name" label="Name" :error="termErrors.name" required autofocus />
          <KInput
            :model-value="String(termForm.sequence)"
            label="Order"
            inputmode="numeric"
            :error="termErrors.sequence"
            @update:model-value="termForm.sequence = Number($event) || 1"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <KInput v-model="termForm.startDate" type="date" label="Starts" :error="termErrors.startDate" required />
          <KInput v-model="termForm.endDate" type="date" label="Ends" :error="termErrors.endDate" required />
        </div>
        <KSelect v-model="termForm.status" label="Status" :options="statusOptions" />
      </form>
      <template #footer>
        <KButton variant="secondary" @click="termOpen = false">Cancel</KButton>
        <KButton type="submit" form="term-form" :loading="saving">{{ editingTerm ? 'Save changes' : 'Add' }}</KButton>
      </template>
    </KModal>
  </div>
</template>
