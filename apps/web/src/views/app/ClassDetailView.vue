<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { BookOpen, Building2, GraduationCap, Plus, School, Search, Trash2, UserMinus, UserPlus, UserRound, Users } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';
import { studentName, type ClassEnrollment, type Student } from '@klasora/shared';
import KInput from '@/components/ui/KInput.vue';
import { endEnrollment, enrollStudents, listEnrollments, listStudents, signedPhotoUrls } from '@/services/students';
import type { AcademicYear, Campus, ClassSubject, SchoolClass, SchoolMember, Subject } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KModal from '@/components/ui/KModal.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import {
  assignSubjects,
  getClass,
  listAcademicYears,
  listCampuses,
  listClassSubjects,
  listMembers,
  listSubjects,
  removeClassSubject,
  setSubjectTeacher,
} from '@/services/setup';
import { fullName, useSchool } from '@/composables/useSchool';

const route = useRoute();
const { schoolId, slug, can, words, writable, feedback, attempt } = useSchool();
const canEdit = computed(() => can('academics.edit') && writable.value);
const classId = computed(() => String(route.params.classId ?? ''));

const item = ref<SchoolClass | null>(null);
const subjects = ref<Subject[]>([]);
const links = ref<ClassSubject[]>([]);
const members = ref<SchoolMember[]>([]);
const campuses = ref<Campus[]>([]);
const years = ref<AcademicYear[]>([]);
const loading = ref(true);
const error = ref('');
const notFound = ref(false);

