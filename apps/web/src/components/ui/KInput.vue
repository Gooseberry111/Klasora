<script setup lang="ts">
import { computed, ref, useId, type Component } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import KField from './KField.vue';

// Extra attributes (autofocus, data-*, aria-*) belong on the <input>, not the wrapper.
defineOptions({ inheritAttrs: false });

const model = defineModel<string>({ default: '' });

const props = withDefaults(
  defineProps<{
    label?: string;
    type?: 'text' | 'email' | 'password' | 'tel' | 'url' | 'search' | 'date';
    placeholder?: string;
    hint?: string;
    error?: string;
    required?: boolean;
    optional?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    autocomplete?: string;
    inputmode?: 'text' | 'email' | 'tel' | 'url' | 'numeric' | 'search';
    maxlength?: number;
    icon?: Component;
    id?: string;
  }>(),
  { type: 'text' },
);

const generatedId = useId();
const inputId = computed(() => props.id ?? generatedId);
const revealed = ref(false);
const actualType = computed(() => (props.type === 'password' && revealed.value ? 'text' : props.type));
const describedBy = computed(() =>
  props.error ? `${inputId.value}-error` : props.hint ? `${inputId.value}-hint` : undefined,
);
</script>

<template>
  <KField :id="inputId" :label="label" :hint="hint" :error="error" :required="required" :optional="optional">
    <div class="relative">
      <component
        :is="icon"
        v-if="icon"
        :size="16"
        class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
        aria-hidden="true"
      />
      <input
        v-bind="$attrs"
        :id="inputId"
        v-model="model"
        :type="actualType"
        :placeholder="placeholder"
        :required="required"
        :disabled="disabled"
        :readonly="readonly"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :maxlength="maxlength"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="[
          'h-10 w-full rounded-control border bg-surface text-sm text-ink placeholder:text-ink-subtle',
          'transition-[border-color,box-shadow] duration-150 outline-none',
          'focus:border-brand focus:ring-4 focus:ring-focus',
          'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted',
          'read-only:bg-surface-muted',
          error ? 'border-danger focus:border-danger' : 'border-line-strong',
          icon ? 'pl-9' : 'pl-3',
          type === 'password' ? 'pr-10' : 'pr-3',
        ]"
      />
      <button
        v-if="type === 'password'"
        type="button"
        class="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        :aria-label="revealed ? 'Hide password' : 'Show password'"
        :aria-pressed="revealed"
        @click="revealed = !revealed"
      >
        <EyeOff v-if="revealed" :size="16" aria-hidden="true" />
        <Eye v-else :size="16" aria-hidden="true" />
      </button>
    </div>
  </KField>
</template>
