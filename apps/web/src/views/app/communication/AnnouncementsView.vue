<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { CalendarClock, ChevronRight, Inbox, Megaphone, Paperclip, PenLine, Plus, Users } from 'lucide-vue-next';
import { ANNOUNCEMENT_AUDIENCE_LABELS, ANNOUNCEMENT_STATUS_LABELS, relativeTime, type Announcement } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KTabs from '@/components/ui/KTabs.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import AnnouncementComposer from '@/components/communication/AnnouncementComposer.vue';
import { listAnnouncements, unreadAnnouncementIds } from '@/services/communication';
import { useSchool } from '@/composables/useSchool';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const { schoolId, slug, can } = useSchool();
const canWrite = computed(() => can('communication.create'));
const isApprover = computed(() => can('communication.approve'));

const announcements = ref<Announcement[]>([]);
const unread = ref<Set<string>>(new Set());
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    [announcements.value, unread.value] = await Promise.all([listAnnouncements(schoolId.value), unreadAnnouncementIds(schoolId.value)]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(schoolId, load, { immediate: true });

const now = () => new Date();
const isLive = (a: Announcement) =>
  a.status === 'published' && new Date(a.publish_at ?? a.published_at ?? a.created_at) <= now() && (!a.expires_at || new Date(a.expires_at) > now());
const live = computed(() => announcements.value.filter(isLive).sort((a, b) => (b.publish_at ?? b.published_at ?? '').localeCompare(a.publish_at ?? a.published_at ?? '')));
const scheduled = computed(() => announcements.value.filter((a) => a.status === 'published' && !isLive(a) && (!a.expires_at || new Date(a.expires_at) > now())));
const pending = computed(() => announcements.value.filter((a) => a.status === 'pending'));
const drafts = computed(() => announcements.value.filter((a) => a.status === 'draft' && a.author_id === auth.user?.id));
const past = computed(() => announcements.value.filter((a) => a.status === 'archived' || (a.status === 'published' && a.expires_at && new Date(a.expires_at) <= now())));

const tab = ref('live');
const tabs = computed(() => [
  { key: 'live', label: 'Announcements', icon: Megaphone, count: live.value.length },
  ...(canWrite.value || isApprover.value ? [{ key: 'mine', label: 'Drafts and scheduled', icon: PenLine, count: drafts.value.length + scheduled.value.length }] : []),
  ...(isApprover.value || pending.value.length ? [{ key: 'pending', label: 'Waiting for approval', icon: Inbox, count: pending.value.length }] : []),
  ...(past.value.length ? [{ key: 'past', label: 'Past', icon: CalendarClock }] : []),
]);
const shown = computed(() => ({ live: live.value, mine: [...drafts.value, ...scheduled.value], pending: pending.value, past: past.value })[tab.value as 'live'] ?? []);

const composerOpen = ref(false);
function audienceLabel(a: Announcement) {
  return ANNOUNCEMENT_AUDIENCE_LABELS[a.audience].label;
}
</script>

<template>
  <div>
    <KPageHeader :icon="Megaphone" eyebrow="Communication" title="Announcements" description="School news and notices, sent to exactly the right people.">
      <template #actions>
        <KButton v-if="canWrite" :icon="Plus" @click="composerOpen = true">New announcement</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="error" tone="danger" class="mb-5">{{ error }}</KAlert>
    <KTabs v-if="tabs.length > 1" v-model="tab" :tabs="tabs" label="Announcements" class="mb-5" />

    <KSkeleton v-if="loading" :lines="6" />
    <div v-else-if="!shown.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState
        :icon="Megaphone"
        :title="tab === 'live' ? 'No announcements right now' : tab === 'pending' ? 'Nothing waiting for approval' : 'Nothing here yet'"
        :description="tab === 'live' ? 'School announcements meant for you appear here.' : undefined"
      >
        <KButton v-if="canWrite && tab !== 'pending'" :icon="Plus" @click="composerOpen = true">New announcement</KButton>
      </KEmptyState>
    </div>

    <ul v-else class="space-y-3">
      <li v-for="a in shown" :key="a.id">
        <RouterLink
          :to="{ name: 'announcement-detail', params: { slug, announcementId: a.id } }"
          :class="[
            'group flex gap-4 rounded-card border bg-surface p-5 shadow-card transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-hover',
            unread.has(a.id) ? 'border-brand/40' : 'border-line',
          ]"
        >
          <KIconTile :icon="Megaphone" :tone="unread.has(a.id) ? 'brand' : 'neutral'" :solid="unread.has(a.id)" :size="44" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p :class="['text-[15.5px] group-hover:text-brand-ink', unread.has(a.id) ? 'font-semibold' : 'font-medium']">{{ a.title }}</p>
              <KBadge v-if="unread.has(a.id)" tone="brand">New</KBadge>
              <KBadge v-if="a.status !== 'published'" :tone="a.status === 'pending' ? 'warning' : 'neutral'">{{ ANNOUNCEMENT_STATUS_LABELS[a.status] }}</KBadge>
              <KBadge v-else-if="!isLive(a) && tab === 'mine'" tone="info"><CalendarClock :size="12" aria-hidden="true" /> Scheduled</KBadge>
            </div>
            <p class="mt-1 line-clamp-2 text-[13.5px] text-ink-muted">{{ a.body }}</p>
            <p class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-subtle">
              <span>{{ a.publish_at && !isLive(a) ? `Goes out ${new Date(a.publish_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : relativeTime(a.publish_at ?? a.published_at ?? a.created_at) }}</span>
              <span v-if="a.author_id === auth.user?.id || isApprover" class="flex items-center gap-1"><Users :size="12" aria-hidden="true" /> {{ audienceLabel(a) }}<template v-if="a.recipient_count">, {{ a.recipient_count }} people</template></span>
              <span v-if="a.attachment_paths.length" class="flex items-center gap-1"><Paperclip :size="12" aria-hidden="true" /> {{ a.attachment_paths.length }}</span>
            </p>
          </div>
          <ChevronRight :size="18" class="hidden shrink-0 self-center text-ink-subtle sm:block" aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>

    <AnnouncementComposer v-model:open="composerOpen" @saved="load" />
  </div>
</template>
