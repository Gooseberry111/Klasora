-- =============================================================================
-- Klasora · 1000 · Phase 2: school setup
--
-- Academic years, terms or semesters, departments (also used for sections and
-- faculties), classes, subjects and class subject assignments, plus the school
-- profile additions, campus plan limits and product tour progress.
--
-- Every table follows the Phase 1 rules: a school_id on each row, composite
-- foreign keys so rows can only reference records in the same school, RLS on
-- every table, and audit triggers on every change.
-- =============================================================================

create type public.academic_period_status as enum ('planned', 'active', 'completed');
create type public.department_kind as enum ('department', 'section', 'faculty');

-- -----------------------------------------------------------------------------
-- School profile additions
-- -----------------------------------------------------------------------------
alter table public.schools
  add column motto text check (char_length(motto) <= 200),
  add column setup_completed_at timestamptz;

grant update (motto, setup_completed_at) on public.schools to authenticated;

-- -----------------------------------------------------------------------------
-- Product tours: which walkthroughs a person has finished (for example
-- 'web_welcome_v1'). Kept on the profile so it follows them across devices.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column completed_tours text[] not null default '{}'
    check (cardinality(completed_tours) <= 50);

grant update (completed_tours) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- academic_years
-- -----------------------------------------------------------------------------
create table public.academic_years (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  start_date  date not null,
  end_date    date not null,
  status      public.academic_period_status not null default 'planned',
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint academic_years_dates check (end_date > start_date and end_date - start_date <= 731),
  constraint academic_years_name_unique unique (school_id, name),
  constraint academic_years_id_school_unique unique (id, school_id)
);
create unique index academic_years_one_current on public.academic_years (school_id) where is_current;
create index academic_years_school_idx on public.academic_years (school_id, start_date desc);

-- -----------------------------------------------------------------------------
-- academic_terms (shown as terms or semesters depending on the structure)
-- -----------------------------------------------------------------------------
create table public.academic_terms (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  academic_year_id uuid not null,
  name             text not null check (char_length(trim(name)) between 1 and 60),
  sequence         smallint not null check (sequence between 1 and 12),
  start_date       date not null,
  end_date         date not null,
  status           public.academic_period_status not null default 'planned',
  is_current       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint academic_terms_year_fk
    foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete cascade,
  constraint academic_terms_dates check (end_date > start_date),
  constraint academic_terms_name_unique unique (academic_year_id, name),
  constraint academic_terms_sequence_unique unique (academic_year_id, sequence),
  constraint academic_terms_id_school_unique unique (id, school_id)
);
create unique index academic_terms_one_current on public.academic_terms (school_id) where is_current;
create index academic_terms_year_idx on public.academic_terms (academic_year_id, sequence);

-- A term must sit inside its academic year.
create or replace function app.check_term_within_year()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_year public.academic_years;
begin
  select * into v_year from public.academic_years where id = new.academic_year_id;
  if new.start_date < v_year.start_date or new.end_date > v_year.end_date then
    raise exception 'Dates must fall within the academic year (% to %).',
      to_char(v_year.start_date, 'DD Mon YYYY'), to_char(v_year.end_date, 'DD Mon YYYY')
      using errcode = 'KL400';
  end if;
  return new;
end;
$$;

create trigger academic_terms_within_year
  before insert or update of start_date, end_date, academic_year_id on public.academic_terms
  for each row execute function app.check_term_within_year();

-- Shrinking a year must not leave its terms outside it.
create or replace function app.check_year_contains_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.academic_terms t
    where t.academic_year_id = new.id
      and (t.start_date < new.start_date or t.end_date > new.end_date)
  ) then
    raise exception 'Some terms fall outside these dates. Adjust the terms first.' using errcode = 'KL400';
  end if;
  return new;
end;
$$;

create trigger academic_years_contain_terms
  before update of start_date, end_date on public.academic_years
  for each row execute function app.check_year_contains_terms();

