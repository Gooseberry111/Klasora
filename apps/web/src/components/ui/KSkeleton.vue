<script setup lang="ts">
withDefaults(defineProps<{ lines?: number; lineClass?: string }>(), { lines: 1, lineClass: 'h-3.5' });
</script>

<template>
  <div class="flex flex-col gap-2" aria-hidden="true">
    <div
      v-for="n in lines"
      :key="n"
      :class="['animate-pulse rounded-md bg-surface-muted', lineClass, n === lines && lines > 1 ? 'w-3/5' : 'w-full']"
    />
  </div>
</template>
