-- =============================================================================
-- Klasora · 0600 · Row Level Security and table privileges
--
-- Two layers protect every table:
--   1. GRANTs decide which operations/columns an API role may attempt at all.
--   2. RLS policies decide which rows those operations may touch.
-- Writes that need multi-row invariants (memberships, role permissions,
-- invitations, registration) are not granted to API roles at all; they go
-- through the SECURITY DEFINER RPCs in 0800, which perform explicit checks.
-- =============================================================================

alter table public.profiles                        enable row level security;
alter table public.schools                         enable row level security;
alter table public.campuses                        enable row level security;
alter table public.permissions                     enable row level security;
alter table public.roles                           enable row level security;
alter table public.role_permissions                enable row level security;
alter table public.school_memberships              enable row level security;
alter table public.invitations                     enable row level security;
alter table public.platform_admins                 enable row level security;
alter table public.audit_logs                      enable row level security;
alter table public.subscription_plans              enable row level security;
alter table public.school_subscriptions            enable row level security;
alter table public.system_role_templates           enable row level security;
alter table public.system_role_template_permissions enable row level security;

-- Start from nothing for anonymous visitors; grant back only what is public.
revoke all on all tables in schema public from anon;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
-- Users may edit only their own presentation fields. Email follows Supabase Auth.
grant update (first_name, last_name, phone, avatar_url, preferred_language, timezone, theme)
  on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (app.can_view_profile(id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- schools: created only via register_school(); status changed only by platform RPC.
-- -----------------------------------------------------------------------------
revoke insert, update, delete on public.schools from authenticated;
grant select on public.schools to authenticated;
grant update (name, registration_number, email, phone, website, logo_url, country, state, city,
              address, timezone, default_currency, academic_structure)
  on public.schools to authenticated;

create policy schools_select on public.schools
  for select to authenticated
  using (app.is_school_member(id) or app.is_platform_admin());

create policy schools_update on public.schools
  for update to authenticated
  using (app.can_write(id, 'settings.edit'))
  with check (app.can_write(id, 'settings.edit'));

-- -----------------------------------------------------------------------------
-- campuses
-- -----------------------------------------------------------------------------
revoke all on public.campuses from authenticated;
grant select, delete on public.campuses to authenticated;
grant insert (school_id, name, code, address, contact_phone, status) on public.campuses to authenticated;
grant update (name, code, address, contact_phone, status) on public.campuses to authenticated;

create policy campuses_select on public.campuses
  for select to authenticated
  using (app.is_school_member(school_id));

create policy campuses_insert on public.campuses
  for insert to authenticated
  with check (app.can_write(school_id, 'settings.edit'));

create policy campuses_update on public.campuses
  for update to authenticated
  using (app.can_write(school_id, 'settings.edit'))
  with check (app.can_write(school_id, 'settings.edit'));

create policy campuses_delete on public.campuses
  for delete to authenticated
  using (app.can_write(school_id, 'settings.edit') and not is_main);

-- -----------------------------------------------------------------------------
-- permissions: the catalogue is readable by any signed-in user.
-- -----------------------------------------------------------------------------
revoke insert, update, delete on public.permissions from authenticated;
grant select on public.permissions to authenticated;

create policy permissions_select on public.permissions
  for select to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- roles: members see their school's roles; custom roles are managed directly,
-- built-in roles cannot be renamed or deleted.
-- -----------------------------------------------------------------------------
revoke all on public.roles from authenticated;
grant select, delete on public.roles to authenticated;
grant insert (school_id, name, description) on public.roles to authenticated;
grant update (name, description) on public.roles to authenticated;

create policy roles_select on public.roles
  for select to authenticated
  using (app.is_school_member(school_id));

create policy roles_insert on public.roles
  for insert to authenticated
  with check (app.can_write(school_id, 'roles.create') and not is_system_role);

create policy roles_update on public.roles
  for update to authenticated
  using (app.can_write(school_id, 'roles.edit') and not is_system_role)
  with check (app.can_write(school_id, 'roles.edit') and not is_system_role);

create policy roles_delete on public.roles
  for delete to authenticated
  using (app.can_write(school_id, 'roles.delete') and not is_system_role);

-- -----------------------------------------------------------------------------
-- role_permissions: read-only for members; changed via set_role_permissions().
-- -----------------------------------------------------------------------------
revoke all on public.role_permissions from authenticated;
grant select on public.role_permissions to authenticated;

create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (app.is_school_member(school_id));

-- -----------------------------------------------------------------------------
-- school_memberships: your own, or the school's if you may view staff/roles.
-- Changed only via accept_invitation() / update_membership().
-- -----------------------------------------------------------------------------
revoke all on public.school_memberships from authenticated;
grant select on public.school_memberships to authenticated;

create policy school_memberships_select on public.school_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.has_permission(school_id, 'staff.view')
    or app.has_permission(school_id, 'roles.view')
  );

-- -----------------------------------------------------------------------------
-- invitations: staff viewers can list them; the token hash is never readable.
-- -----------------------------------------------------------------------------
revoke all on public.invitations from authenticated;
grant select (id, school_id, email, role_id, campus_id, status, invited_by, expires_at,
              accepted_by, accepted_at, created_at, updated_at)
  on public.invitations to authenticated;

create policy invitations_select on public.invitations
  for select to authenticated
  using (app.has_permission(school_id, 'staff.view'));

-- -----------------------------------------------------------------------------
-- platform_admins: see yourself; super admins see all. Managed server-side.
-- -----------------------------------------------------------------------------
revoke all on public.platform_admins from authenticated;
grant select on public.platform_admins to authenticated;

create policy platform_admins_select on public.platform_admins
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.is_platform_admin(array['super_admin']::public.platform_role[])
  );

