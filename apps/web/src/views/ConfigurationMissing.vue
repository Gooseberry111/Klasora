<script setup lang="ts">
import { Settings2 } from 'lucide-vue-next';
import KLogo from '@/components/ui/KLogo.vue';
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-canvas p-6">
    <div class="w-full max-w-lg rounded-panel border border-line bg-surface p-8 shadow-card">
      <KLogo :size="32" />
      <div class="mt-8 flex size-11 items-center justify-center rounded-xl bg-warning-soft text-warning-ink">
        <Settings2 :size="20" aria-hidden="true" />
      </div>
      <h1 class="mt-4 text-xl font-semibold">Connect Klasora to Supabase</h1>
      <p class="mt-2 text-[14px] text-ink-muted">
        The web app needs your Supabase project's URL and public anon key before it can start.
      </p>
      <ol class="mt-5 list-decimal space-y-2 pl-5 text-[13.5px] text-ink">
        <li>Copy <code class="rounded bg-surface-muted px-1.5 py-0.5 text-[12.5px]">apps/web/.env.example</code> to <code class="rounded bg-surface-muted px-1.5 py-0.5 text-[12.5px]">apps/web/.env.local</code>.</li>
        <li>Fill in <code class="rounded bg-surface-muted px-1.5 py-0.5 text-[12.5px]">VITE_SUPABASE_URL</code> and <code class="rounded bg-surface-muted px-1.5 py-0.5 text-[12.5px]">VITE_SUPABASE_ANON_KEY</code>.</li>
        <li>Restart <code class="rounded bg-surface-muted px-1.5 py-0.5 text-[12.5px]">npm run dev:web</code>.</li>
      </ol>
      <p class="mt-5 text-[12.5px] text-ink-muted">Never use the service-role key in the web app.</p>
    </div>
  </div>
</template>
