<script setup lang="ts">
/** Accessible menu button: click or keyboard to open, Escape/outside click to close. */
import { nextTick, onBeforeUnmount, ref, useId } from 'vue';

withDefaults(defineProps<{ align?: 'left' | 'right'; widthClass?: string; label: string }>(), {
  align: 'right',
  widthClass: 'w-64',
});

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuId = useId();

function items(): HTMLElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
}

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    items()[0]?.focus();
  }
}

function close() {
  open.value = false;
}

function onDocumentClick(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return;
  const list = items();
  const index = list.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'Escape') {
    close();
    (root.value?.querySelector('[aria-haspopup]') as HTMLElement | null)?.focus();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    list[(index + 1) % list.length]?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    list[(index - 1 + list.length) % list.length]?.focus();
  }
}

document.addEventListener('click', onDocumentClick);
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div ref="root" class="relative" @keydown="onKeydown">
    <slot name="trigger" :open="open" :toggle="toggle" :menu-id="menuId" :label="label" />
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="scale-95 opacity-0"
      leave-active-class="transition duration-75 ease-in"
      leave-to-class="scale-95 opacity-0"
    >
      <div
        v-if="open"
        :id="menuId"
        ref="menu"
        role="menu"
        :aria-label="label"
        :class="[
          'absolute z-40 mt-2 origin-top rounded-card border border-line bg-surface-raised p-1.5 shadow-pop',
          align === 'right' ? 'right-0' : 'left-0',
          widthClass,
        ]"
        @click="close"
      >
        <slot :close="close" />
      </div>
    </Transition>
  </div>
</template>
