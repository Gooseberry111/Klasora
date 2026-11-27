-- =============================================================================
-- Klasora · 1300 · Phase 3: students, guardians, enrolment and staff profiles
--
-- Access model for people records:
--   * Staff with students.view see every student in their school.
--   * Teachers see only students actively enrolled in classes they teach
--     (as class teacher or subject teacher).
--   * Guardians see only children explicitly linked to them.
--   * A student with an account sees only their own record.
--   * Health and welfare details need student_health.view (or being the
--     child's guardian), and are audited without storing their values.
-- =============================================================================

create type public.student_status as enum ('applicant', 'active', 'suspended', 'graduated', 'withdrawn', 'transferred');
create type public.gender as enum ('female', 'male');
create type public.enrollment_status as enum ('active', 'completed', 'withdrawn', 'transferred');
create type public.employment_status as enum ('active', 'on_leave', 'left');
create type public.employment_type as enum ('full_time', 'part_time', 'contract', 'volunteer');

-- -----------------------------------------------------------------------------
-- New permissions: student health and welfare.
-- -----------------------------------------------------------------------------
insert into public.permissions (permission_key, module, action, description) values
  ('student_health.view', 'student_health', 'view', 'View medical, accessibility and emergency details'),
  ('student_health.edit', 'student_health', 'edit', 'Record medical, accessibility and emergency details');

insert into public.system_role_template_permissions (role_key, permission_key) values
  ('school_admin', 'student_health.view'),
  ('school_admin', 'student_health.edit'),
  ('principal', 'student_health.view');

-- Existing schools get the same defaults on their standard roles.
insert into public.role_permissions (school_id, role_id, permission_id, allowed)
select r.school_id, r.id, p.id, true
from public.roles r
join public.system_role_template_permissions tp on tp.role_key = r.role_key
join public.permissions p on p.permission_key = tp.permission_key
where r.is_system_role and p.module = 'student_health'
on conflict (role_id, permission_id) do nothing;

-- -----------------------------------------------------------------------------
-- students
-- -----------------------------------------------------------------------------
create table public.students (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  campus_id        uuid not null,
  user_id          uuid references public.profiles (id) on delete set null,
  admission_number text not null check (admission_number ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,29}$'),
  first_name       text not null check (char_length(trim(first_name)) between 1 and 100),
  middle_name      text check (char_length(middle_name) <= 100),
  last_name        text not null check (char_length(trim(last_name)) between 1 and 100),
  date_of_birth    date check (date_of_birth > date '1900-01-01' and date_of_birth <= current_date),
  gender           public.gender,
  admission_date   date not null default current_date,
  status           public.student_status not null default 'active',
  photo_path       text check (char_length(photo_path) <= 500),
  previous_school  text check (char_length(previous_school) <= 200),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint students_campus_fk
    foreign key (campus_id, school_id) references public.campuses (id, school_id) on delete restrict,
  constraint students_id_school_unique unique (id, school_id)
);
create unique index students_admission_number_unique on public.students (school_id, upper(admission_number));
create unique index students_user_unique on public.students (school_id, user_id) where user_id is not null;
create index students_school_idx on public.students (school_id, status, last_name, first_name);
create index students_campus_idx on public.students (campus_id);

-- -----------------------------------------------------------------------------
-- student_details: sensitive health, welfare and contact details, kept in a
-- separate table so they can be protected independently of the profile.
-- -----------------------------------------------------------------------------
create table public.student_details (
  student_id                     uuid primary key,
  school_id                      uuid not null references public.schools (id) on delete cascade,
  home_address                   text check (char_length(home_address) <= 500),
  blood_group                    text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  genotype                       text check (genotype in ('AA', 'AS', 'AC', 'SS', 'SC', 'CC')),
  medical_conditions             text check (char_length(medical_conditions) <= 2000),
  allergies                      text check (char_length(allergies) <= 1000),
  medications                    text check (char_length(medications) <= 1000),
  accessibility_needs            text check (char_length(accessibility_needs) <= 1000),
  emergency_contact_name         text check (char_length(emergency_contact_name) <= 200),
  emergency_contact_phone        text check (char_length(emergency_contact_phone) <= 32),
  emergency_contact_relationship text check (char_length(emergency_contact_relationship) <= 60),
  updated_at                     timestamptz not null default now(),
  constraint student_details_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- guardians and their links to students
-- -----------------------------------------------------------------------------
create table public.guardians (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  first_name  text not null check (char_length(trim(first_name)) between 1 and 100),
  last_name   text not null check (char_length(trim(last_name)) between 1 and 100),
  email       text check (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text check (char_length(phone) <= 32),
  occupation  text check (char_length(occupation) <= 120),
  address     text check (char_length(address) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint guardians_contact_required check (email is not null or phone is not null),
  constraint guardians_id_school_unique unique (id, school_id)
);
create unique index guardians_email_unique on public.guardians (school_id, lower(email)) where email is not null;
create unique index guardians_user_unique on public.guardians (school_id, user_id) where user_id is not null;
create index guardians_school_idx on public.guardians (school_id, last_name, first_name);

create table public.student_guardians (
  id                        uuid primary key default gen_random_uuid(),
  school_id                 uuid not null references public.schools (id) on delete cascade,
  student_id                uuid not null,
  guardian_id               uuid not null,
  relationship              text not null default 'guardian'
                              check (relationship in ('mother', 'father', 'guardian', 'grandparent', 'sibling', 'aunt_uncle', 'sponsor', 'other')),
  is_primary                boolean not null default false,
  is_emergency_contact      boolean not null default false,
  can_view_results          boolean not null default true,
  can_view_finances         boolean not null default true,
  can_receive_notifications boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint student_guardians_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  constraint student_guardians_guardian_fk
    foreign key (guardian_id, school_id) references public.guardians (id, school_id) on delete cascade,
  constraint student_guardians_unique unique (student_id, guardian_id)
);
create unique index student_guardians_one_primary on public.student_guardians (student_id) where is_primary;
create index student_guardians_guardian_idx on public.student_guardians (guardian_id);

-- -----------------------------------------------------------------------------
-- class_enrollments: a student's class history. Moving class closes the old
-- row instead of overwriting it.
-- -----------------------------------------------------------------------------
create table public.class_enrollments (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  student_id       uuid not null,
  class_id         uuid not null,
  academic_year_id uuid,
  start_date       date not null default current_date,
  end_date         date,
  status           public.enrollment_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint class_enrollments_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  constraint class_enrollments_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete restrict,
  constraint class_enrollments_year_fk
    foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete restrict,
  constraint class_enrollments_dates check (end_date is null or end_date >= start_date),
  constraint class_enrollments_active_open check ((status = 'active') = (end_date is null))
);
create unique index class_enrollments_one_active on public.class_enrollments (student_id) where status = 'active';
create index class_enrollments_class_idx on public.class_enrollments (class_id, status);

-- -----------------------------------------------------------------------------
-- staff_profiles: employment details for people who work at the school.
-- -----------------------------------------------------------------------------
create table public.staff_profiles (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references public.schools (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  staff_number          text check (staff_number ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,29}$'),
  job_title             text check (char_length(job_title) <= 120),
  department_id         uuid,
  employment_type       public.employment_type not null default 'full_time',
  employment_status     public.employment_status not null default 'active',
  employment_start_date date,
  qualifications        text check (char_length(qualifications) <= 1000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint staff_profiles_department_fk
    foreign key (department_id, school_id) references public.departments (id, school_id) on delete set null (department_id),
  constraint staff_profiles_person_unique unique (school_id, user_id)
);
create unique index staff_profiles_number_unique on public.staff_profiles (school_id, upper(staff_number)) where staff_number is not null;

create or replace function app.check_staff_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.school_memberships m where m.school_id = new.school_id and m.user_id = new.user_id) then
    raise exception 'This person is not a member of the school.' using errcode = 'KL400';
  end if;
  return new;
end;
$$;

create trigger staff_profiles_check_member
  before insert or update of user_id on public.staff_profiles
  for each row execute function app.check_staff_member();

-- -----------------------------------------------------------------------------
-- Counters for generated numbers (admission numbers per year).
-- -----------------------------------------------------------------------------
create table public.school_counters (
  school_id   uuid not null references public.schools (id) on delete cascade,
  counter_key text not null check (char_length(counter_key) <= 60),
  last_value  integer not null default 0,
  primary key (school_id, counter_key)
);
alter table public.school_counters enable row level security;
revoke all on public.school_counters from anon, authenticated;

create or replace function app.next_counter(p_school_id uuid, p_key text)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.school_counters (school_id, counter_key, last_value)
  values (p_school_id, p_key, 1)
  on conflict (school_id, counter_key) do update set last_value = public.school_counters.last_value + 1
  returning last_value;
$$;

-- -----------------------------------------------------------------------------
-- Invitations can now be tied to a guardian record.
-- -----------------------------------------------------------------------------
alter table public.invitations add column guardian_id uuid;
alter table public.invitations
  add constraint invitations_guardian_fk
  foreign key (guardian_id, school_id) references public.guardians (id, school_id) on delete set null (guardian_id);
grant select (guardian_id) on public.invitations to authenticated;

-- -----------------------------------------------------------------------------
-- Housekeeping triggers
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['students', 'guardians', 'student_guardians', 'class_enrollments', 'staff_profiles'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', v_table || '_set_updated_at', v_table);
    execute format('create trigger %I before update on public.%I for each row execute function app.prevent_school_change()', v_table || '_prevent_school_change', v_table);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row_change()', v_table || '_audit', v_table);
  end loop;
end;
$$;

create trigger student_details_set_updated_at before update on public.student_details
  for each row execute function app.set_updated_at();
create trigger student_details_prevent_school_change before update on public.student_details
  for each row execute function app.prevent_school_change();

-- Health details are audited by field name only, so the audit log never holds medical data.
create or replace function app.audit_redacted_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_changed text[];
begin
  select array_agg(k order by k) into v_changed
  from (select jsonb_object_keys(v_old || v_new) as k) keys
  where k not in ('updated_at', 'school_id', 'student_id')
    and (v_old -> k) is distinct from (v_new -> k);
  if v_changed is null then
    return coalesce(new, old);
  end if;
  insert into public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, previous_data, new_data, ip_address)
  values (
    coalesce(new.school_id, old.school_id), auth.uid(), lower(tg_op), tg_table_name,
    coalesce(new.student_id, old.student_id), null,
    jsonb_build_object('changed_fields', to_jsonb(v_changed), 'student_id', coalesce(new.student_id, old.student_id)),
    app.request_ip()
  );
  return coalesce(new, old);
end;
$$;

create trigger student_details_audit after insert or update or delete on public.student_details
  for each row execute function app.audit_redacted_change();

-- -----------------------------------------------------------------------------
-- Plan limit: active students and applicants may not exceed the plan.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_student_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if not app.can_write(new.school_id, 'students.create') then
    return new;
  end if;
  if new.status not in ('active', 'applicant') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('active', 'applicant') then
    return new;
  end if;
  select p.maximum_students into v_limit
  from public.school_subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.school_id = new.school_id;
  if v_limit is null then
    return new;
  end if;
  select count(*) into v_count from public.students
  where school_id = new.school_id and status in ('active', 'applicant');
  if v_count >= v_limit then
    raise exception 'Your plan includes % students. Upgrade your plan to add more.', v_limit using errcode = 'KL409';
  end if;
  return new;
end;
$$;

create trigger students_enforce_limit
  before insert or update of status on public.students
  for each row execute function app.enforce_student_limit();

-- =============================================================================
-- Relationship helpers used by policies
-- =============================================================================

-- The caller is an active member who is linked to this student as a guardian.
create or replace function app.is_guardian_of(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    join public.school_memberships m on m.school_id = g.school_id and m.user_id = g.user_id and m.status = 'active'
    where sg.student_id = p_student_id and g.user_id = auth.uid()
  );
$$;

-- The caller is this student, signed in with their own account.
create or replace function app.is_student_self(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    join public.school_memberships m on m.school_id = s.school_id and m.user_id = s.user_id and m.status = 'active'
    where s.id = p_student_id and s.user_id = auth.uid()
  );
$$;

-- The caller teaches this class, as class teacher or subject teacher.
create or replace function app.teaches_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classes c
    join public.school_memberships m on m.id = c.class_teacher_membership_id
    where c.id = p_class_id and m.user_id = auth.uid() and m.status = 'active'
  ) or exists (
    select 1 from public.class_subjects cs
    join public.school_memberships m on m.id = cs.teacher_membership_id
    where cs.class_id = p_class_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- The caller teaches a class the student is currently enrolled in.
create or replace function app.teaches_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_enrollments e
    where e.student_id = p_student_id and e.status = 'active' and app.teaches_class(e.class_id)
  );
$$;

create or replace function app.can_view_student(p_student_id uuid, p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_permission(p_school_id, 'students.view')
      or app.is_guardian_of(p_student_id)
      or app.is_student_self(p_student_id)
      or app.teaches_student(p_student_id);
$$;

revoke all on function app.is_guardian_of(uuid), app.is_student_self(uuid), app.teaches_class(uuid),
  app.teaches_student(uuid), app.can_view_student(uuid, uuid), app.next_counter(uuid, text),
  app.check_staff_member(), app.audit_redacted_change(), app.enforce_student_limit() from public;
grant execute on function app.is_guardian_of(uuid), app.is_student_self(uuid), app.teaches_class(uuid),
  app.teaches_student(uuid), app.can_view_student(uuid, uuid) to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.students          enable row level security;
alter table public.student_details   enable row level security;
alter table public.guardians         enable row level security;
alter table public.student_guardians enable row level security;
alter table public.class_enrollments enable row level security;
alter table public.staff_profiles    enable row level security;

revoke all on public.students, public.student_details, public.guardians, public.student_guardians,
              public.class_enrollments, public.staff_profiles
  from anon, authenticated;

-- students: created through register_student(); edited directly.
grant select, delete on public.students to authenticated;
grant update (campus_id, admission_number, first_name, middle_name, last_name, date_of_birth, gender,
              admission_date, status, photo_path, previous_school)
  on public.students to authenticated;

create policy students_select on public.students
  for select to authenticated using (app.can_view_student(id, school_id));
create policy students_update on public.students
  for update to authenticated
  using (app.can_write(school_id, 'students.edit'))
  with check (app.can_write(school_id, 'students.edit'));
create policy students_delete on public.students
  for delete to authenticated using (app.can_write(school_id, 'students.delete'));

-- student_details: health staff and the child's guardians.
grant select on public.student_details to authenticated;
grant insert (student_id, school_id, home_address, blood_group, genotype, medical_conditions, allergies, medications,
              accessibility_needs, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship)
  on public.student_details to authenticated;
grant update (home_address, blood_group, genotype, medical_conditions, allergies, medications, accessibility_needs,
              emergency_contact_name, emergency_contact_phone, emergency_contact_relationship)
  on public.student_details to authenticated;

create policy student_details_select on public.student_details
  for select to authenticated
  using (app.has_permission(school_id, 'student_health.view') or app.is_guardian_of(student_id));
create policy student_details_insert on public.student_details
  for insert to authenticated with check (app.can_write(school_id, 'student_health.edit'));
create policy student_details_update on public.student_details
  for update to authenticated
  using (app.can_write(school_id, 'student_health.edit'))
  with check (app.can_write(school_id, 'student_health.edit'));

-- guardians: student administrators, and guardians themselves.
grant select, delete on public.guardians to authenticated;
grant insert (school_id, first_name, last_name, email, phone, occupation, address) on public.guardians to authenticated;
grant update (first_name, last_name, email, phone, occupation, address) on public.guardians to authenticated;

create policy guardians_select on public.guardians
  for select to authenticated
  using (app.has_permission(school_id, 'students.view') or user_id = (select auth.uid()));
create policy guardians_insert on public.guardians
  for insert to authenticated with check (app.can_write(school_id, 'students.create') or app.can_write(school_id, 'students.edit'));
create policy guardians_update on public.guardians
  for update to authenticated
  using (app.can_write(school_id, 'students.edit'))
  with check (app.can_write(school_id, 'students.edit'));
create policy guardians_delete on public.guardians
  for delete to authenticated using (app.can_write(school_id, 'students.delete'));

-- student_guardians
grant select, delete on public.student_guardians to authenticated;
grant insert (school_id, student_id, guardian_id, relationship, is_primary, is_emergency_contact,
              can_view_results, can_view_finances, can_receive_notifications)
  on public.student_guardians to authenticated;
grant update (relationship, is_primary, is_emergency_contact, can_view_results, can_view_finances, can_receive_notifications)
  on public.student_guardians to authenticated;

create policy student_guardians_select on public.student_guardians
  for select to authenticated
  using (app.has_permission(school_id, 'students.view') or app.is_guardian_of(student_id));
create policy student_guardians_insert on public.student_guardians
  for insert to authenticated with check (app.can_write(school_id, 'students.edit'));
create policy student_guardians_update on public.student_guardians
  for update to authenticated
  using (app.can_write(school_id, 'students.edit'))
  with check (app.can_write(school_id, 'students.edit'));
create policy student_guardians_delete on public.student_guardians
  for delete to authenticated using (app.can_write(school_id, 'students.edit'));

-- class_enrollments: read by anyone who may see the student or teaches the
-- class; changed only through enroll_student() and end_enrollment().
grant select on public.class_enrollments to authenticated;

create policy class_enrollments_select on public.class_enrollments
  for select to authenticated
  using (app.can_view_student(student_id, school_id) or app.teaches_class(class_id));

-- staff_profiles: staff managers, and the person themselves. Never parents or students.
grant select on public.staff_profiles to authenticated;
grant insert (school_id, user_id, staff_number, job_title, department_id, employment_type, employment_status,
              employment_start_date, qualifications)
  on public.staff_profiles to authenticated;
grant update (staff_number, job_title, department_id, employment_type, employment_status, employment_start_date, qualifications)
  on public.staff_profiles to authenticated;

create policy staff_profiles_select on public.staff_profiles
  for select to authenticated
  using (app.has_permission(school_id, 'staff.view') or user_id = (select auth.uid()));
create policy staff_profiles_insert on public.staff_profiles
  for insert to authenticated with check (app.can_write(school_id, 'staff.edit'));
create policy staff_profiles_update on public.staff_profiles
  for update to authenticated
  using (app.can_write(school_id, 'staff.edit'))
  with check (app.can_write(school_id, 'staff.edit'));

-- =============================================================================
-- RPCs
-- =============================================================================

-- Short prefix for admission numbers: the initials of the school name.
create or replace function app.school_initials(p_school_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(upper(string_agg(left(w, 1), '' order by ord)), ''), 'STU')
  from public.schools s,
       lateral regexp_split_to_table(regexp_replace(s.name, '[^A-Za-z0-9 ]', ' ', 'g'), '\s+') with ordinality as t (w, ord)
  where s.id = p_school_id and w <> '' and ord <= 4;
$$;

-- Moves a student into a class, closing any current enrolment.
create or replace function app.enroll(p_student public.students, p_class_id uuid, p_start date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class    public.classes;
  v_current  public.class_enrollments;
  v_count    integer;
begin
  select * into v_class from public.classes where id = p_class_id and school_id = p_student.school_id;
  if not found then
    raise exception 'The selected class could not be found.' using errcode = 'KL404';
  end if;
  if v_class.status <> 'active' then
    raise exception '% is inactive. Choose an active class.', v_class.name using errcode = 'KL400';
  end if;

  select * into v_current from public.class_enrollments where student_id = p_student.id and status = 'active';
  if found and v_current.class_id = p_class_id then
    return;
  end if;

  if v_class.capacity is not null then
    select count(*) into v_count from public.class_enrollments where class_id = p_class_id and status = 'active';
    if v_count >= v_class.capacity then
      raise exception '% is full (% of % places taken).', v_class.name, v_count, v_class.capacity using errcode = 'KL409';
    end if;
  end if;

  if v_current.id is not null then
    update public.class_enrollments
    set status = 'transferred', end_date = greatest(v_current.start_date, p_start)
    where id = v_current.id;
  end if;

  insert into public.class_enrollments (school_id, student_id, class_id, academic_year_id, start_date, status)
  values (p_student.school_id, p_student.id, p_class_id, v_class.academic_year_id, p_start, 'active');
end;
$$;

-- Adds or links one guardian for a student. Reuses a guardian with the same email.
create or replace function app.attach_guardian(p_student public.students, p_guardian jsonb, p_primary boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid := nullif(p_guardian ->> 'guardian_id', '')::uuid;
  v_email text := nullif(lower(trim(coalesce(p_guardian ->> 'email', ''))), '');
  v_phone text := nullif(trim(coalesce(p_guardian ->> 'phone', '')), '');
begin
  if v_id is not null then
    if not exists (select 1 from public.guardians g where g.id = v_id and g.school_id = p_student.school_id) then
      raise exception 'The selected guardian could not be found.' using errcode = 'KL404';
    end if;
  elsif v_email is not null then
    select g.id into v_id from public.guardians g where g.school_id = p_student.school_id and lower(g.email) = v_email;
  end if;

  if v_id is null then
    if coalesce(trim(p_guardian ->> 'first_name'), '') = '' or coalesce(trim(p_guardian ->> 'last_name'), '') = '' then
      raise exception 'Enter the guardian''s first and last name.' using errcode = 'KL400';
    end if;
    if v_email is null and v_phone is null then
      raise exception 'Enter an email address or phone number for the guardian.' using errcode = 'KL400';
    end if;
    insert into public.guardians (school_id, first_name, last_name, email, phone, occupation)
    values (p_student.school_id, trim(p_guardian ->> 'first_name'), trim(p_guardian ->> 'last_name'), v_email, v_phone,
            nullif(trim(coalesce(p_guardian ->> 'occupation', '')), ''))
    returning id into v_id;
  end if;

  insert into public.student_guardians (school_id, student_id, guardian_id, relationship, is_primary, is_emergency_contact)
  values (p_student.school_id, p_student.id, v_id, coalesce(nullif(p_guardian ->> 'relationship', ''), 'guardian'),
          p_primary, coalesce((p_guardian ->> 'is_emergency_contact')::boolean, p_primary))
  on conflict (student_id, guardian_id) do nothing;
  return v_id;
end;
$$;

-- Creates a student with optional health details, guardians and a class, in one step.
create or replace function app.create_student(p_school_id uuid, p_student jsonb, p_details jsonb, p_guardians jsonb, p_class_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student   public.students;
  v_campus    uuid := nullif(p_student ->> 'campus_id', '')::uuid;
  v_admitted  date := coalesce(nullif(p_student ->> 'admission_date', '')::date, current_date);
  v_number    text := nullif(trim(coalesce(p_student ->> 'admission_number', '')), '');
  v_guardian  jsonb;
  v_index     integer := 0;
begin
  if v_campus is null and p_class_id is not null then
    select campus_id into v_campus from public.classes where id = p_class_id and school_id = p_school_id;
  end if;
  if v_campus is null then
    select id into v_campus from public.campuses where school_id = p_school_id and is_main;
  end if;

  if v_number is null then
    v_number := app.school_initials(p_school_id) || '/' || extract(year from v_admitted)::int || '/'
                || lpad(app.next_counter(p_school_id, 'admission:' || extract(year from v_admitted)::int)::text, 4, '0');
  elsif exists (select 1 from public.students s where s.school_id = p_school_id and upper(s.admission_number) = upper(v_number)) then
    raise exception 'Admission number % is already in use.', v_number using errcode = 'KL409';
  end if;

  insert into public.students (school_id, campus_id, admission_number, first_name, middle_name, last_name,
                               date_of_birth, gender, admission_date, status, previous_school, created_by)
  values (
    p_school_id, v_campus, v_number,
    trim(p_student ->> 'first_name'),
    nullif(trim(coalesce(p_student ->> 'middle_name', '')), ''),
    trim(p_student ->> 'last_name'),
    nullif(p_student ->> 'date_of_birth', '')::date,
    nullif(p_student ->> 'gender', '')::public.gender,
    v_admitted,
    coalesce(nullif(p_student ->> 'status', ''), 'active')::public.student_status,
    nullif(trim(coalesce(p_student ->> 'previous_school', '')), ''),
    auth.uid()
  )
  returning * into v_student;

  if p_details is not null and exists (select 1 from jsonb_each_text(p_details) e where coalesce(trim(e.value), '') <> '') then
    if not app.can_write(p_school_id, 'student_health.edit') then
      raise exception 'You do not have permission to record health and welfare details.' using errcode = 'KL403';
    end if;
    insert into public.student_details (student_id, school_id, home_address, blood_group, genotype, medical_conditions,
                                        allergies, medications, accessibility_needs, emergency_contact_name,
                                        emergency_contact_phone, emergency_contact_relationship)
    values (v_student.id, p_school_id,
            nullif(trim(coalesce(p_details ->> 'home_address', '')), ''),
            nullif(p_details ->> 'blood_group', ''),
            nullif(p_details ->> 'genotype', ''),
            nullif(trim(coalesce(p_details ->> 'medical_conditions', '')), ''),
            nullif(trim(coalesce(p_details ->> 'allergies', '')), ''),
            nullif(trim(coalesce(p_details ->> 'medications', '')), ''),
            nullif(trim(coalesce(p_details ->> 'accessibility_needs', '')), ''),
            nullif(trim(coalesce(p_details ->> 'emergency_contact_name', '')), ''),
            nullif(trim(coalesce(p_details ->> 'emergency_contact_phone', '')), ''),
            nullif(trim(coalesce(p_details ->> 'emergency_contact_relationship', '')), ''));
  end if;

  for v_guardian in select * from jsonb_array_elements(coalesce(p_guardians, '[]'::jsonb)) loop
    v_index := v_index + 1;
    perform app.attach_guardian(v_student, v_guardian, v_index = 1);
  end loop;

  if p_class_id is not null then
    perform app.enroll(v_student, p_class_id, v_admitted);
  end if;

  return v_student.id;
end;
$$;

create or replace function public.register_student(
  p_school_id uuid,
  p_student   jsonb,
  p_details   jsonb default null,
  p_guardians jsonb default '[]'::jsonb,
  p_class_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_write(p_school_id, 'students.create') then
    raise exception 'You do not have permission to register students.' using errcode = 'KL403';
  end if;
  if coalesce(trim(p_student ->> 'first_name'), '') = '' or coalesce(trim(p_student ->> 'last_name'), '') = '' then
    raise exception 'Enter the student''s first and last name.' using errcode = 'KL400';
  end if;
  return app.create_student(p_school_id, p_student, p_details, p_guardians, p_class_id);
end;
$$;

-- Imports many students at once. All rows succeed, or none are saved.
create or replace function public.import_students(p_school_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      jsonb;
  v_index    integer := 0;
  v_class_id uuid;
  v_class    text;
  v_state    text;
  v_message  text;
  v_guardian jsonb;
begin
  if not app.can_write(p_school_id, 'students.create') then
    raise exception 'You do not have permission to import students.' using errcode = 'KL403';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no students in it.' using errcode = 'KL400';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'Import up to 1,000 students at a time.' using errcode = 'KL400';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    begin
      if coalesce(trim(v_row ->> 'first_name'), '') = '' or coalesce(trim(v_row ->> 'last_name'), '') = '' then
        raise exception 'first and last name are required.' using errcode = 'KL400';
      end if;

      v_class_id := null;
      v_class := nullif(trim(coalesce(v_row ->> 'class', '')), '');
      if v_class is not null then
        select c.id into v_class_id
        from public.classes c
        left join public.academic_years y on y.id = c.academic_year_id
        where c.school_id = p_school_id and c.status = 'active' and lower(c.name) = lower(v_class)
        order by coalesce(y.is_current, false) desc, (c.academic_year_id is null) desc
        limit 1;
        if v_class_id is null then
          raise exception 'there is no class called %.', v_class using errcode = 'KL400';
        end if;
      end if;

      v_guardian := null;
      if coalesce(trim(v_row ->> 'guardian_first_name'), '') <> '' or coalesce(trim(v_row ->> 'guardian_email'), '') <> '' then
        v_guardian := jsonb_build_object(
          'first_name', v_row ->> 'guardian_first_name',
          'last_name', v_row ->> 'guardian_last_name',
          'email', v_row ->> 'guardian_email',
          'phone', v_row ->> 'guardian_phone',
          'relationship', lower(coalesce(nullif(v_row ->> 'guardian_relationship', ''), 'guardian'))
        );
      end if;

      perform app.create_student(
        p_school_id,
        v_row,
        null,
        case when v_guardian is null then '[]'::jsonb else jsonb_build_array(v_guardian) end,
        v_class_id
      );
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
      if v_state = '23505' then
        v_message := 'this admission number or guardian email is already used.';
      elsif v_state in ('22007', '22008') then
        v_message := 'a date is not valid. Use DD/MM/YYYY.';
      elsif v_state = '22P02' then
        v_message := 'a value is not valid (check gender and status).';
      elsif v_state = '23514' then
        v_message := 'a value is too long or not allowed.';
      end if;
      raise exception 'Row %: %', v_index, v_message
        using errcode = case when v_state like 'KL%' then v_state else 'KL400' end;
    end;
  end loop;
  return v_index;
end;
$$;

create or replace function public.enroll_students(p_class_id uuid, p_student_ids uuid[], p_start_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school  uuid;
  v_student public.students;
  v_count   integer := 0;
begin
  select school_id into v_school from public.classes where id = p_class_id;
  if v_school is null or not app.is_school_member(v_school) then
    raise exception 'This class could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_school, 'students.edit') then
    raise exception 'You do not have permission to enrol students.' using errcode = 'KL403';
  end if;
  for v_student in select * from public.students where id = any (p_student_ids) and school_id = v_school loop
    perform app.enroll(v_student, p_class_id, coalesce(p_start_date, current_date));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Ends a student's current class without starting another.
create or replace function public.end_enrollment(p_student_id uuid, p_status public.enrollment_status default 'withdrawn')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
begin
  select school_id into v_school from public.students where id = p_student_id;
  if v_school is null or not app.is_school_member(v_school) then
    raise exception 'This student could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_school, 'students.edit') then
    raise exception 'You do not have permission to change enrolments.' using errcode = 'KL403';
  end if;
  if p_status = 'active' then
    raise exception 'Choose how the enrolment ended.' using errcode = 'KL400';
  end if;
  update public.class_enrollments
  set status = p_status, end_date = greatest(start_date, current_date)
  where student_id = p_student_id and status = 'active';
end;
$$;

-- Invites a guardian to the parent portal. Accepting links their account.
create or replace function public.invite_guardian(p_guardian_id uuid)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guardian public.guardians;
  v_role     uuid;
  v_token    text;
  v_id       uuid;
begin
  select * into v_guardian from public.guardians where id = p_guardian_id;
  if not found or not app.has_permission(v_guardian.school_id, 'students.view') then
    raise exception 'This guardian could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_guardian.school_id, 'students.edit') then
    raise exception 'You do not have permission to invite guardians.' using errcode = 'KL403';
  end if;
  if v_guardian.user_id is not null then
    raise exception 'This guardian already has portal access.' using errcode = 'KL409';
  end if;
  if v_guardian.email is null then
    raise exception 'Add an email address for this guardian first.' using errcode = 'KL400';
  end if;
  select id into v_role from public.roles where school_id = v_guardian.school_id and role_key = 'parent';

  update public.invitations
  set status = 'revoked'
  where school_id = v_guardian.school_id and lower(email) = lower(v_guardian.email) and role_id = v_role and status = 'pending';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.invitations (school_id, email, role_id, token_hash, invited_by, guardian_id)
  values (v_guardian.school_id, lower(v_guardian.email), v_role,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), v_guardian.id)
  returning id into v_id;

  return query select v_id, v_token;
end;
$$;

-- Children linked to the signed-in guardian in a school (for the parent views).
create or replace function public.get_my_children(p_school_id uuid)
returns table (
  student_id       uuid,
  first_name       text,
  last_name        text,
  admission_number text,
  photo_path       text,
  status           public.student_status,
  class_id         uuid,
  class_name       text,
  relationship     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.first_name, s.last_name, s.admission_number, s.photo_path, s.status, c.id, c.name, sg.relationship
  from public.guardians g
  join public.school_memberships m on m.school_id = g.school_id and m.user_id = g.user_id and m.status = 'active'
  join public.student_guardians sg on sg.guardian_id = g.id
  join public.students s on s.id = sg.student_id
  left join public.class_enrollments e on e.student_id = s.id and e.status = 'active'
  left join public.classes c on c.id = e.class_id
  where g.school_id = p_school_id and g.user_id = auth.uid()
  order by s.first_name, s.last_name;
$$;

-- Headline numbers for the dashboard.
create or replace function public.get_people_counts(p_school_id uuid)
returns table (active_students integer, all_students integer, guardians integer, guardians_with_access integer, teachers integer, staff integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_permission(p_school_id, 'students.view') or app.has_permission(p_school_id, 'staff.view')) then
    raise exception 'You do not have permission to view these figures.' using errcode = 'KL403';
  end if;
  return query
  select
    (select count(*)::int from public.students s where s.school_id = p_school_id and s.status = 'active'),
    (select count(*)::int from public.students s where s.school_id = p_school_id),
    (select count(*)::int from public.guardians g where g.school_id = p_school_id),
    (select count(*)::int from public.guardians g where g.school_id = p_school_id and g.user_id is not null),
    (select count(distinct m.user_id)::int from public.school_memberships m join public.roles r on r.id = m.role_id
       where m.school_id = p_school_id and m.status = 'active' and r.role_key = 'teacher'),
    (select count(distinct m.user_id)::int from public.school_memberships m join public.roles r on r.id = m.role_id
       where m.school_id = p_school_id and m.status = 'active' and coalesce(r.role_key, '') not in ('parent', 'student'));
end;
$$;

revoke all on function app.school_initials(uuid), app.enroll(public.students, uuid, date),
  app.attach_guardian(public.students, jsonb, boolean), app.create_student(uuid, jsonb, jsonb, jsonb, uuid) from public;
revoke all on function public.register_student(uuid, jsonb, jsonb, jsonb, uuid), public.import_students(uuid, jsonb),
  public.enroll_students(uuid, uuid[], date), public.end_enrollment(uuid, public.enrollment_status),
  public.invite_guardian(uuid), public.get_my_children(uuid), public.get_people_counts(uuid) from public, anon;
grant execute on function public.register_student(uuid, jsonb, jsonb, jsonb, uuid), public.import_students(uuid, jsonb),
  public.enroll_students(uuid, uuid[], date), public.end_enrollment(uuid, public.enrollment_status),
  public.invite_guardian(uuid), public.get_my_children(uuid), public.get_people_counts(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- accept_invitation: unchanged from 0800, plus linking guardian accounts.
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

  update public.invitations
  set status = 'accepted', accepted_by = v_user, accepted_at = now()
  where id = v_invitation.id;

  return v_invitation.school_id;
end;
$$;
