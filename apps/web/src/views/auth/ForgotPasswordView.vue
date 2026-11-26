<script setup lang="ts">
import { reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowLeft, Mail, MailCheck } from 'lucide-vue-next';
import { forgotPasswordSchema, validate, type FieldErrors } from '@klasora/shared';
import AuthLayout from '@/layouts/AuthLayout.vue';
import KInput from '@/components/ui/KInput.vue';
import KButton from '@/components/ui/KButton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const form = reactive({ email: '' });
const errors = ref<FieldErrors>({});
const formError = ref('');
const submitting = ref(false);
const sentTo = ref('');

async function submit() {
  formError.value = '';
  const result = validate(forgotPasswordSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  errors.value = {};
  submitting.value = true;
  try {
    await auth.requestPasswordReset(result.data.email);
    sentTo.value = result.data.email;
  } catch (error) {
    formError.value = (error as Error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <RouterLink :to="{ name: 'login' }" class="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
      <ArrowLeft :size="15" aria-hidden="true" /> Back to sign in
    </RouterLink>

    <template v-if="sentTo">
      <div class="mt-8 flex size-12 items-center justify-center rounded-xl bg-success-soft text-success-ink">
        <MailCheck :size="22" aria-hidden="true" />
      </div>
      <h1 class="k-page-title mt-5">Check your email</h1>
      <p class="mt-2 text-[14.5px] text-ink-muted">
        If an account exists for <strong class="font-medium text-ink">{{ sentTo }}</strong>, we've sent a link to reset your
        password. The link expires in one hour.
      </p>
      <KButton class="mt-7" variant="secondary" @click="sentTo = ''">Use a different email</KButton>
    </template>

    <template v-else>
      <h1 class="k-page-title mt-6">Reset your password</h1>
      <p class="mt-1.5 text-[14.5px] text-ink-muted">Enter your account email and we'll send you a reset link.</p>
      <form class="mt-7 space-y-4" novalidate @submit.prevent="submit">
        <KAlert v-if="formError" tone="danger">{{ formError }}</KAlert>
        <KInput
          v-model="form.email"
          label="Email address"
          type="email"
          autocomplete="email"
          inputmode="email"
          :icon="Mail"
          :error="errors.email"
          required
        />
        <KButton type="submit" size="lg" block :loading="submitting">Send reset link</KButton>
      </form>
    </template>
  </AuthLayout>
</template>