-- -----------------------------------------------------------------------------
-- departments (kind: department, section or faculty)
-- -----------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  campus_id   uuid,
  parent_id   uuid,
  kind        public.department_kind not null default 'department',
  name        text not null check (char_length(trim(name)) between 1 and 120),
  code        text check (code ~ '^[A-Z0-9][A-Z0-9_]{0,19}$'),
  description text check (char_length(description) <= 500),
  status      public.record_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint departments_campus_fk
    foreign key (campus_id, school_id) references public.campuses (id, school_id) on delete set null (campus_id),
  constraint departments_parent_fk
    foreign key (parent_id, school_id) references public.departments (id, school_id) on delete restrict,
  constraint departments_not_own_parent check (parent_id is null or parent_id <> id),
  constraint departments_name_unique unique (school_id, name),
  constraint departments_code_unique unique (school_id, code),
  constraint departments_id_school_unique unique (id, school_id)
);
create index departments_school_idx on public.departments (school_id, kind, name);
create index departments_parent_idx on public.departments (parent_id);
create index departments_campus_idx on public.departments (campus_id);

-- Only departments may sit inside a faculty; sections and faculties are top level.
create or replace function app.check_department_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_kind public.department_kind;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.kind <> 'department' then
    raise exception 'Only departments can belong to a faculty.' using errcode = 'KL400';
  end if;
  select kind into v_parent_kind from public.departments where id = new.parent_id;
  if v_parent_kind is distinct from 'faculty' then
    raise exception 'A department can only belong to a faculty.' using errcode = 'KL400';
  end if;
  return new;
end;
$$;

create trigger departments_check_parent
  before insert or update of parent_id, kind on public.departments
  for each row execute function app.check_department_parent();

-- -----------------------------------------------------------------------------
-- classes
-- -----------------------------------------------------------------------------
create table public.classes (
  id                          uuid primary key default gen_random_uuid(),
  school_id                   uuid not null references public.schools (id) on delete cascade,
  campus_id                   uuid not null,
  department_id               uuid,
  academic_year_id            uuid,
  name                        text not null check (char_length(trim(name)) between 1 and 80),
  level                       text check (char_length(level) <= 60),
  level_order                 smallint not null default 0 check (level_order between 0 and 999),
  class_teacher_membership_id uuid,
  capacity                    integer check (capacity between 1 and 5000),
  status                      public.record_status not null default 'active',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint classes_campus_fk
    foreign key (campus_id, school_id) references public.campuses (id, school_id) on delete restrict,
  constraint classes_department_fk
    foreign key (department_id, school_id) references public.departments (id, school_id) on delete set null (department_id),
  constraint classes_year_fk
    foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete restrict,
  constraint classes_teacher_fk
    foreign key (class_teacher_membership_id, school_id) references public.school_memberships (id, school_id)
    on delete set null (class_teacher_membership_id),
  constraint classes_name_unique unique nulls not distinct (school_id, campus_id, academic_year_id, name),
  constraint classes_id_school_unique unique (id, school_id)
);
create index classes_school_idx on public.classes (school_id, level_order, name);
create index classes_campus_idx on public.classes (campus_id);
create index classes_department_idx on public.classes (department_id);
create index classes_year_idx on public.classes (academic_year_id);
create index classes_teacher_idx on public.classes (class_teacher_membership_id);

-- -----------------------------------------------------------------------------
-- subjects
-- -----------------------------------------------------------------------------
create table public.subjects (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id) on delete cascade,
  department_id uuid,
  name          text not null check (char_length(trim(name)) between 1 and 120),
  code          text not null check (code ~ '^[A-Z0-9][A-Z0-9_]{0,19}$'),
  description   text check (char_length(description) <= 500),
  status        public.record_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint subjects_department_fk
    foreign key (department_id, school_id) references public.departments (id, school_id) on delete set null (department_id),
  constraint subjects_code_unique unique (school_id, code),
  constraint subjects_name_unique unique (school_id, name),
  constraint subjects_id_school_unique unique (id, school_id)
);
create index subjects_school_idx on public.subjects (school_id, name);
create index subjects_department_idx on public.subjects (department_id);

-- -----------------------------------------------------------------------------
-- class_subjects: which subjects a class takes, and who teaches each one.
-- -----------------------------------------------------------------------------
create table public.class_subjects (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references public.schools (id) on delete cascade,
  class_id              uuid not null,
  subject_id            uuid not null,
  teacher_membership_id uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint class_subjects_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete cascade,
  constraint class_subjects_subject_fk
    foreign key (subject_id, school_id) references public.subjects (id, school_id) on delete cascade,
  constraint class_subjects_teacher_fk
    foreign key (teacher_membership_id, school_id) references public.school_memberships (id, school_id)
    on delete set null (teacher_membership_id),
  constraint class_subjects_unique unique (class_id, subject_id)
);
create index class_subjects_subject_idx on public.class_subjects (subject_id);
create index class_subjects_teacher_idx on public.class_subjects (teacher_membership_id);

