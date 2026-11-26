-- =============================================================================
-- Klasora · 0100 · Foundation
-- Private helper schema, shared enums and generic trigger functions.
-- =============================================================================

-- `app` holds internal helpers (RLS checks, triggers). It is NOT exposed through
-- the Supabase Data API, so its functions can only be reached from policies,
-- triggers and the public RPCs that call them.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enumerations (mirrored in packages/shared/src/constants.ts)
-- -----------------------------------------------------------------------------
create type public.institution_type as enum (
  'nursery', 'primary', 'secondary', 'primary_secondary',
  'college', 'university', 'vocational', 'other'
);

create type public.academic_structure as enum (
  'classes_grades', 'sectioned_school', 'faculties_departments', 'programmes_semesters'
);

create type public.school_status as enum ('pending_review', 'active', 'suspended', 'archived');
create type public.membership_status as enum ('active', 'inactive', 'suspended');
create type public.record_status as enum ('active', 'inactive');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.platform_role as enum ('super_admin', 'support_admin', 'finance_admin');
create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'grace_period', 'expired', 'cancelled'
);
create type public.theme_preference as enum ('light', 'dark', 'system');

-- -----------------------------------------------------------------------------
-- Generic triggers
-- -----------------------------------------------------------------------------

-- Keeps `updated_at` accurate on every update.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Tenant-owned rows can never move between schools. Without this, a user with
-- write access to two schools could re-parent a record from one to the other.
create or replace function app.prevent_school_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.school_id is distinct from old.school_id then
    raise exception 'Records cannot be moved between schools.'
      using errcode = 'KL400';
  end if;
  return new;
end;
$$;

-- Best-effort client IP from PostgREST request headers. Returns NULL when the
-- header is missing or malformed (e.g. direct database sessions).
create or replace function app.request_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers json;
  v_ip text;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_ip := trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', ''), ',', 1));
  if v_ip = '' then
    return null;
  end if;
  return v_ip::inet;
exception when others then
  return null;
end;
$$;

-- Custom SQLSTATE convention used across Klasora RPCs. The web and mobile
-- clients show the exception message verbatim for these codes:
--   KL400 validation · KL403 not permitted · KL404 not found
--   KL409 conflict   · KL429 rate limited
