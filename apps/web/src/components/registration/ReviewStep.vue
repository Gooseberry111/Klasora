<script setup lang="ts">
import { computed } from 'vue';
import { Pencil } from 'lucide-vue-next';
import {
  ACADEMIC_STRUCTURE_DETAILS,
  COUNTRIES,
  INSTITUTION_TYPE_LABELS,
  formatMoney,
  type SubscriptionPlan,
} from '@klasora/shared';
import { useRegistrationStore } from '@/stores/registration';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ plans: SubscriptionPlan[] }>();
defineEmits<{ edit: [step: number] }>();

const registration = useRegistrationStore();
const auth = useAuthStore();
const i = registration.institution;

const plan = computed(() => props.plans.find((p) => p.code === registration.planCode));
const country = computed(() => COUNTRIES.find((c) => c.code === i.country)?.name ?? i.country);
const owner = computed(() =>
  auth.isAuthenticated
    ? { name: auth.displayName, email: auth.user?.email ?? '' }
    : {
        name: `${registration.administrator.firstName} ${registration.administrator.lastName}`.trim(),
        email: registration.administrator.email,
      },
);

const sections = computed(() => [
  {
    step: 1,
    title: 'Institution',
    rows: [
      ['Name', i.name],
      ['Type', i.institutionType ? INSTITUTION_TYPE_LABELS[i.institutionType] : ''],
      ['Email', i.email],
      ['Phone', i.phone],
      ['Address', [i.address, i.city, i.state, country.value].filter(Boolean).join(', ')],
      ['Website', i.website || 'Not provided'],
    ],
  },
  {
    step: 2,
    title: 'Academic structure',
    rows: [['Structure', registration.academicStructure ? ACADEMIC_STRUCTURE_DETAILS[registration.academicStructure].label : '']],
  },
  { step: 3, title: 'School owner', rows: [['Name', owner.value.name], ['Email', owner.value.email]] },
  {
    step: 4,
    title: 'Plan',
    rows: [
      ['Plan', plan.value?.name ?? registration.planCode],
      [
        'Price after trial',
        plan.value?.monthly_price != null ? `${formatMoney(plan.value.monthly_price, plan.value.currency)} / month` : 'Custom',
      ],
      ['Free trial', plan.value ? `${plan.value.trial_days} days` : ''],
    ],
  },
]);
</script>

<template>
  <div class="space-y-4">
    <section v-for="section in sections" :key="section.step" class="rounded-card border border-line">
      <header class="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 class="text-[14px] font-semibold">{{ section.title }}</h3>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-brand-ink hover:bg-brand-soft"
          @click="$emit('edit', section.step)"
        >
          <Pencil :size="13" aria-hidden="true" /> Edit
        </button>
      </header>
      <dl class="divide-y divide-line">
        <div v-for="[label, value] in section.rows" :key="label" class="grid grid-cols-3 gap-3 px-4 py-2.5 text-[13.5px]">
          <dt class="text-ink-muted">{{ label }}</dt>
          <dd class="col-span-2 break-words text-ink">{{ value }}</dd>
        </div>
      </dl>
    </section>
    <p class="text-[12.5px] text-ink-muted">
      By creating a workspace you agree to Klasora's Terms of Service and Privacy Policy, and confirm you are authorised to
      register this institution.
    </p>
  </div>
</template>
