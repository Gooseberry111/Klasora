<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Monitor, Moon, Sun } from 'lucide-vue-next';
import {
  newPasswordSchema,
  profileUpdateSchema,
  validate,
  type FieldErrors,
  type ThemePreference,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KCard from '@/components/ui/KCard.vue';
import KInput from '@/components/ui/KInput.vue';
import KButton from '@/components/ui/KButton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KChoiceCard from '@/components/ui/KChoiceCard.vue';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { useFeedbackStore } from '@/stores/feedback';
import { useWorkspaceStore } from '@/stores/workspace';

const auth = useAuthStore();
const theme = useThemeStore();
const feedback = useFeedbackStore();
const workspace = useWorkspaceStore();
const slug = computed(() => workspace.currentSchool?.slug ?? '');

// Profile
const profile = reactive({ firstName: '', lastName: '', phone: '' });
const profileErrors = ref<FieldErrors>({});
const profileError = ref('');
const savingProfile = ref(false);

watch(
  () => auth.profile,
  (p) => {
    profile.firstName = p?.first_name ?? '';
    profile.lastName = p?.last_name ?? '';
    profile.phone = p?.phone ?? '';
  },
  { immediate: true },
);

async function saveProfile() {
  profileError.value = '';
  const result = validate(profileUpdateSchema, { ...profile, theme: theme.mode });
  if (!result.success) {
    profileErrors.value = result.errors;
    return;
  }
  profileErrors.value = {};
  savingProfile.value = true;
  try {
    await auth.updateProfile({ firstName: result.data.firstName, lastName: result.data.lastName, phone: result.data.phone });
    feedback.success('Profile saved');
  } catch (e) {
    profileError.value = (e as Error).message;
  } finally {
    savingProfile.value = false;
  }
}

// Appearance
const themeOptions: Array<{ value: ThemePreference; title: string; description: string; icon: typeof Sun }> = [
  { value: 'light', title: 'Light', description: 'Bright, high-contrast surfaces.', icon: Sun },
  { value: 'dark', title: 'Dark', description: 'Easier on the eyes in low light.', icon: Moon },
  { value: 'system', title: 'System', description: "Follow this device's setting.", icon: Monitor },
];

async function chooseTheme(value: string) {
  const mode = value as ThemePreference;
  theme.setMode(mode);
  try {
    await auth.updateProfile({ theme: mode });
  } catch {
    feedback.info('Theme applied on this device', "We couldn't save it to your account, so other devices won't change.");
  }
}

// Password
const passwords = reactive({ password: '', confirmPassword: '' });
const passwordErrors = ref<FieldErrors>({});
const passwordError = ref('');
const savingPassword = ref(false);

async function savePassword() {
  passwordError.value = '';
  const result = validate(newPasswordSchema, passwords);
  if (!result.success) {
    passwordErrors.value = result.errors;
    return;
  }
  passwordErrors.value = {};
  savingPassword.value = true;
  try {
    await auth.updatePassword(result.data.password);
    passwords.password = '';
    passwords.confirmPassword = '';
    feedback.success('Password updated', 'Use your new password next time you sign in.');
  } catch (e) {
    passwordError.value = (e as Error).message;
  } finally {
    savingPassword.value = false;
  }
}
</script>

<template>
  <div class="max-w-3xl">
    <KPageHeader
      title="My account"
      description="Your personal details and preferences apply across every school you belong to."
      :breadcrumbs="[{ label: 'Dashboard', to: { name: 'dashboard', params: { slug } } }, { label: 'My account' }]"
    />

    <div class="space-y-6">
      <KCard title="Profile" description="How you appear to colleagues in your schools.">
        <form id="profile-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2" novalidate @submit.prevent="saveProfile">
          <KAlert v-if="profileError" tone="danger" class="sm:col-span-2">{{ profileError }}</KAlert>
          <KInput v-model="profile.firstName" label="First name" autocomplete="given-name" :error="profileErrors.firstName" required />
          <KInput v-model="profile.lastName" label="Last name" autocomplete="family-name" :error="profileErrors.lastName" required />
          <KInput :model-value="auth.user?.email ?? ''" label="Email" type="email" readonly hint="Contact support to change your sign-in email." />
          <KInput v-model="profile.phone" label="Phone" type="tel" autocomplete="tel" :error="profileErrors.phone" optional />
        </form>
        <template #footer>
          <KButton type="submit" form="profile-form" :loading="savingProfile">Save profile</KButton>
        </template>
      </KCard>

      <KCard title="Appearance" description="Saved to your account, so it follows you across devices.">
        <fieldset>
          <legend class="sr-only">Theme</legend>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KChoiceCard
              v-for="option in themeOptions"
              :key="option.value"
              name="theme"
              :value="option.value"
              :selected="theme.mode === option.value"
              :title="option.title"
              :description="option.description"
              :icon="option.icon"
              @select="chooseTheme"
            />
          </div>
        </fieldset>
      </KCard>

      <KCard title="Password" description="Use at least 8 characters, with letters and numbers.">
        <form id="password-form" class="grid grid-cols-1 gap-4 sm:grid-cols-2" novalidate @submit.prevent="savePassword">
          <KAlert v-if="passwordError" tone="danger" class="sm:col-span-2">{{ passwordError }}</KAlert>
          <KInput v-model="passwords.password" label="New password" type="password" autocomplete="new-password" :error="passwordErrors.password" required />
          <KInput
            v-model="passwords.confirmPassword"
            label="Confirm new password"
            type="password"
            autocomplete="new-password"
            :error="passwordErrors.confirmPassword"
            required
          />
        </form>
        <template #footer>
          <KButton type="submit" form="password-form" variant="secondary" :loading="savingPassword">Update password</KButton>
        </template>
      </KCard>
    </div>
  </div>
</template>
