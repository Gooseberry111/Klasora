-- =============================================================================
-- Klasora · Phase 4b · Assignments, submissions and student portal accounts
-- =============================================================================

create type public.assignment_status as enum ('draft', 'published', 'closed', 'graded');
create type public.submission_status as enum ('submitted', 'returned', 'graded');

-- =============================================================================
-- Student portal accounts
-- =============================================================================
alter table public.invitations add column student_id uuid;
alter table public.invitations
  add constraint invitations_student_fk
  foreign key (student_id, school_id) references public.students (id, school_id) on delete set null (student_id);
grant select (student_id) on public.invitations to authenticated;

create or replace function public.invite_student(p_student_id uuid, p_email text)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_role    uuid;
  v_token   text;
  v_id      uuid;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found or not app.has_permission(v_student.school_id, 'students.view') then
    raise exception 'This student could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_student.school_id, 'students.edit') then
    raise exception 'You do not have permission to invite students.' using errcode = 'KL403';
  end if;
  if v_student.user_id is not null then
    raise exception 'This student already has portal access.' using errcode = 'KL409';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address for the student.' using errcode = 'KL400';
  end if;
  select id into v_role from public.roles where school_id = v_student.school_id and role_key = 'student';

  update public.invitations
  set status = 'revoked'
  where school_id = v_student.school_id and status = 'pending'
    and (student_id = v_student.id or (lower(email) = v_email and role_id = v_role));

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations (school_id, email, role_id, campus_id, token_hash, invited_by, student_id)
  values (v_student.school_id, v_email, v_role, v_student.campus_id,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), v_student.id)
  returning id into v_id;
  return query select v_id, v_token;
end;
$$;

