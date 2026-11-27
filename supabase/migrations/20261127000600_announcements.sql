-- =============================================================================
-- Klasora · Phase 5b · Announcements
--
-- Audiences: everyone, staff, parents, students, chosen classes (with their
-- parents, students and teachers) or chosen roles, optionally limited to one
-- campus. Recipients are fixed when the announcement is published, which
-- gives exact read tracking.
--
-- Publishing: people with communication.approve publish anything. Others can
-- publish straight to classes they teach; anything wider waits for approval.
-- =============================================================================

create table public.announcements (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  title            text not null check (char_length(trim(title)) between 1 and 200),
  body             text not null check (char_length(body) between 1 and 20000),
  attachment_paths text[] not null default '{}' check (cardinality(attachment_paths) <= 10),
  audience         text not null default 'everyone'
                     check (audience in ('everyone', 'staff', 'parents', 'students', 'classes', 'roles')),
  campus_id        uuid,
  class_ids        uuid[] not null default '{}',
  role_ids         uuid[] not null default '{}',
  include_parents  boolean not null default true,
  include_students boolean not null default true,
  include_teachers boolean not null default false,
  publish_at       timestamptz,
  expires_at       timestamptz,
  status           text not null default 'draft' check (status in ('draft', 'pending', 'published', 'archived')),
  review_note      text check (char_length(review_note) <= 1000),
  author_id        uuid references public.profiles (id) on delete set null,
  approved_by      uuid references public.profiles (id) on delete set null,
  published_at     timestamptz,
  recipient_count  integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint announcements_campus_fk
    foreign key (campus_id, school_id) references public.campuses (id, school_id) on delete set null (campus_id),
  constraint announcements_expiry check (expires_at is null or expires_at > coalesce(publish_at, created_at)),
  constraint announcements_targets check (
    (audience <> 'classes' or cardinality(class_ids) > 0) and (audience <> 'roles' or cardinality(role_ids) > 0)
  ),
  constraint announcements_id_school_unique unique (id, school_id)
);
create index announcements_school_idx on public.announcements (school_id, status, publish_at desc);

