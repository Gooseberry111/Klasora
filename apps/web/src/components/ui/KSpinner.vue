<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 16, label: 'Loading' });
</script>

<template>
  <svg
    class="shrink-0 animate-spin"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    role="status"
    :aria-label="label"
  >
    <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-opacity="0.22" stroke-width="3" />
    <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
  </svg>
</template>
