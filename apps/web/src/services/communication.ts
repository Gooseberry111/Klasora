/** Phase 5 data access: notifications, preferences, announcements and messaging. */
import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  Announcement,
  AnnouncementInput,
  AnnouncementReader,
  AppNotification,
  InboxRow,
  Message,
  MessagingContact,
  ModerationItem,
  NotificationKind,
  NotificationPreference,
} from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { AppError, toAppError, unwrap } from '@/lib/errors';

const FILES = 'communication-files';

// -----------------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------------
export async function listNotifications(limit = 50, unreadOnly = false): Promise<AppNotification[]> {
  let query = supabase.from('notifications').select('*').order('visible_at', { ascending: false }).limit(limit);
  if (unreadOnly) query = query.is('read_at', null);
  const response = await query;
  return unwrap(response, { fallback: "We couldn't load your notifications." }) as AppNotification[];
}

export async function unreadNotificationCount(): Promise<number> {
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return count ?? 0;
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null });
  if (error) throw toAppError(error, { fallback: "We couldn't update your notifications." });
}

/** Calls `onChange` when a notification for the signed in person arrives. */
export function watchNotifications(userId: string, onChange: () => void): RealtimeChannel {
  return supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
}

export async function listPreferences(): Promise<NotificationPreference[]> {
  const response = await supabase.from('notification_preferences').select('*');
  return unwrap(response, { fallback: "We couldn't load your notification settings." }) as NotificationPreference[];
}

export async function savePreference(userId: string, kind: NotificationKind, push: boolean, email: boolean): Promise<void> {
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, kind, push_enabled: push, email_enabled: email, updated_at: new Date().toISOString() });
  if (error) throw toAppError(error, { fallback: "We couldn't save this setting." });
}

export async function setPushPreviews(userId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ push_previews: on }).eq('id', userId);
  if (error) throw toAppError(error, { fallback: "We couldn't save this setting." });
}

// -----------------------------------------------------------------------------
// Announcements
// -----------------------------------------------------------------------------
export async function listAnnouncements(schoolId: string): Promise<Announcement[]> {
  const response = await supabase.from('announcements').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(300);
  return unwrap(response, { fallback: "We couldn't load announcements." }) as Announcement[];
}

export async function getAnnouncement(id: string): Promise<Announcement | null> {
  const { data, error } = await supabase.from('announcements').select('*').eq('id', id).maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this announcement." });
  return (data as Announcement | null) ?? null;
}

/** Announcements the person has not read yet (id set), for highlighting. */
export async function unreadAnnouncementIds(schoolId: string): Promise<Set<string>> {
  const { data } = await supabase.from('announcement_recipients').select('announcement_id').eq('school_id', schoolId).is('read_at', null);
  return new Set((data ?? []).map((r) => (r as { announcement_id: string }).announcement_id));
}

export async function unreadAnnouncementCount(schoolId: string): Promise<number> {
  const { data } = await supabase.rpc('unread_announcement_count', { p_school_id: schoolId });
  return (data as number | null) ?? 0;
}

export async function saveAnnouncementDraft(schoolId: string, input: AnnouncementInput, attachmentPaths: string[], id?: string): Promise<Announcement> {
  const row = {
    title: input.title,
    body: input.body,
    audience: input.audience,
    campus_id: input.campusId || null,
    class_ids: input.audience === 'classes' ? input.classIds : [],
    role_ids: input.audience === 'roles' ? input.roleIds : [],
    include_parents: input.includeParents,
    include_students: input.includeStudents,
    include_teachers: input.includeTeachers,
    publish_at: input.schedule && input.publishAt ? new Date(input.publishAt).toISOString() : null,
    expires_at: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
    attachment_paths: attachmentPaths,
  };
  const query = id ? supabase.from('announcements').update(row).eq('id', id) : supabase.from('announcements').insert({ school_id: schoolId, ...row });
  const response = await query.select('*').single();
  return unwrap(response, { fallback: "We couldn't save this announcement. Please check the details." }) as Announcement;
}

/** Publishes or submits for approval. Returns 'published' or 'pending'. */
export async function publishAnnouncement(id: string): Promise<'published' | 'pending'> {
  const { data, error } = await supabase.rpc('publish_announcement', { p_id: id });
  if (error) throw toAppError(error, { fallback: "We couldn't publish this announcement." });
  return data as 'published' | 'pending';
}

export async function reviewAnnouncement(id: string, approve: boolean, note = ''): Promise<void> {
  const { error } = await supabase.rpc('review_announcement', { p_id: id, p_approve: approve, p_note: note || null });
  if (error) throw toAppError(error, { fallback: "We couldn't record your review." });
}

