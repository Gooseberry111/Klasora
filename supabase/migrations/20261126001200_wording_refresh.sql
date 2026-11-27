-- =============================================================================
-- Klasora · 1200 · Wording refresh
--
-- Text that people read in the app uses plain words without dashes or
-- hyphenated compounds. This updates seeded descriptions and the one
-- database message that used one. Descriptions a school has edited itself
-- are left alone.
-- =============================================================================

update public.subscription_plans
set description = 'For growing schools and institutions with several campuses that need deeper reporting.'
where code = 'growth'
  and description = 'For growing schools and multi-campus institutions that need deeper reporting.';

update public.system_role_templates
set description = 'Runs the daily operations of the school.'
where role_key = 'school_admin';

update public.roles
set description = 'Runs the daily operations of the school.'
where role_key = 'school_admin'
  and is_system_role
  and description = 'Runs day-to-day school operations.';

create or replace function public.set_role_permissions(p_role_id uuid, p_permission_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role     public.roles;
  v_is_owner boolean;
  v_keys     text[] := coalesce((select array_agg(distinct k) from unnest(p_permission_keys) k), '{}');
  v_current  text[];
  v_changed  text[];
  v_unknown  text[];
  v_mine     text[];
begin
  select * into v_role from public.roles where id = p_role_id;
  if not found or not app.is_school_member(v_role.school_id) then
    raise exception 'This role could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_role.school_id, 'roles.edit') then
    raise exception 'You do not have permission to change role permissions.' using errcode = 'KL403';
  end if;
  if v_role.role_key = 'owner' then
    raise exception 'The School Owner role always has full access and cannot be changed.' using errcode = 'KL403';
  end if;

  v_is_owner := app.has_role(v_role.school_id, 'owner');

  if v_role.is_system_role and not v_is_owner then
    raise exception 'Only the school owner can change the permissions of standard roles.' using errcode = 'KL403';
  end if;
  if not v_is_owner and exists (
    select 1 from public.school_memberships m
    where m.role_id = p_role_id and m.user_id = auth.uid() and m.status = 'active'
  ) then
    raise exception 'You cannot change the permissions of a role that is assigned to you.' using errcode = 'KL403';
  end if;

  select array_agg(k) into v_unknown
  from unnest(v_keys) k
  where not exists (select 1 from public.permissions p where p.permission_key = k);
  if v_unknown is not null then
    raise exception 'Unknown permissions: %', array_to_string(v_unknown, ', ') using errcode = 'KL400';
  end if;

  -- People who are not the owner may only add or remove permissions they hold themselves.
  if not v_is_owner then
    v_current := app.role_permission_keys(p_role_id);
    v_mine := app.permission_keys_for_caller(v_role.school_id);
    select array_agg(k) into v_changed
    from (
      (select unnest(v_keys) except select unnest(v_current))
      union
      (select unnest(v_current) except select unnest(v_keys))
    ) as diff (k)
    where not (k = any (v_mine));
    if v_changed is not null then
      raise exception 'You can only grant or remove permissions you hold yourself (%).', array_to_string(v_changed, ', ')
        using errcode = 'KL403';
    end if;
  end if;

  delete from public.role_permissions rp
  where rp.role_id = p_role_id
    and rp.permission_id not in (select p.id from public.permissions p where p.permission_key = any (v_keys));

  insert into public.role_permissions (school_id, role_id, permission_id, allowed)
  select v_role.school_id, p_role_id, p.id, true
  from public.permissions p
  where p.permission_key = any (v_keys)
  on conflict (role_id, permission_id) do update set allowed = true where public.role_permissions.allowed = false;
end;
$$;
