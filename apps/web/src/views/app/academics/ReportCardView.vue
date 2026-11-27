<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarCheck, Download, FileText, MessageSquareQuote, Save } from 'lucide-vue-next';
import { attendanceRate, ordinal, studentName, type ReportCard, type School, type Student } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import { fetchSchool } from '@/services/workspace';
import { getStudent } from '@/services/students';
import { getReportCard, getShowPositions, saveReportComment } from '@/services/academics';
import { downloadReportCardPdf } from '@/lib/reportCardPdf';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

const route = useRoute();
const { workspace, schoolId, slug, can, attempt } = useSchool();
const teaching = useTeaching();
const id = computed(() => String(route.params.reportCardId ?? ''));

const card = ref<ReportCard | null>(null);
const school = ref<School | null>(null);
const student = ref<Student | null>(null);
const showPositions = ref(false);
const loading = ref(true);
const teacherComment = ref('');
const principalComment = ref('');
const saving = ref<string | null>(null);
const downloading = ref(false);

async function load() {
  if (!schoolId.value || !id.value) return;
  loading.value = true;
  try {
    card.value = await getReportCard(id.value);
    if (!card.value) return;
    [school.value, student.value, showPositions.value] = await Promise.all([
      fetchSchool(schoolId.value),
      getStudent(schoolId.value, card.value.student_id),
      getShowPositions(schoolId.value),
    ]);
    teacherComment.value = card.value.teacher_comment ?? '';
    principalComment.value = card.value.principal_comment ?? '';
  } finally {
    loading.value = false;
  }
}
watch([schoolId, id], load, { immediate: true });

const isApprover = computed(() => can('examinations.approve'));
const isClassTeacher = computed(() => {
  const c = teaching.classes.value.find((x) => x.id === card.value?.class_id);
  return Boolean(c?.class_teacher_membership_id && workspace.myMembershipIds.includes(c.class_teacher_membership_id));
});
const published = computed(() => card.value?.status === 'published');
const canTeacherComment = computed(() => isApprover.value || (isClassTeacher.value && !published.value));
const className = computed(() => teaching.className(card.value?.class_id) || workspace.children.find((c) => c.student_id === card.value?.student_id)?.class_name || workspace.myStudent?.class_name || '');
const termLabel = computed(() => teaching.termLabel(card.value?.term_id));
const rate = computed(() => (card.value ? attendanceRate({ present: card.value.attendance.present ?? 0, late: card.value.attendance.late ?? 0, total: card.value.attendance.total ?? 0 }) : null));

async function saveComment(kind: 'teacher' | 'principal') {
  saving.value = kind;
  await attempt(() => saveReportComment(id.value, kind, kind === 'teacher' ? teacherComment.value : principalComment.value), 'Comment saved.');
  saving.value = null;
  await load();
}

async function download() {
  if (!card.value || !school.value || !student.value) return;
  downloading.value = true;
  await attempt(() =>
    downloadReportCardPdf({
      card: card.value!,
      school: { name: school.value!.name, motto: school.value!.motto, address: [school.value!.address, school.value!.city, school.value!.state].join(', '), email: school.value!.email, phone: school.value!.phone, logoUrl: school.value!.logo_url },
      student: { name: studentName(student.value!, true), admissionNumber: student.value!.admission_number, className: className.value },
      termLabel: termLabel.value,
      showPositions: showPositions.value,
    }),
  );
  downloading.value = false;
}
</script>

