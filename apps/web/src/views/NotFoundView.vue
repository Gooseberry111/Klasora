<script setup lang="ts">
import { Compass } from 'lucide-vue-next';
import KLogo from '@/components/ui/KLogo.vue';
import KButton from '@/components/ui/KButton.vue';
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center">
    <KLogo :size="30" />
    <div class="mt-10 flex size-12 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted">
      <Compass :size="22" aria-hidden="true" />
    </div>
    <h1 class="k-page-title mt-5">We couldn't find that page</h1>
    <p class="mt-2 max-w-md text-[14.5px] text-ink-muted">The link may be out of date, or the page may have moved.</p>
    <KButton class="mt-7" :to="{ name: 'schools' }">Go to my schools</KButton>
  </div>
</template>
