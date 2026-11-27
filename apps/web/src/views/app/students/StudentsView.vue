<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ArrowDownUp, Download, GraduationCap, Plus, Search, Upload, UserCheck, UserPlus, Users, UsersRound } from 'lucide-vue-next';
import {
  RELATIONSHIP_LABELS,
  STUDENT_STATUS_LABELS,
  STUDENT_STATUSES,
  formatDmy,
  studentName,
  toCsv,
  type AcademicYear,
  type Campus,
  type ClassEnrollment,
  type Guardian,
  type SchoolClass,
  type Student,
  type StudentGuardian,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KPagination from '@/components/ui/KPagination.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { listAcademicYears, listCampuses, listClasses } from '@/services/setup';
import { listEnrollments, listGuardians, listStudentGuardians, listStudents, signedPhotoUrls } from '@/services/students';
import { downloadText, todayStamp } from '@/lib/download';
import { useSchool } from '@/composables/useSchool';

const router = useRouter();
const { workspace, schoolId, slug, can, words } = useSchool();

const students = ref<Student[]>([]);
const classes = ref<SchoolClass[]>([]);
const campuses = ref<Campus[]>([]);
const years = ref<AcademicYear[]>([]);
const enrollments = ref<ClassEnrollment[]>([]);
const links = ref<StudentGuardian[]>([]);
const guardians = ref<Guardian[]>([]);
const photos = ref<Record<string, string>>({});
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    [students.value, classes.value, campuses.value, years.value, enrollments.value, links.value, guardians.value] = await Promise.all([
      listStudents(schoolId.value),
      listClasses(schoolId.value),
      listCampuses(schoolId.value),
      listAcademicYears(schoolId.value),
      listEnrollments(schoolId.value, { activeOnly: true }),
      listStudentGuardians(schoolId.value),
      listGuardians(schoolId.value),
    ]);
    photos.value = await signedPhotoUrls(students.value.map((s) => s.photo_path));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

// Lookups
const classById = computed(() => new Map(classes.value.map((c) => [c.id, c])));
const enrollmentByStudent = computed(() => new Map(enrollments.value.map((e) => [e.student_id, e])));
const guardianById = computed(() => new Map(guardians.value.map((g) => [g.id, g])));
const classOf = (s: Student) => {
  const e = enrollmentByStudent.value.get(s.id);
  return e ? classById.value.get(e.class_id) : undefined;
};
const primaryGuardian = (s: Student) => {
  const forStudent = links.value.filter((l) => l.student_id === s.id);
  const link = forStudent.find((l) => l.is_primary) ?? forStudent[0];
  const g = link ? guardianById.value.get(link.guardian_id) : undefined;
  return g ? { name: `${g.first_name} ${g.last_name}`, relationship: RELATIONSHIP_LABELS[link!.relationship], phone: g.phone, email: g.email } : null;
};
const campusName = (id: string) => campuses.value.find((c) => c.id === id)?.name ?? '';

// Filters
const search = ref('');
const classFilter = ref('');
const campusFilter = ref('');
const yearFilter = ref('');
const statusFilter = ref('active');
type SortKey = 'name' | 'admission_number' | 'class' | 'admission_date';
const sort = ref<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
const page = ref(1);
const PAGE_SIZE = 25;

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const rows = students.value.filter((s) => {
    const c = classOf(s);
    if (q && !`${studentName(s, true)} ${s.admission_number}`.toLowerCase().includes(q)) return false;
    if (statusFilter.value && s.status !== statusFilter.value) return false;
    if (campusFilter.value && s.campus_id !== campusFilter.value) return false;
    if (classFilter.value === 'none' && c) return false;
    if (classFilter.value && classFilter.value !== 'none' && c?.id !== classFilter.value) return false;
    if (yearFilter.value && c?.academic_year_id !== yearFilter.value) return false;
    return true;
  });
  const value = (s: Student): string => {
    switch (sort.value.key) {
      case 'admission_number':
        return s.admission_number;
      case 'class':
        return `${String(classOf(s)?.level_order ?? 999).padStart(3, '0')}${classOf(s)?.name ?? ''}`;
      case 'admission_date':
        return s.admission_date;
      default:
        return `${s.last_name} ${s.first_name}`.toLowerCase();
    }
  };
  return rows.sort((a, b) => value(a).localeCompare(value(b), undefined, { numeric: true }) * sort.value.dir);
});
watch([search, classFilter, campusFilter, yearFilter, statusFilter], () => (page.value = 1));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

function sortBy(key: SortKey) {
  sort.value = sort.value.key === key ? { key, dir: sort.value.dir === 1 ? -1 : 1 } : { key, dir: 1 };
}

