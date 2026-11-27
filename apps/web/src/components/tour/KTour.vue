<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-vue-next';
import KButton from '@/components/ui/KButton.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { useTourStore } from '@/stores/tour';

/**
 * Renders the active tour: a dimmed backdrop with a spotlight cut out around
 * the highlighted element, and a card explaining it. Keyboard: arrow keys
 * move between steps, Escape closes the tour.
 */
const tour = useTourStore();
const titleId = useId();
const card = ref<HTMLElement | null>(null);
const rect = ref<{ top: number; left: number; width: number; height: number } | null>(null);
const cardSize = ref({ width: 360, height: 220 });
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
const PAD = 8;
const GAP = 16;
const MARGIN = 12;

let settleTimer: ReturnType<typeof setTimeout> | undefined;

function measure() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
  const step = tour.current;
  if (!step?.target) {
    rect.value = null;
  } else {
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      rect.value = null;
    } else {
      const r = el.getBoundingClientRect();
      rect.value = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    }
  }
  if (card.value) cardSize.value = { width: card.value.offsetWidth, height: card.value.offsetHeight };
}

async function focusStep() {
  await nextTick();
  const step = tour.current;
  const el = step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
  el?.scrollIntoView({ block: 'center', inline: 'nearest' });
  measure();
  // The sidebar slides in on small screens; measure again once it settles.
  clearTimeout(settleTimer);
  settleTimer = setTimeout(measure, 260);
  card.value?.focus({ preventScroll: true });
}

watch(() => [tour.active, tour.index], () => tour.active && void focusStep(), { immediate: true });

function onKeydown(event: KeyboardEvent) {
  if (!tour.active) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    tour.end(false);
  } else if (event.key === 'ArrowRight') {
    tour.next();
  } else if (event.key === 'ArrowLeft') {
    tour.back();
  }
}

window.addEventListener('resize', measure);
window.addEventListener('scroll', measure, true);
window.addEventListener('keydown', onKeydown);
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure);
  window.removeEventListener('scroll', measure, true);
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(settleTimer);
});

/** Places the card beside the spotlight where it fits: right, below, above, then left. */
const cardStyle = computed(() => {
  const { width: vw, height: vh } = viewport.value;
  const w = Math.min(cardSize.value.width, vw - MARGIN * 2);
  const h = cardSize.value.height;
  const r = rect.value;
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - w - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - h - MARGIN);

  if (!r) return { left: `${(vw - w) / 2}px`, top: `${Math.max(MARGIN, (vh - h) / 2)}px` };
  if (r.left + r.width + GAP + w <= vw - MARGIN) {
    return { left: `${r.left + r.width + GAP}px`, top: `${clampY(r.top)}px` };
  }
  if (r.top + r.height + GAP + h <= vh - MARGIN) {
    return { left: `${clampX(r.left + r.width / 2 - w / 2)}px`, top: `${r.top + r.height + GAP}px` };
  }
  if (r.top - GAP - h >= MARGIN) {
    return { left: `${clampX(r.left + r.width / 2 - w / 2)}px`, top: `${r.top - GAP - h}px` };
  }
  return { left: `${clampX(r.left - GAP - w)}px`, top: `${clampY(r.top)}px` };
});

const progress = computed(() => `${tour.index + 1} of ${tour.steps.length}`);
</script>

<template>
  <Teleport to="body">
    <Transition enter-active-class="transition-opacity duration-200" enter-from-class="opacity-0" leave-active-class="transition-opacity duration-150" leave-to-class="opacity-0">
      <div v-if="tour.active && tour.current" class="fixed inset-0 z-[60]" @click.self.stop>
        <!-- Backdrop with a rounded spotlight. -->
        <svg class="absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <mask id="k-tour-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                v-if="rect"
                :x="rect.left"
                :y="rect.top"
                :width="rect.width"
                :height="rect.height"
                rx="12"
                fill="black"
                class="transition-all duration-300 ease-out"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgb(8 15 28 / 0.62)" mask="url(#k-tour-mask)" />
        </svg>
        <div
          v-if="rect"
          class="pointer-events-none absolute rounded-xl ring-2 ring-[#60A5FA] shadow-[0_0_0_6px_rgb(96_165_250_/_0.25)] transition-all duration-300 ease-out"
          :style="{ top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
          aria-hidden="true"
        />

        <div
          ref="card"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
          class="absolute w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-panel border border-line bg-surface shadow-pop outline-none"
          :style="cardStyle"
        >
          <div class="k-bg-brand h-1" :style="{ width: `${((tour.index + 1) / tour.steps.length) * 100}%` }" aria-hidden="true" />
          <div class="p-5">
            <div class="flex items-start gap-3.5">
              <KIconTile v-if="tour.current.icon" :icon="tour.current.icon" solid :size="40" />
              <div class="min-w-0 flex-1">
                <p class="text-[11.5px] font-semibold tracking-[0.08em] text-brand-ink uppercase">Step {{ progress }}</p>
                <h2 :id="titleId" class="mt-0.5 text-[16px] font-semibold text-ink">{{ tour.current.title }}</h2>
              </div>
              <button
                type="button"
                class="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-muted hover:text-ink"
                aria-label="Close the tour"
                @click="tour.end(false)"
              >
                <X :size="17" aria-hidden="true" />
              </button>
            </div>
            <p class="mt-3 text-[13.5px] leading-relaxed text-ink-muted">{{ tour.current.body }}</p>

            <div class="mt-5 flex items-center justify-between gap-2">
              <div class="flex gap-1" aria-hidden="true">
                <span
                  v-for="(_, i) in tour.steps"
                  :key="i"
                  :class="['h-1.5 rounded-full transition-all', i === tour.index ? 'w-5 bg-brand' : 'w-1.5 bg-line-strong']"
                />
              </div>
              <div class="flex gap-2">
                <KButton v-if="!tour.isFirst" variant="ghost" size="sm" :icon="ArrowLeft" @click="tour.back">Back</KButton>
                <KButton v-else variant="ghost" size="sm" @click="tour.end(false)">Skip tour</KButton>
                <KButton size="sm" :icon-right="tour.isLast ? Check : ArrowRight" @click="tour.next">
                  {{ tour.isLast ? 'Finish' : 'Next' }}
                </KButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
