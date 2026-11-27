<script setup lang="ts">
import type { Component } from 'vue';

export type IconTone = 'brand' | 'success' | 'warning' | 'info' | 'danger' | 'violet' | 'neutral';

/** A coloured, softly lit square that holds an icon. Used for cards, stats and lists. */
withDefaults(
  defineProps<{
    icon: Component;
    tone?: IconTone;
    size?: number;
    /** Solid gradient instead of the soft tint. */
    solid?: boolean;
  }>(),
  { tone: 'brand', size: 40 },
);

const soft: Record<IconTone, string> = {
  brand: 'bg-brand-soft text-brand-ink ring-brand/15',
  success: 'bg-success-soft text-success-ink ring-success/15',
  warning: 'bg-warning-soft text-warning-ink ring-warning/20',
  info: 'bg-info-soft text-info-ink ring-info/15',
  danger: 'bg-danger-soft text-danger-ink ring-danger/15',
  violet: 'bg-[#F3F0FF] text-[#6D28D9] ring-[#7C3AED]/15 dark:bg-[#7C3AED]/15 dark:text-[#C4B5FD]',
  neutral: 'bg-surface-muted text-ink-muted ring-line',
};

const solidTones: Record<IconTone, string> = {
  brand: 'from-[#3B82F6] to-[#1D4ED8]',
  success: 'from-[#22C55E] to-[#15803D]',
  warning: 'from-[#FBBF24] to-[#D97706]',
  info: 'from-[#22D3EE] to-[#0E7490]',
  danger: 'from-[#F87171] to-[#B91C1C]',
  violet: 'from-[#A78BFA] to-[#6D28D9]',
  neutral: 'from-[#94A3B8] to-[#475569]',
};
</script>

<template>
  <span
    :class="[
      'relative inline-flex shrink-0 items-center justify-center overflow-hidden ring-1 ring-inset',
      solid ? `bg-gradient-to-br text-white shadow-sm ring-white/20 ${solidTones[tone]}` : soft[tone],
    ]"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.28)}px` }"
  >
    <span v-if="solid" class="absolute inset-x-0 top-0 h-1/2 bg-white/15" aria-hidden="true" />
    <component :is="icon" :size="Math.round(size * 0.47)" class="relative" aria-hidden="true" />
  </span>
</template>