const stats = computed(() => ({
  total: students.value.length,
  active: students.value.filter((s) => s.status === 'active').length,
  applicants: students.value.filter((s) => s.status === 'applicant').length,
  unplaced: students.value.filter((s) => s.status === 'active' && !enrollmentByStudent.value.has(s.id)).length,
}));

const statusTone = (s: string) =>
  (({ active: 'success', applicant: 'info', suspended: 'warning', graduated: 'brand' }) as Record<string, 'success' | 'info' | 'warning' | 'brand'>)[s] ?? 'neutral';

function exportCsv() {
  const header = ['Admission number', 'First name', 'Middle name', 'Last name', 'Gender', 'Date of birth', 'Admission date', 'Status', 'Campus', 'Class', 'Guardian', 'Relationship', 'Guardian phone', 'Guardian email'];
  const rows = filtered.value.map((s) => {
    const g = primaryGuardian(s);
    return [
      s.admission_number, s.first_name, s.middle_name ?? '', s.last_name, s.gender ? (s.gender === 'female' ? 'Female' : 'Male') : '',
      formatDmy(s.date_of_birth), formatDmy(s.admission_date), STUDENT_STATUS_LABELS[s.status], campusName(s.campus_id),
      classOf(s)?.name ?? '', g?.name ?? '', g?.relationship ?? '', g?.phone ?? '', g?.email ?? '',
    ];
  });
  const name = (workspace.currentSchool?.name ?? 'school').replace(/[^A-Za-z0-9]+/g, '_');
  downloadText(`${name}_students_${todayStamp()}.csv`, toCsv([header, ...rows]));
}

const classOptions = computed(() => [
  { value: '', label: `All ${words.value.groups.toLowerCase()}` },
  { value: 'none', label: `Not in a ${words.value.group.toLowerCase()}` },
  ...classes.value.map((c) => ({ value: c.id, label: c.name })),
]);
</script>

