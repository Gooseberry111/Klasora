<script setup lang="ts">
import { Check, Mail } from 'lucide-vue-next';
import { formatMoney, type FieldErrors, type SubscriptionPlan } from '@klasora/shared';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KButton from '@/components/ui/KButton.vue';
import { useRegistrationStore } from '@/stores/registration';
import { describeLimit, planHighlights } from '@/lib/plans';

defineProps<{ errors: FieldErrors; plans: SubscriptionPlan[]; loading: boolean; loadError: string }>();
defineEmits<{ retry: [] }>();
const registration = useRegistrationStore();
</script>

<template>
  <div>
    <KAlert v-if="loadError" tone="danger">
      {{ loadError }}
      <template #action>
        <KButton size="sm" variant="secondary" @click="$emit('retry')">Try again</KButton>
      </template>
    </KAlert>

    <div v-else-if="loading" class="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div v-for="n in 3" :key="n" class="rounded-card border border-line p-5"><KSkeleton :lines="5" /></div>
    </div>

    <template v-else>
      <p class="mb-5 text-[13.5px] text-ink-muted">
        Every plan starts with a free trial. You won't be charged today, and you can change plans at any time.
      </p>
      <fieldset>
        <legend class="sr-only">Subscription plan</legend>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label
            v-for="plan in plans"
            :key="plan.id"
            :class="[
              'relative flex flex-col rounded-card border p-5 transition-[border-color,box-shadow] duration-150',
              'has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-focus',
              !plan.is_self_serve ? 'cursor-default bg-surface-muted/50' : 'cursor-pointer',
              registration.planCode === plan.code
                ? 'border-brand bg-brand-soft/50 shadow-[0_0_0_1px_var(--k-brand)]'
                : 'border-line bg-surface hover:border-line-strong',
            ]"
          >
            <input
              v-if="plan.is_self_serve"
              v-model="registration.planCode"
              type="radio"
              name="plan"
              :value="plan.code"
              class="sr-only"
            />
            <div class="flex items-center justify-between gap-2">
              <p class="text-[15px] font-semibold">{{ plan.name }}</p>
              <span
                v-if="plan.is_self_serve"
                :class="[
                  'flex size-5 items-center justify-center rounded-full border',
                  registration.planCode === plan.code ? 'border-brand bg-brand text-white' : 'border-line-strong',
                ]"
                aria-hidden="true"
              >
                <Check v-if="registration.planCode === plan.code" :size="12" :stroke-width="3" />
              </span>
            </div>
            <p class="mt-3">
              <template v-if="plan.monthly_price !== null">
                <span class="text-[26px] font-semibold tracking-tight">{{ formatMoney(plan.monthly_price, plan.currency) }}</span>
                <span class="text-[13px] text-ink-muted"> / month</span>
              </template>
              <span v-else class="text-[22px] font-semibold tracking-tight">Custom pricing</span>
            </p>
            <p class="mt-1 text-[12.5px] text-ink-muted">
              {{ plan.trial_days }}-day free trial
            </p>
            <p class="mt-3 text-[13px] text-ink-muted">{{ plan.description }}</p>
            <ul class="mt-4 space-y-2 border-t border-line pt-4 text-[13px]">
              <li class="flex gap-2"><Check :size="15" class="mt-0.5 shrink-0 text-success" aria-hidden="true" />{{ describeLimit(plan.maximum_students, 'student') }}</li>
              <li class="flex gap-2"><Check :size="15" class="mt-0.5 shrink-0 text-success" aria-hidden="true" />{{ describeLimit(plan.maximum_staff, 'staff member') }}</li>
              <li class="flex gap-2"><Check :size="15" class="mt-0.5 shrink-0 text-success" aria-hidden="true" />{{ describeLimit(plan.maximum_campuses, 'campus', 'campuses') }}</li>
              <li v-for="feature in planHighlights(plan)" :key="feature" class="flex gap-2">
                <Check :size="15" class="mt-0.5 shrink-0 text-success" aria-hidden="true" />{{ feature }}
              </li>
            </ul>
            <p v-if="!plan.is_self_serve" class="mt-4 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-muted">
              <Mail :size="14" aria-hidden="true" /> Contact our team to set up Enterprise.
            </p>
          </label>
        </div>
      </fieldset>
      <p v-if="errors.planCode" class="mt-3 text-[12.5px] text-danger-ink" role="alert">{{ errors.planCode }}</p>
    </template>
  </div>
</template>
