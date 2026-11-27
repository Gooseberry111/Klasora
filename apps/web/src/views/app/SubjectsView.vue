<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { BookOpen, Pencil, Plus, Search, Trash2, Wand2 } from 'lucide-vue-next';
import {
  subjectPresets,
  subjectSchema,
  validate,
  type ClassSubject,
  type Department,
  type FieldErrors,
  type Subject,
  type SubjectInput,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { createSubjects, deleteSubject, listClassSubjects, listDepartments, listSubjects, saveSubject } from '@/services/setup';
import { useSchool } from '@/composables/useSchool';

const { workspace, schoolId, can, words, writable, feedback, attempt } = useSchool();
const canCreate = computed(() => can('academics.create') && writable.value);
const canEdit = computed(() => can('academics.edit') && writable.value);
const canDelete = computed(() => can('academics.delete') && writable.value);

const subjects = ref<Subject[]>([]);
const departments = ref<Department[]>([]);
const assignments = ref<ClassSubject[]>([]);
const loading = ref(true);
const error = ref('');
const search = ref('');
const departmentFilter = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    [subjects.value, departments.value, assignments.value] = await Promise.all([
      listSubjects(schoolId.value),
      listDepartments(schoolId.value),
      listClassSubjects(schoolId.value),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return subjects.value.filter(
    (s) =>
      (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) &&
      (!departmentFilter.value || s.department_id === departmentFilter.value),
  );
});
const departmentName = (id: string | null) => departments.value.find((d) => d.id === id)?.name;
const classCount = (id: string) => assignments.value.filter((a) => a.subject_id === id).length;
const departmentOptions = computed(() => [
  { value: '', label: `No ${words.value.unit.toLowerCase()}` },
  ...departments.value.filter((d) => d.kind !== 'faculty').map((d) => ({ value: d.id, label: d.name })),
]);
const tones = ['brand', 'violet', 'success', 'info', 'warning'] as const;

// ---------------------------------------------------------------------------
// Single subject form
// ---------------------------------------------------------------------------
const open = ref(false);
const editing = ref<Subject | null>(null);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<SubjectInput>({ name: '', code: '', departmentId: null, description: '', status: 'active' });

function openForm(subject?: Subject) {
  editing.value = subject ?? null;
  Object.assign(form, {
    name: subject?.name ?? '',
    code: subject?.code ?? '',
    departmentId: subject?.department_id ?? null,
    description: subject?.description ?? '',
    status: subject?.status ?? 'active',
  });
  errors.value = {};
  open.value = true;
}

watch(
  () => form.name,
  (name) => {
    if (editing.value) return;
    form.code = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map((w) => w.slice(0, w.length > 4 ? 3 : 2)).join('').toUpperCase().slice(0, 6);
  },
);

async function submit() {
  const result = validate(subjectSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(
    () => saveSubject(schoolId.value, result.data, editing.value?.id),
    editing.value ? 'Changes saved.' : `${words.value.subject} added.`,
  );
  saving.value = false;
  if (saved) {
    open.value = false;
    await load();
  }
}

async function remove(subject: Subject) {
  const ok = await feedback.confirm({
    title: `Delete ${subject.name}?`,
    description: `It will also be removed from the ${classCount(subject.id)} ${words.value.groups.toLowerCase()} that take it.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => deleteSubject(subject.id), `${subject.name} deleted.`);
  await load();
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const presetsOpen = ref(false);
const presets = computed(() => subjectPresets(workspace.currentSchool?.institution_type ?? 'other'));
const chosen = ref<Set<string>>(new Set());
const existingCodes = computed(() => new Set(subjects.value.map((s) => s.code)));

function openPresets() {
  chosen.value = new Set(presets.value.filter((p) => !existingCodes.value.has(p.code)).map((p) => p.code));
  presetsOpen.value = true;
}

function toggle(code: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(code);
  else next.delete(code);
  chosen.value = next;
}

async function addPresets() {
  saving.value = true;
  const rows = presets.value.filter((p) => chosen.value.has(p.code));
  const count = await attempt(() => createSubjects(schoolId.value, rows));
  saving.value = false;
  if (count !== undefined) {
    feedback.success(`${count} ${count === 1 ? words.value.subject.toLowerCase() : words.value.subjects.toLowerCase()} added.`);
    presetsOpen.value = false;
    await load();
  }
}
</script>

<template>
  <div>
    <KPageHeader
      :icon="BookOpen"
      eyebrow="Academics"
      :title="words.subjects"
      :description="`Everything your school teaches. Assign ${words.subjects.toLowerCase()} to ${words.groups.toLowerCase()} from each ${words.group.toLowerCase()} page.`"
    >
      <template #actions>
        <KButton v-if="canCreate && presets.length" variant="secondary" :icon="Wand2" @click="openPresets">Add common {{ words.subjects.toLowerCase() }}</KButton>
        <KButton v-if="canCreate" :icon="Plus" @click="openForm()">Add {{ words.subject.toLowerCase() }}</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <div class="rounded-card border border-line bg-surface shadow-card">
      <div v-if="subjects.length || loading" class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <div class="sm:w-72">
          <KInput v-model="search" type="search" :icon="Search" :placeholder="`Search ${words.subjects.toLowerCase()}`" aria-label="Search" />
        </div>
        <div v-if="departments.length" class="sm:w-60">
          <KSelect
            v-model="departmentFilter"
            :options="[{ value: '', label: `All ${words.units.toLowerCase()}` }, ...departments.filter((d) => d.kind !== 'faculty').map((d) => ({ value: d.id, label: d.name }))]"
            aria-label="Filter"
          />
        </div>
        <p class="text-[13px] text-ink-muted sm:ml-auto">{{ filtered.length }} of {{ subjects.length }}</p>
      </div>

      <KSkeleton v-if="loading" :lines="6" class="p-5" />

      <KEmptyState
        v-else-if="!subjects.length"
        :icon="BookOpen"
        :title="`No ${words.subjects.toLowerCase()} yet`"
        :description="presets.length ? `Start with the common Nigerian curriculum ${words.subjects.toLowerCase()} and adjust from there.` : `Add each ${words.subject.toLowerCase()} with a short code, like CSC 101.`"
      >
        <KButton v-if="canCreate && presets.length" :icon="Wand2" @click="openPresets">Choose from common {{ words.subjects.toLowerCase() }}</KButton>
        <KButton v-if="canCreate" :variant="presets.length ? 'secondary' : 'primary'" :icon="Plus" @click="openForm()">Add {{ words.subject.toLowerCase() }}</KButton>
      </KEmptyState>

      <KEmptyState v-else-if="!filtered.length" compact :icon="Search" title="No matches" description="Try a different search or filter." />

      <div v-else class="overflow-x-auto">
        <table class="k-table">
          <thead>
            <tr>
              <th scope="col">{{ words.subject }}</th>
              <th scope="col">Code</th>
              <th scope="col" class="hidden md:table-cell">{{ words.unit }}</th>
              <th scope="col">{{ words.groups }}</th>
              <th scope="col">Status</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(subject, i) in filtered" :key="subject.id">
              <td>
                <div class="flex items-center gap-3">
                  <KIconTile :icon="BookOpen" :tone="tones[i % tones.length]" :size="34" />
                  <div class="min-w-0">
                    <p class="font-medium text-ink">{{ subject.name }}</p>
                    <p v-if="subject.description" class="max-w-xs truncate text-[12.5px] text-ink-muted">{{ subject.description }}</p>
                  </div>
                </div>
              </td>
              <td><KBadge tone="neutral">{{ subject.code }}</KBadge></td>
              <td class="hidden text-ink-muted md:table-cell">{{ departmentName(subject.department_id) ?? 'None' }}</td>
              <td class="tabular-nums text-ink-muted">{{ classCount(subject.id) }}</td>
              <td>
                <KBadge :tone="subject.status === 'active' ? 'success' : 'neutral'" dot>{{ subject.status === 'active' ? 'Active' : 'Inactive' }}</KBadge>
              </td>
              <td class="text-right whitespace-nowrap">
                <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${subject.name}`" @click="openForm(subject)" />
                <KButton
                  v-if="canDelete"
                  size="sm"
                  variant="ghost"
                  :icon="Trash2"
                  :aria-label="`Delete ${subject.name}`"
                  class="text-danger-ink hover:bg-danger-soft"
                  @click="remove(subject)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <KModal v-model:open="open" :title="editing ? `Edit ${editing.name}` : `Add ${words.subject.toLowerCase()}`">
      <form id="subject-form" class="space-y-4" novalidate @submit.prevent="submit">
        <KInput v-model="form.name" label="Name" placeholder="Mathematics" :error="errors.name" required autofocus />
        <KInput v-model="form.code" label="Code" hint="Used on timetables and report cards." placeholder="MTH" :error="errors.code" required />
        <KSelect
          v-if="departments.length"
          :model-value="form.departmentId ?? ''"
          :label="words.unit"
          :options="departmentOptions"
          @update:model-value="form.departmentId = $event || null"
        />
        <KTextarea v-model="form.description" label="Description" :rows="2" :error="errors.description" optional />
        <KSelect
          v-if="editing"
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
        <KButton type="submit" form="subject-form" :loading="saving">{{ editing ? 'Save changes' : 'Add' }}</KButton>
      </template>
    </KModal>

    <KModal v-model:open="presetsOpen" :title="`Add common ${words.subjects.toLowerCase()}`" description="Tick the ones your school teaches. You can rename them later." size="lg">
      <div class="mb-3 flex items-center justify-between">
        <p class="text-[13px] text-ink-muted">{{ chosen.size }} selected</p>
        <div class="flex gap-2">
          <KButton size="sm" variant="ghost" @click="chosen = new Set(presets.filter((p) => !existingCodes.has(p.code)).map((p) => p.code))">Select all</KButton>
          <KButton size="sm" variant="ghost" @click="chosen = new Set()">Clear</KButton>
        </div>
      </div>
      <ul class="grid gap-2 sm:grid-cols-2">
        <li
          v-for="preset in presets"
          :key="preset.code"
          :class="['rounded-lg border px-3 py-2.5 transition-colors', chosen.has(preset.code) ? 'border-brand/40 bg-brand-soft/60' : 'border-line']"
        >
          <KCheckbox
            :model-value="chosen.has(preset.code) || existingCodes.has(preset.code)"
            :disabled="existingCodes.has(preset.code)"
            :label="preset.name"
            :description="existingCodes.has(preset.code) ? 'Already added' : preset.code"
            @update:model-value="toggle(preset.code, $event)"
          />
        </li>
      </ul>
      <template #footer>
        <KButton variant="secondary" @click="presetsOpen = false">Cancel</KButton>
        <KButton :loading="saving" :disabled="chosen.size === 0" @click="addPresets">Add {{ chosen.size }}</KButton>
      </template>
    </KModal>
  </div>
</template>
