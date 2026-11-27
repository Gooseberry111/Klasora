<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowRightLeft,
  Cake,
  Camera,
  FileText,
  FolderOpen,
  GraduationCap,
  HeartPulse,
  History,
  Mail,
  Pencil,
  Phone,
  Plus,
  School,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
  CalendarCheck,
  KeyRound,
  NotebookPen,
  Trophy,
  Wallet,
} from 'lucide-vue-next';
import {
  BLOOD_GROUPS,
  ENROLLMENT_STATUS_LABELS,
  GENDER_LABELS,
  GENOTYPES,
  RELATIONSHIP_LABELS,
  STUDENT_STATUS_LABELS,
  ageFrom,
  bloodGroupLabel,
  isoDate,
  formatDmy,
  studentDetailsSchema,
  studentName,
  validate,
  type AcademicYear,
  type Campus,
  type ClassEnrollment,
  type FieldErrors,
  type Guardian,
  type SchoolClass,
  type Student,
  type StudentDetails,
  type StudentDetailsInput,
  type StudentGuardian,
} from '@klasora/shared';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KTabs from '@/components/ui/KTabs.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import GuardianLinkModal from '@/components/students/GuardianLinkModal.vue';
import InvitationShare from '@/components/InvitationShare.vue';
import StudentAcademicTab from '@/components/students/StudentAcademicTab.vue';
import StudentFinanceTab from '@/components/finance/StudentFinanceTab.vue';
import { inviteStudent } from '@/services/academics';
import { appUrl } from '@/lib/supabase';
import { formatDate } from '@/lib/time';
import { emailInvitation, listAcademicYears, listCampuses, listClasses } from '@/services/setup';
import {
  deleteStudent,
  deleteStudentDocument,
  documentUrl,
  endEnrollment,
  enrollStudents,
  getStudent,
  getStudentDetails,
  inviteGuardian,
  listEnrollments,
  listGuardians,
  listPendingGuardianInvites,
  listStudentActivity,
  listStudentDocuments,
  listStudentGuardians,
  saveStudentDetails,
  signedPhotoUrls,
  unlinkGuardian,
  uploadStudentDocument,
  uploadStudentPhoto,
  type ActivityEntry,
  type StudentDocument,
} from '@/services/students';
import { useSchool } from '@/composables/useSchool';

const route = useRoute();
const router = useRouter();
const { workspace, schoolId, slug, can, words, feedback, attempt } = useSchool();
const studentId = computed(() => String(route.params.studentId ?? ''));

const student = ref<Student | null>(null);
const details = ref<StudentDetails | null>(null);
const links = ref<StudentGuardian[]>([]);
const guardians = ref<Guardian[]>([]);
const enrollments = ref<ClassEnrollment[]>([]);
const classes = ref<SchoolClass[]>([]);
const campuses = ref<Campus[]>([]);
const years = ref<AcademicYear[]>([]);
const pendingInvites = ref<Set<string>>(new Set());
const photoUrl = ref<string | null>(null);
const loading = ref(true);
const notFound = ref(false);
const error = ref('');

/** The signed in person is one of this child's guardians. */
const isGuardianView = computed(() => workspace.children.some((c) => c.student_id === studentId.value));
/** The signed in person is this student. */
const isSelf = computed(() => workspace.myStudent?.student_id === studentId.value);
const isFamily = computed(() => isGuardianView.value || isSelf.value);
const canEdit = computed(() => can('students.edit'));
const canSeeHealth = computed(() => can('student_health.view') || isGuardianView.value);