<template>
  <div>
    <KPageHeader :icon="GraduationCap" eyebrow="School management" title="Students" description="Every learner in your school, with their class, guardians and records.">
      <template #actions>
        <KButton v-if="can('students.export') && students.length" variant="secondary" :icon="Download" @click="exportCsv">Export</KButton>
        <KButton v-if="can('students.create')" variant="secondary" :icon="Upload" :to="{ name: 'student-import', params: { slug } }">Import</KButton>
        <KButton v-if="can('students.create')" :icon="Plus" :to="{ name: 'student-new', params: { slug } }">Register student</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <div class="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button
        v-for="card in [
          { label: 'All students', value: stats.total, icon: Users, tone: 'brand', status: '' },
          { label: 'Active', value: stats.active, icon: UserCheck, tone: 'success', status: 'active' },
          { label: 'Applicants', value: stats.applicants, icon: UserPlus, tone: 'info', status: 'applicant' },
          { label: `Not in a ${words.group.toLowerCase()}`, value: stats.unplaced, icon: UsersRound, tone: 'warning', status: 'unplaced' },
        ] as const"
        :key="card.label"
        type="button"
        class="flex items-center gap-3 rounded-card border border-line bg-surface p-4 text-left shadow-card transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-hover"
        @click="card.status === 'unplaced' ? ((statusFilter = 'active'), (classFilter = 'none')) : ((statusFilter = card.status), (classFilter = ''))"
      >
        <KIconTile :icon="card.icon" :tone="card.tone" solid :size="40" />
        <span>
          <span class="block text-[12.5px] text-ink-muted">{{ card.label }}</span>
          <KSkeleton v-if="loading" line-class="mt-1 h-6 w-12" />
          <span v-else class="block text-[22px] leading-7 font-semibold tabular-nums">{{ card.value }}</span>
        </span>
      </button>
    </div>

    <div class="rounded-card border border-line bg-surface shadow-card">
      <div class="grid gap-3 border-b border-line p-4 md:grid-cols-2 xl:grid-cols-5">
        <div class="md:col-span-2 xl:col-span-1">
          <KInput v-model="search" type="search" :icon="Search" placeholder="Name or admission number" aria-label="Search students" />
        </div>
        <KSelect v-model="classFilter" :options="classOptions" aria-label="Class" />
        <KSelect v-if="campuses.length > 1" v-model="campusFilter" :options="[{ value: '', label: 'All campuses' }, ...campuses.map((c) => ({ value: c.id, label: c.name }))]" aria-label="Campus" />
        <KSelect v-if="years.length" v-model="yearFilter" :options="[{ value: '', label: 'All sessions' }, ...years.map((y) => ({ value: y.id, label: y.name }))]" aria-label="Session" />
        <KSelect v-model="statusFilter" :options="[{ value: '', label: 'Any status' }, ...STUDENT_STATUSES.map((s) => ({ value: s, label: STUDENT_STATUS_LABELS[s] }))]" aria-label="Status" />
      </div>

      <KSkeleton v-if="loading" :lines="8" class="p-5" />

      <KEmptyState
        v-else-if="!students.length"
        :icon="GraduationCap"
        title="No students yet"
        description="Register students one by one, or import your whole list from a spreadsheet in one go."
      >
        <KButton v-if="can('students.create')" :icon="Upload" variant="secondary" :to="{ name: 'student-import', params: { slug } }">Import from a spreadsheet</KButton>
        <KButton v-if="can('students.create')" :icon="Plus" :to="{ name: 'student-new', params: { slug } }">Register a student</KButton>
      </KEmptyState>

      <KEmptyState v-else-if="!filtered.length" compact :icon="Search" title="No students match" description="Try another search, or clear the filters." >
        <KButton variant="secondary" size="sm" @click="(search = ''), (classFilter = ''), (campusFilter = ''), (yearFilter = ''), (statusFilter = '')">Clear filters</KButton>
      </KEmptyState>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="k-table">
            <thead>
              <tr>
                <th scope="col" :aria-sort="sort.key === 'name' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'">
                  <button type="button" class="inline-flex items-center gap-1 uppercase" @click="sortBy('name')">Student <ArrowDownUp :size="12" aria-hidden="true" /></button>
                </th>
                <th scope="col" :aria-sort="sort.key === 'admission_number' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'">
                  <button type="button" class="inline-flex items-center gap-1 uppercase" @click="sortBy('admission_number')">Admission no. <ArrowDownUp :size="12" aria-hidden="true" /></button>
                </th>
                <th scope="col" :aria-sort="sort.key === 'class' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'">
                  <button type="button" class="inline-flex items-center gap-1 uppercase" @click="sortBy('class')">{{ words.group }} <ArrowDownUp :size="12" aria-hidden="true" /></button>
                </th>
                <th scope="col" class="hidden xl:table-cell">Campus</th>
                <th scope="col" class="hidden lg:table-cell">Guardian</th>
                <th scope="col">Status</th>
                <th scope="col" class="hidden md:table-cell" :aria-sort="sort.key === 'admission_date' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'">
                  <button type="button" class="inline-flex items-center gap-1 uppercase" @click="sortBy('admission_date')">Admitted <ArrowDownUp :size="12" aria-hidden="true" /></button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in pageRows" :key="s.id" class="cursor-pointer" @click="router.push({ name: 'student-detail', params: { slug, studentId: s.id } })">
                <td>
                  <RouterLink :to="{ name: 'student-detail', params: { slug, studentId: s.id } }" class="flex items-center gap-3" @click.stop>
                    <KAvatar :name="studentName(s)" :src="s.photo_path ? photos[s.photo_path] : null" :size="36" />
                    <span class="min-w-0">
                      <span class="block font-medium text-ink hover:text-brand-ink">{{ studentName(s) }}</span>
                      <span v-if="s.middle_name" class="block text-[12.5px] text-ink-muted">{{ s.middle_name }}</span>
                    </span>
                  </RouterLink>
                </td>
                <td class="font-medium tabular-nums text-ink-muted">{{ s.admission_number }}</td>
                <td>
                  <KBadge v-if="classOf(s)" tone="brand">{{ classOf(s)!.name }}</KBadge>
                  <span v-else class="text-ink-subtle">Not placed</span>
                </td>
                <td class="hidden text-ink-muted xl:table-cell">{{ campusName(s.campus_id) }}</td>
                <td class="hidden lg:table-cell">
                  <template v-if="primaryGuardian(s)">
                    <span class="block">{{ primaryGuardian(s)!.name }}</span>
                    <span class="block text-[12.5px] text-ink-muted">{{ primaryGuardian(s)!.relationship }}</span>
                  </template>
                  <span v-else class="text-ink-subtle">None linked</span>
                </td>
                <td><KBadge :tone="statusTone(s.status)" dot>{{ STUDENT_STATUS_LABELS[s.status] }}</KBadge></td>
                <td class="hidden text-ink-muted tabular-nums md:table-cell">{{ formatDmy(s.admission_date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <KPagination v-model="page" :total="filtered.length" :page-size="PAGE_SIZE" noun="students" />
      </template>
    </div>
  </div>
</template>
