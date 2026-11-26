-- =============================================================================
-- Klasora · 0400 · Permission catalogue and built-in role templates
--
-- Mirrors packages/shared/src/permissions.ts (a db-test asserts they match).
-- New permissions in later phases are added by new migrations that insert into
-- `permissions` and, where appropriate, backfill `role_permissions`.
-- =============================================================================

insert into public.permissions (permission_key, module, action, description)
select module || '.' || action, module, action, description
from (values
  ('students',      'view',    'View student records'),
  ('students',      'create',  'Register new students'),
  ('students',      'edit',    'Edit student records'),
  ('students',      'delete',  'Remove student records'),
  ('students',      'export',  'Export student data'),
  ('staff',         'view',    'View staff and memberships'),
  ('staff',         'create',  'Invite staff and members'),
  ('staff',         'edit',    'Change staff details, roles and status'),
  ('staff',         'delete',  'Remove staff members'),
  ('staff',         'export',  'Export staff data'),
  ('academics',     'view',    'View academic structure'),
  ('academics',     'create',  'Create academic years, classes and subjects'),
  ('academics',     'edit',    'Edit academic structure'),
  ('academics',     'delete',  'Remove academic structure items'),
  ('attendance',    'view',    'View attendance'),
  ('attendance',    'create',  'Record attendance'),
  ('attendance',    'edit',    'Correct submitted attendance'),
  ('attendance',    'export',  'Export attendance'),
  ('assignments',   'view',    'View assignments'),
  ('assignments',   'create',  'Create assignments'),
  ('assignments',   'edit',    'Edit and grade assignments'),
  ('assignments',   'delete',  'Remove assignments'),
  ('examinations',  'view',    'View assessments and results'),
  ('examinations',  'create',  'Create assessments and record scores'),
  ('examinations',  'edit',    'Edit assessments and scores'),
  ('examinations',  'delete',  'Remove assessments'),
  ('examinations',  'approve', 'Approve and publish results'),
  ('examinations',  'export',  'Export results and report cards'),
  ('communication', 'view',    'View announcements'),
  ('communication', 'create',  'Create announcements'),
  ('communication', 'edit',    'Edit announcements'),
  ('communication', 'delete',  'Remove announcements'),
  ('communication', 'approve', 'Approve announcements and moderate messages'),
  ('finance',       'view',    'View fees, invoices and payments'),
  ('finance',       'create',  'Create fee structures, invoices and payment records'),
  ('finance',       'edit',    'Edit financial records'),
  ('finance',       'delete',  'Void financial records'),
  ('finance',       'approve', 'Approve manual payments and adjustments'),
  ('finance',       'export',  'Export financial reports'),
  ('reports',       'view',    'View reports and analytics'),
  ('reports',       'export',  'Export reports'),
  ('settings',      'view',    'View school settings'),
  ('settings',      'edit',    'Edit school profile, campuses and settings'),
  ('roles',         'view',    'View roles and permissions'),
  ('roles',         'create',  'Create custom roles'),
  ('roles',         'edit',    'Edit roles and their permissions'),
  ('roles',         'delete',  'Delete custom roles'),
  ('billing',       'view',    'View the Klasora subscription'),
  ('billing',       'edit',    'Change plan and pay for the Klasora subscription'),
  ('audit',         'view',    'View the audit log')
) as catalogue (module, action, description);

-- -----------------------------------------------------------------------------
-- Built-in role templates, copied into every new school by
-- app.provision_system_roles(). Schools can then adjust them (owner only).
-- -----------------------------------------------------------------------------
create table public.system_role_templates (
  role_key    text primary key,
  name        text not null,
  description text not null,
  sort_order  integer not null
);

create table public.system_role_template_permissions (
  role_key       text not null references public.system_role_templates (role_key) on delete cascade,
  permission_key text not null references public.permissions (permission_key) on delete cascade,
  primary key (role_key, permission_key)
);

insert into public.system_role_templates (role_key, name, description, sort_order) values
  ('owner',        'School Owner',             'Full control of the institution, including billing and roles.', 10),
  ('school_admin', 'School Administrator',     'Runs day-to-day school operations.', 20),
  ('principal',    'Principal / Head Teacher', 'Oversees academics, approves results and monitors staff.', 30),
  ('teacher',      'Teacher',                  'Teaches assigned classes: attendance, assignments and scores.', 40),
  ('accountant',   'Accountant / Bursar',      'Manages fees, invoices and payments.', 50),
  ('parent',       'Parent / Guardian',        'Follows linked children''s progress.', 60),
  ('student',      'Student',                  'Accesses their own timetable, work and results.', 70);

-- The owner is not listed: app.has_permission() grants owners everything.
insert into public.system_role_template_permissions (role_key, permission_key)
select t.role_key, p.permission_key
from (values
  ('school_admin', array[
    'students.view', 'students.create', 'students.edit', 'students.delete', 'students.export',
    'staff.view', 'staff.create', 'staff.edit', 'staff.delete', 'staff.export',
    'academics.view', 'academics.create', 'academics.edit', 'academics.delete',
    'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.export',
    'assignments.view', 'assignments.create', 'assignments.edit', 'assignments.delete',
    'examinations.view', 'examinations.create', 'examinations.edit', 'examinations.delete', 'examinations.export',
    'communication.view', 'communication.create', 'communication.edit', 'communication.delete', 'communication.approve',
    'finance.view',
    'reports.view', 'reports.export',
    'settings.view', 'settings.edit',
    'roles.view',
    'audit.view']),
  ('principal', array[
    'students.view', 'students.export',
    'staff.view',
    'academics.view',
    'attendance.view', 'attendance.export',
    'assignments.view',
    'examinations.view', 'examinations.approve', 'examinations.export',
    'communication.view', 'communication.create', 'communication.approve',
    'reports.view', 'reports.export',
    'settings.view']),
  ('teacher', array[
    'academics.view',
    'attendance.view', 'attendance.create',
    'assignments.view', 'assignments.create', 'assignments.edit', 'assignments.delete',
    'examinations.view', 'examinations.create', 'examinations.edit',
    'communication.view', 'communication.create']),
  ('accountant', array[
    'students.view',
    'finance.view', 'finance.create', 'finance.edit', 'finance.delete', 'finance.approve', 'finance.export',
    'reports.view', 'reports.export'])
) as t (role_key, keys)
cross join lateral unnest(t.keys) as k (permission_key)
join public.permissions p on p.permission_key = k.permission_key;
