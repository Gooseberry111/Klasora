import type { InvitationPreview } from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { toAppError } from '@/lib/errors';

export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  const { data, error } = await supabase.rpc('get_invitation_preview', { p_token: token });
  if (error) throw toAppError(error, { fallback: "We couldn't check this invitation. Please try again." });
  const rows = (data ?? []) as InvitationPreview[];
  return rows[0] ?? null;
}

/** Accepts the invitation for the signed-in user and returns the school id. */
export async function acceptInvitation(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) throw toAppError(error, { fallback: "We couldn't accept this invitation. Please try again." });
  return data as string;
}
