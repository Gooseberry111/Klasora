import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { academicVocabulary, type AcademicStructure, type InstitutionType, type MembershipWithContext, type PermissionKey } from '@klasora/shared';
import { fetchMyMemberships, fetchMyPermissions } from '@/services/workspace';
import { fetchMyChildren } from '@/services/students';
import type { ChildSummary, MyStudent } from '@klasora/shared';
import { fetchMyStudent } from '@/services/academics';
import { useAuthStore } from './auth';

export interface WorkspaceSchool {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  institution_type: InstitutionType;
  academic_structure: AcademicStructure;
  roles: MembershipWithContext['role'][];
}

/**
 * The signed-in user's schools and their effective permissions in the active
 * school. Permissions here only shape the UI (hide what you can't use); the
 * database enforces them independently.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const memberships = ref<MembershipWithContext[]>([]);
  const loaded = ref(false);
  const currentSchoolId = ref<string | null>(null);
  const permissions = ref<Set<PermissionKey>>(new Set());
  /** Children linked to the signed in person as a guardian, in the active school. */
  const children = ref<ChildSummary[]>([]);
  const isGuardian = computed(() => children.value.length > 0);
  /** The signed in person's own student record, when they are a student. */
  const myStudent = ref<MyStudent | null>(null);
  const isStudent = computed(() => myStudent.value !== null);
  /** Membership ids of the signed in person in the active school (to find what they teach). */
  const myMembershipIds = computed(() => memberships.value.filter((m) => m.school_id === currentSchoolId.value).map((m) => m.id));

  const schools = computed<WorkspaceSchool[]>(() => {
    const bySchool = new Map<string, WorkspaceSchool>();
    for (const m of memberships.value) {
      const existing = bySchool.get(m.school_id);
      if (existing) existing.roles.push(m.role);
      else bySchool.set(m.school_id, { ...m.school, roles: [m.role] });
    }
    return [...bySchool.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  const currentSchool = computed(() => schools.value.find((s) => s.id === currentSchoolId.value) ?? null);
  const currentRoles = computed(() => currentSchool.value?.roles ?? []);
  /** Labels that match how the active school is organised (Term or Semester, Class or Level). */
  const words = computed(() => academicVocabulary(currentSchool.value?.academic_structure ?? 'classes_grades'));
  const isOwner = computed(() => currentRoles.value.some((r) => r.role_key === 'owner'));
  const currentRoleIds = computed(() => new Set(currentRoles.value.map((r) => r.id)));

  function can(permission: PermissionKey): boolean {
    return permissions.value.has(permission);
  }

  function canAny(list: PermissionKey[]): boolean {
    return list.some((p) => permissions.value.has(p));
  }

  async function loadMemberships(force = false) {
    if (loaded.value && !force) return;
    const auth = useAuthStore();
    if (!auth.user) {
      reset();
      return;
    }
    memberships.value = await fetchMyMemberships(auth.user.id);
    loaded.value = true;
  }

  /** Makes the school with `slug` active. Returns false if the user is not a member. */
  async function activate(slug: string): Promise<boolean> {
    await loadMemberships();
    const school = schools.value.find((s) => s.slug === slug);
    if (!school) return false;
    if (currentSchoolId.value !== school.id || permissions.value.size === 0) {
      const [keys, kids, me] = await Promise.all([
        fetchMyPermissions(school.id),
        fetchMyChildren(school.id).catch(() => []),
        fetchMyStudent(school.id),
      ]);
      currentSchoolId.value = school.id;
      permissions.value = new Set(keys);
      children.value = kids;
      myStudent.value = me;
    }
    return true;
  }

  async function refreshPermissions() {
    if (!currentSchoolId.value) return;
    permissions.value = new Set(await fetchMyPermissions(currentSchoolId.value));
  }

  /** Applies profile edits (name, logo) to the cached school without a reload. */
  function patchSchool(id: string, changes: Partial<Pick<WorkspaceSchool, 'name' | 'logo_url'>>) {
    for (const m of memberships.value) {
      if (m.school_id === id) Object.assign(m.school, changes);
    }
  }

  function reset() {
    memberships.value = [];
    loaded.value = false;
    currentSchoolId.value = null;
    permissions.value = new Set();
    children.value = [];
    myStudent.value = null;
  }

  return {
    memberships,
    loaded,
    schools,
    currentSchoolId,
    currentSchool,
    currentRoles,
    currentRoleIds,
    words,
    patchSchool,
    isOwner,
    permissions,
    children,
    isGuardian,
    myStudent,
    isStudent,
    myMembershipIds,
    can,
    canAny,
    loadMemberships,
    activate,
    refreshPermissions,
    reset,
  };
});
