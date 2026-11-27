-- =============================================================================
-- Klasora · 0800 · Tenant RPCs
--
-- Operations that must uphold invariants across several rows. Each function:
--   • identifies the caller with auth.uid() (never a client-supplied user id);
--   • verifies membership/permission in the target school itself;
--   • blocks privilege escalation (nobody can grant what they do not hold,
--     change their own access, or hand out the owner role);
--   • raises KLxxx errors whose messages are safe to show to users.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Effective permissions for the caller in a school (drives permission-aware UI).
-- -----------------------------------------------------------------------------
create or replace function public.get_my_permissions(p_school_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select app.permission_keys_for_caller(p_school_id);
$$;

-- -----------------------------------------------------------------------------
-- register_school: creates a tenant: school, main campus, built-in roles,
-- owner membership and a trial subscription, atomically.
-- -----------------------------------------------------------------------------
create or replace function public.register_school(
  p_name               text,
  p_institution_type   public.institution_type,
  p_academic_structure public.academic_structure,
  p_email              text,
  p_phone              text,
  p_country            text,
  p_state              text,
  p_city               text,
  p_address            text,
  p_website            text default null,
  p_plan_code          text default 'starter'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_plan       public.subscription_plans;
  v_school_id  uuid;
  v_owner_role uuid;
  v_base_slug  text;
  v_slug       text;
  v_country    text := upper(trim(coalesce(p_country, 'NG')));
  v_timezone   text;
  v_currency   text;
begin
  if v_user is null then
    raise exception 'Please sign in to register an institution.' using errcode = 'KL403';
  end if;

  if not exists (
    select 1 from auth.users u where u.id = v_user and u.email_confirmed_at is not null
  ) then
    raise exception 'Please verify your email address before registering an institution.'
      using errcode = 'KL403';
  end if;

  -- Abuse guard: at most 3 institutions per user per 24 hours.
  if (select count(*) from public.schools s
      where s.created_by = v_user and s.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'You have registered several institutions today. Please try again tomorrow or contact support.'
      using errcode = 'KL429';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Enter the name of your institution.' using errcode = 'KL400';
  end if;
  if trim(coalesce(p_email, '')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid institution email address.' using errcode = 'KL400';
  end if;
  if char_length(trim(coalesce(p_phone, ''))) < 7 then
    raise exception 'Enter a valid institution phone number.' using errcode = 'KL400';
  end if;
  if coalesce(trim(p_state), '') = '' or coalesce(trim(p_city), '') = '' or coalesce(trim(p_address), '') = '' then
    raise exception 'Enter the institution''s full address.' using errcode = 'KL400';
  end if;

  select * into v_plan
  from public.subscription_plans
  where code = p_plan_code and is_active and is_self_serve;
  if not found then
    raise exception 'The selected plan is not available. Please choose another plan.' using errcode = 'KL400';
  end if;

  select c.tz, c.currency into v_timezone, v_currency
  from (values
    ('NG', 'Africa/Lagos', 'NGN'), ('GH', 'Africa/Accra', 'GHS'), ('KE', 'Africa/Nairobi', 'KES'),
    ('ZA', 'Africa/Johannesburg', 'ZAR'), ('GB', 'Europe/London', 'GBP'), ('US', 'America/New_York', 'USD')
  ) as c (code, tz, currency)
  where c.code = v_country;
  if v_timezone is null then
    raise exception 'Klasora is not yet available in the selected country.' using errcode = 'KL400';
  end if;

  -- URL-friendly, unique slug derived from the name.
  v_base_slug := trim(both '-' from left(regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'), 60));
  if v_base_slug = '' then
    v_base_slug := 'school';
  end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.schools s where s.slug = v_slug) loop
    v_slug := v_base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end loop;

  insert into public.schools (
    name, slug, institution_type, academic_structure, email, phone, website,
    country, state, city, address, timezone, default_currency, status, created_by
  ) values (
    trim(p_name), v_slug, p_institution_type, p_academic_structure, lower(trim(p_email)), trim(p_phone),
    nullif(trim(coalesce(p_website, '')), ''), v_country, trim(p_state), trim(p_city), trim(p_address),
    v_timezone, v_currency, 'active', v_user
  )
  returning id into v_school_id;

  insert into public.campuses (school_id, name, code, address, is_main)
  values (v_school_id, 'Main Campus', 'MAIN', trim(p_address), true);

  perform app.provision_system_roles(v_school_id);

  select id into v_owner_role from public.roles where school_id = v_school_id and role_key = 'owner';

  insert into public.school_memberships (school_id, user_id, role_id, status, joined_at)
  values (v_school_id, v_user, v_owner_role, 'active', now());

  insert into public.school_subscriptions (school_id, plan_id, status, starts_at, trial_ends_at)
  values (v_school_id, v_plan.id, 'trialing', now(), now() + make_interval(days => v_plan.trial_days));

  return v_school_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- set_role_permissions: replaces a role's permission set.
-- -----------------------------------------------------------------------------
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
    raise exception 'Only the school owner can change the permissions of built-in roles.' using errcode = 'KL403';
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

  -- Non-owners may only add or remove permissions they hold themselves.
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

-- -----------------------------------------------------------------------------
-- Role-assignment guard shared by invitations and membership changes.
-- -----------------------------------------------------------------------------
create or replace function app.assert_can_assign_role(p_school_id uuid, p_role_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.roles;
begin
  select * into v_role from public.roles where id = p_role_id and school_id = p_school_id;
  if not found then
    raise exception 'The selected role does not belong to this school.' using errcode = 'KL400';
  end if;
  if v_role.role_key = 'owner' then
    raise exception 'The School Owner role cannot be assigned here. Ownership transfer is a separate process.'
      using errcode = 'KL403';
  end if;
  if not app.has_role(p_school_id, 'owner')
     and not (app.role_permission_keys(p_role_id) <@ app.permission_keys_for_caller(p_school_id)) then
    raise exception 'You cannot assign a role with more access than you have.' using errcode = 'KL403';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Invitations
-- -----------------------------------------------------------------------------
create or replace function public.create_invitation(
  p_school_id uuid,
  p_email     text,
  p_role_id   uuid,
  p_campus_id uuid default null
)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
  v_id    uuid;
begin
  if not app.can_write(p_school_id, 'staff.create') then
    raise exception 'You do not have permission to invite people to this school.' using errcode = 'KL403';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = 'KL400';
  end if;
  perform app.assert_can_assign_role(p_school_id, p_role_id);
  if p_campus_id is not null
     and not exists (select 1 from public.campuses c where c.id = p_campus_id and c.school_id = p_school_id) then
    raise exception 'The selected campus does not belong to this school.' using errcode = 'KL400';
  end if;
  if exists (
    select 1 from public.school_memberships m
    join public.profiles pr on pr.id = m.user_id
    where m.school_id = p_school_id and m.role_id = p_role_id and m.status = 'active'
      and lower(pr.email) = v_email
  ) then
    raise exception 'This person already has that role in your school.' using errcode = 'KL409';
  end if;

  -- Re-inviting replaces any pending invitation for the same email and role.
  update public.invitations
  set status = 'revoked'
  where school_id = p_school_id and lower(email) = v_email and role_id = p_role_id and status = 'pending';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.invitations (school_id, email, role_id, campus_id, token_hash, invited_by)
  values (p_school_id, v_email, p_role_id, p_campus_id,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  returning id into v_id;

  return query select v_id, v_token;
end;
$$;

-- Public preview so the invitation page can say who invited you to what.
-- Requires the secret token; reveals nothing without it.
create or replace function public.get_invitation_preview(p_token text)
returns table (
  school_name text,
  role_name   text,
  email       text,
  status      public.invitation_status,
  expires_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, r.name, i.email,
         case when i.status = 'pending' and i.expires_at <= now() then 'expired'::public.invitation_status
              else i.status end,
         i.expires_at
  from public.invitations i
  join public.schools s on s.id = i.school_id
  join public.roles r on r.id = i.role_id
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

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

  update public.invitations
  set status = 'accepted', accepted_by = v_user, accepted_at = now()
  where id = v_invitation.id;

  return v_invitation.school_id;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations;
begin
  select * into v_invitation from public.invitations where id = p_invitation_id;
  if not found or not app.has_permission(v_invitation.school_id, 'staff.view') then
    raise exception 'This invitation could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_invitation.school_id, 'staff.create') then
    raise exception 'You do not have permission to manage invitations.' using errcode = 'KL403';
  end if;
  if v_invitation.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked.' using errcode = 'KL409';
  end if;
  update public.invitations set status = 'revoked' where id = p_invitation_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- update_membership: change someone's role and/or status.
-- -----------------------------------------------------------------------------
create or replace function public.update_membership(
  p_membership_id uuid,
  p_role_id       uuid default null,
  p_status        public.membership_status default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.school_memberships;
  v_is_owner   boolean;
begin
  select * into v_membership from public.school_memberships where id = p_membership_id;
  if not found or not (app.has_permission(v_membership.school_id, 'staff.view')
                       or v_membership.user_id = auth.uid()) then
    raise exception 'This membership could not be found.' using errcode = 'KL404';
  end if;
  if not app.can_write(v_membership.school_id, 'staff.edit') then
    raise exception 'You do not have permission to change staff access.' using errcode = 'KL403';
  end if;
  if v_membership.user_id = auth.uid() then
    raise exception 'You cannot change your own role or status. Ask another administrator.' using errcode = 'KL403';
  end if;
  if exists (select 1 from public.roles r where r.id = v_membership.role_id and r.role_key = 'owner') then
    raise exception 'The School Owner''s access cannot be changed here.' using errcode = 'KL403';
  end if;

  v_is_owner := app.has_role(v_membership.school_id, 'owner');

  -- Nobody may manage someone with more access than themselves.
  if not v_is_owner
     and not (app.role_permission_keys(v_membership.role_id)
              <@ app.permission_keys_for_caller(v_membership.school_id)) then
    raise exception 'You cannot change access for someone with more permissions than you.' using errcode = 'KL403';
  end if;

  if p_role_id is not null and p_role_id <> v_membership.role_id then
    perform app.assert_can_assign_role(v_membership.school_id, p_role_id);
    if exists (select 1 from public.school_memberships m
               where m.school_id = v_membership.school_id and m.user_id = v_membership.user_id
                 and m.role_id = p_role_id) then
      raise exception 'This person already has that role.' using errcode = 'KL409';
    end if;
  end if;

  update public.school_memberships
  set role_id = coalesce(p_role_id, role_id),
      status  = coalesce(p_status, status)
  where id = p_membership_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Platform: approve / suspend / archive a school (super admins only).
-- -----------------------------------------------------------------------------
create or replace function public.platform_set_school_status(p_school_id uuid, p_status public.school_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin(array['super_admin']::public.platform_role[]) then
    raise exception 'Only Klasora super administrators can change a school''s status.' using errcode = 'KL403';
  end if;
  update public.schools set status = p_status where id = p_school_id;
  if not found then
    raise exception 'This school could not be found.' using errcode = 'KL404';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Execution grants. Postgres grants EXECUTE to PUBLIC by default; tighten it.
-- -----------------------------------------------------------------------------
revoke all on function public.get_my_permissions(uuid) from public, anon;
revoke all on function public.register_school(text, public.institution_type, public.academic_structure,
  text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.set_role_permissions(uuid, text[]) from public, anon;
revoke all on function public.create_invitation(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.update_membership(uuid, uuid, public.membership_status) from public, anon;
revoke all on function public.platform_set_school_status(uuid, public.school_status) from public, anon;
revoke all on function public.get_invitation_preview(text) from public;
revoke all on function app.assert_can_assign_role(uuid, uuid) from public;

grant execute on function public.get_my_permissions(uuid) to authenticated;
grant execute on function public.register_school(text, public.institution_type, public.academic_structure,
  text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.set_role_permissions(uuid, text[]) to authenticated;
grant execute on function public.create_invitation(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.update_membership(uuid, uuid, public.membership_status) to authenticated;
grant execute on function public.platform_set_school_status(uuid, public.school_status) to authenticated;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;
