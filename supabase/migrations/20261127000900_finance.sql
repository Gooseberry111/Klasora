-- =============================================================================
-- Klasora · Phase 6 · School finance
--
-- Fee structures, invoices with itemised fees and discounts, manually recorded
-- payments (cash, bank transfer, POS, cheque) with approval, allocation of
-- payments to invoices, receipts and financial reporting.
--
-- Rules:
--   * Money is integer minor units (kobo) in bigint columns. Never floats.
--   * Invoices, items, payments and allocations are written only through the
--     functions below, which check permissions and keep totals consistent.
--     Nobody can update an amount column directly.
--   * Only confirmed payments count towards what an invoice has been paid.
--     A payment recorded by someone without finance.approve waits for
--     approval. Manual payments are always marked as manual (provider).
--   * Online payments (a later phase) will use provider and payment_reference,
--     which are unique per provider, so a repeated webhook cannot record the
--     same payment twice.
--   * Families see issued invoices and confirmed payments for their own
--     children, and only when their link allows finances.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Payment instructions shown to families (bank details, bursary hours).
-- -----------------------------------------------------------------------------
alter table public.schools add column payment_instructions text check (char_length(payment_instructions) <= 2000);

-- -----------------------------------------------------------------------------
-- A notification kind for invoices and payments.
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('announcement', 'message', 'absence', 'assignment', 'result', 'report_card', 'fees', 'general'));
alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check
  check (kind in ('announcement', 'message', 'absence', 'assignment', 'result', 'report_card', 'fees', 'general'));

-- Fee notices are also emailed unless the person turns that off.
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
    case when p_channel = 'push' then true else p_kind in ('announcement', 'report_card', 'fees') end
  );
$$;

-- -----------------------------------------------------------------------------
-- fee_structures: what the school charges, for whom and how often.
--   per_term: on every term invoice of the session (or one term if term_id set)
--   per_year: once per student per session
--   once:     once per student ever (registration, for example)
-- Optional fees (transport, boarding) are not added automatically; they are
-- added to the invoices of the students who take them.
-- -----------------------------------------------------------------------------
create table public.fee_structures (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  academic_year_id uuid not null,
  term_id          uuid,
  name             text not null check (char_length(trim(name)) between 1 and 120),
  description      text check (char_length(description) <= 500),
  category         text not null default 'tuition'
                     check (category in ('tuition', 'registration', 'examination', 'development_levy', 'transport',
                                         'accommodation', 'laboratory', 'books', 'uniform', 'feeding', 'excursion', 'other')),
  amount           bigint not null check (amount > 0 and amount <= 100000000000),
  frequency        text not null default 'per_term' check (frequency in ('per_term', 'per_year', 'once')),
  class_id         uuid,
  department_id    uuid,
  is_mandatory     boolean not null default true,
  status           public.record_status not null default 'active',
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fee_structures_year_fk
    foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete restrict,
  constraint fee_structures_term_fk
    foreign key (term_id, school_id) references public.academic_terms (id, school_id) on delete restrict,
  constraint fee_structures_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete cascade,
  constraint fee_structures_department_fk
    foreign key (department_id, school_id) references public.departments (id, school_id) on delete cascade,
  constraint fee_structures_one_target check (class_id is null or department_id is null),
  constraint fee_structures_term_only_per_term check (term_id is null or frequency = 'per_term'),
  constraint fee_structures_id_school_unique unique (id, school_id)
);
create index fee_structures_school_idx on public.fee_structures (school_id, academic_year_id, status);

create or replace function app.check_fee_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.term_id is not null and not exists (
    select 1 from public.academic_terms t where t.id = new.term_id and t.academic_year_id = new.academic_year_id
  ) then
    raise exception 'That term belongs to a different academic session.' using errcode = 'KL400';
  end if;
  return new;
end;
$$;

create trigger fee_structures_check
  before insert or update on public.fee_structures
  for each row execute function app.check_fee_structure();

-- -----------------------------------------------------------------------------
-- invoices
-- -----------------------------------------------------------------------------
create type public.invoice_status as enum ('draft', 'issued', 'part_paid', 'paid', 'void');

create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  student_id       uuid not null,
  invoice_number   text not null check (char_length(invoice_number) <= 40),
  academic_year_id uuid not null,
  term_id          uuid,
  class_id         uuid,
  title            text not null default 'School fees' check (char_length(trim(title)) between 1 and 120),
  issue_date       date,
  due_date         date not null,
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal         bigint not null default 0,
  discount_total   bigint not null default 0,
  total_amount     bigint not null default 0,
  amount_paid      bigint not null default 0,
  balance          bigint generated always as (total_amount - amount_paid) stored,
  status           public.invoice_status not null default 'draft',
  notes            text check (char_length(notes) <= 1000),
  created_by       uuid references public.profiles (id) on delete set null,
  issued_by        uuid references public.profiles (id) on delete set null,
  issued_at        timestamptz,
  voided_by        uuid references public.profiles (id) on delete set null,
  voided_at        timestamptz,
  void_reason      text check (char_length(void_reason) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint invoices_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete restrict,
  constraint invoices_year_fk
    foreign key (academic_year_id, school_id) references public.academic_years (id, school_id) on delete restrict,
  constraint invoices_term_fk
    foreign key (term_id, school_id) references public.academic_terms (id, school_id) on delete restrict,
  constraint invoices_class_fk
    foreign key (class_id, school_id) references public.classes (id, school_id) on delete set null (class_id),
  constraint invoices_amounts check (subtotal >= 0 and discount_total >= 0 and total_amount >= 0
                                     and amount_paid >= 0 and amount_paid <= total_amount),
  constraint invoices_number_unique unique (school_id, invoice_number),
  constraint invoices_id_school_unique unique (id, school_id)
);
create index invoices_school_idx on public.invoices (school_id, status, due_date);
create index invoices_student_idx on public.invoices (student_id, created_at desc);
create index invoices_term_idx on public.invoices (term_id);

