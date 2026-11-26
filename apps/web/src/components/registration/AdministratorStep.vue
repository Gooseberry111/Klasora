<script setup lang="ts">
import type { FieldErrors } from '@klasora/shared';
import KInput from '@/components/ui/KInput.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import { useRegistrationStore } from '@/stores/registration';
import { useAuthStore } from '@/stores/auth';

defineProps<{ errors: FieldErrors }>();
const registration = useRegistrationStore();
const auth = useAuthStore();
const admin = registration.administrator;
</script>

<template>
  <div v-if="auth.isAuthenticated" class="rounded-card border border-line bg-surface-muted/60 p-5">
    <div class="flex items-center gap-3.5">
      <KAvatar :name="auth.displayName" :size="44" />
      <div class="min-w-0">
        <p class="font-medium">{{ auth.displayName }}</p>
        <p class="truncate text-[13px] text-ink-muted">{{ auth.user?.email }}</p>
      </div>
    </div>
    <p class="mt-4 text-[13.5px] text-ink-muted">
      You're signed in, so you'll be the School Owner of this new institution. You can invite other administrators once
      it's set up.
    </p>
  </div>

  <div v-else class="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
    <p class="text-[13.5px] text-ink-muted sm:col-span-2">
      This person becomes the School Owner, with full control of the workspace, billing and roles.
    </p>
    <KInput v-model="admin.firstName" label="First name" autocomplete="given-name" :error="errors.firstName" required />
    <KInput v-model="admin.lastName" label="Last name" autocomplete="family-name" :error="errors.lastName" required />
    <KInput
      v-model="admin.email"
      label="Your email"
      type="email"
      inputmode="email"
      autocomplete="email"
      hint="You'll sign in with this address."
      :error="errors.email"
      required
    />
    <KInput
      v-model="admin.phone"
      label="Your phone"
      type="tel"
      inputmode="tel"
      autocomplete="tel"
      :error="errors.phone"
      required
    />
    <KInput
      v-model="admin.password"
      label="Password"
      type="password"
      autocomplete="new-password"
      hint="At least 8 characters, with letters and numbers."
      :error="errors.password"
      required
    />
    <KInput
      v-model="admin.confirmPassword"
      label="Confirm password"
      type="password"
      autocomplete="new-password"
      :error="errors.confirmPassword"
      required
    />
  </div>
</template>
