-- =============================================================================
-- Klasora · Phase 4a · Timetables and attendance
--
-- Access pattern used across Phase 4 (academic records):
--   * Oversight staff (the module's view permission plus students.view) see
--     the whole school.
--   * Teachers see the classes they teach (class teacher or subject teacher).
--   * Students and guardians see records for the classes and children they
--     are linked to.
-- =============================================================================

create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');
create type public.attendance_session_status as enum ('draft', 'submitted');

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- The caller is a student in this class, or the guardian of one.
create or replace function app.is_family_of_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_enrollments e
    where e.class_id = p_class_id and e.status = 'active'
      and (app.is_student_self(e.student_id) or app.is_guardian_of(e.student_id))
  );
$$;

-- The caller teaches this subject in this class (or is its class teacher).
create or replace function app.teaches_subject(p_class_id uuid, p_subject_id uuid)
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
    where cs.class_id = p_class_id and cs.subject_id = p_subject_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- Staff who oversee every class for a module: its view permission and students.view.
create or replace function app.oversees(p_school_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_permission(p_school_id, p_permission) and app.has_permission(p_school_id, 'students.view');
$$;

-- Staff access to a class's records for a module.
create or replace function app.staff_can_see_class(p_school_id uuid, p_class_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.oversees(p_school_id, p_permission)
      or (app.has_permission(p_school_id, p_permission) and app.teaches_class(p_class_id));
$$;

-- =============================================================================
-- Timetable
-- =============================================================================
create table public.timetable_entries (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references public.schools (id) on delete cascade,
  academic_year_id      uuid,
  class_id              uuid not null,
  subject_id            uuid,
  label                 text check (char_length(label) <= 60),
  teacher_membership_id uuid,
  day_of_week           smallint not null check (day_of_week between 1 and 7),
  start_time            time not null,
  end_time              time not null,
  room                  text check (char_length(room) <= 60),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint timetable_entries_year_fk
    foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete cascade,
  constraint timetable_entries_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete cascade,
  constraint timetable_entries_subject_fk
    foreign key (subject_id, school_id) references public.subjects (id, school_id) on delete cascade,
  constraint timetable_entries_teacher_fk
    foreign key (teacher_membership_id, school_id) references public.school_memberships (id, school_id)
    on delete set null (teacher_membership_id),
  constraint timetable_entries_times check (end_time > start_time),
  constraint timetable_entries_what check (subject_id is not null or nullif(trim(label), '') is not null)
);
create index timetable_entries_class_idx on public.timetable_entries (class_id, day_of_week, start_time);
create index timetable_entries_teacher_idx on public.timetable_entries (teacher_membership_id, day_of_week);

-- Refuses overlapping periods for the same class, teacher or room.
create or replace function app.check_timetable_conflicts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clash    record;
  v_teacher  uuid;
  v_campus   uuid;
  v_when     text := to_char(new.start_time, 'HH24:MI') || ' to ' || to_char(new.end_time, 'HH24:MI');
begin
  if new.end_time <= new.start_time then
    raise exception 'The end time must be after the start time.' using errcode = 'KL400';
  end if;
  -- Serialise timetable changes per school so two editors cannot create a clash at once.
  perform pg_advisory_xact_lock(hashtext('timetable:' || new.school_id::text));

  select c.name into v_clash
  from public.timetable_entries t join public.classes c on c.id = t.class_id
  where t.class_id = new.class_id and t.id <> new.id and t.day_of_week = new.day_of_week
    and t.start_time < new.end_time and t.end_time > new.start_time
    and (t.academic_year_id is null or new.academic_year_id is null or t.academic_year_id = new.academic_year_id)
  limit 1;
  if found then
    raise exception '% already has a period that overlaps %.', v_clash.name, v_when using errcode = 'KL409';
  end if;

  if new.teacher_membership_id is not null then
    select user_id into v_teacher from public.school_memberships where id = new.teacher_membership_id;
    select c.name as class_name, trim(p.first_name || ' ' || p.last_name) as teacher into v_clash
    from public.timetable_entries t
    join public.school_memberships m on m.id = t.teacher_membership_id
    join public.profiles p on p.id = m.user_id
    join public.classes c on c.id = t.class_id
    where m.user_id = v_teacher and t.id <> new.id and t.day_of_week = new.day_of_week
      and t.start_time < new.end_time and t.end_time > new.start_time
      and (t.academic_year_id is null or new.academic_year_id is null or t.academic_year_id = new.academic_year_id)
    limit 1;
    if found then
      raise exception '% is already teaching % at that time.', v_clash.teacher, v_clash.class_name using errcode = 'KL409';
    end if;
  end if;

  if nullif(trim(new.room), '') is not null then
    select campus_id into v_campus from public.classes where id = new.class_id;
    select c.name, t.room into v_clash
    from public.timetable_entries t join public.classes c on c.id = t.class_id
    where c.campus_id = v_campus and lower(trim(t.room)) = lower(trim(new.room)) and t.id <> new.id
      and t.day_of_week = new.day_of_week and t.start_time < new.end_time and t.end_time > new.start_time
      and (t.academic_year_id is null or new.academic_year_id is null or t.academic_year_id = new.academic_year_id)
    limit 1;
    if found then
      raise exception '% is already being used by % at that time.', trim(v_clash.room), v_clash.name using errcode = 'KL409';
    end if;
  end if;
  return new;
end;
$$;

create trigger timetable_entries_conflicts
  before insert or update on public.timetable_entries
  for each row execute function app.check_timetable_conflicts();

-- =============================================================================
-- Attendance
-- =============================================================================
create table public.attendance_sessions (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id) on delete cascade,
  class_id        uuid not null,
  attendance_date date not null,
  session_type    text not null default 'daily' check (session_type in ('daily', 'morning', 'afternoon', 'subject')),
  subject_id      uuid,
  status          public.attendance_session_status not null default 'draft',
  recorded_by     uuid references public.profiles (id) on delete set null,
  submitted_by    uuid references public.profiles (id) on delete set null,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint attendance_sessions_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete cascade,
  constraint attendance_sessions_subject_fk
    foreign key (subject_id, school_id) references public.subjects (id, school_id) on delete cascade,
  constraint attendance_sessions_subject_needed check ((session_type = 'subject') = (subject_id is not null)),
  constraint attendance_sessions_unique unique nulls not distinct (class_id, attendance_date, session_type, subject_id),
  constraint attendance_sessions_id_school_unique unique (id, school_id)
);
create index attendance_sessions_school_date_idx on public.attendance_sessions (school_id, attendance_date);

create table public.attendance_records (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  session_id  uuid not null,
  student_id  uuid not null,
  status      public.attendance_status not null,
  remarks     text check (char_length(remarks) <= 300),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint attendance_records_session_fk
    foreign key (session_id, school_id) references public.attendance_sessions (id, school_id) on delete cascade,
  constraint attendance_records_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  constraint attendance_records_unique unique (session_id, student_id)
);
create index attendance_records_student_idx on public.attendance_records (student_id);

-- -----------------------------------------------------------------------------
-- Housekeeping
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['timetable_entries', 'attendance_sessions'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', v_table || '_set_updated_at', v_table);
    execute format('create trigger %I before update on public.%I for each row execute function app.prevent_school_change()', v_table || '_prevent_school_change', v_table);
  end loop;
  foreach v_table in array array['timetable_entries', 'attendance_sessions', 'attendance_records'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row_change()', v_table || '_audit', v_table);
  end loop;
end;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.timetable_entries   enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records  enable row level security;
revoke all on public.timetable_entries, public.attendance_sessions, public.attendance_records from anon, authenticated;

-- Timetable: everyone connected to the class can read it; academic staff edit it.
grant select, delete on public.timetable_entries to authenticated;
grant insert (school_id, academic_year_id, class_id, subject_id, label, teacher_membership_id, day_of_week, start_time, end_time, room)
  on public.timetable_entries to authenticated;
grant update (academic_year_id, subject_id, label, teacher_membership_id, day_of_week, start_time, end_time, room)
  on public.timetable_entries to authenticated;

create policy timetable_select on public.timetable_entries
  for select to authenticated
  using (app.has_permission(school_id, 'academics.view') or app.is_family_of_class(class_id));
create policy timetable_insert on public.timetable_entries
  for insert to authenticated with check (app.can_write(school_id, 'academics.edit'));
create policy timetable_update on public.timetable_entries
  for update to authenticated
  using (app.can_write(school_id, 'academics.edit'))
  with check (app.can_write(school_id, 'academics.edit'));
create policy timetable_delete on public.timetable_entries
  for delete to authenticated using (app.can_write(school_id, 'academics.edit'));

-- Attendance: read only through the API; written by save_attendance().
grant select on public.attendance_sessions, public.attendance_records to authenticated;

create policy attendance_sessions_select on public.attendance_sessions
  for select to authenticated
  using (app.staff_can_see_class(school_id, class_id, 'attendance.view') or app.is_family_of_class(class_id));

create policy attendance_records_select on public.attendance_records
  for select to authenticated
  using (
    app.is_student_self(student_id) or app.is_guardian_of(student_id)
    or exists (
      select 1 from public.attendance_sessions s
      where s.id = session_id and app.staff_can_see_class(s.school_id, s.class_id, 'attendance.view')
    )
  );

-- =============================================================================
-- RPCs
-- =============================================================================

-- Saves a class register in one step. Teachers record their own classes;
-- once submitted, only people with attendance.edit can correct it.
create or replace function public.save_attendance(
  p_class_id     uuid,
  p_date         date,
  p_session_type text default 'daily',
  p_subject_id   uuid default null,
  p_records      jsonb default '[]'::jsonb,
  p_submit       boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class   public.classes;
  v_session public.attendance_sessions;
  v_row     jsonb;
  v_student uuid;
begin
  select * into v_class from public.classes where id = p_class_id;
  if not found or not app.is_school_member(v_class.school_id) then
    raise exception 'This class could not be found.' using errcode = 'KL404';
  end if;
  if not (app.can_write(v_class.school_id, 'attendance.create')
          and (app.teaches_class(p_class_id) or app.has_permission(v_class.school_id, 'attendance.edit'))) then
    raise exception 'You can only take attendance for classes you teach.' using errcode = 'KL403';
  end if;
  if p_date > current_date then
    raise exception 'Attendance cannot be recorded for a future date.' using errcode = 'KL400';
  end if;
  if p_session_type = 'subject' and p_subject_id is null then
    raise exception 'Choose the subject for this register.' using errcode = 'KL400';
  end if;

  select * into v_session from public.attendance_sessions
  where class_id = p_class_id and attendance_date = p_date and session_type = coalesce(p_session_type, 'daily')
    and subject_id is not distinct from (case when p_session_type = 'subject' then p_subject_id end)
  for update;

  if found and v_session.status = 'submitted' and not app.can_write(v_class.school_id, 'attendance.edit') then
    raise exception 'This register has already been submitted. Ask an administrator to correct it.' using errcode = 'KL403';
  end if;

  if not found then
    insert into public.attendance_sessions (school_id, class_id, attendance_date, session_type, subject_id, recorded_by)
    values (v_class.school_id, p_class_id, p_date, coalesce(p_session_type, 'daily'),
            case when p_session_type = 'subject' then p_subject_id end, auth.uid())
    returning * into v_session;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) loop
    v_student := (v_row ->> 'student_id')::uuid;
    if not exists (
      select 1 from public.class_enrollments e
      where e.student_id = v_student and e.class_id = p_class_id
        and e.start_date <= p_date and (e.end_date is null or e.end_date >= p_date)
    ) then
      raise exception 'A student in this register is not in % on that date.', v_class.name using errcode = 'KL400';
    end if;
    insert into public.attendance_records (school_id, session_id, student_id, status, remarks, recorded_by, recorded_at)
    values (v_class.school_id, v_session.id, v_student, (v_row ->> 'status')::public.attendance_status,
            nullif(trim(coalesce(v_row ->> 'remarks', '')), ''), auth.uid(), now())
    on conflict (session_id, student_id) do update
      set status = excluded.status, remarks = excluded.remarks, recorded_by = excluded.recorded_by, recorded_at = now()
      where public.attendance_records.status is distinct from excluded.status
         or public.attendance_records.remarks is distinct from excluded.remarks;
  end loop;

  if p_submit and v_session.status = 'draft' then
    update public.attendance_sessions
    set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
    where id = v_session.id;
  end if;
  return v_session.id;
end;
$$;

-- Daily counts per class for a date range (drives daily, weekly and monthly views).
create or replace function public.attendance_report(p_school_id uuid, p_from date, p_to date, p_class_id uuid default null)
returns table (class_id uuid, attendance_date date, present integer, absent integer, late integer, excused integer, total integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_school_id, 'attendance.view') then
    raise exception 'You do not have permission to view attendance.' using errcode = 'KL403';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a date range of up to a year.' using errcode = 'KL400';
  end if;
  return query
  select s.class_id, s.attendance_date,
         count(*) filter (where r.status = 'present')::int,
         count(*) filter (where r.status = 'absent')::int,
         count(*) filter (where r.status = 'late')::int,
         count(*) filter (where r.status = 'excused')::int,
         count(*)::int
  from public.attendance_sessions s
  join public.attendance_records r on r.session_id = s.id
  where s.school_id = p_school_id and s.attendance_date between p_from and p_to
    and s.session_type in ('daily', 'morning')
    and (p_class_id is null or s.class_id = p_class_id)
    and app.staff_can_see_class(p_school_id, s.class_id, 'attendance.view')
  group by s.class_id, s.attendance_date
  order by s.attendance_date, s.class_id;
end;
$$;

-- One student's attendance history, for anyone who may see that student.
create or replace function public.student_attendance(p_student_id uuid, p_from date, p_to date)
returns table (attendance_date date, session_type text, subject_id uuid, status public.attendance_status, remarks text, class_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school uuid;
begin
  select school_id into v_school from public.students where id = p_student_id;
  if v_school is null or not (
    app.is_student_self(p_student_id) or app.is_guardian_of(p_student_id)
    or (app.has_permission(v_school, 'attendance.view') and (app.has_permission(v_school, 'students.view') or app.teaches_student(p_student_id)))
  ) then
    raise exception 'This attendance record could not be found.' using errcode = 'KL404';
  end if;
  return query
  select s.attendance_date, s.session_type, s.subject_id, r.status, r.remarks, s.class_id
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.session_id
  where r.student_id = p_student_id and s.attendance_date between p_from and p_to
  order by s.attendance_date desc, s.session_type;
end;
$$;

revoke all on function app.is_family_of_class(uuid), app.teaches_subject(uuid, uuid), app.oversees(uuid, text),
  app.staff_can_see_class(uuid, uuid, text), app.check_timetable_conflicts() from public;
grant execute on function app.is_family_of_class(uuid), app.teaches_subject(uuid, uuid), app.oversees(uuid, text),
  app.staff_can_see_class(uuid, uuid, text) to authenticated;

revoke all on function public.save_attendance(uuid, date, text, uuid, jsonb, boolean),
  public.attendance_report(uuid, date, date, uuid), public.student_attendance(uuid, date, date) from public, anon;
grant execute on function public.save_attendance(uuid, date, text, uuid, jsonb, boolean),
  public.attendance_report(uuid, date, date, uuid), public.student_attendance(uuid, date, date) to authenticated;

-- Class and subject names appear on timetables, assignments and report cards
-- that students and guardians read, so every member of the school may read
-- them. They hold no personal information.
drop policy classes_select on public.classes;
create policy classes_select on public.classes
  for select to authenticated using (app.is_school_member(school_id));

drop policy subjects_select on public.subjects;
create policy subjects_select on public.subjects
  for select to authenticated using (app.is_school_member(school_id));
