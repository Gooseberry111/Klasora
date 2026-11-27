import { computed, ref, watch } from 'vue';
import type { AcademicTerm, AcademicYear, ClassSubject, PermissionKey, SchoolClass, Subject } from '@klasora/shared';
import { listAcademicYears, listClassSubjects, listClasses, listSubjects, listTerms } from '@/services/setup';
import { useWorkspaceStore } from '@/stores/workspace';

/**
 * Classes, subjects and terms for academic screens, plus which classes and
 * subjects the signed in person teaches. Oversight staff (the permission
 * plus students.view) work with every class; teachers with their own.
 */
export function useTeaching() {
  const workspace = useWorkspaceStore();
  const classes = ref<SchoolClass[]>([]);
  const subjects = ref<Subject[]>([]);
  const classSubjects = ref<ClassSubject[]>([]);
  const years = ref<AcademicYear[]>([]);
  const terms = ref<AcademicTerm[]>([]);
  const loaded = ref(false);

  async function load() {
    const schoolId = workspace.currentSchoolId;
    if (!schoolId) return;
    [classes.value, subjects.value, classSubjects.value, years.value, terms.value] = await Promise.all([
      listClasses(schoolId).catch(() => []),
      listSubjects(schoolId).catch(() => []),
      listClassSubjects(schoolId).catch(() => []),
      listAcademicYears(schoolId).catch(() => []),
      listTerms(schoolId).catch(() => []),
    ]);
    loaded.value = true;
  }
  watch(() => workspace.currentSchoolId, load, { immediate: true });

  const mine = computed(() => new Set(workspace.myMembershipIds));

  /** Classes where I am the class teacher or teach a subject. */
  const taughtClassIds = computed(() => {
    const ids = new Set<string>();
    for (const c of classes.value) if (c.class_teacher_membership_id && mine.value.has(c.class_teacher_membership_id)) ids.add(c.id);
    for (const cs of classSubjects.value) if (cs.teacher_membership_id && mine.value.has(cs.teacher_membership_id)) ids.add(cs.class_id);
    return ids;
  });

  function oversees(permission: PermissionKey) {
    return workspace.can(permission) && workspace.can('students.view');
  }

  /** Classes I can work with for a module. */
  function classesFor(permission: PermissionKey) {
    const all = oversees(permission) || workspace.can('academics.edit');
    return classes.value.filter((c) => c.status === 'active' && (all || taughtClassIds.value.has(c.id)));
  }

  /** Subjects I can work with in a class (all of the class's subjects for its class teacher). */
  function subjectsFor(classId: string, permission: PermissionKey) {
    const cls = classes.value.find((c) => c.id === classId);
    const isClassTeacher = Boolean(cls?.class_teacher_membership_id && mine.value.has(cls.class_teacher_membership_id));
    const all = oversees(permission) || workspace.can('academics.edit') || isClassTeacher;
    const ids = classSubjects.value
      .filter((cs) => cs.class_id === classId && (all || (cs.teacher_membership_id && mine.value.has(cs.teacher_membership_id))))
      .map((cs) => cs.subject_id);
    return subjects.value.filter((s) => ids.includes(s.id));
  }

  const currentYear = computed(() => years.value.find((y) => y.is_current) ?? null);
  const currentTerm = computed(() => terms.value.find((t) => t.is_current) ?? null);
  const className = (id: string | null | undefined) => classes.value.find((c) => c.id === id)?.name ?? '';
  const subjectName = (id: string | null | undefined) => subjects.value.find((s) => s.id === id)?.name ?? '';
  const termLabel = (id: string | null | undefined) => {
    const t = terms.value.find((x) => x.id === id);
    const y = t ? years.value.find((x) => x.id === t.academic_year_id) : undefined;
    return t ? `${t.name}${y ? `, ${y.name}` : ''}` : '';
  };

  return {
    classes, subjects, classSubjects, years, terms, loaded, load,
    taughtClassIds, oversees, classesFor, subjectsFor, currentYear, currentTerm, className, subjectName, termLabel,
  };
}
