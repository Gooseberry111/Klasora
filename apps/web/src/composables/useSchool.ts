import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { PermissionKey } from '@klasora/shared';
import { useWorkspaceStore } from '@/stores/workspace';
import { useFeedbackStore } from '@/stores/feedback';

/** The active school and helpers that almost every workspace screen needs. */
export function useSchool() {
  const workspace = useWorkspaceStore();
  const feedback = useFeedbackStore();
  const route = useRoute();

  const schoolId = computed(() => workspace.currentSchoolId ?? '');
  const slug = computed(() => String(route.params.slug ?? workspace.currentSchool?.slug ?? ''));
  const words = computed(() => workspace.words);
  const can = (permission: PermissionKey) => workspace.can(permission);
  const writable = computed(() => workspace.currentSchool?.status !== 'suspended');

  /** Runs `task`, shows a success toast, and shows the error as a toast on failure. */
  async function attempt<T>(task: () => Promise<T>, success?: string): Promise<T | undefined> {
    try {
      const result = await task();
      if (success) feedback.success(success);
      return result;
    } catch (error) {
      feedback.error((error as Error).message || 'Something went wrong. Please try again.');
      return undefined;
    }
  }

  return { workspace, feedback, schoolId, slug, words, can, writable, attempt };
}

/** Formats an ISO date (from a date column) for display, without time zone shifts. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fullName(person: { first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  return `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.email || 'Unnamed';
}