async function load() {
  if (!schoolId.value || !classId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const [c, s, l, cs, ys] = await Promise.all([
      getClass(schoolId.value, classId.value),
      listSubjects(schoolId.value),
      listClassSubjects(schoolId.value, classId.value),
      listCampuses(schoolId.value),
      listAcademicYears(schoolId.value),
    ]);
    item.value = c;
    notFound.value = !c;
    subjects.value = s;
    links.value = l;
    campuses.value = cs;
    years.value = ys;
    members.value = await listMembers(schoolId.value).catch(() => []);
    await loadStudents();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([schoolId, classId], load, { immediate: true });

const subject = (id: string) => subjects.value.find((s) => s.id === id);
const teacher = (id: string | null) => members.value.find((m) => m.membership_id === id);
const assigned = computed(() =>
  links.value
    .map((l) => ({ link: l, subject: subject(l.subject_id) }))
    .filter((x) => x.subject)
    .sort((a, b) => a.subject!.name.localeCompare(b.subject!.name)),
);
const unassigned = computed(() => subjects.value.filter((s) => s.status === 'active' && !links.value.some((l) => l.subject_id === s.id)));
const teacherOptions = computed(() => [
  { value: '', label: 'No teacher yet' },
  ...members.value
    .filter((m) => m.status === 'active' && m.role_key !== 'parent' && m.role_key !== 'student')
    .map((m) => ({ value: m.membership_id, label: fullName(m) })),
]);
const teachersAssigned = computed(() => links.value.filter((l) => l.teacher_membership_id).length);

async function changeTeacher(link: ClassSubject, membershipId: string) {
  await attempt(() => setSubjectTeacher(link.id, membershipId || null), 'Teacher updated.');
  link.teacher_membership_id = membershipId || null;
}

async function remove(link: ClassSubject) {
  const name = subject(link.subject_id)?.name ?? 'this subject';
  const ok = await feedback.confirm({
    title: `Remove ${name} from ${item.value?.name}?`,
    description: `The ${words.value.subject.toLowerCase()} stays in your school; only this ${words.value.group.toLowerCase()} stops taking it.`,
    confirmLabel: 'Remove',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => removeClassSubject(link.id), `${name} removed.`);
  await load();
}

// ---------------------------------------------------------------------------
// Students in the class
// ---------------------------------------------------------------------------
const roster = ref<ClassEnrollment[]>([]);
const allActive = ref<ClassEnrollment[]>([]);
const students = ref<Student[]>([]);
const photos = ref<Record<string, string>>({});

async function loadStudents() {
  roster.value = await listEnrollments(schoolId.value, { classId: classId.value, activeOnly: true }).catch(() => []);
  // Staff with students.view see everyone (for enrolling); teachers see their own students.
  students.value = await listStudents(schoolId.value).catch(() => []);
  if (can('students.edit')) allActive.value = await listEnrollments(schoolId.value, { activeOnly: true }).catch(() => []);
  const inClass = students.value.filter((s) => roster.value.some((r) => r.student_id === s.id));
  photos.value = await signedPhotoUrls(inClass.map((s) => s.photo_path)).catch(() => ({}));
}

const studentById = computed(() => new Map(students.value.map((s) => [s.id, s])));
const enrolled = computed(() =>
  roster.value
    .map((r) => ({ enrollment: r, student: studentById.value.get(r.student_id) }))
    .filter((x): x is { enrollment: ClassEnrollment; student: Student } => Boolean(x.student))
    .sort((a, b) => a.student.last_name.localeCompare(b.student.last_name)),
);
const capacityPct = computed(() =>
  item.value?.capacity ? Math.min(100, Math.round((roster.value.length / item.value.capacity) * 100)) : null,
);

const enrolOpen = ref(false);
const enrolSearch = ref('');
const enrolChosen = ref<Set<string>>(new Set());
const elsewhere = (studentId: string) => {
  const e = allActive.value.find((x) => x.student_id === studentId);
  return e && e.class_id !== classId.value ? 'In another class' : null;
};
const candidates = computed(() => {
  const q = enrolSearch.value.trim().toLowerCase();
  return students.value
    .filter((s) => s.status === 'active' && !roster.value.some((r) => r.student_id === s.id))
    .filter((s) => !q || `${studentName(s)} ${s.admission_number}`.toLowerCase().includes(q))
    .sort((a, b) => Number(Boolean(elsewhere(a.id))) - Number(Boolean(elsewhere(b.id))) || a.last_name.localeCompare(b.last_name));
});

function toggleStudent(id: string, on: boolean) {
  const next = new Set(enrolChosen.value);
  if (on) next.add(id);
  else next.delete(id);
  enrolChosen.value = next;
}

function openEnrol() {
  enrolSearch.value = '';
  enrolChosen.value = new Set();
  enrolOpen.value = true;
}

async function submitEnrol() {
  saving.value = true;
  const count = await attempt(() => enrollStudents(classId.value, [...enrolChosen.value]));
  saving.value = false;
  if (count !== undefined) {
    feedback.success(`${count} student${count === 1 ? '' : 's'} added to ${item.value?.name}.`);
    enrolOpen.value = false;
    await loadStudents();
  }
}

async function unenrol(student: Student) {
  const ok = await feedback.confirm({
    title: `Remove ${studentName(student)} from ${item.value?.name}?`,
    description: 'The class stays in their history. You can place them in another class from their profile.',
    confirmLabel: 'Remove',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => endEnrollment(student.id), 'Student removed from the class.');
  await loadStudents();
}

// Assign modal
const assignOpen = ref(false);
const chosen = ref<Set<string>>(new Set());
const saving = ref(false);

function openAssign() {
  chosen.value = new Set(unassigned.value.map((s) => s.id));
  assignOpen.value = true;
}

function toggle(id: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(id);
  else next.delete(id);
  chosen.value = next;
}

async function submitAssign() {
  saving.value = true;
  const ok = await attempt(async () => {
    await assignSubjects(schoolId.value, classId.value, [...chosen.value]);
    return true;
  }, `${chosen.value.size} ${chosen.value.size === 1 ? words.value.subject.toLowerCase() : words.value.subjects.toLowerCase()} assigned.`);
  saving.value = false;
  if (ok) {
    assignOpen.value = false;
    await load();
  }
}
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-4">
      <KSkeleton line-class="h-10 w-72" />
      <div class="grid gap-4 sm:grid-cols-3"><KSkeleton v-for="n in 3" :key="n" line-class="h-24" /></div>
    </div>

    <div v-else-if="notFound" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="School" :title="`This ${words.group.toLowerCase()} could not be found`" description="It may have been deleted.">
        <KButton :to="{ name: 'classes', params: { slug } }">Back to {{ words.groups.toLowerCase() }}</KButton>
      </KEmptyState>
    </div>

    <template v-else-if="item">
      <KPageHeader
        :icon="School"
        :title="item.name"
        :description="item.level ? `${item.level}${years.find((y) => y.id === item!.academic_year_id) ? ', ' + years.find((y) => y.id === item!.academic_year_id)!.name + ' session' : ''}` : undefined"
        :breadcrumbs="[{ label: words.groups, to: { name: 'classes', params: { slug } } }, { label: item.name }]"
      >
        <template #badge>
          <KBadge :tone="item.status === 'active' ? 'success' : 'neutral'" dot>{{ item.status === 'active' ? 'Active' : 'Inactive' }}</KBadge>
        </template>
        <template #actions>
          <KButton v-if="canEdit && unassigned.length" :icon="Plus" @click="openAssign">Assign {{ words.subjects.toLowerCase() }}</KButton>
        </template>
      </KPageHeader>

      <KAlert v-if="error" tone="danger" class="mb-6">{{ error }}</KAlert>

      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 shadow-card">
          <KIconTile :icon="UserRound" tone="brand" solid :size="42" />
          <div class="min-w-0">
            <p class="text-[12.5px] text-ink-muted">Class teacher</p>
            <p class="truncate text-[14.5px] font-semibold">{{ teacher(item.class_teacher_membership_id) ? fullName(teacher(item.class_teacher_membership_id)!) : 'Not assigned' }}</p>
          </div>
        </div>
        <div class="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 shadow-card">
          <KIconTile :icon="Building2" tone="info" solid :size="42" />
          <div class="min-w-0">
            <p class="text-[12.5px] text-ink-muted">Campus</p>
            <p class="truncate text-[14.5px] font-semibold">{{ campuses.find((c) => c.id === item!.campus_id)?.name }}</p>
          </div>
        </div>
        <div class="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 shadow-card">
          <KIconTile :icon="BookOpen" tone="success" solid :size="42" />
          <div>
            <p class="text-[12.5px] text-ink-muted">{{ words.subjects }}</p>
            <p class="text-[14.5px] font-semibold">{{ links.length }} assigned, {{ teachersAssigned }} with teachers</p>
          </div>
        </div>
        <div class="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 shadow-card">
          <KIconTile :icon="Users" tone="violet" solid :size="42" />
          <div>
            <p class="text-[12.5px] text-ink-muted">Students</p>
            <p class="text-[14.5px] font-semibold">{{ roster.length }}{{ item.capacity ? ` of ${item.capacity} places` : ' enrolled' }}</p>
          </div>
        </div>
      </div>

      <KCard :icon="GraduationCap" title="Students" :description="`${roster.length} in ${item.name}`" :padded="false" class="mb-6">
        <template #actions>
          <KButton v-if="can('students.edit') && writable" size="sm" :icon="UserPlus" @click="openEnrol">Add students</KButton>
        </template>
        <div v-if="capacityPct !== null" class="px-5 pt-4">
          <div class="h-2 overflow-hidden rounded-full bg-surface-muted">
            <div :class="['h-full rounded-full', capacityPct >= 100 ? 'bg-danger' : capacityPct >= 90 ? 'bg-warning' : 'k-bg-brand']" :style="{ width: `${capacityPct}%` }" />
          </div>
          <p class="mt-1.5 text-[12.5px] text-ink-muted">{{ capacityPct }}% full</p>
        </div>
        <KEmptyState
          v-if="!enrolled.length"
          compact
          :icon="GraduationCap"
          title="No students in this class yet"
          :description="can('students.edit') ? 'Add students here, or choose a class when registering them.' : undefined"
        />
        <ul v-else class="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="{ student } in enrolled" :key="student.id" class="group flex items-center gap-3 bg-surface px-4 py-3">
            <RouterLink :to="{ name: 'student-detail', params: { slug, studentId: student.id } }" class="flex min-w-0 flex-1 items-center gap-3">
              <KAvatar :name="studentName(student)" :src="student.photo_path ? photos[student.photo_path] : null" :size="36" />
              <span class="min-w-0">
                <span class="block truncate font-medium group-hover:text-brand-ink">{{ studentName(student) }}</span>
                <span class="block text-[12px] text-ink-muted tabular-nums">{{ student.admission_number }}</span>
              </span>
            </RouterLink>
            <KButton
              v-if="can('students.edit') && writable"
              size="sm"
              variant="ghost"
              :icon="UserMinus"
              :aria-label="`Remove ${studentName(student)}`"
              class="opacity-0 group-hover:opacity-100 focus:opacity-100"
              @click="unenrol(student)"
            />
          </li>
        </ul>
      </KCard>

      <KCard :icon="BookOpen" tone="success" :title="`${words.subjects} and teachers`" :description="`Who teaches what in ${item.name}.`" :padded="false">
        <KEmptyState
          v-if="!assigned.length"
          compact
          :icon="BookOpen"
          :title="`No ${words.subjects.toLowerCase()} assigned yet`"
          :description="subjects.length ? `Choose which ${words.subjects.toLowerCase()} ${item.name} takes.` : `Add ${words.subjects.toLowerCase()} to your school first.`"
        >
          <KButton v-if="canEdit && unassigned.length" :icon="Plus" @click="openAssign">Assign {{ words.subjects.toLowerCase() }}</KButton>
          <KButton v-else-if="!subjects.length" :to="{ name: 'subjects', params: { slug } }">Go to {{ words.subjects.toLowerCase() }}</KButton>
        </KEmptyState>
        <ul v-else class="divide-y divide-line">
          <li v-for="{ link, subject: s } in assigned" :key="link.id" class="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <KIconTile :icon="BookOpen" tone="success" :size="34" />
              <div class="min-w-0">
                <p class="truncate font-medium">{{ s!.name }}</p>
                <p class="text-[12.5px] text-ink-muted">{{ s!.code }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 sm:w-[320px]">
              <KAvatar v-if="teacher(link.teacher_membership_id)" :name="fullName(teacher(link.teacher_membership_id)!)" :size="28" />
              <div class="flex-1">
                <KSelect
                  v-if="canEdit && members.length"
                  :model-value="link.teacher_membership_id ?? ''"
                  :options="teacherOptions"
                  :aria-label="`Teacher for ${s!.name}`"
                  @update:model-value="changeTeacher(link, $event)"
                />
                <p v-else class="text-[13.5px] text-ink-muted">{{ teacher(link.teacher_membership_id) ? fullName(teacher(link.teacher_membership_id)!) : 'No teacher yet' }}</p>
              </div>
              <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${s!.name}`" class="text-danger-ink hover:bg-danger-soft" @click="remove(link)" />
            </div>
          </li>
        </ul>
      </KCard>

    </template>

    <KModal v-model:open="assignOpen" :title="`Assign ${words.subjects.toLowerCase()} to ${item?.name}`" size="lg">
      <div class="mb-3 flex items-center justify-between">
        <p class="text-[13px] text-ink-muted">{{ chosen.size }} selected</p>
        <div class="flex gap-2">
          <KButton size="sm" variant="ghost" @click="chosen = new Set(unassigned.map((s) => s.id))">Select all</KButton>
          <KButton size="sm" variant="ghost" @click="chosen = new Set()">Clear</KButton>
        </div>
      </div>
      <ul class="grid gap-2 sm:grid-cols-2">
        <li v-for="s in unassigned" :key="s.id" :class="['rounded-lg border px-3 py-2.5', chosen.has(s.id) ? 'border-brand/40 bg-brand-soft/60' : 'border-line']">
          <KCheckbox :model-value="chosen.has(s.id)" :label="s.name" :description="s.code" @update:model-value="toggle(s.id, $event)" />
        </li>
      </ul>
      <template #footer>
        <KButton variant="secondary" @click="assignOpen = false">Cancel</KButton>
        <KButton :loading="saving" :disabled="chosen.size === 0" @click="submitAssign">Assign {{ chosen.size }}</KButton>
      </template>
    </KModal>
    <KModal v-model:open="enrolOpen" :title="`Add students to ${item?.name}`" description="Students already in another class are moved; their old class stays in their history." size="lg">
      <KInput v-model="enrolSearch" type="search" :icon="Search" placeholder="Search by name or admission number" aria-label="Search students" class="mb-3" />
      <p v-if="!candidates.length" class="py-6 text-center text-[13.5px] text-ink-muted">No other active students found.</p>
      <ul v-else class="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
        <li v-for="s in candidates" :key="s.id" :class="['rounded-lg border px-3 py-2', enrolChosen.has(s.id) ? 'border-brand/40 bg-brand-soft/60' : 'border-line']">
          <KCheckbox
            :model-value="enrolChosen.has(s.id)"
            :label="studentName(s)"
            :description="[s.admission_number, elsewhere(s.id)].filter(Boolean).join(', ')"
            @update:model-value="toggleStudent(s.id, $event)"
          />
        </li>
      </ul>
      <template #footer>
        <KButton variant="secondary" @click="enrolOpen = false">Cancel</KButton>
        <KButton :disabled="enrolChosen.size === 0" :loading="saving" @click="submitEnrol">Add {{ enrolChosen.size }}</KButton>
      </template>
    </KModal>
  </div>
</template>
