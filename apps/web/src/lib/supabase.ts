import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the developer has not created `apps/web/.env.local` yet. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/** Public app URL used to build auth redirects and invitation links. */
export const appUrl = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, '');

/**
 * The single browser Supabase client. It only ever holds the public anon key;
 * every privileged rule is enforced by Postgres RLS and RPCs.
 */
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'not-configured',
  {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'klasora.auth',
    },
  },
);
