<script setup lang="ts">
import type { Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { ArrowUpRight } from 'lucide-vue-next';
import KSkeleton from './KSkeleton.vue';
import KIconTile from './KIconTile.vue';

defineProps<{
  label: string;
  value?: string | number | null;
  detail?: string;
  icon: Component;
  tone?: 'brand' | 'success' | 'warning' | 'info' | 'violet';
  loading?: boolean;
  to?: RouteLocationRaw;
}>();

const glow: Record<string, string> = {
  brand: 'bg-[#3B82F6]',
  success: 'bg-[#22C55E]',
  warning: 'bg-[#F59E0B]',
  info: 'bg-[#06B6D4]',
  violet: 'bg-[#8B5CF6]',
};
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to"
    :class="[
      'group relative block overflow-hidden rounded-card border border-line bg-surface p-5 shadow-card',
      to
        ? 'transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-hover'
        : '',
    ]"
  >
    <!-- A soft colour wash in the corner gives each figure its own identity. -->
    <span
      :class="[
        'pointer-events-none absolute -top-12 -right-12 size-36 rounded-full opacity-[0.12] blur-2xl',
        glow[tone ?? 'brand'],
      ]"
      aria-hidden="true"
    />
    <div class="relative flex items-start justify-between gap-3">
      <KIconTile :icon="icon" :tone="tone ?? 'brand'" solid :size="42" />
      <ArrowUpRight
        v-if="to"
        :size="18"
        class="text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand-ink"
        aria-hidden="true"
      />
    </div>
    <p class="relative mt-4 text-[13px] font-medium text-ink-muted">{{ label }}</p>
    <template v-if="loading">
      <KSkeleton line-class="mt-2 h-7 w-20" />
      <KSkeleton line-class="mt-3 h-3 w-32" />
    </template>
    <template v-else>
      <p class="relative mt-0.5 text-[30px] leading-9 font-semibold tracking-tight text-ink tabular-nums">
        {{ value ?? 'None' }}
      </p>
      <p v-if="detail" class="relative mt-1 truncate text-[12.5px] text-ink-muted">{{ detail }}</p>
    </template>
  </component>
</template>
