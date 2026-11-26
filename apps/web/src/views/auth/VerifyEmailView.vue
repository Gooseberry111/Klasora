<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { MailCheck } from 'lucide-vue-next';
import AuthLayout from '@/layouts/AuthLayout.vue';
import KButton from '@/components/ui/KButton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const email = computed(() => (typeof route.query.email === 'string' ? route.query.email : ''));
const next = computed(() => (typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/auth/callback'));

const sending = ref(false);
const message = ref('');
const error = ref('');

async function resend() {
  if (!email.value) return;
  sending.value = true;
  message.value = '';
  error.value = '';
  try {
    await auth.resendVerification(email.value, next.value);
    message.value = 'We sent a new verification link. It may take a minute to arrive.';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <div class="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
      <MailCheck :size="22" aria-hidden="true" />
    </div>
    <h1 class="k-page-title mt-5">Verify your email</h1>
    <p class="mt-2 text-[14.5px] text-ink-muted">
      We've sent a verification link to
      <strong v-if="email" class="font-medium text-ink">{{ email }}</strong>
      <template v-else>your email address</template>.
      Open it on this device to activate your account. Your details are saved, so you'll continue right where you left off.
    </p>

    <KAlert v-if="message" tone="success" class="mt-6">{{ message }}</KAlert>
    <KAlert v-if="error" tone="danger" class="mt-6">{{ error }}</KAlert>

    <div class="mt-7 flex flex-wrap gap-3">
      <KButton v-if="email" variant="secondary" :loading="sending" @click="resend">Resend email</KButton>
      <KButton variant="ghost" :to="{ name: 'login' }">Back to sign in</KButton>
    </div>

    <p class="mt-8 text-[12.5px] text-ink-subtle">
      Can't find it? Check your spam folder, or
      <RouterLink :to="{ name: 'register' }" class="font-medium text-ink-muted underline-offset-2 hover:underline">start again</RouterLink>
      with a different address.
    </p>
  </AuthLayout>
</template>
