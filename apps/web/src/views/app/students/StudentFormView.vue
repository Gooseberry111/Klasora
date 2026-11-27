<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Camera, GraduationCap, HeartPulse, Link2, Plus, School, Trash2, UserRound, UsersRound } from 'lucide-vue-next';
import {
  BLOOD_GROUPS,
  GENOTYPES,
  GUARDIAN_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  STUDENT_STATUSES,
  STUDENT_STATUS_LABELS,
  bloodGroupLabel,
  isoDate,
  studentDetailsSchema,
  studentFormSchema,
  validate,
  type Campus,
  type FieldErrors,
  type Guardian,
  type SchoolClass,
  type StudentDetailsInput,
  type StudentFormInput,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KCard from '@/components/ui/KCard.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KBadge from '@/components/ui/KBadge.vue';
import { listCampuses, listClasses } from '@/services/setup';
import { getStudent, listGuardians, registerStudent, signedPhotoUrls, updateStudent, uploadStudentPhoto, type NewGuardian } from '@/services/students';
import { useSchool } from '@/composables/useSchool';

const route = useRoute();
const router = useRouter();
const { schoolId, slug, can, words, feedback } = useSchool();

const studentId = computed(() => (route.params.studentId ? String(route.params.studentId) : null));
const editing = computed(() => Boolean(studentId.value));
const canHealth = computed(() => can('student_health.edit'));

const campuses = ref<Campus[]>([]);
const classes = ref<SchoolClass[]>([]);
const existingGuardians = ref<Guardian[]>([]);
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const formError = ref('');
const errors = ref<FieldErrors>({});
const detailErrors = ref<FieldErrors>({});
const photoPreview = ref<string | null>(null);
const photoFile = ref<File | null>(null);

const today = isoDate(new Date());
const form = reactive<StudentFormInput>({
  firstName: '',
  middleName: '',
  lastName: '',
  gender: '',
  dateOfBirth: '',
  admissionNumber: '',
  admissionDate: today,
  campusId: '',
  classId: '',
  status: 'active',
  previousSchool: '',
});
const details = reactive<StudentDetailsInput>({
  homeAddress: '',
  bloodGroup: '',
  genotype: '',
  medicalConditions: '',
  allergies: '',
  medications: '',
  accessibilityNeeds: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
});

interface GuardianEntry extends NewGuardian {
  mode: 'new' | 'existing';
}
const guardianEntries = ref<GuardianEntry[]>([{ mode: 'new', first_name: '', last_name: '', email: '', phone: '', relationship: 'mother' }]);

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  try {
    [campuses.value, classes.value] = await Promise.all([listCampuses(schoolId.value), listClasses(schoolId.value)]);
    existingGuardians.value = await listGuardians(schoolId.value).catch(() => []);
    form.campusId = campuses.value.find((c) => c.is_main)?.id ?? campuses.value[0]?.id ?? '';
    if (studentId.value) {
      const s = await getStudent(schoolId.value, studentId.value);
      if (!s) throw new Error('This student could not be found.');
      Object.assign(form, {
        firstName: s.first_name,
        middleName: s.middle_name ?? '',
        lastName: s.last_name,
        gender: s.gender ?? '',
        dateOfBirth: s.date_of_birth ?? '',
        admissionNumber: s.admission_number,
        admissionDate: s.admission_date,
        campusId: s.campus_id,
        classId: '',
        status: s.status,
        previousSchool: s.previous_school ?? '',
      });
      if (s.photo_path) photoPreview.value = (await signedPhotoUrls([s.photo_path]))[s.photo_path] ?? null;
    }
  } catch (e) {
    loadError.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([schoolId, studentId], load, { immediate: true });

const classOptions = computed(() => [
  { value: '', label: `Place in a ${words.value.group.toLowerCase()} later` },
  ...classes.value.filter((c) => c.status === 'active' && (!form.campusId || c.campus_id === form.campusId)).map((c) => ({ value: c.id, label: c.name })),
]);
const relationshipOptions = GUARDIAN_RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }));
const guardianOptions = computed(() => [
  { value: '', label: 'Choose a guardian' },
  ...existingGuardians.value.map((g) => ({ value: g.id, label: `${g.first_name} ${g.last_name}${g.email ? ` (${g.email})` : g.phone ? ` (${g.phone})` : ''}` })),
]);

function matchByEmail(entry: GuardianEntry) {
  const email = entry.email?.trim().toLowerCase();
  return email ? existingGuardians.value.find((g) => g.email?.toLowerCase() === email) : undefined;
}

function addGuardian() {
  guardianEntries.value.push({ mode: 'new', first_name: '', last_name: '', email: '', phone: '', relationship: 'father' });
}

function onPhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    feedback.error('Choose a PNG, JPG or WEBP photo.');
    return;
  }
  photoFile.value = file;
  photoPreview.value = URL.createObjectURL(file);
}

