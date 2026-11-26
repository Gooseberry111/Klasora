<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{ icon?: Component; title: string; description?: string; compact?: boolean }>();
</script>

<template>
  <div :class="['flex flex-col items-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14']">
    <div
      v-if="icon"
      class="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-surface-muted text-ink-muted"
    >
      <component :is="icon" :size="22" aria-hidden="true" />
    </div>
    <h3 class="k-card-title">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-md text-[13.5px] text-ink-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5 flex flex-wrap justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
