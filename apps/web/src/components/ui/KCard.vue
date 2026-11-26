<script setup lang="ts">
withDefaults(defineProps<{ title?: string; description?: string; padded?: boolean; as?: string }>(), {
  padded: true,
  as: 'section',
});
</script>

<template>
  <component
    :is="as"
    class="rounded-card border border-line bg-surface shadow-card"
  >
    <header
      v-if="title || $slots.actions || $slots.header"
      class="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4"
    >
      <slot name="header">
        <div class="min-w-0">
          <h2 class="k-card-title">{{ title }}</h2>
          <p v-if="description" class="k-help mt-0.5">{{ description }}</p>
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
