# Klasora

**Education, connected.** A multi-tenant school management SaaS for nursery, primary, secondary, college, university and vocational institutions.

## Repository layout

```
apps/
  web/          Vue 3 + Vite + TypeScript + Tailwind v4 + Pinia: the main web application
  mobile/       Expo (SDK 58) + Expo Router + TypeScript: Android and iOS app
packages/
  shared/       Permission catalogue, enums, Zod schemas, entity types, money and error helpers
  db-tests/     Runs every Supabase migration in embedded Postgres (PGlite) and tests RLS
supabase/
  config.jsonc  Supabase CLI configuration (auth settings, redirect URLs)
  migrations/   Incremental SQL migrations: the source of truth for schema and security
docs/
  architecture.md   Architectural decisions and the security model
```

## Status

| Phase | Scope | State |
|---|---|---|
| 1 · Foundation | Monorepo, Supabase schema, auth, school registration, tenant isolation, RBAC | **Complete** |
| 2 · School setup | Onboarding, school profile, campuses, academic years, terms, departments, classes, subjects, staff invitations | Next |
| 3–9 | Users and students, academics, communication, finance, SaaS billing, mobile, production release | Planned |

## Prerequisites

- Node.js 20.19 or newer (developed on Node 24) and npm 10 or newer
- A Supabase project (hosted). Docker is only needed if you want `supabase start` locally.
- For mobile: Expo Go, or a development build (`npx expo run:android` / `run:ios`)

## First-time setup

```bash
npm install                          # installs every workspace

# 1. Link the Supabase project and apply migrations
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push                 # applies supabase/migrations in order

# 2. Configure the apps (public anon key only; never the service-role key)
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
# edit both files with your project URL and anon/publishable key
```

In the Supabase dashboard, open **Authentication → URL configuration** and set:
- Site URL: your web URL (for example `http://localhost:5173`)
- Redirect URLs: `http://localhost:5173/**`, `klasora://**`

Also turn on **Confirm email**, and set a minimum password length of 8 that requires letters and digits. These match `supabase/config.jsonc` and the client-side validation. For production email delivery, configure custom SMTP under **Authentication → Emails**.

## Running

```bash
npm run dev:web          # http://localhost:5173
npm run dev:mobile       # Expo dev server
```

## Testing

```bash
npm test                 # every workspace: shared, db-tests, web
npm run test:db          # RLS / tenant-isolation / RBAC suite only (no Docker needed)
npm run typecheck        # every workspace
```

`packages/db-tests` boots an embedded Postgres, emulates the parts of Supabase the migrations depend on (`auth.users`, `auth.uid()`, the `anon`/`authenticated` roles and Supabase's default grants), applies every migration, and runs SQL as specific signed-in users with RLS active.

## Creating the first platform administrator

Platform roles (`super_admin`, `support_admin`, `finance_admin`) are separate from school memberships and are granted only server-side. After the person has signed up, run this in the Supabase SQL editor:

```sql
insert into public.platform_admins (user_id, platform_role)
select id, 'super_admin' from public.profiles where email = 'operator@example.com';
```

## Generated database types

After linking a project, `npm run db:types` writes `packages/shared/src/types/database.generated.ts`. The hand-written types in `packages/shared/src/types/entities.ts` remain the domain contract the apps import.
