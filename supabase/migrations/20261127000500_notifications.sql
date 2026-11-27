-- =============================================================================
-- Klasora · Phase 5a · Notifications, preferences, devices and delivery
--
-- Every notification is stored for the in app history. Push and email copies
-- are queued in notification_deliveries and sent by the dispatch-notifications
-- Edge Function, which retries failures. Sensitive notifications (absences,
-- results, messages) never show details on a lock screen unless the person
-- turns previews on.
-- =============================================================================

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid references public.schools (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('announcement', 'message', 'absence', 'assignment', 'result', 'report_card', 'general')),
  title       text not null check (char_length(title) <= 200),
  body        text check (char_length(body) <= 1000),
  link        text check (char_length(link) <= 500),
  related_id  uuid,
  sensitive   boolean not null default false,
  visible_at  timestamptz not null default now(),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, visible_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Overrides only; a missing row means the default for that kind.
create table public.notification_preferences (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('announcement', 'message', 'absence', 'assignment', 'result', 'report_card', 'general')),
  push_enabled  boolean not null default true,
  email_enabled boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.profiles add column push_previews boolean not null default false;
grant update (push_previews) on public.profiles to authenticated;

create table public.user_devices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  platform       text not null check (platform in ('ios', 'android', 'web')),
  push_token     text not null unique check (char_length(push_token) <= 400),
  device_name    text check (char_length(device_name) <= 120),
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index user_devices_user_idx on public.user_devices (user_id);

create table public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel         text not null check (channel in ('push', 'email')),
  target          text not null,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts        integer not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index notification_deliveries_pending_idx on public.notification_deliveries (next_attempt_at) where status = 'pending';

-- Default channels when a person has not chosen: push for everything, email
-- only for school announcements and report cards.
create or replace function app.wants(p_user_id uuid, p_kind text, p_channel text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when p_channel = 'push' then p.push_enabled else p.email_enabled end
     from public.notification_preferences p where p.user_id = p_user_id and p.kind = p_kind),
    case when p_channel = 'push' then true else p_kind in ('announcement', 'report_card') end
  );
$$;

