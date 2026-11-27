<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarClock, CheckCircle2, Download, FileText, Lock, NotebookPen, Paperclip, Pencil, RotateCcw, Send, Trash2, Undo2, X } from 'lucide-vue-next';
import {
  ASSIGNMENT_STATE_LABELS,
  SUBMISSION_STATUS_LABELS,
  assignmentState,
  studentName,
  type Assignment,
  type AssignmentSubmission,
  type Student,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import AssignmentFormModal from '@/components/academics/AssignmentFormModal.vue';
import {
  academicFileUrl,
  deleteAssignment,
  fileName,
  getAssignment,
  gradeSubmission,
  listSubmissions,
  setAssignmentStatus,
  submitAssignment,
  uploadAcademicFile,
} from '@/services/academics';
import { listEnrollments, listStudents } from '@/services/students';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

const route = useRoute();
const router = useRouter();
const { workspace, schoolId, slug, can, feedback, attempt } = useSchool();
const teaching = useTeaching();
const assignmentId = computed(() => String(route.params.assignmentId ?? ''));

const assignment = ref<Assignment | null>(null);
const submissions = ref<AssignmentSubmission[]>([]);
const students = ref<Student[]>([]);
const loading = ref(true);
const notFound = ref(false);

const me = computed(() => workspace.myStudent);
const isStudent = computed(() => Boolean(me.value && assignment.value && me.value.class_id === assignment.value.class_id));
const canManage = computed(
  () =>
    Boolean(assignment.value) &&
    can('assignments.edit') &&
    (teaching.taughtClassIds.value.has(assignment.value!.class_id) || can('academics.edit')),
);
const isStaffView = computed(() => can('assignments.view') && !isStudent.value);

async function load() {
  if (!schoolId.value || !assignmentId.value) return;
  loading.value = true;
  try {
    const a = await getAssignment(assignmentId.value);
    assignment.value = a;
    notFound.value = !a;
    if (!a) return;
    submissions.value = await listSubmissions([a.id]);
    if (!isStudent.value) {
      const [enrolled, all] = await Promise.all([listEnrollments(schoolId.value, { classId: a.class_id, activeOnly: true }), listStudents(schoolId.value)]);
      const ids = new Set(enrolled.map((e) => e.student_id));
      students.value = all.filter((s) => ids.has(s.id)).sort((x, y) => x.last_name.localeCompare(y.last_name));
    }
  } catch (e) {
    feedback.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
watch([schoolId, assignmentId], load, { immediate: true });

const state = computed(() => (assignment.value ? assignmentState(assignment.value) : 'draft'));
const submissionOf = (studentId: string) => submissions.value.find((s) => s.student_id === studentId);
const handedIn = computed(() => submissions.value.filter((s) => s.submitted_at).length);
const myChildrenHere = computed(() => workspace.children.filter((c) => c.class_id === assignment.value?.class_id));
const gradedCount = computed(() => submissions.value.filter((s) => s.status === 'graded').length);

async function openFile(path: string) {
  const url = await attempt(() => academicFileUrl(path));
  if (url) window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------------------
// Teacher actions
// ---------------------------------------------------------------------------
const editOpen = ref(false);

async function changeStatus(status: Assignment['status'], message: string) {
  await attempt(() => setAssignmentStatus(assignmentId.value, status), message);
  await load();
}

async function remove() {
  const ok = await feedback.confirm({ title: 'Delete this assignment?', description: 'Submissions and grades for it are deleted too.', confirmLabel: 'Delete', tone: 'danger' });
  if (!ok) return;
  const done = await attempt(async () => {
    await deleteAssignment(assignmentId.value);
    return true;
  }, 'Assignment deleted.');
  if (done) await router.push({ name: 'assignments', params: { slug: slug.value } });
}

const gradeOpen = ref(false);
const grading = ref<Student | null>(null);
const gradeScore = ref('');
const gradeFeedback = ref('');
const saving = ref(false);

function openGrade(student: Student) {
  const sub = submissionOf(student.id);
  grading.value = student;
  gradeScore.value = sub?.score !== null && sub?.score !== undefined ? String(sub.score) : '';
  gradeFeedback.value = sub?.feedback ?? '';
  gradeOpen.value = true;
}

async function saveGrade(returnForCorrection: boolean) {
  if (!grading.value || !assignment.value) return;
  const score = gradeScore.value.trim() === '' ? null : Number(gradeScore.value);
  if (score !== null && (Number.isNaN(score) || score < 0 || (assignment.value.maximum_score && score > assignment.value.maximum_score))) {
    feedback.error(`Enter a score between 0 and ${assignment.value.maximum_score ?? 'the maximum'}.`);
    return;
  }
  if (returnForCorrection && !gradeFeedback.value.trim()) {
    feedback.error('Tell the student what to correct.');
    return;
  }
  saving.value = true;
  const ok = await attempt(async () => {
    await gradeSubmission(assignment.value!.id, grading.value!.id, score, gradeFeedback.value, returnForCorrection);
    return true;
  }, returnForCorrection ? 'Returned to the student for correction.' : 'Grade saved.');
  saving.value = false;
  if (ok) {
    gradeOpen.value = false;
    await load();
  }
}

// ---------------------------------------------------------------------------
// Student actions
// ---------------------------------------------------------------------------
const mine = computed(() => (me.value ? submissionOf(me.value.student_id) : undefined));
const answer = ref('');
const myFiles = ref<string[]>([]);
const uploading = ref(false);
watch(mine, (s) => {
  answer.value = s?.body ?? '';
  myFiles.value = [...(s?.attachment_paths ?? [])];
}, { immediate: true });

const canSubmit = computed(() => {
  const a = assignment.value;
  if (!a || !isStudent.value || mine.value?.status === 'graded') return false;
  if (a.status !== 'published') return false;
  return new Date(a.due_at) > new Date() || a.allow_late;
});

async function addMyFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file || !assignment.value || !me.value) return;
  uploading.value = true;
  const path = await attempt(() => uploadAcademicFile(`${assignment.value!.school_id}/submissions/${assignment.value!.id}/${me.value!.student_id}`, file));
  uploading.value = false;
  if (path) myFiles.value = [...myFiles.value, path];
}

async function handIn() {
  saving.value = true;
  const ok = await attempt(async () => {
    await submitAssignment(assignmentId.value, answer.value, myFiles.value);
    return true;
  }, mine.value ? 'Your work has been resubmitted.' : 'Your work has been handed in.');
  saving.value = false;
  if (ok) await load();
}

const dueLabel = computed(() => (assignment.value ? new Date(assignment.value.due_at).toLocaleString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : ''));
const stateTone = { draft: 'neutral', open: 'success', past_due: 'warning', closed: 'info', graded: 'brand' } as const;
</script>

<template>
  <div>
    <KSkeleton v-if="loading" :lines="10" />
    <div v-else-if="notFound || !assignment" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="NotebookPen" title="This assignment could not be found">
        <KButton :to="{ name: 'assignments', params: { slug } }">Back to assignments</KButton>
      </KEmptyState>
    </div>

    <template v-else>
      <KPageHeader
        :icon="NotebookPen"
        :title="assignment.title"
        :description="`${teaching.subjectName(assignment.subject_id)}, ${teaching.className(assignment.class_id) || me?.class_name || ''}`"
        :breadcrumbs="[{ label: 'Assignments', to: { name: 'assignments', params: { slug } } }, { label: assignment.title }]"
      >
        <template #badge>
          <KBadge :tone="stateTone[state]" dot>{{ ASSIGNMENT_STATE_LABELS[state] }}</KBadge>
        </template>
        <template v-if="canManage" #actions>
          <KButton variant="secondary" :icon="Pencil" @click="editOpen = true">Edit</KButton>
          <KButton v-if="assignment.status === 'draft'" :icon="Send" @click="changeStatus('published', 'Published to students.')">Publish</KButton>
          <KButton v-else-if="assignment.status === 'published'" variant="secondary" :icon="Lock" @click="changeStatus('closed', 'Closed for submissions.')">Close</KButton>
          <KButton v-else-if="assignment.status === 'closed'" variant="secondary" :icon="RotateCcw" @click="changeStatus('published', 'Reopened for submissions.')">Reopen</KButton>
          <KButton v-if="assignment.status === 'closed'" :icon="CheckCircle2" @click="changeStatus('graded', 'Marked as graded.')">Mark as graded</KButton>
          <KButton v-if="can('assignments.delete')" variant="ghost" :icon="Trash2" class="text-danger-ink hover:bg-danger-soft" aria-label="Delete assignment" @click="remove" />
        </template>
      </KPageHeader>

      <div class="grid gap-6 lg:grid-cols-3">
        <div class="space-y-6 lg:col-span-2">
          <KCard title="Instructions" :icon="FileText">
            <p v-if="assignment.description" class="text-[14px] leading-relaxed whitespace-pre-line">{{ assignment.description }}</p>
            <p v-else class="text-[13.5px] text-ink-muted">No written instructions.</p>
            <ul v-if="assignment.attachment_paths.length" class="mt-4 grid gap-2 sm:grid-cols-2">
              <li v-for="path in assignment.attachment_paths" :key="path">
                <button type="button" class="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-[13.5px] hover:border-brand/40 hover:bg-brand-soft/40" @click="openFile(path)">
                  <Download :size="15" class="text-brand-ink" aria-hidden="true" />
                  <span class="truncate">{{ fileName(path) }}</span>
                </button>
              </li>
            </ul>
          </KCard>

          <!-- Student: hand in work -->
          <KCard v-if="isStudent" title="Your work" :icon="Send" tone="success">
            <div v-if="mine?.status === 'graded'" class="rounded-xl bg-brand-soft p-4">
              <p class="text-[13px] text-brand-ink">Graded</p>
              <p class="text-[26px] font-semibold tabular-nums">{{ mine.score ?? 'Done' }}<span v-if="assignment.maximum_score && mine.score !== null" class="text-[16px] text-ink-muted"> / {{ assignment.maximum_score }}</span></p>
              <p v-if="mine.feedback" class="mt-2 text-[14px] whitespace-pre-line">{{ mine.feedback }}</p>
            </div>
            <KAlert v-else-if="mine?.status === 'returned'" tone="warning" title="Returned for correction" class="mb-4">{{ mine.feedback }}</KAlert>
            <KAlert v-else-if="mine" tone="success" class="mb-4">
              Handed in {{ new Date(mine.submitted_at!).toLocaleString('en-NG') }}<template v-if="mine.is_late">, after the deadline</template>.
              <template v-if="canSubmit"> You can still change it.</template>
            </KAlert>

            <template v-if="mine?.status !== 'graded'">
              <div v-if="canSubmit" class="space-y-3">
                <KTextarea v-model="answer" label="Your answer" :rows="6" placeholder="Type your answer here, or attach your work below." />
                <ul v-if="myFiles.length" class="space-y-1.5">
                  <li v-for="(path, i) in myFiles" :key="path" class="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-[13px]">
                    <Paperclip :size="14" class="text-ink-subtle" aria-hidden="true" />
                    <button type="button" class="min-w-0 flex-1 truncate text-left hover:underline" @click="openFile(path)">{{ fileName(path) }}</button>
                    <button type="button" class="text-ink-subtle hover:text-danger-ink" :aria-label="`Remove ${fileName(path)}`" @click="myFiles.splice(i, 1)"><X :size="15" /></button>
                  </li>
                </ul>
                <div class="flex flex-wrap items-center gap-2">
                  <label class="inline-flex cursor-pointer items-center gap-2 rounded-control border border-dashed border-line-strong px-3 py-2 text-[13px] text-ink-muted hover:text-ink">
                    <Paperclip :size="15" aria-hidden="true" /> {{ uploading ? 'Uploading' : 'Attach a file' }}
                    <input type="file" class="sr-only" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,image/*" @change="addMyFile" />
                  </label>
                  <KButton class="ml-auto" :icon="Send" :loading="saving" @click="handIn">{{ mine ? 'Resubmit' : 'Hand in' }}</KButton>
                </div>
              </div>
              <p v-else class="flex items-center gap-2 text-[13.5px] text-ink-muted">
                <Lock :size="15" aria-hidden="true" /> This assignment is no longer accepting work.
              </p>
            </template>
          </KCard>

          <!-- Guardians: their own children's progress -->
          <KCard v-if="!isStaffView && !isStudent && myChildrenHere.length" title="Your child's work" :icon="CheckCircle2" tone="success">
            <ul class="space-y-3">
              <li v-for="child in myChildrenHere" :key="child.student_id" class="flex flex-wrap items-center gap-3">
                <span class="font-medium">{{ child.first_name }} {{ child.last_name }}</span>
                <KBadge v-if="!submissionOf(child.student_id)" :tone="state === 'open' ? 'neutral' : 'danger'">Not handed in</KBadge>
                <KBadge v-else :tone="submissionOf(child.student_id)!.status === 'graded' ? 'brand' : 'success'" dot>
                  {{ SUBMISSION_STATUS_LABELS[submissionOf(child.student_id)!.status] }}<template v-if="submissionOf(child.student_id)!.score !== null">: {{ submissionOf(child.student_id)!.score }}<template v-if="assignment.maximum_score"> / {{ assignment.maximum_score }}</template></template>
                </KBadge>
                <p v-if="submissionOf(child.student_id)?.feedback" class="w-full text-[13.5px] text-ink-muted">{{ submissionOf(child.student_id)!.feedback }}</p>
              </li>
            </ul>
          </KCard>

          <!-- Staff: submissions -->
          <KCard v-if="isStaffView" title="Submissions" :description="`${handedIn} of ${students.length} handed in, ${gradedCount} graded`" :padded="false">
            <KEmptyState v-if="!students.length" compact :icon="NotebookPen" title="No students in this class" />
            <div v-else class="overflow-x-auto">
              <table class="k-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Status</th>
                    <th scope="col" class="hidden sm:table-cell">Handed in</th>
                    <th scope="col">Score</th>
                    <th scope="col"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in students" :key="s.id">
                    <td>
                      <div class="flex items-center gap-2.5">
                        <KAvatar :name="studentName(s)" :size="30" />
                        <span class="font-medium">{{ studentName(s) }}</span>
                      </div>
                    </td>
                    <td>
                      <KBadge v-if="!submissionOf(s.id)" :tone="state === 'open' ? 'neutral' : 'danger'">Not handed in</KBadge>
                      <KBadge v-else :tone="submissionOf(s.id)!.status === 'graded' ? 'brand' : submissionOf(s.id)!.status === 'returned' ? 'warning' : 'success'" dot>
                        {{ SUBMISSION_STATUS_LABELS[submissionOf(s.id)!.status] }}
                      </KBadge>
                      <KBadge v-if="submissionOf(s.id)?.is_late" tone="warning" class="ml-1">Late</KBadge>
                    </td>
                    <td class="hidden text-[13px] text-ink-muted sm:table-cell">{{ submissionOf(s.id)?.submitted_at ? new Date(submissionOf(s.id)!.submitted_at!).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not yet' }}</td>
                    <td class="tabular-nums">{{ submissionOf(s.id)?.score ?? '' }}<template v-if="submissionOf(s.id)?.score !== null && submissionOf(s.id)?.score !== undefined && assignment.maximum_score"> / {{ assignment.maximum_score }}</template></td>
                    <td class="text-right">
                      <KButton v-if="canManage" size="sm" :variant="submissionOf(s.id)?.status === 'submitted' ? 'primary' : 'ghost'" @click="openGrade(s)">
                        {{ submissionOf(s.id)?.status === 'graded' ? 'Review' : 'Grade' }}
                      </KButton>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </KCard>
        </div>

        <aside class="space-y-4">
          <div class="k-bg-hero relative overflow-hidden rounded-card p-5 text-white shadow-hover">
            <div class="k-dots-light absolute inset-0" aria-hidden="true" />
            <p class="relative flex items-center gap-2 text-[13px] text-[#C7D2E3]"><CalendarClock :size="15" aria-hidden="true" /> Due</p>
            <p class="relative mt-1 text-[17px] font-semibold">{{ dueLabel }}</p>
            <p class="relative mt-3 text-[13px] text-[#C7D2E3]">
              {{ assignment.maximum_score ? `Marked out of ${assignment.maximum_score}` : 'Not scored' }}.
              {{ assignment.allow_late ? 'Late work is accepted.' : 'Late work is not accepted.' }}
            </p>
          </div>
          <div v-if="isStaffView && students.length" class="rounded-card border border-line bg-surface p-5 shadow-card">
            <p class="text-[13px] text-ink-muted">Handed in</p>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
              <div class="k-bg-brand h-full rounded-full" :style="{ width: `${Math.round((handedIn / students.length) * 100)}%` }" />
            </div>
            <p class="mt-2 text-[13px]"><span class="font-semibold tabular-nums">{{ handedIn }}</span> of {{ students.length }} students</p>
          </div>
        </aside>
      </div>

      <AssignmentFormModal v-model:open="editOpen" :assignment="assignment" @saved="load" />

      <KModal v-model:open="gradeOpen" :title="grading ? studentName(grading) : ''" :description="assignment.title" size="lg">
        <div v-if="grading" class="space-y-4">
          <div v-if="submissionOf(grading.id)?.body || submissionOf(grading.id)?.attachment_paths.length" class="rounded-xl border border-line bg-surface-muted/50 p-4">
            <p class="mb-2 text-[12.5px] font-semibold tracking-wide text-ink-muted uppercase">Their work</p>
            <p v-if="submissionOf(grading.id)?.body" class="text-[14px] whitespace-pre-line">{{ submissionOf(grading.id)!.body }}</p>
            <ul class="mt-2 flex flex-wrap gap-2">
              <li v-for="path in submissionOf(grading.id)?.attachment_paths ?? []" :key="path">
                <KButton size="sm" variant="secondary" :icon="Download" @click="openFile(path)">{{ fileName(path) }}</KButton>
              </li>
            </ul>
          </div>
          <KAlert v-else tone="info">Nothing has been handed in online. You can still record a grade for work handed in on paper.</KAlert>
          <KInput v-model="gradeScore" :label="assignment.maximum_score ? `Score out of ${assignment.maximum_score}` : 'Score'" inputmode="decimal" optional />
          <KTextarea v-model="gradeFeedback" label="Feedback" :rows="4" placeholder="What went well, and what to improve" optional />
        </div>
        <template #footer>
          <KButton v-if="grading && submissionOf(grading.id)?.submitted_at" variant="ghost" :icon="Undo2" class="mr-auto" :loading="saving" @click="saveGrade(true)">Return for correction</KButton>
          <KButton variant="secondary" @click="gradeOpen = false">Cancel</KButton>
          <KButton :icon="CheckCircle2" :loading="saving" @click="saveGrade(false)">Save grade</KButton>
        </template>
      </KModal>
    </template>
  </div>
</template>
