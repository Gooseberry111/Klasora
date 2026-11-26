<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{ tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string }>(),
  { tone: 'info' },
);

const config = computed(
  () =>
    ({
      info: { icon: Info, classes: 'bg-info-soft border-info/25 text-info-ink' },
      success: { icon: CheckCircle2, classes: 'bg-success-soft border-success/25 text-success-ink' },
      warning: { icon: AlertTriangle, classes: 'bg-warning-soft border-warning/30 text-warning-ink' },
      danger: { icon: XCircle, classes: 'bg-danger-soft border-danger/25 text-danger-ink' },
    })[props.tone],
);
</script>

<template>
  <div
    :class="['flex gap-3 rounded-control border px-3.5 py-3 text-[13.5px]', config.classes]"
    :role="tone === 'danger' ? 'alert' : 'status'"
  >
    <component :is="config.icon" :size="18" class="mt-px shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <p v-if="title" class="font-semibold">{{ title }}</p>
      <div :class="title ? 'mt-0.5 opacity-90' : ''"><slot /></div>
    </div>
    <slot name="action" />
  </div>
</template>
