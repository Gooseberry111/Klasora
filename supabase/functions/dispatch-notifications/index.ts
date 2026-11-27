// Klasora · dispatch-notifications
//
// Sends queued push notifications (Expo) and emails (Resend), then records
// each delivery as sent, retried later or failed. Run it every minute with
// Supabase Cron (see the README). It only accepts calls carrying the service
// role key, so nobody else can trigger it.
//
// Privacy: when a notification is sensitive (absences, results, messages) and
// the person has not turned on previews, the push only says there is an
// update, so nothing private appears on a lock screen.
//
// Secrets: RESEND_API_KEY and INVITE_FROM_EMAIL (optional, for email), APP_URL.

import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_ATTEMPTS = 5;
const BATCH = 100;

interface Row {
  id: string;
  channel: 'push' | 'email';
  target: string;
  attempts: number;
  notification: {
    id: string;
    title: string;
    body: string | null;
    link: string | null;
    kind: string;
    sensitive: boolean;
    visible_at: string;
    school: { name: string } | null;
    user: { push_previews: boolean } | null;
  } | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

Deno.serve(async (request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (request.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  const { data, error } = await db
    .from('notification_deliveries')
    .select('id, channel, target, attempts, notification:notifications ( id, title, body, link, kind, sensitive, visible_at, school:schools ( name ), user:profiles ( push_previews ) )')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at')
    .limit(BATCH);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const rows = (data ?? []) as unknown as Row[];

  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  const results: { id: string; ok: boolean; error?: string; dropDevice?: boolean }[] = [];

  // Push: one request to Expo for the whole batch.
  const pushes = rows.filter((r) => r.channel === 'push' && r.notification);
  if (pushes.length) {
    const messages = pushes.map((r) => {
      const n = r.notification!;
      const hidden = n.sensitive && !n.user?.push_previews;
      return {
        to: r.target,
        title: hidden ? (n.school?.name ?? 'Klasora') : n.title,
        body: hidden ? 'You have a new update. Open Klasora to see it.' : (n.body ?? ''),
        data: { link: n.link, notificationId: n.id },
        sound: 'default',
      };
    });
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      const payload = (await response.json()) as { data?: { status: string; message?: string; details?: { error?: string } }[] };
      pushes.forEach((r, i) => {
        const ticket = payload.data?.[i];
        if (ticket?.status === 'ok') results.push({ id: r.id, ok: true });
        else results.push({ id: r.id, ok: false, error: ticket?.message ?? `HTTP ${response.status}`, dropDevice: ticket?.details?.error === 'DeviceNotRegistered' });
      });
    } catch (e) {
      for (const r of pushes) results.push({ id: r.id, ok: false, error: (e as Error).message });
    }
  }

  // Email: one message each, only when an email provider is configured.
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('INVITE_FROM_EMAIL');
  for (const r of rows.filter((x) => x.channel === 'email' && x.notification)) {
    if (!apiKey || !from) {
      results.push({ id: r.id, ok: false, error: 'email_not_configured', dropDevice: false });
      continue;
    }
    const n = r.notification!;
    const link = n.link && appUrl ? `${appUrl}${n.link}` : appUrl;
    const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#F7F9FC;padding:32px">
      <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5EAF1;border-radius:16px;overflow:hidden">
        <div style="background:#14243A;padding:20px 28px;color:#fff;font-size:18px;font-weight:600">${escapeHtml(n.school?.name ?? 'Klasora')}</div>
        <div style="padding:28px">
          <p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#172033">${escapeHtml(n.title)}</p>
          <p style="margin:0 0 22px;font-size:14px;line-height:22px;color:#64748B">${escapeHtml(n.sensitive ? 'Sign in to Klasora to see the details.' : (n.body ?? ''))}</p>
          ${link ? `<a href="${link}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px">Open Klasora</a>` : ''}
          <p style="margin:22px 0 0;font-size:12px;color:#94A3B8">You can change which emails you receive in your Klasora account settings.</p>
        </div>
      </div>
    </div>`;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [r.target], subject: n.title, html }),
      });
      results.push(response.ok ? { id: r.id, ok: true } : { id: r.id, ok: false, error: `Resend ${response.status}` });
    } catch (e) {
      results.push({ id: r.id, ok: false, error: (e as Error).message });
    }
  }

  // Record outcomes: retry with increasing delays, give up after MAX_ATTEMPTS.
  for (const result of results) {
    const row = rows.find((r) => r.id === result.id)!;
    if (result.ok) {
      await db.from('notification_deliveries').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: row.attempts + 1 }).eq('id', row.id);
      continue;
    }
    const attempts = row.attempts + 1;
    const permanent = result.dropDevice || result.error === 'email_not_configured';
    await db
      .from('notification_deliveries')
      .update({
        status: permanent ? 'skipped' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        last_error: result.error?.slice(0, 500) ?? null,
        next_attempt_at: new Date(Date.now() + 2 ** attempts * 60_000).toISOString(),
      })
      .eq('id', row.id);
    if (result.dropDevice) await db.from('user_devices').delete().eq('push_token', row.target);
  }

  return new Response(JSON.stringify({ processed: results.length, sent: results.filter((r) => r.ok).length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
