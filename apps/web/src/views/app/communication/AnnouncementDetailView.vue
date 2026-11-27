<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Archive, CalendarClock, CheckCircle2, Download, Eye, Megaphone, Pencil, Send, Trash2, Undo2, Users } from 'lucide-vue-next';
import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
  type Announcement,
  type AnnouncementReader,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KModal from '@/components/ui/KModal.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import AnnouncementComposer from '@/components/communication/AnnouncementComposer.vue';
import {
  announcementReaders,
  archiveAnnouncement,
  communicationFileUrl,
  deleteAnnouncement,
  getAnnouncement,
  markAnnouncementRead,
  publishAnnouncement,
  reviewAnnouncement,
} from '@/services/communication';
import { fileName } from '@/services/academics';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';
import { useAuthStore } from '@/stores/auth';
import { useInboxStore } from '@/stores/inbox';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const inbox = useInboxStore();
const { schoolId, slug, can, feedback, attempt } = useSchool();
const teaching = useTeaching();
const id = computed(() => String(route.params.announcementId ?? ''));

const announcement = ref<Announcement | null>(null);
const readers = ref<AnnouncementReader[]>([]);
const loading = ref(true);

const isAuthor = computed(() => announcement.value?.author_id === auth.user?.id);
const isApprover = computed(() => can('communication.approve'));
const manages = computed(() => isAuthor.value || isApprover.value);

async function load() {
  if (!id.value) return;
  loading.value = true;
  try {
    announcement.value = await getAnnouncement(id.value);
    if (!announcement.value) return;
    if (announcement.value.status === 'published') {
      await markAnnouncementRead(id.value);
      void inbox.refresh();
    }
    readers.value = manages.value && announcement.value.status === 'published' ? await announcementReaders(id.value).catch(() => []) : [];
  } finally {
    loading.value = false;
  }
}
watch(id, load, { immediate: true });

const readCount = computed(() => readers.value.filter((r) => r.read_at).length);
const readPct = computed(() => (readers.value.length ? Math.round((readCount.value / readers.value.length) * 100) : 0));
const audienceDetail = computed(() => {
  const a = announcement.value;
  if (!a) return '';
  if (a.audience === 'classes') {
    const who = [a.include_parents && 'parents', a.include_students && 'students', a.include_teachers && 'teachers'].filter(Boolean).join(', ');
    return `${a.class_ids.map((c) => teaching.className(c)).filter(Boolean).join(', ')} (${who})`;
  }
  return ANNOUNCEMENT_AUDIENCE_LABELS[a.audience].label;
});

async function openFile(path: string) {
  const url = await attempt(() => communicationFileUrl(path));
  if (url) window.open(url, '_blank', 'noopener');
}

const editOpen = ref(false);
const returnOpen = ref(false);
const note = ref('');

