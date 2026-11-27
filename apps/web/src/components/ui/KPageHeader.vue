<script setup lang="ts">
import type { Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { ChevronRight } from 'lucide-vue-next';
import KIconTile from './KIconTile.vue';

export interface Crumb {
  label: string;
  to?: RouteLocationRaw;
}

defineProps<{
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  icon?: Component;
  eyebrow?: string;
}>();
</script>

<template>
  <div class="k-fade-up mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
    <div class="min-w-0">
      <nav v-if="breadcrumbs?.length" aria-label="Breadcrumb" class="mb-3">
        <ol class="flex flex-wrap items-center gap-1 text-[13px] text-ink-muted">
          <li v-for="(crumb, index) in breadcrumbs" :key="index" class="flex items-center gap-1">
            <RouterLink v-if="crumb.to" :to="crumb.to" class="rounded hover:text-ink">{{ crumb.label }}</RouterLink>
            <span v-else aria-current="page" class="text-ink">{{ crumb.label }}</span>
            <ChevronRight v-if="index < breadcrumbs.length - 1" :size="14" class="text-ink-subtle" aria-hidden="true" />
          </li>
        </ol>
      </nav>
      <div class="flex items-center gap-4">
        <KIconTile v-if="icon" :icon="icon" solid :size="48" class="hidden sm:inline-flex" />
        <div class="min-w-0">
          <p v-if="eyebrow" class="k-eyebrow mb-1">{{ eyebrow }}</p>
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="k-page-title">{{ title }}</h1>
            <slot name="badge" />
          </div>
          <p v-if="description" class="mt-1 max-w-2xl text-[14.5px] text-ink-muted">{{ description }}</p>
        </div>
      </div>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
