<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Lock, Pencil, ShieldOff, Trash2, Users } from 'lucide-vue-next';
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABELS,
  PERMISSION_MODULES,
  PERMISSION_MODULE_KEYS,
  permissionKey,
  roleFormSchema,
  validate,
  type FieldErrors,
  type PermissionKey,
  type PermissionModule,
  type Role,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import { useWorkspaceStore } from '@/stores/workspace';
import { useFeedbackStore } from '@/stores/feedback';
import {
  deleteRole,
  getRole,
  getRolePermissions,
  listRoleMembers,
  setRolePermissions,
  updateRole,
  type RoleMember,
} from '@/services/roles';
import { canTogglePermission, roleEditability, sameKeys, type EditorContext } from '@/lib/role-permissions';
import { formatDate } from '@/lib/time';

const route = useRoute();
const router = useRouter();
const workspace = useWorkspaceStore();
const feedback = useFeedbackStore();

const roleId = computed(() => String(route.params.roleId));
const slug = computed(() => workspace.currentSchool?.slug ?? '');

const role = ref<Role | null>(null);
const savedKeys = ref<Set<PermissionKey>>(new Set());
const selected = ref<Set<PermissionKey>>(new Set());
const members = ref<RoleMember[]>([]);
const loading = ref(true);
const error = ref('');
const notFound = ref(false);
const saving = ref(false);
const tab = ref<'permissions' | 'members'>('permissions');

const ctx = computed<EditorContext>(() => ({
  canEditRoles: workspace.can('roles.edit'),
  isOwner: workspace.isOwner,
  myRoleIds: workspace.currentRoleIds,
  myPermissions: workspace.permissions,
  schoolWritable: workspace.currentSchool?.status !== 'suspended' && workspace.currentSchool?.status !== 'archived',
}));
const editability = computed(() => (role.value ? roleEditability(role.value, ctx.value) : { editable: false as const, reason: '' }));
const dirty = computed(() => !sameKeys(selected.value, savedKeys.value));
const canRename = computed(() => role.value && !role.value.is_system_role && workspace.can('roles.edit'));
const canDelete = computed(() => role.value && !role.value.is_system_role && workspace.can('roles.delete'));