-- The signed in person's own student record in a school, if they are a student.
create or replace function public.get_my_student(p_school_id uuid)
returns table (student_id uuid, first_name text, last_name text, admission_number text, photo_path text, class_id uuid, class_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.first_name, s.last_name, s.admission_number, s.photo_path, c.id, c.name
  from public.students s
  join public.school_memberships m on m.school_id = s.school_id and m.user_id = s.user_id and m.status = 'active'
  left join public.class_enrollments e on e.student_id = s.id and e.status = 'active'
  left join public.classes c on c.id = e.class_id
  where s.school_id = p_school_id and s.user_id = auth.uid()
  limit 1;
$$;

-- =============================================================================
-- Assignments
-- =============================================================================
create table public.assignments (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references public.schools (id) on delete cascade,
  class_id              uuid not null,
  subject_id            uuid not null,
  teacher_membership_id uuid,
  title                 text not null check (char_length(trim(title)) between 1 and 200),
  description           text check (char_length(description) <= 10000),
  attachment_paths      text[] not null default '{}' check (cardinality(attachment_paths) <= 10),
  due_at                timestamptz not null,
  maximum_score         numeric(6, 2) check (maximum_score > 0),
  allow_late            boolean not null default false,
  status                public.assignment_status not null default 'draft',
  published_at          timestamptz,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint assignments_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete cascade,
  constraint assignments_subject_fk
    foreign key (subject_id, school_id) references public.subjects (id, school_id) on delete cascade,
  constraint assignments_teacher_fk
    foreign key (teacher_membership_id, school_id) references public.school_memberships (id, school_id)
    on delete set null (teacher_membership_id),
  constraint assignments_id_school_unique unique (id, school_id)
);
create index assignments_class_idx on public.assignments (class_id, due_at desc);
create index assignments_school_idx on public.assignments (school_id, status, due_at desc);

create table public.assignment_submissions (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  assignment_id    uuid not null,
  student_id       uuid not null,
  body             text check (char_length(body) <= 20000),
  attachment_paths text[] not null default '{}' check (cardinality(attachment_paths) <= 10),
  status           public.submission_status not null default 'submitted',
  submitted_at     timestamptz,
  is_late          boolean not null default false,
  score            numeric(6, 2) check (score >= 0),
  feedback         text check (char_length(feedback) <= 5000),
  graded_by        uuid references public.profiles (id) on delete set null,
  graded_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint assignment_submissions_assignment_fk
    foreign key (assignment_id, school_id) references public.assignments (id, school_id) on delete cascade,
  constraint assignment_submissions_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  constraint assignment_submissions_unique unique (assignment_id, student_id)
);
create index assignment_submissions_student_idx on public.assignment_submissions (student_id);

-- Keeps published_at in step with status.
create or replace function app.stamp_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger assignments_stamp before insert or update of status on public.assignments
  for each row execute function app.stamp_assignment();

do $$
declare
  v_table text;
begin
  foreach v_table in array array['assignments', 'assignment_submissions'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', v_table || '_set_updated_at', v_table);
    execute format('create trigger %I before update on public.%I for each row execute function app.prevent_school_change()', v_table || '_prevent_school_change', v_table);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row_change()', v_table || '_audit', v_table);
  end loop;
end;
$$;

-- The caller may manage work for this class: they teach it, or run academics.
create or replace function app.can_manage_class_work(p_school_id uuid, p_class_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_write(p_school_id, p_permission)
     and (app.teaches_class(p_class_id) or app.has_permission(p_school_id, 'academics.edit'));
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.assignments            enable row level security;
alter table public.assignment_submissions enable row level security;
revoke all on public.assignments, public.assignment_submissions from anon, authenticated;

grant select, delete on public.assignments to authenticated;
grant insert (school_id, class_id, subject_id, teacher_membership_id, title, description, attachment_paths, due_at,
              maximum_score, allow_late, status)
  on public.assignments to authenticated;
grant update (subject_id, title, description, attachment_paths, due_at, maximum_score, allow_late, status)
  on public.assignments to authenticated;

create policy assignments_select on public.assignments
  for select to authenticated
  using (
    app.staff_can_see_class(school_id, class_id, 'assignments.view')
    or (status <> 'draft' and app.is_family_of_class(class_id))
  );
create policy assignments_insert on public.assignments
  for insert to authenticated with check (app.can_manage_class_work(school_id, class_id, 'assignments.create'));
create policy assignments_update on public.assignments
  for update to authenticated
  using (app.can_manage_class_work(school_id, class_id, 'assignments.edit'))
  with check (app.can_manage_class_work(school_id, class_id, 'assignments.edit'));
create policy assignments_delete on public.assignments
  for delete to authenticated using (app.can_manage_class_work(school_id, class_id, 'assignments.delete'));

-- Submissions: written through submit_assignment() and grade_submission().
grant select on public.assignment_submissions to authenticated;

create policy assignment_submissions_select on public.assignment_submissions
  for select to authenticated
  using (
    app.is_student_self(student_id) or app.is_guardian_of(student_id)
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_id and app.staff_can_see_class(a.school_id, a.class_id, 'assignments.view')
    )
  );

-- =============================================================================
-- RPCs
-- =============================================================================

-- A student hands in (or resubmits) their work.
create or replace function public.submit_assignment(p_assignment_id uuid, p_body text, p_files text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
  v_student    uuid;
  v_existing   public.assignment_submissions;
  v_prefix     text;
  v_file       text;
  v_id         uuid;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id;
  if not found then
    raise exception 'This assignment could not be found.' using errcode = 'KL404';
  end if;
  select s.id into v_student
  from public.students s
  join public.class_enrollments e on e.student_id = s.id and e.class_id = v_assignment.class_id and e.status = 'active'
  where s.school_id = v_assignment.school_id and s.user_id = auth.uid() and app.is_student_self(s.id);
  if v_student is null or v_assignment.status = 'draft' then
    raise exception 'This assignment could not be found.' using errcode = 'KL404';
  end if;
  if not app.school_is_writable(v_assignment.school_id) then
    raise exception 'Your school is not accepting changes right now.' using errcode = 'KL403';
  end if;
  if v_assignment.status in ('closed', 'graded') then
    raise exception 'This assignment is closed for submissions.' using errcode = 'KL409';
  end if;
  if now() > v_assignment.due_at and not v_assignment.allow_late then
    raise exception 'The deadline has passed, so this assignment can no longer be submitted.' using errcode = 'KL409';
  end if;
  if coalesce(trim(p_body), '') = '' and coalesce(cardinality(p_files), 0) = 0 then
    raise exception 'Write an answer or attach a file before submitting.' using errcode = 'KL400';
  end if;

  v_prefix := v_assignment.school_id || '/submissions/' || v_assignment.id || '/' || v_student || '/';
  foreach v_file in array coalesce(p_files, '{}') loop
    if left(v_file, length(v_prefix)) <> v_prefix then
      raise exception 'One of the attached files is not valid.' using errcode = 'KL400';
    end if;
  end loop;

  select * into v_existing from public.assignment_submissions where assignment_id = p_assignment_id and student_id = v_student;
  if found and v_existing.status = 'graded' then
    raise exception 'This work has already been graded.' using errcode = 'KL409';
  end if;

  insert into public.assignment_submissions (school_id, assignment_id, student_id, body, attachment_paths, status, submitted_at, is_late)
  values (v_assignment.school_id, p_assignment_id, v_student, nullif(trim(p_body), ''), coalesce(p_files, '{}'),
          'submitted', now(), now() > v_assignment.due_at)
  on conflict (assignment_id, student_id) do update
    set body = excluded.body, attachment_paths = excluded.attachment_paths, status = 'submitted',
        submitted_at = now(), is_late = excluded.is_late
  returning id into v_id;
  return v_id;
end;
$$;

-- A teacher grades work, or returns it for correction. Work handed in on
-- paper can be graded without an online submission.
create or replace function public.grade_submission(
  p_assignment_id uuid,
  p_student_id    uuid,
  p_score         numeric,
  p_feedback      text,
  p_return        boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id;
  if not found or not app.staff_can_see_class(v_assignment.school_id, v_assignment.class_id, 'assignments.view') then
    raise exception 'This assignment could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_manage_class_work(v_assignment.school_id, v_assignment.class_id, 'assignments.edit') then
    raise exception 'Only the teachers of this class can grade its work.' using errcode = 'KL403';
  end if;
  if not exists (select 1 from public.class_enrollments e where e.student_id = p_student_id and e.class_id = v_assignment.class_id) then
    raise exception 'This student is not in the class.' using errcode = 'KL400';
  end if;
  if p_score is not null and (p_score < 0 or (v_assignment.maximum_score is not null and p_score > v_assignment.maximum_score)) then
    raise exception 'The score must be between 0 and %.', v_assignment.maximum_score using errcode = 'KL400';
  end if;

  if p_return then
    update public.assignment_submissions
    set status = 'returned', feedback = nullif(trim(p_feedback), ''), graded_by = auth.uid(), graded_at = now()
    where assignment_id = p_assignment_id and student_id = p_student_id;
    if not found then
      raise exception 'There is no submission to return.' using errcode = 'KL409';
    end if;
    return;
  end if;

  insert into public.assignment_submissions (school_id, assignment_id, student_id, status, score, feedback, graded_by, graded_at)
  values (v_assignment.school_id, p_assignment_id, p_student_id, 'graded', p_score, nullif(trim(p_feedback), ''), auth.uid(), now())
  on conflict (assignment_id, student_id) do update
    set status = 'graded', score = excluded.score, feedback = excluded.feedback, graded_by = auth.uid(), graded_at = now();
end;
$$;

revoke all on function app.can_manage_class_work(uuid, uuid, text), app.stamp_assignment() from public;
grant execute on function app.can_manage_class_work(uuid, uuid, text) to authenticated;
revoke all on function public.invite_student(uuid, text), public.get_my_student(uuid),
  public.submit_assignment(uuid, text, text[]), public.grade_submission(uuid, uuid, numeric, text, boolean) from public, anon;
grant execute on function public.invite_student(uuid, text), public.get_my_student(uuid),
  public.submit_assignment(uuid, text, text[]), public.grade_submission(uuid, uuid, numeric, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- accept_invitation: as in 1300, plus linking student accounts.
-- -----------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_invitation public.invitations;
  v_user_email text;
  v_confirmed  timestamptz;
begin
  if v_user is null then
    raise exception 'Please sign in to accept this invitation.' using errcode = 'KL403';
  end if;

  select * into v_invitation
  from public.invitations
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  for update;
  if not found then
    raise exception 'This invitation link is not valid.' using errcode = 'KL404';
  end if;
  if v_invitation.status = 'accepted' then
    raise exception 'This invitation has already been accepted.' using errcode = 'KL409';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'This invitation is no longer active. Ask the school to send a new one.' using errcode = 'KL409';
  end if;
  -- Expiry is evaluated at read time (see get_invitation_preview); a scheduled
  -- job can mark stale rows 'expired' for housekeeping.
  if v_invitation.expires_at <= now() then
    raise exception 'This invitation has expired. Ask the school to send a new one.' using errcode = 'KL409';
  end if;

  select lower(u.email), u.email_confirmed_at into v_user_email, v_confirmed
  from auth.users u where u.id = v_user;
  if v_user_email is distinct from lower(v_invitation.email) then
    raise exception 'This invitation was sent to a different email address. Sign in with %.', v_invitation.email
      using errcode = 'KL403';
  end if;
  if v_confirmed is null then
    raise exception 'Please verify your email address before accepting this invitation.' using errcode = 'KL403';
  end if;
  if not app.school_is_writable(v_invitation.school_id) then
    raise exception 'This school is not accepting new members right now.' using errcode = 'KL403';
  end if;

  insert into public.school_memberships (school_id, user_id, role_id, campus_id, status, invited_by, joined_at)
  values (v_invitation.school_id, v_user, v_invitation.role_id, v_invitation.campus_id, 'active',
          v_invitation.invited_by, now())
  on conflict (school_id, user_id, role_id) do update
    set status = 'active',
        campus_id = excluded.campus_id,
        joined_at = coalesce(public.school_memberships.joined_at, excluded.joined_at);

  -- A guardian invitation links the new account to the guardian record.
  if v_invitation.guardian_id is not null then
    update public.guardians g
    set user_id = v_user
    where g.id = v_invitation.guardian_id
      and (g.user_id is null or g.user_id = v_user)
      and not exists (
        select 1 from public.guardians other
        where other.school_id = g.school_id and other.user_id = v_user and other.id <> g.id
      );
  end if;

  -- A student invitation links the new account to the student record.
  if v_invitation.student_id is not null then
    update public.students s
    set user_id = v_user
    where s.id = v_invitation.student_id
      and (s.user_id is null or s.user_id = v_user)
      and not exists (
        select 1 from public.students other
        where other.school_id = s.school_id and other.user_id = v_user and other.id <> s.id
      );
  end if;

  update public.invitations
  set status = 'accepted', accepted_by = v_user, accepted_at = now()
  where id = v_invitation.id;

  return v_invitation.school_id;
end;
$$;
