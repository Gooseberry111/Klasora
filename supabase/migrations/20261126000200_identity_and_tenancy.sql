-- =============================================================================
-- Klasora · 0200 · Identity and tenancy
-- Profiles, schools, campuses, roles, permissions, memberships, invitations,
-- platform administrators and the audit log.
--
-- Tenant integrity: every tenant-owned table carries `school_id`, and foreign
-- keys between tenant tables are COMPOSITE (`(x_id, school_id)`), so a row in
-- School A can never reference a campus or role that belongs to School B.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — one per auth user. `id` deliberately equals `auth.users.id` so RLS
-- can compare `user_id = auth.uid()` without an extra lookup (see docs/architecture.md).
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  auth_user_id       uuid not null unique references auth.users (id) on delete cascade,
  first_name         text not null default '' check (char_length(first_name) <= 100),
  last_name          text not null default '' check (char_length(last_name) <= 100),
  email              text not null default '' check (char_length(email) <= 320),
  phone              text check (char_length(phone) <= 32),
  avatar_url         text check (char_length(avatar_url) <= 2048),
  preferred_language text not null default 'en' check (preferred_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  timezone           text not null default 'Africa/Lagos' check (char_length(timezone) between 1 and 64),
  theme              public.theme_preference not null default 'light',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint profiles_id_is_auth_user check (id = auth_user_id)
);
create index profiles_email_lower_idx on public.profiles (lower(email));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- Create a profile whenever Supabase Auth creates a user.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, auth_user_id, email, first_name, last_name, phone)
  values (
    new.id,
    new.id,
    coalesce(lower(new.email), ''),
    coalesce(left(trim(new.raw_user_meta_data ->> 'first_name'), 100), ''),
    coalesce(left(trim(new.raw_user_meta_data ->> 'last_name'), 100), ''),
    nullif(left(trim(new.raw_user_meta_data ->> 'phone'), 32), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- Keep the profile email in sync when a user changes it through Supabase Auth.
create or replace function app.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(lower(new.email), '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function app.sync_auth_user_email();

-- -----------------------------------------------------------------------------
-- schools — the tenant root.
-- -----------------------------------------------------------------------------
create table public.schools (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(trim(name)) between 2 and 200),
  slug                text not null unique
                        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  institution_type    public.institution_type not null,
  academic_structure  public.academic_structure not null default 'classes_grades',
  registration_number text check (char_length(registration_number) <= 100),
  email               text not null
                        check (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone               text not null check (char_length(phone) between 7 and 32),
  website             text check (char_length(website) <= 2048),
  logo_url            text check (char_length(logo_url) <= 2048),
  country             text not null default 'NG' check (country ~ '^[A-Z]{2}$'),
  state               text not null check (char_length(trim(state)) between 1 and 100),
  city                text not null check (char_length(trim(city)) between 1 and 100),
  address             text not null check (char_length(trim(address)) between 1 and 500),
  timezone            text not null default 'Africa/Lagos' check (char_length(timezone) between 1 and 64),
  default_currency    text not null default 'NGN' check (default_currency ~ '^[A-Z]{3}$'),
  status              public.school_status not null default 'active',
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index schools_status_idx on public.schools (status);
create index schools_created_by_idx on public.schools (created_by, created_at desc);

create trigger schools_set_updated_at
  before update on public.schools
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- campuses
-- -----------------------------------------------------------------------------
create table public.campuses (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 150),
  code          text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  address       text check (char_length(address) <= 500),
  contact_phone text check (char_length(contact_phone) <= 32),
  status        public.record_status not null default 'active',
  is_main       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint campuses_code_unique unique (school_id, code),
  constraint campuses_id_school_unique unique (id, school_id)
);
create unique index campuses_one_main_per_school on public.campuses (school_id) where is_main;

create trigger campuses_set_updated_at
  before update on public.campuses
  for each row execute function app.set_updated_at();
create trigger campuses_prevent_school_change
  before update on public.campuses
  for each row execute function app.prevent_school_change();

-- -----------------------------------------------------------------------------
-- permissions — global catalogue (seeded in 0400).
-- -----------------------------------------------------------------------------
create table public.permissions (
  id             uuid primary key default gen_random_uuid(),
  permission_key text not null unique,
  module         text not null check (module ~ '^[a-z_]+$'),
  action         text not null check (action in ('view', 'create', 'edit', 'delete', 'approve', 'export')),
  description    text not null,
  created_at     timestamptz not null default now(),
  constraint permissions_module_action_unique unique (module, action),
  constraint permissions_key_format check (permission_key = module || '.' || action)
);

-- -----------------------------------------------------------------------------
-- roles — per school. Built-in roles carry a `role_key`; custom roles do not.
-- -----------------------------------------------------------------------------
create table public.roles (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id) on delete cascade,
  name           text not null check (char_length(trim(name)) between 2 and 60),
  description    text check (char_length(description) <= 300),
  role_key       text check (role_key in (
                   'owner', 'school_admin', 'principal', 'teacher', 'accountant', 'parent', 'student')),
  is_system_role boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint roles_id_school_unique unique (id, school_id),
  constraint roles_role_key_unique unique (school_id, role_key),
  constraint roles_system_role_has_key check (is_system_role = (role_key is not null))
);
create unique index roles_school_name_unique on public.roles (school_id, lower(name));

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function app.set_updated_at();
create trigger roles_prevent_school_change
  before update on public.roles
  for each row execute function app.prevent_school_change();

-- -----------------------------------------------------------------------------
-- role_permissions — deny by default: a permission is granted only if a row
-- exists with allowed = true.
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null,
  role_id       uuid not null,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  allowed       boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint role_permissions_role_fk
    foreign key (role_id, school_id) references public.roles (id, school_id) on delete cascade,
  constraint role_permissions_unique unique (role_id, permission_id)
);
create index role_permissions_school_idx on public.role_permissions (school_id);
create index role_permissions_permission_idx on public.role_permissions (permission_id);

create trigger role_permissions_prevent_school_change
  before update on public.role_permissions
  for each row execute function app.prevent_school_change();

-- -----------------------------------------------------------------------------
-- school_memberships — a user's role in a school. One row per (school, user,
-- role), so one person can be a teacher and a parent in the same school, and
-- hold different roles in other schools.
-- -----------------------------------------------------------------------------
create table public.school_memberships (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role_id    uuid not null,
  campus_id  uuid,
  status     public.membership_status not null default 'active',
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_memberships_role_fk
    foreign key (role_id, school_id) references public.roles (id, school_id) on delete restrict,
  constraint school_memberships_campus_fk
    foreign key (campus_id, school_id) references public.campuses (id, school_id) on delete set null (campus_id),
  constraint school_memberships_unique unique (school_id, user_id, role_id),
  constraint school_memberships_id_school_unique unique (id, school_id)
);
create index school_memberships_user_idx on public.school_memberships (user_id, status);
create index school_memberships_school_idx on public.school_memberships (school_id, status);
create index school_memberships_role_idx on public.school_memberships (role_id);
create index school_memberships_campus_idx on public.school_memberships (campus_id);

