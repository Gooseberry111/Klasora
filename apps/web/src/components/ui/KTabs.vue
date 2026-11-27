<script setup lang="ts">
import type { Component } from 'vue';

export interface TabItem {
  key: string;
  label: string;
  icon?: Component;
  count?: number;
}

const model = defineModel<string>({ required: true });
defineProps<{ tabs: TabItem[]; label: string }>();

function onKeydown(event: KeyboardEvent, tabs: TabItem[], index: number) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  event.preventDefault();
  const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
  model.value = next.key;
  (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)?.focus();
}
</script>

<template>
  <div class="overflow-x-auto border-b border-line" role="tablist" :aria-label="label">
    <div class="flex min-w-max gap-1">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :data-tab="tab.key"
        :aria-selected="model === tab.key"
        :tabindex="model === tab.key ? 0 : -1"
        :class="[
          'relative flex items-center gap-2 px-3.5 pt-2 pb-3 text-[13.5px] font-medium whitespace-nowrap transition-colors',
          model === tab.key ? 'text-brand-ink' : 'text-ink-muted hover:text-ink',
        ]"
        @click="model = tab.key"
        @keydown="onKeydown($event, tabs, index)"
      >
        <component :is="tab.icon" v-if="tab.icon" :size="16" aria-hidden="true" />
        {{ tab.label }}
        <span v-if="tab.count !== undefined" class="rounded-full bg-surface-muted px-1.5 text-[11.5px] text-ink-muted tabular-nums">{{ tab.count }}</span>
        <span v-if="model === tab.key" class="k-bg-brand absolute inset-x-2 -bottom-px h-[3px] rounded-t-full" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