<template>
  <div class="mx-auto max-w-[960px]">
    <KSkeleton v-if="loading" :lines="12" />
    <div v-else-if="!card || !student" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="FileText" title="This report card is not available" description="It may not be published yet." />
    </div>

    <template v-else>
      <KPageHeader
        :icon="FileText"
        title="Report card"
        :description="`${studentName(student)}, ${termLabel}`"
        :breadcrumbs="can('examinations.view') ? [{ label: 'Results', to: { name: 'results', params: { slug } } }, { label: studentName(student) }] : [{ label: studentName(student), to: { name: 'student-detail', params: { slug, studentId: student.id }, query: { tab: 'results' } } }, { label: 'Report card' }]"
      >
        <template #badge><KBadge :tone="published ? 'success' : 'warning'" dot>{{ published ? 'Published' : 'Draft' }}</KBadge></template>
        <template #actions><KButton :icon="Download" :loading="downloading" @click="download">Download PDF</KButton></template>
      </KPageHeader>

      <article class="overflow-hidden rounded-[20px] border border-line bg-surface shadow-hover">
        <header class="k-bg-hero relative flex items-center gap-5 px-8 py-7 text-white">
          <div class="k-dots-light absolute inset-0" aria-hidden="true" />
          <KAvatar :name="school?.name ?? ''" :src="school?.logo_url" :size="64" square class="relative ring-4 ring-white/10" />
          <div class="relative min-w-0">
            <p class="text-[22px] font-semibold tracking-tight">{{ school?.name }}</p>
            <p v-if="school?.motto" class="text-[13.5px] text-[#C7D2E3] italic">{{ school.motto }}</p>
            <p class="mt-1 text-[12.5px] text-[#8394AD]">{{ school?.address }}, {{ school?.city }}</p>
          </div>
        </header>

        <div class="grid gap-px bg-line sm:grid-cols-4">
          <div v-for="[label, value] in [
            ['Student', studentName(student, true)],
            ['Admission number', student.admission_number],
            ['Class', className],
            ['Term', termLabel],
          ]" :key="label" class="bg-surface px-5 py-4">
            <p class="text-[11.5px] font-semibold tracking-wide text-ink-muted uppercase">{{ label }}</p>
            <p class="mt-1 text-[14.5px] font-semibold">{{ value }}</p>
          </div>
        </div>

        <div class="grid gap-4 p-6 sm:grid-cols-3">
          <div class="rounded-xl bg-brand-soft p-4 text-center">
            <p class="text-[12.5px] text-brand-ink">Average</p>
            <p class="text-[30px] font-semibold tabular-nums">{{ card.average ?? 'None' }}</p>
            <KBadge v-if="card.grade" tone="brand">Grade {{ card.grade }}</KBadge>
          </div>
          <div v-if="showPositions && card.position" class="rounded-xl bg-[#F3F0FF] p-4 text-center dark:bg-[#7C3AED]/15">
            <p class="text-[12.5px] text-[#6D28D9] dark:text-[#C4B5FD]">Position</p>
            <p class="text-[30px] font-semibold tabular-nums">{{ ordinal(card.position) }}</p>
            <p class="text-[12.5px] text-ink-muted">of {{ card.class_size }}</p>
          </div>
          <div class="rounded-xl bg-success-soft p-4 text-center">
            <p class="flex items-center justify-center gap-1.5 text-[12.5px] text-success-ink"><CalendarCheck :size="14" aria-hidden="true" /> Attendance</p>
            <p class="text-[30px] font-semibold tabular-nums">{{ rate === null ? 'None' : `${rate}%` }}</p>
            <p class="text-[12.5px] text-ink-muted">{{ card.attendance.absent ?? 0 }} absent of {{ card.attendance.total ?? 0 }} days</p>
          </div>
        </div>

        <div class="overflow-x-auto px-6">
          <table class="k-table rounded-xl ring-1 ring-line">
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col" class="text-center">Score</th>
                <th scope="col" class="text-center">Grade</th>
                <th scope="col">Remark</th>
                <th v-if="showPositions" scope="col" class="text-center">Position</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!card.subjects.length"><td :colspan="showPositions ? 5 : 4" class="text-center text-ink-muted">No published results yet.</td></tr>
              <tr v-for="s in card.subjects" :key="s.subject_id">
                <td class="font-medium">{{ s.name }}</td>
                <td class="text-center tabular-nums">{{ Number(s.total).toFixed(1) }}</td>
                <td class="text-center"><KBadge tone="brand">{{ s.grade }}</KBadge></td>
                <td class="text-ink-muted">{{ s.remark }}</td>
                <td v-if="showPositions" class="text-center tabular-nums">{{ s.position ? ordinal(s.position) : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid gap-6 p-6 md:grid-cols-2">
          <div>
            <p class="mb-2 flex items-center gap-2 text-[14px] font-semibold"><MessageSquareQuote :size="16" class="text-brand" aria-hidden="true" /> Class teacher's comment</p>
            <template v-if="canTeacherComment">
              <KTextarea v-model="teacherComment" :rows="4" aria-label="Class teacher's comment" placeholder="A hardworking and respectful pupil." />
              <KButton class="mt-2" size="sm" variant="secondary" :icon="Save" :loading="saving === 'teacher'" @click="saveComment('teacher')">Save comment</KButton>
            </template>
            <p v-else class="rounded-xl bg-surface-muted/60 p-4 text-[14px] whitespace-pre-line">{{ card.teacher_comment || 'No comment yet.' }}</p>
          </div>
          <div>
            <p class="mb-2 flex items-center gap-2 text-[14px] font-semibold"><MessageSquareQuote :size="16" class="text-brand" aria-hidden="true" /> Principal's comment</p>
            <template v-if="isApprover">
              <KTextarea v-model="principalComment" :rows="4" aria-label="Principal's comment" />
              <KButton class="mt-2" size="sm" variant="secondary" :icon="Save" :loading="saving === 'principal'" @click="saveComment('principal')">Save comment</KButton>
            </template>
            <p v-else class="rounded-xl bg-surface-muted/60 p-4 text-[14px] whitespace-pre-line">{{ card.principal_comment || 'No comment yet.' }}</p>
          </div>
        </div>

        <footer class="border-t border-line px-6 py-4 text-[12.5px] text-ink-muted">
          {{ published ? `Approved and published on ${new Date(card.published_at!).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Draft. Families cannot see this card until the principal publishes it.' }}
        </footer>
      </article>

      <KAlert v-if="!published && can('examinations.approve')" tone="info" class="mt-5">Publish report cards for the whole class from Results.</KAlert>
    </template>
  </div>
</template>
