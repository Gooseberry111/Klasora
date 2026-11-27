<script setup lang="ts">
import { computed, useId } from 'vue';

const props = withDefaults(defineProps<{ value: number; size?: number; stroke?: number; light?: boolean }>(), {
  size: 72,
  stroke: 7,
});

const gradientId = useId();
const clamped = computed(() => Math.min(100, Math.max(0, Math.round(props.value))));
const radius = computed(() => (props.size - props.stroke) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const offset = computed(() => circumference.value * (1 - clamped.value / 100));
</script>

<template>
  <div
    class="relative inline-flex shrink-0 items-center justify-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="img"
    :aria-label="`${clamped} percent complete`"
  >
    <svg :width="size" :height="size" class="-rotate-90" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" :stop-color="light ? '#93C5FD' : '#60A5FA'" />
          <stop offset="100%" :stop-color="light ? '#FFFFFF' : '#2563EB'" />
        </linearGradient>
      </defs>
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke-width="stroke"
        :class="light ? 'stroke-white/15' : 'stroke-surface-muted'"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke="`url(#${gradientId})`"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        class="transition-[stroke-dashoffset] duration-700 ease-out"
      />
    </svg>
    <span :class="['absolute font-semibold tabular-nums', light ? 'text-white' : 'text-ink']" :style="{ fontSize: `${Math.round(size * 0.22)}px` }">
      {{ clamped }}%
    </span>
  </div>
</template>
