# Klasora architecture and decisions

This document records the decisions that shape Klasora, so later phases build on them rather than around them.

## 1. Multi-tenancy: shared schema, `school_id` on every tenant row

Every school-owned row carries `school_id`. Isolation is enforced by **PostgreSQL Row Level Security**, not by client filtering. The apps never decide what a user may see; they only ask.

Foreign keys between tenant tables are **composite**, for example `(role_id, school_id) → roles(id, school_id)`. A membership in School A therefore cannot reference a role, campus or class belonging to School B, even through a bug in server code. A trigger (`app.prevent_school_change`) stops any row from being moved between schools.

## 2. Identity, memberships and roles

- `profiles.id` **equals** `auth.users.id` (and `auth_user_id`, enforced by a check). RLS can compare `user_id = auth.uid()` with no extra lookup.
- A person holds **one membership per (school, role)**, so the same person can be a teacher and a parent at one school, and an owner at another.
- Roles belong to a school. Seven built-in roles are copied from templates when a school registers. Custom roles are created by the school.
- Permissions are a global catalogue of `module.action` keys (`students.view`, `examinations.approve`, …). Access is **denied by default**: a permission exists only if a `role_permissions` row grants it. The School Owner implicitly holds everything.
- The catalogue lives in SQL (`0400_permission_catalogue.sql`) and is mirrored in `packages/shared/src/permissions.ts`. A db-test fails if the two drift.

## 3. Where rules are enforced

| Layer | Purpose |
|---|---|
| Table and column `GRANT`s | Which operations and columns an API role may attempt at all. For example, users may update their own name but never their email; nobody may write `school_id` after creation. |
| RLS policies | Which rows those operations touch. They are built on helpers in the private `app` schema: `is_school_member`, `has_permission`, `can_write`, `is_platform_admin`, `can_view_profile`. |
| `SECURITY DEFINER` RPCs | Multi-row invariants: `register_school`, `set_role_permissions`, `create_invitation`, `accept_invitation`, `update_membership`. Direct writes to memberships and role permissions are not granted at all. |
| Client (`apps/*`) | Only shapes the UI: it hides what you can't use and explains why. It is never trusted. |

**Privilege-escalation rules**, enforced in SQL and covered by tests:
- Nobody may change their own membership, or the permissions of a role assigned to them (the owner excepted).
- Non-owners may only grant or remove permissions they hold themselves, and may only assign or manage roles whose permissions are a subset of their own.
- The owner role cannot be assigned, edited, demoted or deactivated through these paths. Ownership transfer will be a dedicated flow.
- Only the owner may change built-in roles' permissions.

**Reads versus writes:** reads need an active membership, so members of a suspended school can still see (and later export) their data. Writes also require `app.school_is_writable()`. Phase 7 extends that function with subscription state, so expired subscriptions become read-only and data is never deleted.

## 4. Platform administrators

`platform_admins` is separate from school memberships. A super admin can list schools and change their status, but RLS gives platform roles **no access** to students, roles, memberships or campuses. Support access to school records, when added, must go through an explicit, audited mechanism.

## 5. Invitations

Only a SHA-256 hash of the invitation token is stored, and the token-hash column is not selectable through the API. Accepting requires a signed-in user whose **verified** email matches the invitation (case-insensitive). Re-inviting revokes the previous pending invitation. Expiry is evaluated at read time. Email delivery, through an Edge Function, arrives with the staff-invitation UI in Phase 2.

## 6. School registration and email verification

The registration wizard collects everything first. When email confirmation is on, `signUp` stores the institution details in the user's metadata (`pending_school`). After the user verifies their email and signs in, the router sends them to `/onboarding/finish`, which calls `register_school` and clears the metadata. `register_school` itself requires a verified email and allows at most 3 schools per user per day.

## 7. Audit log

The `audit_logs` table is append-only: triggers reject `UPDATE`, `DELETE` and `TRUNCATE`, even for the table owner. Audit triggers on the access-shaping tables record the actor, before and after values, and the client IP when PostgREST provides it. Secrets such as `token_hash` are stripped. `school_id` deliberately has no foreign key, so history outlives the records it describes.

## 8. Errors

Database functions raise custom SQLSTATEs (`KL400`, `KL403`, `KL404`, `KL409`, `KL429`) whose messages are written for end users. `toAppError` in `@klasora/shared` shows those verbatim and translates everything else (Postgres codes, Supabase Auth codes, network failures) into plain language. Raw codes never reach the UI.

## 9. Money

Amounts are stored as integer **minor units** (kobo) in `bigint` columns. `formatMoney` and `parseMoneyToMinor` in `@klasora/shared` convert at the edges without floating-point drift. The currency is per school (NGN by default).

## 10. Mobile session storage

Sessions are kept in the device keychain or keystore via `expo-secure-store`. Some iOS releases reject values above about 2 KB, so the session is stored in chunks (`apps/mobile/src/lib/secure-storage.ts`). Tokens refresh only while the app is in the foreground.

## 11. Testing strategy

- `packages/db-tests`: migrations plus RLS, tenant isolation, RBAC escalation, invitations, audit immutability and catalogue parity, all in embedded Postgres. This runs in CI without Docker or a Supabase project.
- `packages/shared`: validation schemas, permission templates and money helpers.
- `apps/web`: error mapping, role-editing rules, navigation filtering, components and stores.
- End-to-end Playwright tests against a staging Supabase project are planned once Phase 2 adds enough flows to exercise.

## Known tooling notes

- TypeScript is pinned to 5.9 in the shared, web and db-test packages, because vue-tsc does not yet support the TypeScript 7 native compiler. Mobile uses the TypeScript version Expo SDK 58 selects.
- React is pinned at the workspace root so Expo's peer dependencies resolve to the same version as the app (checked by `expo-doctor`).
- A literal `"https://"` in a static Vue template attribute breaks vue-tsc's template code generation. Bind such strings from script instead (see `InstitutionStep.vue`).
