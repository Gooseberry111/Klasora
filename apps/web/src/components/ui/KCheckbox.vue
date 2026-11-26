<script setup lang="ts">
import { computed, useId } from 'vue';
import { Check, Minus } from 'lucide-vue-next';

const model = defineModel<boolean>({ default: false });

const props = defineProps<{
  label?: string;
  description?: string;
  disabled?: boolean;
  indeterminate?: boolean;
  /** Accessible name when no visible label is shown (e.g. in a matrix). */
  ariaLabel?: string;
  id?: string;
}>();

const generatedId = useId();
const boxId = computed(() => props.id ?? generatedId);
</script>

<template>
  <label
    :for="boxId"
    :class="['inline-flex items-start gap-2.5', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer']"
  >
    <span class="relative mt-px flex size-[18px] shrink-0 items-center justify-center">
      <input
        :id="boxId"
        v-model="model"
        type="checkbox"
        class="peer absolute inset-0 m-0 cursor-[inherit] appearance-none rounded-[5px] border border-line-strong bg-surface transition-colors checked:border-brand checked:bg-brand focus-visible:ring-4 focus-visible:ring-focus focus-visible:outline-none"
        :class="indeterminate && !model ? 'border-brand bg-brand' : ''"
        :disabled="disabled"
        :aria-label="label ? undefined : ariaLabel"
        :aria-checked="indeterminate && !model ? 'mixed' : undefined"
      />
      <Check v-if="model" :size="13" :stroke-width="3" class="pointer-events-none relative text-white" aria-hidden="true" />
      <Minus v-else-if="indeterminate" :size="13" :stroke-width="3" class="pointer-events-none relative text-white" aria-hidden="true" />
    </span>
    <span v-if="label || description" class="flex flex-col">
      <span v-if="label" class="text-sm text-ink">{{ label }}</span>
      <span v-if="description" class="k-help">{{ description }}</span>
    </span>
  </label>
</template>