function guardiansPayload(): NewGuardian[] | null {
  const result: NewGuardian[] = [];
  for (const [i, g] of guardianEntries.value.entries()) {
    if (g.mode === 'existing') {
      if (!g.guardian_id) continue;
      result.push({ guardian_id: g.guardian_id, relationship: g.relationship });
      continue;
    }
    const filled = [g.first_name, g.last_name, g.email, g.phone].some((v) => v?.trim());
    if (!filled) continue;
    if (!g.first_name?.trim() || !g.last_name?.trim()) {
      formError.value = `Guardian ${i + 1}: enter their first and last name.`;
      return null;
    }
    if (!g.email?.trim() && !g.phone?.trim()) {
      formError.value = `Guardian ${i + 1}: add an email address or phone number.`;
      return null;
    }
    if (g.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.email.trim())) {
      formError.value = `Guardian ${i + 1}: the email address is not valid.`;
      return null;
    }
    result.push({ ...g, email: g.email?.trim().toLowerCase() });
  }
  return result;
}

async function submit(addAnother = false) {
  formError.value = '';
  const result = validate(studentFormSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    formError.value = 'Please check the highlighted fields.';
    return;
  }
  errors.value = {};
  let healthInput: StudentDetailsInput | null = null;
  if (!editing.value && canHealth.value) {
    const health = validate(studentDetailsSchema, details);
    if (!health.success) {
      detailErrors.value = health.errors;
      formError.value = 'Please check the health and welfare details.';
      return;
    }
    detailErrors.value = {};
    healthInput = health.data;
  }
  const guardians = editing.value ? [] : guardiansPayload();
  if (guardians === null) return;

  saving.value = true;
  try {
    let id: string;
    if (editing.value) {
      id = (await updateStudent(studentId.value!, result.data)).id;
    } else {
      id = await registerStudent(schoolId.value, result.data, healthInput, guardians);
    }
    if (photoFile.value) {
      await uploadStudentPhoto(schoolId.value, id, photoFile.value).catch((e: Error) => feedback.error(e.message));
    }
    feedback.success(editing.value ? 'Changes saved.' : `${result.data.firstName} ${result.data.lastName} is registered.`);
    if (addAnother) {
      Object.assign(form, { firstName: '', middleName: '', lastName: '', gender: '', dateOfBirth: '', admissionNumber: '', previousSchool: '' });
      Object.keys(details).forEach((k) => ((details as Record<string, string>)[k] = ''));
      photoFile.value = null;
      photoPreview.value = null;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      await router.push({ name: 'student-detail', params: { slug: slug.value, studentId: id } });
    }
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-[920px]">
    <KPageHeader
      :icon="GraduationCap"
      :title="editing ? 'Edit student' : 'Register a student'"
      :description="editing ? 'Update personal and admission details. Guardians, class and health details are managed on the profile.' : 'Only the name is required. Everything else can be added later.'"
      :breadcrumbs="[{ label: 'Students', to: { name: 'students', params: { slug } } }, { label: editing ? 'Edit' : 'Register' }]"
    />

    <KAlert v-if="loadError" tone="danger">{{ loadError }}</KAlert>
    <KSkeleton v-else-if="loading" :lines="10" />

    <form v-else class="space-y-6" novalidate @submit.prevent="submit()">
      <KAlert v-if="formError" tone="danger">{{ formError }}</KAlert>

      <KCard title="Personal information" :icon="UserRound">
        <div class="flex flex-col gap-6 sm:flex-row">
          <div class="flex shrink-0 flex-col items-center gap-2">
            <label class="group relative cursor-pointer rounded-full focus-within:ring-4 focus-within:ring-focus">
              <KAvatar :name="`${form.firstName} ${form.lastName}`.trim() || 'Student'" :src="photoPreview" :size="104" />
              <span class="absolute inset-0 flex items-center justify-center rounded-full bg-[#0b1322]/0 text-white opacity-0 transition group-hover:bg-[#0b1322]/45 group-hover:opacity-100">
                <Camera :size="22" aria-hidden="true" />
              </span>
              <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" aria-label="Choose a photo" @change="onPhoto" />
            </label>
            <span class="text-[12px] text-ink-muted">{{ photoPreview ? 'Click to change' : 'Add a photo' }}</span>
          </div>
          <div class="grid flex-1 gap-4 sm:grid-cols-3">
            <KInput v-model="form.firstName" label="First name" :error="errors.firstName" required autofocus />
            <KInput v-model="form.middleName" label="Middle name" :error="errors.middleName" optional />
            <KInput v-model="form.lastName" label="Last name" :error="errors.lastName" required />
            <KSelect v-model="form.gender" label="Gender" :options="[{ value: '', label: 'Not stated' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]" />
            <KInput v-model="form.dateOfBirth" type="date" label="Date of birth" :error="errors.dateOfBirth" optional />
            <KInput v-model="form.previousSchool" label="Previous school" :error="errors.previousSchool" optional />
          </div>
        </div>
      </KCard>

      <KCard title="Admission" :icon="School" tone="violet">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KInput
            v-model="form.admissionNumber"
            label="Admission number"
            :hint="editing ? undefined : 'Leave empty and Klasora will create one, like GA/2026/0001.'"
            :error="errors.admissionNumber"
            :required="editing"
            :optional="!editing"
          />
          <KInput v-model="form.admissionDate" type="date" label="Admission date" :error="errors.admissionDate" required />
          <KSelect v-model="form.status" label="Status" :options="STUDENT_STATUSES.map((s) => ({ value: s, label: STUDENT_STATUS_LABELS[s] }))" />
          <KSelect v-if="campuses.length > 1" v-model="form.campusId" label="Campus" :options="campuses.map((c) => ({ value: c.id, label: c.name }))" />
          <KSelect v-if="!editing" v-model="form.classId" :label="words.group" :options="classOptions" />
        </div>
      </KCard>

      <KCard v-if="!editing" title="Parents and guardians" description="Link an existing guardian (for siblings) or add a new one. You can invite them to the parent portal from the profile." :icon="UsersRound" tone="success">
        <div class="space-y-4">
          <div v-for="(g, i) in guardianEntries" :key="i" class="rounded-xl border border-line p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p class="text-[13.5px] font-semibold">
                Guardian {{ i + 1 }}
                <KBadge v-if="i === 0" tone="brand" class="ml-1">Primary</KBadge>
              </p>
              <div class="flex items-center gap-1">
                <div v-if="existingGuardians.length" class="inline-flex rounded-lg border border-line p-0.5 text-[12.5px]">
                  <button type="button" :class="['rounded-md px-2.5 py-1', g.mode === 'new' ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted']" @click="g.mode = 'new'">New</button>
                  <button type="button" :class="['flex items-center gap-1 rounded-md px-2.5 py-1', g.mode === 'existing' ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted']" @click="g.mode = 'existing'">
                    <Link2 :size="13" aria-hidden="true" /> Existing
                  </button>
                </div>
                <KButton v-if="guardianEntries.length > 1" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove guardian ${i + 1}`" class="text-danger-ink" @click="guardianEntries.splice(i, 1)" />
              </div>
            </div>
            <div v-if="g.mode === 'existing'" class="grid gap-4 sm:grid-cols-[1fr_200px]">
              <KSelect :model-value="g.guardian_id ?? ''" label="Guardian" :options="guardianOptions" @update:model-value="g.guardian_id = $event" />
              <KSelect v-model="g.relationship" label="Relationship" :options="relationshipOptions" />
            </div>
            <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KInput v-model="g.first_name" label="First name" />
              <KInput v-model="g.last_name" label="Last name" />
              <KSelect v-model="g.relationship" label="Relationship" :options="relationshipOptions" />
              <KInput v-model="g.email" type="email" label="Email" optional />
              <KInput v-model="g.phone" type="tel" label="Phone" placeholder="+234 803 000 0000" optional />
              <KInput v-model="g.occupation" label="Occupation" optional />
              <p v-if="matchByEmail(g)" class="flex items-center gap-1.5 text-[12.5px] text-success-ink sm:col-span-3">
                <Link2 :size="14" aria-hidden="true" /> This email belongs to {{ matchByEmail(g)!.first_name }} {{ matchByEmail(g)!.last_name }}. They will be linked instead of added again.
              </p>
            </div>
          </div>
          <KButton variant="ghost" size="sm" :icon="Plus" @click="addGuardian">Add another guardian</KButton>
        </div>
      </KCard>

      <KCard v-if="!editing && canHealth" title="Health and welfare" description="Only staff with health access and the child's guardians can see this." :icon="HeartPulse" tone="danger">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KSelect v-model="details.bloodGroup" label="Blood group" :options="[{ value: '', label: 'Not known' }, ...BLOOD_GROUPS.map((b) => ({ value: b, label: bloodGroupLabel(b) }))]" />
          <KSelect v-model="details.genotype" label="Genotype" :options="[{ value: '', label: 'Not known' }, ...GENOTYPES.map((g) => ({ value: g, label: g }))]" />
          <KInput v-model="details.emergencyContactName" label="Emergency contact" optional />
          <KInput v-model="details.emergencyContactPhone" type="tel" label="Emergency phone" :error="detailErrors.emergencyContactPhone" optional />
          <KInput v-model="details.emergencyContactRelationship" label="Their relationship" optional />
          <KInput v-model="details.homeAddress" label="Home address" optional />
          <div class="sm:col-span-2 lg:col-span-3 grid gap-4 sm:grid-cols-2">
            <KTextarea v-model="details.medicalConditions" label="Medical conditions" :rows="2" optional />
            <KTextarea v-model="details.allergies" label="Allergies" :rows="2" optional />
            <KTextarea v-model="details.medications" label="Medication" :rows="2" optional />
            <KTextarea v-model="details.accessibilityNeeds" label="Accessibility or learning needs" :rows="2" optional />
          </div>
        </div>
      </KCard>

      <div class="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-surface/90 px-4 py-4 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-card sm:border">
        <KButton variant="ghost" :to="editing ? { name: 'student-detail', params: { slug, studentId } } : { name: 'students', params: { slug } }">Cancel</KButton>
        <KButton v-if="!editing" variant="secondary" :loading="saving" @click="submit(true)">Save and add another</KButton>
        <KButton type="submit" :loading="saving">{{ editing ? 'Save changes' : 'Register student' }}</KButton>
      </div>
    </form>
  </div>
</template>
