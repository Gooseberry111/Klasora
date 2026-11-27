import { defineStore } from 'pinia';
import { computed, ref, shallowRef, type Component } from 'vue';

export interface TourStep {
  /** Value of the `data-tour` attribute to spotlight. Omit for a centred card. */
  target?: string;
  title: string;
  body: string;
  icon?: Component;
  /** The target lives in the sidebar, which must be open on small screens. */
  inSidebar?: boolean;
}

/**
 * The guided walkthrough. Steps whose target is not on the page (because the
 * person lacks the permission behind it) are dropped when the tour starts,
 * so everyone only hears about what they can actually use.
 */
export const useTourStore = defineStore('tour', () => {
  const tourId = ref<string | null>(null);
  // Shallow: steps hold icon components, which must not be made reactive.
  const steps = shallowRef<TourStep[]>([]);
  const index = ref(0);
  let onFinish: ((completed: boolean) => void) | null = null;

  const active = computed(() => tourId.value !== null && steps.value.length > 0);
  const current = computed(() => (active.value ? (steps.value[index.value] ?? null) : null));
  const isFirst = computed(() => index.value === 0);
  const isLast = computed(() => index.value === steps.value.length - 1);

  function targetExists(step: TourStep) {
    return !step.target || document.querySelector(`[data-tour="${step.target}"]`) !== null;
  }

  function start(id: string, all: TourStep[], finish?: (completed: boolean) => void) {
    const available = all.filter(targetExists);
    if (available.length === 0) return;
    tourId.value = id;
    steps.value = available;
    index.value = 0;
    onFinish = finish ?? null;
  }

  function next() {
    if (isLast.value) end(true);
    else index.value += 1;
  }

  function back() {
    if (index.value > 0) index.value -= 1;
  }

  function end(completed: boolean) {
    const callback = onFinish;
    tourId.value = null;
    steps.value = [];
    index.value = 0;
    onFinish = null;
    callback?.(completed);
  }

  return { tourId, steps, index, active, current, isFirst, isLast, start, next, back, end };
});