-- -----------------------------------------------------------------------------
-- audit_logs: append-only, written exclusively by triggers.
-- -----------------------------------------------------------------------------
revoke all on public.audit_logs from authenticated;
grant select on public.audit_logs to authenticated;

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (school_id is not null and app.has_permission(school_id, 'audit.view'))
    or app.is_platform_admin(array['super_admin']::public.platform_role[])
  );

-- -----------------------------------------------------------------------------
-- subscription_plans: active plans are public (pricing page); platform
-- finance/super admins manage them. Plans are deactivated, never deleted.
-- -----------------------------------------------------------------------------
revoke all on public.subscription_plans from authenticated;
grant select on public.subscription_plans to anon, authenticated;
grant insert, update on public.subscription_plans to authenticated;

create policy subscription_plans_select_public on public.subscription_plans
  for select to anon, authenticated
  using (is_active or app.is_platform_admin());

create policy subscription_plans_insert on public.subscription_plans
  for insert to authenticated
  with check (app.is_platform_admin(array['super_admin', 'finance_admin']::public.platform_role[]));

create policy subscription_plans_update on public.subscription_plans
  for update to authenticated
  using (app.is_platform_admin(array['super_admin', 'finance_admin']::public.platform_role[]))
  with check (app.is_platform_admin(array['super_admin', 'finance_admin']::public.platform_role[]));

-- -----------------------------------------------------------------------------
-- school_subscriptions: visible to billing viewers and platform admins.
-- Written only by server-side code (registration RPC now, Paystack webhooks later).
-- -----------------------------------------------------------------------------
revoke all on public.school_subscriptions from authenticated;
grant select on public.school_subscriptions to authenticated;

create policy school_subscriptions_select on public.school_subscriptions
  for select to authenticated
  using (app.has_permission(school_id, 'billing.view') or app.is_platform_admin());

-- -----------------------------------------------------------------------------
-- Role templates: internal only (RLS on, no policies, no grants).
-- -----------------------------------------------------------------------------
revoke all on public.system_role_templates from authenticated;
revoke all on public.system_role_template_permissions from authenticated;
