<script setup lang="ts">
/** A large, selectable radio option (academic structure, plan, theme). */
import type { Component } from 'vue';
import { Check } from 'lucide-vue-next';

defineProps<{
  name: string;
  value: string;
  selected: boolean;
  title: string;
  description?: string;
  icon?: Component;
  disabled?: boolean;
}>();

defineEmits<{ select: [value: string] }>();
</script>

<template>
  <label
    :class="[
      'relative flex gap-3 rounded-card border p-4 transition-[border-color,box-shadow,background-color] duration-150',
      'has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-focus',
      disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
      selected ? 'border-brand bg-brand-soft/60 shadow-[0_0_0_1px_var(--k-brand)]' : 'border-line bg-surface hover:border-line-strong',
    ]"
  >
    <input
      type="radio"
      class="sr-only"
      :name="name"
      :value="value"
      :checked="selected"
      :disabled="disabled"
      @change="$emit('select', value)"
    />
    <div
      v-if="icon"
      :class="[
        'flex size-10 shrink-0 items-center justify-center rounded-lg',
        selected ? 'bg-brand text-white' : 'bg-surface-muted text-ink-muted',
      ]"
    >
      <component :is="icon" :size="19" aria-hidden="true" />
    </div>
    <div class="min-w-0 flex-1 pr-6">
      <p class="text-[14.5px] font-semibold text-ink">{{ title }}</p>
      <p v-if="description" class="mt-0.5 text-[13px] text-ink-muted">{{ description }}</p>
      <slot />
    </div>
    <span
      :class="[
        'absolute top-4 right-4 flex size-5 items-center justify-center rounded-full border',
        selected ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface',
      ]"
      aria-hidden="true"
    >
      <Check v-if="selected" :size="12" :stroke-width="3" />
    </span>
  </label>
</template>