async function load() {
  if (!schoolId.value || !studentId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const s = await getStudent(schoolId.value, studentId.value);
    student.value = s;
    notFound.value = !s;
    if (!s) return;
    const [l, e, c, cp, y] = await Promise.all([
      listStudentGuardians(schoolId.value, s.id),
      listEnrollments(schoolId.value, { studentId: s.id }),
      listClasses(schoolId.value).catch(() => []),
      listCampuses(schoolId.value),
      listAcademicYears(schoolId.value),
    ]);
    links.value = l;
    enrollments.value = e;
    classes.value = c;
    campuses.value = cp;
    years.value = y;
    guardians.value = await listGuardians(schoolId.value).catch(() => []);
    details.value = canSeeHealth.value ? await getStudentDetails(s.id).catch(() => null) : null;
    if (canEdit.value) pendingInvites.value = await listPendingGuardianInvites(schoolId.value);
    photoUrl.value = s.photo_path ? ((await signedPhotoUrls([s.photo_path]))[s.photo_path] ?? null) : null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([schoolId, studentId], load, { immediate: true });

const current = computed(() => enrollments.value.find((e) => e.status === 'active') ?? null);
const classById = (id: string) => classes.value.find((c) => c.id === id);
const currentClass = computed(() => (current.value ? classById(current.value.class_id) : undefined));
/** Guardians cannot read the classes table, so their children list supplies the name. */
const currentClassName = computed(
  () => currentClass.value?.name ?? workspace.children.find((c) => c.student_id === studentId.value)?.class_name ?? null,
);
const linked = computed(() =>
  links.value
    .map((link) => ({ link, guardian: guardians.value.find((g) => g.id === link.guardian_id) }))
    .filter((x): x is { link: StudentGuardian; guardian: Guardian } => Boolean(x.guardian))
    .sort((a, b) => Number(b.link.is_primary) - Number(a.link.is_primary)),
);
const primary = computed(() => linked.value[0] ?? null);
const age = computed(() => ageFrom(student.value?.date_of_birth ?? null));

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const tab = ref(typeof route.query.tab === 'string' ? route.query.tab : 'overview');
const tabs = computed(() => [
  { key: 'overview', label: 'Overview', icon: UserRound },
  { key: 'guardians', label: 'Guardians', icon: UsersRound, count: linked.value.length },
  { key: 'class', label: `${words.value.group} history`, icon: History },
  ...(can('attendance.view') || isFamily.value ? [{ key: 'attendance', label: 'Attendance', icon: CalendarCheck }] : []),
  ...(can('assignments.view') || isFamily.value ? [{ key: 'assignments', label: 'Assignments', icon: NotebookPen }] : []),
  ...(can('examinations.view') || isFamily.value ? [{ key: 'results', label: 'Results', icon: Trophy }] : []),
  ...(can('finance.view') || isGuardianView.value ? [{ key: 'finance', label: 'Fees', icon: Wallet }] : []),
  ...(canSeeHealth.value ? [{ key: 'health', label: 'Health and welfare', icon: HeartPulse }] : []),
  ...(can('students.view') || isGuardianView.value ? [{ key: 'documents', label: 'Documents', icon: FolderOpen }] : []),
  ...(can('audit.view') ? [{ key: 'activity', label: 'Activity', icon: ShieldCheck }] : []),
]);
watch(tab, (t) => {
  if (t === 'documents' && !documentsLoaded.value) void loadDocuments();
  if (t === 'activity' && !activityLoaded.value) void loadActivity();
});

const statusTone = computed(() =>
  (({ active: 'success', applicant: 'info', suspended: 'warning', graduated: 'brand' }) as Record<string, 'success' | 'info' | 'warning' | 'brand'>)[student.value?.status ?? ''] ?? 'neutral',
);

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------
async function onPhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file || !student.value) return;
  const saved = await attempt(() => uploadStudentPhoto(schoolId.value, student.value!.id, file), 'Photo updated.');
  if (saved) await load();
}