-- -----------------------------------------------------------------------------
-- Housekeeping triggers: updated_at, immutable school_id, auditing.
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'academic_years', 'academic_terms', 'departments', 'classes', 'subjects', 'class_subjects'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app.set_updated_at()',
      v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function app.prevent_school_change()',
      v_table || '_prevent_school_change', v_table);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_row_change()',
      v_table || '_audit', v_table);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Campus plan limit: a school cannot add more campuses than its plan allows.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_campus_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  -- Triggers run before RLS checks. Callers who may not add campuses are left
  -- to RLS, so they get a plain denial and learn nothing about the plan.
  if not app.can_write(new.school_id, 'settings.edit') then
    return new;
  end if;

  select p.maximum_campuses into v_limit
  from public.school_subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.school_id = new.school_id;

  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count from public.campuses where school_id = new.school_id;
  if v_count >= v_limit then
    raise exception 'Your plan includes % campus%. Upgrade your plan to add another.',
      v_limit, case when v_limit = 1 then '' else 'es' end
      using errcode = 'KL409';
  end if;
  return new;
end;
$$;

create trigger campuses_enforce_limit
  before insert on public.campuses
  for each row execute function app.enforce_campus_limit();

-- The main campus stays active.
create or replace function app.keep_main_campus_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_main and new.status <> 'active' then
    raise exception 'The main campus must stay active. Make another campus the main campus first.'
      using errcode = 'KL400';
  end if;
  return new;
end;
$$;

create trigger campuses_keep_main_active
  before update on public.campuses
  for each row execute function app.keep_main_campus_active();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.academic_years enable row level security;
alter table public.academic_terms enable row level security;
alter table public.departments    enable row level security;
alter table public.classes        enable row level security;
alter table public.subjects       enable row level security;
alter table public.class_subjects enable row level security;

revoke all on public.academic_years, public.academic_terms, public.departments,
              public.classes, public.subjects, public.class_subjects
  from anon, authenticated;

-- Academic calendar: every member can see it (dates are not sensitive and
-- every role needs to know the current term). Only academic staff change it.
grant select, delete on public.academic_years to authenticated;
grant insert (school_id, name, start_date, end_date, status) on public.academic_years to authenticated;
grant update (name, start_date, end_date, status) on public.academic_years to authenticated;

create policy academic_years_select on public.academic_years
  for select to authenticated using (app.is_school_member(school_id));
create policy academic_years_insert on public.academic_years
  for insert to authenticated with check (app.can_write(school_id, 'academics.create'));
create policy academic_years_update on public.academic_years
  for update to authenticated
  using (app.can_write(school_id, 'academics.edit'))
  with check (app.can_write(school_id, 'academics.edit'));
create policy academic_years_delete on public.academic_years
  for delete to authenticated using (app.can_write(school_id, 'academics.delete') and not is_current);

grant select, delete on public.academic_terms to authenticated;
grant insert (school_id, academic_year_id, name, sequence, start_date, end_date, status)
  on public.academic_terms to authenticated;
grant update (name, sequence, start_date, end_date, status) on public.academic_terms to authenticated;

create policy academic_terms_select on public.academic_terms
  for select to authenticated using (app.is_school_member(school_id));
create policy academic_terms_insert on public.academic_terms
  for insert to authenticated with check (app.can_write(school_id, 'academics.create'));
create policy academic_terms_update on public.academic_terms
  for update to authenticated
  using (app.can_write(school_id, 'academics.edit'))
  with check (app.can_write(school_id, 'academics.edit'));
create policy academic_terms_delete on public.academic_terms
  for delete to authenticated using (app.can_write(school_id, 'academics.delete') and not is_current);

-- Structure: visible to people who may view academics.
grant select, delete on public.departments to authenticated;
grant insert (school_id, campus_id, parent_id, kind, name, code, description, status)
  on public.departments to authenticated;
grant update (campus_id, parent_id, kind, name, code, description, status) on public.departments to authenticated;

create policy departments_select on public.departments
  for select to authenticated using (app.has_permission(school_id, 'academics.view'));
create policy departments_insert on public.departments
  for insert to authenticated with check (app.can_write(school_id, 'academics.create'));
create policy departments_update on public.departments
  for update to authenticated
  using (app.can_write(school_id, 'academics.edit'))
  with check (app.can_write(school_id, 'academics.edit'));
