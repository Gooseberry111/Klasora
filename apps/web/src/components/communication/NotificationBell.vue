<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { Bell, BellRing, CalendarX, CheckCheck, FileText, Megaphone, MessageCircle, NotebookPen, Trophy } from 'lucide-vue-next';
import { relativeTime, type AppNotification, type NotificationKind } from '@klasora/shared';
import { useInboxStore } from '@/stores/inbox';
import { markNotificationsRead } from '@/services/communication';

/** Header bell: unread badge and the latest notifications. */
const props = defineProps<{ slug: string }>();
const inbox = useInboxStore();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const ICONS: Record<NotificationKind, typeof Bell> = {
  announcement: Megaphone,
  message: MessageCircle,
  absence: CalendarX,
  assignment: NotebookPen,
  result: Trophy,
  report_card: FileText,
  general: BellRing,
};
const TONES: Record<NotificationKind, string> = {
  announcement: 'bg-brand-soft text-brand-ink',
  message: 'bg-[#F3F0FF] text-[#6D28D9] dark:bg-[#7C3AED]/15 dark:text-[#C4B5FD]',
  absence: 'bg-danger-soft text-danger-ink',
  assignment: 'bg-info-soft text-info-ink',
  result: 'bg-success-soft text-success-ink',
  report_card: 'bg-success-soft text-success-ink',
  general: 'bg-surface-muted text-ink-muted',
};

const badge = computed(() => (inbox.unreadNotifications > 99 ? '99+' : String(inbox.unreadNotifications)));

function onDocumentClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false;
}
document.addEventListener('click', onDocumentClick);
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));

async function go(n: AppNotification) {
  open.value = false;
  if (!n.read_at) {
    await markNotificationsRead([n.id]).catch(() => undefined);
    void inbox.refresh();
  }
  if (n.link) await router.push(n.link);
}

async function markAll() {
  await markNotificationsRead().catch(() => undefined);
  await inbox.refresh();
}
</script>

<template>
  <div ref="root" class="relative" data-tour="notification-bell">
    <button
      type="button"
      class="relative flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
      :aria-label="inbox.unreadNotifications ? `Notifications, ${inbox.unreadNotifications} unread` : 'Notifications'"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Bell :size="18" aria-hidden="true" />
      <span
        v-if="inbox.unreadNotifications"
        class="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white ring-2 ring-surface"
        aria-hidden="true"
      >
        {{ badge }}
      </span>
    </button>

    <Transition enter-active-class="transition duration-150 ease-out" enter-from-class="opacity-0 translate-y-1" leave-active-class="transition duration-100" leave-to-class="opacity-0">
      <div v-if="open" class="absolute right-0 z-40 mt-2 w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-panel border border-line bg-surface shadow-pop">
        <div class="flex items-center justify-between border-b border-line px-4 py-3">
          <p class="text-[14.5px] font-semibold">Notifications</p>
          <button v-if="inbox.unreadNotifications" type="button" class="flex items-center gap-1 text-[12.5px] font-medium text-brand-ink hover:underline" @click="markAll">
            <CheckCheck :size="14" aria-hidden="true" /> Mark all read
          </button>
        </div>
        <ul v-if="inbox.notifications.length" class="max-h-[420px] divide-y divide-line overflow-y-auto">
          <li v-for="n in inbox.notifications" :key="n.id">
            <button type="button" :class="['flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-muted/60', n.read_at ? '' : 'bg-brand-soft/40']" @click="go(n)">
              <span :class="['flex size-9 shrink-0 items-center justify-center rounded-xl', TONES[n.kind]]">
                <component :is="ICONS[n.kind]" :size="17" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-start justify-between gap-2">
                  <span :class="['text-[13.5px]', n.read_at ? 'text-ink' : 'font-semibold text-ink']">{{ n.title }}</span>
                  <span class="shrink-0 text-[11.5px] text-ink-subtle">{{ relativeTime(n.visible_at) }}</span>
                </span>
                <span v-if="n.body" class="mt-0.5 line-clamp-2 block text-[12.5px] text-ink-muted">{{ n.body }}</span>
              </span>
              <span v-if="!n.read_at" class="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />
            </button>
          </li>
        </ul>
        <div v-else class="px-6 py-10 text-center">
          <Bell :size="22" class="mx-auto text-ink-subtle" aria-hidden="true" />
          <p class="mt-2 text-[13.5px] text-ink-muted">You're all caught up.</p>
        </div>
        <RouterLink :to="{ name: 'notifications', params: { slug: props.slug } }" class="block border-t border-line px-4 py-2.5 text-center text-[13px] font-medium text-brand-ink hover:bg-surface-muted/60" @click="open = false">
          See all notifications and settings
        </RouterLink>
      </div>
    </Transition>
  </div>
</template>
