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

## Phase 2: school setup

**Academic structure tables.** `academic_years`, `academic_terms`, `departments`, `classes`, `subjects` and `class_subjects` follow the Phase 1 rules: a `school_id` on every row, composite foreign keys so nothing can point into another school, RLS on every table and audit triggers on every change. The academic calendar is readable by every member; the structure is readable with `academics.view`; changes need `academics.create`, `academics.edit` or `academics.delete`.

**One table, three shapes.** Departments carry a `kind` (`department`, `section` or `faculty`). A sectioned school uses sections, a university uses faculties with departments inside them (enforced by a trigger), and everyone else uses plain departments. Labels in the apps come from `academicVocabulary()` in the shared package, so a university sees Semesters, Levels and Courses while a primary school sees Terms, Classes and Subjects. Clients never hard code these words.

**Single current period.** Partial unique indexes allow one current year and one current term per school. `set_current_academic_year` and `set_current_term` switch them atomically; a trigger keeps terms inside their year.

**Plan limits in the database.** A trigger on `campuses` refuses inserts beyond the plan's `maximum_campuses`. It only runs its check for callers who are allowed to add campuses, so everyone else gets the normal RLS denial and learns nothing about the plan.

**Setup progress from real data.** `get_setup_progress` returns counts for the setup guide and dashboard. Completion is computed in the shared package (`buildSetupSteps`, `setupCompletion`), so web and mobile always agree. `schools.setup_completed_at` only records that the owner chose to hide the guide.

**Invitations.** `create_invitation` returns the raw token once. The web app shows the link for copying or WhatsApp sharing and asks the `send-invitation` Edge Function to email it. The function checks the caller's `staff.create` permission and the token's hash before sending, and answers `{ sent: false }` when email is not configured.

**Logos.** The public `school-logos` bucket stores files under `<school_id>/`. Storage policies call `app.can_manage_school_file`, which validates the folder name and requires `settings.edit` in that school.

**Product tours.** Finished walkthroughs are stored in `profiles.completed_tours` (and mirrored locally so a failed save never repeats a tour). The web tour highlights elements marked with `data-tour` and drops any step whose element is not on screen, so people only hear about areas their role can open. Mobile shows a swipeable walkthrough on first sign in.

**Wording.** Text people read avoids dashes and hyphenated compounds. Migration 1200 updates the seeded descriptions and the one database message that used them.

## Phase 3: students, guardians and staff

**Who sees a child.** `app.can_view_student` allows a student record to be read by staff with `students.view`, by teachers who teach one of the student's current classes (class teacher or subject teacher, via `app.teaches_student`), by guardians explicitly linked to the child (`app.is_guardian_of`) and by the student themselves. Each helper also requires an active membership, so suspending a parent's access ends it immediately. Tests in `packages/db-tests/tests/students.test.ts` pin down each case.

**Sensitive details live apart.** Health, welfare and emergency details sit in `student_details`, protected by the new `student_health.view` and `student_health.edit` permissions (school administrators edit, principals view) and readable by the child's guardians. Changes are audited by field name only through `app.audit_redacted_change`, so the audit log never stores medical text.

**One step registration.** `register_student` creates the student, optional health details, guardians (reusing a guardian with the same email, so siblings share one record) and the first class enrolment in one transaction. Admission numbers default to `<school initials>/<year>/<0001>` from a per school counter. A trigger enforces the plan's student limit.

**Class history, not overwrites.** `class_enrollments` keeps one active row per student; `enroll_students` closes the old row as `transferred` before opening the new one and refuses classes that are full.

**Import.** The browser reads the CSV (shared `parseCsv` and `readStudentImport`, which accept common header names and DD/MM/YYYY dates) and shows every problem before anything is sent. `import_students` then saves all rows or none and reports the first failing row number. Exports quote values so spreadsheets never run them as formulas.

**Guardian portal.** `invite_guardian` creates a parent role invitation tied to the guardian record (`invitations.guardian_id`); `accept_invitation` links the new account to that record. `get_my_children` returns only the caller's linked children, which drives the My children page, the parent dashboard and mobile Home.

**Files.** Student photos and documents use the private `student-files` bucket with short lived signed URLs. Photos follow the student visibility rule; documents are limited to student administrators and guardians.

**Staff profiles.** `staff_profiles` holds employment details per person per school. They are visible to staff managers and the person themselves, never to parents or students.

## Phase 4: academic operations

**One access pattern for academic records.** Oversight staff (the module's view permission plus `students.view`) see every class. Teachers see the classes they teach, as class teacher or subject teacher (`app.teaches_class`, `app.teaches_subject`). Students and guardians see records for their own class and children (`app.is_family_of_class`). `app.staff_can_see_class` wraps the staff half so every policy reads the same way. Class and subject names are readable by every member, because timetables and report cards show them to families.

**Timetable clashes are refused by the database.** A trigger checks the class, the teacher (across all of their memberships) and the room on the same campus, under a per school advisory lock so two editors cannot create a clash at the same moment. Messages name the clash, such as "Mr Bello is already teaching JSS 1B at that time".

**Attendance is written through one function.** `save_attendance` creates the register and its rows in one step, refuses future dates and students not in the class on that day, and stops the teacher once the register is submitted; people with `attendance.edit` can still correct it. Rates count late arrivals as attended. `attendance_report` returns daily counts per class, which the app rolls up into daily, weekly and monthly views.

**Assignments and the student portal.** Students sign in through invitations tied to their record (`invite_student`, `invitations.student_id`). `submit_assignment` only accepts work from the student themselves, for published work in their current class, before the deadline unless late work is allowed, and never after grading. Files live in the private `academic-files` bucket; students can only write inside their own submission folder.

**Results need approval before families see them.** Assessments move from draft to submitted, then approved or returned (with a required note), then published. Only `examinations.approve` holders review, publish, or change scores after submission, and every change is audited. Families only ever read published assessments, and guardians only when their link allows results.

**Grading is configurable.** Each school has its own bands (seeded with A to F); a band applies from its starting score up to the next one, and one band must start at 0. Subject totals are weighted (score divided by maximum, times weight, normalised to 100), absent counts as zero and unentered scores are left out. Class positions are off unless the school turns them on.

**Report cards are snapshots.** `generate_report_cards` stores each student's published subject results, average, grade, optional position and attendance for the term, keeping comments when refreshed. Class teachers write their comment; the principal writes theirs and publishes. The PDF is built in the browser from data the viewer is already allowed to read.
