<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ChevronRight, Plus, ShieldCheck } from 'lucide-vue-next';
import { ALL_PERMISSION_KEYS, roleFormSchema, validate, type FieldErrors } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import { useWorkspaceStore } from '@/stores/workspace';
import { useFeedbackStore } from '@/stores/feedback';
import { createRole, listRoleSummaries, type RoleSummary } from '@/services/roles';

const workspace = useWorkspaceStore();
const feedback = useFeedbackStore();
const router = useRouter();

const roles = ref<RoleSummary[]>([]);
const loading = ref(true);
const error = ref('');

const slug = computed(() => workspace.currentSchool?.slug ?? '');
const builtIn = computed(() => roles.value.filter((r) => r.is_system_role));
const custom = computed(() => roles.value.filter((r) => !r.is_system_role));
const totalPermissions = ALL_PERMISSION_KEYS.length;

async function load() {
  if (!workspace.currentSchoolId) return;
  loading.value = true;
  error.value = '';
  try {
    roles.value = await listRoleSummaries(workspace.currentSchoolId);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(() => workspace.currentSchoolId, load, { immediate: true });

// Create role
const createOpen = ref(false);
const form = reactive({ name: '', description: '' });
const formErrors = ref<FieldErrors>({});
const formError = ref('');
const saving = ref(false);

function openCreate() {
  form.name = '';
  form.description = '';
  formErrors.value = {};
  formError.value = '';
  createOpen.value = true;
}

async function submitCreate() {
  const result = validate(roleFormSchema, form);
  if (!result.success) {
    formErrors.value = result.errors;
    return;
  }
  formErrors.value = {};
  formError.value = '';
  saving.value = true;
  try {
    const role = await createRole(workspace.currentSchoolId!, result.data);
    createOpen.value = false;
    feedback.success('Role created', 'Now choose what people with this role can do.');
    await router.push({ name: 'role-detail', params: { slug: slug.value, roleId: role.id } });
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

function permissionLabel(role: RoleSummary) {
  if (role.role_key === 'owner') return 'Full access';
  if (role.permission_count === 0) return 'Relationship-based';
  return `${role.permission_count} of ${totalPermissions}`;
}
</script>

<template>
  <div>
    <KPageHeader
      title="User roles"
      description="Roles decide what each person can see and do in your school. Access is denied unless a role allows it."
      :breadcrumbs="[{ label: 'Dashboard', to: { name: 'dashboard', params: { slug } } }, { label: 'User roles' }]"
    >
      <template #actions>
        <KButton v-if="workspace.can('roles.create')" :icon="Plus" @click="openCreate">Create role</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <div v-if="loading" class="rounded-card border border-line bg-surface p-5 shadow-card">
      <div v-for="n in 5" :key="n" class="border-b border-line py-4 last:border-0"><KSkeleton :lines="2" /></div>
    </div>

    <div v-else-if="!error" class="space-y-8">
      <section v-for="group in [
        { title: 'Standard roles', hint: 'Created for every school. Only the owner can adjust their permissions.', items: builtIn },
        { title: 'Custom roles', hint: 'Roles your school created for its own needs.', items: custom },
      ]" :key="group.title">
        <div class="mb-3">
          <h2 class="k-section-title">{{ group.title }}</h2>
          <p class="k-help mt-0.5">{{ group.hint }}</p>
        </div>

        <div class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <KEmptyState
            v-if="group.items.length === 0"
            compact
            :icon="ShieldCheck"
            title="No custom roles yet"
            description="Create a role such as Exams Officer or Librarian when the standard roles don't fit."
          >
            <KButton v-if="workspace.can('roles.create')" size="sm" variant="secondary" :icon="Plus" @click="openCreate">
              Create role
            </KButton>
          </KEmptyState>

          <template v-else>
            <!-- Table on wider screens -->
            <table class="hidden w-full text-left text-[13.5px] md:table">
              <thead class="border-b border-line bg-surface-muted/60 text-[12.5px] text-ink-muted">
                <tr>
                  <th scope="col" class="px-5 py-2.5 font-medium">Role</th>
                  <th scope="col" class="px-5 py-2.5 font-medium">Members</th>
                  <th scope="col" class="px-5 py-2.5 font-medium">Permissions</th>
                  <th scope="col" class="w-10 px-5 py-2.5"><span class="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line">
                <tr
                  v-for="role in group.items"
                  :key="role.id"
                  class="cursor-pointer transition-colors hover:bg-surface-muted/50"
                  @click="router.push({ name: 'role-detail', params: { slug, roleId: role.id } })"
                >
                  <td class="px-5 py-3.5">
                    <RouterLink
                      :to="{ name: 'role-detail', params: { slug, roleId: role.id } }"
                      class="font-medium text-ink hover:text-brand-ink"
                      @click.stop
                    >
                      {{ role.name }}
                    </RouterLink>
                    <p v-if="role.description" class="mt-0.5 max-w-xl truncate text-[12.5px] text-ink-muted">{{ role.description }}</p>
                  </td>
                  <td class="px-5 py-3.5 tabular-nums">{{ role.member_count }}</td>
                  <td class="px-5 py-3.5">
                    <KBadge :tone="role.role_key === 'owner' ? 'brand' : 'neutral'">{{ permissionLabel(role) }}</KBadge>
                  </td>
                  <td class="px-5 py-3.5 text-ink-subtle"><ChevronRight :size="16" aria-hidden="true" /></td>
                </tr>
              </tbody>
            </table>

            <!-- Cards on small screens -->
            <ul class="divide-y divide-line md:hidden">
              <li v-for="role in group.items" :key="role.id">
                <RouterLink :to="{ name: 'role-detail', params: { slug, roleId: role.id } }" class="flex items-center gap-3 px-4 py-3.5">
                  <div class="min-w-0 flex-1">
                    <p class="font-medium">{{ role.name }}</p>
                    <p class="mt-0.5 text-[12.5px] text-ink-muted">
                      {{ role.member_count }} member{{ role.member_count === 1 ? '' : 's' }} · {{ permissionLabel(role) }}
                    </p>
                  </div>
                  <ChevronRight :size="16" class="text-ink-subtle" aria-hidden="true" />
                </RouterLink>
              </li>
            </ul>
          </template>
        </div>
      </section>
    </div>

    <KModal v-model:open="createOpen" title="Create a custom role" description="You'll choose its permissions next.">
      <form id="create-role-form" class="space-y-4" novalidate @submit.prevent="submitCreate">
        <KAlert v-if="formError" tone="danger">{{ formError }}</KAlert>
        <KInput v-model="form.name" label="Role name" placeholder="e.g. Exams Officer" :maxlength="60" :error="formErrors.name" required autofocus />
        <KTextarea
          v-model="form.description"
          label="Description"
          placeholder="What is this role responsible for?"
          :maxlength="300"
          :error="formErrors.description"
          optional
        />
      </form>
      <template #footer>
        <KButton variant="secondary" @click="createOpen = false">Cancel</KButton>
        <KButton type="submit" form="create-role-form" :loading="saving">Create role</KButton>
      </template>
    </KModal>
  </div>
</template>
