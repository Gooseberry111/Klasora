<script setup lang="ts">
/**
 * Landing page for links in auth emails (sign-up confirmation). The Supabase
 * client exchanges the code in the URL for a session; we then continue to the
 * right place — finishing a pending school registration if there is one.
 */
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '@/layouts/AuthLayout.vue';
import KSpinner from '@/components/ui/KSpinner.vue';
import KButton from '@/components/ui/KButton.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const failed = ref(false);
const description = ref('');

onMounted(async () => {
  if (typeof route.query.error_description === 'string') {
    description.value = route.query.error_description;
    failed.value = true;
    return;
  }
  await auth.init();
  for (let i = 0; i < 30 && !auth.isAuthenticated; i++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!auth.isAuthenticated) {
    failed.value = true;
    return;
  }
  const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/schools';
  await router.replace(next);
});
</script>

<template>
  <AuthLayout>
    <div v-if="!failed" class="flex items-center gap-3 text-ink-muted">
      <KSpinner :size="18" /> Confirming your account…
    </div>
    <template v-else>
      <h1 class="k-page-title">We couldn't confirm this link</h1>
      <p class="mt-2 text-[14.5px] text-ink-muted">
        {{ description || 'The link may have expired or already been used.' }} Sign in to continue, or request a new
        verification email from the sign-in page.
      </p>
      <KButton class="mt-7" :to="{ name: 'login' }">Go to sign in</KButton>
    </template>
  </AuthLayout>
</template>
