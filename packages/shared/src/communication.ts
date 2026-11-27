/** Phase 5: notifications, announcements and messaging. */
import { z } from 'zod';

type Uuid = string;
type Timestamp = string;

export const NOTIFICATION_KINDS = ['announcement', 'message', 'absence', 'assignment', 'result', 'report_card', 'general'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, { label: string; description: string }> = {
  announcement: { label: 'Announcements', description: 'New announcements from your school.' },
  message: { label: 'Messages', description: 'When someone sends you a message.' },
  absence: { label: 'Absences', description: 'When your child is marked absent.' },
  assignment: { label: 'Assignments', description: 'When new homework or projects are set.' },
  result: { label: 'Results', description: 'When results are published.' },
  report_card: { label: 'Report cards', description: 'When a report card is ready.' },
  general: { label: 'School updates', description: 'Approvals, reports and other updates.' },
};

/** Defaults when a person has not chosen: push for everything, email for announcements and report cards. */
export function defaultChannels(kind: NotificationKind) {
  return { push: true, email: kind === 'announcement' || kind === 'report_card' };
}

export interface AppNotification {
  id: Uuid;
  school_id: Uuid | null;
  user_id: Uuid;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  related_id: Uuid | null;
  sensitive: boolean;
  visible_at: Timestamp;
  read_at: Timestamp | null;
  created_at: Timestamp;
}

export interface NotificationPreference {
  user_id: Uuid;
  kind: NotificationKind;
  push_enabled: boolean;
  email_enabled: boolean;
}

// -----------------------------------------------------------------------------
// Announcements
// -----------------------------------------------------------------------------
export const ANNOUNCEMENT_AUDIENCES = ['everyone', 'staff', 'parents', 'students', 'classes', 'roles'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];
export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, { label: string; description: string }> = {
  everyone: { label: 'Everyone', description: 'All staff, parents and students.' },
  staff: { label: 'Staff', description: 'Teachers and every other member of staff.' },
  parents: { label: 'Parents and guardians', description: 'Everyone using the parent portal.' },
  students: { label: 'Students', description: 'Students with portal accounts.' },
  classes: { label: 'Chosen classes', description: 'Parents, students and teachers of specific classes.' },
  roles: { label: 'Chosen roles', description: 'For example only bursars, or only principals.' },
};

export type AnnouncementStatus = 'draft' | 'pending' | 'published' | 'archived';
export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  draft: 'Draft',
  pending: 'Waiting for approval',
  published: 'Published',
  archived: 'Archived',
};

export interface Announcement {
  id: Uuid;
  school_id: Uuid;
  title: string;
  body: string;
  attachment_paths: string[];
  audience: AnnouncementAudience;
  campus_id: Uuid | null;
  class_ids: Uuid[];
  role_ids: Uuid[];
  include_parents: boolean;
  include_students: boolean;
  include_teachers: boolean;
  publish_at: Timestamp | null;
  expires_at: Timestamp | null;
  status: AnnouncementStatus;
  review_note: string | null;
  author_id: Uuid | null;
  approved_by: Uuid | null;
  published_at: Timestamp | null;
  recipient_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AnnouncementReader {
  user_id: Uuid;
  first_name: string;
  last_name: string;
  audience_role: string | null;
  read_at: Timestamp | null;
}

export const announcementSchema = z
  .object({
    title: z.string().trim().min(1, { error: 'Give the announcement a title.' }).max(200),
    body: z.string().trim().min(1, { error: 'Write the announcement.' }).max(20000),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    campusId: z.string(),
    classIds: z.array(z.string()),
    roleIds: z.array(z.string()),
    includeParents: z.boolean(),
    includeStudents: z.boolean(),
    includeTeachers: z.boolean(),
    schedule: z.boolean(),
    publishAt: z.string(),
    expiresAt: z.string(),
  })
  .refine((v) => v.audience !== 'classes' || v.classIds.length > 0, { error: 'Choose at least one class.', path: ['classIds'] })
  .refine((v) => v.audience !== 'roles' || v.roleIds.length > 0, { error: 'Choose at least one role.', path: ['roleIds'] })
  .refine((v) => v.audience !== 'classes' || v.includeParents || v.includeStudents || v.includeTeachers, {
    error: 'Choose who in those classes should receive it.',
    path: ['classIds'],
  })
  .refine((v) => !v.schedule || (v.publishAt !== '' && new Date(v.publishAt) > new Date()), {
    error: 'Choose a time in the future.',
    path: ['publishAt'],
  })
  .refine((v) => v.expiresAt === '' || new Date(v.expiresAt) > (v.schedule && v.publishAt ? new Date(v.publishAt) : new Date()), {
    error: 'The expiry must be after the announcement goes out.',
    path: ['expiresAt'],
  });
export type AnnouncementInput = z.infer<typeof announcementSchema>;

// -----------------------------------------------------------------------------
// Messaging
// -----------------------------------------------------------------------------
export interface ConversationParticipant {
  user_id: Uuid;
  name: string;
  avatar_url: string | null;
  last_read_at: Timestamp | null;
}

/** Row from `get_inbox`. */
export interface InboxRow {
  conversation_id: Uuid;
  kind: 'direct' | 'group';
  subject: string | null;
  is_locked: boolean;
  last_message_at: Timestamp;
  last_body: string | null;
  last_sender_id: Uuid | null;
  unread_count: number;
  participants: ConversationParticipant[];
}

export interface Message {
  id: Uuid;
  school_id: Uuid;
  conversation_id: Uuid;
  sender_id: Uuid | null;
  body: string | null;
  attachment_paths: string[];
  hidden_at: Timestamp | null;
  hidden_by: Uuid | null;
  created_at: Timestamp;
}

/** Row from `messaging_contacts`. */
export interface MessagingContact {
  user_id: Uuid;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  description: string | null;
}

/** Row from `moderation_queue`. */
export interface ModerationItem {
  report_id: Uuid;
  message_id: Uuid;
  conversation_id: Uuid;
  body: string | null;
  sender_name: string | null;
  reporter_name: string | null;
  reason: string;
  status: 'open' | 'hidden' | 'dismissed';
  is_locked: boolean;
  created_at: Timestamp;
}

/** "Just now", "5 min", "3 h", "Yesterday", "Mon", or a date: for lists. */
export function relativeTime(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && then.getDate() === now.getDate()) return `${hours} h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (now.getTime() - then.getTime() < 6 * 86_400_000) return then.toLocaleDateString('en-NG', { weekday: 'short' });
  return then.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}