create trigger school_memberships_set_updated_at
  before update on public.school_memberships
  for each row execute function app.set_updated_at();
create trigger school_memberships_prevent_school_change
  before update on public.school_memberships
  for each row execute function app.prevent_school_change();

-- -----------------------------------------------------------------------------
-- invitations — only a SHA-256 hash of the token is stored; the raw token is
-- returned once to the inviter (and later emailed by an Edge Function).
-- -----------------------------------------------------------------------------
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  email       text not null
                check (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role_id     uuid not null,
  campus_id   uuid,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status      public.invitation_status not null default 'pending',
  invited_by  uuid references public.profiles (id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint invitations_role_fk
    foreign key (role_id, school_id) references public.roles (id, school_id) on delete cascade,
  constraint invitations_campus_fk
    foreign key (campus_id, school_id) references public.campuses (id, school_id) on delete set null (campus_id),
  constraint invitations_accepted_consistency
    check ((status = 'accepted') = (accepted_at is not null))
);
create unique index invitations_one_pending
  on public.invitations (school_id, lower(email), role_id) where status = 'pending';
create index invitations_school_idx on public.invitations (school_id, status, created_at desc);

create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function app.set_updated_at();
create trigger invitations_prevent_school_change
  before update on public.invitations
  for each row execute function app.prevent_school_change();

-- -----------------------------------------------------------------------------
-- platform_admins — Klasora operators. Deliberately separate from school
-- memberships: being a platform admin grants NO access to school records.
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  platform_role public.platform_role not null,
  status        public.record_status not null default 'active',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint platform_admins_unique unique (user_id, platform_role)
);

create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- audit_logs — append-only. `school_id` intentionally has no foreign key so the
-- history outlives the records it describes.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid,
  actor_user_id uuid,
  action        text not null check (char_length(action) between 1 and 100),
  entity_type   text not null check (char_length(entity_type) between 1 and 100),
  entity_id     uuid,
  previous_data jsonb,
  new_data      jsonb,
  ip_address    inet,
  created_at    timestamptz not null default now()
);
create index audit_logs_school_idx on public.audit_logs (school_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
