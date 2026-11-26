<script setup lang="ts">
import type { Component } from 'vue';
import KSkeleton from './KSkeleton.vue';

defineProps<{
  label: string;
  value?: string | number | null;
  detail?: string;
  icon: Component;
  tone?: 'brand' | 'success' | 'warning' | 'info';
  loading?: boolean;
}>();

const toneClasses: Record<string, string> = {
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  info: 'bg-info-soft text-info-ink',
};
</script>

<template>
  <div class="rounded-card border border-line bg-surface p-5 shadow-card">
    <div class="flex items-start justify-between gap-3">
      <p class="text-[13px] font-medium text-ink-muted">{{ label }}</p>
      <span :class="['flex size-9 shrink-0 items-center justify-center rounded-lg', toneClasses[tone ?? 'brand']]">
        <component :is="icon" :size="18" aria-hidden="true" />
      </span>
    </div>
    <template v-if="loading">
      <KSkeleton line-class="mt-2 h-7 w-20" />
      <KSkeleton line-class="mt-3 h-3 w-32" />
    </template>
    <template v-else>
      <p class="mt-1 text-[28px] leading-9 font-semibold tracking-tight text-ink tabular-nums">{{ value ?? '—' }}</p>
      <p v-if="detail" class="mt-1.5 text-[12.5px] text-ink-muted">{{ detail }}</p>
    </template>
  </div>
</template>
