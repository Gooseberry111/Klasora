-- =============================================================================
-- Klasora · 0900 · Role directory RPCs
-- Read-side helpers for the "User roles" screens. They aggregate on the server
-- so the browser never downloads every membership just to count them.
-- =============================================================================

create or replace function public.list_role_summaries(p_school_id uuid)
returns table (
  id               uuid,
  name             text,
  description      text,
  role_key         text,
  is_system_role   boolean,
  member_count     integer,
  permission_count integer,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_permission(p_school_id, 'roles.view') or app.has_permission(p_school_id, 'staff.view')) then
    raise exception 'You do not have permission to view roles in this school.' using errcode = 'KL403';
  end if;

  return query
  select
    r.id, r.name, r.description, r.role_key, r.is_system_role,
    (select count(*)::int from public.school_memberships m where m.role_id = r.id and m.status = 'active'),
    case when r.role_key = 'owner'
      then (select count(*)::int from public.permissions)
      else (select count(*)::int from public.role_permissions rp where rp.role_id = r.id and rp.allowed)
    end,
    r.created_at
  from public.roles r
  left join public.system_role_templates t on t.role_key = r.role_key
  where r.school_id = p_school_id
  order by r.is_system_role desc, coalesce(t.sort_order, 1000), lower(r.name);
end;
$$;

create or replace function public.list_role_members(p_role_id uuid)
returns table (
  membership_id uuid,
  user_id       uuid,
  first_name    text,
  last_name     text,
  email         text,
  status        public.membership_status,
  joined_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school uuid;
begin
  select r.school_id into v_school from public.roles r where r.id = p_role_id;
  if v_school is null or not app.is_school_member(v_school) then
    raise exception 'This role could not be found.' using errcode = 'KL404';
  end if;
  if not (app.has_permission(v_school, 'roles.view') or app.has_permission(v_school, 'staff.view')) then
    raise exception 'You do not have permission to view the members of this role.' using errcode = 'KL403';
  end if;

  return query
  select m.id, m.user_id, p.first_name, p.last_name, p.email, m.status, m.joined_at
  from public.school_memberships m
  join public.profiles p on p.id = m.user_id
  where m.role_id = p_role_id
  order by lower(p.first_name), lower(p.last_name);
end;
$$;

-- Permission keys currently granted to a role, for the permission matrix.
create or replace function public.get_role_permissions(p_role_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school uuid;
begin
  select r.school_id into v_school from public.roles r where r.id = p_role_id;
  if v_school is null or not app.is_school_member(v_school) then
    raise exception 'This role could not be found.' using errcode = 'KL404';
  end if;
  return app.role_permission_keys(p_role_id);
end;
$$;

revoke all on function public.list_role_summaries(uuid) from public, anon;
revoke all on function public.list_role_members(uuid) from public, anon;
revoke all on function public.get_role_permissions(uuid) from public, anon;
grant execute on function public.list_role_summaries(uuid) to authenticated;
grant execute on function public.list_role_members(uuid) to authenticated;
grant execute on function public.get_role_permissions(uuid) to authenticated;