export async function archiveAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_announcement', { p_id: id });
  if (error) throw toAppError(error, { fallback: "We couldn't archive this announcement." });
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error, count } = await supabase.from('announcements').delete({ count: 'exact' }).eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't delete this announcement." });
  if (count === 0) throw new AppError('Only drafts can be deleted. Archive published announcements instead.');
}

export async function markAnnouncementRead(id: string): Promise<void> {
  await supabase.rpc('mark_announcement_read', { p_id: id });
}

export async function announcementReaders(id: string): Promise<AnnouncementReader[]> {
  const { data, error } = await supabase.rpc('announcement_readers', { p_id: id });
  if (error) throw toAppError(error, { fallback: "We couldn't load who has read this." });
  return (data ?? []) as AnnouncementReader[];
}

// -----------------------------------------------------------------------------
// Messaging
// -----------------------------------------------------------------------------
export async function getInbox(schoolId: string): Promise<InboxRow[]> {
  const { data, error } = await supabase.rpc('get_inbox', { p_school_id: schoolId });
  if (error) throw toAppError(error, { fallback: "We couldn't load your messages." });
  return (data ?? []) as InboxRow[];
}

export async function unreadMessageCount(schoolId: string): Promise<number> {
  const { data } = await supabase.rpc('unread_message_count', { p_school_id: schoolId });
  return (data as number | null) ?? 0;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const response = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at').limit(500);
  return unwrap(response, { fallback: "We couldn't load this conversation." }) as Message[];
}

export async function messagingContacts(schoolId: string): Promise<MessagingContact[]> {
  const { data, error } = await supabase.rpc('messaging_contacts', { p_school_id: schoolId });
  if (error) throw toAppError(error, { fallback: "We couldn't load your contacts." });
  return (data ?? []) as MessagingContact[];
}

export async function startConversation(schoolId: string, recipients: string[], subject: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_conversation', {
    p_school_id: schoolId,
    p_recipients: recipients,
    p_subject: subject || null,
    p_body: body,
    p_files: [],
  });
  if (error) throw toAppError(error, { fallback: "We couldn't send your message." });
  return data as string;
}

export async function sendMessage(conversationId: string, body: string, files: string[] = []): Promise<void> {
  const { error } = await supabase.rpc('send_message', { p_conversation_id: conversationId, p_body: body, p_files: files });
  if (error) throw toAppError(error, { fallback: "We couldn't send your message." });
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
}

export function watchConversation(conversationId: string, onMessage: (m: Message) => void): RealtimeChannel {
  return supabase
    .channel(`messages:${conversationId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) =>
      onMessage(payload.new as Message),
    )
    .subscribe();
}

export async function reportMessage(messageId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('report_message', { p_message_id: messageId, p_reason: reason });
  if (error) throw toAppError(error, { fallback: "We couldn't send your report." });
}

export async function blockUser(schoolId: string, userId: string, block: boolean): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_school_id: schoolId, p_user_id: userId, p_block: block });
  if (error) throw toAppError(error, { fallback: "We couldn't update this person's status." });
}

export async function blockedUserIds(): Promise<Set<string>> {
  const { data } = await supabase.from('user_blocks').select('blocked_id');
  return new Set((data ?? []).map((r) => (r as { blocked_id: string }).blocked_id));
}

export async function moderationQueue(schoolId: string): Promise<ModerationItem[]> {
  const { data, error } = await supabase.rpc('moderation_queue', { p_school_id: schoolId });
  if (error) throw toAppError(error, { fallback: "We couldn't load reported messages." });
  return (data ?? []) as ModerationItem[];
}

export async function moderateReport(reportId: string, action: 'hide' | 'dismiss', lock: boolean): Promise<void> {
  const { error } = await supabase.rpc('moderate_report', { p_report_id: reportId, p_action: action, p_lock: lock });
  if (error) throw toAppError(error, { fallback: "We couldn't apply this decision." });
}

// -----------------------------------------------------------------------------
// Attachments
// -----------------------------------------------------------------------------
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export async function uploadCommunicationFile(folder: string, file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new AppError('Attach a PDF, Word document or an image.');
  if (file.size > 10 * 1024 * 1024) throw new AppError('Choose a file smaller than 10 MB.');
  const path = `${folder}/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._ ]/g, '_').slice(-80)}`;
  const { error } = await supabase.storage.from(FILES).upload(path, file, { contentType: file.type });
  if (error) throw new AppError("We couldn't upload this file.", 'upload_failed', error);
  return path;
}

export async function communicationFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(FILES).createSignedUrl(path, 300);
  if (error || !data) throw new AppError("We couldn't open this file.");
  return data.signedUrl;
}
