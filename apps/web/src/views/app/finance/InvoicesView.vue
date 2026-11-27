<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { Download, FilePlus2, FileStack, FileText, Inbox, Search, Send } from 'lucide-vue-next';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  invoiceDisplayStatus,
  toCsv,
  type Invoice,
  type InvoiceDisplayStatus,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KInput from '@/components/ui/KInput.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KTabs from '@/components/ui/KTabs.vue';
import KPagination from '@/components/ui/KPagination.vue';
import KAlert from '@/components/ui/KAlert.vue';
import GenerateInvoicesModal from '@/components/finance/GenerateInvoicesModal.vue';
import InvoiceFormModal from '@/components/finance/InvoiceFormModal.vue';
import { issueInvoices, listInvoices, listStudentNames } from '@/services/finance';
import { downloadText, todayStamp } from '@/lib/download';
import { formatDay, useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';
import { todayIso, useFinance } from '@/composables/useFinance';

const router = useRouter();
const { schoolId, slug, words, can, attempt, feedback } = useSchool();
const teaching = useTeaching();
const { money } = useFinance();
const today = todayIso();

const termId = ref<string | null>(null);
watch(teaching.currentTerm, (t) => {
  if (termId.value === null && t) termId.value = t.id;
}, { immediate: true });
watch(() => teaching.loaded.value, (l) => {
  if (l && termId.value === null) termId.value = '';
});
const classId = ref('');
const status = ref<'' | InvoiceDisplayStatus>('');
const query = ref('');

const invoices = ref<Invoice[]>([]);
const names = ref(new Map<string, { name: string; admission: string }>());
const loading = ref(true);

async function load() {
  if (!schoolId.value || termId.value === null) return;
  loading.value = true;
  const [rows, students] = await Promise.all([
    listInvoices(schoolId.value, { termId: termId.value || undefined }).catch(() => []),
    names.value.size ? Promise.resolve(null) : listStudentNames(schoolId.value).catch(() => []),
  ]);
  invoices.value = rows;
  if (students) names.value = new Map(students.map((s) => [s.id, { name: `${s.first_name} ${s.last_name}`, admission: s.admission_number }]));
  loading.value = false;
}
watch([schoolId, termId], load, { immediate: true });

const tab = ref('all');
const drafts = computed(() => invoices.value.filter((i) => i.status === 'draft'));
const tabs = computed(() => [
  { key: 'all', label: 'All invoices', icon: FileText },
  ...(can('finance.create') ? [{ key: 'drafts', label: 'Drafts to issue', icon: Inbox, count: drafts.value.length }] : []),
]);

const studentName = (id: string) => names.value.get(id)?.name ?? 'Student';
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return invoices.value.filter((i) => {
    if (tab.value === 'drafts' && i.status !== 'draft') return false;
    if (classId.value && i.class_id !== classId.value) return false;
    if (status.value && invoiceDisplayStatus(i, today) !== status.value) return false;
    if (q && !`${i.invoice_number} ${studentName(i.student_id)} ${names.value.get(i.student_id)?.admission ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
});
const page = ref(1);
const pageSize = 50;
watch([filtered, tab], () => (page.value = 1));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));

const totals = computed(() => {
  const live = filtered.value.filter((i) => i.status !== 'draft' && i.status !== 'void');
  return {
    billed: live.reduce((s, i) => s + i.total_amount, 0),
    collected: live.reduce((s, i) => s + i.amount_paid, 0),
    outstanding: live.reduce((s, i) => s + i.balance, 0),
  };
});

// Drafts
const chosen = ref<Set<string>>(new Set());
const issuing = ref(false);
function toggle(id: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(id);
  else next.delete(id);
  chosen.value = next;
}
async function issueChosen() {
  const ids = [...chosen.value];
  const ok = await feedback.confirm({
    title: `Issue ${ids.length} invoice${ids.length === 1 ? '' : 's'}?`,
    description: 'Families will see them in the parent portal and get a notification.',
    confirmLabel: 'Issue',
    tone: 'primary',
  });
  if (!ok) return;
  issuing.value = true;
  await attempt(() => issueInvoices(ids), 'Invoices issued. Families have been notified.');
  issuing.value = false;
  chosen.value = new Set();
  await load();
}

const generateOpen = ref(false);
const newOpen = ref(false);

function exportCsv() {
  const rows = [
    ['Invoice number', 'Student', 'Admission number', words.value.group, 'Title', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Status'],
    ...filtered.value.map((i) => [
      i.invoice_number, studentName(i.student_id), names.value.get(i.student_id)?.admission ?? '', teaching.className(i.class_id), i.title,
      i.issue_date ?? '', i.due_date, (i.total_amount / 100).toFixed(2), (i.amount_paid / 100).toFixed(2), (i.balance / 100).toFixed(2),
      INVOICE_STATUS_LABELS[invoiceDisplayStatus(i, today)],
    ]),
  ];
  downloadText(`invoices_${todayStamp()}.csv`, toCsv(rows));
}
</script>

<template>
  <div>
    <KPageHeader :icon="FileText" eyebrow="Finance" title="Invoices" description="Bill students from your fee structures, issue invoices to families and follow up what is still owed.">
      <template #actions>
        <KButton v-if="can('finance.export') && filtered.length" variant="secondary" :icon="Download" @click="exportCsv">Export</KButton>
        <KButton v-if="can('finance.create')" variant="secondary" :icon="FilePlus2" @click="newOpen = true">New invoice</KButton>
        <KButton v-if="can('finance.create')" :icon="FileStack" data-tour="generate-invoices" @click="generateOpen = true">Generate invoices</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="teaching.loaded.value && !teaching.terms.value.length" tone="info" class="mb-5" :title="`Set up your ${words.periods.toLowerCase()} first`">
      Invoices are raised for a {{ words.period.toLowerCase() }}. <RouterLink :to="{ name: 'academic-calendar', params: { slug } }" class="font-medium underline">Open academic sessions</RouterLink>
    </KAlert>

    <div class="mb-5 grid gap-3 sm:grid-cols-3">
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[12.5px] text-ink-muted">Billed</p>
        <p class="mt-1 text-[22px] font-semibold tabular-nums">{{ money(totals.billed) }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[12.5px] text-ink-muted">Collected</p>
        <p class="mt-1 text-[22px] font-semibold text-success-ink tabular-nums">{{ money(totals.collected) }}</p>
      </div>
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[12.5px] text-ink-muted">Still owed</p>
        <p class="mt-1 text-[22px] font-semibold text-warning-ink tabular-nums">{{ money(totals.outstanding) }}</p>
      </div>
    </div>

    <div class="mb-5 grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
      <KSelect :model-value="termId ?? ''" :label="words.period" :options="[{ value: '', label: 'All' }, ...teaching.terms.value.map((t) => ({ value: t.id, label: teaching.termLabel(t.id) }))]" @update:model-value="termId = $event" />
      <KSelect v-model="classId" :label="words.group" :options="[{ value: '', label: 'All' }, ...teaching.classes.value.map((c) => ({ value: c.id, label: c.name }))]" />
      <KSelect
        v-model="status"
        label="Status"
        :options="[{ value: '', label: 'All' }, ...(['draft', 'issued', 'part_paid', 'overdue', 'paid', 'void'] as const).map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] }))]"
      />
      <KInput v-model="query" type="search" label="Search" placeholder="Name or invoice number" :icon="Search" />
    </div>

    <KTabs v-if="tabs.length > 1" v-model="tab" :tabs="tabs" label="Invoices" class="mb-5" />

    <KSkeleton v-if="loading" :lines="10" />

    <div v-else-if="!filtered.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState
        :icon="FileText"
        :title="invoices.length ? 'No invoices match' : 'No invoices yet'"
        :description="invoices.length ? 'Try a different filter.' : 'Generate invoices for every student from your fee structures, or create one for a single student.'"
      >
        <KButton v-if="!invoices.length && can('finance.create')" :icon="FileStack" @click="generateOpen = true">Generate invoices</KButton>
      </KEmptyState>
    </div>

    <div v-else class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div v-if="tab === 'drafts'" class="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <KCheckbox
          :model-value="chosen.size > 0 && chosen.size === filtered.length"
          :indeterminate="chosen.size > 0 && chosen.size < filtered.length"
          label="Select all"
          @update:model-value="chosen = $event ? new Set(filtered.map((i) => i.id)) : new Set()"
        />
        <KButton size="sm" class="ml-auto" :icon="Send" :disabled="!chosen.size" :loading="issuing" @click="issueChosen">Issue {{ chosen.size || '' }} selected</KButton>
      </div>
      <div class="overflow-x-auto">
        <table class="k-table">
          <thead>
            <tr>
              <th v-if="tab === 'drafts'" scope="col" class="w-10"><span class="sr-only">Select</span></th>
              <th scope="col">Invoice</th>
              <th scope="col">Student</th>
              <th scope="col">{{ words.group }}</th>
              <th scope="col" class="text-right">Total</th>
              <th scope="col" class="text-right">Balance</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in pageRows" :key="i.id" class="cursor-pointer hover:bg-surface-muted/50" @click="router.push({ name: 'invoice-detail', params: { slug, invoiceId: i.id } })">
              <td v-if="tab === 'drafts'" @click.stop>
                <KCheckbox :model-value="chosen.has(i.id)" :aria-label="`Select ${i.invoice_number}`" @update:model-value="toggle(i.id, $event)" />
              </td>
              <td>
                <RouterLink :to="{ name: 'invoice-detail', params: { slug, invoiceId: i.id } }" class="font-medium hover:text-brand-ink" @click.stop>{{ i.invoice_number }}</RouterLink>
                <p class="text-[12px] text-ink-muted">{{ i.title }}</p>
              </td>
              <td>
                <p class="font-medium">{{ studentName(i.student_id) }}</p>
                <p class="text-[12px] text-ink-muted">{{ names.get(i.student_id)?.admission }}</p>
              </td>
              <td class="text-ink-muted">{{ teaching.className(i.class_id) }}</td>
              <td class="text-right tabular-nums">{{ money(i.total_amount, i.currency) }}</td>
              <td class="text-right font-medium tabular-nums">{{ money(i.balance, i.currency) }}</td>
              <td class="text-ink-muted">{{ formatDay(i.due_date) }}</td>
              <td>
                <KBadge :tone="INVOICE_STATUS_TONES[invoiceDisplayStatus(i, today)]" dot>{{ INVOICE_STATUS_LABELS[invoiceDisplayStatus(i, today)] }}</KBadge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <KPagination v-if="filtered.length > pageSize" v-model="page" :total="filtered.length" :page-size="pageSize" noun="invoices" />
    </div>

    <GenerateInvoicesModal v-model:open="generateOpen" @done="load" />
    <InvoiceFormModal v-model:open="newOpen" @created="(id) => router.push({ name: 'invoice-detail', params: { slug, invoiceId: id } })" />
  </div>
</template>
