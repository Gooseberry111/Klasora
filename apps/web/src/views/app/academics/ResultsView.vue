<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { Download, FileSpreadsheet, FileText, Plus, Scale, Send, Sparkles, Trash2, Wand2 } from 'lucide-vue-next';
import {
  gradeFor,
  ordinal,
  studentName,
  toCsv,
  type ClassResultRow,
  type GradingBand,
  type ReportCard,
  type Student,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import {
  classResults,
  generateReportCards,
  getShowPositions,
  listGradingBands,
  listReportCards,
  publishReportCards,
  saveGradingBands,
  setShowPositions,
} from '@/services/academics';
import { listEnrollments, listStudents } from '@/services/students';
import { downloadText, todayStamp } from '@/lib/download';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

const { workspace, schoolId, slug, can, words, feedback, attempt } = useSchool();
const teaching = useTeaching();

const classId = ref('');
const termId = ref('');
const publishedOnly = ref(false);
const classOptions = computed(() => teaching.classesFor('examinations.view').map((c) => ({ value: c.id, label: c.name })));
watch([classOptions, teaching.currentTerm], () => {
  if (!classId.value && classOptions.value.length) classId.value = classOptions.value[0]!.value;
  if (!termId.value && teaching.currentTerm.value) termId.value = teaching.currentTerm.value.id;
}, { immediate: true });

const results = ref<ClassResultRow[]>([]);
const students = ref<Student[]>([]);
const cards = ref<ReportCard[]>([]);
const bands = ref<GradingBand[]>([]);
const showPositions = ref(false);
const loading = ref(false);
const error = ref('');

async function load() {
  if (!schoolId.value || !classId.value || !termId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const [r, enrolled, all, c, b, pos] = await Promise.all([
      classResults(classId.value, termId.value, publishedOnly.value),
      listEnrollments(schoolId.value, { classId: classId.value }),
      listStudents(schoolId.value),
      listReportCards(schoolId.value, { classId: classId.value, termId: termId.value }),
      listGradingBands(schoolId.value),
      getShowPositions(schoolId.value),
    ]);
    results.value = r;
    const ids = new Set([...enrolled.map((e) => e.student_id), ...r.map((x) => x.student_id)]);
    students.value = all.filter((s) => ids.has(s.id));
    cards.value = c;
    bands.value = b;
    showPositions.value = pos;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([schoolId, classId, termId, publishedOnly], load, { immediate: true });

const subjectIds = computed(() => [...new Set(results.value.map((r) => r.subject_id))].sort((a, b) => teaching.subjectName(a).localeCompare(teaching.subjectName(b))));
const cell = (studentId: string, subjectId: string) => results.value.find((r) => r.student_id === studentId && r.subject_id === subjectId);

/** One row per student: subject totals, average, grade and overall position. */
const broadsheet = computed(() => {
  const rows = students.value.map((s) => {
    const totals = subjectIds.value.map((id) => cell(s.id, id)?.total).filter((t): t is number => t !== undefined);
    const average = totals.length ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100 : null;
    return { student: s, average, grade: gradeFor(bands.value, average)?.grade ?? null, position: null as number | null };
  });
  const ranked = rows.filter((r) => r.average !== null).sort((a, b) => b.average! - a.average!);
  ranked.forEach((r, i) => (r.position = i > 0 && ranked[i - 1]!.average === r.average ? ranked[i - 1]!.position : i + 1));
  return rows.sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.student.last_name.localeCompare(b.student.last_name));
});

function exportCsv() {
  const header = ['Student', 'Admission number', ...subjectIds.value.map((id) => teaching.subjectName(id)), 'Average', 'Grade', ...(showPositions.value ? ['Position'] : [])];
  const rows = broadsheet.value.map((r) => [
    studentName(r.student),
    r.student.admission_number,
    ...subjectIds.value.map((id) => cell(r.student.id, id)?.total ?? ''),
    r.average ?? '',
    r.grade ?? '',
    ...(showPositions.value ? [r.position ?? ''] : []),
  ]);
  downloadText(`${teaching.className(classId.value).replace(/\W+/g, '_')}_results_${todayStamp()}.csv`, toCsv([header, ...rows]));
}

// ---------------------------------------------------------------------------
// Report cards
// ---------------------------------------------------------------------------
const isClassTeacher = computed(() => {
  const c = teaching.classes.value.find((x) => x.id === classId.value);
  return Boolean(c?.class_teacher_membership_id && workspace.myMembershipIds.includes(c.class_teacher_membership_id));
});
const canPrepare = computed(() => can('examinations.approve') || isClassTeacher.value);
const cardFor = (studentId: string) => cards.value.find((c) => c.student_id === studentId);
const working = ref(false);

async function prepare() {
  working.value = true;
  const n = await attempt(() => generateReportCards(classId.value, termId.value));
  working.value = false;
  if (n !== undefined) {
    feedback.success(`${n} report card${n === 1 ? '' : 's'} prepared from published results.`);
    await load();
  }
}

async function publish() {
  const drafts = cards.value.filter((c) => c.status === 'draft').length;
  const ok = await feedback.confirm({
    title: `Publish ${drafts} report card${drafts === 1 ? '' : 's'}?`,
    description: 'Students and guardians allowed to see results can view and download them straight away.',
    confirmLabel: 'Publish',
    tone: 'primary',
  });
  if (!ok) return;
  working.value = true;
  await attempt(() => publishReportCards(classId.value, termId.value), 'Report cards published.');
  working.value = false;
  await load();
}

// ---------------------------------------------------------------------------
// Grading scale
// ---------------------------------------------------------------------------
const canEditScale = computed(() => can('examinations.approve') || can('settings.edit'));
const scaleOpen = ref(false);
const draftBands = ref<{ grade: string; min_score: string; remark: string }[]>([]);
const draftPositions = ref(false);

function openScale() {
  draftBands.value = [...bands.value].sort((a, b) => Number(b.min_score) - Number(a.min_score)).map((b) => ({ grade: b.grade, min_score: String(Number(b.min_score)), remark: b.remark ?? '' }));
  draftPositions.value = showPositions.value;
  scaleOpen.value = true;
}

async function saveScale() {
  const parsed = draftBands.value.map((b) => ({ grade: b.grade.trim(), min_score: Number(b.min_score), remark: b.remark }));
  if (parsed.some((b) => !b.grade || Number.isNaN(b.min_score) || b.min_score < 0 || b.min_score > 100)) {
    feedback.error('Every grade needs a name and a starting score between 0 and 100.');
    return;
  }
  working.value = true;
  const ok = await attempt(async () => {
    await saveGradingBands(schoolId.value, parsed);
    if (draftPositions.value !== showPositions.value) await setShowPositions(schoolId.value, draftPositions.value);
    return true;
  }, 'Grading scale saved.');
  working.value = false;
  if (ok) {
    scaleOpen.value = false;
    await load();
  }
}
const sortedBands = computed(() => [...bands.value].sort((a, b) => Number(b.min_score) - Number(a.min_score)));
const bandRange = (i: number) => {
  const b = sortedBands.value[i]!;
  const upper = i === 0 ? 100 : Number(sortedBands.value[i - 1]!.min_score) - 1;
  return `${Number(b.min_score)} to ${upper}`;
};
</script>

<template>
  <div>
    <KPageHeader :icon="FileSpreadsheet" eyebrow="Academics" title="Results and report cards" description="Weighted term totals for every subject, your grading scale, and report cards ready to publish.">
      <template #actions>
        <KButton v-if="broadsheet.length && subjectIds.length" variant="secondary" :icon="Download" @click="exportCsv">Export</KButton>
      </template>
    </KPageHeader>

    <div class="mb-5 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-end">
      <div class="sm:w-56"><KSelect v-model="classId" :label="words.group" :options="classOptions" placeholder="Choose" /></div>
      <div class="sm:w-64"><KSelect v-model="termId" :label="words.period" :options="teaching.terms.value.map((t) => ({ value: t.id, label: teaching.termLabel(t.id) }))" placeholder="Choose" /></div>
      <KCheckbox v-model="publishedOnly" label="Published results only" class="sm:mb-2.5" />
    </div>

    <KAlert v-if="error" tone="danger" class="mb-5">{{ error }}</KAlert>

    <div class="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div class="min-w-0 space-y-6">
        <KCard title="Broadsheet" :description="publishedOnly ? 'Published results only.' : 'Includes results still in review, so totals may change.'" :icon="FileSpreadsheet" :padded="false">
          <KSkeleton v-if="loading" :lines="6" class="p-5" />
          <KEmptyState v-else-if="!subjectIds.length" compact :icon="FileSpreadsheet" title="No scores yet" description="Scores appear here as teachers record them in Assessments.">
            <KButton size="sm" variant="secondary" :to="{ name: 'assessments', params: { slug } }">Open assessments</KButton>
          </KEmptyState>
          <div v-else class="overflow-x-auto">
            <table class="k-table">
              <thead>
                <tr>
                  <th scope="col" class="sticky left-0 z-10 bg-surface">Student</th>
                  <th v-for="id in subjectIds" :key="id" scope="col" class="text-center">{{ teaching.subjects.value.find((s) => s.id === id)?.code ?? teaching.subjectName(id) }}</th>
                  <th scope="col" class="text-center">Average</th>
                  <th scope="col" class="text-center">Grade</th>
                  <th v-if="showPositions" scope="col" class="text-center">Position</th>
                  <th scope="col"><span class="sr-only">Report card</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in broadsheet" :key="row.student.id">
                  <td class="sticky left-0 z-10 bg-surface">
                    <div class="flex items-center gap-2.5">
                      <KAvatar :name="studentName(row.student)" :size="28" />
                      <span class="font-medium whitespace-nowrap">{{ studentName(row.student) }}</span>
                    </div>
                  </td>
                  <td v-for="id in subjectIds" :key="id" class="text-center tabular-nums">
                    <template v-if="cell(row.student.id, id)">
                      {{ cell(row.student.id, id)!.total }}
                      <span class="block text-[11px] font-semibold text-brand-ink">{{ cell(row.student.id, id)!.grade }}</span>
                    </template>
                    <span v-else class="text-ink-subtle">·</span>
                  </td>
                  <td class="text-center font-semibold tabular-nums">{{ row.average ?? '' }}</td>
                  <td class="text-center"><KBadge v-if="row.grade" tone="brand">{{ row.grade }}</KBadge></td>
                  <td v-if="showPositions" class="text-center tabular-nums">{{ row.position ? ordinal(row.position) : '' }}</td>
                  <td class="text-right">
                    <KButton v-if="cardFor(row.student.id)" size="sm" variant="ghost" :icon="FileText" :to="{ name: 'report-card', params: { slug, reportCardId: cardFor(row.student.id)!.id } }">
                      Card
                    </KButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </KCard>
      </div>

      <aside class="space-y-6">
        <div class="k-bg-hero relative overflow-hidden rounded-card p-5 text-white shadow-hover">
          <div class="k-dots-light absolute inset-0" aria-hidden="true" />
          <p class="relative flex items-center gap-2 text-[13px] text-[#C7D2E3]"><Sparkles :size="15" aria-hidden="true" /> Report cards</p>
          <p class="relative mt-1 text-[17px] font-semibold">
            {{ cards.length ? `${cards.filter((c) => c.status === 'published').length} of ${cards.length} published` : 'Not prepared yet' }}
          </p>
          <p class="relative mt-2 text-[13px] text-[#C7D2E3]">Cards use published results only, plus attendance for the {{ words.period.toLowerCase() }}. Class teachers and the principal add comments.</p>
          <div class="relative mt-4 flex flex-wrap gap-2">
            <KButton v-if="canPrepare" variant="white" size="sm" :icon="Wand2" :loading="working" :disabled="!classId || !termId" @click="prepare">
              {{ cards.length ? 'Refresh cards' : 'Prepare cards' }}
            </KButton>
            <KButton v-if="can('examinations.approve') && cards.some((c) => c.status === 'draft')" variant="glass" size="sm" :icon="Send" :loading="working" @click="publish">Publish</KButton>
          </div>
        </div>

        <KCard title="Grading scale" :icon="Scale" tone="violet">
          <template v-if="canEditScale" #actions>
            <KButton size="sm" variant="ghost" @click="openScale">Edit</KButton>
          </template>
          <ul class="space-y-1.5">
            <li v-for="(b, i) in sortedBands" :key="b.id" class="flex items-center gap-3 text-[13.5px]">
              <KBadge tone="brand" class="w-9 justify-center">{{ b.grade }}</KBadge>
              <span class="tabular-nums text-ink-muted">{{ bandRange(i) }}</span>
              <span class="ml-auto text-ink-muted">{{ b.remark }}</span>
            </li>
          </ul>
          <p class="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-muted">Class positions are {{ showPositions ? 'shown' : 'hidden' }} on results and report cards.</p>
        </KCard>
      </aside>
    </div>

    <KModal v-model:open="scaleOpen" title="Grading scale" description="Each grade applies from its starting score up to the next grade. One grade must start at 0." size="lg">
      <div class="space-y-2">
        <div class="grid grid-cols-[80px_120px_1fr_36px] gap-2 text-[12px] font-semibold tracking-wide text-ink-muted uppercase">
          <span>Grade</span><span>From</span><span>Remark</span><span />
        </div>
        <div v-for="(b, i) in draftBands" :key="i" class="grid grid-cols-[80px_120px_1fr_36px] items-center gap-2">
          <KInput v-model="b.grade" :aria-label="`Grade ${i + 1}`" />
          <KInput v-model="b.min_score" inputmode="decimal" :aria-label="`Starting score for grade ${i + 1}`" />
          <KInput v-model="b.remark" :aria-label="`Remark for grade ${i + 1}`" placeholder="Excellent" />
          <KButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove grade ${i + 1}`" :disabled="draftBands.length === 1" @click="draftBands.splice(i, 1)" />
        </div>
        <KButton size="sm" variant="ghost" :icon="Plus" @click="draftBands.push({ grade: '', min_score: '', remark: '' })">Add grade</KButton>
        <div class="mt-4 rounded-xl bg-surface-muted/60 p-4">
          <KCheckbox v-model="draftPositions" label="Show class positions" description="Some schools prefer not to rank students. Positions appear on results and report cards only when this is on." />
        </div>
      </div>
      <template #footer>
        <KButton variant="secondary" @click="scaleOpen = false">Cancel</KButton>
        <KButton :loading="working" @click="saveScale">Save scale</KButton>
      </template>
    </KModal>
  </div>
</template>