async function publish() {
  const status = await attempt(() => publishAnnouncement(id.value));
  if (status) feedback.success(status === 'published' ? 'Announcement published.' : 'Sent to the principal for approval.');
  await load();
}
async function approve() {
  await attempt(() => reviewAnnouncement(id.value, true), 'Approved and published.');
  await load();
}
async function sendBack() {
  const ok = await attempt(async () => {
    await reviewAnnouncement(id.value, false, note.value);
    return true;
  }, 'Returned to the author.');
  if (ok) {
    returnOpen.value = false;
    note.value = '';
    await load();
  }
}
async function archive() {
  const ok = await feedback.confirm({ title: 'Archive this announcement?', description: 'It will no longer appear for recipients.', confirmLabel: 'Archive', tone: 'danger' });
  if (!ok) return;
  await attempt(() => archiveAnnouncement(id.value), 'Announcement archived.');
  await load();
}
async function remove() {
  const ok = await feedback.confirm({ title: 'Delete this draft?', description: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' });
  if (!ok) return;
  const done = await attempt(async () => {
    await deleteAnnouncement(id.value);
    return true;
  }, 'Draft deleted.');
  if (done) await router.push({ name: 'announcements', params: { slug: slug.value } });
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : '');
</script>

<template>
  <div class="mx-auto max-w-[1000px]">
    <KSkeleton v-if="loading" :lines="10" />
    <div v-else-if="!announcement" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="Megaphone" title="This announcement is not available" description="It may have expired or been archived.">
        <KButton :to="{ name: 'announcements', params: { slug } }">Back to announcements</KButton>
      </KEmptyState>
    </div>

    <template v-else>
      <KPageHeader
        :icon="Megaphone"
        :title="announcement.title"
        :breadcrumbs="[{ label: 'Announcements', to: { name: 'announcements', params: { slug } } }, { label: announcement.title }]"
      >
        <template #badge>
          <KBadge :tone="announcement.status === 'published' ? 'success' : announcement.status === 'pending' ? 'warning' : 'neutral'" dot>
            {{ ANNOUNCEMENT_STATUS_LABELS[announcement.status] }}
          </KBadge>
        </template>
        <template #actions>
          <template v-if="announcement.status === 'draft' && isAuthor">
            <KButton variant="secondary" :icon="Pencil" @click="editOpen = true">Edit</KButton>
            <KButton :icon="Send" @click="publish">Publish</KButton>
            <KButton variant="ghost" :icon="Trash2" class="text-danger-ink hover:bg-danger-soft" aria-label="Delete draft" @click="remove" />
          </template>
          <template v-if="announcement.status === 'pending' && isApprover">
            <KButton variant="ghost" :icon="Undo2" @click="returnOpen = true">Return</KButton>
            <KButton :icon="CheckCircle2" @click="approve">Approve and publish</KButton>
          </template>
          <KButton v-if="announcement.status === 'published' && manages" variant="secondary" :icon="Archive" @click="archive">Archive</KButton>
        </template>
      </KPageHeader>

      <KAlert v-if="announcement.status === 'pending' && !isApprover" tone="info" class="mb-5">Waiting for the principal to approve it.</KAlert>
      <KAlert v-if="announcement.status === 'draft' && announcement.review_note" tone="warning" title="Returned for changes" class="mb-5">{{ announcement.review_note }}</KAlert>

      <div class="grid gap-6 lg:grid-cols-[1fr_300px]">
        <article class="min-w-0 rounded-card border border-line bg-surface shadow-card">
          <div class="k-bg-hero relative h-2 rounded-t-card" aria-hidden="true" />
          <div class="p-6 sm:p-8">
            <p class="text-[13px] text-ink-muted">{{ when(announcement.publish_at ?? announcement.published_at ?? announcement.created_at) }}</p>
            <div class="mt-4 text-[15px] leading-relaxed whitespace-pre-line">{{ announcement.body }}</div>
            <ul v-if="announcement.attachment_paths.length" class="mt-6 grid gap-2 sm:grid-cols-2">
              <li v-for="path in announcement.attachment_paths" :key="path">
                <button type="button" class="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-[13.5px] hover:border-brand/40 hover:bg-brand-soft/40" @click="openFile(path)">
                  <Download :size="15" class="text-brand-ink" aria-hidden="true" />
                  <span class="truncate">{{ fileName(path) }}</span>
                </button>
              </li>
            </ul>
          </div>
        </article>

        <aside v-if="manages" class="space-y-4">
          <KCard title="Audience" :icon="Users" tone="info">
            <p class="text-[14px] font-medium">{{ audienceDetail }}</p>
            <p v-if="announcement.publish_at" class="mt-2 flex items-center gap-1.5 text-[13px] text-ink-muted"><CalendarClock :size="14" aria-hidden="true" /> {{ when(announcement.publish_at) }}</p>
            <p v-if="announcement.expires_at" class="mt-1 text-[13px] text-ink-muted">Shown until {{ when(announcement.expires_at) }}</p>
          </KCard>
          <KCard v-if="announcement.status === 'published'" title="Read by" :icon="Eye" tone="success">
            <p class="text-[26px] font-semibold tabular-nums">{{ readCount }}<span class="text-[15px] text-ink-muted"> of {{ readers.length }}</span></p>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"><div class="h-full rounded-full bg-success" :style="{ width: `${readPct}%` }" /></div>
            <ul class="mt-4 max-h-72 space-y-2 overflow-y-auto">
              <li v-for="r in readers" :key="r.user_id" class="flex items-center gap-2 text-[13px]">
                <KAvatar :name="`${r.first_name} ${r.last_name}`" :size="26" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ r.first_name }} {{ r.last_name }}</span>
                  <span class="block truncate text-[11.5px] text-ink-muted">{{ r.audience_role }}</span>
                </span>
                <KBadge :tone="r.read_at ? 'success' : 'neutral'">{{ r.read_at ? 'Read' : 'Unread' }}</KBadge>
              </li>
            </ul>
          </KCard>
        </aside>
      </div>

      <AnnouncementComposer v-model:open="editOpen" :announcement="announcement" @saved="load" />
      <KModal v-model:open="returnOpen" title="Return for changes" description="The author sees your note and can edit and resubmit.">
        <KTextarea v-model="note" label="What should change?" :rows="4" autofocus />
        <template #footer>
          <KButton variant="secondary" @click="returnOpen = false">Cancel</KButton>
          <KButton :icon="Undo2" :disabled="!note.trim()" @click="sendBack">Return</KButton>
        </template>
      </KModal>
    </template>
  </div>
</template>
