import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ThemePreference } from '@klasora/shared';

const STORAGE_KEY = 'klasora.theme';

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    /* storage unavailable (private mode) — fall through */
  }
  return 'light';
}

/**
 * Theme preference. Persisted locally for an instant first paint (see the
 * inline script in index.html) and to the user's profile so it follows them
 * across devices.
 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemePreference>(readStored());
  const isDark = ref(false);
  let media: MediaQueryList | null = null;

  function apply() {
    const prefersDark = media?.matches ?? false;
    isDark.value = mode.value === 'dark' || (mode.value === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark.value);
  }

  function init() {
    media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    media?.addEventListener('change', apply);
    apply();
  }

  function setMode(next: ThemePreference) {
    mode.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    apply();
  }

  return { mode, isDark, init, setMode };
});