create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  invoice_id       uuid not null,
  fee_structure_id uuid,
  description      text not null check (char_length(trim(description)) between 1 and 200),
  category         text not null default 'other'
                     check (category in ('tuition', 'registration', 'examination', 'development_levy', 'transport',
                                         'accommodation', 'laboratory', 'books', 'uniform', 'feeding', 'excursion',
                                         'other', 'discount')),
  kind             text not null default 'charge' check (kind in ('charge', 'discount')),
  amount           bigint not null check (amount > 0 and amount <= 100000000000),
  note             text check (char_length(note) <= 500),
  position         smallint not null default 0,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint invoice_items_invoice_fk
    foreign key (invoice_id, school_id) references public.invoices (id, school_id) on delete cascade,
  constraint invoice_items_fee_fk
    foreign key (fee_structure_id, school_id) references public.fee_structures (id, school_id) on delete restrict
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);
create index invoice_items_fee_idx on public.invoice_items (fee_structure_id) where fee_structure_id is not null;

-- -----------------------------------------------------------------------------
-- payments and their allocation to invoices
-- -----------------------------------------------------------------------------
create type public.payment_status as enum ('pending', 'confirmed', 'rejected', 'reversed');

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools (id) on delete cascade,
  student_id        uuid not null,
  receipt_number    text check (char_length(receipt_number) <= 40),
  payment_reference text check (char_length(trim(payment_reference)) between 1 and 100),
  amount            bigint not null check (amount > 0 and amount <= 100000000000),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  payment_method    text not null check (payment_method in ('cash', 'bank_transfer', 'pos', 'cheque', 'online', 'other')),
  payment_provider  text not null default 'manual' check (payment_provider in ('manual', 'paystack')),
  is_manual         boolean generated always as (payment_provider = 'manual') stored,
  status            public.payment_status not null default 'pending',
  paid_at           date not null,
  payer_name        text check (char_length(payer_name) <= 120),
  notes             text check (char_length(notes) <= 1000),
  recorded_by       uuid references public.profiles (id) on delete set null,
  approved_by       uuid references public.profiles (id) on delete set null,
  approved_at       timestamptz,
  review_note       text check (char_length(review_note) <= 500),
  reversed_by       uuid references public.profiles (id) on delete set null,
  reversed_at       timestamptz,
  reversal_reason   text check (char_length(reversal_reason) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint payments_student_fk
    foreign key (student_id, school_id) references public.students (id, school_id) on delete restrict,
  constraint payments_online_is_verified check (payment_provider = 'manual' or payment_method = 'online'),
  constraint payments_id_school_unique unique (id, school_id)
);
create unique index payments_receipt_unique on public.payments (school_id, receipt_number) where receipt_number is not null;
-- Idempotency for verified online payments: one row per provider reference.
create unique index payments_provider_reference_unique on public.payments (payment_provider, payment_reference)
  where payment_provider <> 'manual';
-- The same bank transfer or cheque cannot be recorded twice while it stands.
create unique index payments_manual_reference_unique on public.payments (school_id, payment_method, upper(payment_reference))
  where payment_provider = 'manual' and payment_reference is not null and status in ('pending', 'confirmed');
create index payments_school_idx on public.payments (school_id, status, paid_at desc);
create index payments_student_idx on public.payments (student_id, paid_at desc);

create table public.payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  payment_id  uuid not null,
  invoice_id  uuid not null,
  amount      bigint not null check (amount > 0),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint payment_allocations_payment_fk
    foreign key (payment_id, school_id) references public.payments (id, school_id) on delete cascade,
  constraint payment_allocations_invoice_fk
    foreign key (invoice_id, school_id) references public.invoices (id, school_id) on delete restrict,
  constraint payment_allocations_unique unique (payment_id, invoice_id)
);
create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id);

-- -----------------------------------------------------------------------------
-- Housekeeping and audit
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['fee_structures', 'invoices', 'payments'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', v_table || '_set_updated_at', v_table);
    execute format('create trigger %I before update on public.%I for each row execute function app.prevent_school_change()', v_table || '_prevent_school_change', v_table);
  end loop;
  foreach v_table in array array['fee_structures', 'invoices', 'invoice_items', 'payments', 'payment_allocations'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row_change()', v_table || '_audit', v_table);
  end loop;
end;
$$;

-- A fee that has been billed is kept for the record; archive it instead.
create or replace function app.protect_billed_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoice_items where fee_structure_id = old.id) then
    raise exception 'This fee is already on invoices. Archive it instead of deleting it.' using errcode = 'KL409';
  end if;
  return old;
end;
$$;

create trigger fee_structures_protect_billed
  before delete on public.fee_structures
  for each row execute function app.protect_billed_fee();

-- =============================================================================
-- Helpers
-- =============================================================================

-- The caller is a guardian of this student whose link allows finances.
create or replace function app.guardian_sees_finances(p_student_id uuid)
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
    where sg.student_id = p_student_id and g.user_id = auth.uid() and sg.can_view_finances
  );
$$;

create or replace function app.can_view_invoice(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.invoices i
    where i.id = p_invoice_id
      and (app.has_permission(i.school_id, 'finance.view')
           or (i.status in ('issued', 'part_paid', 'paid') and app.guardian_sees_finances(i.student_id)))
  );
$$;

create or replace function app.can_view_payment(p_payment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.payments p
    where p.id = p_payment_id
      and (app.has_permission(p.school_id, 'finance.view')
           or (p.status in ('confirmed', 'reversed') and app.guardian_sees_finances(p.student_id)))
  );
$$;

-- Guardians who should hear about fees for this student.
create or replace function app.guardian_finance_users(p_student_id uuid)
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
  where sg.student_id = p_student_id and g.user_id is not null and sg.can_view_finances and sg.can_receive_notifications;
$$;

-- Amounts in notifications, for example ₦150,000 or ₦1,250.50.
create or replace function app.format_money(p_amount bigint, p_currency text)
returns text
language sql
immutable
set search_path = ''
as $$
  select (case upper(p_currency)
            when 'NGN' then '₦' when 'GHS' then 'GH₵' when 'KES' then 'KSh ' when 'ZAR' then 'R '
            when 'GBP' then '£' when 'USD' then '$' else upper(p_currency) || ' ' end)
      || case when p_amount % 100 = 0 then to_char(p_amount / 100, 'FM999,999,999,990')
              else to_char(p_amount / 100.0, 'FM999,999,999,990.00') end;
