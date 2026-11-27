<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CheckCircle2, ClipboardList, Save, Send, ShieldAlert, Trash2, Undo2 } from 'lucide-vue-next';
import {
  ASSESSMENT_STATUS_LABELS,
  ASSESSMENT_TYPE_LABELS,
  gradeFor,
  studentName,
  type Assessment,
  type GradingBand,
  type Student,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KModal from '@/components/ui/KModal.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import {
  deleteAssessment,
  getAssessment,
  listGradingBands,
  listScores,
  publishAssessments,
  reviewAssessment,
  saveScores,
  submitAssessment,
} from '@/services/academics';
import { listEnrollments, listStudents } from '@/services/students';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

const route = useRoute();
const router = useRouter();
const { schoolId, slug, can, feedback, attempt } = useSchool();
const teaching = useTeaching();
const assessmentId = computed(() => String(route.params.assessmentId ?? ''));

const assessment = ref<Assessment | null>(null);
const students = ref<Student[]>([]);
const bands = ref<GradingBand[]>([]);
const rows = reactive<Record<string, { score: string; absent: boolean; remarks: string }>>({});
const dirty = ref(false);
const loading = ref(true);
const saving = ref(false);

async function load() {
  if (!schoolId.value || !assessmentId.value) return;
  loading.value = true;
  try {
    const a = await getAssessment(assessmentId.value);
    assessment.value = a;
    if (!a) return;
    const term = teaching.terms.value.find((t) => t.id === a.term_id);
    const [enrolled, all, scores, scale] = await Promise.all([
      listEnrollments(schoolId.value, { classId: a.class_id }),
      listStudents(schoolId.value),
      listScores([a.id]),
      listGradingBands(schoolId.value),
    ]);
    // Everyone in the class during the term, so leavers keep their scores.
    const ids = new Set(
      enrolled
        .filter((e) => !term || (e.start_date <= term.end_date && (!e.end_date || e.end_date >= term.start_date)))
        .map((e) => e.student_id),
    );
    for (const s of scores) ids.add(s.student_id);
    students.value = all.filter((s) => ids.has(s.id)).sort((x, y) => x.last_name.localeCompare(y.last_name) || x.first_name.localeCompare(y.first_name));
    bands.value = scale;
    for (const key of Object.keys(rows)) delete rows[key];
    for (const s of students.value) {
      const sc = scores.find((x) => x.student_id === s.id);
      rows[s.id] = { score: sc?.score !== null && sc?.score !== undefined ? String(Number(sc.score)) : '', absent: sc?.is_absent ?? false, remarks: sc?.remarks ?? '' };
    }
    dirty.value = false;
  } catch (e) {
    feedback.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
watch([schoolId, assessmentId, () => teaching.loaded.value], load, { immediate: true });

const max = computed(() => Number(assessment.value?.maximum_score ?? 100));
const status = computed(() => assessment.value?.status ?? 'draft');
const isTeacher = computed(() => {
  const a = assessment.value;
  if (!a) return false;
  const teaches = teaching.subjectsFor(a.class_id, 'examinations.create').some((s) => s.id === a.subject_id);
  return (can('examinations.create') || can('examinations.edit')) && (teaches || can('academics.edit'));
});
const isApprover = computed(() => can('examinations.approve'));
const editable = computed(() => (['draft', 'returned'].includes(status.value) ? isTeacher.value || isApprover.value : isApprover.value));

function invalid(id: string) {
  const r = rows[id];
  if (!r || r.absent || r.score.trim() === '') return false;
  const n = Number(r.score);
  return Number.isNaN(n) || n < 0 || n > max.value;
}
const percent = (id: string) => {
  const r = rows[id];
  if (!r || r.absent || r.score.trim() === '' || invalid(id)) return null;
  return (Number(r.score) / max.value) * 100;
};

const stats = computed(() => {
  const values = students.value.map((s) => percent(s.id)).filter((v): v is number => v !== null);
  const enteredCount = students.value.filter((s) => rows[s.id]?.absent || rows[s.id]?.score.trim()).length;
  return {
    entered: enteredCount,
    average: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    highest: values.length ? Math.round(Math.max(...values)) : null,
    lowest: values.length ? Math.round(Math.min(...values)) : null,
  };
});
const distribution = computed(() => {
  const counts = new Map<string, number>();
  for (const s of students.value) {
    const g = gradeFor(bands.value, percent(s.id));
    if (g) counts.set(g.grade, (counts.get(g.grade) ?? 0) + 1);
  }
  return [...bands.value].sort((a, b) => Number(b.min_score) - Number(a.min_score)).map((b) => ({ grade: b.grade, count: counts.get(b.grade) ?? 0 }));
});

function next(event: KeyboardEvent, index: number) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  document.querySelector<HTMLInputElement>(`[data-score-index="${index + 1}"]`)?.focus();
}

async function save(quiet = false): Promise<boolean> {
  if (students.value.some((s) => invalid(s.id))) {
    feedback.error(`Scores must be between 0 and ${max.value}.`);
    return false;
  }
  saving.value = true;
  const ok = await attempt(async () => {
    await saveScores(
      assessmentId.value,
      students.value.map((s) => ({
        student_id: s.id,
        score: rows[s.id]!.absent || rows[s.id]!.score.trim() === '' ? null : Number(rows[s.id]!.score),
        is_absent: rows[s.id]!.absent,
        remarks: rows[s.id]!.remarks,
      })),
    );
    return true;
  }, quiet ? undefined : 'Scores saved.');
  saving.value = false;
  if (ok) dirty.value = false;
  return Boolean(ok);
}

async function submitForReview() {
  if (stats.value.entered < students.value.length) {
    const ok = await feedback.confirm({
      title: 'Some scores are missing',
      description: `${students.value.length - stats.value.entered} students have no score. Submit anyway? Mark them absent if they missed it.`,
      confirmLabel: 'Submit anyway',
      tone: 'primary',
    });
    if (!ok) return;
  }
  if (dirty.value && !(await save(true))) return;
  await attempt(() => submitAssessment(assessmentId.value), 'Submitted for review.');
  await load();
}

async function approve(andPublish: boolean) {
  if (dirty.value && !(await save(true))) return;
  await attempt(async () => {
    if (status.value === 'submitted') await reviewAssessment(assessmentId.value, true, '');
    if (andPublish) await publishAssessments([assessmentId.value]);
  }, andPublish ? 'Results published to students and guardians.' : 'Results approved.');
  await load();
}

const returnOpen = ref(false);
const returnNote = ref('');
async function sendBack() {
  if (!returnNote.value.trim()) {
    feedback.error('Explain what needs correcting.');
    return;
  }
  const ok = await attempt(async () => {
    await reviewAssessment(assessmentId.value, false, returnNote.value);
    return true;
  }, 'Returned to the teacher.');
  if (ok) {
    returnOpen.value = false;
    returnNote.value = '';
    await load();
  }
}

async function remove() {
  const ok = await feedback.confirm({ title: 'Delete this assessment?', description: 'Its scores are deleted too.', confirmLabel: 'Delete', tone: 'danger' });
  if (!ok) return;
  const done = await attempt(async () => {
    await deleteAssessment(assessmentId.value);
    return true;
  }, 'Assessment deleted.');
  if (done) await router.push({ name: 'assessments', params: { slug: slug.value } });
}

const statusTone = { draft: 'neutral', submitted: 'info', returned: 'warning', approved: 'success', published: 'brand' } as const;
</script>

<template>
  <div>
    <KSkeleton v-if="loading" :lines="10" />
    <div v-else-if="!assessment" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="ClipboardList" title="This assessment could not be found">
        <KButton :to="{ name: 'assessments', params: { slug } }">Back to assessments</KButton>
      </KEmptyState>
    </div>

    <template v-else>
      <KPageHeader
        :icon="ClipboardList"
        :title="assessment.title"
        :description="`${teaching.subjectName(assessment.subject_id)}, ${teaching.className(assessment.class_id)}, ${teaching.termLabel(assessment.term_id)}`"
        :breadcrumbs="[{ label: 'Assessments', to: { name: 'assessments', params: { slug } } }, { label: assessment.title }]"
      >
        <template #badge><KBadge :tone="statusTone[status]" dot>{{ ASSESSMENT_STATUS_LABELS[status] }}</KBadge></template>
        <template #actions>
          <KButton v-if="editable" variant="secondary" :icon="Save" :loading="saving" :disabled="!dirty" @click="save()">Save scores</KButton>
          <KButton v-if="isTeacher && ['draft', 'returned'].includes(status)" :icon="Send" @click="submitForReview">Submit for review</KButton>
          <template v-if="isApprover && ['submitted', 'approved'].includes(status)">
            <KButton variant="ghost" :icon="Undo2" @click="returnOpen = true">Return</KButton>
            <KButton v-if="status === 'submitted'" variant="secondary" :icon="CheckCircle2" @click="approve(false)">Approve</KButton>
            <KButton :icon="Send" @click="approve(true)">{{ status === 'approved' ? 'Publish' : 'Approve and publish' }}</KButton>
          </template>
          <KButton v-if="isTeacher && ['draft', 'returned'].includes(status) && can('examinations.delete')" variant="ghost" :icon="Trash2" class="text-danger-ink hover:bg-danger-soft" aria-label="Delete assessment" @click="remove" />
        </template>
      </KPageHeader>

      <KAlert v-if="status === 'returned' && assessment.review_note" tone="warning" title="Returned for correction" class="mb-5">{{ assessment.review_note }}</KAlert>
      <KAlert v-else-if="status === 'submitted' && !isApprover" tone="info" class="mb-5">Waiting for the principal to review. Scores are locked until then.</KAlert>
      <KAlert v-else-if="status === 'published'" :tone="isApprover ? 'warning' : 'success'" class="mb-5" :title="isApprover ? 'These results are published' : 'Published'">
        <template v-if="isApprover"><ShieldAlert :size="14" class="mr-1 inline" aria-hidden="true" />Changes are visible to families immediately and recorded in the audit log.</template>
        <template v-else>Students and guardians can see these results.</template>
      </KAlert>

      <div class="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div class="min-w-0 rounded-card border border-line bg-surface shadow-card">
          <KEmptyState v-if="!students.length" compact :icon="ClipboardList" title="No students in this class for the term" />
          <div v-else class="overflow-x-auto">
            <table class="k-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Score / {{ max }}</th>
                  <th scope="col">Absent</th>
                  <th scope="col">Grade</th>
                  <th scope="col" class="hidden md:table-cell">Remark</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, index) in students" :key="s.id">
                  <td>
                    <div class="flex items-center gap-2.5">
                      <KAvatar :name="studentName(s)" :size="30" />
                      <span class="font-medium">{{ studentName(s) }}</span>
                    </div>
                  </td>
                  <td>
                    <input
                      v-model="rows[s.id]!.score"
                      :data-score-index="index"
                      inputmode="decimal"
                      :disabled="!editable || rows[s.id]!.absent"
                      :aria-label="`Score for ${studentName(s)}`"
                      :aria-invalid="invalid(s.id) ? 'true' : undefined"
                      :class="[
                        'h-9 w-24 rounded-control border bg-surface px-2.5 text-right text-[14px] font-medium tabular-nums outline-none focus:border-brand focus:ring-4 focus:ring-focus disabled:bg-surface-muted',
                        invalid(s.id) ? 'border-danger' : 'border-line-strong',
                      ]"
                      @input="dirty = true"
                      @keydown="next($event, index)"
                    />
                  </td>
                  <td>
                    <KCheckbox
                      :model-value="rows[s.id]!.absent"
                      :disabled="!editable"
                      :aria-label="`${studentName(s)} was absent`"
                      @update:model-value="(rows[s.id]!.absent = $event), $event && (rows[s.id]!.score = ''), (dirty = true)"
                    />
                  </td>
                  <td>
                    <KBadge v-if="rows[s.id]!.absent" tone="warning">Absent</KBadge>
                    <KBadge v-else-if="gradeFor(bands, percent(s.id))" tone="brand">{{ gradeFor(bands, percent(s.id))!.grade }}</KBadge>
                  </td>
                  <td class="hidden md:table-cell">
                    <input
                      v-model="rows[s.id]!.remarks"
                      :disabled="!editable"
                      :aria-label="`Remark for ${studentName(s)}`"
                      placeholder="Optional"
                      class="h-9 w-full min-w-40 rounded-control border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-brand focus:ring-4 focus:ring-focus disabled:bg-surface-muted"
                      @input="dirty = true"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <aside class="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div class="k-bg-hero relative overflow-hidden rounded-card p-5 text-white shadow-hover">
            <div class="k-dots-light absolute inset-0" aria-hidden="true" />
            <p class="relative text-[13px] text-[#C7D2E3]">{{ ASSESSMENT_TYPE_LABELS[assessment.assessment_type] }}</p>
            <p class="relative mt-1 text-[15px] font-semibold">Out of {{ max }}, counts {{ Number(assessment.weight) }}% of the term total</p>
            <div class="relative mt-4 grid grid-cols-3 gap-2 text-center">
              <div v-for="[label, value] in [['Average', stats.average], ['Highest', stats.highest], ['Lowest', stats.lowest]]" :key="String(label)" class="rounded-lg bg-white/10 px-2 py-2 ring-1 ring-white/10">
                <p class="text-[11px] text-[#C7D2E3]">{{ label }}</p>
                <p class="text-[17px] font-semibold tabular-nums">{{ value === null ? 'None' : `${value}%` }}</p>
              </div>
            </div>
            <p class="relative mt-3 text-[12.5px] text-[#C7D2E3]">{{ stats.entered }} of {{ students.length }} recorded</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-5 shadow-card">
            <p class="text-[14px] font-semibold">Grade spread</p>
            <ul class="mt-3 space-y-2">
              <li v-for="d in distribution" :key="d.grade" class="flex items-center gap-2 text-[13px]">
                <span class="w-6 font-semibold">{{ d.grade }}</span>
                <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div class="k-bg-brand h-full rounded-full" :style="{ width: `${students.length ? (d.count / students.length) * 100 : 0}%` }" />
                </div>
                <span class="w-6 text-right tabular-nums text-ink-muted">{{ d.count }}</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <KModal v-model:open="returnOpen" title="Return for correction" description="The teacher sees your note and can edit the scores again.">
        <KTextarea v-model="returnNote" label="What needs correcting?" :rows="4" autofocus />
        <template #footer>
          <KButton variant="secondary" @click="returnOpen = false">Cancel</KButton>
          <KButton :icon="Undo2" @click="sendBack">Return to teacher</KButton>
        </template>
      </KModal>
    </template>
  </div>
</template>
