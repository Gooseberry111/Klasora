<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { KeyRound } from 'lucide-vue-next';
import { newPasswordSchema, validate, type FieldErrors } from '@klasora/shared';
import AuthLayout from '@/layouts/AuthLayout.vue';
import KInput from '@/components/ui/KInput.vue';
import KButton from '@/components/ui/KButton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KSpinner from '@/components/ui/KSpinner.vue';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const router = useRouter();

const form = reactive({ password: '', confirmPassword: '' });
const errors = ref<FieldErrors>({});
const formError = ref('');
const submitting = ref(false);
const checking = ref(true);

onMounted(async () => {
  // The recovery link signs the user in via the URL; give the client a moment to exchange it.
  await auth.init();
  for (let i = 0; i < 20 && !auth.isAuthenticated; i++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  checking.value = false;
});

async function submit() {
  formError.value = '';
  const result = validate(newPasswordSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  errors.value = {};
  submitting.value = true;
  try {
    await auth.updatePassword(result.data.password);
    await auth.signOut();
    workspace.reset();
    await router.replace({ name: 'login', query: { reset: '1' } });
  } catch (error) {
    formError.value = (error as Error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <div v-if="checking" class="flex items-center gap-3 text-ink-muted">
      <KSpinner :size="18" /> Checking your reset link…
    </div>

    <template v-else-if="!auth.isAuthenticated">
      <h1 class="k-page-title">This link has expired</h1>
      <p class="mt-2 text-[14.5px] text-ink-muted">
        Password reset links can only be used once and expire after an hour. Request a new one to continue.
      </p>
      <KButton class="mt-7" :to="{ name: 'forgot-password' }">Request a new link</KButton>
    </template>

    <template v-else>
      <div class="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
        <KeyRound :size="22" aria-hidden="true" />
      </div>
      <h1 class="k-page-title mt-5">Choose a new password</h1>
      <p class="mt-1.5 text-[14.5px] text-ink-muted">For {{ auth.user?.email }}</p>
      <form class="mt-7 space-y-4" novalidate @submit.prevent="submit">
        <KAlert v-if="formError" tone="danger">{{ formError }}</KAlert>
        <KInput
          v-model="form.password"
          label="New password"
          type="password"
          autocomplete="new-password"
          hint="At least 8 characters, with letters and numbers."
          :error="errors.password"
          required
        />
        <KInput
          v-model="form.confirmPassword"
          label="Confirm new password"
          type="password"
          autocomplete="new-password"
          :error="errors.confirmPassword"
          required
        />
        <KButton type="submit" size="lg" block :loading="submitting">Update password</KButton>
      </form>
      <p class="mt-6 text-center text-[13px]">
        <RouterLink :to="{ name: 'login' }" class="font-medium text-ink-muted hover:text-ink">Cancel</RouterLink>
      </p>
    </template>
  </AuthLayout>
</template>