-- Records a notification and queues its push and email copies.
create or replace function app.notify(
  p_school_id  uuid,
  p_user_id    uuid,
  p_kind       text,
  p_title      text,
  p_body       text,
  p_link       text,
  p_related_id uuid,
  p_sensitive  boolean default false,
  p_visible_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_email text;
begin
  if p_user_id is null then
    return null;
  end if;
  insert into public.notifications (school_id, user_id, kind, title, body, link, related_id, sensitive, visible_at)
  values (p_school_id, p_user_id, p_kind, left(p_title, 200), left(p_body, 1000), p_link, p_related_id, p_sensitive, coalesce(p_visible_at, now()))
  returning id into v_id;

  if app.wants(p_user_id, p_kind, 'push') then
    insert into public.notification_deliveries (notification_id, channel, target, next_attempt_at)
    select v_id, 'push', d.push_token, coalesce(p_visible_at, now())
    from public.user_devices d where d.user_id = p_user_id and d.platform in ('ios', 'android');
  end if;
  if app.wants(p_user_id, p_kind, 'email') then
    select email into v_email from public.profiles where id = p_user_id;
    if coalesce(v_email, '') <> '' then
      insert into public.notification_deliveries (notification_id, channel, target, next_attempt_at)
      values (v_id, 'email', v_email, coalesce(p_visible_at, now()));
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function app.school_path(p_school_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select '/s/' || slug from public.schools where id = p_school_id;
$$;

-- Guardians who should hear about a student (active portal accounts that receive notifications).
create or replace function app.guardian_users(p_student_id uuid, p_results_only boolean default false)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct g.user_id
  from public.student_guardians sg
  join public.guardians g on g.id = sg.guardian_id
  join public.school_memberships m on m.school_id = g.school_id and m.user_id = g.user_id and m.status = 'active'
  where sg.student_id = p_student_id and g.user_id is not null and sg.can_receive_notifications
    and (not p_results_only or sg.can_view_results);
$$;

-- =============================================================================
-- Producers: events that notify people
-- =============================================================================

-- Absences: when a register is submitted, and when a submitted record changes to absent.
create or replace function app.notify_absence(p_record public.attendance_records)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_session public.attendance_sessions;
  v_class   text;
  v_user    uuid;
begin
  select * into v_student from public.students where id = p_record.student_id;
  select * into v_session from public.attendance_sessions where id = p_record.session_id;
  select name into v_class from public.classes where id = v_session.class_id;
  for v_user in select user_id from app.guardian_users(p_record.student_id) loop
    perform app.notify(
      v_student.school_id, v_user, 'absence',
      v_student.first_name || ' was marked absent',
      v_student.first_name || ' ' || v_student.last_name || ' was absent from ' || v_class || ' on '
        || to_char(v_session.attendance_date, 'FMDay DD Mon') || '.'
        || coalesce(' Note: ' || p_record.remarks, ''),
      app.school_path(v_student.school_id) || '/students/' || v_student.id || '?tab=attendance',
      v_student.id, true
    );
  end loop;
end;
$$;

create or replace function app.on_register_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.attendance_records;
begin
  if new.status = 'submitted' and old.status = 'draft' and new.session_type in ('daily', 'morning') then
    for v_record in select * from public.attendance_records where session_id = new.id and status = 'absent' loop
      perform app.notify_absence(v_record);
    end loop;
  end if;
  return new;
end;
$$;

create trigger attendance_sessions_notify after update of status on public.attendance_sessions
  for each row execute function app.on_register_submitted();

create or replace function app.on_attendance_corrected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'absent' and (tg_op = 'INSERT' or old.status <> 'absent') and exists (
    select 1 from public.attendance_sessions s
    where s.id = new.session_id and s.status = 'submitted' and s.session_type in ('daily', 'morning')
  ) then
    perform app.notify_absence(new);
  end if;
  return new;
end;
$$;

create trigger attendance_records_notify after insert or update of status on public.attendance_records
  for each row execute function app.on_attendance_corrected();

-- New assignments: students in the class and their guardians.
create or replace function app.on_assignment_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text;
  v_user    uuid;
  v_path    text;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status <> 'draft') then
    return new;
  end if;
  select name into v_subject from public.subjects where id = new.subject_id;
  v_path := app.school_path(new.school_id) || '/assignments/' || new.id;
  for v_user in
    select s.user_id from public.class_enrollments e join public.students s on s.id = e.student_id
    where e.class_id = new.class_id and e.status = 'active' and s.user_id is not null
    union
    select g.user_id from public.class_enrollments e, lateral app.guardian_users(e.student_id) g
    where e.class_id = new.class_id and e.status = 'active'
  loop
    perform app.notify(new.school_id, v_user, 'assignment', 'New assignment: ' || new.title,
      v_subject || ', due ' || to_char(
        new.due_at at time zone coalesce((select s.timezone from public.schools s where s.id = new.school_id), 'Africa/Lagos'),
        'FMDay DD Mon, FMHH12:MI am'),
      v_path, new.id, false);
  end loop;
  return new;
end;
$$;

create trigger assignments_notify after insert or update of status on public.assignments
  for each row execute function app.on_assignment_published();

-- Published results: students and guardians allowed to see results.
create or replace function app.on_results_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text;
  v_row     record;
  v_user    uuid;
begin
  if new.status <> 'published' or old.status = 'published' then
    return new;
  end if;
  select name into v_subject from public.subjects where id = new.subject_id;
  for v_row in
    select distinct sc.student_id, st.user_id as student_user, st.first_name
    from public.assessment_scores sc join public.students st on st.id = sc.student_id
    where sc.assessment_id = new.id
  loop
    if v_row.student_user is not null then
      perform app.notify(new.school_id, v_row.student_user, 'result', 'New results in ' || v_subject,
        new.title || ' results are now available.', app.school_path(new.school_id) || '/my-results', new.id, true);
    end if;
    for v_user in select user_id from app.guardian_users(v_row.student_id, true) loop
      perform app.notify(new.school_id, v_user, 'result', 'New results for ' || v_row.first_name,
        v_subject || ': ' || new.title || ' results are now available.',
        app.school_path(new.school_id) || '/students/' || v_row.student_id || '?tab=results', new.id, true);
    end loop;
  end loop;
  return new;
end;
$$;

create trigger assessments_notify after update of status on public.assessments
  for each row execute function app.on_results_published();

-- Report cards: the student and guardians allowed to see results.
create or replace function app.on_report_card_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_user    uuid;
  v_link    text;
begin
  if new.status <> 'published' or old.status = 'published' then
    return new;
  end if;
  select * into v_student from public.students where id = new.student_id;
  v_link := app.school_path(new.school_id) || '/report-cards/' || new.id;
  if v_student.user_id is not null then
    perform app.notify(new.school_id, v_student.user_id, 'report_card', 'Your report card is ready', 'Open it to see your results for the term.', v_link, new.id, true);
  end if;
  for v_user in select user_id from app.guardian_users(new.student_id, true) loop
    perform app.notify(new.school_id, v_user, 'report_card', v_student.first_name || '''s report card is ready',
      'Open it to see results, attendance and comments for the term.', v_link, new.id, true);
  end loop;
  return new;
end;
$$;

create trigger report_cards_notify after update of status on public.report_cards
  for each row execute function app.on_report_card_published();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.notifications           enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.user_devices            enable row level security;
alter table public.notification_deliveries enable row level security;
revoke all on public.notifications, public.notification_preferences, public.user_devices, public.notification_deliveries
  from anon, authenticated;

-- Your own notifications, once they are due. Only read_at can change.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = (select auth.uid()) and visible_at <= now());
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.notification_preferences to authenticated;
create policy notification_preferences_own on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, delete on public.user_devices to authenticated;
create policy user_devices_own on public.user_devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_devices_delete on public.user_devices
  for delete to authenticated using (user_id = (select auth.uid()));
-- Deliveries are internal: no API access.

-- Registers (or refreshes) this device's push token for the signed in person.
create or replace function public.register_device(p_platform text, p_token text, p_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = 'KL403';
  end if;
  if p_platform not in ('ios', 'android', 'web') or coalesce(trim(p_token), '') = '' then
    raise exception 'This device could not be registered.' using errcode = 'KL400';
  end if;
  insert into public.user_devices (user_id, platform, push_token, device_name, last_active_at)
  values (auth.uid(), p_platform, trim(p_token), left(p_name, 120), now())
  on conflict (push_token) do update
    set user_id = auth.uid(), platform = excluded.platform, device_name = excluded.device_name, last_active_at = now();
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null and visible_at <= now()
    and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.wants(uuid, text, text), app.notify(uuid, uuid, text, text, text, text, uuid, boolean, timestamptz),
  app.school_path(uuid), app.guardian_users(uuid, boolean), app.notify_absence(public.attendance_records),
  app.on_register_submitted(), app.on_attendance_corrected(), app.on_assignment_published(),
  app.on_results_published(), app.on_report_card_published() from public;
revoke all on function public.register_device(text, text, text), public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.register_device(text, text, text), public.mark_notifications_read(uuid[]) to authenticated;

-- Live updates in the app (the hosted project has this publication; the test database does not).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
