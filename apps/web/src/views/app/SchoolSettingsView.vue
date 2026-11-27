<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ImagePlus, Landmark, Save, Settings, Trash2, Upload } from 'lucide-vue-next';
import {
  ACADEMIC_STRUCTURE_DETAILS,
  COUNTRIES,
  INSTITUTION_TYPE_LABELS,
  NIGERIAN_STATES,
  TIMEZONES,
  schoolProfileSchema,
  validate,
  type FieldErrors,
  type School,
  type SchoolProfileInput,
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
import { fetchSchool } from '@/services/workspace';
import { removeSchoolLogo, updateSchoolProfile, uploadSchoolLogo } from '@/services/setup';
import { useSchool } from '@/composables/useSchool';

const { workspace, schoolId, can, writable, feedback, attempt } = useSchool();
const canEdit = computed(() => can('settings.edit') && writable.value);

const school = ref<School | null>(null);
const loading = ref(true);
const error = ref('');
const saving = ref(false);
const uploading = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<SchoolProfileInput>({
  name: '',
  motto: '',
  registrationNumber: '',
  email: '',
  phone: '',
  website: '',
  country: 'NG',
  state: '',
  city: '',
  address: '',
  timezone: 'Africa/Lagos',
});

function fill(s: School) {
  Object.assign(form, {
    name: s.name,
    motto: s.motto ?? '',
    registrationNumber: s.registration_number ?? '',
    email: s.email,
    phone: s.phone,
    website: s.website ?? '',
    country: s.country,
    state: s.state,
    city: s.city,
    address: s.address,
    timezone: s.timezone,
  });
}

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    school.value = await fetchSchool(schoolId.value);
    fill(school.value);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));
const stateOptions = NIGERIAN_STATES.map((s) => ({ value: s, label: s }));
const timezoneOptions = TIMEZONES.map((t) => ({ value: t, label: t.replace('_', ' ').replace('/', ', ') }));
const websitePlaceholder = 'https://yourschool.com';

async function submit() {
  const result = validate(schoolProfileSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  errors.value = {};
  saving.value = true;
  const saved = await attempt(() => updateSchoolProfile(schoolId.value, result.data), 'School profile saved.');
  saving.value = false;
  if (saved) {
    school.value = saved;
    workspace.patchSchool(saved.id, { name: saved.name });
  }
}

const fileInput = ref<HTMLInputElement | null>(null);

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  uploading.value = true;
  const saved = await attempt(() => uploadSchoolLogo(schoolId.value, file), 'Logo updated.');
  uploading.value = false;
  if (saved) {
    school.value = saved;
    workspace.patchSchool(saved.id, { logo_url: saved.logo_url });
  }
}

async function removeLogo() {
  const ok = await feedback.confirm({
    title: 'Remove the school logo?',
    description: 'Your initials will be shown instead until you upload a new one.',
    confirmLabel: 'Remove logo',
    tone: 'danger',
  });
  if (!ok) return;
  const saved = await attempt(() => removeSchoolLogo(schoolId.value), 'Logo removed.');
  if (saved) {
    school.value = saved;
    workspace.patchSchool(saved.id, { logo_url: null });
  }
}
</script>

<template>
  <div>
    <KPageHeader :icon="Settings" eyebrow="System" title="School settings" description="Your school's identity and contact details, as they appear across Klasora and on documents." />

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>
    <KAlert v-if="!canEdit && !loading" tone="info" class="mb-6">You can view these settings. Ask an administrator if something needs to change.</KAlert>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
      <KCard title="School profile" description="Name, motto and contact details." :icon="Landmark">
        <KSkeleton v-if="loading" :lines="8" />
        <form v-else id="school-form" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submit">
          <div class="sm:col-span-2"><KInput v-model="form.name" label="School name" :error="errors.name" :disabled="!canEdit" required /></div>
          <div class="sm:col-span-2"><KInput v-model="form.motto" label="Motto" placeholder="Knowledge and character" :error="errors.motto" :disabled="!canEdit" optional /></div>
          <KInput v-model="form.email" label="Email" type="email" :error="errors.email" :disabled="!canEdit" required />
          <KInput v-model="form.phone" label="Phone" type="tel" :error="errors.phone" :disabled="!canEdit" required />
          <KInput v-model="form.website" label="Website" type="url" :placeholder="websitePlaceholder" :error="errors.website" :disabled="!canEdit" optional />
          <KInput v-model="form.registrationNumber" label="Registration number" :error="errors.registrationNumber" :disabled="!canEdit" optional />
          <KSelect v-model="form.country" label="Country" :options="countryOptions" :error="errors.country" :disabled="!canEdit" />
          <KSelect v-if="form.country === 'NG'" v-model="form.state" label="State" :options="stateOptions" :error="errors.state" :disabled="!canEdit" />
          <KInput v-else v-model="form.state" label="State or region" :error="errors.state" :disabled="!canEdit" />
          <KInput v-model="form.city" label="City or town" :error="errors.city" :disabled="!canEdit" />
          <KSelect v-model="form.timezone" label="Time zone" :options="timezoneOptions" :disabled="!canEdit" />
          <div class="sm:col-span-2"><KTextarea v-model="form.address" label="Street address" :rows="2" :error="errors.address" /></div>
        </form>
        <template v-if="canEdit && !loading" #footer>
          <KButton variant="ghost" @click="school && fill(school)">Discard changes</KButton>
          <KButton type="submit" form="school-form" :icon="Save" :loading="saving">Save profile</KButton>
        </template>
      </KCard>

      <div class="space-y-6">
        <KCard title="Logo" description="Square images look best. PNG, JPG, WEBP or SVG up to 2 MB." :icon="ImagePlus" tone="violet">
          <div class="flex flex-col items-center text-center">
            <div class="rounded-[22px] bg-gradient-to-br from-brand-soft to-surface-muted p-3 ring-1 ring-line">
              <KAvatar :name="school?.name ?? 'School'" :src="school?.logo_url" :size="104" square />
            </div>
            <p class="mt-3 text-[13px] text-ink-muted">{{ school?.logo_url ? 'Shown in the sidebar, on invitations and reports.' : 'No logo yet. Your initials are shown instead.' }}</p>
            <div v-if="canEdit" class="mt-4 flex gap-2">
              <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="sr-only" @change="onFile" />
              <KButton :icon="Upload" :loading="uploading" @click="fileInput?.click()">{{ school?.logo_url ? 'Replace' : 'Upload logo' }}</KButton>
              <KButton v-if="school?.logo_url" variant="ghost" :icon="Trash2" class="text-danger-ink hover:bg-danger-soft" @click="removeLogo">Remove</KButton>
            </div>
          </div>
        </KCard>

        <KCard v-if="school" title="Organisation" :icon="Settings" tone="neutral">
          <dl class="space-y-3 text-[13.5px]">
            <div>
              <dt class="text-ink-muted">Institution type</dt>
              <dd class="mt-0.5 font-medium">{{ INSTITUTION_TYPE_LABELS[school.institution_type] }}</dd>
            </div>
            <div>
              <dt class="text-ink-muted">Academic structure</dt>
              <dd class="mt-0.5 font-medium">{{ ACADEMIC_STRUCTURE_DETAILS[school.academic_structure].label }}</dd>
              <dd class="mt-0.5 text-[12.5px] text-ink-muted">{{ ACADEMIC_STRUCTURE_DETAILS[school.academic_structure].description }}</dd>
            </div>
          </dl>
        </KCard>
      </div>
    </div>
  </div>
</template>
