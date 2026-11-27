<script setup lang="ts">
import { CheckCircle2, Globe2, ShieldCheck, Smartphone, TrendingUp, Wallet } from 'lucide-vue-next';
import KLogo from '@/components/ui/KLogo.vue';

withDefaults(defineProps<{ wide?: boolean }>(), { wide: false });

const assurances = [
  { icon: ShieldCheck, text: 'Private by design' },
  { icon: Globe2, text: 'Built for African schools' },
  { icon: Smartphone, text: 'Web and mobile' },
];

// Purely decorative preview of the product; it is hidden from assistive technology.
const bars = [72, 88, 81, 94, 90];
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
</script>

<template>
  <div class="flex min-h-dvh bg-canvas">
    <aside class="k-bg-hero relative hidden w-[500px] shrink-0 flex-col overflow-hidden px-11 py-10 text-white xl:flex 2xl:w-[560px]">
      <div class="k-dots-light pointer-events-none absolute inset-0" aria-hidden="true" />
      <div class="pointer-events-none absolute -top-32 -right-24 size-[420px] rounded-full bg-[#3B82F6]/25 blur-3xl" aria-hidden="true" />

      <RouterLink to="/" class="relative w-fit rounded-md">
        <KLogo :size="36" inverted />
      </RouterLink>

      <div class="relative mt-14">
        <p class="text-[12px] font-semibold tracking-[0.14em] text-[#93C5FD] uppercase">Education, connected.</p>
        <h1 class="mt-4 text-[34px] leading-[1.15] font-semibold tracking-tight">
          Run your whole school from one
          <span class="bg-gradient-to-r from-[#93C5FD] to-[#67E8F9] bg-clip-text text-transparent">connected</span>
          platform.
        </h1>
        <p class="mt-4 max-w-[400px] text-[15px] leading-relaxed text-[#C7D2E3]">
          Students, staff, academics, fees and parent communication, organised and secure in one place.
        </p>
      </div>

      <!-- Product preview -->
      <div class="relative mt-12 h-[330px]" aria-hidden="true">
        <div class="k-float-slow absolute top-0 left-0 w-[300px] rounded-2xl border border-white/10 bg-white/[0.07] p-5 shadow-2xl backdrop-blur-md">
          <div class="flex items-center justify-between">
            <p class="text-[12.5px] font-medium text-[#C7D2E3]">Attendance this week</p>
            <span class="flex items-center gap-1 rounded-full bg-[#22C55E]/15 px-2 py-0.5 text-[11px] font-semibold text-[#86EFAC]">
              <TrendingUp :size="12" /> 3.1%
            </span>
          </div>
          <p class="mt-1 text-[28px] font-semibold tracking-tight">94.6%</p>
          <div class="mt-4 flex items-end gap-3">
            <div v-for="(h, i) in bars" :key="i" class="flex flex-1 flex-col items-center gap-1.5">
              <div class="w-full rounded-md bg-gradient-to-t from-[#2563EB] to-[#60A5FA]" :style="{ height: `${Math.round(h * 0.72)}px` }" />
              <span class="text-[10.5px] text-[#8394AD]">{{ days[i] }}</span>
            </div>
          </div>
        </div>

        <div class="k-float absolute top-[52px] right-0 w-[220px] rounded-2xl border border-white/10 bg-[#0B1628]/85 p-4 shadow-2xl backdrop-blur-md">
          <div class="flex items-start gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#22C55E] to-[#15803D]">
              <CheckCircle2 :size="18" />
            </span>
            <div>
              <p class="text-[13px] font-semibold">Results published</p>
              <p class="mt-0.5 text-[12px] text-[#8394AD]">SS 2 Science</p>
            </div>
          </div>
        </div>

        <div class="k-float-slow absolute top-[226px] right-4 w-[260px] rounded-2xl border border-white/10 bg-[#0B1628]/85 p-4 shadow-2xl backdrop-blur-md">
          <div class="flex items-center gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#FBBF24] to-[#D97706]">
              <Wallet :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between">
                <p class="text-[13px] font-semibold">Fees collected</p>
                <p class="text-[12px] font-semibold text-[#FCD34D]">78%</p>
              </div>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div class="h-full w-[78%] rounded-full bg-gradient-to-r from-[#FBBF24] to-[#F59E0B]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex-1" />

      <ul class="relative mt-8 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/10 pt-6">
        <li v-for="item in assurances" :key="item.text" class="flex items-center gap-2 text-[13px] text-[#C7D2E3]">
          <component :is="item.icon" :size="16" class="text-[#93C5FD]" aria-hidden="true" />
          {{ item.text }}
        </li>
      </ul>
    </aside>

    <main class="k-dots relative flex min-w-0 flex-1 flex-col">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-brand-soft/70 to-transparent" aria-hidden="true" />
      <div class="relative flex items-center justify-between px-5 py-5 sm:px-8 xl:hidden">
        <RouterLink to="/" class="rounded-md"><KLogo :size="30" /></RouterLink>
      </div>
      <div class="relative flex flex-1 items-start justify-center px-4 pt-2 pb-12 sm:px-8 sm:pt-8 xl:items-center xl:pt-12">
        <div :class="['k-fade-up w-full', wide ? 'max-w-[700px]' : 'max-w-[460px]']">
          <div v-if="wide">
            <slot />
          </div>
          <div v-else class="rounded-panel border border-line bg-surface/95 p-6 shadow-hover backdrop-blur sm:p-9">
            <slot />
          </div>
          <p class="mt-6 text-center text-[12.5px] text-ink-subtle">© {{ new Date().getFullYear() }} Klasora. Education, connected.</p>
        </div>
      </div>
    </main>
  </div>
</template>
