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
| 2 · School setup | Setup guide, school profile and logo, campuses, academic sessions and terms, departments, classes, subjects, staff invitations, guided product tour | **Complete** |
| 3 · Users and students | Student registration and profiles, health details, guardians and parent portal invitations, class enrolment history, staff profiles, CSV import and export | **Complete** |
| 4 · Academic operations | Timetables with clash checks, attendance registers and reports, assignments and submissions, student portal, assessments with approval, configurable grading, results, PDF report cards | **Complete** |
| 5 · Communication | Targeted announcements with approval and read tracking, safe parent and teacher messaging with reporting and moderation, in app, push and email notifications with per person preferences | **Complete** |
| 6 · Finance | Fee structures, invoice generation with discounts, manual payments (cash, transfer, POS, cheque) with approval and allocation, PDF invoices and receipts, financial reports, parent Fees page | **Complete** |
| 7 · SaaS billing | Klasora subscriptions and Paystack | Next |
| 8 to 9 | Mobile, production release | Planned |

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
npx supabase db push --remote        # applies supabase/migrations to the linked hosted project

# 2. Configure the apps (public anon key only; never the service-role key)
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
# edit both files with your project URL and anon/publishable key
```

In the Supabase dashboard, open **Authentication → URL configuration** and set:
- Site URL: your web URL (for example `http://localhost:5173`)
- Redirect URLs: `http://localhost:5173/**`, `klasora://**`

Also turn on **Confirm email**, and set a minimum password length of 8 that requires letters and digits. These match `supabase/config.jsonc` and the client-side validation. For production email delivery, configure custom SMTP under **Authentication → Emails**.

### Invitation emails (optional)

Staff invitations always produce a link you can copy or share on WhatsApp. To also send them by email, deploy the Edge Function and give it a [Resend](https://resend.com) key:

```bash
npx supabase functions deploy send-invitation
npx supabase secrets set RESEND_API_KEY=your_key INVITE_FROM_EMAIL="Klasora <invites@yourdomain.com>" APP_URL=http://localhost:5173
```

### Push and email notifications (optional)

Notifications always appear inside Klasora. Push and email copies are queued in `notification_deliveries` and sent by the `dispatch-notifications` Edge Function, which uses the same Resend secrets as invitations. It only accepts calls carrying the project's service role key, so deploy it without the default JWT check:

```bash
npx supabase functions deploy dispatch-notifications --no-verify-jwt
```

Then run it every minute. In the Supabase dashboard, enable the `pg_cron` and `pg_net` extensions, and run this once in the SQL editor (it keeps the key in Vault rather than in the job text):

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');

select cron.schedule('dispatch-notifications', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
$$);
```

Use the legacy JWT `service_role` key (Project Settings, API keys), since that is the value Supabase gives the function as `SUPABASE_SERVICE_ROLE_KEY`. Failed sends retry with growing gaps, up to 5 attempts, and phones that uninstalled the app are removed automatically.

Push to phones also needs the mobile app linked to an EAS project, because Expo push tokens are issued per project. Run `npx eas init` in `apps/mobile` once; until then the app simply skips push registration.

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
