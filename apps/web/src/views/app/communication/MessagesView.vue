<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  ArrowLeft,
  Ban,
  CheckCheck,
  Download,
  Flag,
  Lock,
  MessagesSquare,
  Paperclip,
  PenSquare,
  Search,
  Send,
  ShieldAlert,
  Users,
  X,
} from 'lucide-vue-next';
import { relativeTime, type InboxRow, type Message, type MessagingContact, type ModerationItem } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KTabs from '@/components/ui/KTabs.vue';
import { supabase } from '@/lib/supabase';
import { fileName } from '@/services/academics';
import {
  blockUser,
  blockedUserIds,
  communicationFileUrl,
  getInbox,
  listMessages,
  markConversationRead,
  messagingContacts,
  moderateReport,
  moderationQueue,
  reportMessage,
  sendMessage,
  startConversation,
  uploadCommunicationFile,
  watchConversation,
} from '@/services/communication';
import { useSchool } from '@/composables/useSchool';
import { useAuthStore } from '@/stores/auth';
import { useInboxStore } from '@/stores/inbox';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const inboxStore = useInboxStore();
const { schoolId, can, feedback, attempt } = useSchool();
const me = computed(() => auth.user?.id ?? '');
const isModerator = computed(() => can('communication.approve'));

const tab = ref(route.query.tab === 'moderation' && isModerator.value ? 'moderation' : 'inbox');
const tabs = computed(() => [
  { key: 'inbox', label: 'Inbox', icon: MessagesSquare, count: inboxStore.unreadMessages || undefined },
  ...(isModerator.value ? [{ key: 'moderation', label: 'Reported messages', icon: ShieldAlert }] : []),
]);

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
const inbox = ref<InboxRow[]>([]);
const loading = ref(true);
const filter = ref('');
const blocked = ref<Set<string>>(new Set());

async function loadInbox() {
  if (!schoolId.value) return;
  try {
    [inbox.value, blocked.value] = await Promise.all([getInbox(schoolId.value), blockedUserIds()]);
  } finally {
    loading.value = false;
  }
}
watch(schoolId, loadInbox, { immediate: true });

const others = (row: InboxRow) => row.participants.filter((p) => p.user_id !== me.value);
const titleOf = (row: InboxRow) => row.subject || others(row).map((p) => p.name).join(', ') || 'Conversation';
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return inbox.value.filter((r) => !q || `${titleOf(r)} ${r.last_body ?? ''}`.toLowerCase().includes(q));
});

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------
const activeId = ref<string | null>(typeof route.query.c === 'string' ? route.query.c : null);
const active = computed(() => inbox.value.find((r) => r.conversation_id === activeId.value) ?? null);
const messages = ref<Message[]>([]);
const loadingThread = ref(false);
const draft = ref('');
const files = ref<string[]>([]);
const sending = ref(false);
const uploading = ref(false);
const thread = ref<HTMLElement | null>(null);
let channel: RealtimeChannel | null = null;

async function scrollToEnd() {
  await nextTick();
  thread.value?.scrollTo({ top: thread.value.scrollHeight });
}

async function openConversation(id: string | null) {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  activeId.value = id;
  void router.replace({ query: id ? { c: id } : {} });
  messages.value = [];
  draft.value = '';
  files.value = [];
  if (!id) return;
  loadingThread.value = true;
  try {
    messages.value = await listMessages(id);
    await markConversationRead(id);
    void inboxStore.refresh();
    const row = inbox.value.find((r) => r.conversation_id === id);
    if (row) row.unread_count = 0;
  } finally {
    loadingThread.value = false;
  }
  await scrollToEnd();
  channel = watchConversation(id, async (m) => {
    const at = messages.value.findIndex((x) => x.id === m.id);
    if (at >= 0) messages.value[at] = m;
    else messages.value.push(m);
    if (m.sender_id !== me.value) await markConversationRead(id);
    await loadInbox();
    await scrollToEnd();
  });
}
watch(
  () => [activeId.value, loading.value] as const,
  ([id, isLoading]) => {
    if (id && !isLoading && !messages.value.length && !loadingThread.value) void openConversation(id);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (channel) void supabase.removeChannel(channel);
});

