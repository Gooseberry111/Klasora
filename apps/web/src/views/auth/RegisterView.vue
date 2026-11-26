<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ArrowLeft, ArrowRight, Check } from 'lucide-vue-next';
import {
  administratorStepSchema,
  institutionStepSchema,
  planStepSchema,
  structureStepSchema,
  validate,
  type FieldErrors,
  type SubscriptionPlan,
} from '@klasora/shared';
import AuthLayout from '@/layouts/AuthLayout.vue';
import KButton from '@/components/ui/KButton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import InstitutionStep from '@/components/registration/InstitutionStep.vue';
import StructureStep from '@/components/registration/StructureStep.vue';
import AdministratorStep from '@/components/registration/AdministratorStep.vue';
import PlanStep from '@/components/registration/PlanStep.vue';
import ReviewStep from '@/components/registration/ReviewStep.vue';
import { useRegistrationStore } from '@/stores/registration';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { useFeedbackStore } from '@/stores/feedback';
import { clearPendingRegistration, fetchPublicPlans, registerSchool } from '@/services/registration';
import { AppError } from '@/lib/errors';

const registration = useRegistrationStore();
const auth = useAuthStore();
const workspace = useWorkspaceStore();
const feedback = useFeedbackStore();
const router = useRouter();

const STEPS = [
  { title: 'Institution', heading: 'Tell us about your institution', intro: 'These details appear on your workspace and official documents.' },
  { title: 'Structure', heading: 'How is your institution organised?', intro: '' },
  { title: 'Administrator', heading: 'Who is setting up Klasora?', intro: '' },
  { title: 'Plan', heading: 'Choose a plan', intro: '' },
  { title: 'Confirm', heading: 'Review and create your workspace', intro: 'Check everything looks right. You can edit any section.' },
];

const errors = ref<FieldErrors>({});
const formError = ref('');
const submitting = ref(false);
const plans = ref<SubscriptionPlan[]>([]);
const plansLoading = ref(true);
const plansError = ref('');
const current = computed(() => STEPS[registration.step - 1]!);

async function loadPlans() {
  plansLoading.value = true;
  plansError.value = '';
  try {
    plans.value = await fetchPublicPlans();
    if (!plans.value.some((p) => p.code === registration.planCode && p.is_self_serve)) {
      registration.planCode = plans.value.find((p) => p.is_self_serve)?.code ?? '';
    }
  } catch (error) {
    plansError.value = (error as Error).message;
  } finally {
    plansLoading.value = false;
  }
}
onMounted(loadPlans);

function validateStep(step: number): boolean {
  const checks: Record<number, () => ReturnType<typeof validate>> = {
    1: () => validate(institutionStepSchema, registration.institution),
    2: () => validate(structureStepSchema, { academicStructure: registration.academicStructure }),
    3: () => (auth.isAuthenticated ? { success: true, data: null } : validate(administratorStepSchema, registration.administrator)),
    4: () => validate(planStepSchema, { planCode: registration.planCode }),
  };
  const result = checks[step]?.() ?? { success: true, data: null };
  errors.value = result.success ? {} : result.errors;
  if (!result.success) {
    formError.value = 'Please fix the highlighted fields to continue.';
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  } else {
    formError.value = '';
  }
  return result.success;
}

function next() {
  if (!validateStep(registration.step)) return;
  registration.step = Math.min(registration.step + 1, STEPS.length);
  window.scrollTo({ top: 0 });
}

function back() {
  errors.value = {};
  formError.value = '';
  registration.step = Math.max(registration.step - 1, 1);
}

function goTo(step: number) {
  if (step < registration.step) {
    errors.value = {};
    formError.value = '';
    registration.step = step;
  }
}

async function openWorkspace(schoolId: string) {
  await workspace.loadMemberships(true);
  const school = workspace.schools.find((s) => s.id === schoolId);
  registration.reset();
  feedback.success('Your workspace is ready', 'Welcome to Klasora. Start by reviewing your roles and settings.');
  await router.replace(school ? { name: 'dashboard', params: { slug: school.slug } } : { name: 'schools' });
}