async function remove() {
  if (!student.value) return;
  const ok = await feedback.confirm({
    title: `Delete ${studentName(student.value)}?`,
    description: 'This permanently removes the student, their class history and guardian links. To keep their records, change their status to Withdrawn instead.',
    confirmLabel: 'Delete permanently',
    tone: 'danger',
  });
  if (!ok) return;
  const done = await attempt(async () => {
    await deleteStudent(student.value!.id);
    return true;
  }, 'Student deleted.');
  if (done) await router.push({ name: 'students', params: { slug: slug.value } });
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------
// Student portal access
const studentInviteOpen = ref(false);
const studentEmail = ref('');
const studentInviteResult = ref<{ email: string; link: string; emailed: boolean } | null>(null);
const invitingStudent = ref(false);

async function inviteToPortal() {
  if (!student.value) return;
  invitingStudent.value = true;
  const created = await attempt(() => inviteStudent(student.value!.id, studentEmail.value));
  if (created) {
    const emailed = await emailInvitation(created.invitation_id, created.token);
    studentInviteResult.value = { email: studentEmail.value.trim().toLowerCase(), link: `${appUrl}/invite/${created.token}`, emailed };
  }
  invitingStudent.value = false;
}

const linkOpen = ref(false);
const editingLink = ref<StudentGuardian | null>(null);
const inviteResult = ref<{ email: string; link: string; emailed: boolean } | null>(null);
const inviting = ref<string | null>(null);

function openLink(link: StudentGuardian | null = null) {
  editingLink.value = link;
  linkOpen.value = true;
}

async function unlink(link: StudentGuardian, guardian: Guardian) {
  const ok = await feedback.confirm({
    title: `Remove ${guardian.first_name} ${guardian.last_name} from this student?`,
    description: 'They will no longer see this child in the parent portal. Their guardian record stays for any other children.',
    confirmLabel: 'Remove',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => unlinkGuardian(link.id), 'Guardian removed.');
  await load();
}

async function invite(guardian: Guardian) {
  inviting.value = guardian.id;
  const created = await attempt(() => inviteGuardian(guardian.id));
  if (created) {
    const emailed = await emailInvitation(created.invitation_id, created.token);
    inviteResult.value = { email: guardian.email!, link: `${appUrl}/invite/${created.token}`, emailed };
    pendingInvites.value = new Set([...pendingInvites.value, guardian.id]);
  }
  inviting.value = null;
}

function portalState(g: Guardian): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (g.user_id) return { label: 'Portal access', tone: 'success' };
  if (pendingInvites.value.has(g.id)) return { label: 'Invited', tone: 'warning' };
  return { label: 'Not invited', tone: 'neutral' };
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------
const moveOpen = ref(false);
const moveClass = ref('');
const moveDate = ref(isoDate(new Date()));
const saving = ref(false);

async function submitMove() {
  if (!moveClass.value || !student.value) return;
  saving.value = true;
  const ok = await attempt(() => enrollStudents(moveClass.value, [student.value!.id], moveDate.value), `${student.value.first_name} moved to ${classById(moveClass.value)?.name}.`);
  saving.value = false;
  if (ok !== undefined) {
    moveOpen.value = false;
    await load();
  }
}

async function removeFromClass() {
  if (!student.value || !currentClass.value) return;
  const ok = await feedback.confirm({
    title: `Remove from ${currentClass.value.name}?`,
    description: 'The class stays in their history. You can place them in another class at any time.',
    confirmLabel: 'Remove from class',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => endEnrollment(student.value!.id), 'Removed from the class.');
  await load();
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
const healthOpen = ref(false);
const health = reactive<StudentDetailsInput>({
  homeAddress: '', bloodGroup: '', genotype: '', medicalConditions: '', allergies: '', medications: '',
  accessibilityNeeds: '', emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
});
const healthErrors = ref<FieldErrors>({});

function openHealth() {
  const d = details.value;
  Object.assign(health, {
    homeAddress: d?.home_address ?? '', bloodGroup: d?.blood_group ?? '', genotype: d?.genotype ?? '',
    medicalConditions: d?.medical_conditions ?? '', allergies: d?.allergies ?? '', medications: d?.medications ?? '',
    accessibilityNeeds: d?.accessibility_needs ?? '', emergencyContactName: d?.emergency_contact_name ?? '',
    emergencyContactPhone: d?.emergency_contact_phone ?? '', emergencyContactRelationship: d?.emergency_contact_relationship ?? '',
  });
  healthErrors.value = {};
  healthOpen.value = true;
}

async function saveHealth() {
  const result = validate(studentDetailsSchema, health);
  if (!result.success) {
    healthErrors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(() => saveStudentDetails(schoolId.value, studentId.value, result.data), 'Health and welfare details saved.');
  saving.value = false;
  if (saved) {
    details.value = saved;
    healthOpen.value = false;
  }
}

const healthRows = computed(() => {
  const d = details.value;
  return [
    ['Blood group', d?.blood_group ? bloodGroupLabel(d.blood_group) : null],
    ['Genotype', d?.genotype],
    ['Medical conditions', d?.medical_conditions],
    ['Allergies', d?.allergies],
    ['Medication', d?.medications],
    ['Accessibility or learning needs', d?.accessibility_needs],
    ['Emergency contact', d?.emergency_contact_name ? `${d.emergency_contact_name}${d.emergency_contact_relationship ? ` (${d.emergency_contact_relationship})` : ''}` : null],
    ['Emergency phone', d?.emergency_contact_phone],
    ['Home address', d?.home_address],
  ] as [string, string | null | undefined][];
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const documents = ref<StudentDocument[]>([]);
const documentsLoaded = ref(false);
const uploading = ref(false);

async function loadDocuments() {
  documents.value = (await attempt(() => listStudentDocuments(schoolId.value, studentId.value))) ?? [];
  documentsLoaded.value = true;
}

async function onDocument(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  uploading.value = true;
  await attempt(() => uploadStudentDocument(schoolId.value, studentId.value, file), 'Document uploaded.');
  uploading.value = false;
  await loadDocuments();
}

async function openDocument(doc: StudentDocument) {
  const url = await attempt(() => documentUrl(doc.path));
  if (url) window.open(url, '_blank', 'noopener');
}

async function removeDocument(doc: StudentDocument) {
  const ok = await feedback.confirm({ title: `Delete ${doc.name}?`, description: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' });
  if (!ok) return;
  await attempt(() => deleteStudentDocument(doc.path), 'Document deleted.');
  await loadDocuments();
}

const sizeLabel = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
const activity = ref<ActivityEntry[]>([]);
const activityLoaded = ref(false);

async function loadActivity() {
  activity.value = (await attempt(() => listStudentActivity(schoolId.value, studentId.value))) ?? [];
  activityLoaded.value = true;
}

const ENTITY_LABELS: Record<string, string> = {
  students: 'Student record',
  student_details: 'Health and welfare details',
  student_guardians: 'Guardian link',
  class_enrollments: 'Class enrolment',
};

function describe(entry: ActivityEntry): string {
  const what = ENTITY_LABELS[entry.entity_type] ?? entry.entity_type;
  const verb = entry.action === 'insert' ? 'added' : entry.action === 'delete' ? 'removed' : 'updated';
  const fields = (entry.new_data as { changed_fields?: string[] } | null)?.changed_fields;
  if (fields) return `${what} ${verb}: ${fields.map((f) => f.replace(/_/g, ' ')).join(', ')}`;
  if (entry.action === 'update' && entry.previous_data && entry.new_data) {
    const changed = Object.keys(entry.new_data).filter(
      (k) => !['updated_at'].includes(k) && JSON.stringify(entry.new_data![k]) !== JSON.stringify(entry.previous_data![k]),
    );
    if (changed.length) return `${what} ${verb}: ${changed.map((f) => f.replace(/_/g, ' ')).join(', ')}`;
  }
  return `${what} ${verb}`;
}
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-4">
      <KSkeleton line-class="h-40 rounded-card" />
      <KSkeleton :lines="6" />
    </div>

    <div v-else-if="notFound" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="GraduationCap" title="This student could not be found" description="They may have been deleted, or you may not have access to their record.">
        <KButton :to="isGuardianView ? { name: 'children', params: { slug } } : { name: 'students', params: { slug } }">Go back</KButton>
      </KEmptyState>
    </div>

    <template v-else-if="student">
      <KAlert v-if="error" tone="danger" class="mb-6">{{ error }}</KAlert>

      <!-- Profile header -->
      <section class="k-fade-up relative mb-6 overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
        <div class="k-bg-hero relative h-28 sm:h-32">
          <div class="k-dots-light absolute inset-0" aria-hidden="true" />
        </div>
        <div class="relative px-6 pb-6">
          <div class="flex flex-col gap-5 sm:flex-row sm:items-end">
            <label :class="['group relative -mt-14 w-fit shrink-0 rounded-full ring-4 ring-surface', canEdit ? 'cursor-pointer' : '']">
              <KAvatar :name="studentName(student)" :src="photoUrl" :size="112" />
              <template v-if="canEdit">
                <span class="absolute inset-0 flex items-center justify-center rounded-full bg-[#0b1322]/0 text-white opacity-0 transition group-hover:bg-[#0b1322]/45 group-hover:opacity-100">
                  <Camera :size="22" aria-hidden="true" />
                </span>
                <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" aria-label="Change photo" @change="onPhoto" />
              </template>
            </label>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="k-page-title">{{ studentName(student, true) }}</h1>
                <KBadge :tone="statusTone" dot>{{ STUDENT_STATUS_LABELS[student.status] }}</KBadge>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-ink-muted">
                <span class="font-medium text-ink tabular-nums">{{ student.admission_number }}</span>
                <span v-if="currentClassName" class="flex items-center gap-1.5"><School :size="15" aria-hidden="true" /> {{ currentClassName }}</span>
                <span v-if="age !== null" class="flex items-center gap-1.5"><Cake :size="15" aria-hidden="true" /> {{ age }} years old</span>
                <span v-if="student.gender">{{ GENDER_LABELS[student.gender] }}</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <KButton
                v-if="canEdit && !student.user_id"
                variant="ghost"
                :icon="KeyRound"
                @click="(studentEmail = ''), (studentInviteResult = null), (studentInviteOpen = true)"
              >
                Student portal
              </KButton>
              <KBadge v-else-if="canEdit && student.user_id" tone="success" dot class="self-center">Has portal access</KBadge>
              <KButton v-if="canEdit" variant="secondary" :icon="Pencil" :to="{ name: 'student-edit', params: { slug, studentId: student.id } }">Edit</KButton>
              <KButton v-if="can('students.delete')" variant="ghost" :icon="Trash2" class="text-danger-ink hover:bg-danger-soft" aria-label="Delete student" @click="remove" />
            </div>
          </div>
        </div>
      </section>

      <KTabs v-model="tab" :tabs="tabs" label="Student record" class="mb-6" />

      <!-- Overview -->
      <div v-if="tab === 'overview'" class="grid gap-6 lg:grid-cols-3">
        <KCard title="Personal and admission details" :icon="UserRound" class="lg:col-span-2">
          <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div v-for="[label, value] in [
              ['Full name', studentName(student, true)],
              ['Gender', student.gender ? GENDER_LABELS[student.gender] : 'Not stated'],
              ['Date of birth', student.date_of_birth ? `${formatDmy(student.date_of_birth)}${age !== null ? ` (${age} years)` : ''}` : 'Not recorded'],
              ['Admission number', student.admission_number],
              ['Admission date', formatDmy(student.admission_date)],
              ['Campus', campuses.find((c) => c.id === student!.campus_id)?.name ?? ''],
              [words.group, currentClassName ?? 'Not placed yet'],
              ['Previous school', student.previous_school ?? 'Not recorded'],
            ]" :key="label">
              <dt class="text-[12.5px] text-ink-muted">{{ label }}</dt>
              <dd class="mt-0.5 text-[14px]">{{ value }}</dd>
            </div>
          </dl>
        </KCard>
        <KCard title="Primary guardian" :icon="UsersRound" tone="success">
          <div v-if="primary" class="space-y-3">
            <p class="text-[15px] font-semibold">{{ primary.guardian.first_name }} {{ primary.guardian.last_name }}</p>
            <KBadge tone="neutral">{{ RELATIONSHIP_LABELS[primary.link.relationship] }}</KBadge>
            <p v-if="primary.guardian.phone" class="flex items-center gap-2 text-[13.5px]"><Phone :size="15" class="text-ink-subtle" aria-hidden="true" /> <a :href="`tel:${primary.guardian.phone}`" class="hover:underline">{{ primary.guardian.phone }}</a></p>
            <p v-if="primary.guardian.email" class="flex items-center gap-2 text-[13.5px]"><Mail :size="15" class="text-ink-subtle" aria-hidden="true" /> <a :href="`mailto:${primary.guardian.email}`" class="truncate hover:underline">{{ primary.guardian.email }}</a></p>
          </div>
          <div v-else class="text-[13.5px] text-ink-muted">
            <p>No guardian is linked yet.</p>
            <KButton v-if="canEdit" class="mt-3" size="sm" variant="subtle" :icon="Plus" @click="tab = 'guardians'; openLink()">Add a guardian</KButton>
          </div>
        </KCard>
      </div>

      <!-- Guardians -->
      <div v-else-if="tab === 'guardians'" class="space-y-4">
        <div v-if="canEdit" class="flex justify-end">
          <KButton :icon="Plus" @click="openLink()">Add a guardian</KButton>
        </div>
        <div v-if="!linked.length" class="rounded-card border border-line bg-surface shadow-card">
          <KEmptyState :icon="UsersRound" title="No guardians linked" description="Link parents or guardians so they can be contacted and follow this student in the parent portal." />
        </div>
        <div v-else class="grid gap-4 md:grid-cols-2">
          <article v-for="{ link, guardian } in linked" :key="link.id" class="rounded-card border border-line bg-surface p-5 shadow-card">
            <div class="flex items-start gap-3.5">
              <KAvatar :name="`${guardian.first_name} ${guardian.last_name}`" :size="44" />
              <div class="min-w-0 flex-1">
                <p class="text-[15px] font-semibold">{{ guardian.first_name }} {{ guardian.last_name }}</p>
                <div class="mt-1 flex flex-wrap gap-1.5">
                  <KBadge tone="neutral">{{ RELATIONSHIP_LABELS[link.relationship] }}</KBadge>
                  <KBadge v-if="link.is_primary" tone="brand">Primary</KBadge>
                  <KBadge v-if="link.is_emergency_contact" tone="danger">Emergency contact</KBadge>
                  <KBadge v-if="canEdit" :tone="portalState(guardian).tone" dot>{{ portalState(guardian).label }}</KBadge>
                </div>
              </div>
            </div>
            <div class="mt-4 space-y-1.5 text-[13.5px] text-ink-muted">
              <p v-if="guardian.phone" class="flex items-center gap-2"><Phone :size="15" aria-hidden="true" /> {{ guardian.phone }}</p>
              <p v-if="guardian.email" class="flex items-center gap-2"><Mail :size="15" aria-hidden="true" /> {{ guardian.email }}</p>
              <p v-if="guardian.occupation">{{ guardian.occupation }}</p>
              <p class="pt-1 text-[12.5px]">
                {{ [link.can_view_results ? 'Sees results' : 'Results hidden', link.can_view_finances ? 'sees fees' : 'fees hidden', link.can_receive_notifications ? 'gets notifications' : 'no notifications'].join(', ') }}
              </p>
            </div>
            <div v-if="canEdit" class="mt-4 flex flex-wrap gap-1 border-t border-line pt-3">
              <KButton
                v-if="!guardian.user_id && guardian.email"
                size="sm"
                variant="subtle"
                :icon="Send"
                :loading="inviting === guardian.id"
                @click="invite(guardian)"
              >
                {{ pendingInvites.has(guardian.id) ? 'Send new invitation' : 'Invite to parent portal' }}
              </KButton>
              <KButton size="sm" variant="ghost" :icon="Settings2" @click="openLink(link)">Settings</KButton>
              <KButton size="sm" variant="ghost" :icon="X" class="ml-auto text-danger-ink hover:bg-danger-soft" @click="unlink(link, guardian)">Remove</KButton>
            </div>
          </article>
        </div>
      </div>

      <!-- Class history -->
      <div v-else-if="tab === 'class'" class="space-y-4">
        <div class="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center">
          <KIconTile :icon="School" tone="violet" solid :size="46" />
          <div class="flex-1">
            <p class="text-[12.5px] text-ink-muted">Current {{ words.group.toLowerCase() }}</p>
            <p class="text-[17px] font-semibold">{{ currentClassName ?? 'Not placed in a class' }}</p>
            <p v-if="current" class="text-[12.5px] text-ink-muted">Since {{ formatDmy(current.start_date) }}</p>
          </div>
          <div v-if="canEdit" class="flex gap-2">
            <KButton :icon="ArrowRightLeft" @click="(moveClass = ''), (moveOpen = true)">{{ current ? 'Move class' : 'Place in a class' }}</KButton>
            <KButton v-if="current" variant="ghost" class="text-danger-ink hover:bg-danger-soft" @click="removeFromClass">Remove</KButton>
          </div>
        </div>
        <KCard title="History" :icon="History" :padded="false">
          <KEmptyState v-if="!enrollments.length" compact :icon="History" title="No class history yet" />
          <div v-else class="overflow-x-auto">
            <table class="k-table">
              <thead>
                <tr><th scope="col">{{ words.group }}</th><th scope="col">Session</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                <tr v-for="e in enrollments" :key="e.id">
                  <td class="font-medium">{{ classById(e.class_id)?.name ?? 'Class' }}</td>
                  <td class="text-ink-muted">{{ years.find((y) => y.id === e.academic_year_id)?.name ?? 'Any' }}</td>
                  <td class="tabular-nums">{{ formatDmy(e.start_date) }}</td>
                  <td class="tabular-nums">{{ e.end_date ? formatDmy(e.end_date) : 'Now' }}</td>
                  <td><KBadge :tone="e.status === 'active' ? 'success' : 'neutral'" dot>{{ ENROLLMENT_STATUS_LABELS[e.status] }}</KBadge></td>
                </tr>
              </tbody>
            </table>
          </div>
        </KCard>
      </div>

      <!-- Attendance, assignments and results -->
      <StudentAcademicTab
        v-else-if="tab === 'attendance' || tab === 'assignments' || tab === 'results'"
        :kind="tab"
        :student-id="student.id"
        :class-id="current?.class_id ?? (isSelf ? (workspace.myStudent?.class_id ?? null) : null)"
      />

      <!-- Fees -->
      <StudentFinanceTab
        v-else-if="tab === 'finance'"
        :student-id="student.id"
        :student-name="studentName(student, true)"
        :admission-number="student.admission_number"
        :class-name="currentClassName ?? ''"
      />

      <!-- Health -->
      <div v-else-if="tab === 'health'">
        <KCard title="Health and welfare" description="Visible only to staff with health access and this child's guardians. Every change is recorded." :icon="HeartPulse" tone="danger">
          <template v-if="can('student_health.edit')" #actions>
            <KButton size="sm" variant="secondary" :icon="Pencil" @click="openHealth">{{ details ? 'Edit' : 'Add details' }}</KButton>
          </template>
          <p v-if="!details" class="text-[13.5px] text-ink-muted">Nothing has been recorded yet.</p>
          <dl v-else class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div v-for="[label, value] in healthRows" :key="label">
              <dt class="text-[12.5px] text-ink-muted">{{ label }}</dt>
              <dd :class="['mt-0.5 text-[14px] whitespace-pre-line', value ? '' : 'text-ink-subtle']">{{ value || 'None recorded' }}</dd>
            </div>
          </dl>
        </KCard>
      </div>

      <!-- Documents -->
      <div v-else-if="tab === 'documents'">
        <KCard title="Documents" description="Birth certificates, previous results and other files. PDF or images up to 10 MB." :icon="FolderOpen" tone="info" :padded="false">
          <template v-if="canEdit" #actions>
            <label>
              <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" class="sr-only" @change="onDocument" />
              <span class="k-bg-brand inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control px-3 text-[13px] font-medium text-white shadow-brand">
                <Upload :size="15" aria-hidden="true" /> {{ uploading ? 'Uploading' : 'Upload' }}
              </span>
            </label>
          </template>
          <KSkeleton v-if="!documentsLoaded" :lines="3" class="p-5" />
          <KEmptyState v-else-if="!documents.length" compact :icon="FileText" title="No documents yet" />
          <ul v-else class="divide-y divide-line">
            <li v-for="doc in documents" :key="doc.path" class="flex items-center gap-3 px-5 py-3">
              <KIconTile :icon="FileText" tone="info" :size="36" />
              <button type="button" class="min-w-0 flex-1 text-left" @click="openDocument(doc)">
                <span class="block truncate font-medium hover:text-brand-ink">{{ doc.name }}</span>
                <span class="block text-[12.5px] text-ink-muted">{{ sizeLabel(doc.size) }}<template v-if="doc.createdAt">, {{ formatDate(doc.createdAt) }}</template></span>
              </button>
              <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${doc.name}`" class="text-danger-ink hover:bg-danger-soft" @click="removeDocument(doc)" />
            </li>
          </ul>
        </KCard>
      </div>

      <!-- Activity -->
      <div v-else-if="tab === 'activity'">
        <KCard title="Activity history" description="Changes to this student's records, newest first." :icon="ShieldCheck" tone="neutral">
          <KSkeleton v-if="!activityLoaded" :lines="4" />
          <p v-else-if="!activity.length" class="text-[13.5px] text-ink-muted">No changes recorded yet.</p>
          <ol v-else class="relative space-y-4 border-l border-line pl-5">
            <li v-for="entry in activity" :key="entry.id" class="relative">
              <span class="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-brand ring-4 ring-surface" aria-hidden="true" />
              <p class="text-[13.5px]">{{ describe(entry) }}</p>
              <p class="text-[12px] text-ink-muted">{{ formatDate(entry.created_at) }}, {{ new Date(entry.created_at).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' }) }}</p>
            </li>
          </ol>
        </KCard>
      </div>
    </template>

    <GuardianLinkModal
      v-if="student"
      v-model:open="linkOpen"
      :school-id="schoolId"
      :student-id="student.id"
      :guardians="guardians"
      :linked-ids="links.map((l) => l.guardian_id)"
      :link="editingLink"
      @saved="load"
    />

    <KModal :open="Boolean(inviteResult)" title="Parent portal invitation" @update:open="!$event && (inviteResult = null)">
      <InvitationShare
        v-if="inviteResult"
        v-bind="inviteResult"
        :school-name="workspace.currentSchool?.name ?? 'Your school'"
        purpose="follow your child on Klasora"
      />
      <template #footer><KButton @click="inviteResult = null">Done</KButton></template>
    </KModal>

    <KModal v-model:open="moveOpen" :title="current ? 'Move to another class' : 'Place in a class'" description="Their current class is kept in their history.">
      <div class="space-y-4">
        <KSelect
          v-model="moveClass"
          :label="words.group"
          placeholder="Choose a class"
          :options="classes.filter((c) => c.status === 'active' && c.id !== current?.class_id).map((c) => ({ value: c.id, label: c.name }))"
        />
        <KInput v-model="moveDate" type="date" label="Starting" />
      </div>
      <template #footer>
        <KButton variant="secondary" @click="moveOpen = false">Cancel</KButton>
        <KButton :disabled="!moveClass" :loading="saving" @click="submitMove">Confirm</KButton>
      </template>
    </KModal>

    <KModal v-model:open="healthOpen" title="Health and welfare" description="Only staff with health access and the child's guardians can see this." size="lg">
      <div class="grid gap-4 sm:grid-cols-2">
        <KSelect v-model="health.bloodGroup" label="Blood group" :options="[{ value: '', label: 'Not known' }, ...BLOOD_GROUPS.map((b) => ({ value: b, label: bloodGroupLabel(b) }))]" />
        <KSelect v-model="health.genotype" label="Genotype" :options="[{ value: '', label: 'Not known' }, ...GENOTYPES.map((g) => ({ value: g, label: g }))]" />
        <KTextarea v-model="health.medicalConditions" label="Medical conditions" :rows="2" optional />
        <KTextarea v-model="health.allergies" label="Allergies" :rows="2" optional />
        <KTextarea v-model="health.medications" label="Medication" :rows="2" optional />
        <KTextarea v-model="health.accessibilityNeeds" label="Accessibility or learning needs" :rows="2" optional />
        <KInput v-model="health.emergencyContactName" label="Emergency contact" optional />
        <KInput v-model="health.emergencyContactPhone" type="tel" label="Emergency phone" :error="healthErrors.emergencyContactPhone" optional />
        <KInput v-model="health.emergencyContactRelationship" label="Their relationship" optional />
        <KInput v-model="health.homeAddress" label="Home address" optional />
      </div>
      <template #footer>
        <KButton variant="secondary" @click="healthOpen = false">Cancel</KButton>
        <KButton :loading="saving" @click="saveHealth">Save</KButton>
      </template>
    </KModal>
    <KModal v-model:open="studentInviteOpen" title="Student portal" :description="studentInviteResult ? undefined : 'Students can see their timetable, hand in assignments and view published results. Use an email address the student can open.'">
      <InvitationShare
        v-if="studentInviteResult"
        v-bind="studentInviteResult"
        :school-name="workspace.currentSchool?.name ?? 'Your school'"
        purpose="use the Klasora student portal"
      />
      <KInput v-else v-model="studentEmail" type="email" label="Student's email address" autofocus />
      <template #footer>
        <template v-if="studentInviteResult"><KButton @click="studentInviteOpen = false">Done</KButton></template>
        <template v-else>
          <KButton variant="secondary" @click="studentInviteOpen = false">Cancel</KButton>
          <KButton :loading="invitingStudent" :disabled="!studentEmail.trim()" @click="inviteToPortal">Create invitation</KButton>
        </template>
      </template>
    </KModal>
  </div>
</template>
