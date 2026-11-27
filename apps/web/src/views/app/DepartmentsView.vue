<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Landmark, Layers, Network, Pencil, Plus, Trash2, Wand2 } from 'lucide-vue-next';
import {
  DEPARTMENT_KIND_LABELS,
  SECTION_PRESETS,
  departmentSchema,
  validate,
  type Campus,
  type Department,
  type DepartmentInput,
  type DepartmentKind,
  type FieldErrors,
} from '@klasora/shared';
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
import { deleteDepartment, listCampuses, listDepartments, saveDepartment } from '@/services/setup';
import { useSchool } from '@/composables/useSchool';

const { schoolId, can, words, writable, feedback, attempt } = useSchool();
const canCreate = computed(() => can('academics.create') && writable.value);
const canEdit = computed(() => can('academics.edit') && writable.value);
const canDelete = computed(() => can('academics.delete') && writable.value);

const departments = ref<Department[]>([]);
const campuses = ref<Campus[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    [departments.value, campuses.value] = await Promise.all([listDepartments(schoolId.value), listCampuses(schoolId.value)]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const title = computed(() => (words.value.usesFaculties ? 'Faculties and departments' : words.value.units));
const faculties = computed(() => departments.value.filter((d) => d.kind === 'faculty'));
const units = computed(() => departments.value.filter((d) => d.kind !== 'faculty'));
const childrenOf = (id: string) => departments.value.filter((d) => d.parent_id === id);
const unassigned = computed(() => (words.value.usesFaculties ? units.value.filter((d) => !d.parent_id) : units.value));
const campusName = (id: string | null) => campuses.value.find((c) => c.id === id)?.name;
const labelFor = (kind: DepartmentKind) =>
  kind === 'department' ? words.value.unit : DEPARTMENT_KIND_LABELS[kind];

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------
const open = ref(false);
const editing = ref<Department | null>(null);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<DepartmentInput>({ name: '', code: '', kind: 'department', parentId: null, campusId: null, description: '' });

function openForm(kind: DepartmentKind, item?: Department, parentId: string | null = null) {
  editing.value = item ?? null;
  Object.assign(form, {
    name: item?.name ?? '',
    code: item?.code ?? '',
    kind: item?.kind ?? kind,
    parentId: item?.parent_id ?? parentId,
    campusId: item?.campus_id ?? null,
    description: item?.description ?? '',
  });
  errors.value = {};
  open.value = true;
}

async function submit() {
  const result = validate(departmentSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(
    () => saveDepartment(schoolId.value, result.data, editing.value?.id),
    editing.value ? 'Changes saved.' : `${labelFor(result.data.kind)} added.`,
  );
  saving.value = false;
  if (saved) {
    open.value = false;
    await load();
  }
}

async function remove(item: Department) {
  const ok = await feedback.confirm({
    title: `Delete ${item.name}?`,
    description: `Classes and ${words.value.subjects.toLowerCase()} in it will stay, without a ${labelFor(item.kind).toLowerCase()}.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => deleteDepartment(item.id), `${item.name} deleted.`);
  await load();
}

async function addSectionPresets() {
  saving.value = true;
  const existing = new Set(departments.value.map((d) => d.name.toLowerCase()));
  const toAdd = SECTION_PRESETS.filter((name) => !existing.has(name.toLowerCase()));
  const ok = await attempt(async () => {
    for (const name of toAdd) {
      await saveDepartment(schoolId.value, { name, code: '', kind: 'section', parentId: null, campusId: null, description: '' });
    }
    return true;
  }, `${toAdd.length} sections added.`);
  saving.value = false;
  if (ok) await load();
}

const campusOptions = computed(() => [{ value: '', label: 'All campuses' }, ...campuses.value.map((c) => ({ value: c.id, label: c.name }))]);
const facultyOptions = computed(() => [{ value: '', label: 'No faculty' }, ...faculties.value.map((f) => ({ value: f.id, label: f.name }))]);
const mainKind = computed<DepartmentKind>(() => words.value.unitKind);
</script>

<template>
  <div>
    <KPageHeader
      :icon="Network"
      eyebrow="Academics"
      :title="title"
      :description="`Group your ${words.groups.toLowerCase()} and ${words.subjects.toLowerCase()} the way your school is organised.`"
    >
      <template #actions>
        <KButton v-if="canCreate && words.usesFaculties" variant="secondary" :icon="Landmark" @click="openForm('faculty')">Add faculty</KButton>
        <KButton v-if="canCreate" :icon="Plus" @click="openForm(mainKind)">Add {{ words.unit.toLowerCase() }}</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <div v-if="loading" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="n in 3" :key="n" class="rounded-card border border-line bg-surface p-5"><KSkeleton :lines="3" /></div>
    </div>

    <div v-else-if="!departments.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState
        :icon="Network"
        :title="`No ${title.toLowerCase()} yet`"
        :description="
          mainKind === 'section'
            ? 'Most schools with nursery, primary and secondary sections start with the four standard sections.'
            : `Add a ${words.unit.toLowerCase()} for each area of study. Small schools can skip this step.`
        "
      >
        <KButton v-if="canCreate && mainKind === 'section'" :icon="Wand2" :loading="saving" @click="addSectionPresets">Add standard sections</KButton>
        <KButton v-if="canCreate && words.usesFaculties" variant="secondary" :icon="Landmark" @click="openForm('faculty')">Add a faculty</KButton>
        <KButton v-if="canCreate" :variant="mainKind === 'section' ? 'secondary' : 'primary'" :icon="Plus" @click="openForm(mainKind)">
          Add {{ words.unit.toLowerCase() }}
        </KButton>
      </KEmptyState>
    </div>

    <div v-else class="space-y-6">
      <!-- Faculties with their departments -->
      <article v-for="faculty in faculties" :key="faculty.id" class="k-fade-up overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <header class="flex flex-wrap items-center gap-3.5 border-b border-line bg-surface-muted/40 px-5 py-4">
          <KIconTile :icon="Landmark" tone="violet" solid :size="42" />
          <div class="min-w-0 flex-1">
            <h2 class="flex flex-wrap items-center gap-2 text-[16px] font-semibold">
              {{ faculty.name }}
              <KBadge v-if="faculty.code" tone="neutral">{{ faculty.code }}</KBadge>
            </h2>
            <p class="text-[12.5px] text-ink-muted">{{ childrenOf(faculty.id).length }} departments</p>
          </div>
          <div class="flex gap-1">
            <KButton v-if="canCreate" size="sm" variant="subtle" :icon="Plus" @click="openForm('department', undefined, faculty.id)">Department</KButton>
            <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${faculty.name}`" @click="openForm('faculty', faculty)" />
            <KButton v-if="canDelete" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${faculty.name}`" class="text-danger-ink hover:bg-danger-soft" @click="remove(faculty)" />
          </div>
        </header>
        <ul v-if="childrenOf(faculty.id).length" class="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="dept in childrenOf(faculty.id)" :key="dept.id" class="flex items-start gap-3 bg-surface p-4">
            <KIconTile :icon="Layers" tone="info" :size="34" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-[14px] font-medium">{{ dept.name }}</p>
              <p class="truncate text-[12.5px] text-ink-muted">{{ dept.code ?? 'No code' }}<template v-if="campusName(dept.campus_id)">, {{ campusName(dept.campus_id) }}</template></p>
            </div>
            <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${dept.name}`" @click="openForm('department', dept)" />
          </li>
        </ul>
        <p v-else class="px-5 py-4 text-[13.5px] text-ink-muted">No departments in this faculty yet.</p>
      </article>

      <!-- Sections, departments or programmes -->
      <div v-if="unassigned.length">
        <h2 v-if="words.usesFaculties" class="k-section-title mb-3">Departments without a faculty</h2>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <article
            v-for="item in unassigned"
            :key="item.id"
            class="k-fade-up group rounded-card border border-line bg-surface p-5 shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-hover"
          >
            <div class="flex items-start gap-3.5">
              <KIconTile :icon="item.kind === 'section' ? Layers : Network" :tone="item.kind === 'section' ? 'warning' : 'brand'" solid :size="42" />
              <div class="min-w-0 flex-1">
                <h3 class="truncate text-[15px] font-semibold">{{ item.name }}</h3>
                <div class="mt-1 flex flex-wrap gap-1.5">
                  <KBadge tone="neutral">{{ labelFor(item.kind) }}</KBadge>
                  <KBadge v-if="item.code" tone="neutral">{{ item.code }}</KBadge>
                  <KBadge v-if="campusName(item.campus_id)" tone="info">{{ campusName(item.campus_id) }}</KBadge>
                </div>
              </div>
            </div>
            <p v-if="item.description" class="mt-3 line-clamp-2 text-[13px] text-ink-muted">{{ item.description }}</p>
            <div v-if="canEdit || canDelete" class="mt-4 flex gap-1 border-t border-line pt-3">
              <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" @click="openForm(item.kind, item)">Edit</KButton>
              <KButton v-if="canDelete" size="sm" variant="ghost" :icon="Trash2" class="ml-auto text-danger-ink hover:bg-danger-soft hover:text-danger-ink" @click="remove(item)">
                Delete
              </KButton>
            </div>
          </article>
        </div>
      </div>
    </div>

    <KModal v-model:open="open" :title="editing ? `Edit ${editing.name}` : `Add ${labelFor(form.kind).toLowerCase()}`">
      <form id="department-form" class="space-y-4" novalidate @submit.prevent="submit">
        <KInput v-model="form.name" label="Name" :placeholder="form.kind === 'faculty' ? 'Faculty of Science' : form.kind === 'section' ? 'Junior Secondary' : 'Sciences'" :error="errors.name" required autofocus />
        <KInput v-model="form.code" label="Short code" placeholder="SCI" :error="errors.code" optional />
        <KSelect
          v-if="words.usesFaculties && form.kind === 'department'"
          :model-value="form.parentId ?? ''"
          label="Faculty"
          :options="facultyOptions"
          @update:model-value="form.parentId = $event || null"
        />
        <KSelect
          v-if="campuses.length > 1"
          :model-value="form.campusId ?? ''"
          label="Campus"
          :options="campusOptions"
          @update:model-value="form.campusId = $event || null"
        />
        <KTextarea v-model="form.description" label="Description" :rows="2" :error="errors.description" optional />
      </form>
      <template #footer>
        <KButton variant="secondary" @click="open = false">Cancel</KButton>
        <KButton type="submit" form="department-form" :loading="saving">{{ editing ? 'Save changes' : 'Add' }}</KButton>
      </template>
    </KModal>
  </div>
</template>
