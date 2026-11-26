import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Session, User } from '@supabase/supabase-js';
import type { Profile, ProfileUpdateInput } from '@klasora/shared';
import { appUrl, isSupabaseConfigured, supabase } from '@/lib/supabase';
import { AppError, toAppError } from '@/lib/errors';
import { fetchProfile, updateProfile as updateProfileRequest } from '@/services/profile';

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null);
  const profile = ref<Profile | null>(null);
  const ready = ref(false);
  /** True after the user arrives from a password-recovery email link. */
  const recoveringPassword = ref(false);
  let initPromise: Promise<void> | null = null;

  const user = computed<User | null>(() => session.value?.user ?? null);
  const isAuthenticated = computed(() => Boolean(session.value));
  const displayName = computed(() => {
    const p = profile.value;
    const name = p ? `${p.first_name} ${p.last_name}`.trim() : '';
    return name || user.value?.email || 'there';
  });
  const firstName = computed(() => profile.value?.first_name || displayName.value.split(' ')[0] || 'there');

  async function loadProfile() {
    if (!user.value) {
      profile.value = null;
      return;
    }
    try {
      profile.value = await fetchProfile(user.value.id);
    } catch {
      // The profile is created by a database trigger; if it is momentarily
      // unavailable we keep the session and fall back to the auth email.
      profile.value = null;
    }
  }

  /** Resolves the persisted session once and subscribes to auth changes. */
  function init(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!isSupabaseConfigured) {
        ready.value = true;
        return;
      }
      const { data } = await supabase.auth.getSession();
      session.value = data.session;
      await loadProfile();

      supabase.auth.onAuthStateChange((event, next) => {
        const previousUserId = session.value?.user.id;
        session.value = next;
        if (event === 'PASSWORD_RECOVERY') recoveringPassword.value = true;
        if (event === 'SIGNED_OUT') {
          profile.value = null;
          recoveringPassword.value = false;
        }
        if (next && next.user.id !== previousUserId) {
          // Defer: Supabase recommends not awaiting other calls inside this callback.
          setTimeout(() => void loadProfile(), 0);
        }
      });
      ready.value = true;
    })();
    return initPromise;
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw toAppError(error, { fallback: "We couldn't sign you in. Please try again." });
    session.value = data.session;
    await loadProfile();
  }

  /**
   * Creates an account. Returns the session when email confirmation is
   * disabled, or null when the user must verify their email first.
   */
  async function signUp(params: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    redirectPath: string;
    extraMetadata?: Record<string, unknown>;
  }): Promise<Session | null> {
    const { data, error } = await supabase.auth.signUp({
      email: params.email,
      password: params.password,
      options: {
        emailRedirectTo: `${appUrl}${params.redirectPath}`,
        data: {
          first_name: params.firstName,
          last_name: params.lastName,
          phone: params.phone ?? null,
          ...params.extraMetadata,
        },
      },
    });
    if (error) throw toAppError(error, { fallback: "We couldn't create your account. Please try again." });
    // With confirmations on, Supabase hides whether an email is taken by
    // returning a user with no identities. Tell the person what to do next.
    if (data.user && data.user.identities?.length === 0) {
      throw new AppError('An account with this email already exists. Sign in instead, then continue.', 'user_already_exists');
    }
    session.value = data.session;
    if (data.session) await loadProfile();
    return data.session;
  }

  async function resendVerification(email: string, redirectPath = '/auth/callback') {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${appUrl}${redirectPath}` },
    });
    if (error) throw toAppError(error, { fallback: "We couldn't resend the verification email. Please try again shortly." });
  }

  async function requestPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/reset-password` });
    if (error) throw toAppError(error, { fallback: "We couldn't send the reset email. Please try again shortly." });
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw toAppError(error, { fallback: "We couldn't update your password. Please try again." });
    recoveringPassword.value = false;
  }

  async function refreshSession() {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) session.value = data.session;
  }

  async function updateProfile(input: Partial<ProfileUpdateInput>) {
    if (!user.value) throw new AppError('Please sign in again.');
    profile.value = await updateProfileRequest(user.value.id, input);
  }

  async function signOut() {
    await supabase.auth.signOut();
    session.value = null;
    profile.value = null;
  }

  return {
    session,
    profile,
    ready,
    recoveringPassword,
    user,
    isAuthenticated,
    displayName,
    firstName,
    init,
    signIn,
    signUp,
    resendVerification,
    requestPasswordReset,
    updatePassword,
    refreshSession,
    updateProfile,
    loadProfile,
    signOut,
  };
});
