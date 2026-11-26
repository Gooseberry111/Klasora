import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

/** Global toasts and confirmation dialogs (rendered once in App.vue). */
export const useFeedbackStore = defineStore('feedback', () => {
  const toasts = ref<Toast[]>([]);
  const confirmation = ref<PendingConfirm | null>(null);
  let nextId = 1;

  function toast(tone: ToastTone, title: string, description?: string, timeoutMs = 5000) {
    const id = nextId++;
    toasts.value.push({ id, tone, title, description });
    if (timeoutMs > 0) setTimeout(() => dismiss(id), timeoutMs);
    return id;
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  /** Asks the user to confirm a (usually destructive) action. */
  function confirm(request: ConfirmRequest): Promise<boolean> {
    confirmation.value?.resolve(false);
    return new Promise((resolve) => {
      confirmation.value = { ...request, resolve };
    });
  }

  function settleConfirmation(confirmed: boolean) {
    confirmation.value?.resolve(confirmed);
    confirmation.value = null;
  }

  return {
    toasts,
    confirmation,
    success: (title: string, description?: string) => toast('success', title, description),
    error: (title: string, description?: string) => toast('error', title, description, 8000),
    info: (title: string, description?: string) => toast('info', title, description),
    dismiss,
    confirm,
    settleConfirmation,
  };
});
