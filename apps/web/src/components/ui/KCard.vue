<script setup lang="ts">
import type { Component } from 'vue';
import KIconTile, { type IconTone } from './KIconTile.vue';

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    padded?: boolean;
    as?: string;
    icon?: Component;
    tone?: IconTone;
    /** Lifts on hover; use for cards that are links. */
    interactive?: boolean;
  }>(),
  { padded: true, as: 'section', tone: 'brand' },
);
</script>

<template>
  <component
    :is="as"
    :class="[
      'rounded-card border border-line bg-surface shadow-card',
      interactive
        ? 'transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-hover'
        : '',
    ]"
  >
    <header
      v-if="title || $slots.actions || $slots.header"
      class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"
    >
      <slot name="header">
        <div class="flex min-w-0 items-center gap-3">
          <KIconTile v-if="icon" :icon="icon" :tone="tone" :size="34" />
          <div class="min-w-0">
            <h2 class="k-card-title">{{ title }}</h2>
            <p v-if="description" class="k-help mt-0.5">{{ description }}</p>
          </div>
        </div>
      </slot>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div :class="padded ? 'p-5' : ''">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">
      <slot name="footer" />
    </footer>
  </component>
</template>
