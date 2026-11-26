<script setup lang="ts">
import { Bell, BookOpenCheck, ShieldCheck, Users } from 'lucide-vue-next';
import KLogo from '@/components/ui/KLogo.vue';

withDefaults(defineProps<{ wide?: boolean }>(), { wide: false });

const highlights = [
  { icon: Users, title: 'Your whole school community', text: 'Administrators, teachers, parents and students in one place.' },
  { icon: BookOpenCheck, title: 'Academics without paperwork', text: 'Attendance, assignments, results and report cards.' },
  { icon: Bell, title: 'Everyone stays informed', text: 'Announcements and updates that reach the right people.' },
  { icon: ShieldCheck, title: 'Private by design', text: "Each school's records are isolated and access is permission-based." },
];
</script>

<template>
  <div class="flex min-h-dvh bg-canvas">
    <aside
      class="relative hidden w-[440px] shrink-0 flex-col justify-between overflow-hidden bg-navy px-10 py-10 text-white xl:flex xl:w-[480px]"
    >
      <!-- Subtle network motif echoing the logo. -->
      <svg class="pointer-events-none absolute -right-24 -bottom-24 opacity-[0.07]" width="420" height="420" viewBox="0 0 420 420" fill="none" aria-hidden="true">
        <g stroke="#93C5FD" stroke-width="1.5">
          <path d="M40 300 L160 200 L300 260 L380 120" />
          <path d="M160 200 L210 60 L380 120" />
          <path d="M40 300 L120 390 L300 260" />
        </g>
        <g fill="#93C5FD">
          <circle cx="40" cy="300" r="7" /><circle cx="160" cy="200" r="9" /><circle cx="300" cy="260" r="7" />
          <circle cx="380" cy="120" r="7" /><circle cx="210" cy="60" r="6" /><circle cx="120" cy="390" r="6" />
        </g>
      </svg>

      <RouterLink to="/" class="relative w-fit rounded-md">
        <KLogo :size="36" inverted />
      </RouterLink>

      <div class="relative">
        <p class="text-[13px] font-medium tracking-wide text-[#93C5FD] uppercase">Education, connected.</p>
        <h1 class="mt-3 text-[30px] leading-[1.2] font-semibold tracking-tight">
          Everything your school needs. One connected platform.
        </h1>
        <ul class="mt-9 space-y-5">
          <li v-for="item in highlights" :key="item.title" class="flex gap-3.5">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/8 ring-1 ring-white/10">
              <component :is="item.icon" :size="18" class="text-[#93C5FD]" aria-hidden="true" />
            </span>
            <div>
              <p class="text-[14.5px] font-medium">{{ item.title }}</p>
              <p class="mt-0.5 text-[13.5px] text-navy-ink/80">{{ item.text }}</p>
            </div>
          </li>
        </ul>
      </div>

      <p class="relative text-[12.5px] text-navy-muted">© {{ new Date().getFullYear() }} Klasora</p>
    </aside>

    <main class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center justify-between px-5 py-5 sm:px-8 xl:hidden">
        <RouterLink to="/" class="rounded-md"><KLogo :size="30" /></RouterLink>
      </div>
      <div class="flex flex-1 items-start justify-center px-5 pt-4 pb-12 sm:px-8 sm:pt-10 xl:items-center xl:pt-12">
        <div :class="['w-full', wide ? 'max-w-[680px]' : 'max-w-[420px]']">
          <slot />
        </div>
      </div>
    </main>
  </div>
</template>
