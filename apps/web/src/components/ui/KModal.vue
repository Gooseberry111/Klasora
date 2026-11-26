<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { X } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });

const props = withDefaults(
  defineProps<{ title: string; description?: string; size?: 'sm' | 'md' | 'lg'; dismissible?: boolean }>(),
  { size: 'md', dismissible: true },
);

const titleId = useId();
const panel = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

function close() {
  if (props.dismissible) open.value = false;
}

function focusables(): HTMLElement[] {
  return Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  );
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  // Keep keyboard focus inside the dialog.
  const items = focusables();
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      await nextTick();
      const autofocus = panel.value?.querySelector<HTMLElement>('[autofocus]');
      (autofocus ?? focusables()[0] ?? panel.value)?.focus();
    } else {
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center bg-[#0b1322]/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
        @mousedown.self="close"
        @keydown="onKeydown"
      >
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
          :class="[
            'flex max-h-[92vh] w-full flex-col rounded-t-panel border border-line bg-surface shadow-pop outline-none sm:rounded-panel',
            widths[size],
          ]"
        >
          <header class="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
            <div>
              <h2 :id="titleId" class="text-[17px] font-semibold text-ink">{{ title }}</h2>
              <p v-if="description" class="mt-1 text-[13.5px] text-ink-muted">{{ description }}</p>
            </div>
            <button
              v-if="dismissible"
              type="button"
              class="-mt-1 -mr-2 flex size-8 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-muted hover:text-ink"
              aria-label="Close dialog"
              @click="close"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </header>
          <div class="overflow-y-auto px-6 pb-5">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
