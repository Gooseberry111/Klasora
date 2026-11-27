-- =============================================================================
-- Klasora · Phase 4c · Assessments, grading, results and report cards
--
-- Workflow: a teacher records scores (draft), submits them; a principal or
-- authorised administrator (examinations.approve) approves or returns them,
-- then publishes. Only published results reach students and guardians, and
-- only guardians allowed to see results. Edits after publication need
-- examinations.approve and are audited.
-- =============================================================================

create type public.assessment_status as enum ('draft', 'submitted', 'returned', 'approved', 'published');
create type public.report_card_status as enum ('draft', 'published');

alter table public.schools add column show_class_positions boolean not null default false;
grant update (show_class_positions) on public.schools to authenticated;

-- -----------------------------------------------------------------------------
-- Grading scale: one per school, fully configurable. A band applies from its
-- minimum score up to the next band's minimum.
-- -----------------------------------------------------------------------------
create table public.grading_bands (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  grade      text not null check (char_length(trim(grade)) between 1 and 10),
  min_score  numeric(5, 2) not null check (min_score between 0 and 100),
  remark     text check (char_length(remark) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grading_bands_grade_unique unique (school_id, grade),
  constraint grading_bands_min_unique unique (school_id, min_score)
);

create or replace function app.seed_grading_scale(p_school_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.grading_bands (school_id, grade, min_score, remark)
  values (p_school_id, 'A', 70, 'Excellent'), (p_school_id, 'B', 60, 'Very good'), (p_school_id, 'C', 50, 'Good'),
         (p_school_id, 'D', 45, 'Fair'), (p_school_id, 'E', 40, 'Pass'), (p_school_id, 'F', 0, 'Fail')
  on conflict do nothing;
$$;

select app.seed_grading_scale(id) from public.schools;

create or replace function app.seed_school_grading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_grading_scale(new.id);
  return new;
end;
$$;

create trigger schools_seed_grading after insert on public.schools
  for each row execute function app.seed_school_grading();

create or replace function app.grade_for(p_school_id uuid, p_score numeric)
returns table (grade text, remark text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.grade, b.remark from public.grading_bands b
  where b.school_id = p_school_id and p_score is not null and b.min_score <= p_score
  order by b.min_score desc
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Assessments and scores
-- -----------------------------------------------------------------------------
create table public.assessments (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  academic_year_id uuid,
  term_id          uuid not null,
  class_id         uuid not null,
  subject_id       uuid not null,
  title            text not null check (char_length(trim(title)) between 1 and 120),
  assessment_type  text not null default 'continuous'
                     check (assessment_type in ('continuous', 'test', 'project', 'practical', 'examination')),
  maximum_score    numeric(6, 2) not null default 100 check (maximum_score > 0),
  weight           numeric(5, 2) not null check (weight > 0 and weight <= 100),
  assessment_date  date,
  status           public.assessment_status not null default 'draft',
  review_note      text check (char_length(review_note) <= 1000),
  submitted_by     uuid references public.profiles (id) on delete set null,
  submitted_at     timestamptz,
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  published_by     uuid references public.profiles (id) on delete set null,
  published_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint assessments_year_fk
    foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete cascade,
  constraint assessments_term_fk
    foreign key (term_id, school_id) references public.academic_terms (id, school_id) on delete restrict,
  constraint assessments_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete restrict,
  constraint assessments_subject_fk
    foreign key (subject_id, school_id) references public.subjects (id, school_id) on delete restrict,
  constraint assessments_id_school_unique unique (id, school_id)
);
create index assessments_class_term_idx on public.assessments (class_id, term_id, subject_id);
create index assessments_school_status_idx on public.assessments (school_id, status);

create table public.assessment_scores (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id) on delete cascade,
  assessment_id uuid not null,
  student_id    uuid not null,
  score         numeric(6, 2) check (score >= 0),
  is_absent     boolean not null default false,
  remarks       text check (char_length(remarks) <= 300),
  recorded_by   uuid references public.profiles (id) on delete set null,
  recorded_at   timestamptz not null default now(),
  constraint assessment_scores_assessment_fk
    foreign key (assessment_id, school_id) references public.assessments (id, school_id) on delete cascade,
  constraint assessment_scores_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  constraint assessment_scores_absent check (not (is_absent and score is not null)),
  constraint assessment_scores_unique unique (assessment_id, student_id)
);
create index assessment_scores_student_idx on public.assessment_scores (student_id);

-- The academic year always follows the term; the maximum cannot drop below a recorded score.
create or replace function app.check_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select academic_year_id into new.academic_year_id from public.academic_terms where id = new.term_id;
  if tg_op = 'UPDATE' and new.maximum_score < old.maximum_score and exists (
    select 1 from public.assessment_scores s where s.assessment_id = new.id and s.score > new.maximum_score
  ) then
    raise exception 'Some recorded scores are higher than %. Correct them first.', new.maximum_score using errcode = 'KL400';
  end if;
  return new;
end;
$$;

create trigger assessments_check before insert or update of term_id, maximum_score on public.assessments
  for each row execute function app.check_assessment();

-- -----------------------------------------------------------------------------
-- Report cards: a snapshot of published results, attendance and comments.
-- -----------------------------------------------------------------------------
create table public.report_cards (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools (id) on delete cascade,
  student_id        uuid not null,
  class_id          uuid not null,
  academic_year_id  uuid,
  term_id           uuid not null,
  average           numeric(5, 2),
  grade             text,
  position          integer,
  class_size        integer,
  subjects          jsonb not null default '[]'::jsonb,
  attendance        jsonb not null default '{}'::jsonb,
  teacher_comment   text check (char_length(teacher_comment) <= 1000),
  principal_comment text check (char_length(principal_comment) <= 1000),
  status            public.report_card_status not null default 'draft',
  generated_at      timestamptz not null default now(),
  published_by      uuid references public.profiles (id) on delete set null,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint report_cards_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  constraint report_cards_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete restrict,
  constraint report_cards_term_fk
    foreign key (term_id, school_id) references public.academic_terms (id, school_id) on delete restrict,
  constraint report_cards_year_fk
    foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete cascade,
  constraint report_cards_unique unique (student_id, term_id)
);
create index report_cards_class_term_idx on public.report_cards (class_id, term_id);

do $$
declare
  v_table text;
begin
  foreach v_table in array array['grading_bands', 'assessments', 'report_cards'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', v_table || '_set_updated_at', v_table);
  end loop;
  foreach v_table in array array['grading_bands', 'assessments', 'report_cards', 'assessment_scores'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.prevent_school_change()', v_table || '_prevent_school_change', v_table);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row_change()', v_table || '_audit', v_table);
  end loop;
end;
$$;

-- =============================================================================
-- Helpers
-- =============================================================================

-- The caller is the class teacher of this class.
create or replace function app.is_class_teacher(p_class_id uuid)
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
  );
$$;

-- The caller is a guardian of this student who is allowed to see results.
create or replace function app.guardian_can_see_results(p_student_id uuid)
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
    where sg.student_id = p_student_id and g.user_id = auth.uid() and sg.can_view_results
  );
$$;

-- The caller may record scores for this assessment's class and subject.
create or replace function app.can_record_scores(p_school_id uuid, p_class_id uuid, p_subject_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_write(p_school_id, p_permission)
     and (app.teaches_subject(p_class_id, p_subject_id) or app.has_permission(p_school_id, 'academics.edit'));
$$;

-- Weighted subject totals out of 100 for a class and term.
-- Absent counts as zero; scores not yet entered are left out.
create or replace function app.subject_totals(p_class_id uuid, p_term_id uuid, p_published_only boolean)
returns table (student_id uuid, subject_id uuid, total numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select sc.student_id, a.subject_id,
         round(sum(coalesce(sc.score, 0) / a.maximum_score * a.weight) / nullif(sum(a.weight), 0) * 100, 2)
  from public.assessments a
  join public.assessment_scores sc on sc.assessment_id = a.id
  where a.class_id = p_class_id and a.term_id = p_term_id
    and (sc.score is not null or sc.is_absent)
    and (not p_published_only or a.status = 'published')
  group by sc.student_id, a.subject_id;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.grading_bands     enable row level security;
alter table public.assessments       enable row level security;
alter table public.assessment_scores enable row level security;
alter table public.report_cards      enable row level security;
revoke all on public.grading_bands, public.assessments, public.assessment_scores, public.report_cards from anon, authenticated;

grant select, delete on public.grading_bands to authenticated;
grant insert (school_id, grade, min_score, remark) on public.grading_bands to authenticated;
grant update (grade, min_score, remark) on public.grading_bands to authenticated;
create policy grading_bands_select on public.grading_bands
  for select to authenticated using (app.is_school_member(school_id));
create policy grading_bands_insert on public.grading_bands
  for insert to authenticated with check (app.can_write(school_id, 'examinations.approve') or app.can_write(school_id, 'settings.edit'));
create policy grading_bands_update on public.grading_bands
  for update to authenticated
  using (app.can_write(school_id, 'examinations.approve') or app.can_write(school_id, 'settings.edit'))
  with check (app.can_write(school_id, 'examinations.approve') or app.can_write(school_id, 'settings.edit'));
create policy grading_bands_delete on public.grading_bands
  for delete to authenticated using (app.can_write(school_id, 'examinations.approve') or app.can_write(school_id, 'settings.edit'));

grant select, delete on public.assessments to authenticated;
grant insert (school_id, term_id, class_id, subject_id, title, assessment_type, maximum_score, weight, assessment_date)
  on public.assessments to authenticated;
grant update (title, assessment_type, maximum_score, weight, assessment_date) on public.assessments to authenticated;

create policy assessments_select on public.assessments
  for select to authenticated
  using (
    app.staff_can_see_class(school_id, class_id, 'examinations.view')
    or (status = 'published' and app.is_family_of_class(class_id))
  );
create policy assessments_insert on public.assessments
  for insert to authenticated
  with check (app.can_record_scores(school_id, class_id, subject_id, 'examinations.create'));
create policy assessments_update on public.assessments
  for update to authenticated
  using (status in ('draft', 'returned') and app.can_record_scores(school_id, class_id, subject_id, 'examinations.edit'))
  with check (status in ('draft', 'returned') and app.can_record_scores(school_id, class_id, subject_id, 'examinations.edit'));
create policy assessments_delete on public.assessments
  for delete to authenticated
  using (status in ('draft', 'returned') and app.can_record_scores(school_id, class_id, subject_id, 'examinations.delete'));

grant select on public.assessment_scores to authenticated;
create policy assessment_scores_select on public.assessment_scores
  for select to authenticated
  using (exists (
    select 1 from public.assessments a
    where a.id = assessment_id and (
      app.staff_can_see_class(a.school_id, a.class_id, 'examinations.view')
      or (a.status = 'published' and (app.is_student_self(student_id) or app.guardian_can_see_results(student_id)))
    )
  ));

grant select on public.report_cards to authenticated;
create policy report_cards_select on public.report_cards
  for select to authenticated
  using (
    app.staff_can_see_class(school_id, class_id, 'examinations.view')
    or (status = 'published' and (app.is_student_self(student_id) or app.guardian_can_see_results(student_id)))
  );

-- =============================================================================
-- RPCs: scores and the approval workflow
-- =============================================================================
create or replace function public.save_scores(p_assessment_id uuid, p_scores jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a     public.assessments;
  v_row   jsonb;
  v_score numeric;
  v_count integer := 0;
begin
  select * into v_a from public.assessments where id = p_assessment_id for update;
  if not found or not app.staff_can_see_class(v_a.school_id, v_a.class_id, 'examinations.view') then
    raise exception 'This assessment could not be found.' using errcode = 'KL404';
  end if;
  if v_a.status in ('draft', 'returned') then
    if not (app.can_record_scores(v_a.school_id, v_a.class_id, v_a.subject_id, 'examinations.create')
            or app.can_record_scores(v_a.school_id, v_a.class_id, v_a.subject_id, 'examinations.edit')) then
      raise exception 'Only the teachers of this subject can record its scores.' using errcode = 'KL403';
    end if;
  elsif not app.can_write(v_a.school_id, 'examinations.approve') then
    raise exception 'These scores have been submitted for review. Ask the principal to return them if they need changing.' using errcode = 'KL403';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) loop
    if not exists (select 1 from public.class_enrollments e where e.student_id = (v_row ->> 'student_id')::uuid and e.class_id = v_a.class_id) then
      raise exception 'A student in this list is not in the class.' using errcode = 'KL400';
    end if;
    v_score := nullif(v_row ->> 'score', '')::numeric;
    if coalesce((v_row ->> 'is_absent')::boolean, false) then
      v_score := null;
    elsif v_score is not null and (v_score < 0 or v_score > v_a.maximum_score) then
      raise exception 'Scores must be between 0 and %.', v_a.maximum_score using errcode = 'KL400';
    end if;
    insert into public.assessment_scores (school_id, assessment_id, student_id, score, is_absent, remarks, recorded_by, recorded_at)
    values (v_a.school_id, v_a.id, (v_row ->> 'student_id')::uuid, v_score, coalesce((v_row ->> 'is_absent')::boolean, false),
            nullif(trim(coalesce(v_row ->> 'remarks', '')), ''), auth.uid(), now())
    on conflict (assessment_id, student_id) do update
      set score = excluded.score, is_absent = excluded.is_absent, remarks = excluded.remarks,
          recorded_by = excluded.recorded_by, recorded_at = now()
      where public.assessment_scores.score is distinct from excluded.score
         or public.assessment_scores.is_absent is distinct from excluded.is_absent
         or public.assessment_scores.remarks is distinct from excluded.remarks;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.submit_assessment(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.assessments;
begin
  select * into v_a from public.assessments where id = p_assessment_id for update;
  if not found or not app.staff_can_see_class(v_a.school_id, v_a.class_id, 'examinations.view') then
    raise exception 'This assessment could not be found.' using errcode = 'KL404';
  end if;
  if not (app.can_record_scores(v_a.school_id, v_a.class_id, v_a.subject_id, 'examinations.create')
          or app.can_record_scores(v_a.school_id, v_a.class_id, v_a.subject_id, 'examinations.edit')) then
    raise exception 'Only the teachers of this subject can submit its scores.' using errcode = 'KL403';
  end if;
  if v_a.status not in ('draft', 'returned') then
    raise exception 'These scores have already been submitted.' using errcode = 'KL409';
  end if;
  if not exists (select 1 from public.assessment_scores s where s.assessment_id = p_assessment_id and (s.score is not null or s.is_absent)) then
    raise exception 'Record at least one score before submitting.' using errcode = 'KL400';
  end if;
  update public.assessments
  set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
  where id = p_assessment_id;
end;
$$;

create or replace function public.review_assessment(p_assessment_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.assessments;
begin
  select * into v_a from public.assessments where id = p_assessment_id for update;
  if not found or not app.staff_can_see_class(v_a.school_id, v_a.class_id, 'examinations.view') then
    raise exception 'This assessment could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_a.school_id, 'examinations.approve') then
    raise exception 'You do not have permission to review results.' using errcode = 'KL403';
  end if;
  if v_a.status not in ('submitted', 'approved') then
    raise exception 'Only submitted results can be reviewed.' using errcode = 'KL409';
  end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then
    raise exception 'Explain what needs correcting so the teacher knows what to change.' using errcode = 'KL400';
  end if;
  update public.assessments
  set status = case when p_approve then 'approved'::public.assessment_status else 'returned'::public.assessment_status end,
      review_note = nullif(trim(p_note), ''),
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_assessment_id;
end;
$$;

create or replace function public.publish_assessments(p_assessment_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a     public.assessments;
  v_count integer := 0;
begin
  for v_a in select * from public.assessments where id = any (p_assessment_ids) for update loop
    if not app.can_write(v_a.school_id, 'examinations.approve') then
      raise exception 'You do not have permission to publish results.' using errcode = 'KL403';
    end if;
    if v_a.status <> 'approved' then
      raise exception '% must be approved before it can be published.', v_a.title using errcode = 'KL409';
    end if;
    update public.assessments set status = 'published', published_by = auth.uid(), published_at = now() where id = v_a.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- =============================================================================
-- RPCs: results
-- =============================================================================

-- Broadsheet for staff: every student's total, grade and (if enabled) position per subject.
create or replace function public.get_class_results(p_class_id uuid, p_term_id uuid, p_published_only boolean default false)
returns table (student_id uuid, subject_id uuid, total numeric, grade text, remark text, subject_position integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school    uuid;
  v_positions boolean;
begin
  select c.school_id, s.show_class_positions into v_school, v_positions
  from public.classes c join public.schools s on s.id = c.school_id where c.id = p_class_id;
  if v_school is null or not app.staff_can_see_class(v_school, p_class_id, 'examinations.view') then
    raise exception 'These results could not be found.' using errcode = 'KL404';
  end if;
  return query
  select t.student_id, t.subject_id, t.total, g.grade, g.remark,
         case when v_positions then (rank() over (partition by t.subject_id order by t.total desc))::int end
  from app.subject_totals(p_class_id, p_term_id, p_published_only) t
  left join lateral app.grade_for(v_school, t.total) g on true;
end;
$$;

-- Published results for one student, for the student, guardians allowed to see results, and staff.
create or replace function public.get_student_results(p_student_id uuid, p_term_id uuid)
returns table (subject_id uuid, subject_name text, subject_code text, total numeric, grade text, remark text,
               subject_position integer, class_average numeric, class_size integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school    uuid;
  v_positions boolean;
  v_class     uuid;
begin
  select st.school_id, sc.show_class_positions into v_school, v_positions
  from public.students st join public.schools sc on sc.id = st.school_id where st.id = p_student_id;
  if v_school is null or not (
    app.is_student_self(p_student_id) or app.guardian_can_see_results(p_student_id)
    or (app.has_permission(v_school, 'examinations.view') and (app.has_permission(v_school, 'students.view') or app.teaches_student(p_student_id)))
  ) then
    raise exception 'These results could not be found.' using errcode = 'KL404';
  end if;

  select a.class_id into v_class
  from public.assessment_scores s join public.assessments a on a.id = s.assessment_id
  where s.student_id = p_student_id and a.term_id = p_term_id and a.status = 'published'
  limit 1;
  if v_class is null then
    return;
  end if;

  return query
  with totals as (select * from app.subject_totals(v_class, p_term_id, true)),
  ranked as (
    select t.*, rank() over (partition by t.subject_id order by t.total desc)::int as pos,
           round(avg(t.total) over (partition by t.subject_id), 2) as avg_total,
           (count(*) over (partition by t.subject_id))::int as n
    from totals t
  )
  select r.subject_id, sub.name, sub.code, r.total, g.grade, g.remark,
         case when v_positions then r.pos end, r.avg_total, r.n
  from ranked r
  join public.subjects sub on sub.id = r.subject_id
  left join lateral app.grade_for(v_school, r.total) g on true
  where r.student_id = p_student_id
  order by sub.name;
end;
$$;

-- =============================================================================
-- RPCs: report cards
-- =============================================================================
create or replace function public.generate_report_cards(p_class_id uuid, p_term_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class     public.classes;
  v_term      public.academic_terms;
  v_positions boolean;
  v_count     integer;
begin
  select * into v_class from public.classes where id = p_class_id;
  select * into v_term from public.academic_terms where id = p_term_id and school_id = v_class.school_id;
  if v_class.id is null or v_term.id is null or not app.staff_can_see_class(v_class.school_id, p_class_id, 'examinations.view') then
    raise exception 'This class or term could not be found.' using errcode = 'KL404';
  end if;
  if not (app.can_write(v_class.school_id, 'examinations.approve')
          or (app.can_write(v_class.school_id, 'examinations.view') and app.is_class_teacher(p_class_id))) then
    raise exception 'Only the class teacher or the principal can prepare report cards.' using errcode = 'KL403';
  end if;
  select show_class_positions into v_positions from public.schools where id = v_class.school_id;

  with roster as (
    select distinct e.student_id
    from public.class_enrollments e
    where e.class_id = p_class_id and e.start_date <= v_term.end_date
      and (e.end_date is null or e.end_date >= v_term.start_date)
  ),
  totals as (select * from app.subject_totals(p_class_id, p_term_id, true)),
  subject_rows as (
    select t.student_id, t.subject_id, t.total,
           rank() over (partition by t.subject_id order by t.total desc)::int as pos
    from totals t
  ),
  per_student as (
    select r.student_id,
           round(avg(sr.total), 2) as average,
           coalesce(jsonb_agg(jsonb_build_object(
             'subject_id', sr.subject_id, 'name', sub.name, 'code', sub.code, 'total', sr.total,
             'grade', g.grade, 'remark', g.remark, 'position', case when v_positions then sr.pos end
           ) order by sub.name) filter (where sr.subject_id is not null), '[]'::jsonb) as subjects
    from roster r
    left join subject_rows sr on sr.student_id = r.student_id
    left join public.subjects sub on sub.id = sr.subject_id
    left join lateral app.grade_for(v_class.school_id, sr.total) g on true
    group by r.student_id
  ),
  attendance as (
    select r.student_id, jsonb_build_object(
      'present', count(*) filter (where ar.status = 'present'),
      'late', count(*) filter (where ar.status = 'late'),
      'absent', count(*) filter (where ar.status = 'absent'),
      'excused', count(*) filter (where ar.status = 'excused'),
      'total', count(ar.id)
    ) as summary
    from roster r
    left join public.attendance_records ar on ar.student_id = r.student_id
      and exists (
        select 1 from public.attendance_sessions s
        where s.id = ar.session_id and s.class_id = p_class_id and s.session_type in ('daily', 'morning')
          and s.attendance_date between v_term.start_date and v_term.end_date
      )
    group by r.student_id
  ),
  ranked as (
    select p.*, a.summary,
           (rank() over (order by p.average desc nulls last))::int as pos,
           (count(*) over ())::int as size
    from per_student p join attendance a on a.student_id = p.student_id
  )
  insert into public.report_cards (school_id, student_id, class_id, academic_year_id, term_id, average, grade, position,
                                   class_size, subjects, attendance, generated_at)
  select v_class.school_id, r.student_id, p_class_id, v_term.academic_year_id, p_term_id, r.average,
         (select g.grade from app.grade_for(v_class.school_id, r.average) g),
         case when v_positions and r.average is not null then r.pos end, r.size, r.subjects, r.summary, now()
  from ranked r
  on conflict (student_id, term_id) do update
    set class_id = excluded.class_id, average = excluded.average, grade = excluded.grade, position = excluded.position,
        class_size = excluded.class_size, subjects = excluded.subjects, attendance = excluded.attendance,
        generated_at = now()
    where public.report_cards.status = 'draft' or app.has_permission(public.report_cards.school_id, 'examinations.approve');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.save_report_comment(p_report_card_id uuid, p_kind text, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.report_cards;
begin
  select * into v_card from public.report_cards where id = p_report_card_id for update;
  if not found or not app.staff_can_see_class(v_card.school_id, v_card.class_id, 'examinations.view') then
    raise exception 'This report card could not be found.' using errcode = 'KL404';
  end if;
  if v_card.status = 'published' and not app.can_write(v_card.school_id, 'examinations.approve') then
    raise exception 'This report card has been published. Ask the principal to change it.' using errcode = 'KL403';
  end if;
  if p_kind = 'teacher' then
    if not (app.can_write(v_card.school_id, 'examinations.approve') or (app.school_is_writable(v_card.school_id) and app.is_class_teacher(v_card.class_id))) then
      raise exception 'Only the class teacher can write this comment.' using errcode = 'KL403';
    end if;
    update public.report_cards set teacher_comment = nullif(trim(p_comment), '') where id = p_report_card_id;
  elsif p_kind = 'principal' then
    if not app.can_write(v_card.school_id, 'examinations.approve') then
      raise exception 'Only the principal can write this comment.' using errcode = 'KL403';
    end if;
    update public.report_cards set principal_comment = nullif(trim(p_comment), '') where id = p_report_card_id;
  else
    raise exception 'Unknown comment.' using errcode = 'KL400';
  end if;
end;
$$;

create or replace function public.publish_report_cards(p_class_id uuid, p_term_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_count  integer;
begin
  select school_id into v_school from public.classes where id = p_class_id;
  if v_school is null or not app.can_write(v_school, 'examinations.approve') then
    raise exception 'You do not have permission to publish report cards.' using errcode = 'KL403';
  end if;
  update public.report_cards
  set status = 'published', published_by = auth.uid(), published_at = now()
  where class_id = p_class_id and term_id = p_term_id and status = 'draft';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.seed_grading_scale(uuid), app.seed_school_grading(), app.grade_for(uuid, numeric),
  app.check_assessment(), app.is_class_teacher(uuid), app.guardian_can_see_results(uuid),
  app.can_record_scores(uuid, uuid, uuid, text), app.subject_totals(uuid, uuid, boolean) from public;
grant execute on function app.is_class_teacher(uuid), app.guardian_can_see_results(uuid),
  app.can_record_scores(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.save_scores(uuid, jsonb), public.submit_assessment(uuid), public.review_assessment(uuid, boolean, text),
  public.publish_assessments(uuid[]), public.get_class_results(uuid, uuid, boolean), public.get_student_results(uuid, uuid),
  public.generate_report_cards(uuid, uuid), public.save_report_comment(uuid, text, text), public.publish_report_cards(uuid, uuid)
  from public, anon;
grant execute on function public.save_scores(uuid, jsonb), public.submit_assessment(uuid), public.review_assessment(uuid, boolean, text),
  public.publish_assessments(uuid[]), public.get_class_results(uuid, uuid, boolean), public.get_student_results(uuid, uuid),
  public.generate_report_cards(uuid, uuid), public.save_report_comment(uuid, text, text), public.publish_report_cards(uuid, uuid)
  to authenticated;

-- Replaces a school's grading scale in one step. The lowest band must start at 0.
create or replace function public.set_grading_scale(p_school_id uuid, p_bands jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.can_write(p_school_id, 'examinations.approve') or app.can_write(p_school_id, 'settings.edit')) then
    raise exception 'You do not have permission to change the grading scale.' using errcode = 'KL403';
  end if;
  if jsonb_typeof(p_bands) <> 'array' or jsonb_array_length(p_bands) = 0 or jsonb_array_length(p_bands) > 20 then
    raise exception 'Add between 1 and 20 grades.' using errcode = 'KL400';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_bands) b where (b ->> 'min_score')::numeric = 0) then
    raise exception 'One grade must start at 0 so every score gets a grade.' using errcode = 'KL400';
  end if;
  delete from public.grading_bands where school_id = p_school_id;
  insert into public.grading_bands (school_id, grade, min_score, remark)
  select p_school_id, trim(b ->> 'grade'), (b ->> 'min_score')::numeric, nullif(trim(coalesce(b ->> 'remark', '')), '')
  from jsonb_array_elements(p_bands) b;
exception
  when unique_violation then
    raise exception 'Each grade and each starting score must be different.' using errcode = 'KL400';
end;
$$;

revoke all on function public.set_grading_scale(uuid, jsonb) from public, anon;
grant execute on function public.set_grading_scale(uuid, jsonb) to authenticated;
