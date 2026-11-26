-- =============================================================================
-- Klasora · 0700 · Audit logging
--
-- Sensitive tables write an audit entry on every insert, update and delete.
-- Entries are append-only: updates, deletes and truncation are rejected even
-- for the table owner, so history cannot be rewritten through the API or by a
-- careless migration.
-- =============================================================================

create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    jsonb;
  v_new    jsonb;
  v_school uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - 'token_hash';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - 'token_hash';
  end if;

  -- Skip no-op updates (only updated_at changed).
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  if tg_table_name = 'schools' then
    v_school := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  else
    v_school := coalesce(v_new ->> 'school_id', v_old ->> 'school_id')::uuid;
  end if;

  insert into public.audit_logs
    (school_id, actor_user_id, action, entity_type, entity_id, previous_data, new_data, ip_address)
  values (
    v_school,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id')::uuid,
    v_old,
    v_new,
    app.request_ip()
  );

  return coalesce(new, old);
end;
$$;

create or replace function app.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit log entries cannot be changed or removed.' using errcode = 'KL403';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function app.reject_audit_mutation();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function app.reject_audit_mutation();

-- Attach auditing to the Phase 1 tables that shape access and tenancy.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'schools', 'campuses', 'roles', 'role_permissions', 'school_memberships',
    'invitations', 'platform_admins', 'subscription_plans', 'school_subscriptions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_row_change()',
      v_table || '_audit', v_table
    );
  end loop;
end;
$$;
