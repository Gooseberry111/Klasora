<script setup lang="ts">
import { computed, nextTick, watch } from 'vue';
import { Compass, ListChecks, Sparkles, UsersRound } from 'lucide-vue-next';
import KButton from '@/components/ui/KButton.vue';
import KLogo from '@/components/ui/KLogo.vue';

const open = defineModel<boolean>('open', { default: false });

const props = defineProps<{ firstName: string; schoolName: string; isAdmin: boolean }>();
const emit = defineEmits<{ start: []; skip: [] }>();

// Move keyboard focus into the dialog when it opens.
watch(
  open,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    document.getElementById('k-welcome-start')?.focus();
  },
  { immediate: true },
);

const points = computed(() =>
  props.isAdmin
    ? [
        { icon: ListChecks, title: 'Set up your school', text: 'A short checklist takes you from a new workspace to a ready school.' },
        { icon: UsersRound, title: 'Bring in your team', text: 'Invite teachers, administrators and your bursar with the right access.' },
        { icon: Compass, title: 'Find your way around', text: 'A two minute tour shows you where everything lives.' },
      ]
    : [
        { icon: Compass, title: 'Find your way around', text: 'A two minute tour shows you where everything lives.' },
        { icon: ListChecks, title: 'See what matters today', text: 'Your dashboard brings the important things to the top.' },
        { icon: UsersRound, title: 'Stay connected', text: 'Work with your colleagues, students and parents in one place.' },
      ],
);
</script>

<template>
  <Teleport to="body">
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" leave-active-class="transition duration-150" leave-to-class="opacity-0">
      <div v-if="open" class="fixed inset-0 z-[55] flex items-center justify-center bg-[#08101C]/60 p-4 backdrop-blur-sm" @keydown.esc="emit('skip')">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="k-welcome-title"
          class="k-fade-up w-full max-w-[560px] overflow-hidden rounded-[20px] border border-line bg-surface shadow-pop"
        >
          <div class="k-bg-hero relative overflow-hidden px-8 pt-8 pb-10 text-white">
            <div class="k-dots-light pointer-events-none absolute inset-0" aria-hidden="true" />
            <div class="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-[#3B82F6]/30 blur-3xl" aria-hidden="true" />
            <div class="relative flex items-center justify-between">
              <KLogo :size="30" inverted />
              <span class="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium ring-1 ring-white/15">
                <Sparkles :size="13" aria-hidden="true" /> Welcome
              </span>
            </div>
            <h2 id="k-welcome-title" class="relative mt-8 text-[26px] leading-tight font-semibold tracking-tight">
              Welcome to Klasora, {{ firstName }}.
            </h2>
            <p class="relative mt-2 text-[14.5px] text-[#C7D2E3]">
              {{ schoolName }} now has its own secure workspace. Here is how to get started.
            </p>
          </div>

          <ul class="space-y-4 px-8 py-7">
            <li v-for="point in points" :key="point.title" class="flex gap-4">
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                <component :is="point.icon" :size="19" aria-hidden="true" />
              </span>
              <div>
                <p class="text-[14.5px] font-semibold text-ink">{{ point.title }}</p>
                <p class="mt-0.5 text-[13.5px] text-ink-muted">{{ point.text }}</p>
              </div>
            </li>
          </ul>

          <div class="flex flex-col-reverse gap-2 border-t border-line bg-surface-muted/50 px-8 py-5 sm:flex-row sm:justify-end">
            <KButton variant="ghost" @click="emit('skip')">I'll explore on my own</KButton>
            <KButton id="k-welcome-start" :icon="Compass" @click="emit('start')">Show me around</KButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