create table public.announcement_recipients (
  announcement_id uuid not null,
  school_id       uuid not null references public.schools (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  read_at         timestamptz,
  primary key (announcement_id, user_id),
  constraint announcement_recipients_announcement_fk
    foreign key (announcement_id, school_id) references public.announcements (id, school_id) on delete cascade
);
create index announcement_recipients_user_idx on public.announcement_recipients (user_id);

create trigger announcements_set_updated_at before update on public.announcements
  for each row execute function app.set_updated_at();
create trigger announcements_prevent_school_change before update on public.announcements
  for each row execute function app.prevent_school_change();
create trigger announcements_audit after insert or update or delete on public.announcements
  for each row execute function app.audit_row_change();

-- =============================================================================
-- Audience
-- =============================================================================
create or replace function app.announcement_audience(p_a public.announcements)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with targeted_students as (
    select s.id, s.user_id
    from public.students s
    where s.school_id = p_a.school_id and s.status = 'active'
      and (p_a.campus_id is null or s.campus_id = p_a.campus_id)
      and (p_a.audience <> 'classes' or exists (
        select 1 from public.class_enrollments e
        where e.student_id = s.id and e.status = 'active' and e.class_id = any (p_a.class_ids)
      ))
  ),
  staff as (
    select m.user_id
    from public.school_memberships m join public.roles r on r.id = m.role_id
    where m.school_id = p_a.school_id and m.status = 'active'
      and coalesce(r.role_key, '') not in ('parent', 'student')
      and (p_a.campus_id is null or m.campus_id is null or m.campus_id = p_a.campus_id)
  ),
  student_users as (
    select ts.user_id from targeted_students ts
    join public.school_memberships m on m.school_id = p_a.school_id and m.user_id = ts.user_id and m.status = 'active'
    where ts.user_id is not null
  ),
  parent_users as (
    select g.user_id
    from targeted_students ts
    join public.student_guardians sg on sg.student_id = ts.id
    join public.guardians g on g.id = sg.guardian_id
    join public.school_memberships m on m.school_id = g.school_id and m.user_id = g.user_id and m.status = 'active'
    where g.user_id is not null
  ),
  class_teachers as (
    select m.user_id from public.classes c join public.school_memberships m on m.id = c.class_teacher_membership_id
    where c.id = any (p_a.class_ids) and m.status = 'active'
    union
    select m.user_id from public.class_subjects cs join public.school_memberships m on m.id = cs.teacher_membership_id
    where cs.class_id = any (p_a.class_ids) and m.status = 'active'
  ),
  role_members as (
    select m.user_id from public.school_memberships m
    where m.school_id = p_a.school_id and m.status = 'active' and m.role_id = any (p_a.role_ids)
  )
  select distinct x.user_id from (
    select user_id from staff where p_a.audience in ('everyone', 'staff')
    union all select user_id from student_users where p_a.audience in ('everyone', 'students') or (p_a.audience = 'classes' and p_a.include_students)
    union all select user_id from parent_users where p_a.audience in ('everyone', 'parents') or (p_a.audience = 'classes' and p_a.include_parents)
    union all select user_id from class_teachers where p_a.audience = 'classes' and p_a.include_teachers
    union all select user_id from role_members where p_a.audience = 'roles'
  ) x
  where x.user_id is not null;
$$;

-- Does a given person (not necessarily the caller) hold a permission in a school?
create or replace function app.user_has_permission(p_school_id uuid, p_user_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_memberships m
    join public.roles r on r.id = m.role_id
    where m.school_id = p_school_id and m.user_id = p_user_id and m.status = 'active'
      and (r.role_key = 'owner' or exists (
        select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
        where rp.role_id = r.id and rp.allowed and p.permission_key = p_permission_key
      ))
  );
$$;

-- True when every targeted class is one the caller teaches.
create or replace function app.teaches_all_classes(p_class_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(p_class_ids) > 0 and not exists (
    select 1 from unnest(p_class_ids) c (id) where not app.teaches_class(c.id)
  );
$$;

-- Fixes the recipients, notifies them, and marks the announcement published.
create or replace function app.release_announcement(p_id uuid, p_approver uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a     public.announcements;
  v_user  uuid;
  v_count integer := 0;
  v_link  text;
begin
  select * into v_a from public.announcements where id = p_id for update;
  v_link := app.school_path(v_a.school_id) || '/announcements/' || v_a.id;
  for v_user in select user_id from app.announcement_audience(v_a) loop
    insert into public.announcement_recipients (announcement_id, school_id, user_id)
    values (v_a.id, v_a.school_id, v_user) on conflict do nothing;
    if v_user is distinct from v_a.author_id then
      perform app.notify(v_a.school_id, v_user, 'announcement', v_a.title, left(regexp_replace(v_a.body, '\s+', ' ', 'g'), 160),
                         v_link, v_a.id, false, coalesce(v_a.publish_at, now()));
    end if;
    v_count := v_count + 1;
  end loop;
  update public.announcements
  set status = 'published', published_at = coalesce(publish_at, now()), approved_by = p_approver,
      recipient_count = v_count, review_note = null
  where id = p_id;
  return v_count;
end;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.announcements           enable row level security;
alter table public.announcement_recipients enable row level security;
revoke all on public.announcements, public.announcement_recipients from anon, authenticated;

-- Policy helpers (security definer, so the two tables' policies do not call each other).
create or replace function app.is_announcement_recipient(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.announcement_recipients r
    where r.announcement_id = p_announcement_id and r.user_id = auth.uid()
  );
$$;

create or replace function app.manages_announcement(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and (a.author_id = auth.uid() or app.has_permission(a.school_id, 'communication.approve'))
  );
$$;

revoke all on function app.is_announcement_recipient(uuid), app.manages_announcement(uuid) from public;
grant execute on function app.is_announcement_recipient(uuid), app.manages_announcement(uuid) to authenticated;

grant select, delete on public.announcements to authenticated;
grant insert (school_id, title, body, attachment_paths, audience, campus_id, class_ids, role_ids, include_parents,
              include_students, include_teachers, publish_at, expires_at)
  on public.announcements to authenticated;
grant update (title, body, attachment_paths, audience, campus_id, class_ids, role_ids, include_parents,
              include_students, include_teachers, publish_at, expires_at)
  on public.announcements to authenticated;

-- Defaults the author on insert.
create or replace function app.stamp_announcement_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_id := auth.uid();
  return new;
end;
$$;
create trigger announcements_author before insert on public.announcements
  for each row execute function app.stamp_announcement_author();

create policy announcements_select on public.announcements
  for select to authenticated
  using (
    author_id = (select auth.uid())
    or app.has_permission(school_id, 'communication.approve')
    or (
      status = 'published' and coalesce(publish_at, published_at) <= now()
      and (expires_at is null or expires_at > now())
      and app.is_announcement_recipient(id)
    )
  );
create policy announcements_insert on public.announcements
  for insert to authenticated with check (app.can_write(school_id, 'communication.create'));
create policy announcements_update on public.announcements
  for update to authenticated
  using (status = 'draft' and author_id = (select auth.uid()) and app.can_write(school_id, 'communication.create'))
  with check (status = 'draft' and author_id = (select auth.uid()) and app.can_write(school_id, 'communication.create'));
create policy announcements_delete on public.announcements
  for delete to authenticated
  using (
    (status in ('draft', 'pending') and author_id = (select auth.uid()))
    or app.can_write(school_id, 'communication.delete')
  );

grant select on public.announcement_recipients to authenticated;
create policy announcement_recipients_select on public.announcement_recipients
  for select to authenticated
  using (
    user_id = (select auth.uid()) or app.manages_announcement(announcement_id)
  );

-- =============================================================================
-- RPCs
-- =============================================================================

-- Publishes (or submits for approval) a draft. Returns the resulting status.
create or replace function public.publish_announcement(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.announcements;
begin
  select * into v_a from public.announcements where id = p_id for update;
  if not found or (v_a.author_id is distinct from auth.uid() and not app.has_permission(v_a.school_id, 'communication.approve')) then
    raise exception 'This announcement could not be found.' using errcode = 'KL404';
  end if;
  if v_a.status not in ('draft', 'pending') then
    raise exception 'This announcement has already been published.' using errcode = 'KL409';
  end if;
  if app.can_write(v_a.school_id, 'communication.approve') then
    perform app.release_announcement(p_id, auth.uid());
    return 'published';
  end if;
  if not app.can_write(v_a.school_id, 'communication.create') then
    raise exception 'You do not have permission to publish announcements.' using errcode = 'KL403';
  end if;
  if v_a.audience = 'classes' and app.teaches_all_classes(v_a.class_ids) then
    perform app.release_announcement(p_id, null);
    return 'published';
  end if;
  update public.announcements set status = 'pending' where id = p_id;
  -- Let approvers know something is waiting.
  perform app.notify(v_a.school_id, m.user_id, 'general', 'Announcement waiting for approval', v_a.title,
                     app.school_path(v_a.school_id) || '/announcements/' || v_a.id, v_a.id, false)
  from (
    select distinct sm.user_id from public.school_memberships sm
    where sm.school_id = v_a.school_id and sm.status = 'active'
  ) m
  where app.user_has_permission(v_a.school_id, m.user_id, 'communication.approve');
  return 'pending';
end;
$$;

create or replace function public.review_announcement(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.announcements;
begin
  select * into v_a from public.announcements where id = p_id for update;
  if not found or not app.can_write(v_a.school_id, 'communication.approve') then
    raise exception 'You do not have permission to approve announcements.' using errcode = 'KL403';
  end if;
  if v_a.status <> 'pending' then
    raise exception 'Only announcements waiting for approval can be reviewed.' using errcode = 'KL409';
  end if;
  if p_approve then
    perform app.release_announcement(p_id, auth.uid());
  else
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Explain what needs changing.' using errcode = 'KL400';
    end if;
    update public.announcements set status = 'draft', review_note = trim(p_note) where id = p_id;
    perform app.notify(v_a.school_id, v_a.author_id, 'general', 'Announcement returned for changes', trim(p_note),
                       app.school_path(v_a.school_id) || '/announcements/' || v_a.id, v_a.id, false);
  end if;
end;
$$;

create or replace function public.archive_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.announcements;
begin
  select * into v_a from public.announcements where id = p_id;
  if not found or not (v_a.author_id = auth.uid() or app.has_permission(v_a.school_id, 'communication.approve'))
     or not app.school_is_writable(v_a.school_id) then
    raise exception 'You cannot archive this announcement.' using errcode = 'KL403';
  end if;
  update public.announcements set status = 'archived' where id = p_id;
end;
$$;

create or replace function public.mark_announcement_read(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.announcement_recipients set read_at = now()
  where announcement_id = p_id and user_id = auth.uid() and read_at is null;
  update public.notifications set read_at = now()
  where user_id = auth.uid() and related_id = p_id and kind = 'announcement' and read_at is null;
$$;

-- Who has read an announcement, for its author and approvers.
create or replace function public.announcement_readers(p_id uuid)
returns table (user_id uuid, first_name text, last_name text, audience_role text, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.announcements;
begin
  select * into v_a from public.announcements where id = p_id;
  if not found or not (v_a.author_id = auth.uid() or app.has_permission(v_a.school_id, 'communication.approve')) then
    raise exception 'This announcement could not be found.' using errcode = 'KL404';
  end if;
  return query
  select r.user_id, p.first_name, p.last_name,
         (select string_agg(distinct ro.name, ', ') from public.school_memberships m join public.roles ro on ro.id = m.role_id
          where m.school_id = v_a.school_id and m.user_id = r.user_id and m.status = 'active'),
         r.read_at
  from public.announcement_recipients r join public.profiles p on p.id = r.user_id
  where r.announcement_id = p_id
  order by r.read_at nulls last, p.first_name;
end;
$$;

-- Unread announcements for the badge in the sidebar.
create or replace function public.unread_announcement_count(p_school_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.announcement_recipients r join public.announcements a on a.id = r.announcement_id
  where r.user_id = auth.uid() and r.school_id = p_school_id and r.read_at is null and a.status = 'published'
    and coalesce(a.publish_at, a.published_at) <= now() and (a.expires_at is null or a.expires_at > now());
$$;

revoke all on function app.announcement_audience(public.announcements), app.teaches_all_classes(uuid[]), app.user_has_permission(uuid, uuid, text),
  app.release_announcement(uuid, uuid), app.stamp_announcement_author() from public;
revoke all on function public.publish_announcement(uuid), public.review_announcement(uuid, boolean, text),
  public.archive_announcement(uuid), public.mark_announcement_read(uuid), public.announcement_readers(uuid),
  public.unread_announcement_count(uuid) from public, anon;
grant execute on function public.publish_announcement(uuid), public.review_announcement(uuid, boolean, text),
  public.archive_announcement(uuid), public.mark_announcement_read(uuid), public.announcement_readers(uuid),
  public.unread_announcement_count(uuid) to authenticated;
