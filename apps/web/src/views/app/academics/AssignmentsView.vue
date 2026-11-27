<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { CalendarClock, CheckCircle2, ChevronRight, NotebookPen, Paperclip, Plus, Search } from 'lucide-vue-next';
import {
  ASSIGNMENT_STATE_LABELS,
  SUBMISSION_STATUS_LABELS,
  assignmentState,
  type Assignment,
  type AssignmentState,
  type AssignmentSubmission,
  type ClassEnrollment,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import AssignmentFormModal from '@/components/academics/AssignmentFormModal.vue';
import { listAssignments, listSubmissions } from '@/services/academics';
import { listEnrollments } from '@/services/students';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

const { workspace, schoolId, slug, can, words } = useSchool();
const teaching = useTeaching();
const isStudentView = computed(() => !can('assignments.view') && workspace.isStudent);

const assignments = ref<Assignment[]>([]);
const submissions = ref<AssignmentSubmission[]>([]);
const enrollments = ref<ClassEnrollment[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const classIds = isStudentView.value ? [workspace.myStudent?.class_id].filter((x): x is string => Boolean(x)) : undefined;
    assignments.value = await listAssignments(schoolId.value, classIds);
    [submissions.value, enrollments.value] = await Promise.all([
      listSubmissions(assignments.value.map((a) => a.id)),
      isStudentView.value ? Promise.resolve([]) : listEnrollments(schoolId.value, { activeOnly: true }).catch(() => []),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const search = ref('');
const classFilter = ref('');
const stateFilter = ref<'' | AssignmentState>('');
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return assignments.value
    .filter((a) => (!q || a.title.toLowerCase().includes(q)) && (!classFilter.value || a.class_id === classFilter.value))
    .filter((a) => !stateFilter.value || assignmentState(a) === stateFilter.value)
    .sort((a, b) => {
      // Open work first (soonest due), then everything else newest first.
      const ao = assignmentState(a) === 'open' ? 0 : 1;
      const bo = assignmentState(b) === 'open' ? 0 : 1;
      return ao - bo || (ao === 0 ? a.due_at.localeCompare(b.due_at) : b.due_at.localeCompare(a.due_at));
    });
});

const classSize = (classId: string) => enrollments.value.filter((e) => e.class_id === classId).length;
const handedIn = (id: string) => submissions.value.filter((s) => s.assignment_id === id && s.submitted_at).length;
const graded = (id: string) => submissions.value.filter((s) => s.assignment_id === id && s.status === 'graded').length;
const mySubmission = (id: string) => submissions.value.find((s) => s.assignment_id === id && s.student_id === workspace.myStudent?.student_id);

const stateTone: Record<AssignmentState, 'neutral' | 'success' | 'warning' | 'info' | 'brand'> = {
  draft: 'neutral', open: 'success', past_due: 'warning', closed: 'info', graded: 'brand',
};
function due(a: Assignment) {
  const d = new Date(a.due_at);
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const when = d.toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  if (assignmentState(a) !== 'open') return `Due ${when}`;
  return days <= 0 ? `Due today, ${d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}` : days === 1 ? `Due tomorrow` : `Due in ${days} days`;
}

const formOpen = ref(false);
const canCreate = computed(() => can('assignments.create') && teaching.classesFor('assignments.create').length > 0);
</script>

<template>
  <div>
    <KPageHeader
      :icon="NotebookPen"
      eyebrow="Academics"
      :title="isStudentView ? 'My assignments' : 'Assignments'"
      :description="isStudentView ? 'Your homework and projects, with deadlines and feedback.' : `Set work for your ${words.groups.toLowerCase()}, collect submissions and give feedback.`"
    >
      <template #actions>
        <KButton v-if="canCreate" :icon="Plus" @click="formOpen = true">New assignment</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-5">{{ error }}</KAlert>

    <div class="mb-5 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row">
      <div class="sm:w-72"><KInput v-model="search" type="search" :icon="Search" placeholder="Search assignments" aria-label="Search assignments" /></div>
      <div v-if="!isStudentView" class="sm:w-56">
        <KSelect v-model="classFilter" :options="[{ value: '', label: `All ${words.groups.toLowerCase()}` }, ...teaching.classesFor('assignments.view').map((c) => ({ value: c.id, label: c.name }))]" aria-label="Class" />
      </div>
      <div class="sm:w-48">
        <KSelect v-model="stateFilter" :options="[{ value: '', label: 'Any status' }, ...Object.entries(ASSIGNMENT_STATE_LABELS).filter(([k]) => !isStudentView || k !== 'draft').map(([value, label]) => ({ value, label }))]" aria-label="Status" />
      </div>
    </div>

    <KSkeleton v-if="loading" :lines="6" />
    <div v-else-if="!assignments.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState
        :icon="NotebookPen"
        :title="isStudentView ? 'No assignments yet' : 'No assignments yet'"
        :description="isStudentView ? 'Work your teachers set appears here.' : 'Create an assignment, attach worksheets and publish it when you are ready.'"
      >
        <KButton v-if="canCreate" :icon="Plus" @click="formOpen = true">New assignment</KButton>
      </KEmptyState>
    </div>
    <div v-else-if="!filtered.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState compact :icon="Search" title="No assignments match" />
    </div>

    <ul v-else class="space-y-3">
      <li v-for="a in filtered" :key="a.id">
        <RouterLink
          :to="{ name: 'assignment-detail', params: { slug, assignmentId: a.id } }"
          class="group flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-hover sm:flex-row sm:items-center"
        >
          <KIconTile :icon="NotebookPen" :tone="assignmentState(a) === 'open' ? 'brand' : 'neutral'" :solid="assignmentState(a) === 'open'" :size="44" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-[15px] font-semibold group-hover:text-brand-ink">{{ a.title }}</p>
              <KBadge :tone="stateTone[assignmentState(a)]" dot>{{ ASSIGNMENT_STATE_LABELS[assignmentState(a)] }}</KBadge>
            </div>
            <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-muted">
              <span>{{ teaching.subjectName(a.subject_id) }}</span>
              <span v-if="!isStudentView">{{ teaching.className(a.class_id) }}</span>
              <span class="flex items-center gap-1"><CalendarClock :size="13" aria-hidden="true" /> {{ due(a) }}</span>
              <span v-if="a.attachment_paths.length" class="flex items-center gap-1"><Paperclip :size="13" aria-hidden="true" /> {{ a.attachment_paths.length }}</span>
              <span v-if="a.maximum_score">Out of {{ a.maximum_score }}</span>
            </p>
          </div>
          <div v-if="isStudentView" class="shrink-0">
            <KBadge v-if="mySubmission(a.id)?.status === 'graded'" tone="brand">
              <CheckCircle2 :size="12" aria-hidden="true" /> {{ mySubmission(a.id)!.score ?? 'Done' }}<template v-if="a.maximum_score && mySubmission(a.id)!.score !== null"> / {{ a.maximum_score }}</template>
            </KBadge>
            <KBadge v-else-if="mySubmission(a.id)" :tone="mySubmission(a.id)!.status === 'returned' ? 'warning' : 'success'" dot>
              {{ SUBMISSION_STATUS_LABELS[mySubmission(a.id)!.status] }}
            </KBadge>
            <KBadge v-else :tone="assignmentState(a) === 'open' ? 'neutral' : 'danger'">Not handed in</KBadge>
          </div>
          <div v-else-if="a.status !== 'draft'" class="shrink-0 text-right text-[13px]">
            <p><span class="font-semibold tabular-nums">{{ handedIn(a.id) }}</span><span class="text-ink-muted"> of {{ classSize(a.class_id) }} handed in</span></p>
            <p class="text-ink-muted"><span class="tabular-nums">{{ graded(a.id) }}</span> graded</p>
          </div>
          <ChevronRight :size="18" class="hidden shrink-0 text-ink-subtle sm:block" aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>

    <AssignmentFormModal v-model:open="formOpen" @saved="load" />
  </div>
</template>
