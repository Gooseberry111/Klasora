import type { Profile, ProfileUpdateInput } from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';

export async function fetchProfile(userId: string): Promise<Profile> {
  const response = await supabase.from('profiles').select('*').eq('id', userId).single();
  return unwrap(response, { fallback: "We couldn't load your profile. Please refresh the page." }) as Profile;
}

export async function updateProfile(userId: string, input: Partial<ProfileUpdateInput>): Promise<Profile> {
  const patch: Record<string, unknown> = {};
  if (input.firstName !== undefined) patch.first_name = input.firstName;
  if (input.lastName !== undefined) patch.last_name = input.lastName;
  if (input.phone !== undefined) patch.phone = input.phone || null;
  if (input.theme !== undefined) patch.theme = input.theme;

  const response = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single();
  return unwrap(response, { fallback: "We couldn't save your profile. Please try again." }) as Profile;
}

export async function saveCompletedTours(userId: string, tours: string[]): Promise<Profile> {
  const response = await supabase.from('profiles').update({ completed_tours: tours }).eq('id', userId).select('*').single();
  return unwrap(response, { fallback: "We couldn't save your progress." }) as Profile;
}
