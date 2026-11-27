<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Building2, MapPin, Pencil, Phone, Plus, Star, Trash2 } from 'lucide-vue-next';
import { campusSchema, validate, type Campus, type CampusInput, type FieldErrors } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { deleteCampus, listCampuses, saveCampus, setMainCampus } from '@/services/setup';
import { useSchool } from '@/composables/useSchool';

const { schoolId, can, writable, feedback, attempt } = useSchool();
const canEdit = computed(() => can('settings.edit') && writable.value);

const campuses = ref<Campus[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    campuses.value = await listCampuses(schoolId.value);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

// Form
const open = ref(false);
const editing = ref<Campus | null>(null);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<CampusInput>({ name: '', code: '', address: '', contactPhone: '', status: 'active' });

function openForm(campus?: Campus) {
  editing.value = campus ?? null;
  Object.assign(form, {
    name: campus?.name ?? '',
    code: campus?.code ?? '',
    address: campus?.address ?? '',
    contactPhone: campus?.contact_phone ?? '',
    status: campus?.status ?? 'active',
  });
  errors.value = {};
  open.value = true;
}

// Suggest a code from the name while the person types.
watch(
  () => form.name,
  (name) => {
    if (editing.value) return;
    form.code = name
      .toUpperCase()
      .replace(/CAMPUS/g, '')
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 12);
  },
);

async function submit() {
  const result = validate(campusSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(
    () => saveCampus(schoolId.value, result.data, editing.value?.id),
    editing.value ? 'Campus updated.' : 'Campus added.',
  );
  saving.value = false;
  if (saved) {
    open.value = false;
    await load();
  }
}

async function makeMain(campus: Campus) {
  const ok = await feedback.confirm({
    title: `Make ${campus.name} the main campus?`,
    description: 'The main campus is used by default for new classes and people. You can change it again at any time.',
    confirmLabel: 'Make main campus',
    tone: 'primary',
  });
  if (!ok) return;
  await attempt(() => setMainCampus(campus.id), `${campus.name} is now the main campus.`);
  await load();
}

async function remove(campus: Campus) {
  const ok = await feedback.confirm({
    title: `Remove ${campus.name}?`,
    description: 'This removes the campus permanently. Campuses with classes cannot be removed; mark them inactive instead.',
    confirmLabel: 'Remove campus',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => deleteCampus(campus.id), 'Campus removed.');
  await load();
}
</script>

<template>
  <div>
    <KPageHeader
      :icon="Building2"
      eyebrow="School management"
      title="Campuses"
      description="Every location where your school operates. Classes, staff and students belong to a campus."
    >
      <template #actions>
        <KButton v-if="canEdit" :icon="Plus" @click="openForm()">Add campus</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <div v-if="loading" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 3" :key="n" class="rounded-card border border-line bg-surface p-5"><KSkeleton :lines="4" /></div>
    </div>

    <div v-else-if="campuses.length" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="campus in campuses"
        :key="campus.id"
        class="k-fade-up group relative overflow-hidden rounded-card border border-line bg-surface shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-hover"
      >
        <div :class="['h-1.5', campus.is_main ? 'k-bg-brand' : 'bg-surface-muted']" aria-hidden="true" />
        <div class="p-5">
          <div class="flex items-start gap-3.5">
            <KIconTile :icon="Building2" :tone="campus.is_main ? 'brand' : 'info'" :solid="campus.is_main" :size="44" />
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-[15.5px] font-semibold">{{ campus.name }}</h2>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <KBadge tone="neutral">{{ campus.code }}</KBadge>
                <KBadge v-if="campus.is_main" tone="brand"><Star :size="11" aria-hidden="true" /> Main campus</KBadge>
                <KBadge :tone="campus.status === 'active' ? 'success' : 'neutral'" dot>
                  {{ campus.status === 'active' ? 'Active' : 'Inactive' }}
                </KBadge>
              </div>
            </div>
          </div>
          <dl class="mt-5 space-y-2.5 text-[13.5px]">
            <div class="flex gap-2.5 text-ink-muted">
              <MapPin :size="16" class="mt-0.5 shrink-0 text-ink-subtle" aria-hidden="true" />
              <dt class="sr-only">Address</dt>
              <dd>{{ campus.address || 'No address added' }}</dd>
            </div>
            <div class="flex gap-2.5 text-ink-muted">
              <Phone :size="16" class="mt-0.5 shrink-0 text-ink-subtle" aria-hidden="true" />
              <dt class="sr-only">Phone</dt>
              <dd>{{ campus.contact_phone || 'No phone number added' }}</dd>
            </div>
          </dl>
        </div>
        <footer v-if="canEdit" class="flex flex-wrap items-center gap-1 border-t border-line bg-surface-muted/40 px-3 py-2">
          <KButton size="sm" variant="ghost" :icon="Pencil" @click="openForm(campus)">Edit</KButton>
          <KButton v-if="!campus.is_main && campus.status === 'active'" size="sm" variant="ghost" :icon="Star" @click="makeMain(campus)">
            Make main
          </KButton>
          <KButton
            v-if="!campus.is_main"
            size="sm"
            variant="ghost"
            :icon="Trash2"
            class="ml-auto text-danger-ink hover:bg-danger-soft hover:text-danger-ink"
            @click="remove(campus)"
          >
            Remove
          </KButton>
        </footer>
      </article>
    </div>

    <div v-else class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="Building2" title="No campuses yet" description="Add the locations where your school operates.">
        <KButton v-if="canEdit" :icon="Plus" @click="openForm()">Add campus</KButton>
      </KEmptyState>
    </div>

    <KModal
      v-model:open="open"
      :title="editing ? `Edit ${editing.name}` : 'Add a campus'"
      description="Your plan decides how many campuses you can have."
    >
      <form id="campus-form" class="space-y-4" novalidate @submit.prevent="submit">
        <KInput v-model="form.name" label="Campus name" placeholder="Lekki Campus" :error="errors.name" required autofocus />
        <KInput
          v-model="form.code"
          label="Short code"
          hint="Shown on reports and ID cards. Letters, numbers and underscores."
          placeholder="LEKKI"
          :error="errors.code"
          required
        />
        <KTextarea v-model="form.address" label="Address" :rows="2" :error="errors.address" optional />
        <KInput v-model="form.contactPhone" label="Phone number" type="tel" :error="errors.contactPhone" optional />
        <KSelect
          v-if="editing && !editing.is_main"
          v-model="form.status"
          label="Status"
          :options="[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]"
        />
      </form>
      <template #footer>
        <KButton variant="secondary" @click="open = false">Cancel</KButton>
        <KButton type="submit" form="campus-form" :loading="saving">{{ editing ? 'Save changes' : 'Add campus' }}</KButton>
      </template>
    </KModal>
  </div>
</template>
