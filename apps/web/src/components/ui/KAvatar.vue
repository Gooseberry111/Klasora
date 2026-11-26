<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ name: string; src?: string | null; size?: number; square?: boolean }>(), {
  size: 32,
});

const initials = computed(() => {
  const parts = props.name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0]?.slice(0, 2) ?? '?');
  return letters.toUpperCase();
});
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center justify-center overflow-hidden bg-brand-soft font-semibold text-brand-ink select-none',
      square ? 'rounded-lg' : 'rounded-full',
    ]"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }"
  >
    <img v-if="src" :src="src" :alt="name" class="size-full object-cover" />
    <span v-else aria-hidden="true">{{ initials }}</span>
  </span>
</template>
