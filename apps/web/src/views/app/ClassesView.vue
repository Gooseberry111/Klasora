<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ChevronRight, Pencil, Plus, School, Search, Trash2, UserRound, Wand2 } from 'lucide-vue-next';
import {
  classPresets,
  classSchema,
  validate,
  type AcademicYear,
  type Campus,
  type ClassInput,
  type ClassSubject,
  type Department,
  type FieldErrors,
  type SchoolClass,
  type SchoolMember,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import {
  createClasses,
  deleteClass,
  listAcademicYears,
  listCampuses,
  listClassSubjects,
  listClasses,
  listDepartments,
  listMembers,
  saveClass,
} from '@/services/setup';
import { listEnrollments } from '@/services/students';
import type { ClassEnrollment } from '@klasora/shared';
import { fullName, useSchool } from '@/composables/useSchool';

const { workspace, schoolId, slug, can, words, writable, feedback, attempt } = useSchool();
const canCreate = computed(() => can('academics.create') && writable.value);
const canEdit = computed(() => can('academics.edit') && writable.value);
const canDelete = computed(() => can('academics.delete') && writable.value);

const classes = ref<SchoolClass[]>([]);
const campuses = ref<Campus[]>([]);
const years = ref<AcademicYear[]>([]);
const departments = ref<Department[]>([]);
const members = ref<SchoolMember[]>([]);
const assignments = ref<ClassSubject[]>([]);
const loading = ref(true);
const error = ref('');
const search = ref('');
const campusFilter = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    [classes.value, campuses.value, years.value, departments.value, assignments.value] = await Promise.all([
      listClasses(schoolId.value),
      listCampuses(schoolId.value),
      listAcademicYears(schoolId.value),
      listDepartments(schoolId.value),
      listClassSubjects(schoolId.value),
    ]);
    // The staff list is optional: people without staff access still see classes.
    members.value = await listMembers(schoolId.value).catch(() => []);
    roster.value = await listEnrollments(schoolId.value, { activeOnly: true }).catch(() => []);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const mainCampus = computed(() => campuses.value.find((c) => c.is_main) ?? campuses.value[0]);
const currentYear = computed(() => years.value.find((y) => y.is_current) ?? null);
const campusName = (id: string) => campuses.value.find((c) => c.id === id)?.name ?? '';
const yearName = (id: string | null) => years.value.find((y) => y.id === id)?.name;
const teacher = (id: string | null) => members.value.find((m) => m.membership_id === id);
const subjectCount = (id: string) => assignments.value.filter((a) => a.class_id === id).length;
const roster = ref<ClassEnrollment[]>([]);
const studentCount = (id: string) => roster.value.filter((e) => e.class_id === id).length;
/** Short label for the class tile: "1A" for JSS 1A, otherwise the first letters. */
function badge(name: string) {
  const last = name.trim().split(/\s+/).pop() ?? name;
  return /\d/.test(last) && last.length <= 3 ? last.toUpperCase() : name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return classes.value.filter(
    (c) =>
      (!q || c.name.toLowerCase().includes(q) || (c.level ?? '').toLowerCase().includes(q)) &&
      (!campusFilter.value || c.campus_id === campusFilter.value),
  );
});

const staffOptions = computed(() => [
  { value: '', label: 'Not assigned' },
  ...members.value
    .filter((m) => m.status === 'active' && m.role_key !== 'parent' && m.role_key !== 'student')
    .map((m) => ({ value: m.membership_id, label: `${fullName(m)} (${m.role_name})` })),
]);
const campusOptions = computed(() => campuses.value.filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: c.name })));
const yearOptions = computed(() => [{ value: '', label: 'Every session' }, ...years.value.map((y) => ({ value: y.id, label: y.name }))]);
const departmentOptions = computed(() => [
  { value: '', label: 'None' },
  ...departments.value.filter((d) => d.kind !== 'faculty').map((d) => ({ value: d.id, label: d.name })),
]);

// ---------------------------------------------------------------------------
// Single class form
// ---------------------------------------------------------------------------
const open = ref(false);
const editing = ref<SchoolClass | null>(null);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<ClassInput>({
  name: '',
  level: '',
  levelOrder: 0,
  campusId: '',
  departmentId: null,
  academicYearId: null,
  classTeacherMembershipId: null,
  capacity: '',
  status: 'active',
});

