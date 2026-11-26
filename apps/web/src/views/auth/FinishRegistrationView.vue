<script setup lang="ts">
/**
 * Account activation: after the owner verifies their email, create the school
 * from the details they entered before verification (stored in user metadata).
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Building2 } from 'lucide-vue-next';
import AuthLayout from '@/layouts/AuthLayout.vue';
import KSpinner from '@/components/ui/KSpinner.vue';
import KButton from '@/components/ui/KButton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { useFeedbackStore } from '@/stores/feedback';
import { clearPendingRegistration, readPendingRegistration, registerSchool } from '@/services/registration';

const auth = useAuthStore();
const workspace = useWorkspaceStore();
const feedback = useFeedbackStore();
const router = useRouter();

const working = ref(true);
const error = ref('');
const schoolName = ref('');

async function finish() {
  working.value = true;
  error.value = '';
  const pending = readPendingRegistration(auth.user?.user_metadata);
  if (!pending) {
    await router.replace({ name: 'schools' });
    return;
  }
  schoolName.value = pending.name;
  try {
    const schoolId = await registerSchool(pending);
    await clearPendingRegistration();
    await auth.refreshSession();
    await workspace.loadMemberships(true);
    const school = workspace.schools.find((s) => s.id === schoolId);
    feedback.success('Your workspace is ready', `Welcome to Klasora, ${auth.firstName}.`);
    await router.replace(school ? { name: 'dashboard', params: { slug: school.slug } } : { name: 'schools' });
  } catch (e) {
    error.value = (e as Error).message;
    working.value = false;
  }
}

async function discard() {
  const confirmed = await feedback.confirm({
    title: 'Discard this registration?',
    description: `The details you entered for ${schoolName.value} will be removed from your account. You can register again at any time.`,
    confirmLabel: 'Discard',
  });
  if (!confirmed) return;
  try {
    await clearPendingRegistration();
    await auth.refreshSession();
    await router.replace({ name: 'schools' });
  } catch (e) {
    error.value = (e as Error).message;
  }
}

onMounted(finish);
</script>

<template>
  <AuthLayout>
    <div class="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
      <Building2 :size="22" aria-hidden="true" />
    </div>
    <h1 class="k-page-title mt-5">
      {{ working ? 'Setting up your workspace' : "We couldn't finish setting up" }}
    </h1>
    <p v-if="schoolName" class="mt-1.5 text-[14.5px] text-ink-muted">{{ schoolName }}</p>

    <div v-if="working" class="mt-7 flex items-center gap-3 text-[14px] text-ink-muted">
      <KSpinner :size="18" /> Creating your school, campus and roles…
    </div>

    <template v-else>
      <KAlert tone="danger" class="mt-6">{{ error }}</KAlert>
      <div class="mt-6 flex flex-wrap gap-3">
        <KButton @click="finish">Try again</KButton>
        <KButton variant="ghost" @click="discard">Discard registration</KButton>
      </div>
    </template>
  </AuthLayout>
</template>
