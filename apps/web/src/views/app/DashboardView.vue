<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Building2, CreditCard, MapPin, ShieldCheck, Users } from 'lucide-vue-next';
import {
  ACADEMIC_STRUCTURE_DETAILS,
  COUNTRIES,
  INSTITUTION_TYPE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type School,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KStatCard from '@/components/ui/KStatCard.vue';
import KCard from '@/components/ui/KCard.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KButton from '@/components/ui/KButton.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { fetchSchool, fetchSchoolOverview, type SchoolOverview } from '@/services/workspace';
import { greetingFor } from '@/lib/time';

const auth = useAuthStore();
const workspace = useWorkspaceStore();

const school = ref<School | null>(null);
const overview = ref<SchoolOverview | null>(null);
const loading = ref(true);
const error = ref('');

const canViewStaff = computed(() => workspace.can('staff.view'));
const canViewBilling = computed(() => workspace.can('billing.view'));

async function load() {
  const schoolId = workspace.currentSchoolId;
  if (!schoolId) return;
  loading.value = true;
  error.value = '';
  try {
    const [s, o] = await Promise.all([
      fetchSchool(schoolId),
      fetchSchoolOverview(schoolId, { canViewStaff: canViewStaff.value, canViewBilling: canViewBilling.value }),
    ]);
    school.value = s;
    overview.value = o;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(() => workspace.currentSchoolId, load, { immediate: true });

const greeting = computed(() => greetingFor(new Date(), school.value?.timezone));

const trialDaysLeft = computed(() => {
  const sub = overview.value?.subscription;
  if (!sub || sub.status !== 'trialing' || !sub.trial_ends_at) return null;
  const ms = new Date(sub.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
});

const subscriptionDetail = computed(() => {
  const sub = overview.value?.subscription;
  if (!sub) return '';
  if (trialDaysLeft.value !== null) {
    return trialDaysLeft.value === 0 ? 'Trial ends today' : `${trialDaysLeft.value} day${trialDaysLeft.value === 1 ? '' : 's'} left in trial`;
  }
  return SUBSCRIPTION_STATUS_LABELS[sub.status];
});

const details = computed(() => {
  const s = school.value;
  if (!s) return [];
  return [
    ['Institution type', INSTITUTION_TYPE_LABELS[s.institution_type]],
    ['Academic structure', ACADEMIC_STRUCTURE_DETAILS[s.academic_structure].label],
    ['Location', [s.city, s.state, COUNTRIES.find((c) => c.code === s.country)?.name ?? s.country].join(', ')],
    ['Currency', s.default_currency],
    ['Time zone', s.timezone],
    ['Email', s.email],
    ['Phone', s.phone],
  ];
});
</script>

<template>
  <div>
    <KPageHeader
      :title="`${greeting}, ${auth.firstName}`"
      :description="`Here's what's happening at ${workspace.currentSchool?.name ?? 'your school'} today.`"
    />

    <KAlert v-if="error" tone="danger" class="mb-6">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <!-- Key figures: every number comes from the database. -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KStatCard
        v-if="canViewStaff"
        label="Active members"
        :icon="Users"
        :loading="loading"
        :value="overview?.activeMembers ?? 0"
        detail="People with active access to this school"
      />
      <KStatCard
        label="Campuses"
        :icon="Building2"
        tone="info"
        :loading="loading"
        :value="overview?.campuses.length ?? 0"
        :detail="overview?.campuses.find((c) => c.is_main)?.name ? `Main: ${overview?.campuses.find((c) => c.is_main)?.name}` : ''"
      />
      <KStatCard
        label="Roles"
        :icon="ShieldCheck"
        tone="success"
        :loading="loading"
        :value="overview?.roleCount ?? 0"
        :detail="overview ? `${overview.customRoleCount} custom · ${overview.roleCount - overview.customRoleCount} built-in` : ''"
      />
      <KStatCard
        v-if="canViewBilling"
        label="Subscription"
        :icon="CreditCard"
        tone="warning"
        :loading="loading"
        :value="overview?.subscription?.plan?.name ?? 'None'"
        :detail="subscriptionDetail"
      />
    </div>

    <div class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
      <KCard title="School details" description="As registered with Klasora" class="lg:col-span-2">
        <KSkeleton v-if="loading" :lines="6" />
        <dl v-else class="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <div v-for="[label, value] in details" :key="label" class="min-w-0">
            <dt class="text-[12.5px] text-ink-muted">{{ label }}</dt>
            <dd class="mt-0.5 truncate text-[14px] text-ink">{{ value }}</dd>
          </div>
        </dl>
      </KCard>

      <KCard title="Your access">
        <ul class="space-y-3">
          <li v-for="role in workspace.currentRoles" :key="role.id" class="flex items-center justify-between gap-3">
            <span class="text-[14px] font-medium">{{ role.name }}</span>
            <KBadge :tone="role.role_key === 'owner' ? 'brand' : 'neutral'">{{ role.is_system_role ? 'Built-in' : 'Custom' }}</KBadge>
          </li>
        </ul>
        <p class="mt-4 border-t border-line pt-4 text-[13px] text-ink-muted">
          You hold {{ workspace.permissions.size }} permission{{ workspace.permissions.size === 1 ? '' : 's' }} in this
          school.
        </p>
        <KButton
          v-if="workspace.can('roles.view')"
          class="mt-4"
          variant="secondary"
          size="sm"
          :to="{ name: 'roles', params: { slug: workspace.currentSchool?.slug } }"
        >
          Review roles and permissions
        </KButton>
      </KCard>

      <KCard v-if="overview && overview.campuses.length" title="Campuses" class="lg:col-span-3" :padded="false">
        <ul class="divide-y divide-line">
          <li v-for="campus in overview.campuses" :key="campus.id" class="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <MapPin :size="16" class="text-ink-subtle" aria-hidden="true" />
            <span class="font-medium">{{ campus.name }}</span>
            <span class="text-[12.5px] text-ink-muted">{{ campus.code }}</span>
            <KBadge v-if="campus.is_main" tone="brand">Main campus</KBadge>
            <KBadge :tone="campus.status === 'active' ? 'success' : 'neutral'" dot class="ml-auto">
              {{ campus.status === 'active' ? 'Active' : 'Inactive' }}
            </KBadge>
          </li>
        </ul>
      </KCard>
    </div>
  </div>
</template>