create policy departments_delete on public.departments
  for delete to authenticated using (app.can_write(school_id, 'academics.delete'));

grant select, delete on public.classes to authenticated;
grant insert (school_id, campus_id, department_id, academic_year_id, name, level, level_order,
              class_teacher_membership_id, capacity, status)
  on public.classes to authenticated;
grant update (campus_id, department_id, academic_year_id, name, level, level_order,
              class_teacher_membership_id, capacity, status)
  on public.classes to authenticated;

create policy classes_select on public.classes
  for select to authenticated using (app.has_permission(school_id, 'academics.view'));
create policy classes_insert on public.classes
  for insert to authenticated with check (app.can_write(school_id, 'academics.create'));
create policy classes_update on public.classes
  for update to authenticated
  using (app.can_write(school_id, 'academics.edit'))
  with check (app.can_write(school_id, 'academics.edit'));
create policy classes_delete on public.classes
  for delete to authenticated using (app.can_write(school_id, 'academics.delete'));

grant select, delete on public.subjects to authenticated;
grant insert (school_id, department_id, name, code, description, status) on public.subjects to authenticated;
grant update (department_id, name, code, description, status) on public.subjects to authenticated;

create policy subjects_select on public.subjects
  for select to authenticated using (app.has_permission(school_id, 'academics.view'));
create policy subjects_insert on public.subjects
  for insert to authenticated with check (app.can_write(school_id, 'academics.create'));
create policy subjects_update on public.subjects
  for update to authenticated
  using (app.can_write(school_id, 'academics.edit'))
  with check (app.can_write(school_id, 'academics.edit'));
create policy subjects_delete on public.subjects
  for delete to authenticated using (app.can_write(school_id, 'academics.delete'));

grant select, delete on public.class_subjects to authenticated;
grant insert (school_id, class_id, subject_id, teacher_membership_id) on public.class_subjects to authenticated;
grant update (teacher_membership_id) on public.class_subjects to authenticated;

create policy class_subjects_select on public.class_subjects
  for select to authenticated using (app.has_permission(school_id, 'academics.view'));
create policy class_subjects_insert on public.class_subjects
  for insert to authenticated with check (app.can_write(school_id, 'academics.edit'));
create policy class_subjects_update on public.class_subjects
  for update to authenticated
  using (app.can_write(school_id, 'academics.edit'))
  with check (app.can_write(school_id, 'academics.edit'));
create policy class_subjects_delete on public.class_subjects
  for delete to authenticated using (app.can_write(school_id, 'academics.edit'));

-- =============================================================================
-- RPCs
-- =============================================================================