const nameOf = (userId: string | null) => active.value?.participants.find((p) => p.user_id === userId)?.name ?? 'Someone';
/** "Seen" under my latest message once everyone else has read past it. */
const seenAt = computed(() => {
  const mine = [...messages.value].reverse().find((m) => m.sender_id === me.value);
  if (!mine || !active.value) return null;
  const readers = others(active.value).filter((p) => p.last_read_at && p.last_read_at >= mine.created_at);
  return readers.length === others(active.value).length && readers.length ? mine.id : null;
});
const otherPerson = computed(() => (active.value?.kind === 'direct' ? others(active.value)[0] : undefined));

async function send() {
  if (!activeId.value || (!draft.value.trim() && !files.value.length)) return;
  sending.value = true;
  const ok = await attempt(async () => {
    await sendMessage(activeId.value!, draft.value, files.value);
    return true;
  });
  sending.value = false;
  if (ok) {
    draft.value = '';
    files.value = [];
    messages.value = await listMessages(activeId.value);
    await loadInbox();
    await scrollToEnd();
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
}

async function attach(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file || !activeId.value) return;
  uploading.value = true;
  const path = await attempt(() => uploadCommunicationFile(`${schoolId.value}/messages/${activeId.value}`, file));
  uploading.value = false;
  if (path) files.value = [...files.value, path];
}

async function openFile(path: string) {
  const url = await attempt(() => communicationFileUrl(path));
  if (url) window.open(url, '_blank', 'noopener');
}

// Report and block
const reportOpen = ref(false);
const reporting = ref<Message | null>(null);
const reason = ref('');
async function submitReport() {
  if (!reporting.value) return;
  const ok = await attempt(async () => {
    await reportMessage(reporting.value!.id, reason.value);
    return true;
  }, 'Thank you. The school will review this message.');
  if (ok) {
    reportOpen.value = false;
    reason.value = '';
  }
}

async function toggleBlock() {
  const person = otherPerson.value;
  if (!person) return;
  const block = !blocked.value.has(person.user_id);
  if (block) {
    const ok = await feedback.confirm({
      title: `Block ${person.name}?`,
      description: 'They will not be able to message you. You can unblock them at any time.',
      confirmLabel: 'Block',
      tone: 'danger',
    });
    if (!ok) return;
  }
  await attempt(() => blockUser(schoolId.value, person.user_id, block), block ? `${person.name} is blocked.` : `${person.name} is unblocked.`);
  blocked.value = await blockedUserIds();
}

// ---------------------------------------------------------------------------
// New conversation
// ---------------------------------------------------------------------------
const newOpen = ref(false);
const contacts = ref<MessagingContact[]>([]);
const contactSearch = ref('');
const chosen = ref<string[]>([]);
const subject = ref('');
const firstMessage = ref('');
const starting = ref(false);
const isStaff = computed(() => workspaceIsStaff());
function workspaceIsStaff() {
  return can('communication.create') || can('staff.view') || can('academics.view');
}

async function openNew() {
  newOpen.value = true;
  chosen.value = [];
  subject.value = '';
  firstMessage.value = '';
  contactSearch.value = '';
  contacts.value = await messagingContacts(schoolId.value).catch(() => []);
}
const contactMatches = computed(() => {
  const q = contactSearch.value.trim().toLowerCase();
  return contacts.value.filter((c) => !q || `${c.first_name} ${c.last_name} ${c.description ?? ''}`.toLowerCase().includes(q)).slice(0, 100);
});
function choose(id: string) {
  if (chosen.value.includes(id)) chosen.value = chosen.value.filter((x) => x !== id);
  else chosen.value = isStaff.value ? [...chosen.value, id] : [id];
}

async function start() {
  if (!chosen.value.length || !firstMessage.value.trim()) return;
  starting.value = true;
  const id = await attempt(() => startConversation(schoolId.value, chosen.value, subject.value, firstMessage.value));
  starting.value = false;
  if (id) {
    newOpen.value = false;
    await loadInbox();
    await openConversation(id);
  }
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------
const reports = ref<ModerationItem[]>([]);
const loadingReports = ref(false);
async function loadReports() {
  loadingReports.value = true;
  reports.value = await moderationQueue(schoolId.value).catch(() => []);
  loadingReports.value = false;
}
watch(tab, (t) => t === 'moderation' && void loadReports(), { immediate: true });
async function decide(item: ModerationItem, action: 'hide' | 'dismiss', lock = false) {
  await attempt(() => moderateReport(item.report_id, action, lock), action === 'hide' ? (lock ? 'Message hidden and conversation closed.' : 'Message hidden.') : 'Report dismissed.');
  await loadReports();
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });
const showDay = (i: number) => i === 0 || new Date(messages.value[i]!.created_at).toDateString() !== new Date(messages.value[i - 1]!.created_at).toDateString();
</script>

