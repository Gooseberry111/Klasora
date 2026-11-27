<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { CalendarCheck, CheckCircle2, FileText, NotebookPen, Trophy } from 'lucide-vue-next';
import {
  ASSIGNMENT_STATE_LABELS,
  ATTENDANCE_STATUS_LABELS,
  SUBMISSION_STATUS_LABELS,
  assignmentState,
  attendanceRate,
  formatDmy,
  isoDate,
  ordinal,
  type Assignment,
  type AssignmentSubmission,
  type ReportCard,
  type StudentAttendanceRow,
  type StudentResultRow,
} from '@klasora/shared';
import KCard from '@/components/ui/KCard.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { listAssignments, listReportCards, listSubmissions, studentAttendance, studentResults } from '@/services/academics';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

/** Attendance, assignments and results for one student. Each list follows the database's own access rules. */
const props = defineProps<{ kind: 'attendance' | 'assignments' | 'results'; studentId: string; classId: string | null }>();
const { schoolId, slug, words } = useSchool();
const teaching = useTeaching();
const loading = ref(true);
const error = ref('');

// Attendance
const attendance = ref<StudentAttendanceRow[]>([]);
// Assignments
const assignments = ref<Assignment[]>([]);
const submissions = ref<AssignmentSubmission[]>([]);
// Results
const termId = ref('');
const results = ref<StudentResultRow[]>([]);
const cards = ref<ReportCard[]>([]);
watch(teaching.currentTerm, (t) => {
  if (!termId.value && t) termId.value = t.id;
}, { immediate: true });

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    if (props.kind === 'attendance') {
      const term = teaching.currentTerm.value;
      const from = term?.start_date ?? isoDate(new Date(Date.now() - 90 * 86_400_000));
      attendance.value = await studentAttendance(props.studentId, from, isoDate(new Date()));
    } else if (props.kind === 'assignments') {
      assignments.value = props.classId ? (await listAssignments(schoolId.value, [props.classId])).filter((a) => a.status !== 'draft') : [];
      submissions.value = (await listSubmissions(assignments.value.map((a) => a.id))).filter((s) => s.student_id === props.studentId);
    } else if (termId.value) {
      [results.value, cards.value] = await Promise.all([
        studentResults(props.studentId, termId.value),
        listReportCards(schoolId.value, { studentId: props.studentId }),
      ]);
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([() => props.kind, () => props.studentId, termId, () => teaching.loaded.value], load, { immediate: true });

const counts = computed(() => {
  const c = { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
  for (const r of attendance.value.filter((x) => x.session_type === 'daily' || x.session_type === 'morning')) {
    c[r.status] += 1;
    c.total += 1;
  }
  return c;
});
const exceptions = computed(() => attendance.value.filter((r) => r.status !== 'present').slice(0, 30));
const statusTone = { present: 'success', absent: 'danger', late: 'warning', excused: 'info' } as const;

const submissionFor = (id: string) => submissions.value.find((s) => s.assignment_id === id);
const average = computed(() => (results.value.length ? Math.round((results.value.reduce((a, r) => a + r.total, 0) / results.value.length) * 100) / 100 : null));
const cardForTerm = computed(() => cards.value.find((c) => c.term_id === termId.value) ?? null);
</script>

<template>
  <div>
    <p v-if="error" class="mb-4 rounded-xl bg-danger-soft p-4 text-[13.5px] text-danger-ink">{{ error }}</p>
    <KSkeleton v-if="loading" :lines="6" />

    <!-- Attendance -->
    <div v-else-if="kind === 'attendance'" class="space-y-5">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
          <KIconTile :icon="CalendarCheck" tone="success" solid :size="40" />
          <div>
            <p class="text-[12.5px] text-ink-muted">Attendance this {{ words.period.toLowerCase() }}</p>
            <p class="text-[22px] font-semibold tabular-nums">{{ attendanceRate(counts) === null ? 'None' : `${attendanceRate(counts)}%` }}</p>
          </div>
        </div>
        <div v-for="k in (['absent', 'late', 'excused'] as const)" :key="k" class="rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="text-[12.5px] text-ink-muted">{{ ATTENDANCE_STATUS_LABELS[k] }}</p>
          <p class="text-[22px] font-semibold tabular-nums">{{ counts[k] }}</p>
          <p class="text-[12px] text-ink-subtle">of {{ counts.total }} days</p>
        </div>
      </div>
      <KCard title="Absences and late arrivals" :icon="CalendarCheck" :padded="false">
        <KEmptyState v-if="!exceptions.length" compact :icon="CheckCircle2" :title="counts.total ? 'Present every day recorded' : 'No attendance recorded yet'" />
        <ul v-else class="divide-y divide-line">
          <li v-for="(r, i) in exceptions" :key="i" class="flex flex-wrap items-center gap-3 px-5 py-3">
            <span class="w-28 tabular-nums text-ink-muted">{{ formatDmy(r.attendance_date) }}</span>
            <KBadge :tone="statusTone[r.status]" dot>{{ ATTENDANCE_STATUS_LABELS[r.status] }}</KBadge>
            <span v-if="r.subject_id" class="text-[13px] text-ink-muted">{{ teaching.subjectName(r.subject_id) }}</span>
            <span v-if="r.remarks" class="text-[13px] text-ink-muted">{{ r.remarks }}</span>
          </li>
        </ul>
      </KCard>
    </div>

    <!-- Assignments -->
    <KCard v-else-if="kind === 'assignments'" title="Assignments" :description="classId ? `Work set for ${teaching.className(classId) || 'their class'}` : undefined" :icon="NotebookPen" :padded="false">
      <KEmptyState v-if="!assignments.length" compact :icon="NotebookPen" title="No assignments yet" />
      <ul v-else class="divide-y divide-line">
        <li v-for="a in assignments" :key="a.id">
          <RouterLink :to="{ name: 'assignment-detail', params: { slug, assignmentId: a.id } }" class="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-surface-muted/50">
            <div class="min-w-0 flex-1">
              <p class="font-medium">{{ a.title }}</p>
              <p class="text-[12.5px] text-ink-muted">{{ teaching.subjectName(a.subject_id) }}, due {{ new Date(a.due_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) }}</p>
            </div>
            <KBadge v-if="submissionFor(a.id)" :tone="submissionFor(a.id)!.status === 'graded' ? 'brand' : 'success'" dot>
              {{ SUBMISSION_STATUS_LABELS[submissionFor(a.id)!.status] }}<template v-if="submissionFor(a.id)!.score !== null">: {{ submissionFor(a.id)!.score }}<template v-if="a.maximum_score"> / {{ a.maximum_score }}</template></template>
            </KBadge>
            <KBadge v-else :tone="assignmentState(a) === 'open' ? 'neutral' : 'danger'">{{ assignmentState(a) === 'open' ? ASSIGNMENT_STATE_LABELS.open : 'Not handed in' }}</KBadge>
          </RouterLink>
        </li>
      </ul>
    </KCard>

    <!-- Results -->
    <div v-else class="space-y-5">
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-64"><KSelect v-model="termId" :label="words.period" :options="teaching.terms.value.map((t) => ({ value: t.id, label: teaching.termLabel(t.id) }))" placeholder="Choose" /></div>
        <RouterLink
          v-if="cardForTerm"
          :to="{ name: 'report-card', params: { slug, reportCardId: cardForTerm.id } }"
          class="k-bg-brand ml-auto inline-flex h-10 items-center gap-2 rounded-control px-4 text-sm font-medium text-white shadow-brand"
        >
          <FileText :size="16" aria-hidden="true" /> Report card
        </RouterLink>
      </div>
      <KCard title="Published results" :description="average !== null ? `Average ${average}` : undefined" :icon="Trophy" tone="violet" :padded="false">
        <KEmptyState v-if="!results.length" compact :icon="Trophy" title="No published results for this term" description="Results appear here once the school publishes them." />
        <div v-else class="overflow-x-auto">
          <table class="k-table">
            <thead>
              <tr>
                <th scope="col">{{ words.subject }}</th>
                <th scope="col" class="text-center">Score</th>
                <th scope="col" class="text-center">Grade</th>
                <th scope="col">Remark</th>
                <th scope="col" class="text-center">Class average</th>
                <th v-if="results.some((r) => r.subject_position)" scope="col" class="text-center">Position</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in results" :key="r.subject_id">
                <td class="font-medium">{{ r.subject_name }}</td>
                <td class="text-center font-semibold tabular-nums">{{ r.total }}</td>
                <td class="text-center"><KBadge tone="brand">{{ r.grade }}</KBadge></td>
                <td class="text-ink-muted">{{ r.remark }}</td>
                <td class="text-center tabular-nums text-ink-muted">{{ r.class_average }}</td>
                <td v-if="results.some((x) => x.subject_position)" class="text-center tabular-nums">{{ r.subject_position ? `${ordinal(r.subject_position)} of ${r.class_size}` : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </KCard>
    </div>
  </div>
</template>
