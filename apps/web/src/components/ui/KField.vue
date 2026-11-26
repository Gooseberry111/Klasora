<script setup lang="ts">
/**
 * Label + control + hint/error wrapper shared by every form control, so all
 * fields have identical spacing and accessible descriptions.
 */
defineProps<{
  id: string;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
}>();
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div v-if="label" class="flex items-baseline justify-between gap-2">
      <label :for="id" class="k-label">
        {{ label }}
        <span v-if="required" class="text-danger" aria-hidden="true">*</span>
      </label>
      <span v-if="optional" class="text-[12px] text-ink-subtle">Optional</span>
    </div>
    <slot />
    <p v-if="error" :id="`${id}-error`" class="flex items-start gap-1 text-[12.5px] text-danger-ink" role="alert">
      {{ error }}
    </p>
    <p v-else-if="hint" :id="`${id}-hint`" class="k-help">{{ hint }}</p>
  </div>
</template>
