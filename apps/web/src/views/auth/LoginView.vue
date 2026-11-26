<script setup lang="ts">
import { reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { Lock, Mail } from 'lucide-vue-next';
import { loginSchema, validate, type FieldErrors } from '@klasora/shared';
import AuthLayout from '@/layouts/AuthLayout.vue';
import KInput from '@/components/ui/KInput.vue';
import KButton from '@/components/ui/KButton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { useAuthStore } from '@/stores/auth';
import { AppError } from '@/lib/errors';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const form = reactive({ email: '', password: '' });
const errors = ref<FieldErrors>({});
const formError = ref('');
const needsVerification = ref(false);
const submitting = ref(false);
const resent = ref(false);

function safeRedirect(): string {
  const target = typeof route.query.redirect === 'string' ? route.query.redirect : '';
  // Only allow same-origin paths to prevent open redirects.
  return target.startsWith('/') && !target.startsWith('//') ? target : '/schools';
}

async function submit() {
  formError.value = '';
  needsVerification.value = false;
  const result = validate(loginSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  errors.value = {};
  submitting.value = true;
  try {
    await auth.signIn(result.data.email, result.data.password);
    await router.replace(safeRedirect());
  } catch (error) {
    const appError = error as AppError;
    needsVerification.value = appError.code === 'email_not_confirmed';
    formError.value = appError.message;
  } finally {
    submitting.value = false;
  }
}

async function resend() {
  try {
    await auth.resendVerification(form.email.trim().toLowerCase());
    resent.value = true;
  } catch (error) {
    formError.value = (error as Error).message;
  }
}
</script>

<template>
  <AuthLayout>
    <h1 class="k-page-title">Welcome back</h1>
    <p class="mt-1.5 text-[14.5px] text-ink-muted">Sign in to your Klasora account.</p>

    <KAlert v-if="route.query.reset === '1'" tone="success" class="mt-6">
      Your password has been updated. Sign in with your new password.
    </KAlert>

    <form class="mt-7 space-y-4" novalidate @submit.prevent="submit">
      <KAlert v-if="formError" tone="danger">
        {{ formError }}
        <template v-if="needsVerification">
          <button v-if="!resent" type="button" class="mt-1 block font-medium underline underline-offset-2" @click="resend">
            Resend verification email
          </button>
          <span v-else class="mt-1 block font-medium">Verification email sent. Check your inbox.</span>
        </template>
      </KAlert>

      <KInput
        v-model="form.email"
        label="Email address"
        type="email"
        autocomplete="email"
        inputmode="email"
        placeholder="you@school.com"
        :icon="Mail"
        :error="errors.email"
        required
      />
      <div>
        <KInput
          v-model="form.password"
          label="Password"
          type="password"
          autocomplete="current-password"
          :icon="Lock"
          :error="errors.password"
          required
        />
        <div class="mt-2 text-right">
          <RouterLink :to="{ name: 'forgot-password' }" class="text-[13px] font-medium text-brand-ink hover:underline">
            Forgot your password?
          </RouterLink>
        </div>
      </div>

      <KButton type="submit" size="lg" block :loading="submitting">Sign in</KButton>
    </form>

    <p class="mt-8 text-center text-[13.5px] text-ink-muted">
      New to Klasora?
      <RouterLink :to="{ name: 'register' }" class="font-medium text-brand-ink hover:underline">Register your institution</RouterLink>
    </p>
    <p class="mt-2 text-center text-[12.5px] text-ink-subtle">
      Teachers, parents and students: use the invitation link your school sent you.
    </p>
  </AuthLayout>
</template>