$$;

-- INV/2026/00001 and RCT/2026/00001, numbered per school and year.
create or replace function app.next_document_number(p_school_id uuid, p_prefix text)
returns text
language sql
security definer
set search_path = ''
as $$
  select p_prefix || '/' || extract(year from current_date)::int || '/'
      || lpad(app.next_counter(p_school_id, lower(p_prefix) || ':' || extract(year from current_date)::int)::text, 5, '0');
$$;

-- Recalculates an invoice from its items and confirmed allocations.
create or replace function app.refresh_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charges   bigint;
  v_discounts bigint;
  v_paid      bigint;
  v_total     bigint;
  v_status    public.invoice_status;
begin
  select coalesce(sum(amount) filter (where kind = 'charge'), 0), coalesce(sum(amount) filter (where kind = 'discount'), 0)
  into v_charges, v_discounts
  from public.invoice_items where invoice_id = p_invoice_id;

  select coalesce(sum(a.amount), 0) into v_paid
  from public.payment_allocations a
  join public.payments p on p.id = a.payment_id
  where a.invoice_id = p_invoice_id and p.status = 'confirmed';

  v_total := v_charges - v_discounts;
  if v_total < 0 then
    raise exception 'Discounts cannot be more than the fees on an invoice.' using errcode = 'KL400';
  end if;
  if v_paid > v_total then
    raise exception 'This would leave the invoice with less than has already been paid.' using errcode = 'KL409';
  end if;

  select case
           when i.status in ('draft', 'void') then i.status
           when v_paid >= v_total then 'paid'::public.invoice_status
           when v_paid > 0 then 'part_paid'::public.invoice_status
           else 'issued'::public.invoice_status
         end
  into v_status
  from public.invoices i where i.id = p_invoice_id;

  update public.invoices
  set subtotal = v_charges, discount_total = v_discounts, total_amount = v_total, amount_paid = v_paid, status = v_status
  where id = p_invoice_id
    and (subtotal, discount_total, total_amount, amount_paid, status)
        is distinct from (v_charges, v_discounts, v_total, v_paid, v_status);
end;
$$;

-- What is still open on an invoice, counting payments that are waiting for approval.
create or replace function app.invoice_open_amount(p_invoice_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select i.total_amount - coalesce((
    select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
    where a.invoice_id = i.id and p.status in ('pending', 'confirmed')
  ), 0)
  from public.invoices i where i.id = p_invoice_id;
$$;

-- What part of a payment is not yet allocated to an invoice.
create or replace function app.payment_unallocated(p_payment_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = p.id), 0)
  from public.payments p where p.id = p_payment_id;
$$;