-- Makes one academic year the current one (and only that one).
create or replace function public.set_current_academic_year(p_year_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year public.academic_years;
begin
  select * into v_year from public.academic_years where id = p_year_id;
  if not found or not app.is_school_member(v_year.school_id) then
    raise exception 'This academic year could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_year.school_id, 'academics.edit') then
    raise exception 'You do not have permission to change the academic calendar.' using errcode = 'KL403';
  end if;

  -- A current term from another year stops being current.
  update public.academic_terms set is_current = false
  where school_id = v_year.school_id and is_current and academic_year_id <> p_year_id;
  update public.academic_years set is_current = false
  where school_id = v_year.school_id and is_current and id <> p_year_id;
  update public.academic_years
  set is_current = true, status = case when status = 'planned' then 'active' else status end
  where id = p_year_id;
end;
$$;

-- Makes one term current; its academic year becomes current too.
create or replace function public.set_current_term(p_term_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term public.academic_terms;
begin
  select * into v_term from public.academic_terms where id = p_term_id;
  if not found or not app.is_school_member(v_term.school_id) then
    raise exception 'This term could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_term.school_id, 'academics.edit') then
    raise exception 'You do not have permission to change the academic calendar.' using errcode = 'KL403';
  end if;

  perform public.set_current_academic_year(v_term.academic_year_id);
  update public.academic_terms set is_current = false
  where school_id = v_term.school_id and is_current and id <> p_term_id;
  update public.academic_terms
  set is_current = true, status = case when status = 'planned' then 'active' else status end
  where id = p_term_id;
end;
$$;

-- Moves the "main campus" flag to another active campus.
create or replace function public.set_main_campus(p_campus_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campus public.campuses;
begin
  select * into v_campus from public.campuses where id = p_campus_id;
  if not found or not app.is_school_member(v_campus.school_id) then
    raise exception 'This campus could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_campus.school_id, 'settings.edit') then
    raise exception 'You do not have permission to manage campuses.' using errcode = 'KL403';
  end if;
  if v_campus.status <> 'active' then
    raise exception 'Only an active campus can be the main campus.' using errcode = 'KL400';
  end if;

  update public.campuses set is_main = false where school_id = v_campus.school_id and is_main and id <> p_campus_id;
  update public.campuses set is_main = true where id = p_campus_id;
end;
$$;

-- People in the school with their roles, for the staff directory and for
-- choosing class teachers and subject teachers.
create or replace function public.list_school_members(p_school_id uuid)
returns table (
  membership_id uuid,
  user_id       uuid,
  first_name    text,
  last_name     text,
  email         text,
  avatar_url    text,
  role_id       uuid,
  role_name     text,
  role_key      text,
  campus_id     uuid,
  status        public.membership_status,
  joined_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_permission(p_school_id, 'staff.view') or app.has_permission(p_school_id, 'academics.edit')) then
    raise exception 'You do not have permission to view people in this school.' using errcode = 'KL403';
  end if;

  return query
  select m.id, m.user_id, p.first_name, p.last_name, p.email, p.avatar_url,
         r.id, r.name, r.role_key, m.campus_id, m.status, m.joined_at
  from public.school_memberships m
  join public.profiles p on p.id = m.user_id
  join public.roles r on r.id = m.role_id
  left join public.system_role_templates t on t.role_key = r.role_key
  where m.school_id = p_school_id
  order by (m.status = 'active') desc, coalesce(t.sort_order, 1000), lower(p.first_name), lower(p.last_name);
end;
$$;

-- Counts behind the setup guide and dashboard. Any member may see them.
create or replace function public.get_setup_progress(p_school_id uuid)
returns table (
  campuses            integer,
  academic_years      integer,
  has_current_year    boolean,
  terms               integer,
  has_current_term    boolean,
  departments         integer,
  classes             integer,
  subjects            integer,
  class_subjects      integer,
  members             integer,
  pending_invitations integer,
  has_logo            boolean,
  setup_completed_at  timestamptz
)
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
  select
    (select count(*)::int from public.campuses c where c.school_id = p_school_id and c.status = 'active'),
    (select count(*)::int from public.academic_years y where y.school_id = p_school_id),
    exists (select 1 from public.academic_years y where y.school_id = p_school_id and y.is_current),
    (select count(*)::int from public.academic_terms t where t.school_id = p_school_id),
    exists (select 1 from public.academic_terms t where t.school_id = p_school_id and t.is_current),
    (select count(*)::int from public.departments d where d.school_id = p_school_id),
    (select count(*)::int from public.classes k where k.school_id = p_school_id and k.status = 'active'),
    (select count(*)::int from public.subjects s where s.school_id = p_school_id and s.status = 'active'),
    (select count(*)::int from public.class_subjects cs where cs.school_id = p_school_id),
    (select count(distinct m.user_id)::int from public.school_memberships m
       where m.school_id = p_school_id and m.status = 'active'),
    (select count(*)::int from public.invitations i
       where i.school_id = p_school_id and i.status = 'pending' and i.expires_at > now()),
    (select s.logo_url is not null from public.schools s where s.id = p_school_id),
    (select s.setup_completed_at from public.schools s where s.id = p_school_id);
end;
$$;

revoke all on function public.set_current_academic_year(uuid) from public, anon;
revoke all on function public.set_current_term(uuid) from public, anon;
revoke all on function public.set_main_campus(uuid) from public, anon;
revoke all on function public.list_school_members(uuid) from public, anon;
revoke all on function public.get_setup_progress(uuid) from public, anon;
revoke all on function app.check_term_within_year() from public;
revoke all on function app.check_year_contains_terms() from public;
revoke all on function app.check_department_parent() from public;
revoke all on function app.enforce_campus_limit() from public;
revoke all on function app.keep_main_campus_active() from public;

grant execute on function public.set_current_academic_year(uuid) to authenticated;
grant execute on function public.set_current_term(uuid) to authenticated;
grant execute on function public.set_main_campus(uuid) to authenticated;
grant execute on function public.list_school_members(uuid) to authenticated;
grant execute on function public.get_setup_progress(uuid) to authenticated;
