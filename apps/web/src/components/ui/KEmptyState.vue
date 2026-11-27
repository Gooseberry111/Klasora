<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{ icon?: Component; title: string; description?: string; compact?: boolean }>();
</script>

<template>
  <div :class="['flex flex-col items-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14']">
    <div v-if="icon" class="relative mb-6 flex size-24 items-center justify-center" aria-hidden="true">
      <!-- Concentric rings: a quiet echo of the connected network in the logo. -->
      <span class="absolute inset-0 rounded-full border border-dotted border-line-strong" />
      <span class="absolute inset-3 rounded-full bg-brand-soft" />
      <span class="relative flex size-12 items-center justify-center rounded-2xl k-bg-brand text-white shadow-brand">
        <component :is="icon" :size="22" />
      </span>
    </div>
    <h3 class="text-[16px] font-semibold text-ink">{{ title }}</h3>
    <p v-if="description" class="mt-1.5 max-w-md text-[13.5px] text-ink-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-6 flex flex-wrap justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
