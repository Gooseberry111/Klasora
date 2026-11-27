/**
 * Phase 5: notifications, announcements and messaging. Covers who hears
 * about what, who can message whom, and that private conversations stay
 * private even from moderators.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

type User = { id: string; email: string };

let db: TestDatabase;
let owner: User;
let principal: User;
let teacherA: User;
let teacherB: User;
let parentA: User;
let parentB: User;
let studentUser: User;
let outsider: User;
let schoolId: string;
let classA: string;
let classB: string;
let maths: string;
let ada: string;
let bola: string;

const today = new Date().toISOString().slice(0, 10);

async function membership(userId: string) {
  const [row] = await db.admin<{ id: string }>(`select id from public.school_memberships where school_id = $1 and user_id = $2`, [schoolId, userId]);
  return row!.id;
}

async function register(first: string, classId: string, guardianEmail: string) {
  const [row] = await db.rows<{ id: string }>(
    owner.id,
    `select public.register_student($1, $2::jsonb, null, $3::jsonb, $4) as id`,
    [schoolId, JSON.stringify({ first_name: first, last_name: 'Test', admission_date: '2026-09-01' }),
      JSON.stringify([{ first_name: 'Parent', last_name: first, email: guardianEmail, relationship: 'mother' }]), classId],
  );
  return row!.id;
}

async function linkGuardian(studentId: string, email: string) {
  const user = await db.createUser({ email });
  const [g] = await db.admin<{ guardian_id: string }>(`select guardian_id from public.student_guardians where student_id = $1`, [studentId]);
  const [invite] = await db.rows<{ token: string }>(owner.id, `select token from public.invite_guardian($1)`, [g!.guardian_id]);
  await db.rows(user.id, `select public.accept_invitation($1)`, [invite!.token]);
  return user;
}

const notificationsFor = (userId: string, kind?: string) =>
  db.admin<{ id: string; title: string; sensitive: boolean; visible_at: string }>(
    `select id, title, sensitive, visible_at from public.notifications where user_id = $1 ${kind ? 'and kind = $2' : ''} order by created_at`,
    kind ? [userId, kind] : [userId],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await db.createUser();
  schoolId = await db.registerSchool(owner.id, { name: 'Harmony School', planCode: 'growth' });
  principal = await db.addMember(owner.id, schoolId, 'principal');
  teacherA = await db.addMember(owner.id, schoolId, 'teacher');
  teacherB = await db.addMember(owner.id, schoolId, 'teacher');
  outsider = await db.createUser();
  await db.registerSchool(outsider.id, { name: 'Elsewhere' });

  const campus = (await db.admin<{ id: string }>(`select id from public.campuses where school_id = $1`, [schoolId]))[0]!.id;
  classA = (await db.rows<{ id: string }>(owner.id, `insert into public.classes (school_id, campus_id, name, class_teacher_membership_id) values ($1, $2, 'Primary 4A', $3) returning id`, [schoolId, campus, await membership(teacherA.id)]))[0]!.id;
  classB = (await db.rows<{ id: string }>(owner.id, `insert into public.classes (school_id, campus_id, name, class_teacher_membership_id) values ($1, $2, 'Primary 4B', $3) returning id`, [schoolId, campus, await membership(teacherB.id)]))[0]!.id;
  maths = (await db.rows<{ id: string }>(owner.id, `insert into public.subjects (school_id, name, code) values ($1, 'Mathematics', 'MTH') returning id`, [schoolId]))[0]!.id;

  ada = await register('Ada', classA, 'mum.ada@example.com');
  bola = await register('Bola', classB, 'mum.bola@example.com');
  parentA = await linkGuardian(ada, 'mum.ada@example.com');
  parentB = await linkGuardian(bola, 'mum.bola@example.com');

  studentUser = await db.createUser({ email: 'ada@example.com' });
  const [invite] = await db.rows<{ token: string }>(owner.id, `select token from public.invite_student($1, 'ada@example.com')`, [ada]);
  await db.rows(studentUser.id, `select public.accept_invitation($1)`, [invite!.token]);
});

describe('notifications from school events', () => {
  it('tells guardians about an absence when the register is submitted', async () => {
    await db.rows(teacherA.id, `select public.save_attendance($1, $2, 'daily', null, $3::jsonb, false)`, [classA, today, JSON.stringify([{ student_id: ada, status: 'absent' }])]);
    expect(await notificationsFor(parentA.id, 'absence')).toHaveLength(0);
    await db.rows(teacherA.id, `select public.save_attendance($1, $2, 'daily', null, $3::jsonb, true)`, [classA, today, JSON.stringify([{ student_id: ada, status: 'absent', remarks: 'No word from home' }])]);
    const [n] = await notificationsFor(parentA.id, 'absence');
    expect(n!.title).toBe('Ada was marked absent');
    expect(n!.sensitive).toBe(true);
    expect(await notificationsFor(parentB.id, 'absence')).toHaveLength(0);
  });

  it('tells students and guardians about new assignments', async () => {
    await db.rows(teacherA.id, `insert into public.assignments (school_id, class_id, subject_id, title, due_at, status) values ($1, $2, $3, 'Times tables', now() + interval '1 day', 'published')`, [schoolId, classA, maths]);
    expect(await notificationsFor(studentUser.id, 'assignment')).toHaveLength(1);
    expect(await notificationsFor(parentA.id, 'assignment')).toHaveLength(1);
    expect(await notificationsFor(parentB.id, 'assignment')).toHaveLength(0);
  });

  it('shows people only their own notifications and lets them mark them read', async () => {
    const mine = await db.rows<{ id: string }>(parentA.id, `select id from public.notifications`);
    expect(mine.length).toBeGreaterThan(0);
    expect(await db.rows(parentB.id, `select 1 from public.notifications where user_id = $1`, [parentA.id])).toHaveLength(0);
    const [count] = await db.rows<{ n: number }>(parentA.id, `select public.mark_notifications_read() as n`);
    expect(count!.n).toBe(mine.length);
    await expectSqlError(db.rows(parentA.id, `update public.notifications set title = 'x'`), '42501');
  });

  it('queues push and email copies according to preferences', async () => {
    await db.rows(parentA.id, `select public.register_device('android', 'ExponentPushToken[abc]', 'Pixel')`);
    await db.rows(parentA.id, `insert into public.notification_preferences (user_id, kind, push_enabled, email_enabled) values ($1, 'assignment', false, false)`, [parentA.id]);
    await db.rows(teacherA.id, `insert into public.assignments (school_id, class_id, subject_id, title, due_at, status) values ($1, $2, $3, 'Spelling', now() + interval '1 day', 'published')`, [schoolId, classA, maths]);
    const deliveries = await db.admin<{ channel: string; kind: string }>(
      `select d.channel, n.kind from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where n.user_id = $1`,
      [parentA.id],
    );
    expect(deliveries.filter((d) => d.kind === 'assignment')).toHaveLength(0);
    await expectSqlError(db.rows(parentB.id, `insert into public.notification_preferences (user_id, kind) values ($1, 'absence')`, [parentA.id]), '42501');
  });
});

describe('announcements', () => {
  async function draft(userId: string, fields: Record<string, unknown>) {
    const [row] = await db.rows<{ id: string }>(
      userId,
      `insert into public.announcements (school_id, title, body, audience, class_ids, publish_at)
       values ($1, $2, 'Details here', $3, $4::uuid[], $5) returning id`,
      [schoolId, fields.title ?? 'Notice', fields.audience ?? 'everyone', fields.classIds ?? [], fields.publishAt ?? null],
    );
    return row!.id;
  }
  const publish = async (userId: string, id: string) => (await db.rows<{ s: string }>(userId, `select public.publish_announcement($1) as s`, [id]))[0]!.s;

  it('lets a teacher publish straight to their own class', async () => {
    const id = await draft(teacherA.id, { title: 'Class trip', audience: 'classes', classIds: [classA] });
    expect(await publish(teacherA.id, id)).toBe('published');
    const recipients = await db.admin<{ user_id: string }>(`select user_id from public.announcement_recipients where announcement_id = $1`, [id]);
    const ids = recipients.map((r) => r.user_id);
    expect(ids).toContain(parentA.id);
    expect(ids).toContain(studentUser.id);
    expect(ids).not.toContain(parentB.id);
    expect(await db.rows(parentA.id, `select 1 from public.announcements where id = $1`, [id])).toHaveLength(1);
    expect(await db.rows(parentB.id, `select 1 from public.announcements where id = $1`, [id])).toHaveLength(0);
  });

  it('sends wider announcements from teachers for approval first', async () => {
    const id = await draft(teacherA.id, { title: 'Sports day', audience: 'everyone' });
    expect(await publish(teacherA.id, id)).toBe('pending');
    expect(await db.rows(parentB.id, `select 1 from public.announcements where id = $1`, [id])).toHaveLength(0);
    expect((await notificationsFor(principal.id, 'general')).some((n) => n.title === 'Announcement waiting for approval')).toBe(true);
    await expectSqlError(db.rows(principal.id, `select public.review_announcement($1, false, '')`, [id]), 'KL400');
    await db.rows(principal.id, `select public.review_announcement($1, true)`, [id]);
    expect(await db.rows(parentB.id, `select 1 from public.announcements where id = $1`, [id])).toHaveLength(1);
    expect(await db.rows(outsider.id, `select 1 from public.announcements where id = $1`, [id])).toHaveLength(0);
  });

  it('keeps scheduled announcements hidden until their time', async () => {
    const id = await draft(principal.id, { title: 'Resumption date', publishAt: new Date(Date.now() + 3_600_000).toISOString() });
    await publish(principal.id, id);
    expect(await db.rows(parentA.id, `select 1 from public.announcements where id = $1`, [id])).toHaveLength(0);
    expect(await db.rows(parentA.id, `select 1 from public.notifications where related_id = $1`, [id])).toHaveLength(0);
    expect((await db.admin(`select 1 from public.notifications where related_id = $1 and user_id = $2`, [id, parentA.id]))).toHaveLength(1);
  });

  it('tracks who has read an announcement', async () => {
    const id = await draft(principal.id, { title: 'PTA meeting' });
    await publish(principal.id, id);
    await db.rows(parentA.id, `select public.mark_announcement_read($1)`, [id]);
    const readers = await db.rows<{ user_id: string; read_at: string | null }>(principal.id, `select * from public.announcement_readers($1)`, [id]);
    expect(readers.find((r) => r.user_id === parentA.id)?.read_at).toBeTruthy();
    expect(readers.find((r) => r.user_id === parentB.id)?.read_at).toBeNull();
    await expectSqlError(db.rows(parentA.id, `select * from public.announcement_readers($1)`, [id]), 'KL404');
  });

  it('stops parents from writing announcements', async () => {
    await expectSqlError(draft(parentA.id, {}), '42501');
  });
});

describe('messaging', () => {
  let conversation: string;
  let firstMessage: string;

  it('offers parents only the right people to contact', async () => {
    const contacts = await db.rows<{ user_id: string; description: string }>(parentA.id, `select * from public.messaging_contacts($1)`, [schoolId]);
    const ids = contacts.map((c) => c.user_id);
    expect(ids).toContain(teacherA.id);
    expect(ids).toContain(owner.id);
    expect(ids).toContain(principal.id);
    expect(ids).not.toContain(teacherB.id);
    expect(ids).not.toContain(parentB.id);
    const forTeacher = await db.rows<{ user_id: string; description: string }>(teacherA.id, `select * from public.messaging_contacts($1)`, [schoolId]);
    expect(forTeacher.find((c) => c.user_id === parentA.id)?.description).toBe('Parent of Ada Test');
    expect(forTeacher.map((c) => c.user_id)).not.toContain(parentB.id);
  });

  it('lets a parent message their child\'s teacher, and nobody else read it', async () => {
    await expectSqlError(db.rows(parentA.id, `select public.start_conversation($1, array[$2]::uuid[], null, 'Hello')`, [schoolId, teacherB.id]), 'KL403');
    await expectSqlError(db.rows(parentA.id, `select public.start_conversation($1, array[$2, $3]::uuid[], null, 'Hi all')`, [schoolId, teacherA.id, owner.id]), 'KL403');
    const [row] = await db.rows<{ id: string }>(parentA.id, `select public.start_conversation($1, array[$2]::uuid[], 'Homework', 'Is there homework today?') as id`, [schoolId, teacherA.id]);
    conversation = row!.id;
    const [again] = await db.rows<{ id: string }>(parentA.id, `select public.start_conversation($1, array[$2]::uuid[], null, 'One more thing') as id`, [schoolId, teacherA.id]);
    expect(again!.id).toBe(conversation);

    const [count] = await db.rows<{ n: number }>(teacherA.id, `select public.unread_message_count($1) as n`, [schoolId]);
    expect(count!.n).toBe(2);
    expect(await notificationsFor(teacherA.id, 'message')).toHaveLength(2);
    expect(await db.rows(parentB.id, `select 1 from public.messages where conversation_id = $1`, [conversation])).toHaveLength(0);
    expect(await db.rows(principal.id, `select 1 from public.messages where conversation_id = $1`, [conversation])).toHaveLength(0);

    await db.rows(teacherA.id, `select public.mark_conversation_read($1)`, [conversation]);
    const [after] = await db.rows<{ n: number }>(teacherA.id, `select public.unread_message_count($1) as n`, [schoolId]);
    expect(after!.n).toBe(0);
    const [inbox] = await db.rows<{ unread_count: number; participants: { user_id: string }[] }>(parentA.id, `select * from public.get_inbox($1)`, [schoolId]);
    expect(inbox!.participants).toHaveLength(2);
    firstMessage = (await db.admin<{ id: string }>(`select id from public.messages where conversation_id = $1 order by created_at limit 1`, [conversation]))[0]!.id;
  });

  it('lets students message their own teachers only', async () => {
    await db.rows(studentUser.id, `select public.start_conversation($1, array[$2]::uuid[], null, 'Question about fractions')`, [schoolId, teacherA.id]);
    await expectSqlError(db.rows(studentUser.id, `select public.start_conversation($1, array[$2]::uuid[], null, 'Hi')`, [schoolId, teacherB.id]), 'KL403');
    await expectSqlError(db.rows(studentUser.id, `select public.start_conversation($1, array[$2]::uuid[], null, 'Hi')`, [schoolId, parentB.id]), 'KL403');
  });

  it('lets moderators act on a reported message without reading the conversation', async () => {
    await db.rows(teacherA.id, `select public.report_message($1, 'Rude language')`, [firstMessage]);
    const queue = await db.rows<{ message_id: string; body: string; status: string }>(principal.id, `select * from public.moderation_queue($1)`, [schoolId]);
    expect(queue[0]).toMatchObject({ message_id: firstMessage, body: 'Is there homework today?', status: 'open' });
    await expectSqlError(db.rows(teacherA.id, `select * from public.moderation_queue($1)`, [schoolId]), 'KL403');
    const [report] = await db.admin<{ id: string }>(`select id from public.message_reports where message_id = $1`, [firstMessage]);
    await db.rows(principal.id, `select public.moderate_report($1, 'hide', true)`, [report!.id]);
    const [msg] = await db.rows<{ body: string | null; hidden_at: string }>(parentA.id, `select body, hidden_at from public.messages where id = $1`, [firstMessage]);
    expect(msg!.body).toBeNull();
    expect(msg!.hidden_at).toBeTruthy();
    await expectSqlError(db.rows(parentA.id, `select public.send_message($1, 'Hello?')`, [conversation]), 'KL409');
  });

  it('stops a blocked person from messaging', async () => {
    await db.rows(teacherA.id, `select public.block_user($1, $2, true)`, [schoolId, studentUser.id]);
    const contacts = await db.rows<{ user_id: string }>(studentUser.id, `select * from public.messaging_contacts($1)`, [schoolId]);
    expect(contacts.map((c) => c.user_id)).not.toContain(teacherA.id);
    const [conv] = await db.admin<{ conversation_id: string }>(
      `select p.conversation_id from public.conversation_participants p join public.conversation_participants q on q.conversation_id = p.conversation_id
       where p.user_id = $1 and q.user_id = $2`,
      [studentUser.id, teacherA.id],
    );
    await expectSqlError(db.rows(studentUser.id, `select public.send_message($1, 'Hello?')`, [conv!.conversation_id]), 'KL403');
  });

  it('keeps message attachments to participants', async () => {
    const [conv] = await db.admin<{ id: string }>(
      `select c.id from public.conversations c join public.conversation_participants p on p.conversation_id = c.id where p.user_id = $1 and not c.is_locked limit 1`,
      [studentUser.id],
    );
    await db.rows(teacherA.id, `insert into storage.objects (bucket_id, name) values ('communication-files', $1)`, [`${schoolId}/messages/${conv!.id}/notes.pdf`]);
    await expectSqlError(
      db.rows(parentB.id, `insert into storage.objects (bucket_id, name) values ('communication-files', $1)`, [`${schoolId}/messages/${conv!.id}/x.pdf`]),
      '42501',
    );
    expect(await db.rows(parentB.id, `select 1 from storage.objects where bucket_id = 'communication-files'`)).toHaveLength(0);
  });
});
