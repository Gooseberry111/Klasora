<script setup lang="ts">
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

const page = defineModel<number>({ required: true });
const props = defineProps<{ total: number; pageSize: number; noun?: string }>();

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const from = computed(() => (props.total === 0 ? 0 : (page.value - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.total, page.value * props.pageSize));
</script>

<template>
  <nav class="flex flex-col items-center justify-between gap-3 border-t border-line px-5 py-3 sm:flex-row" aria-label="Pages">
    <p class="text-[13px] text-ink-muted">
      Showing <span class="font-medium text-ink tabular-nums">{{ from }}</span> to
      <span class="font-medium text-ink tabular-nums">{{ to }}</span> of
      <span class="font-medium text-ink tabular-nums">{{ total }}</span> {{ noun ?? 'results' }}
    </p>
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-lg border border-line text-ink-muted hover:bg-surface-muted disabled:opacity-40"
        :disabled="page <= 1"
        aria-label="Previous page"
        @click="page -= 1"
      >
        <ChevronLeft :size="16" aria-hidden="true" />
      </button>
      <span class="px-2 text-[13px] text-ink-muted tabular-nums">Page {{ page }} of {{ pages }}</span>
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-lg border border-line text-ink-muted hover:bg-surface-muted disabled:opacity-40"
        :disabled="page >= pages"
        aria-label="Next page"
        @click="page += 1"
      >
        <ChevronRight :size="16" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>
