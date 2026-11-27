<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { HeartHandshake, Mail, Pencil, Phone, Plus, Search, Send, ShieldCheck, Trash2, UserCheck, UsersRound } from 'lucide-vue-next';
import {
  RELATIONSHIP_LABELS,
  guardianFormSchema,
  studentName,
  validate,
  type FieldErrors,
  type Guardian,
  type GuardianFormInput,
  type Student,
  type StudentGuardian,
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
import KPagination from '@/components/ui/KPagination.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import InvitationShare from '@/components/InvitationShare.vue';
import { appUrl } from '@/lib/supabase';
import { emailInvitation } from '@/services/setup';
import { deleteGuardian, inviteGuardian, listGuardians, listPendingGuardianInvites, listStudentGuardians, listStudents, saveGuardian } from '@/services/students';
import { useSchool } from '@/composables/useSchool';

const { workspace, schoolId, slug, can, feedback, attempt } = useSchool();
const canEdit = computed(() => can('students.edit'));

const guardians = ref<Guardian[]>([]);
const links = ref<StudentGuardian[]>([]);
const students = ref<Student[]>([]);
const pending = ref<Set<string>>(new Set());
const loading = ref(true);
const error = ref('');
const search = ref('');
const access = ref('');
const page = ref(1);
const PAGE_SIZE = 25;

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    [guardians.value, links.value, students.value, pending.value] = await Promise.all([
      listGuardians(schoolId.value),
      listStudentGuardians(schoolId.value),
      listStudents(schoolId.value),
      listPendingGuardianInvites(schoolId.value),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const studentById = computed(() => new Map(students.value.map((s) => [s.id, s])));
const childrenOf = (g: Guardian) =>
  links.value
    .filter((l) => l.guardian_id === g.id)
    .map((l) => ({ link: l, student: studentById.value.get(l.student_id) }))
    .filter((x): x is { link: StudentGuardian; student: Student } => Boolean(x.student));
const state = (g: Guardian) => (g.user_id ? 'access' : pending.value.has(g.id) ? 'invited' : 'none');
const STATE_LABEL = { access: 'Portal access', invited: 'Invited', none: 'Not invited' } as const;
const STATE_TONE = { access: 'success', invited: 'warning', none: 'neutral' } as const;

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return guardians.value.filter((g) => {
    if (access.value && state(g) !== access.value) return false;
    if (!q) return true;
    const kids = childrenOf(g).map((c) => studentName(c.student)).join(' ');
    return `${g.first_name} ${g.last_name} ${g.email ?? ''} ${g.phone ?? ''} ${kids}`.toLowerCase().includes(q);
  });
});
watch([search, access], () => (page.value = 1));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const stats = computed(() => ({
  total: guardians.value.length,
  access: guardians.value.filter((g) => g.user_id).length,
  invitable: guardians.value.filter((g) => !g.user_id && g.email && !pending.value.has(g.id)).length,
}));

// Edit or add
const formOpen = ref(false);
const editing = ref<Guardian | null>(null);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<GuardianFormInput>({ firstName: '', lastName: '', email: '', phone: '', occupation: '', address: '' });

function openForm(g: Guardian | null = null) {
  editing.value = g;
  Object.assign(form, {
    firstName: g?.first_name ?? '',
    lastName: g?.last_name ?? '',
    email: g?.email ?? '',
    phone: g?.phone ?? '',
    occupation: g?.occupation ?? '',
    address: g?.address ?? '',
  });
  errors.value = {};
  formOpen.value = true;
}

async function submit() {
  const result = validate(guardianFormSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(() => saveGuardian(schoolId.value, result.data, editing.value?.id), editing.value ? 'Changes saved.' : 'Guardian added.');
  saving.value = false;
  if (saved) {
    formOpen.value = false;
    await load();
  }
}

async function remove(g: Guardian) {
  const count = childrenOf(g).length;
  const ok = await feedback.confirm({
    title: `Remove ${g.first_name} ${g.last_name}?`,
    description: count
      ? `They are linked to ${count} student${count === 1 ? '' : 's'}. Those links are removed, and they lose parent portal access to them.`
      : 'This removes their guardian record.',
    confirmLabel: 'Remove guardian',
    tone: 'danger',
  });
  if (!ok) return;
  await attempt(() => deleteGuardian(g.id), 'Guardian removed.');
  await load();
}

// Invitations
const inviteResult = ref<{ email: string; link: string; emailed: boolean } | null>(null);
const inviting = ref<string | null>(null);

async function invite(g: Guardian) {
  inviting.value = g.id;
  const created = await attempt(() => inviteGuardian(g.id));
  if (created) {
    const emailed = await emailInvitation(created.invitation_id, created.token);
    inviteResult.value = { email: g.email!, link: `${appUrl}/invite/${created.token}`, emailed };
    pending.value = new Set([...pending.value, g.id]);
  }
  inviting.value = null;
}
</script>

<template>
  <div>
    <KPageHeader
      :icon="HeartHandshake"
      eyebrow="School management"
      title="Parents and guardians"
      description="Everyone responsible for your students. Invite them to the parent portal to follow their children."
    >
      <template #actions>
        <KButton v-if="canEdit" :icon="Plus" @click="openForm()">Add guardian</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <div class="mb-5 grid gap-3 sm:grid-cols-3">
      <div v-for="card in [
        { label: 'Guardians', value: stats.total, icon: UsersRound, tone: 'brand' },
        { label: 'Using the parent portal', value: stats.access, icon: UserCheck, tone: 'success' },
        { label: 'Ready to invite', value: stats.invitable, icon: Send, tone: 'warning' },
      ] as const" :key="card.label" class="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
        <KIconTile :icon="card.icon" :tone="card.tone" solid :size="40" />
        <span>
          <span class="block text-[12.5px] text-ink-muted">{{ card.label }}</span>
          <KSkeleton v-if="loading" line-class="mt-1 h-6 w-10" />
          <span v-else class="block text-[22px] leading-7 font-semibold tabular-nums">{{ card.value }}</span>
        </span>
      </div>
    </div>

    <div class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
        <div class="sm:w-80"><KInput v-model="search" type="search" :icon="Search" placeholder="Name, phone, email or child" aria-label="Search guardians" /></div>
        <div class="sm:w-56">
          <KSelect v-model="access" :options="[{ value: '', label: 'Any portal status' }, { value: 'access', label: 'Portal access' }, { value: 'invited', label: 'Invited' }, { value: 'none', label: 'Not invited' }]" aria-label="Portal status" />
        </div>
      </div>

      <KSkeleton v-if="loading" :lines="6" class="p-5" />
      <KEmptyState v-else-if="!guardians.length" :icon="HeartHandshake" title="No guardians yet" description="Guardians are added when you register students, or you can add them here and link them later.">
        <KButton v-if="canEdit" :icon="Plus" @click="openForm()">Add guardian</KButton>
      </KEmptyState>
      <KEmptyState v-else-if="!filtered.length" compact :icon="Search" title="No guardians match" />

      <template v-else>
        <div class="overflow-x-auto">
          <table class="k-table">
            <thead>
              <tr>
                <th scope="col">Guardian</th>
                <th scope="col" class="hidden md:table-cell">Contact</th>
                <th scope="col">Children</th>
                <th scope="col">Parent portal</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in pageRows" :key="g.id">
                <td>
                  <div class="flex items-center gap-3">
                    <KAvatar :name="`${g.first_name} ${g.last_name}`" :size="36" />
                    <div>
                      <p class="font-medium">{{ g.first_name }} {{ g.last_name }}</p>
                      <p v-if="g.occupation" class="text-[12.5px] text-ink-muted">{{ g.occupation }}</p>
                    </div>
                  </div>
                </td>
                <td class="hidden text-[13px] text-ink-muted md:table-cell">
                  <p v-if="g.phone" class="flex items-center gap-1.5"><Phone :size="13" aria-hidden="true" /> {{ g.phone }}</p>
                  <p v-if="g.email" class="flex items-center gap-1.5"><Mail :size="13" aria-hidden="true" /> {{ g.email }}</p>
                </td>
                <td>
                  <div class="flex flex-wrap gap-1.5">
                    <RouterLink
                      v-for="{ link, student } in childrenOf(g)"
                      :key="link.id"
                      :to="{ name: 'student-detail', params: { slug, studentId: student.id } }"
                      class="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-[12.5px] font-medium text-brand-ink hover:brightness-95"
                      :title="RELATIONSHIP_LABELS[link.relationship]"
                    >
                      {{ studentName(student) }}
                    </RouterLink>
                    <span v-if="!childrenOf(g).length" class="text-[13px] text-ink-subtle">None linked</span>
                  </div>
                </td>
                <td>
                  <KBadge :tone="STATE_TONE[state(g)]" dot>
                    <ShieldCheck v-if="state(g) === 'access'" :size="12" aria-hidden="true" />
                    {{ STATE_LABEL[state(g)] }}
                  </KBadge>
                </td>
                <td class="text-right whitespace-nowrap">
                  <KButton
                    v-if="canEdit && !g.user_id && g.email"
                    size="sm"
                    variant="subtle"
                    :icon="Send"
                    :loading="inviting === g.id"
                    @click="invite(g)"
                  >
                    {{ state(g) === 'invited' ? 'Resend' : 'Invite' }}
                  </KButton>
                  <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${g.first_name} ${g.last_name}`" @click="openForm(g)" />
                  <KButton v-if="can('students.delete')" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${g.first_name} ${g.last_name}`" class="text-danger-ink hover:bg-danger-soft" @click="remove(g)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <KPagination v-model="page" :total="filtered.length" :page-size="PAGE_SIZE" noun="guardians" />
      </template>
    </div>

    <KModal v-model:open="formOpen" :title="editing ? `Edit ${editing.first_name} ${editing.last_name}` : 'Add a guardian'" description="Link them to students from each student's profile.">
      <form id="guardian-form" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submit">
        <KInput v-model="form.firstName" label="First name" :error="errors.firstName" required autofocus />
        <KInput v-model="form.lastName" label="Last name" :error="errors.lastName" required />
        <KInput v-model="form.email" type="email" label="Email" hint="Needed for the parent portal." :error="errors.email" :readonly="Boolean(editing?.user_id)" optional />
        <KInput v-model="form.phone" type="tel" label="Phone" :error="errors.phone" optional />
        <KInput v-model="form.occupation" label="Occupation" optional />
        <KInput v-model="form.address" label="Address" optional />
      </form>
      <template #footer>
        <KButton variant="secondary" @click="formOpen = false">Cancel</KButton>
        <KButton type="submit" form="guardian-form" :loading="saving">{{ editing ? 'Save changes' : 'Add guardian' }}</KButton>
      </template>
    </KModal>

    <KModal :open="Boolean(inviteResult)" title="Parent portal invitation" @update:open="!$event && (inviteResult = null)">
      <InvitationShare v-if="inviteResult" v-bind="inviteResult" :school-name="workspace.currentSchool?.name ?? 'Your school'" purpose="follow your child on Klasora" />
      <template #footer><KButton @click="inviteResult = null">Done</KButton></template>
    </KModal>
  </div>
</template>
