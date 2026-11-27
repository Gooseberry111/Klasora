<script setup lang="ts">
/**
 * Klasora mark: an open book whose pages are joined by a connected network:
 * education, connected. The mark stands alone as the app icon.
 */
withDefaults(defineProps<{ size?: number; wordmark?: boolean; inverted?: boolean }>(), {
  size: 32,
  wordmark: true,
});
</script>

<template>
  <span class="inline-flex items-center gap-2.5" :aria-label="wordmark ? undefined : 'Klasora'">
    <svg :width="size" :height="size" viewBox="0 0 40 40" fill="none" aria-hidden="true" class="shrink-0">
      <rect width="40" height="40" rx="10" :fill="inverted ? '#FFFFFF' : '#14243A'" />
      <path d="M8 15.2c4-1.6 8-1.2 11.2 1.4V31c-3.2-2.4-7.2-2.8-11.2-1.4V15.2Z" :fill="inverted ? '#14243A' : '#FFFFFF'" />
      <path d="M32 15.2c-4-1.6-8-1.2-11.2 1.4V31c3.2-2.4 7.2-2.8 11.2-1.4V15.2Z" fill="#3B82F6" />
      <path d="M11 10.6 20 7.4l9 3.2" stroke="#3B82F6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="11" cy="10.6" r="1.9" :fill="inverted ? '#14243A' : '#FFFFFF'" />
      <circle cx="20" cy="7.4" r="1.9" fill="#3B82F6" />
      <circle cx="29" cy="10.6" r="1.9" :fill="inverted ? '#14243A' : '#FFFFFF'" />
    </svg>
    <span
      v-if="wordmark"
      :class="['font-semibold tracking-[-0.02em]', inverted ? 'text-white' : 'text-ink']"
      :style="{ fontSize: `${Math.round(size * 0.6)}px` }"
    >
      Klasora
    </span>
  </span>
</template>