<template>
  <div>
    <KPageHeader :icon="MessagesSquare" eyebrow="Communication" title="Messages" description="Private conversations between families and the school.">
      <template #actions>
        <KButton :icon="PenSquare" @click="openNew">New message</KButton>
      </template>
    </KPageHeader>

    <KTabs v-if="tabs.length > 1" v-model="tab" :tabs="tabs" label="Messages" class="mb-5" />

    <!-- Inbox and thread -->
    <div v-if="tab === 'inbox'" class="grid h-[calc(100dvh-330px)] min-h-[520px] overflow-hidden rounded-card border border-line bg-surface shadow-card md:grid-cols-[340px_1fr]">
      <aside :class="['flex min-h-0 flex-col border-line md:border-r', activeId ? 'hidden md:flex' : 'flex']">
        <div class="border-b border-line p-3">
          <KInput v-model="filter" type="search" :icon="Search" placeholder="Search conversations" aria-label="Search conversations" />
        </div>
        <KSkeleton v-if="loading" :lines="6" class="p-4" />
        <div v-else-if="!inbox.length" class="flex flex-1 items-center justify-center p-6">
          <KEmptyState compact :icon="MessagesSquare" title="No messages yet" description="Start a conversation with a teacher or the school office.">
            <KButton size="sm" :icon="PenSquare" @click="openNew">New message</KButton>
          </KEmptyState>
        </div>
        <ul v-else class="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          <li v-for="row in filtered" :key="row.conversation_id">
            <button
              type="button"
              :class="['flex w-full gap-3 px-4 py-3 text-left transition-colors', row.conversation_id === activeId ? 'bg-brand-soft' : 'hover:bg-surface-muted/60']"
              @click="openConversation(row.conversation_id)"
            >
              <div class="relative shrink-0">
                <KAvatar v-if="row.kind === 'direct'" :name="others(row)[0]?.name ?? '?'" :src="others(row)[0]?.avatar_url" :size="40" />
                <span v-else class="flex size-10 items-center justify-center rounded-full bg-[#F3F0FF] text-[#6D28D9] dark:bg-[#7C3AED]/15 dark:text-[#C4B5FD]"><Users :size="18" aria-hidden="true" /></span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2">
                  <p :class="['truncate text-[14px]', row.unread_count ? 'font-semibold' : 'font-medium']">{{ titleOf(row) }}</p>
                  <span class="shrink-0 text-[11.5px] text-ink-subtle">{{ relativeTime(row.last_message_at) }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <p :class="['min-w-0 flex-1 truncate text-[13px]', row.unread_count ? 'text-ink' : 'text-ink-muted']">
                    <template v-if="row.last_sender_id === me">You: </template>{{ row.last_body }}
                  </p>
                  <Lock v-if="row.is_locked" :size="13" class="shrink-0 text-ink-subtle" aria-label="Closed" />
                  <span v-if="row.unread_count" class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">{{ row.unread_count }}</span>
                </div>
              </div>
            </button>
          </li>
        </ul>
      </aside>

      <section :class="['min-h-0 flex-col', activeId ? 'flex' : 'hidden md:flex']">
        <div v-if="!active" class="flex flex-1 items-center justify-center">
          <KEmptyState :icon="MessagesSquare" title="Choose a conversation" description="Or start a new one." />
        </div>
        <template v-else>
          <header class="flex items-center gap-3 border-b border-line px-4 py-3">
            <button type="button" class="flex size-8 items-center justify-center rounded-lg hover:bg-surface-muted md:hidden" aria-label="Back to conversations" @click="openConversation(null)">
              <ArrowLeft :size="18" aria-hidden="true" />
            </button>
            <KAvatar v-if="active.kind === 'direct'" :name="otherPerson?.name ?? '?'" :src="otherPerson?.avatar_url" :size="36" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold">{{ titleOf(active) }}</p>
              <p class="truncate text-[12.5px] text-ink-muted">{{ active.subject ? others(active).map((p) => p.name).join(', ') : active.kind === 'group' ? `${active.participants.length} people` : 'Direct message' }}</p>
            </div>
            <KBadge v-if="active.is_locked" tone="neutral"><Lock :size="12" aria-hidden="true" /> Closed</KBadge>
            <KButton v-if="otherPerson" size="sm" variant="ghost" :icon="Ban" :class="blocked.has(otherPerson.user_id) ? 'text-danger-ink' : ''" @click="toggleBlock">
              {{ blocked.has(otherPerson.user_id) ? 'Unblock' : 'Block' }}
            </KButton>
          </header>

          <div ref="thread" class="min-h-0 flex-1 space-y-2 overflow-y-auto bg-canvas/60 px-4 py-5">
            <KSkeleton v-if="loadingThread" :lines="4" />
            <template v-for="(m, i) in messages" :key="m.id">
              <p v-if="showDay(i)" class="py-2 text-center text-[11.5px] font-medium text-ink-subtle">{{ dayLabel(m.created_at) }}</p>
              <div :class="['group flex', m.sender_id === me ? 'justify-end' : 'justify-start']">
                <div class="max-w-[78%]">
                  <p v-if="active.kind === 'group' && m.sender_id !== me && (i === 0 || messages[i - 1]!.sender_id !== m.sender_id)" class="mb-0.5 ml-1 text-[11.5px] font-medium text-ink-muted">
                    {{ nameOf(m.sender_id) }}
                  </p>
                  <div
                    :class="[
                      'rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed shadow-sm',
                      m.hidden_at ? 'border border-dashed border-line-strong bg-surface text-ink-subtle italic' :
                      m.sender_id === me ? 'k-bg-brand rounded-br-md text-white' : 'rounded-bl-md border border-line bg-surface text-ink',
                    ]"
                  >
                    <p v-if="m.hidden_at">This message was removed by the school.</p>
                    <p v-else-if="m.body" class="whitespace-pre-line">{{ m.body }}</p>
                    <ul v-if="m.attachment_paths.length" class="mt-1.5 space-y-1">
                      <li v-for="path in m.attachment_paths" :key="path">
                        <button type="button" :class="['flex items-center gap-1.5 text-[13px] underline-offset-2 hover:underline', m.sender_id === me ? 'text-white' : 'text-brand-ink']" @click="openFile(path)">
                          <Download :size="13" aria-hidden="true" /> {{ fileName(path) }}
                        </button>
                      </li>
                    </ul>
                  </div>
                  <p :class="['mt-0.5 flex items-center gap-2 px-1 text-[11px] text-ink-subtle', m.sender_id === me ? 'justify-end' : '']">
                    {{ time(m.created_at) }}
                    <span v-if="seenAt === m.id" class="flex items-center gap-0.5 text-brand-ink"><CheckCheck :size="12" aria-hidden="true" /> Seen</span>
                    <button
                      v-if="m.sender_id !== me && !m.hidden_at"
                      type="button"
                      class="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:text-danger-ink"
                      @click="(reporting = m), (reportOpen = true)"
                    >
                      <Flag :size="11" aria-hidden="true" /> Report
                    </button>
                  </p>
                </div>
              </div>
            </template>
          </div>

          <footer v-if="!active.is_locked" class="border-t border-line p-3">
            <ul v-if="files.length" class="mb-2 flex flex-wrap gap-1.5">
              <li v-for="(path, i) in files" :key="path" class="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-[12.5px]">
                <Paperclip :size="12" aria-hidden="true" /> {{ fileName(path) }}
                <button type="button" :aria-label="`Remove ${fileName(path)}`" @click="files.splice(i, 1)"><X :size="13" /></button>
              </li>
            </ul>
            <div class="flex items-end gap-2">
              <label class="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-surface-muted" :aria-label="uploading ? 'Uploading' : 'Attach a file'">
                <Paperclip :size="18" aria-hidden="true" />
                <input type="file" class="sr-only" accept=".pdf,.doc,.docx,image/*" @change="attach" />
              </label>
              <textarea
                v-model="draft"
                rows="1"
                placeholder="Write a message"
                aria-label="Message"
                class="max-h-40 min-h-10 flex-1 resize-none rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[14px] outline-none focus:border-brand focus:ring-4 focus:ring-focus"
                @keydown="onKey"
              />
              <KButton :icon="Send" :loading="sending" :disabled="!draft.trim() && !files.length" aria-label="Send" @click="send" />
            </div>
            <p class="mt-1.5 hidden text-[11.5px] text-ink-subtle sm:block">Press Enter to send, Shift and Enter for a new line.</p>
          </footer>
          <p v-else class="flex items-center justify-center gap-2 border-t border-line p-4 text-[13px] text-ink-muted"><Lock :size="14" aria-hidden="true" /> The school has closed this conversation.</p>
        </template>
      </section>
    </div>

    <!-- Moderation -->
    <div v-else class="rounded-card border border-line bg-surface shadow-card">
      <KSkeleton v-if="loadingReports" :lines="5" class="p-5" />
      <KEmptyState v-else-if="!reports.length" :icon="ShieldAlert" title="No reported messages" description="When someone reports a message, it appears here. You only see the reported message, not the rest of the conversation." />
      <ul v-else class="divide-y divide-line">
        <li v-for="r in reports" :key="r.report_id" class="flex flex-col gap-3 p-5 sm:flex-row">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <KBadge :tone="r.status === 'open' ? 'warning' : 'neutral'" dot>{{ r.status === 'open' ? 'Needs review' : r.status === 'hidden' ? 'Hidden' : 'Dismissed' }}</KBadge>
              <span class="text-[12.5px] text-ink-muted">Reported by {{ r.reporter_name }}, {{ relativeTime(r.created_at) }}</span>
            </div>
            <blockquote class="mt-2 rounded-xl border-l-4 border-warning bg-warning-soft/50 px-4 py-3 text-[14px] whitespace-pre-line">{{ r.body || 'Attachment only' }}</blockquote>
            <p class="mt-2 text-[13px] text-ink-muted"><span class="font-medium text-ink">From {{ r.sender_name }}.</span> Reason: {{ r.reason }}</p>
          </div>
          <div v-if="r.status === 'open'" class="flex shrink-0 flex-wrap gap-2 sm:flex-col">
            <KButton size="sm" variant="danger" @click="decide(r, 'hide')">Hide message</KButton>
            <KButton size="sm" variant="secondary" :icon="Lock" @click="decide(r, 'hide', true)">Hide and close chat</KButton>
            <KButton size="sm" variant="ghost" @click="decide(r, 'dismiss')">Dismiss</KButton>
          </div>
        </li>
      </ul>
    </div>

    <!-- New conversation -->
    <KModal v-model:open="newOpen" title="New message" :description="isStaff ? 'Choose one or more people.' : 'Choose who to write to.'" size="lg">
      <div class="space-y-4">
        <KInput v-model="contactSearch" type="search" :icon="Search" placeholder="Search by name, class or child" aria-label="Search people" autofocus />
        <ul class="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
          <li v-if="!contactMatches.length" class="p-4 text-center text-[13px] text-ink-muted">Nobody matches. You can message the teachers of your children and the school office.</li>
          <li v-for="c in contactMatches" :key="c.user_id">
            <button
              type="button"
              :aria-pressed="chosen.includes(c.user_id)"
              :class="['flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', chosen.includes(c.user_id) ? 'bg-brand-soft' : 'hover:bg-surface-muted']"
              @click="choose(c.user_id)"
            >
              <KAvatar :name="`${c.first_name} ${c.last_name}`" :src="c.avatar_url" :size="34" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[14px] font-medium">{{ c.first_name }} {{ c.last_name }}</span>
                <span class="block truncate text-[12.5px] text-ink-muted">{{ c.description }}</span>
              </span>
              <KCheckbox :model-value="chosen.includes(c.user_id)" :aria-label="`Choose ${c.first_name}`" class="pointer-events-none" />
            </button>
          </li>
        </ul>
        <KInput v-if="chosen.length > 1" v-model="subject" label="Subject" placeholder="Science fair planning" optional />
        <KTextarea v-model="firstMessage" label="Message" :rows="4" />
      </div>
      <template #footer>
        <KButton variant="secondary" @click="newOpen = false">Cancel</KButton>
        <KButton :icon="Send" :loading="starting" :disabled="!chosen.length || !firstMessage.trim()" @click="start">Send</KButton>
      </template>
    </KModal>

    <KModal v-model:open="reportOpen" title="Report this message" description="The school's moderators will see this message only, not the rest of your conversation.">
      <KTextarea v-model="reason" label="What is wrong with it?" :rows="3" autofocus />
      <template #footer>
        <KButton variant="secondary" @click="reportOpen = false">Cancel</KButton>
        <KButton variant="danger" :icon="Flag" :disabled="!reason.trim()" @click="submitReport">Report</KButton>
      </template>
    </KModal>
  </div>
</template>
