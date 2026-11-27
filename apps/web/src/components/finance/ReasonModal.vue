<script setup lang="ts">
import { ref, watch } from 'vue';
import KModal from '@/components/ui/KModal.vue';
import KButton from '@/components/ui/KButton.vue';
import KTextarea from '@/components/ui/KTextarea.vue';

/** Asks for a reason before a financial change that has to be explained later. */
const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    label?: string;
    placeholder?: string;
    confirmLabel?: string;
    tone?: 'primary' | 'danger';
    required?: boolean;
    busy?: boolean;
  }>(),
  { label: 'Reason', confirmLabel: 'Confirm', tone: 'primary', required: true },
);
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ submit: [reason: string] }>();

const reason = ref('');
const error = ref('');
watch(open, (v) => {
  if (v) {
    reason.value = '';
    error.value = '';
  }
});

function submit() {
  if (props.required && !reason.value.trim()) {
    error.value = 'Please give a reason. It is kept with the record.';
    return;
  }
  emit('submit', reason.value.trim());
}
</script>

<template>
  <KModal v-model:open="open" :title="title" :description="description" size="sm">
    <form id="reason-form" novalidate @submit.prevent="submit">
      <KTextarea v-model="reason" :label="label" :placeholder="placeholder" :rows="3" :maxlength="500" :error="error" :optional="!required" />
    </form>
    <template #footer>
      <KButton variant="secondary" @click="open = false">Cancel</KButton>
      <KButton type="submit" form="reason-form" :variant="tone === 'danger' ? 'danger' : 'primary'" :loading="busy">{{ confirmLabel }}</KButton>
    </template>
  </KModal>
</template>
