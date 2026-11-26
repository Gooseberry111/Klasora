<script setup lang="ts">
import { computed, type Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import KSpinner from './KSpinner.vue';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
    size?: 'sm' | 'md' | 'lg';
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    to?: RouteLocationRaw;
    href?: string;
    icon?: Component;
    iconRight?: Component;
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
);

const variants: Record<string, string> = {
  primary: 'bg-brand text-white shadow-sm hover:bg-brand-hover disabled:hover:bg-brand',
  secondary: 'bg-surface text-ink border border-line-strong shadow-sm hover:bg-surface-muted',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  subtle: 'bg-brand-soft text-brand-ink hover:brightness-95',
  danger: 'bg-danger text-white shadow-sm hover:brightness-95',
};

const sizes: Record<string, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
};

const classes = computed(() => [
  'inline-flex select-none items-center justify-center whitespace-nowrap rounded-control font-medium',
  'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
  'disabled:cursor-not-allowed disabled:opacity-55',
  variants[props.variant],
  sizes[props.size],
  props.block ? 'w-full' : '',
]);

const isDisabled = computed(() => props.disabled || props.loading);
const iconSize = computed(() => (props.size === 'sm' ? 15 : 17));
</script>

<template>
  <RouterLink v-if="to && !isDisabled" :to="to" :class="classes">
    <component :is="icon" v-if="icon" :size="iconSize" aria-hidden="true" />
    <slot />
    <component :is="iconRight" v-if="iconRight" :size="iconSize" aria-hidden="true" />
  </RouterLink>
  <a v-else-if="href && !isDisabled" :href="href" :class="classes">
    <component :is="icon" v-if="icon" :size="iconSize" aria-hidden="true" />
    <slot />
    <component :is="iconRight" v-if="iconRight" :size="iconSize" aria-hidden="true" />
  </a>
  <button v-else :type="type" :class="classes" :disabled="isDisabled" :aria-busy="loading || undefined">
    <KSpinner v-if="loading" :size="iconSize - 2" />
    <component :is="icon" v-else-if="icon" :size="iconSize" aria-hidden="true" />
    <slot />
    <component :is="iconRight" v-if="iconRight && !loading" :size="iconSize" aria-hidden="true" />
  </button>
</template>
