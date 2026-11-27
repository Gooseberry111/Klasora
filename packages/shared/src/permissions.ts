/**
 * Klasora permission catalogue.
 *
 * TypeScript mirror of the `public.permissions` table seeded in
 * `supabase/migrations/20261126000400_permission_catalogue.sql`. The database is
 * the enforcement point (RLS + security-definer RPCs); this file exists so the
 * web and mobile clients can render permission-aware UI with type safety.
 *
 * A test in `packages/db-tests` asserts both lists stay identical.
 */

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  approve: 'Approve',
  export: 'Export',
};

interface ModuleDefinition {
  label: string;
  description: string;
  actions: readonly PermissionAction[];
}

export const PERMISSION_MODULES = {
  students: {
    label: 'Students',
    description: 'Student records, admissions and guardians.',
    actions: ['view', 'create', 'edit', 'delete', 'export'],
  },
  student_health: {
    label: 'Student health and welfare',
    description: 'Medical, accessibility and emergency contact details.',
    actions: ['view', 'edit'],
  },
  staff: {
    label: 'Staff',
    description: 'Teachers, staff members, invitations and memberships.',
    actions: ['view', 'create', 'edit', 'delete', 'export'],
  },
  academics: {
    label: 'Academics',
    description: 'Academic years, terms, classes, subjects and timetables.',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  attendance: {
    label: 'Attendance',
    description: 'Recording and reviewing attendance.',
    actions: ['view', 'create', 'edit', 'export'],
  },
  assignments: {
    label: 'Assignments',
    description: 'Assignments, submissions and grading.',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  examinations: {
    label: 'Examinations',
    description: 'Assessments, scores, results and report cards.',
    actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'],
  },
  communication: {
    label: 'Communication',
    description: 'Announcements and messaging.',
    actions: ['view', 'create', 'edit', 'delete', 'approve'],
  },
  finance: {
    label: 'Finance',
    description: 'Fee structures, invoices and payments.',
    actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'],
  },
  reports: {
    label: 'Reports',
    description: 'Analytics and exported reports.',
    actions: ['view', 'export'],
  },
  settings: {
    label: 'School settings',
    description: 'School profile, campuses and configuration.',
    actions: ['view', 'edit'],
  },
  roles: {
    label: 'User roles',
    description: 'Custom roles and their permissions.',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  billing: {
    label: 'Subscription and billing',
    description: 'Klasora subscription plan and payments.',
    actions: ['view', 'edit'],
  },
  audit: {
    label: 'Audit log',
    description: 'History of sensitive changes in the school.',
    actions: ['view'],
  },
} as const satisfies Record<string, ModuleDefinition>;

export type PermissionModule = keyof typeof PERMISSION_MODULES;

type KeysFor<M extends PermissionModule> = `${M}.${(typeof PERMISSION_MODULES)[M]['actions'][number]}`;
export type PermissionKey = { [M in PermissionModule]: KeysFor<M> }[PermissionModule];

export const PERMISSION_MODULE_KEYS = Object.keys(PERMISSION_MODULES) as PermissionModule[];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_MODULE_KEYS.flatMap((module) =>
  PERMISSION_MODULES[module].actions.map((action) => `${module}.${action}` as PermissionKey),
);

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as string[]).includes(value);
}

/** Returns the key for a module/action pair, or null if that action does not exist for the module. */
export function permissionKey(module: PermissionModule, action: PermissionAction): PermissionKey | null {
  const actions = PERMISSION_MODULES[module].actions as readonly PermissionAction[];
  return actions.includes(action) ? (`${module}.${action}` as PermissionKey) : null;
}

/* ------------------------------------------------------------------ */
/* System roles                                                        */
/* ------------------------------------------------------------------ */

export const SYSTEM_ROLE_KEYS = [
  'owner',
  'school_admin',
  'principal',
  'teacher',
  'accountant',
  'parent',
  'student',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const SYSTEM_ROLE_LABELS: Record<SystemRoleKey, string> = {
  owner: 'School Owner',
  school_admin: 'School Administrator',
  principal: 'Principal / Head Teacher',
  teacher: 'Teacher',
  accountant: 'Accountant / Bursar',
  parent: 'Parent / Guardian',
  student: 'Student',
};

/**
 * Default permissions granted to each built-in role when a school is created.
 * Mirrors `public.system_role_template_permissions`.
 *
 * - The owner implicitly holds every permission (enforced in `app.has_permission`).
 * - Teachers do not get school-wide `students.view`; their access to students is
 *   scoped to assigned classes by relationship-based policies (Phase 3/4).
 * - Parents and students hold no school-wide permissions; they reach their own
 *   records only through guardian/student relationships.
 */
export const SYSTEM_ROLE_DEFAULT_PERMISSIONS: Record<Exclude<SystemRoleKey, 'owner'>, PermissionKey[]> = {
  school_admin: [
    'students.view', 'students.create', 'students.edit', 'students.delete', 'students.export',
    'student_health.view', 'student_health.edit',
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
    'audit.view',
  ],
  principal: [
    'students.view', 'students.export',
    'student_health.view',
    'staff.view',
    'academics.view',
    'attendance.view', 'attendance.export',
    'assignments.view',
    'examinations.view', 'examinations.approve', 'examinations.export',
    'communication.view', 'communication.create', 'communication.approve',
    'reports.view', 'reports.export',
    'settings.view',
  ],
  teacher: [
    'academics.view',
    'attendance.view', 'attendance.create',
    'assignments.view', 'assignments.create', 'assignments.edit', 'assignments.delete',
    'examinations.view', 'examinations.create', 'examinations.edit',
    'communication.view', 'communication.create',
  ],
  accountant: [
    'students.view',
    'finance.view', 'finance.create', 'finance.edit', 'finance.delete', 'finance.approve', 'finance.export',
    'reports.view', 'reports.export',
  ],
  parent: [],
  student: [],
};
