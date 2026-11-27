<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, Copy, MessageCircle } from 'lucide-vue-next';
import KButton from '@/components/ui/KButton.vue';
import { useFeedbackStore } from '@/stores/feedback';

/** Shows a freshly created invitation link with copy and WhatsApp sharing. */
const props = defineProps<{ email: string; link: string; emailed: boolean; schoolName: string; purpose?: string }>();
const feedback = useFeedbackStore();
const copied = ref(false);

async function copy() {
  try {
    await navigator.clipboard.writeText(props.link);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2500);
  } catch {
    feedback.error('Copy failed. Select the link and copy it manually.');
  }
}

const whatsapp = computed(
  () => `https://wa.me/?text=${encodeURIComponent(`${props.schoolName} invites you to ${props.purpose ?? 'Klasora'}. Accept here: ${props.link}`)}`,
);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start gap-3 rounded-xl bg-success-soft p-4 text-success-ink">
      <Check :size="20" class="mt-0.5 shrink-0" aria-hidden="true" />
      <p class="text-[13.5px]">
        <template v-if="emailed">We emailed an invitation to <strong>{{ email }}</strong>.</template>
        <template v-else>The invitation for <strong>{{ email }}</strong> is ready. Share the link below; it works for 7 days.</template>
      </p>
    </div>
    <div>
      <p class="k-label mb-1.5">Invitation link</p>
      <div class="flex gap-2">
        <input :value="link" readonly class="h-10 min-w-0 flex-1 rounded-control border border-line-strong bg-surface-muted px-3 text-[13px] text-ink-muted" aria-label="Invitation link" @focus="($event.target as HTMLInputElement).select()" />
        <KButton variant="secondary" :icon="copied ? Check : Copy" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</KButton>
      </div>
      <p class="k-help mt-1.5">Only {{ email }} can accept it, after signing in or creating an account with that email.</p>
    </div>
    <KButton :href="whatsapp" target="_blank" rel="noopener" variant="secondary" :icon="MessageCircle" block>Share on WhatsApp</KButton>
  </div>
</template>
