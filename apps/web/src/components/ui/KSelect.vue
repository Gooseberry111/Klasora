<script setup lang="ts">
import { computed, useId } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import KField from './KField.vue';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const model = defineModel<string>({ default: '' });

const props = defineProps<{
  label?: string;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  id?: string;
}>();

const generatedId = useId();
const selectId = computed(() => props.id ?? generatedId);
</script>

<template>
  <KField :id="selectId" :label="label" :hint="hint" :error="error" :required="required" :optional="optional">
    <div class="relative">
      <select
        :id="selectId"
        v-model="model"
        :required="required"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined"
        :class="[
          'h-10 w-full appearance-none rounded-control border bg-surface pr-9 pl-3 text-sm outline-none',
          'transition-[border-color,box-shadow] duration-150 focus:border-brand focus:ring-4 focus:ring-focus',
          'disabled:cursor-not-allowed disabled:bg-surface-muted',
          model ? 'text-ink' : 'text-ink-subtle',
          error ? 'border-danger' : 'border-line-strong',
        ]"
      >
        <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
        <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled" class="text-ink">
          {{ option.label }}
        </option>
      </select>
      <ChevronDown :size="16" class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
    </div>
  </KField>
</template>
