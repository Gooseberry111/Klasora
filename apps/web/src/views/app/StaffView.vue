<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { Check, Clock, Copy, Mail, MessageCircle, Search, Send, ShieldCheck, UserCog, UserPlus, Users, X } from 'lucide-vue-next';
import {
  MEMBERSHIP_STATUS_LABELS,
  staffInvitationSchema,
  validate,
  type Campus,
  type FieldErrors,
  type SchoolMember,
  type StaffInvitationInput,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import { appUrl } from '@/lib/supabase';
import { listRoleSummaries, type RoleSummary } from '@/services/roles';
import {
  createInvitation,
  emailInvitation,
  listCampuses,
  listInvitations,
  listMembers,
  revokeInvitation,
  updateMembership,
  type InvitationWithRole,
} from '@/services/setup';
import { formatDate } from '@/lib/time';
import { listStaffProfiles } from '@/services/students';
import type { StaffProfile } from '@klasora/shared';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import { fullName, useSchool } from '@/composables/useSchool';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const { workspace, schoolId, slug, can, writable, feedback, attempt } = useSchool();
const canInvite = computed(() => can('staff.create') && writable.value);
const canManage = computed(() => can('staff.edit') && writable.value);

const members = ref<SchoolMember[]>([]);
const invitations = ref<InvitationWithRole[]>([]);
const roles = ref<RoleSummary[]>([]);
const campuses = ref<Campus[]>([]);
const loading = ref(true);
const error = ref('');
const tab = ref<'people' | 'invitations'>('people');
const search = ref('');
const roleFilter = ref('');
const includeFamilies = ref(false);
const profiles = ref<StaffProfile[]>([]);
const isFamily = (m: SchoolMember) => m.role_key === 'parent' || m.role_key === 'student';
const jobTitle = (m: SchoolMember) => profiles.value.find((p) => p.user_id === m.user_id)?.job_title;

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    [members.value, invitations.value, roles.value, campuses.value] = await Promise.all([
      listMembers(schoolId.value),
      listInvitations(schoolId.value),
      listRoleSummaries(schoolId.value),
      listCampuses(schoolId.value),
    ]);
    profiles.value = await listStaffProfiles(schoolId.value).catch(() => []);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return members.value.filter(
    (m) =>
      (!q || fullName(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) &&
      (!roleFilter.value || m.role_id === roleFilter.value) &&
      (includeFamilies.value || roleFilter.value !== '' || !isFamily(m)),
  );
});
const activeCount = computed(() => new Set(members.value.filter((m) => m.status === 'active' && !isFamily(m)).map((m) => m.user_id)).size);
const roleOptions = computed(() => roles.value.filter((r) => r.role_key !== 'owner').map((r) => ({ value: r.id, label: r.name })));
const campusOptions = computed(() => [{ value: '', label: 'All campuses' }, ...campuses.value.map((c) => ({ value: c.id, label: c.name }))]);
const statusTone = (s: string) => (s === 'active' ? 'success' : s === 'suspended' ? 'danger' : 'neutral');
const canChange = (m: SchoolMember) => canManage.value && m.role_key !== 'owner' && m.user_id !== auth.user?.id;
const expiresIn = (iso: string) => {
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  return days <= 0 ? 'Expired' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
};

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------
const inviteOpen = ref(false);
const sending = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<StaffInvitationInput>({ email: '', roleId: '', campusId: null });
const result = ref<{ email: string; link: string; emailed: boolean } | null>(null);
const copied = ref(false);

function openInvite() {
  Object.assign(form, { email: '', roleId: roles.value.find((r) => r.role_key === 'teacher')?.id ?? '', campusId: null });
  errors.value = {};
  result.value = null;
  copied.value = false;
  inviteOpen.value = true;
}