-- Adds one line to an invoice. Used by every function that builds invoices.
create or replace function app.add_item(p_invoice public.invoices, p_item jsonb, p_position integer, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee    public.fee_structures;
  v_id     uuid;
  v_amount bigint;
  v_kind   text := coalesce(nullif(p_item ->> 'kind', ''), 'charge');
begin
  if nullif(p_item ->> 'fee_structure_id', '') is not null then
    select * into v_fee from public.fee_structures
    where id = (p_item ->> 'fee_structure_id')::uuid and school_id = p_invoice.school_id;
    if v_fee.id is null then
      raise exception 'That fee could not be found.' using errcode = 'KL404';
    end if;
  end if;
  v_amount := coalesce(nullif(p_item ->> 'amount', '')::bigint, v_fee.amount);
  if v_amount is null or v_amount <= 0 then
    raise exception 'Every line needs an amount above zero.' using errcode = 'KL400';
  end if;
  if v_kind not in ('charge', 'discount') then
    raise exception 'Unknown line type.' using errcode = 'KL400';
  end if;
  insert into public.invoice_items (school_id, invoice_id, fee_structure_id, description, category, kind, amount, note, position, created_by)
  values (
    p_invoice.school_id, p_invoice.id, v_fee.id,
    coalesce(nullif(trim(p_item ->> 'description'), ''), v_fee.name, case when v_kind = 'discount' then 'Discount' else 'Fee' end),
    coalesce(nullif(p_item ->> 'category', ''), v_fee.category, case when v_kind = 'discount' then 'discount' else 'other' end),
    v_kind, v_amount, nullif(trim(coalesce(p_note, p_item ->> 'note')), ''), p_position, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Creates an invoice shell. The caller adds items and refreshes it.
create or replace function app.new_invoice(p_student public.students, p_year_id uuid, p_term_id uuid, p_due_date date, p_title text, p_notes text)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_class   uuid;
begin
  select class_id into v_class from public.class_enrollments where student_id = p_student.id and status = 'active';
  insert into public.invoices (school_id, student_id, invoice_number, academic_year_id, term_id, class_id, title, due_date, currency, notes, created_by)
  select p_student.school_id, p_student.id, app.next_document_number(p_student.school_id, 'INV'), p_year_id, p_term_id, v_class,
         coalesce(nullif(trim(p_title), ''), 'School fees'), p_due_date, s.default_currency, nullif(trim(p_notes), ''), auth.uid()
  from public.schools s where s.id = p_student.school_id
  returning * into v_invoice;
  return v_invoice;
end;
$$;

-- Moves a draft invoice to issued and tells the family.
create or replace function app.issue_invoice(p_invoice_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_student public.students;
  v_user    uuid;
begin
  update public.invoices
  set status = 'issued', issued_by = auth.uid(), issued_at = now(), issue_date = coalesce(issue_date, current_date)
  where id = p_invoice_id and status = 'draft'
  returning * into v_invoice;
  if v_invoice.id is null then
    return false;
  end if;
  perform app.refresh_invoice(v_invoice.id);
  select * into v_invoice from public.invoices where id = p_invoice_id;
  select * into v_student from public.students where id = v_invoice.student_id;
  for v_user in select user_id from app.guardian_finance_users(v_student.id) loop
    perform app.notify(v_invoice.school_id, v_user, 'fees',
      'New invoice for ' || v_student.first_name,
      v_invoice.invoice_number || ' for ' || app.format_money(v_invoice.total_amount, v_invoice.currency)
        || ' is due on ' || to_char(v_invoice.due_date, 'DD/MM/YYYY') || '.',
      app.school_path(v_invoice.school_id) || '/fees', v_invoice.id, true);
  end loop;
  return true;
end;
$$;

-- Confirms a payment: gives it a receipt number, updates invoices, tells the family.
create or replace function app.confirm_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_student public.students;
  v_invoice uuid;
  v_user    uuid;
begin
  update public.payments
  set status = 'confirmed', approved_by = auth.uid(), approved_at = now(),
      receipt_number = coalesce(receipt_number, app.next_document_number(school_id, 'RCT'))
  where id = p_payment_id
  returning * into v_payment;
  for v_invoice in select invoice_id from public.payment_allocations where payment_id = p_payment_id loop
    perform app.refresh_invoice(v_invoice);
  end loop;
  select * into v_student from public.students where id = v_payment.student_id;
  for v_user in select user_id from app.guardian_finance_users(v_student.id) loop
    perform app.notify(v_payment.school_id, v_user, 'fees',
      'Payment received for ' || v_student.first_name,
      app.format_money(v_payment.amount, v_payment.currency) || ' received on ' || to_char(v_payment.paid_at, 'DD/MM/YYYY')
        || '. Receipt ' || v_payment.receipt_number || '.',
      app.school_path(v_payment.school_id) || '/fees', v_payment.id, true);
  end loop;
end;
$$;

-- Allocates a payment. With no list, pays the oldest open invoices first.
create or replace function app.allocate(p_payment public.payments, p_allocations jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left    bigint := app.payment_unallocated(p_payment.id);
  v_item    jsonb;
  v_invoice public.invoices;
  v_amount  bigint;
  v_open    bigint;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    for v_invoice in
      select * from public.invoices
      where student_id = p_payment.student_id and status in ('issued', 'part_paid')
      order by due_date, created_at
    loop
      exit when v_left <= 0;
      v_open := app.invoice_open_amount(v_invoice.id);
      continue when v_open <= 0;
      v_amount := least(v_open, v_left);
      insert into public.payment_allocations (school_id, payment_id, invoice_id, amount, created_by)
      values (p_payment.school_id, p_payment.id, v_invoice.id, v_amount, auth.uid())
      on conflict (payment_id, invoice_id) do update set amount = public.payment_allocations.amount + excluded.amount;
      v_left := v_left - v_amount;
    end loop;
  else
    for v_item in select * from jsonb_array_elements(p_allocations) loop
      v_amount := nullif(v_item ->> 'amount', '')::bigint;
      continue when coalesce(v_amount, 0) = 0;
      if v_amount < 0 then
        raise exception 'Allocations must be above zero.' using errcode = 'KL400';
      end if;
      select * into v_invoice from public.invoices
      where id = (v_item ->> 'invoice_id')::uuid and student_id = p_payment.student_id;
      if v_invoice.id is null then
        raise exception 'That invoice does not belong to this student.' using errcode = 'KL400';
      end if;
      if v_invoice.status not in ('issued', 'part_paid') then
        raise exception 'Invoice % is not open for payment.', v_invoice.invoice_number using errcode = 'KL409';
      end if;
      if v_amount > app.invoice_open_amount(v_invoice.id) then
        raise exception 'That is more than is owed on invoice %.', v_invoice.invoice_number using errcode = 'KL409';
      end if;
      if v_amount > v_left then
        raise exception 'The allocations add up to more than the payment.' using errcode = 'KL400';
      end if;
      insert into public.payment_allocations (school_id, payment_id, invoice_id, amount, created_by)
      values (p_payment.school_id, p_payment.id, v_invoice.id, v_amount, auth.uid())
      on conflict (payment_id, invoice_id) do update set amount = public.payment_allocations.amount + excluded.amount;
      v_left := v_left - v_amount;
    end loop;
  end if;

  if p_payment.status = 'confirmed' then
    for v_invoice in
      select i.* from public.invoices i join public.payment_allocations a on a.invoice_id = i.id where a.payment_id = p_payment.id
    loop
      perform app.refresh_invoice(v_invoice.id);
    end loop;
  end if;
  return v_left;
end;
$$;

revoke all on function app.check_fee_structure(), app.protect_billed_fee(), app.guardian_sees_finances(uuid),
  app.can_view_invoice(uuid), app.can_view_payment(uuid), app.guardian_finance_users(uuid),
  app.next_document_number(uuid, text), app.refresh_invoice(uuid), app.invoice_open_amount(uuid),
  app.payment_unallocated(uuid), app.add_item(public.invoices, jsonb, integer, text),
  app.new_invoice(public.students, uuid, uuid, date, text, text), app.issue_invoice(uuid),
  app.confirm_payment(uuid), app.allocate(public.payments, jsonb) from public;
grant execute on function app.guardian_sees_finances(uuid), app.can_view_invoice(uuid), app.can_view_payment(uuid)
  to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.fee_structures      enable row level security;
alter table public.invoices            enable row level security;
alter table public.invoice_items       enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;

revoke all on public.fee_structures, public.invoices, public.invoice_items, public.payments, public.payment_allocations
  from anon, authenticated;

-- fee_structures: finance staff manage them directly.
grant select, delete on public.fee_structures to authenticated;
grant insert (school_id, academic_year_id, term_id, name, description, category, amount, frequency, class_id,
              department_id, is_mandatory, status)
  on public.fee_structures to authenticated;
grant update (academic_year_id, term_id, name, description, category, amount, frequency, class_id, department_id,
              is_mandatory, status)
  on public.fee_structures to authenticated;

create policy fee_structures_select on public.fee_structures
  for select to authenticated using (app.has_permission(school_id, 'finance.view'));
create policy fee_structures_insert on public.fee_structures
  for insert to authenticated with check (app.can_write(school_id, 'finance.create'));
create policy fee_structures_update on public.fee_structures
  for update to authenticated
  using (app.can_write(school_id, 'finance.edit'))
  with check (app.can_write(school_id, 'finance.edit'));
create policy fee_structures_delete on public.fee_structures
  for delete to authenticated using (app.can_write(school_id, 'finance.delete'));

-- Invoices, items, payments and allocations: read only; written by the functions below.
grant select on public.invoices, public.invoice_items, public.payments, public.payment_allocations to authenticated;

create policy invoices_select on public.invoices
  for select to authenticated
  using (app.has_permission(school_id, 'finance.view')
         or (status in ('issued', 'part_paid', 'paid') and app.guardian_sees_finances(student_id)));
create policy invoice_items_select on public.invoice_items
  for select to authenticated using (app.can_view_invoice(invoice_id));
create policy payments_select on public.payments
  for select to authenticated
  using (app.has_permission(school_id, 'finance.view')
         or (status in ('confirmed', 'reversed') and app.guardian_sees_finances(student_id)));
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (app.has_permission(school_id, 'finance.view') or app.can_view_payment(payment_id));

-- =============================================================================
-- RPCs: invoices
-- =============================================================================

-- Creates one invoice for one student. Items: [{fee_structure_id?, description, category, kind, amount}].
create or replace function public.create_invoice(
  p_student_id uuid,
  p_term_id    uuid,
  p_due_date   date,
  p_items      jsonb,
  p_title      text default null,
  p_notes      text default null,
  p_issue      boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_year    uuid;
  v_invoice public.invoices;
  v_item    jsonb;
  v_pos     integer := 0;
begin
  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null or not app.can_write(v_student.school_id, 'finance.create') then
    raise exception 'You do not have permission to create invoices.' using errcode = 'KL403';
  end if;
  if p_due_date is null then
    raise exception 'Choose a due date.' using errcode = 'KL400';
  end if;
  if p_term_id is not null then
    select academic_year_id into v_year from public.academic_terms where id = p_term_id and school_id = v_student.school_id;
    if v_year is null then
      raise exception 'That term could not be found.' using errcode = 'KL404';
    end if;
  else
    select id into v_year from public.academic_years where school_id = v_student.school_id and is_current;
    if v_year is null then
      raise exception 'Mark an academic session as current first.' using errcode = 'KL400';
    end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or not exists (select 1 from jsonb_array_elements(p_items) e where coalesce(e ->> 'kind', 'charge') = 'charge') then
    raise exception 'Add at least one fee to the invoice.' using errcode = 'KL400';
  end if;

  v_invoice := app.new_invoice(v_student, v_year, p_term_id, p_due_date, p_title, p_notes);
  for v_item in select * from jsonb_array_elements(p_items) loop
    perform app.add_item(v_invoice, v_item, v_pos);
    v_pos := v_pos + 1;
  end loop;
  perform app.refresh_invoice(v_invoice.id);
  if p_issue then
    perform app.issue_invoice(v_invoice.id);
  end if;
  return v_invoice.id;
end;
$$;

-- Bills every active student in the chosen classes for a term, from the fee
-- structures. Students who already have an invoice for the term are skipped.
-- With p_dry_run, nothing is written and the summary shows what would happen.
create or replace function public.generate_invoices(
  p_term_id   uuid,
  p_class_ids uuid[],
  p_due_date  date,
  p_issue     boolean default false,
  p_dry_run   boolean default true
)
returns table (class_id uuid, class_name text, students integer, invoices integer, skipped integer, total_amount bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_term     public.academic_terms;
  v_class    public.classes;
  v_student  public.students;
  v_invoice  public.invoices;
  v_fee      public.fee_structures;
  v_pos      integer;
  v_students integer;
  v_made     integer;
  v_skipped  integer;
  v_total    bigint;
  v_sum      bigint;
  v_has      boolean;
begin
  select * into v_term from public.academic_terms where id = p_term_id;
  if v_term.id is null or not app.can_write(v_term.school_id, 'finance.create') then
    raise exception 'You do not have permission to create invoices.' using errcode = 'KL403';
  end if;
  if p_due_date is null and not p_dry_run then
    raise exception 'Choose a due date.' using errcode = 'KL400';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invoices:' || v_term.school_id::text, 0));

  for v_class in
    select * from public.classes c
    where c.school_id = v_term.school_id and c.status = 'active'
      and (p_class_ids is null or cardinality(p_class_ids) = 0 or c.id = any (p_class_ids))
    order by c.level_order, c.name
  loop
    v_students := 0; v_made := 0; v_skipped := 0; v_total := 0;
    for v_student in
      select s.* from public.class_enrollments e join public.students s on s.id = e.student_id
      where e.class_id = v_class.id and e.status = 'active' and s.status = 'active'
      order by s.last_name, s.first_name
    loop
      v_students := v_students + 1;
      if exists (select 1 from public.invoices i where i.student_id = v_student.id and i.term_id = p_term_id and i.status <> 'void') then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_sum := 0; v_pos := 0; v_has := false; v_invoice := null;
      for v_fee in
        select f.* from public.fee_structures f
        where f.school_id = v_term.school_id and f.status = 'active' and f.is_mandatory
          and f.academic_year_id = v_term.academic_year_id
          and (f.term_id is null or f.term_id = p_term_id)
          and (f.class_id is null or f.class_id = v_class.id)
          and (f.department_id is null or f.department_id = v_class.department_id)
          and (
            f.frequency = 'per_term'
            or (f.frequency = 'per_year' and not exists (
                  select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id
                  where it.fee_structure_id = f.id and i.student_id = v_student.id and i.status <> 'void'
                    and i.academic_year_id = v_term.academic_year_id))
            or (f.frequency = 'once' and not exists (
                  select 1 from public.invoice_items it join public.invoices i on i.id = it.invoice_id
                  where it.fee_structure_id = f.id and i.student_id = v_student.id and i.status <> 'void'))
          )
        order by f.category = 'tuition' desc, f.name
      loop
        v_has := true;
        v_sum := v_sum + v_fee.amount;
        if not p_dry_run then
          if v_invoice.id is null then
            v_invoice := app.new_invoice(v_student, v_term.academic_year_id, p_term_id, p_due_date,
                                         v_term.name || ' fees', null);
          end if;
          perform app.add_item(v_invoice, jsonb_build_object('fee_structure_id', v_fee.id), v_pos);
          v_pos := v_pos + 1;
        end if;
      end loop;

      if not v_has then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_made := v_made + 1;
      v_total := v_total + v_sum;
      if not p_dry_run then
        perform app.refresh_invoice(v_invoice.id);
        if p_issue then
          perform app.issue_invoice(v_invoice.id);
        end if;
      end if;
    end loop;

    class_id := v_class.id; class_name := v_class.name; students := v_students;
    invoices := v_made; skipped := v_skipped; total_amount := v_total;
    return next;
  end loop;
end;
$$;

create or replace function public.issue_invoices(p_invoice_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_count   integer := 0;
begin
  for v_invoice in select * from public.invoices where id = any (p_invoice_ids) loop
    if not app.can_write(v_invoice.school_id, 'finance.create') then
      raise exception 'You do not have permission to issue invoices.' using errcode = 'KL403';
    end if;
    if app.issue_invoice(v_invoice.id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Drafts are edited freely by finance.edit. Changing an issued invoice needs
-- finance.approve and a reason, which is kept on the line.
create or replace function app.check_invoice_change(p_invoice public.invoices, p_reason text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_invoice.id is null then
    raise exception 'That invoice could not be found.' using errcode = 'KL404';
  end if;
  if p_invoice.status = 'void' then
    raise exception 'This invoice has been cancelled.' using errcode = 'KL409';
  end if;
  if p_invoice.status = 'draft' then
    if not app.can_write(p_invoice.school_id, 'finance.edit') then
      raise exception 'You do not have permission to change invoices.' using errcode = 'KL403';
    end if;
  else
    if not app.can_write(p_invoice.school_id, 'finance.approve') then
      raise exception 'Only someone who can approve finance changes can change an issued invoice.' using errcode = 'KL403';
    end if;
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'Give a reason for changing an issued invoice.' using errcode = 'KL400';
    end if;
  end if;
end;
$$;
revoke all on function app.check_invoice_change(public.invoices, text) from public;

create or replace function public.add_invoice_item(p_invoice_id uuid, p_item jsonb, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_id      uuid;
  v_pos     integer;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  perform app.check_invoice_change(v_invoice, p_reason);
  select coalesce(max(position) + 1, 0) into v_pos from public.invoice_items where invoice_id = p_invoice_id;
  v_id := app.add_item(v_invoice, p_item, v_pos, p_reason);
  perform app.refresh_invoice(p_invoice_id);
  if app.invoice_open_amount(p_invoice_id) < 0 then
    raise exception 'This discount is larger than what is still owed.' using errcode = 'KL409';
  end if;
  return v_id;
end;
$$;

create or replace function public.remove_invoice_item(p_item_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item    public.invoice_items;
  v_invoice public.invoices;
begin
  select * into v_item from public.invoice_items where id = p_item_id;
  select * into v_invoice from public.invoices where id = v_item.invoice_id for update;
  perform app.check_invoice_change(v_invoice, p_reason);
  delete from public.invoice_items where id = p_item_id;
  if v_invoice.status <> 'draft' then
    insert into public.audit_logs (school_id, actor_user_id, action, entity_type, entity_id, new_data, ip_address)
    values (v_invoice.school_id, auth.uid(), 'remove_line', 'invoices', v_invoice.id,
            jsonb_build_object('description', v_item.description, 'amount', v_item.amount, 'kind', v_item.kind, 'reason', trim(p_reason)),
            app.request_ip());
  end if;
  perform app.refresh_invoice(v_invoice.id);
  if app.invoice_open_amount(v_invoice.id) < 0 then
    raise exception 'This would leave the invoice with less than has already been paid.' using errcode = 'KL409';
  end if;
end;
$$;

create or replace function public.update_invoice(p_invoice_id uuid, p_title text, p_due_date date, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.id is null or not app.can_write(v_invoice.school_id, 'finance.edit') then
    raise exception 'You do not have permission to change invoices.' using errcode = 'KL403';
  end if;
  if v_invoice.status = 'void' then
    raise exception 'This invoice has been cancelled.' using errcode = 'KL409';
  end if;
  if p_due_date is null then
    raise exception 'Choose a due date.' using errcode = 'KL400';
  end if;
  update public.invoices
  set title = coalesce(nullif(trim(p_title), ''), title), due_date = p_due_date, notes = nullif(trim(p_notes), '')
  where id = p_invoice_id;
end;
$$;

create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null or not app.can_write(v_invoice.school_id, 'finance.delete') then
    raise exception 'You do not have permission to cancel invoices.' using errcode = 'KL403';
  end if;
  if v_invoice.status = 'void' then
    return;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for cancelling this invoice.' using errcode = 'KL400';
  end if;
  if exists (
    select 1 from public.payment_allocations a join public.payments p on p.id = a.payment_id
    where a.invoice_id = p_invoice_id and p.status in ('pending', 'confirmed')
  ) then
    raise exception 'Payments are allocated to this invoice. Move or reverse them first.' using errcode = 'KL409';
  end if;
  update public.invoices
  set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
  where id = p_invoice_id;
end;
$$;

-- =============================================================================
-- RPCs: payments
-- =============================================================================

-- Records a payment received at the school. Confirmed straight away when the
-- recorder can approve payments; otherwise it waits for approval.
create or replace function public.record_payment(
  p_student_id  uuid,
  p_amount      bigint,
  p_method      text,
  p_paid_at     date,
  p_reference   text default null,
  p_payer_name  text default null,
  p_notes       text default null,
  p_allocations jsonb default null
)
returns table (payment_id uuid, receipt_number text, status public.payment_status, unallocated bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_student public.students;
  v_payment public.payments;
  v_dupe    text;
  v_left    bigint;
  v_user    uuid;
  v_ref     text := nullif(trim(p_reference), '');
begin
  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null or not app.can_write(v_student.school_id, 'finance.create') then
    raise exception 'You do not have permission to record payments.' using errcode = 'KL403';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount above zero.' using errcode = 'KL400';
  end if;
  if p_method not in ('cash', 'bank_transfer', 'pos', 'cheque', 'other') then
    raise exception 'Choose how the payment was made.' using errcode = 'KL400';
  end if;
  if p_paid_at is null or p_paid_at > current_date then
    raise exception 'The payment date cannot be in the future.' using errcode = 'KL400';
  end if;
  if p_paid_at < current_date - 730 then
    raise exception 'That payment date is more than two years ago.' using errcode = 'KL400';
  end if;
  if p_method in ('bank_transfer', 'pos', 'cheque') and v_ref is null then
    raise exception 'Enter the transfer reference, POS slip or cheque number.' using errcode = 'KL400';
  end if;
  if v_ref is not null then
    select coalesce(p.receipt_number, 'awaiting approval') into v_dupe from public.payments p
    where p.school_id = v_student.school_id and p.payment_provider = 'manual' and p.payment_method = p_method
      and upper(p.payment_reference) = upper(v_ref) and p.status in ('pending', 'confirmed');
    if v_dupe is not null then
      raise exception 'A payment with this reference is already recorded (%).', v_dupe using errcode = 'KL409';
    end if;
  end if;

  insert into public.payments (school_id, student_id, payment_reference, amount, currency, payment_method, payment_provider,
                               status, paid_at, payer_name, notes, recorded_by)
  select v_student.school_id, v_student.id, v_ref, p_amount, s.default_currency, p_method, 'manual',
         'pending', p_paid_at, nullif(trim(p_payer_name), ''), nullif(trim(p_notes), ''), auth.uid()
  from public.schools s where s.id = v_student.school_id
  returning * into v_payment;

  v_left := app.allocate(v_payment, p_allocations);

  if app.can_write(v_student.school_id, 'finance.approve') then
    perform app.confirm_payment(v_payment.id);
  else
    for v_user in
      select m.user_id from public.school_memberships m
      where m.school_id = v_student.school_id and m.status = 'active' and m.user_id <> auth.uid()
        and app.user_has_permission(v_student.school_id, m.user_id, 'finance.approve')
    loop
      perform app.notify(v_student.school_id, v_user, 'general', 'Payment waiting for approval',
        app.format_money(p_amount, v_payment.currency) || ' for ' || v_student.first_name || ' ' || v_student.last_name || '.',
        app.school_path(v_student.school_id) || '/finance/payments?tab=pending', v_payment.id, true);
    end loop;
  end if;

  select * into v_payment from public.payments where id = v_payment.id;
  payment_id := v_payment.id; receipt_number := v_payment.receipt_number; status := v_payment.status; unallocated := v_left;
  return next;
end;
$$;

create or replace function public.review_payment(p_payment_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_invoice uuid;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null or not app.can_write(v_payment.school_id, 'finance.approve') then
    raise exception 'You do not have permission to approve payments.' using errcode = 'KL403';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'This payment has already been reviewed.' using errcode = 'KL409';
  end if;
  if p_approve then
    -- Invoices may have been cancelled or reduced since the payment was recorded.
    for v_invoice in select a.invoice_id from public.payment_allocations a join public.invoices i on i.id = a.invoice_id
                     where a.payment_id = p_payment_id and i.status = 'void' loop
      delete from public.payment_allocations where payment_id = p_payment_id and invoice_id = v_invoice;
    end loop;
    update public.payments set review_note = nullif(trim(p_note), '') where id = p_payment_id;
    perform app.confirm_payment(p_payment_id);
  else
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Say why the payment is being rejected.' using errcode = 'KL400';
    end if;
    update public.payments
    set status = 'rejected', approved_by = auth.uid(), approved_at = now(), review_note = trim(p_note)
    where id = p_payment_id;
  end if;
end;
$$;

-- For a cheque that bounced or a payment recorded in error.
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_invoice uuid;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null or not app.can_write(v_payment.school_id, 'finance.approve') then
    raise exception 'You do not have permission to reverse payments.' using errcode = 'KL403';
  end if;
  if v_payment.status <> 'confirmed' then
    raise exception 'Only confirmed payments can be reversed.' using errcode = 'KL409';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for reversing this payment.' using errcode = 'KL400';
  end if;
  update public.payments
  set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = trim(p_reason)
  where id = p_payment_id;
  for v_invoice in select invoice_id from public.payment_allocations where payment_id = p_payment_id loop
    perform app.refresh_invoice(v_invoice);
  end loop;
end;
$$;

-- Applies the unallocated part of a payment (credit) to invoices.
create or replace function public.allocate_payment(p_payment_id uuid, p_allocations jsonb default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null or not app.can_write(v_payment.school_id, 'finance.edit') then
    raise exception 'You do not have permission to allocate payments.' using errcode = 'KL403';
  end if;
  if v_payment.status not in ('pending', 'confirmed') then
    raise exception 'This payment is no longer active.' using errcode = 'KL409';
  end if;
  return app.allocate(v_payment, p_allocations);
end;
$$;

create or replace function public.set_payment_instructions(p_school_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.can_write(p_school_id, 'finance.edit') then
    raise exception 'You do not have permission to change payment instructions.' using errcode = 'KL403';
  end if;
  update public.schools set payment_instructions = nullif(trim(p_text), '') where id = p_school_id;
end;
$$;

-- =============================================================================
-- Reporting
-- =============================================================================

-- Headline figures for a session or term, by class, by fee type and by method,
-- and collections for the last twelve months.
create or replace function public.finance_summary(p_school_id uuid, p_year_id uuid default null, p_term_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not app.has_permission(p_school_id, 'finance.view') then
    raise exception 'You do not have permission to view finances.' using errcode = 'KL403';
  end if;

  with scoped as (
    select i.* from public.invoices i
    where i.school_id = p_school_id and i.status in ('issued', 'part_paid', 'paid')
      and (p_year_id is null or i.academic_year_id = p_year_id)
      and (p_term_id is null or i.term_id = p_term_id)
  ),
  confirmed as (
    select p.* from public.payments p where p.school_id = p_school_id and p.status = 'confirmed'
  )
  select jsonb_build_object(
    'billed', coalesce((select sum(total_amount) from scoped), 0),
    'collected', coalesce((select sum(amount_paid) from scoped), 0),
    'outstanding', coalesce((select sum(balance) from scoped), 0),
    'invoices', (select count(*) from scoped),
    'paid_invoices', (select count(*) from scoped where status = 'paid'),
    'overdue_count', (select count(*) from scoped where balance > 0 and due_date < current_date),
    'overdue_amount', coalesce((select sum(balance) from scoped where balance > 0 and due_date < current_date), 0),
    'students_owing', (select count(distinct student_id) from scoped where balance > 0),
    'drafts', (select count(*) from public.invoices where school_id = p_school_id and status = 'draft'
               and (p_year_id is null or academic_year_id = p_year_id) and (p_term_id is null or term_id = p_term_id)),
    'pending_payments', (select count(*) from public.payments where school_id = p_school_id and status = 'pending'),
    'pending_amount', coalesce((select sum(amount) from public.payments where school_id = p_school_id and status = 'pending'), 0),
    'credit', coalesce((select sum(app.payment_unallocated(id)) from confirmed), 0),
    'by_class', coalesce((
      select jsonb_agg(row_to_json(c) order by c.level_order, c.name) from (
        select cl.id as class_id, cl.name, cl.level_order, count(distinct s.student_id) as students,
               sum(s.total_amount) as billed, sum(s.amount_paid) as collected, sum(s.balance) as outstanding
        from scoped s join public.classes cl on cl.id = s.class_id
        group by cl.id, cl.name, cl.level_order
      ) c), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(row_to_json(c) order by c.amount desc) from (
        select it.category, sum(case when it.kind = 'charge' then it.amount else -it.amount end) as amount
        from public.invoice_items it join scoped s on s.id = it.invoice_id
        group by it.category
      ) c), '[]'::jsonb),
    'by_method', coalesce((
      select jsonb_agg(row_to_json(m) order by m.amount desc) from (
        select payment_method as method, count(*) as payments, sum(amount) as amount
        from confirmed where paid_at >= current_date - 365
        group by payment_method
      ) m), '[]'::jsonb),
    'trend', (
      select jsonb_agg(jsonb_build_object('month', to_char(mo, 'YYYY-MM'), 'amount', coalesce(t.amount, 0)) order by mo)
      from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') mo
      left join (
        select date_trunc('month', paid_at) as m, sum(amount) as amount from confirmed group by 1
      ) t on t.m = mo
    )
  ) into v_result;
  return v_result;
end;
$$;

-- One row per student with invoices in scope: what they were billed, have
-- paid and still owe. Used for the debtors list and exports.
create or replace function public.student_balances(
  p_school_id uuid,
  p_year_id   uuid default null,
  p_term_id   uuid default null,
  p_class_id  uuid default null
)
returns table (
  student_id uuid, first_name text, last_name text, admission_number text, class_id uuid, class_name text,
  invoices bigint, billed bigint, paid bigint, balance bigint, overdue bigint, last_payment date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not app.has_permission(p_school_id, 'finance.view') then
    raise exception 'You do not have permission to view finances.' using errcode = 'KL403';
  end if;
  return query
  select s.id, s.first_name, s.last_name, s.admission_number, cl.id, cl.name,
         count(i.id), sum(i.total_amount)::bigint, sum(i.amount_paid)::bigint, sum(i.balance)::bigint,
         coalesce(sum(i.balance) filter (where i.due_date < current_date), 0)::bigint,
         (select max(p.paid_at) from public.payments p where p.student_id = s.id and p.status = 'confirmed')
  from public.invoices i
  join public.students s on s.id = i.student_id
  left join public.class_enrollments e on e.student_id = s.id and e.status = 'active'
  left join public.classes cl on cl.id = e.class_id
  where i.school_id = p_school_id and i.status in ('issued', 'part_paid', 'paid')
    and (p_year_id is null or i.academic_year_id = p_year_id)
    and (p_term_id is null or i.term_id = p_term_id)
    and (p_class_id is null or e.class_id = p_class_id)
  group by s.id, s.first_name, s.last_name, s.admission_number, cl.id, cl.name
  order by sum(i.balance) desc, s.last_name, s.first_name;
end;
$$;

revoke all on function
  public.create_invoice(uuid, uuid, date, jsonb, text, text, boolean),
  public.generate_invoices(uuid, uuid[], date, boolean, boolean),
  public.issue_invoices(uuid[]),
  public.add_invoice_item(uuid, jsonb, text),
  public.remove_invoice_item(uuid, text),
  public.update_invoice(uuid, text, date, text),
  public.void_invoice(uuid, text),
  public.record_payment(uuid, bigint, text, date, text, text, text, jsonb),
  public.review_payment(uuid, boolean, text),
  public.reverse_payment(uuid, text),
  public.allocate_payment(uuid, jsonb),
  public.set_payment_instructions(uuid, text),
  public.finance_summary(uuid, uuid, uuid),
  public.student_balances(uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function
  public.create_invoice(uuid, uuid, date, jsonb, text, text, boolean),
  public.generate_invoices(uuid, uuid[], date, boolean, boolean),
  public.issue_invoices(uuid[]),
  public.add_invoice_item(uuid, jsonb, text),
  public.remove_invoice_item(uuid, text),
  public.update_invoice(uuid, text, date, text),
  public.void_invoice(uuid, text),
  public.record_payment(uuid, bigint, text, date, text, text, text, jsonb),
  public.review_payment(uuid, boolean, text),
  public.reverse_payment(uuid, text),
  public.allocate_payment(uuid, jsonb),
  public.set_payment_instructions(uuid, text),
  public.finance_summary(uuid, uuid, uuid),
  public.student_balances(uuid, uuid, uuid, uuid)
  to authenticated;
