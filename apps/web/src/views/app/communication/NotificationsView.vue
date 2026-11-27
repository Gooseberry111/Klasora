<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Bell, BellOff, CheckCheck, Settings2, Smartphone, Trash2 } from 'lucide-vue-next';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  defaultChannels,
  relativeTime,
  type AppNotification,
  type NotificationKind,
  type NotificationPreference,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KCard from '@/components/ui/KCard.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KTabs from '@/components/ui/KTabs.vue';
import { supabase } from '@/lib/supabase';
import { listNotifications, listPreferences, markNotificationsRead, savePreference, setPushPreviews } from '@/services/communication';
import { useSchool } from '@/composables/useSchool';
import { useAuthStore } from '@/stores/auth';
import { useInboxStore } from '@/stores/inbox';

const router = useRouter();
const auth = useAuthStore();
const inbox = useInboxStore();
const { attempt } = useSchool();

const tab = ref('all');
const tabs = computed(() => [
  { key: 'all', label: 'All', icon: Bell },
  { key: 'unread', label: 'Unread', icon: BellOff, count: inbox.unreadNotifications || undefined },
  { key: 'settings', label: 'Settings', icon: Settings2 },
]);

const items = ref<AppNotification[]>([]);
const loading = ref(true);
async function load() {
  if (tab.value === 'settings') return void loadSettings();
  loading.value = true;
  items.value = await listNotifications(200, tab.value === 'unread').catch(() => []);
  loading.value = false;
}
watch(tab, load, { immediate: true });

const groups = computed(() => {
  const map = new Map<string, AppNotification[]>();
  for (const n of items.value) {
    const d = new Date(n.visible_at);
    const today = new Date();
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    const key = d.toDateString() === today.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });
    map.set(key, [...(map.get(key) ?? []), n]);
  }
  return [...map.entries()];
});

async function open(n: AppNotification) {
  if (!n.read_at) {
    await markNotificationsRead([n.id]).catch(() => undefined);
    n.read_at = new Date().toISOString();
    void inbox.refresh();
  }
  if (n.link) await router.push(n.link);
}

