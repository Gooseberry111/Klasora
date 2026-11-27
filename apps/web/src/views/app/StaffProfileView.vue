<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { BookOpen, BriefcaseBusiness, Mail, Pencil, School, ShieldCheck, UserRound } from 'lucide-vue-next';
import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  formatDmy,
  staffProfileSchema,
  validate,
  type ClassSubject,
  type Department,
  type FieldErrors,
  type SchoolClass,
  type SchoolMember,
  type StaffProfile,
  type StaffProfileInput,
  type Subject,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KCard from '@/components/ui/KCard.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { listClassSubjects, listClasses, listDepartments, listMembers, listSubjects } from '@/services/setup';
import { listStaffProfiles, saveStaffProfile } from '@/services/students';
import { fullName, useSchool } from '@/composables/useSchool';

const route = useRoute();
const { schoolId, slug, can, words, attempt } = useSchool();
const userId = computed(() => String(route.params.userId ?? ''));

const memberships = ref<SchoolMember[]>([]);
const profile = ref<StaffProfile | null>(null);
const departments = ref<Department[]>([]);
const classes = ref<SchoolClass[]>([]);
const subjects = ref<Subject[]>([]);
const assignments = ref<ClassSubject[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value || !userId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const [members, profiles, depts] = await Promise.all([
      listMembers(schoolId.value),
      listStaffProfiles(schoolId.value),
      listDepartments(schoolId.value).catch(() => []),
    ]);
    memberships.value = members.filter((m) => m.user_id === userId.value);
    profile.value = profiles.find((p) => p.user_id === userId.value) ?? null;
    departments.value = depts;
    [classes.value, subjects.value, assignments.value] = await Promise.all([
      listClasses(schoolId.value).catch(() => []),
      listSubjects(schoolId.value).catch(() => []),
      listClassSubjects(schoolId.value).catch(() => []),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([schoolId, userId], load, { immediate: true });

const person = computed(() => memberships.value[0] ?? null);
const membershipIds = computed(() => new Set(memberships.value.map((m) => m.membership_id)));
const classTeacherOf = computed(() => classes.value.filter((c) => c.class_teacher_membership_id && membershipIds.value.has(c.class_teacher_membership_id)));
const teaches = computed(() =>
  assignments.value
    .filter((a) => a.teacher_membership_id && membershipIds.value.has(a.teacher_membership_id))
    .map((a) => ({ id: a.id, subject: subjects.value.find((s) => s.id === a.subject_id), cls: classes.value.find((c) => c.id === a.class_id) }))
    .filter((x) => x.subject && x.cls),
);
const departmentName = computed(() => departments.value.find((d) => d.id === profile.value?.department_id)?.name);

// Edit
const open = ref(false);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<StaffProfileInput>({
  staffNumber: '', jobTitle: '', departmentId: '', employmentType: 'full_time', employmentStatus: 'active', employmentStartDate: '', qualifications: '',
});

function openForm() {
  const p = profile.value;
  Object.assign(form, {
    staffNumber: p?.staff_number ?? '',
    jobTitle: p?.job_title ?? '',
    departmentId: p?.department_id ?? '',
    employmentType: p?.employment_type ?? 'full_time',
    employmentStatus: p?.employment_status ?? 'active',
    employmentStartDate: p?.employment_start_date ?? '',
    qualifications: p?.qualifications ?? '',
  });
  errors.value = {};
  open.value = true;
}

async function submit() {
  const result = validate(staffProfileSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(() => saveStaffProfile(schoolId.value, userId.value, result.data), 'Staff profile saved.');
  saving.value = false;
  if (saved) {
    profile.value = saved;
    open.value = false;
  }
}
</script>

<template>
  <div>
    <KSkeleton v-if="loading" :lines="8" />
    <KAlert v-else-if="error" tone="danger">{{ error }}</KAlert>
    <div v-else-if="!person" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="UserRound" title="This person could not be found">
        <KButton :to="{ name: 'staff', params: { slug } }">Back to staff</KButton>
      </KEmptyState>
    </div>

    <template v-else>
      <KPageHeader
        :title="fullName(person)"
        :description="profile?.job_title ?? memberships.map((m) => m.role_name).join(', ')"
        :breadcrumbs="[{ label: 'Teachers and staff', to: { name: 'staff', params: { slug } } }, { label: fullName(person) }]"
      >
        <template #actions>
          <KButton v-if="can('staff.edit')" :icon="Pencil" @click="openForm">Edit staff details</KButton>
        </template>
      </KPageHeader>

      <div class="grid gap-6 lg:grid-cols-3">
        <div class="space-y-6">
          <KCard :padded="false">
            <div class="k-bg-hero relative h-20 rounded-t-card"><div class="k-dots-light absolute inset-0" aria-hidden="true" /></div>
            <div class="px-5 pb-5">
              <div class="-mt-9 w-fit rounded-full ring-4 ring-surface"><KAvatar :name="fullName(person)" :src="person.avatar_url" :size="72" /></div>
              <p class="mt-3 text-[16px] font-semibold">{{ fullName(person) }}</p>
              <p class="flex items-center gap-1.5 text-[13.5px] text-ink-muted"><Mail :size="14" aria-hidden="true" /> {{ person.email }}</p>
              <div class="mt-3 flex flex-wrap gap-1.5">
                <KBadge v-for="m in memberships" :key="m.membership_id" :tone="m.status === 'active' ? 'brand' : 'neutral'">
                  {{ m.role_name }}<template v-if="m.status !== 'active'">, {{ MEMBERSHIP_STATUS_LABELS[m.status] }}</template>
                </KBadge>
              </div>
            </div>
          </KCard>

          <KCard title="Employment" :icon="BriefcaseBusiness" tone="violet">
            <p v-if="!profile" class="text-[13.5px] text-ink-muted">No staff details recorded yet.</p>
            <dl v-else class="space-y-3 text-[13.5px]">
              <div v-for="[label, value] in [
                ['Staff number', profile.staff_number ?? 'Not set'],
                ['Job title', profile.job_title ?? 'Not set'],
                [words.unit, departmentName ?? 'None'],
                ['Employment', EMPLOYMENT_TYPE_LABELS[profile.employment_type]],
                ['Status', EMPLOYMENT_STATUS_LABELS[profile.employment_status]],
                ['Started', profile.employment_start_date ? formatDmy(profile.employment_start_date) : 'Not set'],
              ]" :key="label">
                <dt class="text-[12.5px] text-ink-muted">{{ label }}</dt>
                <dd class="mt-0.5">{{ value }}</dd>
              </div>
              <div v-if="profile.qualifications">
                <dt class="text-[12.5px] text-ink-muted">Qualifications</dt>
                <dd class="mt-0.5 whitespace-pre-line">{{ profile.qualifications }}</dd>
              </div>
            </dl>
          </KCard>
        </div>

        <div class="space-y-6 lg:col-span-2">
          <KCard :title="`Class teacher of`" :icon="School" :padded="false">
            <KEmptyState v-if="!classTeacherOf.length" compact :icon="School" :title="`Not a class teacher`" :description="`Assign class teachers from each ${words.group.toLowerCase()}.`" />
            <ul v-else class="divide-y divide-line">
              <li v-for="c in classTeacherOf" :key="c.id">
                <RouterLink :to="{ name: 'class-detail', params: { slug, classId: c.id } }" class="flex items-center justify-between px-5 py-3 hover:bg-surface-muted/60">
                  <span class="font-medium">{{ c.name }}</span>
                  <KBadge tone="brand">Class teacher</KBadge>
                </RouterLink>
              </li>
            </ul>
          </KCard>
          <KCard :title="`${words.subjects} taught`" :icon="BookOpen" tone="success" :padded="false">
            <KEmptyState v-if="!teaches.length" compact :icon="BookOpen" :title="`No ${words.subjects.toLowerCase()} assigned`" :description="`Assign teachers from each ${words.group.toLowerCase()} page.`" />
            <ul v-else class="divide-y divide-line">
              <li v-for="t in teaches" :key="t.id" class="flex items-center justify-between px-5 py-3">
                <span>
                  <span class="font-medium">{{ t.subject!.name }}</span>
                  <span class="ml-2 text-[12.5px] text-ink-muted">{{ t.subject!.code }}</span>
                </span>
                <RouterLink :to="{ name: 'class-detail', params: { slug, classId: t.cls!.id } }" class="text-[13.5px] font-medium text-brand-ink hover:underline">{{ t.cls!.name }}</RouterLink>
              </li>
            </ul>
          </KCard>
          <p class="flex items-center gap-2 text-[12.5px] text-ink-subtle">
            <ShieldCheck :size="14" aria-hidden="true" /> Staff details are never shown to parents or students.
          </p>
        </div>
      </div>

      <KModal v-model:open="open" title="Staff details" size="lg">
        <form id="staff-profile-form" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submit">
          <KInput v-model="form.staffNumber" label="Staff number" :error="errors.staffNumber" optional />
          <KInput v-model="form.jobTitle" label="Job title" placeholder="Mathematics teacher" :error="errors.jobTitle" optional />
          <KSelect v-if="departments.length" v-model="form.departmentId" :label="words.unit" :options="[{ value: '', label: 'None' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]" />
          <KSelect v-model="form.employmentType" label="Employment" :options="Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))" />
          <KSelect v-model="form.employmentStatus" label="Status" :options="Object.entries(EMPLOYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))" />
          <KInput v-model="form.employmentStartDate" type="date" label="Start date" :error="errors.employmentStartDate" optional />
          <div class="sm:col-span-2"><KTextarea v-model="form.qualifications" label="Qualifications" :rows="3" optional /></div>
        </form>
        <template #footer>
          <KButton variant="secondary" @click="open = false">Cancel</KButton>
          <KButton type="submit" form="staff-profile-form" :loading="saving">Save</KButton>
        </template>
      </KModal>
    </template>
  </div>
</template>
