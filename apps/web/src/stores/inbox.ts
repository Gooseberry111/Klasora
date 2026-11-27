import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { AppNotification } from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { listNotifications, unreadAnnouncementCount, unreadMessageCount, unreadNotificationCount, watchNotifications } from '@/services/communication';

/**
 * Unread counts for the header bell and the sidebar. Kept fresh by realtime
 * notifications, with a gentle poll as a fallback.
 */
export const useInboxStore = defineStore('inbox', () => {
  const notifications = ref<AppNotification[]>([]);
  const unreadNotifications = ref(0);
  const unreadMessages = ref(0);
  const unreadAnnouncements = ref(0);
  let channel: RealtimeChannel | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let schoolId: string | null = null;

  async function refresh() {
    if (!schoolId) return;
    const [list, n, m, a] = await Promise.all([
      listNotifications(15).catch(() => notifications.value),
      unreadNotificationCount().catch(() => unreadNotifications.value),
      unreadMessageCount(schoolId).catch(() => unreadMessages.value),
      unreadAnnouncementCount(schoolId).catch(() => unreadAnnouncements.value),
    ]);
    notifications.value = list;
    unreadNotifications.value = n;
    unreadMessages.value = m;
    unreadAnnouncements.value = a;
  }

  function start(userId: string, activeSchoolId: string) {
    if (schoolId === activeSchoolId && channel) return;
    stop();
    schoolId = activeSchoolId;
    void refresh();
    channel = watchNotifications(userId, () => void refresh());
    timer = setInterval(() => void refresh(), 60_000);
  }

  function stop() {
    if (channel) void supabase.removeChannel(channel);
    if (timer) clearInterval(timer);
    channel = null;
    timer = null;
    schoolId = null;
  }

  return { notifications, unreadNotifications, unreadMessages, unreadAnnouncements, refresh, start, stop };
});
