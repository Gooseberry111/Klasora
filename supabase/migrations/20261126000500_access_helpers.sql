-- =============================================================================
-- Klasora · 0500 · Access-control helpers
--
-- Every RLS policy and RPC builds on these functions, so they are small,
-- SECURITY DEFINER (they must read membership tables the caller cannot see in
-- full), pinned to an empty search_path, and always keyed on auth.uid(), never
-- on a user id supplied by the client.
--
-- Read vs write: reads only require an active membership, so members of a
-- suspended school can still see (and later export) their data. Writes also
-- require app.school_is_writable(), which Phase 7 extends with subscription
-- state (an expired subscription becomes read-only, never deleted).
--
-- Relationship helpers (guardian ↔ child, teacher ↔ class) are added alongside
-- their tables in Phases 3 and 4.
-- =============================================================================

-- Is the caller an active Klasora platform administrator (optionally of given roles)?
create or replace function app.is_platform_admin(p_roles public.platform_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.status = 'active'
      and (p_roles is null or pa.platform_role = any (p_roles))
  );
$$;

-- Does the caller hold at least one active membership in the school?
create or replace function app.is_school_member(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_memberships m
    where m.school_id = p_school_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

-- Does the caller hold the given built-in role in the school?
create or replace function app.has_role(p_school_id uuid, p_role_key text)
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
    where m.school_id = p_school_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and r.role_key = p_role_key
  );
$$;

-- Does the caller hold a permission in the school? Deny by default:
-- true only for owners, or when an active membership's role explicitly allows it.
create or replace function app.has_permission(p_school_id uuid, p_permission_key text)
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
    where m.school_id = p_school_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (
        r.role_key = 'owner'
        or exists (
          select 1
          from public.role_permissions rp
          join public.permissions p on p.id = rp.permission_id
          where rp.role_id = r.id
            and rp.allowed
            and p.permission_key = p_permission_key
        )
      )
  );
$$;

-- Is the school in a state that accepts changes?
create or replace function app.school_is_writable(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.schools s
    where s.id = p_school_id
      and s.status in ('active', 'pending_review')
  );
$$;

-- Convenience: permission AND writable school, for INSERT/UPDATE/DELETE policies.
create or replace function app.can_write(p_school_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_permission(p_school_id, p_permission_key) and app.school_is_writable(p_school_id);
$$;

-- Every permission key the caller effectively holds in the school.
create or replace function app.permission_keys_for_caller(p_school_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.has_role(p_school_id, 'owner') then
      (select coalesce(array_agg(p.permission_key order by p.permission_key), '{}') from public.permissions p)
    else
      (select coalesce(array_agg(distinct p.permission_key order by p.permission_key), '{}')
       from public.school_memberships m
       join public.role_permissions rp on rp.role_id = m.role_id and rp.allowed
       join public.permissions p on p.id = rp.permission_id
       where m.school_id = p_school_id
         and m.user_id = auth.uid()
         and m.status = 'active')
  end;
$$;

-- Permission keys granted to a role (owner role → everything).
create or replace function app.role_permission_keys(p_role_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.roles r where r.id = p_role_id and r.role_key = 'owner') then
      (select coalesce(array_agg(p.permission_key order by p.permission_key), '{}') from public.permissions p)
    else
      (select coalesce(array_agg(p.permission_key order by p.permission_key), '{}')
       from public.role_permissions rp
       join public.permissions p on p.id = rp.permission_id
       where rp.role_id = p_role_id and rp.allowed)
  end;
$$;

-- Can the caller see another person's profile? Yourself; people in a school
-- where you may view staff or roles; or Klasora support/super admins.
create or replace function app.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_profile_id = auth.uid()
    or app.is_platform_admin(array['super_admin', 'support_admin']::public.platform_role[])
    or exists (
      select 1
      from public.school_memberships target
      where target.user_id = p_profile_id
        and (app.has_permission(target.school_id, 'staff.view')
             or app.has_permission(target.school_id, 'roles.view'))
    );
$$;

-- Copies the built-in role templates into a new school.
create or replace function app.provision_system_roles(p_school_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.roles (school_id, name, description, role_key, is_system_role)
  select p_school_id, t.name, t.description, t.role_key, true
  from public.system_role_templates t
  on conflict (school_id, role_key) do nothing;

  insert into public.role_permissions (school_id, role_id, permission_id, allowed)
  select p_school_id, r.id, p.id, true
  from public.system_role_template_permissions tp
  join public.roles r on r.school_id = p_school_id and r.role_key = tp.role_key
  join public.permissions p on p.permission_key = tp.permission_key
  on conflict (role_id, permission_id) do nothing;
end;
$$;

-- Internal helpers are never callable by API roles directly. Policies invoke
-- them as the calling role, so `authenticated`/`anon` keep EXECUTE on the ones
-- policies use; the provisioning helper is restricted to definer-owned code.
revoke all on all functions in schema app from public;
grant execute on function
  app.is_platform_admin(public.platform_role[]),
  app.is_school_member(uuid),
  app.has_role(uuid, text),
  app.has_permission(uuid, text),
  app.school_is_writable(uuid),
  app.can_write(uuid, text),
  app.can_view_profile(uuid),
  app.request_ip(),
  app.set_updated_at(),
  app.prevent_school_change()
to anon, authenticated, service_role;
