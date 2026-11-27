// Klasora · send-invitation
//
// Emails an invitation link. The browser calls this right after
// create_invitation() returns the one time token.
//
// Security:
//   * The caller must be signed in and allowed to invite staff in the school.
//   * The token must match the stored SHA 256 hash, so this function cannot be
//     used to send arbitrary links.
//   * Email is sent through Resend. Without RESEND_API_KEY the function answers
//     { sent: false } and the app shows the link for the inviter to share.
//
// Secrets (supabase secrets set ...): RESEND_API_KEY, INVITE_FROM_EMAIL, APP_URL.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = request.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });
  const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return json({ error: 'not_signed_in' }, 401);

  let body: { invitationId?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!body.invitationId || !body.token || body.token.length > 200) return json({ error: 'invalid_body' }, 400);

  const { data: invitation } = await adminClient
    .from('invitations')
    .select('id, school_id, email, status, token_hash, expires_at, guardian_id, role:roles!invitations_role_fk ( name ), school:schools ( name )')
    .eq('id', body.invitationId)
    .maybeSingle();
  if (!invitation || invitation.status !== 'pending') return json({ error: 'not_found' }, 404);
  if ((await sha256Hex(body.token)) !== invitation.token_hash) return json({ error: 'not_found' }, 404);

  // Staff invitations need staff.create; guardian (parent portal) invitations need students.edit.
  const { data: permissions } = await userClient.rpc('get_my_permissions', { p_school_id: invitation.school_id });
  const needed = invitation.guardian_id ? 'students.edit' : 'staff.create';
  if (!Array.isArray(permissions) || !permissions.includes(needed)) return json({ error: 'forbidden' }, 403);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('INVITE_FROM_EMAIL');
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  if (!apiKey || !from || !appUrl) return json({ sent: false, reason: 'email_not_configured' });

  const school = escapeHtml((invitation.school as { name?: string } | null)?.name ?? 'your school');
  const role = escapeHtml((invitation.role as { name?: string } | null)?.name ?? 'a member');
  const link = `${appUrl}/invite/${encodeURIComponent(body.token)}`;

  const html = `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#F7F9FC;padding:32px">
    <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E5EAF1;border-radius:16px;overflow:hidden">
      <div style="background:#14243A;padding:24px 28px;color:#FFFFFF;font-size:20px;font-weight:600">Klasora</div>
      <div style="padding:28px">
        <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#172033">You're invited to join ${school}</p>
        <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#64748B">
          ${invitation.guardian_id
            ? 'You have been invited to the parent portal, where you can follow your child's progress, attendance and results.'
            : `You have been invited to Klasora as <strong>${role}</strong>.`} Accept the invitation to set up your account.
        </p>
        <a href="${link}" style="display:inline-block;background:#2563EB;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px">Accept invitation</a>
        <p style="margin:24px 0 0;font-size:12px;color:#94A3B8">This link expires in 7 days. If you were not expecting it, you can ignore this email.</p>
      </div>
    </div>
  </div>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [invitation.email], subject: `Join ${school} on Klasora`, html }),
  });
  if (!response.ok) {
    console.error('[send-invitation] email provider error', response.status, await response.text());
    return json({ sent: false, reason: 'provider_error' });
  }
  return json({ sent: true });
});
