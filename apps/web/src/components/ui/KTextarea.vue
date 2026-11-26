<script setup lang="ts">
import { computed, useId } from 'vue';
import KField from './KField.vue';

const model = defineModel<string>({ default: '' });

const props = withDefaults(
  defineProps<{
    label?: string;
    placeholder?: string;
    hint?: string;
    error?: string;
    required?: boolean;
    optional?: boolean;
    rows?: number;
    maxlength?: number;
    id?: string;
  }>(),
  { rows: 3 },
);

const generatedId = useId();
const areaId = computed(() => props.id ?? generatedId);
</script>

<template>
  <KField :id="areaId" :label="label" :hint="hint" :error="error" :required="required" :optional="optional">
    <textarea
      :id="areaId"
      v-model="model"
      :rows="rows"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? `${areaId}-error` : hint ? `${areaId}-hint` : undefined"
      :class="[
        'w-full resize-y rounded-control border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle outline-none',
        'transition-[border-color,box-shadow] duration-150 focus:border-brand focus:ring-4 focus:ring-focus',
        error ? 'border-danger' : 'border-line-strong',
      ]"
    />
  </KField>
</template>
