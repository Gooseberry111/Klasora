<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MailWarning, UserPlus } from 'lucide-vue-next';
import { inviteeSignUpSchema, validate, type FieldErrors, type InvitationPreview } from '@klasora/shared';
import AuthLayout from '@/layouts/AuthLayout.vue';
import KButton from '@/components/ui/KButton.vue';
import KInput from '@/components/ui/KInput.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { useFeedbackStore } from '@/stores/feedback';
import { acceptInvitation, previewInvitation } from '@/services/invitations';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const workspace = useWorkspaceStore();
const feedback = useFeedbackStore();

const token = computed(() => String(route.params.token ?? ''));
const invitePath = computed(() => `/invite/${encodeURIComponent(token.value)}`);

const loading = ref(true);
const loadError = ref('');
const preview = ref<InvitationPreview | null>(null);
const accepting = ref(false);
const actionError = ref('');
const mode = ref<'choose' | 'signup'>('choose');

const form = reactive({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
const errors = ref<FieldErrors>({});
const signingUp = ref(false);

const emailMatches = computed(
  () => preview.value && auth.user?.email?.toLowerCase() === preview.value.email.toLowerCase(),
);
const expiresOn = computed(() =>
  preview.value ? new Date(preview.value.expires_at).toLocaleDateString('en-NG', { dateStyle: 'medium' }) : '',
);

onMounted(async () => {
  try {
    preview.value = await previewInvitation(token.value);
    if (preview.value) form.email = preview.value.email;
  } catch (error) {
    loadError.value = (error as Error).message;
  } finally {
    loading.value = false;
  }
});

async function accept() {
  accepting.value = true;
  actionError.value = '';
  try {
    const schoolId = await acceptInvitation(token.value);
    await workspace.loadMemberships(true);
    const school = workspace.schools.find((s) => s.id === schoolId);
    feedback.success(`You've joined ${preview.value?.school_name ?? 'the school'}`);
    await router.replace(school ? { name: 'dashboard', params: { slug: school.slug } } : { name: 'schools' });
  } catch (error) {
    actionError.value = (error as Error).message;
  } finally {
    accepting.value = false;
  }
}

async function signUp() {
  actionError.value = '';
  const result = validate(inviteeSignUpSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  errors.value = {};
  signingUp.value = true;
  try {
    const session = await auth.signUp({
      email: result.data.email,
      password: result.data.password,
      firstName: result.data.firstName,
      lastName: result.data.lastName,
      redirectPath: `/auth/callback?next=${encodeURIComponent(invitePath.value)}`,
    });
    if (session) await accept();
    else await router.replace({ name: 'verify-email', query: { email: result.data.email, next: invitePath.value } });
  } catch (error) {
    actionError.value = (error as Error).message;
  } finally {
    signingUp.value = false;
  }
}

async function switchAccount() {
  await auth.signOut();
  workspace.reset();
  await router.replace({ name: 'login', query: { redirect: invitePath.value } });
}
</script>

<template>
  <AuthLayout>
    <div v-if="loading" class="space-y-4"><KSkeleton line-class="h-7 w-2/3" /><KSkeleton :lines="3" /></div>

    <KAlert v-else-if="loadError" tone="danger">{{ loadError }}</KAlert>

    <template v-else-if="!preview">
      <div class="flex size-12 items-center justify-center rounded-xl bg-warning-soft text-warning-ink">
        <MailWarning :size="22" aria-hidden="true" />
      </div>
      <h1 class="k-page-title mt-5">This invitation link isn't valid</h1>
      <p class="mt-2 text-[14.5px] text-ink-muted">
        Check that you opened the full link from your invitation email, or ask the school to send a new invitation.
      </p>
    </template>

    <template v-else-if="preview.status !== 'pending'">
      <div class="flex size-12 items-center justify-center rounded-xl bg-warning-soft text-warning-ink">
        <MailWarning :size="22" aria-hidden="true" />
      </div>
      <h1 class="k-page-title mt-5">
        {{ preview.status === 'accepted' ? 'Invitation already accepted' : 'This invitation is no longer active' }}
      </h1>
      <p class="mt-2 text-[14.5px] text-ink-muted">
        <template v-if="preview.status === 'accepted'">Sign in to open {{ preview.school_name }}.</template>
        <template v-else>
          It has {{ preview.status === 'expired' ? 'expired' : 'been withdrawn' }}. Ask {{ preview.school_name }} to send you a
          new invitation.
        </template>
      </p>
      <KButton class="mt-7" :to="{ name: auth.isAuthenticated ? 'schools' : 'login' }">
        {{ auth.isAuthenticated ? 'Go to my schools' : 'Sign in' }}
      </KButton>
    </template>

    <template v-else>
      <div class="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
        <UserPlus :size="22" aria-hidden="true" />
      </div>
      <p class="mt-5 text-[13px] font-medium text-brand-ink">You've been invited</p>
      <h1 class="k-page-title mt-1">Join {{ preview.school_name }}</h1>
      <p class="mt-2 text-[14.5px] text-ink-muted">
        as <strong class="font-medium text-ink">{{ preview.role_name }}</strong>. This invitation was sent to
        <strong class="font-medium text-ink">{{ preview.email }}</strong> and expires on {{ expiresOn }}.
      </p>

      <KAlert v-if="actionError" tone="danger" class="mt-6">{{ actionError }}</KAlert>

      <!-- Signed in with the invited address -->
      <div v-if="auth.isAuthenticated && emailMatches" class="mt-7">
        <KButton size="lg" block :loading="accepting" @click="accept">Accept invitation</KButton>
      </div>

      <!-- Signed in with another address -->
      <div v-else-if="auth.isAuthenticated" class="mt-7 space-y-4">
        <KAlert tone="warning">
          You're signed in as {{ auth.user?.email }}. Sign in with {{ preview.email }} to accept this invitation.
        </KAlert>
        <KButton block variant="secondary" @click="switchAccount">Sign in with a different account</KButton>
      </div>

      <!-- Signed out -->
      <template v-else>
        <div v-if="mode === 'choose'" class="mt-7 space-y-3">
          <KButton size="lg" block @click="mode = 'signup'">Create my account</KButton>
          <KButton size="lg" block variant="secondary" :to="{ name: 'login', query: { redirect: invitePath } }">
            I already have an account
          </KButton>
        </div>

        <form v-else class="mt-7 space-y-4" novalidate @submit.prevent="signUp">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KInput v-model="form.firstName" label="First name" autocomplete="given-name" :error="errors.firstName" required />
            <KInput v-model="form.lastName" label="Last name" autocomplete="family-name" :error="errors.lastName" required />
          </div>
          <KInput v-model="form.email" label="Email" type="email" readonly hint="Invitations are tied to this address." />
          <KInput
            v-model="form.password"
            label="Password"
            type="password"
            autocomplete="new-password"
            hint="At least 8 characters, with letters and numbers."
            :error="errors.password"
            required
          />
          <KInput
            v-model="form.confirmPassword"
            label="Confirm password"
            type="password"
            autocomplete="new-password"
            :error="errors.confirmPassword"
            required
          />
          <KButton type="submit" size="lg" block :loading="signingUp">Create account and join</KButton>
          <KButton variant="ghost" block @click="mode = 'choose'">Back</KButton>
        </form>
      </template>
    </template>
  </AuthLayout>
</template>