async function load() {
  loading.value = true;
  error.value = '';
  notFound.value = false;
  try {
    const found = await getRole(workspace.currentSchoolId!, roleId.value);
    if (!found) {
      notFound.value = true;
      return;
    }
    role.value = found;
    const [keys, people] = await Promise.all([getRolePermissions(found.id), listRoleMembers(found.id)]);
    savedKeys.value = new Set(keys);
    selected.value = new Set(keys);
    members.value = people;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([roleId, () => workspace.currentSchoolId], load, { immediate: true });

function moduleKeys(module: PermissionModule): PermissionKey[] {
  return PERMISSION_MODULES[module].actions.map((a) => `${module}.${a}` as PermissionKey);
}

function toggle(key: PermissionKey, value: boolean) {
  const next = new Set(selected.value);
  if (value) next.add(key);
  else next.delete(key);
  selected.value = next;
}

function moduleState(module: PermissionModule) {
  const keys = moduleKeys(module);
  const count = keys.filter((k) => selected.value.has(k)).length;
  return { all: count === keys.length, some: count > 0 && count < keys.length };
}

function toggleModule(module: PermissionModule, value: boolean) {
  const next = new Set(selected.value);
  for (const key of moduleKeys(module)) {
    if (!canTogglePermission(key, ctx.value)) continue;
    if (value) next.add(key);
    else next.delete(key);
  }
  selected.value = next;
}

function cellDisabled(key: PermissionKey) {
  return !editability.value.editable || !canTogglePermission(key, ctx.value) || saving.value;
}

async function save() {
  if (!role.value) return;
  saving.value = true;
  try {
    await setRolePermissions(role.value.id, [...selected.value]);
    savedKeys.value = new Set(selected.value);
    // In case this role is one of ours (owner editing their own extra role).
    await workspace.refreshPermissions();
    feedback.success('Permissions saved', `${role.value.name} has been updated.`);
  } catch (e) {
    feedback.error("We couldn't save these permissions", (e as Error).message);
  } finally {
    saving.value = false;
  }
}

function discard() {
  selected.value = new Set(savedKeys.value);
}

// Rename / describe
const editOpen = ref(false);
const editForm = reactive({ name: '', description: '' });
const editErrors = ref<FieldErrors>({});
const editError = ref('');
const editSaving = ref(false);

function openEdit() {
  if (!role.value) return;
  editForm.name = role.value.name;
  editForm.description = role.value.description ?? '';
  editErrors.value = {};
  editError.value = '';
  editOpen.value = true;
}

async function submitEdit() {
  const result = validate(roleFormSchema, editForm);
  if (!result.success) {
    editErrors.value = result.errors;
    return;
  }
  editSaving.value = true;
  editError.value = '';
  try {
    role.value = await updateRole(role.value!.id, result.data);
    editOpen.value = false;
    feedback.success('Role updated');
  } catch (e) {
    editError.value = (e as Error).message;
  } finally {
    editSaving.value = false;
  }
}

async function remove() {
  if (!role.value) return;
  const confirmed = await feedback.confirm({
    title: `Delete ${role.value.name}?`,
    description:
      members.value.length > 0
        ? `${members.value.length} ${members.value.length === 1 ? 'person has' : 'people have'} this role. Move them to another role first.`
        : 'This role will be permanently removed. This cannot be undone.',
    confirmLabel: 'Delete role',
  });
  if (!confirmed) return;
  try {
    await deleteRole(role.value.id);
    feedback.success('Role deleted');
    await router.replace({ name: 'roles', params: { slug: slug.value } });
  } catch (e) {
    feedback.error("We couldn't delete this role", (e as Error).message);
  }
}
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-6">
      <KSkeleton line-class="h-8 w-64" />
      <div class="rounded-card border border-line bg-surface p-5"><KSkeleton :lines="8" /></div>
    </div>

    <KEmptyState
      v-else-if="notFound"
      :icon="ShieldOff"
      title="Role not found"
      description="It may have been deleted, or it belongs to a different school."
    >
      <KButton :to="{ name: 'roles', params: { slug } }">Back to roles</KButton>
    </KEmptyState>

    <KAlert v-else-if="error" tone="danger">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <template v-else-if="role">
      <KPageHeader
        :title="role.name"
        :description="role.description ?? undefined"
        :breadcrumbs="[
          { label: 'Dashboard', to: { name: 'dashboard', params: { slug } } },
          { label: 'User roles', to: { name: 'roles', params: { slug } } },
          { label: role.name },
        ]"
      >
        <template #badge>
          <KBadge :tone="role.is_system_role ? 'brand' : 'neutral'">{{ role.is_system_role ? 'Built-in' : 'Custom' }}</KBadge>
        </template>
        <template #actions>
          <KButton v-if="canRename" variant="secondary" :icon="Pencil" @click="openEdit">Rename</KButton>
          <KButton v-if="canDelete" variant="secondary" :icon="Trash2" @click="remove">Delete</KButton>
        </template>
      </KPageHeader>

      <div class="mb-5 flex gap-1 border-b border-line" role="tablist" aria-label="Role sections">
        <button
          v-for="t in [
            { id: 'permissions', label: 'Permissions' },
            { id: 'members', label: `Members (${members.length})` },
          ] as const"
          :key="t.id"
          role="tab"
          type="button"
          :aria-selected="tab === t.id"
          :class="[
            '-mb-px border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors',
            tab === t.id ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink',
          ]"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- Permissions -->
      <section v-if="tab === 'permissions'" role="tabpanel" aria-label="Permissions">
        <KAlert v-if="!editability.editable" tone="info" class="mb-5">
          <span class="inline-flex items-center gap-1.5"><Lock :size="14" aria-hidden="true" />{{ editability.reason }}</span>
        </KAlert>
        <KAlert v-else-if="!ctx.isOwner" tone="info" class="mb-5">
          You can grant or remove only permissions you hold yourself. Others are shown for reference.
        </KAlert>
        <KAlert v-if="role.role_key === 'parent' || role.role_key === 'student'" tone="info" class="mb-5">
          Parents and students don't need school-wide permissions: they automatically see only their own or their linked
          children's records.
        </KAlert>

        <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
          <table class="w-full min-w-[720px] text-left text-[13.5px]">
            <caption class="sr-only">Permissions for {{ role.name }}</caption>
            <thead class="border-b border-line bg-surface-muted/60 text-[12.5px] text-ink-muted">
              <tr>
                <th scope="col" class="px-5 py-3 font-medium">Module</th>
                <th v-for="action in PERMISSION_ACTIONS" :key="action" scope="col" class="px-3 py-3 text-center font-medium">
                  {{ PERMISSION_ACTION_LABELS[action] }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr v-for="module in PERMISSION_MODULE_KEYS" :key="module">
                <th scope="row" class="px-5 py-3.5 font-normal">
                  <KCheckbox
                    :model-value="moduleState(module).all"
                    :indeterminate="moduleState(module).some"
                    :disabled="!editability.editable || saving"
                    :label="PERMISSION_MODULES[module].label"
                    :description="PERMISSION_MODULES[module].description"
                    @update:model-value="(v) => toggleModule(module, v)"
                  />
                </th>
                <td v-for="action in PERMISSION_ACTIONS" :key="action" class="px-3 py-3.5 text-center">
                  <template v-if="permissionKey(module, action)">
                    <KCheckbox
                      :model-value="selected.has(permissionKey(module, action)!)"
                      :disabled="cellDisabled(permissionKey(module, action)!)"
                      :aria-label="`${PERMISSION_ACTION_LABELS[action]} ${PERMISSION_MODULES[module].label}`"
                      @update:model-value="(v) => toggle(permissionKey(module, action)!, v)"
                    />
                  </template>
                  <span v-else class="text-ink-subtle" aria-label="Not applicable">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="editability.editable"
          class="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/95 px-5 py-3.5 shadow-pop backdrop-blur"
        >
          <p class="text-[13px] text-ink-muted">
            {{ dirty ? 'You have unsaved changes.' : `${selected.size} permission${selected.size === 1 ? '' : 's'} granted.` }}
          </p>
          <div class="flex gap-2">
            <KButton variant="ghost" :disabled="!dirty || saving" @click="discard">Discard</KButton>
            <KButton :disabled="!dirty" :loading="saving" @click="save">Save permissions</KButton>
          </div>
        </div>
      </section>

      <!-- Members -->
      <KCard v-else :padded="false" role="tabpanel" aria-label="Members">
        <KEmptyState
          v-if="members.length === 0"
          compact
          :icon="Users"
          title="Nobody has this role yet"
          description="People receive roles when they accept an invitation to your school."
        />
        <ul v-else class="divide-y divide-line">
          <li v-for="member in members" :key="member.membership_id" class="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <KAvatar :name="`${member.first_name} ${member.last_name}`.trim() || member.email" :size="36" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ `${member.first_name} ${member.last_name}`.trim() || member.email }}</p>
              <p class="truncate text-[12.5px] text-ink-muted">{{ member.email }}</p>
            </div>
            <span class="text-[12.5px] text-ink-muted">Joined {{ formatDate(member.joined_at) }}</span>
            <KBadge :tone="member.status === 'active' ? 'success' : 'neutral'" dot>
              {{ member.status[0]!.toUpperCase() + member.status.slice(1) }}
            </KBadge>
          </li>
        </ul>
      </KCard>

      <KModal v-model:open="editOpen" title="Rename role">
        <form id="edit-role-form" class="space-y-4" novalidate @submit.prevent="submitEdit">
          <KAlert v-if="editError" tone="danger">{{ editError }}</KAlert>
          <KInput v-model="editForm.name" label="Role name" :maxlength="60" :error="editErrors.name" required autofocus />
          <KTextarea v-model="editForm.description" label="Description" :maxlength="300" :error="editErrors.description" optional />
        </form>
        <template #footer>
          <KButton variant="secondary" @click="editOpen = false">Cancel</KButton>
          <KButton type="submit" form="edit-role-form" :loading="editSaving">Save changes</KButton>
        </template>
      </KModal>
    </template>
  </div>
</template>