async function markAll() {
  await attempt(() => markNotificationsRead(), 'All notifications marked as read.');
  await inbox.refresh();
  await load();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const prefs = ref<NotificationPreference[]>([]);
const devices = ref<{ id: string; platform: string; device_name: string | null; last_active_at: string }[]>([]);
const previews = ref(false);

async function loadSettings() {
  loading.value = true;
  prefs.value = await listPreferences().catch(() => []);
  const { data } = await supabase.from('user_devices').select('id, platform, device_name, last_active_at').order('last_active_at', { ascending: false });
  devices.value = (data ?? []) as typeof devices.value;
  previews.value = Boolean(auth.profile?.push_previews);
  loading.value = false;
}

function channel(kind: NotificationKind) {
  const p = prefs.value.find((x) => x.kind === kind);
  const d = defaultChannels(kind);
  return { push: p ? p.push_enabled : d.push, email: p ? p.email_enabled : d.email };
}

async function set(kind: NotificationKind, which: 'push' | 'email', value: boolean) {
  const current = channel(kind);
  const next = { ...current, [which]: value };
  const ok = await attempt(async () => {
    await savePreference(auth.user!.id, kind, next.push, next.email);
    return true;
  });
  if (ok) {
    prefs.value = [...prefs.value.filter((p) => p.kind !== kind), { user_id: auth.user!.id, kind, push_enabled: next.push, email_enabled: next.email }];
  }
}

async function togglePreviews(on: boolean) {
  const ok = await attempt(async () => {
    await setPushPreviews(auth.user!.id, on);
    return true;
  }, on ? 'Details will show on your lock screen.' : 'Details are hidden on your lock screen.');
  if (ok) {
    previews.value = on;
    await auth.loadProfile();
  }
}

async function removeDevice(id: string) {
  await attempt(async () => {
    const { error } = await supabase.from('user_devices').delete().eq('id', id);
    if (error) throw error;
  }, 'Device removed. It will stop receiving notifications.');
  await loadSettings();
}
</script>

<template>
  <div class="mx-auto max-w-[900px]">
    <KPageHeader :icon="Bell" eyebrow="Communication" title="Notifications" description="Everything that needed your attention, and how you would like to hear about it.">
      <template #actions>
        <KButton v-if="tab !== 'settings' && inbox.unreadNotifications" variant="secondary" :icon="CheckCheck" @click="markAll">Mark all as read</KButton>
      </template>
    </KPageHeader>

    <KTabs v-model="tab" :tabs="tabs" label="Notifications" class="mb-5" />

    <KSkeleton v-if="loading" :lines="8" />

    <template v-else-if="tab !== 'settings'">
      <div v-if="!items.length" class="rounded-card border border-line bg-surface shadow-card">
        <KEmptyState :icon="Bell" :title="tab === 'unread' ? 'Nothing unread' : 'No notifications yet'" description="Absences, new assignments, results, messages and announcements will appear here." />
      </div>
      <div v-else class="space-y-6">
        <section v-for="[day, list] in groups" :key="day">
          <h2 class="mb-2 text-[12.5px] font-semibold tracking-wide text-ink-muted uppercase">{{ day }}</h2>
          <ul class="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <li v-for="n in list" :key="n.id">
              <button type="button" :class="['flex w-full gap-3 px-5 py-3.5 text-left hover:bg-surface-muted/60', n.read_at ? '' : 'bg-brand-soft/40']" @click="open(n)">
                <span :class="['mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand']" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="flex items-start justify-between gap-3">
                    <span :class="['text-[14px]', n.read_at ? '' : 'font-semibold']">{{ n.title }}</span>
                    <span class="shrink-0 text-[12px] text-ink-subtle">{{ relativeTime(n.visible_at) }}</span>
                  </span>
                  <span v-if="n.body" class="mt-0.5 block text-[13px] text-ink-muted">{{ n.body }}</span>
                  <span class="mt-1 block text-[11.5px] font-medium text-ink-subtle">{{ NOTIFICATION_KIND_LABELS[n.kind].label }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </template>

    <div v-else class="space-y-6">
      <KCard title="How you hear about things" description="Notifications always appear here in Klasora. Choose where else they reach you." :icon="Settings2" :padded="false">
        <div class="overflow-x-auto">
          <table class="k-table">
            <thead>
              <tr>
                <th scope="col">Notification</th>
                <th scope="col" class="text-center">Phone</th>
                <th scope="col" class="text-center">Email</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="kind in NOTIFICATION_KINDS" :key="kind">
                <td>
                  <p class="font-medium">{{ NOTIFICATION_KIND_LABELS[kind].label }}</p>
                  <p class="text-[12.5px] text-ink-muted">{{ NOTIFICATION_KIND_LABELS[kind].description }}</p>
                </td>
                <td class="text-center">
                  <div class="flex justify-center">
                    <KCheckbox :model-value="channel(kind).push" :aria-label="`${NOTIFICATION_KIND_LABELS[kind].label} on your phone`" @update:model-value="set(kind, 'push', $event)" />
                  </div>
                </td>
                <td class="text-center">
                  <div class="flex justify-center">
                    <KCheckbox :model-value="channel(kind).email" :aria-label="`${NOTIFICATION_KIND_LABELS[kind].label} by email`" @update:model-value="set(kind, 'email', $event)" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </KCard>

      <KCard title="Privacy on your lock screen" :icon="BellOff" tone="violet">
        <KCheckbox
          :model-value="previews"
          label="Show details of messages, absences and results"
          description="When off, your phone only says you have a new update, so nothing private shows on the lock screen."
          @update:model-value="togglePreviews"
        />
      </KCard>

      <KCard title="Your devices" description="Phones signed in to the Klasora app receive push notifications." :icon="Smartphone" tone="info" :padded="false">
        <p v-if="!devices.length" class="px-5 py-4 text-[13.5px] text-ink-muted">No phones yet. Sign in to the Klasora mobile app to get push notifications.</p>
        <ul v-else class="divide-y divide-line">
          <li v-for="d in devices" :key="d.id" class="flex items-center gap-3 px-5 py-3">
            <Smartphone :size="18" class="text-ink-subtle" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <p class="font-medium">{{ d.device_name || (d.platform === 'ios' ? 'iPhone' : 'Android phone') }}</p>
              <p class="text-[12.5px] text-ink-muted">Last used {{ relativeTime(d.last_active_at) }}</p>
            </div>
            <KButton size="sm" variant="ghost" :icon="Trash2" class="text-danger-ink hover:bg-danger-soft" @click="removeDevice(d.id)">Remove</KButton>
          </li>
        </ul>
      </KCard>
    </div>
  </div>
</template>
