<script setup lang="ts">
withDefaults(
  defineProps<{ tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'; dot?: boolean }>(),
  { tone: 'neutral' },
);

const tones: Record<string, string> = {
  neutral: 'bg-surface-muted text-ink-muted ring-line',
  brand: 'bg-brand-soft text-brand-ink ring-brand/20',
  success: 'bg-success-soft text-success-ink ring-success/20',
  warning: 'bg-warning-soft text-warning-ink ring-warning/25',
  danger: 'bg-danger-soft text-danger-ink ring-danger/20',
  info: 'bg-info-soft text-info-ink ring-info/20',
};
const dots: Record<string, string> = {
  neutral: 'bg-ink-subtle',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] leading-5 font-medium whitespace-nowrap ring-1 ring-inset',
      tones[tone],
    ]"
  >
    <span v-if="dot" :class="['size-1.5 rounded-full', dots[tone]]" aria-hidden="true" />
    <slot />
  </span>
</template>