function openForm(item?: SchoolClass) {
  editing.value = item ?? null;
  Object.assign(form, {
    name: item?.name ?? '',
    level: item?.level ?? '',
    levelOrder: item?.level_order ?? 0,
    campusId: item?.campus_id ?? mainCampus.value?.id ?? '',
    departmentId: item?.department_id ?? null,
    academicYearId: item ? item.academic_year_id : (currentYear.value?.id ?? null),
    classTeacherMembershipId: item?.class_teacher_membership_id ?? null,
    capacity: item?.capacity ? String(item.capacity) : '',
    status: item?.status ?? 'active',
  });
  errors.value = {};
  open.value = true;
}

async function submit() {
  const result = validate(classSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(
    () => saveClass(schoolId.value, result.data, editing.value?.id),
    editing.value ? 'Changes saved.' : `${words.value.group} added.`,
  );
  saving.value = false;
  if (saved) {
    open.value = false;
    await load();
  }
}

async function remove(item: SchoolClass) {
  const ok = await feedback.confirm({
    title: `Delete ${item.name}?`,
    description: `Its ${words.value.subject.toLowerCase()} assignments are removed too. ${words.value.groups} with students cannot be deleted.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => deleteClass(item.id), `${item.name} deleted.`);
  await load();
}

// ---------------------------------------------------------------------------
// Template builder
// ---------------------------------------------------------------------------
const templateOpen = ref(false);
const presets = computed(() => classPresets(workspace.currentSchool?.institution_type ?? 'other'));
const presetGroups = computed(() => [...new Set(presets.value.map((p) => p.group))]);
const chosenLevels = ref<Set<string>>(new Set());
const arms = ref('A');
const templateCampus = ref('');
const templateYear = ref('');

function openTemplate() {
  chosenLevels.value = new Set(presets.value.map((p) => p.level));
  arms.value = workspace.words.group === 'Level' ? '' : 'A';
  templateCampus.value = mainCampus.value?.id ?? '';
  templateYear.value = currentYear.value?.id ?? '';
  templateOpen.value = true;
}

function toggleLevel(level: string, on: boolean) {
  const next = new Set(chosenLevels.value);
  if (on) next.add(level);
  else next.delete(level);
  chosenLevels.value = next;
}

function toggleGroup(group: string, on: boolean) {
  const next = new Set(chosenLevels.value);
  for (const p of presets.value.filter((x) => x.group === group)) {
    if (on) next.add(p.level);
    else next.delete(p.level);
  }
  chosenLevels.value = next;
}

const armList = computed(() =>
  arms.value
    .split(/[\s,]+/)
    .map((a) => a.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 10),
);

const plannedClasses = computed(() =>
  presets.value
    .filter((p) => chosenLevels.value.has(p.level))
    .flatMap((p) =>
      (armList.value.length ? armList.value : ['']).map((arm) => ({
        name: arm ? `${p.level}${arm.length === 1 ? '' : ' '}${arm}` : p.level,
        level: p.level,
        level_order: p.order,
      })),
    ),
);

async function createFromTemplate() {
  if (!templateCampus.value) return;
  saving.value = true;
  const rows = plannedClasses.value.map((c) => ({
    ...c,
    campus_id: templateCampus.value,
    academic_year_id: templateYear.value || null,
  }));
  const count = await attempt(() => createClasses(schoolId.value, rows));
  saving.value = false;
  if (count !== undefined) {
    feedback.success(`${count} ${count === 1 ? words.value.group.toLowerCase() : words.value.groups.toLowerCase()} created.`);
    templateOpen.value = false;
    await load();
  }
}
</script>

<template>
  <div>
    <KPageHeader
      :icon="School"
      eyebrow="School management"
      :title="words.groups"
      :description="`Each ${words.group.toLowerCase()} belongs to a campus and can have a class teacher, a capacity and its own ${words.subjects.toLowerCase()}.`"
    >
      <template #actions>
        <KButton v-if="canCreate && presets.length" variant="secondary" :icon="Wand2" @click="openTemplate">Create from template</KButton>
        <KButton v-if="canCreate" :icon="Plus" @click="openForm()">Add {{ words.group.toLowerCase() }}</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <KAlert v-if="!loading && !years.length && can('academics.view')" tone="info" class="mb-6" title="Tip: set up your academic session first">
      Linking {{ words.groups.toLowerCase() }} to a session keeps each year's records separate.
      <RouterLink :to="{ name: 'academic-calendar', params: { slug } }" class="font-medium underline underline-offset-2">Create a session</RouterLink>
    </KAlert>

    <div class="rounded-card border border-line bg-surface shadow-card">
      <div v-if="classes.length || loading" class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <div class="sm:w-72">
          <KInput v-model="search" type="search" :icon="Search" :placeholder="`Search ${words.groups.toLowerCase()}`" aria-label="Search" />
        </div>
        <div v-if="campuses.length > 1" class="sm:w-56">
          <KSelect v-model="campusFilter" :options="[{ value: '', label: 'All campuses' }, ...campusOptions]" aria-label="Campus" />
        </div>
        <p class="text-[13px] text-ink-muted sm:ml-auto">{{ filtered.length }} {{ filtered.length === 1 ? words.group.toLowerCase() : words.groups.toLowerCase() }}</p>
      </div>

      <KSkeleton v-if="loading" :lines="6" class="p-5" />

      <KEmptyState
        v-else-if="!classes.length"
        :icon="School"
        :title="`No ${words.groups.toLowerCase()} yet`"
        :description="presets.length ? `Create all your ${words.groups.toLowerCase()} at once from the standard Nigerian levels, then fine tune them.` : `Add your first ${words.group.toLowerCase()}.`"
      >
        <KButton v-if="canCreate && presets.length" :icon="Wand2" @click="openTemplate">Create from template</KButton>
        <KButton v-if="canCreate" :variant="presets.length ? 'secondary' : 'primary'" :icon="Plus" @click="openForm()">Add one by one</KButton>
      </KEmptyState>

      <KEmptyState v-else-if="!filtered.length" compact :icon="Search" title="No matches" description="Try a different search or campus." />

      <div v-else class="overflow-x-auto">
        <table class="k-table">
          <thead>
            <tr>
              <th scope="col">{{ words.group }}</th>
              <th scope="col" class="hidden lg:table-cell">Campus</th>
              <th scope="col">Class teacher</th>
              <th scope="col" class="hidden md:table-cell">{{ words.subjects }}</th>
              <th scope="col" class="hidden md:table-cell">Students</th>
              <th scope="col">Status</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filtered" :key="item.id">
              <td>
                <RouterLink :to="{ name: 'class-detail', params: { slug, classId: item.id } }" class="group flex items-center gap-3">
                  <span class="k-bg-brand flex size-9 shrink-0 items-center justify-center rounded-[10px] text-[12px] font-bold text-white shadow-brand">
                    {{ badge(item.name) }}
                  </span>
                  <span class="min-w-0">
                    <span class="block font-semibold text-ink group-hover:text-brand-ink">{{ item.name }}</span>
                    <span class="block text-[12.5px] text-ink-muted">{{ item.level ?? 'No level' }}<template v-if="yearName(item.academic_year_id)">, {{ yearName(item.academic_year_id) }}</template></span>
                  </span>
                </RouterLink>
              </td>
              <td class="hidden text-ink-muted lg:table-cell">{{ campusName(item.campus_id) }}</td>
              <td>
                <span v-if="teacher(item.class_teacher_membership_id)" class="flex items-center gap-2">
                  <KAvatar :name="fullName(teacher(item.class_teacher_membership_id)!)" :src="teacher(item.class_teacher_membership_id)!.avatar_url" :size="26" />
                  <span class="truncate">{{ fullName(teacher(item.class_teacher_membership_id)!) }}</span>
                </span>
                <span v-else class="flex items-center gap-1.5 text-ink-subtle"><UserRound :size="15" aria-hidden="true" /> Not assigned</span>
              </td>
              <td class="hidden tabular-nums md:table-cell">{{ subjectCount(item.id) }}</td>
              <td class="hidden tabular-nums text-ink-muted md:table-cell">
                <span class="font-medium text-ink">{{ studentCount(item.id) }}</span><template v-if="item.capacity"> of {{ item.capacity }}</template>
              </td>
              <td>
                <KBadge :tone="item.status === 'active' ? 'success' : 'neutral'" dot>{{ item.status === 'active' ? 'Active' : 'Inactive' }}</KBadge>
              </td>
              <td class="text-right whitespace-nowrap">
                <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${item.name}`" @click="openForm(item)" />
                <KButton v-if="canDelete" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${item.name}`" class="text-danger-ink hover:bg-danger-soft" @click="remove(item)" />
                <KButton size="sm" variant="ghost" :icon="ChevronRight" :aria-label="`Open ${item.name}`" :to="{ name: 'class-detail', params: { slug, classId: item.id } }" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Class form -->
    <KModal v-model:open="open" :title="editing ? `Edit ${editing.name}` : `Add a ${words.group.toLowerCase()}`" size="lg">
      <form id="class-form" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submit">
        <KInput v-model="form.name" label="Name" placeholder="JSS 1A" :error="errors.name" required autofocus />
        <KInput v-model="form.level" label="Level" placeholder="JSS 1" hint="Groups arms of the same level." :error="errors.level" optional />
        <KSelect v-model="form.campusId" label="Campus" :options="campusOptions" :error="errors.campusId" required />
        <KSelect
          :model-value="form.academicYearId ?? ''"
          label="Academic session"
          :options="yearOptions"
          @update:model-value="form.academicYearId = $event || null"
        />
        <KSelect
          :model-value="form.classTeacherMembershipId ?? ''"
          label="Class teacher"
          :options="staffOptions"
          :hint="staffOptions.length === 1 ? 'Invite staff first, then assign a class teacher.' : undefined"
          @update:model-value="form.classTeacherMembershipId = $event || null"
        />
        <KInput v-model="form.capacity" label="Capacity" inputmode="numeric" placeholder="40" :error="errors.capacity" optional />
        <KSelect
          v-if="departments.length"
          :model-value="form.departmentId ?? ''"
          :label="words.unit"
          :options="departmentOptions"
          @update:model-value="form.departmentId = $event || null"
        />
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
        <KButton type="submit" form="class-form" :loading="saving">{{ editing ? 'Save changes' : 'Add' }}</KButton>
      </template>
    </KModal>

    <!-- Template builder -->
    <KModal
      v-model:open="templateOpen"
      :title="`Create ${words.groups.toLowerCase()} from a template`"
      description="Choose the levels you run and how many arms each has. Existing names are skipped."
      size="lg"
    >
      <div class="space-y-5">
        <div class="grid gap-4 sm:grid-cols-3">
          <KInput v-model="arms" label="Arms" placeholder="A, B, C" hint="Leave empty for one per level." />
          <KSelect v-model="templateCampus" label="Campus" :options="campusOptions" required />
          <KSelect v-model="templateYear" label="Session" :options="yearOptions" />
        </div>
        <div v-for="group in presetGroups" :key="group" class="rounded-xl border border-line p-4">
          <div class="mb-3 flex items-center justify-between">
            <p class="text-[13.5px] font-semibold">{{ group }}</p>
            <KCheckbox
              :model-value="presets.filter((p) => p.group === group).every((p) => chosenLevels.has(p.level))"
              label="All"
              @update:model-value="toggleGroup(group, $event)"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="preset in presets.filter((p) => p.group === group)"
              :key="preset.level"
              type="button"
              :aria-pressed="chosenLevels.has(preset.level)"
              :class="[
                'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                chosenLevels.has(preset.level) ? 'border-brand bg-brand text-white shadow-brand' : 'border-line-strong text-ink-muted hover:border-brand/50 hover:text-ink',
              ]"
              @click="toggleLevel(preset.level, !chosenLevels.has(preset.level))"
            >
              {{ preset.level }}
            </button>
          </div>
        </div>
        <div class="rounded-xl bg-surface-muted p-4">
          <p class="text-[13px] font-medium">{{ plannedClasses.length }} {{ words.groups.toLowerCase() }} will be created</p>
          <p class="mt-1 line-clamp-2 text-[12.5px] text-ink-muted">{{ plannedClasses.map((c) => c.name).join(', ') || 'Choose at least one level.' }}</p>
        </div>
      </div>
      <template #footer>
        <KButton variant="secondary" @click="templateOpen = false">Cancel</KButton>
        <KButton :loading="saving" :disabled="plannedClasses.length === 0 || !templateCampus" @click="createFromTemplate">
          Create {{ plannedClasses.length }}
        </KButton>
      </template>
    </KModal>
  </div>
</template>
