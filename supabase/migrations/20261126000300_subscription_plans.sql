-- =============================================================================
-- Klasora · 0300 · Subscription plans and school subscriptions
--
-- Phase 1 needs plans so a school can choose one at registration and start a
-- trial. Payment processing (Paystack), renewals and grace-period enforcement
-- arrive in Phase 7; the columns they need already exist here.
--
-- Money is stored as integer minor units (kobo for NGN). NULL price = custom.
-- =============================================================================

create table public.subscription_plans (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  name             text not null check (char_length(trim(name)) between 2 and 60),
  description      text not null default '' check (char_length(description) <= 500),
  monthly_price    bigint check (monthly_price >= 0),
  currency         text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  maximum_students integer check (maximum_students > 0),
  maximum_staff    integer check (maximum_staff > 0),
  maximum_campuses integer check (maximum_campuses > 0),
  storage_limit_mb integer check (storage_limit_mb > 0),
  feature_limits   jsonb not null default '{}'::jsonb check (jsonb_typeof(feature_limits) = 'object'),
  support_level    text not null default 'standard' check (support_level in ('standard', 'priority', 'dedicated')),
  trial_days       integer not null default 14 check (trial_days between 0 and 90),
  is_self_serve    boolean not null default true,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A plan a school can pick on its own must have a published price.
  constraint subscription_plans_self_serve_priced check (not is_self_serve or monthly_price is not null)
);

create trigger subscription_plans_set_updated_at
  before update on public.subscription_plans
  for each row execute function app.set_updated_at();

create table public.school_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null unique references public.schools (id) on delete cascade,
  plan_id              uuid not null references public.subscription_plans (id) on delete restrict,
  billing_interval     text not null default 'monthly' check (billing_interval in ('monthly')),
  status               public.subscription_status not null,
  starts_at            timestamptz not null default now(),
  renews_at            timestamptz,
  trial_ends_at        timestamptz,
  grace_period_ends_at timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint school_subscriptions_trial_has_end check (status <> 'trialing' or trial_ends_at is not null)
);
create index school_subscriptions_plan_idx on public.school_subscriptions (plan_id);
create index school_subscriptions_status_idx on public.school_subscriptions (status);

create trigger school_subscriptions_set_updated_at
  before update on public.school_subscriptions
  for each row execute function app.set_updated_at();
create trigger school_subscriptions_prevent_school_change
  before update on public.school_subscriptions
  for each row execute function app.prevent_school_change();

-- -----------------------------------------------------------------------------
-- Initial plans. These are configurable starting points, not fixed values;
-- platform finance administrators edit them from the platform dashboard.
-- -----------------------------------------------------------------------------
insert into public.subscription_plans
  (code, name, description, monthly_price, currency, maximum_students, maximum_staff,
   maximum_campuses, storage_limit_mb, feature_limits, support_level, trial_days, is_self_serve, sort_order)
values
  ('starter', 'Starter',
   'For small schools getting their records, attendance and parent communication in one place.',
   1500000, 'NGN', 300, 30, 1, 5120,
   '{"custom_roles": true, "parent_portal": true, "mobile_app": true, "finance": true, "advanced_reports": false, "api_access": false}',
   'standard', 14, true, 10),
  ('growth', 'Growth',
   'For growing schools and multi-campus institutions that need deeper reporting.',
   3500000, 'NGN', 1500, 150, 3, 25600,
   '{"custom_roles": true, "parent_portal": true, "mobile_app": true, "finance": true, "advanced_reports": true, "api_access": false}',
   'priority', 14, true, 20),
  ('enterprise', 'Enterprise',
   'For universities, school groups and large institutions with custom requirements.',
   null, 'NGN', null, null, null, null,
   '{"custom_roles": true, "parent_portal": true, "mobile_app": true, "finance": true, "advanced_reports": true, "api_access": true}',
   'dedicated', 30, false, 30);