async function submit() {
  for (const step of [1, 2, 3, 4]) {
    if (!validateStep(step)) {
      registration.step = step;
      return;
    }
  }
  submitting.value = true;
  formError.value = '';
  const payload = registration.payload();
  try {
    if (auth.isAuthenticated) {
      await openWorkspace(await registerSchool(payload));
      return;
    }
    const admin = registration.administrator;
    const session = await auth.signUp({
      email: admin.email.trim().toLowerCase(),
      password: admin.password,
      firstName: admin.firstName.trim(),
      lastName: admin.lastName.trim(),
      phone: admin.phone.trim(),
      redirectPath: '/auth/callback',
      // Saved with the account so registration can finish after email verification.
      extraMetadata: { pending_school: payload },
    });
    if (session) {
      const schoolId = await registerSchool(payload);
      await clearPendingRegistration().catch(() => undefined);
      await openWorkspace(schoolId);
    } else {
      const email = admin.email.trim().toLowerCase();
      registration.reset();
      await router.replace({ name: 'verify-email', query: { email } });
    }
  } catch (error) {
    const appError = error as AppError;
    formError.value = appError.message;
    if (appError.code === 'user_already_exists') registration.step = 3;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthLayout wide>
    <div class="mb-7 flex items-center justify-between gap-4">
      <p class="text-[13px] font-medium text-ink-muted">Step {{ registration.step }} of {{ STEPS.length }}</p>
      <p v-if="!auth.isAuthenticated" class="text-[13px] text-ink-muted">
        Already registered?
        <RouterLink :to="{ name: 'login' }" class="font-medium text-brand-ink hover:underline">Sign in</RouterLink>
      </p>
      <RouterLink v-else :to="{ name: 'schools' }" class="text-[13px] font-medium text-ink-muted hover:text-ink">
        Cancel
      </RouterLink>
    </div>

    <!-- Stepper -->
    <nav aria-label="Registration progress" class="mb-8">
      <ol class="flex items-center gap-2">
        <li v-for="(step, index) in STEPS" :key="step.title" class="flex flex-1 items-center gap-2 last:flex-none">
          <button
            type="button"
            :disabled="index + 1 >= registration.step"
            :aria-current="index + 1 === registration.step ? 'step' : undefined"
            class="flex items-center gap-2 rounded-md disabled:cursor-default"
            @click="goTo(index + 1)"
          >
            <span
              :class="[
                'flex size-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold transition-colors',
                index + 1 < registration.step
                  ? 'bg-brand text-white'
                  : index + 1 === registration.step
                    ? 'bg-brand-soft text-brand-ink ring-2 ring-brand'
                    : 'bg-surface-muted text-ink-subtle',
              ]"
            >
              <Check v-if="index + 1 < registration.step" :size="14" :stroke-width="3" aria-hidden="true" />
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span
              :class="[
                'hidden text-[13px] font-medium md:inline',
                index + 1 === registration.step ? 'text-ink' : 'text-ink-muted',
              ]"
            >
              {{ step.title }}
            </span>
          </button>
          <span
            v-if="index < STEPS.length - 1"
            :class="['h-px flex-1', index + 1 < registration.step ? 'bg-brand' : 'bg-line-strong']"
            aria-hidden="true"
          />
        </li>
      </ol>
    </nav>

    <div class="rounded-panel border border-line bg-surface p-5 shadow-card sm:p-8">
      <h1 class="text-[22px] font-semibold tracking-tight">{{ current.heading }}</h1>
      <p v-if="current.intro" class="mt-1 text-[13.5px] text-ink-muted">{{ current.intro }}</p>

      <KAlert v-if="formError" tone="danger" class="mt-5">{{ formError }}</KAlert>

      <form class="mt-6" novalidate @submit.prevent="registration.step === STEPS.length ? submit() : next()">
        <InstitutionStep v-if="registration.step === 1" :errors="errors" />
        <StructureStep v-else-if="registration.step === 2" :errors="errors" />
        <AdministratorStep v-else-if="registration.step === 3" :errors="errors" />
        <PlanStep
          v-else-if="registration.step === 4"
          :errors="errors"
          :plans="plans"
          :loading="plansLoading"
          :load-error="plansError"
          @retry="loadPlans"
        />
        <ReviewStep v-else :plans="plans" @edit="goTo" />

        <div class="mt-8 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <KButton v-if="registration.step > 1" variant="ghost" :icon="ArrowLeft" :disabled="submitting" @click="back">
            Back
          </KButton>
          <span v-else />
          <KButton v-if="registration.step < STEPS.length" type="submit" :icon-right="ArrowRight">Continue</KButton>
          <KButton v-else type="submit" :loading="submitting">Create workspace</KButton>
        </div>
      </form>
    </div>
  </AuthLayout>
</template>
