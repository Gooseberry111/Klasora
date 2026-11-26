<script setup lang="ts">
/** Renders global toasts and the confirmation dialog. Mounted once in App.vue. */
import { computed } from 'vue';
import { CheckCircle2, Info, X, XCircle } from 'lucide-vue-next';
import { useFeedbackStore } from '@/stores/feedback';
import KModal from './KModal.vue';
import KButton from './KButton.vue';

const feedback = useFeedbackStore();

const confirmOpen = computed({
  get: () => Boolean(feedback.confirmation),
  set: (value: boolean) => {
    if (!value) feedback.settleConfirmation(false);
  },
});

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const iconClass = { success: 'text-success', error: 'text-danger', info: 'text-brand' };
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:top-0 sm:bottom-auto sm:items-end"
    aria-live="polite"
    aria-atomic="false"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0 sm:translate-x-4 sm:translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-for="toast in feedback.toasts"
        :key="toast.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-line bg-surface-raised p-3.5 shadow-pop"
        :role="toast.tone === 'error' ? 'alert' : 'status'"
      >
        <component :is="icons[toast.tone]" :size="18" :class="['mt-px shrink-0', iconClass[toast.tone]]" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink">{{ toast.title }}</p>
          <p v-if="toast.description" class="mt-0.5 text-[13px] text-ink-muted">{{ toast.description }}</p>
        </div>
        <button
          type="button"
          class="-m-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-muted hover:text-ink"
          aria-label="Dismiss notification"
          @click="feedback.dismiss(toast.id)"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>
    </TransitionGroup>
  </div>

  <KModal
    v-model:open="confirmOpen"
    :title="feedback.confirmation?.title ?? ''"
    :description="feedback.confirmation?.description"
    size="sm"
  >
    <template #footer>
      <KButton variant="secondary" @click="feedback.settleConfirmation(false)">
        {{ feedback.confirmation?.cancelLabel ?? 'Cancel' }}
      </KButton>
      <KButton
        :variant="feedback.confirmation?.tone === 'primary' ? 'primary' : 'danger'"
        autofocus
        @click="feedback.settleConfirmation(true)"
      >
        {{ feedback.confirmation?.confirmLabel ?? 'Confirm' }}
      </KButton>
    </template>
  </KModal>
</template>