async function submitInvite() {
  const parsed = validate(staffInvitationSchema, form);
  if (!parsed.success) {
    errors.value = parsed.errors;
    return;
  }
  sending.value = true;
  const created = await attempt(() => createInvitation(schoolId.value, parsed.data));
  if (created) {
    const emailed = await emailInvitation(created.invitation_id, created.token);
    result.value = { email: parsed.data.email, link: `${appUrl}/invite/${created.token}`, emailed };
    await load();
    tab.value = 'invitations';
  }
  sending.value = false;
}

async function copyLink() {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.link);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2500);
  } catch {
    feedback.error('Copy failed. Select the link and copy it manually.');
  }
}

const whatsappLink = computed(() =>
  result.value
    ? `https://wa.me/?text=${encodeURIComponent(`You're invited to join ${workspace.currentSchool?.name} on Klasora. Accept here: ${result.value.link}`)}`
    : '',
);

async function revoke(invitation: InvitationWithRole) {
  const ok = await feedback.confirm({
    title: `Cancel the invitation for ${invitation.email}?`,
    description: 'The link will stop working. You can invite them again later.',
    confirmLabel: 'Cancel invitation',
    cancelLabel: 'Keep it',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => revokeInvitation(invitation.id), 'Invitation cancelled.');
  await load();
}

async function resend(invitation: InvitationWithRole) {
  form.email = invitation.email;
  form.roleId = invitation.role_id;
  form.campusId = invitation.campus_id;
  errors.value = {};
  result.value = null;
  inviteOpen.value = true;
  await submitInvite();
}

// ---------------------------------------------------------------------------
// Manage access
// ---------------------------------------------------------------------------
const manageOpen = ref(false);
const managing = ref<SchoolMember | null>(null);
const manageRole = ref('');
const manageSaving = ref(false);

function openManage(member: SchoolMember) {
  managing.value = member;
  manageRole.value = member.role_id;
  manageOpen.value = true;
}

async function saveRole() {
  if (!managing.value) return;
  manageSaving.value = true;
  const ok = await attempt(async () => {
    await updateMembership(managing.value!.membership_id, { roleId: manageRole.value });
    return true;
  }, 'Role updated.');
  manageSaving.value = false;
  if (ok) {
    manageOpen.value = false;
    await load();
  }
}

async function setStatus(member: SchoolMember, status: 'active' | 'suspended') {
  if (status === 'suspended') {
    const ok = await feedback.confirm({
      title: `Suspend ${fullName(member)}?`,
      description: 'They will lose access to this school straight away. You can restore it at any time.',
      confirmLabel: 'Suspend access',
      tone: 'danger',
    });
    if (!ok) return;
  }
  manageSaving.value = true;
  await attempt(() => updateMembership(member.membership_id, { status }), status === 'active' ? 'Access restored.' : 'Access suspended.');
  manageSaving.value = false;
  manageOpen.value = false;
  await load();
}
</script>

<template>
  <div>
    <KPageHeader
      :icon="Users"
      eyebrow="School management"
      title="Teachers and staff"
      description="Everyone with access to your school. Invite people by email and choose exactly what their role allows."
    >
      <template #actions>
        <KButton v-if="canInvite" :icon="UserPlus" @click="openInvite">Invite someone</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <!-- Tabs -->
    <div class="mb-4 inline-flex rounded-xl border border-line bg-surface p-1 shadow-card" role="tablist" aria-label="Staff views">
      <button
        v-for="t in [
          { key: 'people', label: 'People', count: activeCount },
          { key: 'invitations', label: 'Pending invitations', count: invitations.length },
        ] as const"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        :class="[
          'flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition-colors',
          tab === t.key ? 'k-bg-brand text-white shadow-brand' : 'text-ink-muted hover:text-ink',
        ]"
        @click="tab = t.key"
      >
        {{ t.label }}
        <span :class="['rounded-full px-1.5 text-[11.5px] tabular-nums', tab === t.key ? 'bg-white/20' : 'bg-surface-muted']">{{ t.count }}</span>
      </button>
    </div>

    <!-- People -->
    <div v-if="tab === 'people'" class="rounded-card border border-line bg-surface shadow-card" role="tabpanel">
      <div class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <div class="sm:w-72">
          <KInput v-model="search" type="search" :icon="Search" placeholder="Search by name or email" aria-label="Search people" />
        </div>
        <div class="sm:w-56">
          <KSelect v-model="roleFilter" :options="[{ value: '', label: 'All roles' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]" aria-label="Role" />
        </div>
        <div class="sm:ml-auto">
          <KCheckbox v-model="includeFamilies" label="Include parents and students" />
        </div>
      </div>

      <KSkeleton v-if="loading" :lines="6" class="p-5" />
      <KEmptyState v-else-if="!filtered.length" compact :icon="Search" title="Nobody matches" description="Try another name or role." />

      <div v-else class="overflow-x-auto">
        <table class="k-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col" class="hidden md:table-cell">Campus</th>
              <th scope="col">Status</th>
              <th scope="col" class="hidden lg:table-cell">Joined</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in filtered" :key="m.membership_id">
              <td>
                <div class="flex items-center gap-3">
                  <KAvatar :name="fullName(m)" :src="m.avatar_url" :size="36" />
                  <div class="min-w-0">
                    <p class="flex items-center gap-2 font-medium text-ink">
                      <RouterLink v-if="!isFamily(m)" :to="{ name: 'staff-detail', params: { slug, userId: m.user_id } }" class="hover:text-brand-ink">{{ fullName(m) }}</RouterLink>
                      <template v-else>{{ fullName(m) }}</template>
                      <KBadge v-if="m.user_id === auth.user?.id" tone="brand">You</KBadge>
                    </p>
                    <p class="truncate text-[12.5px] text-ink-muted">{{ jobTitle(m) ? `${jobTitle(m)}, ` : '' }}{{ m.email }}</p>
                  </div>
                </div>
              </td>
              <td>
                <span class="inline-flex items-center gap-1.5">
                  <ShieldCheck v-if="m.role_key === 'owner'" :size="15" class="text-brand" aria-hidden="true" />
                  {{ m.role_name }}
                </span>
              </td>
              <td class="hidden text-ink-muted md:table-cell">{{ campuses.find((c) => c.id === m.campus_id)?.name ?? 'All campuses' }}</td>
              <td><KBadge :tone="statusTone(m.status)" dot>{{ MEMBERSHIP_STATUS_LABELS[m.status] }}</KBadge></td>
              <td class="hidden text-ink-muted lg:table-cell">{{ m.joined_at ? formatDate(m.joined_at) : 'Not yet' }}</td>
              <td class="text-right">
                <KButton v-if="canChange(m)" size="sm" variant="ghost" :icon="UserCog" @click="openManage(m)">Manage</KButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Invitations -->
    <div v-else class="rounded-card border border-line bg-surface shadow-card" role="tabpanel">
      <KSkeleton v-if="loading" :lines="4" class="p-5" />
      <KEmptyState
        v-else-if="!invitations.length"
        :icon="Mail"
        title="No pending invitations"
        description="Invite teachers, administrators and your bursar. They get a secure link that works for 7 days."
      >
        <KButton v-if="canInvite" :icon="UserPlus" @click="openInvite">Invite someone</KButton>
      </KEmptyState>
      <ul v-else class="divide-y divide-line">
        <li v-for="inv in invitations" :key="inv.id" class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning-ink">
              <Clock :size="17" aria-hidden="true" />
            </span>
            <div class="min-w-0">
              <p class="truncate font-medium">{{ inv.email }}</p>
              <p class="text-[12.5px] text-ink-muted">{{ inv.role?.name ?? 'Role' }}, {{ expiresIn(inv.expires_at) }}</p>
            </div>
          </div>
          <div v-if="canInvite" class="flex gap-1">
            <KButton size="sm" variant="secondary" :icon="Send" @click="resend(inv)">Send again</KButton>
            <KButton size="sm" variant="ghost" :icon="X" class="text-danger-ink hover:bg-danger-soft" @click="revoke(inv)">Cancel</KButton>
          </div>
        </li>
      </ul>
    </div>

    <!-- Invite modal -->
    <KModal v-model:open="inviteOpen" :title="result ? 'Invitation ready' : 'Invite someone'" :description="result ? undefined : 'They will set their own password when they accept.'">
      <div v-if="result" class="space-y-4">
        <div class="flex items-start gap-3 rounded-xl bg-success-soft p-4 text-success-ink">
          <Check :size="20" class="mt-0.5 shrink-0" aria-hidden="true" />
          <p class="text-[13.5px]">
            <template v-if="result.emailed">We emailed an invitation to <strong>{{ result.email }}</strong>.</template>
            <template v-else>The invitation for <strong>{{ result.email }}</strong> is ready. Share the link below; it works for 7 days.</template>
          </p>
        </div>
        <div>
          <p class="k-label mb-1.5">Invitation link</p>
          <div class="flex gap-2">
            <input :value="result.link" readonly class="h-10 min-w-0 flex-1 rounded-control border border-line-strong bg-surface-muted px-3 text-[13px] text-ink-muted" aria-label="Invitation link" @focus="($event.target as HTMLInputElement).select()" />
            <KButton variant="secondary" :icon="copied ? Check : Copy" @click="copyLink">{{ copied ? 'Copied' : 'Copy' }}</KButton>
          </div>
          <p class="k-help mt-1.5">Only {{ result.email }} can accept it, after signing in or creating an account with that email.</p>
        </div>
        <KButton :href="whatsappLink" target="_blank" rel="noopener" variant="secondary" :icon="MessageCircle" block>Share on WhatsApp</KButton>
      </div>

      <form v-else id="invite-form" class="space-y-4" novalidate @submit.prevent="submitInvite">
        <KInput v-model="form.email" label="Email address" type="email" :icon="Mail" placeholder="teacher@school.com" :error="errors.email" required autofocus />
        <KSelect v-model="form.roleId" label="Role" :options="roleOptions" placeholder="Choose a role" :error="errors.roleId" required />
        <KSelect
          v-if="campuses.length > 1"
          :model-value="form.campusId ?? ''"
          label="Campus"
          :options="campusOptions"
          @update:model-value="form.campusId = $event || null"
        />
        <p class="k-help">You can only give roles whose permissions you hold yourself.</p>
      </form>

      <template #footer>
        <template v-if="result">
          <KButton variant="secondary" @click="openInvite">Invite another person</KButton>
          <KButton @click="inviteOpen = false">Done</KButton>
        </template>
        <template v-else>
          <KButton variant="secondary" @click="inviteOpen = false">Cancel</KButton>
          <KButton type="submit" form="invite-form" :icon="Send" :loading="sending">Create invitation</KButton>
        </template>
      </template>
    </KModal>

    <!-- Manage modal -->
    <KModal v-model:open="manageOpen" :title="managing ? fullName(managing) : ''" :description="managing?.email">
      <div v-if="managing" class="space-y-5">
        <KSelect v-model="manageRole" label="Role" :options="roleOptions" />
        <div class="rounded-xl border border-line p-4">
          <p class="text-[14px] font-medium">Access</p>
          <p class="mt-0.5 text-[13px] text-ink-muted">
            {{ managing.status === 'active' ? 'This person can sign in and use this school.' : 'This person cannot use this school right now.' }}
          </p>
          <KButton
            class="mt-3"
            size="sm"
            :variant="managing.status === 'active' ? 'danger' : 'primary'"
            :loading="manageSaving"
            @click="setStatus(managing, managing.status === 'active' ? 'suspended' : 'active')"
          >
            {{ managing.status === 'active' ? 'Suspend access' : 'Restore access' }}
          </KButton>
        </div>
      </div>
      <template #footer>
        <KButton variant="secondary" @click="manageOpen = false">Close</KButton>
        <KButton :disabled="manageRole === managing?.role_id" :loading="manageSaving" @click="saveRole">Save role</KButton>
      </template>
    </KModal>
  </div>
</template>
