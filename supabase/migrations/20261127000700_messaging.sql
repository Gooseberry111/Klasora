-- =============================================================================
-- Klasora · Phase 5c · Messaging
--
-- Not an open chat. Who may message whom:
--   * staff and staff;
--   * parents and school administrators (staff with students.view);
--   * parents and the teachers of their own children;
--   * students and their own teachers.
-- Blocking stops a person from messaging you. Reported messages go to
-- moderators (communication.approve), who see only the reported message,
-- not the rest of the conversation, and can hide it or lock the thread.
-- =============================================================================

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id) on delete cascade,
  kind            text not null default 'direct' check (kind in ('direct', 'group')),
  subject         text check (char_length(subject) <= 200),
  created_by      uuid references public.profiles (id) on delete set null,
  is_locked       boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint conversations_id_school_unique unique (id, school_id)
);
create index conversations_school_idx on public.conversations (school_id, last_message_at desc);

create table public.conversation_participants (
  conversation_id uuid not null,
  school_id       uuid not null references public.schools (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint conversation_participants_conversation_fk
    foreign key (conversation_id, school_id) references public.conversations (id, school_id) on delete cascade
);
create index conversation_participants_user_idx on public.conversation_participants (user_id);

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  conversation_id  uuid not null,
  sender_id        uuid references public.profiles (id) on delete set null,
  body             text check (char_length(body) <= 5000),
  attachment_paths text[] not null default '{}' check (cardinality(attachment_paths) <= 5),
  hidden_at        timestamptz,
  hidden_by        uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint messages_conversation_fk
    foreign key (conversation_id, school_id) references public.conversations (id, school_id) on delete cascade
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.message_reports (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  message_id  uuid not null references public.messages (id) on delete cascade,
  reported_by uuid references public.profiles (id) on delete set null,
  reason      text not null check (char_length(trim(reason)) between 1 and 500),
  status      text not null default 'open' check (status in ('open', 'hidden', 'dismissed')),
  snapshot    text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint message_reports_unique unique (message_id, reported_by)
);

create table public.user_blocks (
  school_id  uuid not null references public.schools (id) on delete cascade,
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (school_id, blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create trigger message_reports_audit after insert or update or delete on public.message_reports
  for each row execute function app.audit_row_change();

-- =============================================================================
-- Who may message whom
-- =============================================================================
create or replace function app.is_staff_member(p_school_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.school_memberships m join public.roles r on r.id = m.role_id
    where m.school_id = p_school_id and m.user_id = p_user_id and m.status = 'active'
      and coalesce(r.role_key, '') not in ('parent', 'student')
  );
$$;

-- Students a person is a linked guardian of (active portal account).
create or replace function app.children_of(p_school_id uuid, p_user_id uuid)
returns table (student_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select sg.student_id
  from public.guardians g
  join public.student_guardians sg on sg.guardian_id = g.id
  join public.school_memberships m on m.school_id = g.school_id and m.user_id = g.user_id and m.status = 'active'
  where g.school_id = p_school_id and g.user_id = p_user_id;
$$;

create or replace function app.own_student(p_school_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.students s
  join public.school_memberships m on m.school_id = s.school_id and m.user_id = s.user_id and m.status = 'active'
  where s.school_id = p_school_id and s.user_id = p_user_id
  limit 1;
$$;

-- Does a person teach a student now (class teacher or subject teacher)?
create or replace function app.user_teaches_student(p_user_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_enrollments e
    where e.student_id = p_student_id and e.status = 'active' and (
      exists (select 1 from public.classes c join public.school_memberships m on m.id = c.class_teacher_membership_id
              where c.id = e.class_id and m.user_id = p_user_id and m.status = 'active')
      or exists (select 1 from public.class_subjects cs join public.school_memberships m on m.id = cs.teacher_membership_id
                 where cs.class_id = e.class_id and m.user_id = p_user_id and m.status = 'active')
    )
  );
$$;

create or replace function app.can_message(p_school_id uuid, p_from uuid, p_to uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from_staff boolean := app.is_staff_member(p_school_id, p_from);
  v_to_staff   boolean := app.is_staff_member(p_school_id, p_to);
  v_staff      uuid;
  v_other      uuid;
begin
  if p_from = p_to or not app.is_school_member(p_school_id) then
    return false;
  end if;
  if exists (
    select 1 from public.user_blocks b
    where b.school_id = p_school_id
      and ((b.blocker_id = p_to and b.blocked_id = p_from) or (b.blocker_id = p_from and b.blocked_id = p_to))
  ) then
    return false;
  end if;
  if v_from_staff and v_to_staff then
    return true;
  end if;
  if not (v_from_staff or v_to_staff) then
    return false; -- parents and students never message each other
  end if;
  v_staff := case when v_from_staff then p_from else p_to end;
  v_other := case when v_from_staff then p_to else p_from end;

  -- A guardian: school administrators, or teachers of their children.
  if exists (select 1 from app.children_of(p_school_id, v_other)) then
    if app.user_has_permission(p_school_id, v_staff, 'students.view') then
      return true;
    end if;
    return exists (select 1 from app.children_of(p_school_id, v_other) c where app.user_teaches_student(v_staff, c.student_id));
  end if;

  -- A student: their own teachers only.
  return coalesce(app.user_teaches_student(v_staff, app.own_student(p_school_id, v_other)), false);
end;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;
alter table public.message_reports           enable row level security;
alter table public.user_blocks               enable row level security;
revoke all on public.conversations, public.conversation_participants, public.messages, public.message_reports, public.user_blocks
  from anon, authenticated;

create or replace function app.is_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = p_conversation_id and p.user_id = auth.uid()
  );
$$;

grant select on public.conversations, public.conversation_participants, public.messages to authenticated;
create policy conversations_select on public.conversations
  for select to authenticated using (app.is_participant(id));
create policy conversation_participants_select on public.conversation_participants
  for select to authenticated using (app.is_participant(conversation_id));
create policy messages_select on public.messages
  for select to authenticated using (app.is_participant(conversation_id));

grant select on public.user_blocks to authenticated;
create policy user_blocks_select on public.user_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));

grant select on public.message_reports to authenticated;
create policy message_reports_select on public.message_reports
  for select to authenticated using (reported_by = (select auth.uid()));

-- =============================================================================
-- RPCs
-- =============================================================================

-- People the caller may start a conversation with, with a short description.
create or replace function public.messaging_contacts(p_school_id uuid)
returns table (user_id uuid, first_name text, last_name text, avatar_url text, description text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_school_member(p_school_id) then
    raise exception 'This school could not be found.' using errcode = 'KL404';
  end if;
  return query
  with people as (
    select distinct m.user_id from public.school_memberships m
    where m.school_id = p_school_id and m.status = 'active' and m.user_id <> auth.uid()
  )
  select pr.id, pr.first_name, pr.last_name, pr.avatar_url,
         coalesce(
           (select 'Parent of ' || string_agg(st.first_name || ' ' || st.last_name, ', ' order by st.first_name)
            from app.children_of(p_school_id, pr.id) c join public.students st on st.id = c.student_id),
           (select 'Student, ' || coalesce(cl.name, 'no class yet')
            from public.students st
            left join public.class_enrollments e on e.student_id = st.id and e.status = 'active'
            left join public.classes cl on cl.id = e.class_id
            where st.id = app.own_student(p_school_id, pr.id)),
           (select string_agg(distinct r.name, ', ') from public.school_memberships m join public.roles r on r.id = m.role_id
            where m.school_id = p_school_id and m.user_id = pr.id and m.status = 'active')
         )
  from people pe
  join public.profiles pr on pr.id = pe.user_id
  where app.can_message(p_school_id, auth.uid(), pr.id)
  order by pr.first_name, pr.last_name;
end;
$$;

create or replace function app.post_message(p_conversation public.conversations, p_body text, p_files text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_name   text;
  v_prefix text := p_conversation.school_id || '/messages/' || p_conversation.id || '/';
  v_file   text;
  v_user   uuid;
begin
  if coalesce(trim(p_body), '') = '' and coalesce(cardinality(p_files), 0) = 0 then
    raise exception 'Write a message or attach a file.' using errcode = 'KL400';
  end if;
  foreach v_file in array coalesce(p_files, '{}') loop
    if left(v_file, length(v_prefix)) <> v_prefix then
      raise exception 'One of the attached files is not valid.' using errcode = 'KL400';
    end if;
  end loop;
  insert into public.messages (school_id, conversation_id, sender_id, body, attachment_paths)
  values (p_conversation.school_id, p_conversation.id, auth.uid(), nullif(trim(p_body), ''), coalesce(p_files, '{}'))
  returning id into v_id;
  update public.conversations set last_message_at = now() where id = p_conversation.id;
  update public.conversation_participants set last_read_at = now()
  where conversation_id = p_conversation.id and user_id = auth.uid();

  select trim(first_name || ' ' || last_name) into v_name from public.profiles where id = auth.uid();
  for v_user in
    select p.user_id from public.conversation_participants p
    where p.conversation_id = p_conversation.id and p.user_id <> auth.uid()
  loop
    perform app.notify(p_conversation.school_id, v_user, 'message', 'New message from ' || coalesce(nullif(v_name, ''), 'someone'),
      coalesce(left(nullif(trim(p_body), ''), 140), 'Sent an attachment'),
      app.school_path(p_conversation.school_id) || '/messages?c=' || p_conversation.id, p_conversation.id, true);
  end loop;
  return v_id;
end;
$$;

-- Starts a conversation (or reuses the existing one for a direct message) and sends the first message.
create or replace function public.start_conversation(
  p_school_id  uuid,
  p_recipients uuid[],
  p_subject    text,
  p_body       text,
  p_files      text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_conv      public.conversations;
  v_list      uuid[] := (select array_agg(distinct r) from unnest(p_recipients) r where r <> auth.uid());
begin
  if not app.is_school_member(p_school_id) or not app.school_is_writable(p_school_id) then
    raise exception 'You cannot send messages in this school right now.' using errcode = 'KL403';
  end if;
  if coalesce(cardinality(v_list), 0) = 0 or cardinality(v_list) > 20 then
    raise exception 'Choose between 1 and 20 people.' using errcode = 'KL400';
  end if;
  if cardinality(v_list) > 1 and not app.is_staff_member(p_school_id, auth.uid()) then
    raise exception 'Group messages can only be started by staff.' using errcode = 'KL403';
  end if;
  foreach v_recipient in array v_list loop
    if not app.can_message(p_school_id, auth.uid(), v_recipient) then
      raise exception 'You cannot message one of the people you chose.' using errcode = 'KL403';
    end if;
  end loop;

  if cardinality(v_list) = 1 then
    select c.* into v_conv
    from public.conversations c
    where c.school_id = p_school_id and c.kind = 'direct'
      and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id = auth.uid())
      and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id = v_list[1])
    limit 1;
  end if;

  if v_conv.id is null then
    insert into public.conversations (school_id, kind, subject, created_by)
    values (p_school_id, case when cardinality(v_list) = 1 then 'direct' else 'group' end, nullif(trim(p_subject), ''), auth.uid())
    returning * into v_conv;
    insert into public.conversation_participants (conversation_id, school_id, user_id, last_read_at)
    select v_conv.id, p_school_id, u, case when u = auth.uid() then now() end
    from unnest(array_append(v_list, auth.uid())) u;
  end if;

  if v_conv.is_locked then
    raise exception 'This conversation has been closed by the school.' using errcode = 'KL409';
  end if;
  perform app.post_message(v_conv, p_body, p_files);
  return v_conv.id;
end;
$$;

create or replace function public.send_message(p_conversation_id uuid, p_body text, p_files text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv  public.conversations;
  v_other uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found or not app.is_participant(p_conversation_id) then
    raise exception 'This conversation could not be found.' using errcode = 'KL404';
  end if;
  if v_conv.is_locked then
    raise exception 'This conversation has been closed by the school.' using errcode = 'KL409';
  end if;
  if not app.school_is_writable(v_conv.school_id) or not app.is_school_member(v_conv.school_id) then
    raise exception 'You cannot send messages in this school right now.' using errcode = 'KL403';
  end if;
  if v_conv.kind = 'direct' then
    select p.user_id into v_other from public.conversation_participants p
    where p.conversation_id = p_conversation_id and p.user_id <> auth.uid() limit 1;
    if exists (
      select 1 from public.user_blocks b
      where b.school_id = v_conv.school_id
        and ((b.blocker_id = v_other and b.blocked_id = auth.uid()) or (b.blocker_id = auth.uid() and b.blocked_id = v_other))
    ) then
      raise exception 'You cannot message this person.' using errcode = 'KL403';
    end if;
  end if;
  return app.post_message(v_conv, p_body, p_files);
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_participants set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
  update public.notifications set read_at = now()
  where user_id = auth.uid() and kind = 'message' and related_id = p_conversation_id and read_at is null;
$$;

-- The caller's conversations with the latest message and unread counts.
create or replace function public.get_inbox(p_school_id uuid)
returns table (
  conversation_id uuid,
  kind            text,
  subject         text,
  is_locked       boolean,
  last_message_at timestamptz,
  last_body       text,
  last_sender_id  uuid,
  unread_count    integer,
  participants    jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.subject, c.is_locked, c.last_message_at,
         (select case when m.hidden_at is not null then 'This message was removed.' else coalesce(left(m.body, 140), 'Attachment') end
          from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
         (select m.sender_id from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
         (select count(*)::int from public.messages m
          where m.conversation_id = c.id and m.sender_id is distinct from auth.uid()
            and (me.last_read_at is null or m.created_at > me.last_read_at)),
         (select jsonb_agg(jsonb_build_object(
                   'user_id', pr.id, 'name', trim(pr.first_name || ' ' || pr.last_name), 'avatar_url', pr.avatar_url,
                   'last_read_at', p.last_read_at) order by pr.first_name)
          from public.conversation_participants p join public.profiles pr on pr.id = p.user_id
          where p.conversation_id = c.id)
  from public.conversations c
  join public.conversation_participants me on me.conversation_id = c.id and me.user_id = auth.uid()
  where c.school_id = p_school_id
  order by c.last_message_at desc;
$$;

create or replace function public.unread_message_count(p_school_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.conversation_participants me
  join public.messages m on m.conversation_id = me.conversation_id
  where me.user_id = auth.uid() and me.school_id = p_school_id
    and m.sender_id is distinct from auth.uid()
    and (me.last_read_at is null or m.created_at > me.last_read_at);
$$;

create or replace function public.block_user(p_school_id uuid, p_user_id uuid, p_block boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_school_member(p_school_id) or p_user_id = auth.uid() then
    raise exception 'This person could not be blocked.' using errcode = 'KL400';
  end if;
  if p_block then
    insert into public.user_blocks (school_id, blocker_id, blocked_id) values (p_school_id, auth.uid(), p_user_id)
    on conflict do nothing;
  else
    delete from public.user_blocks where school_id = p_school_id and blocker_id = auth.uid() and blocked_id = p_user_id;
  end if;
end;
$$;

create or replace function public.report_message(p_message_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_user    uuid;
begin
  select * into v_message from public.messages where id = p_message_id;
  if not found or not app.is_participant(v_message.conversation_id) then
    raise exception 'This message could not be found.' using errcode = 'KL404';
  end if;
  if v_message.sender_id = auth.uid() then
    raise exception 'You cannot report your own message.' using errcode = 'KL400';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Tell us what is wrong with this message.' using errcode = 'KL400';
  end if;
  insert into public.message_reports (school_id, message_id, reported_by, reason)
  values (v_message.school_id, p_message_id, auth.uid(), trim(p_reason))
  on conflict (message_id, reported_by) do nothing;
  for v_user in
    select distinct m.user_id from public.school_memberships m
    where m.school_id = v_message.school_id and m.status = 'active'
      and app.user_has_permission(v_message.school_id, m.user_id, 'communication.approve')
  loop
    perform app.notify(v_message.school_id, v_user, 'general', 'A message was reported', 'Review it in Messages.',
                       app.school_path(v_message.school_id) || '/messages?tab=moderation', p_message_id, true);
  end loop;
end;
$$;

-- Open reports for moderators: only the reported message, never the whole conversation.
create or replace function public.moderation_queue(p_school_id uuid)
returns table (
  report_id       uuid,
  message_id      uuid,
  conversation_id uuid,
  body            text,
  sender_name     text,
  reporter_name   text,
  reason          text,
  status          text,
  is_locked       boolean,
  created_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_school_id, 'communication.approve') then
    raise exception 'You do not have permission to moderate messages.' using errcode = 'KL403';
  end if;
  return query
  select r.id, m.id, m.conversation_id, coalesce(r.snapshot, m.body),
         trim(sp.first_name || ' ' || sp.last_name), trim(rp.first_name || ' ' || rp.last_name),
         r.reason, r.status, c.is_locked, r.created_at
  from public.message_reports r
  join public.messages m on m.id = r.message_id
  join public.conversations c on c.id = m.conversation_id
  left join public.profiles sp on sp.id = m.sender_id
  left join public.profiles rp on rp.id = r.reported_by
  where r.school_id = p_school_id
  order by (r.status = 'open') desc, r.created_at desc
  limit 200;
end;
$$;

create or replace function public.moderate_report(p_report_id uuid, p_action text, p_lock boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report  public.message_reports;
  v_message public.messages;
begin
  select * into v_report from public.message_reports where id = p_report_id for update;
  if not found or not app.can_write(v_report.school_id, 'communication.approve') then
    raise exception 'You do not have permission to moderate messages.' using errcode = 'KL403';
  end if;
  select * into v_message from public.messages where id = v_report.message_id for update;
  if p_action = 'hide' then
    update public.message_reports
    set status = 'hidden', snapshot = coalesce(snapshot, v_message.body), resolved_by = auth.uid(), resolved_at = now()
    where message_id = v_message.id and status = 'open';
    update public.message_reports set snapshot = coalesce(snapshot, v_message.body) where message_id = v_message.id;
    update public.messages set body = null, attachment_paths = '{}', hidden_at = now(), hidden_by = auth.uid() where id = v_message.id;
  elsif p_action = 'dismiss' then
    update public.message_reports set status = 'dismissed', resolved_by = auth.uid(), resolved_at = now() where id = p_report_id;
  else
    raise exception 'Choose hide or dismiss.' using errcode = 'KL400';
  end if;
  if p_lock then
    update public.conversations set is_locked = true where id = v_message.conversation_id;
  end if;
end;
$$;

revoke all on function app.is_staff_member(uuid, uuid), app.children_of(uuid, uuid), app.own_student(uuid, uuid),
  app.user_teaches_student(uuid, uuid), app.can_message(uuid, uuid, uuid), app.post_message(public.conversations, text, text[]) from public;
revoke all on function app.is_participant(uuid) from public;
grant execute on function app.is_participant(uuid) to authenticated;
revoke all on function public.messaging_contacts(uuid), public.start_conversation(uuid, uuid[], text, text, text[]),
  public.send_message(uuid, text, text[]), public.mark_conversation_read(uuid), public.get_inbox(uuid),
  public.unread_message_count(uuid), public.block_user(uuid, uuid, boolean), public.report_message(uuid, text),
  public.moderation_queue(uuid), public.moderate_report(uuid, text, boolean) from public, anon;
grant execute on function public.messaging_contacts(uuid), public.start_conversation(uuid, uuid[], text, text, text[]),
  public.send_message(uuid, text, text[]), public.mark_conversation_read(uuid), public.get_inbox(uuid),
  public.unread_message_count(uuid), public.block_user(uuid, uuid, boolean), public.report_message(uuid, text),
  public.moderation_queue(uuid), public.moderate_report(uuid, text, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
