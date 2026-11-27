<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Ban, ChevronRight, Download, FileText, HandCoins, Pencil, Plus, Send, Trash2, Wallet } from 'lucide-vue-next';
import {
  FEE_CATEGORY_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  collectionRate,
  invoiceDisplayStatus,
  parseMoneyToMinor,
  type FeeStructure,
  type Invoice,
  type InvoiceItem,
  type Payment,
  type PaymentAllocation,
} from '@klasora/shared';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KCard from '@/components/ui/KCard.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import KProgressRing from '@/components/ui/KProgressRing.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import ReasonModal from '@/components/finance/ReasonModal.vue';
import RecordPaymentModal from '@/components/finance/RecordPaymentModal.vue';
import {
  addInvoiceItem,
  fetchInvoice,
  issueInvoices,
  listFeeStructures,
  listStudentNames,
  removeInvoiceItem,
  updateInvoice,
  voidInvoice,
} from '@/services/finance';
import { downloadInvoicePdf } from '@/lib/financePdf';
import { formatDay, useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';
import { todayIso, useFinance } from '@/composables/useFinance';

const route = useRoute();
const { schoolId, slug, words, can, attempt, feedback } = useSchool();
const teaching = useTeaching();
const { money, documentSchool } = useFinance();
const id = computed(() => String(route.params.invoiceId));

const invoice = ref<Invoice | null>(null);
const items = ref<InvoiceItem[]>([]);
const allocations = ref<PaymentAllocation[]>([]);
const payments = ref<Payment[]>([]);
const student = ref<{ id: string; first_name: string; last_name: string; admission_number: string } | null>(null);
const loading = ref(true);

async function load() {
  loading.value = true;
  const data = await attempt(() => fetchInvoice(id.value));
  invoice.value = data?.invoice ?? null;
  items.value = data?.items ?? [];
  allocations.value = data?.allocations ?? [];
  payments.value = data?.payments ?? [];
  if (invoice.value && student.value?.id !== invoice.value.student_id) {
    student.value = (await listStudentNames(schoolId.value, [invoice.value.student_id]).catch(() => []))[0] ?? null;
  }
  loading.value = false;
}
watch([id, schoolId], load, { immediate: true });

const display = computed(() => (invoice.value ? invoiceDisplayStatus(invoice.value, todayIso()) : 'draft'));
const isDraft = computed(() => invoice.value?.status === 'draft');
const isVoid = computed(() => invoice.value?.status === 'void');
const isOpen = computed(() => invoice.value?.status === 'issued' || invoice.value?.status === 'part_paid');
/** Drafts need finance.edit; issued invoices need finance.approve and a reason. */
const canChange = computed(() => !isVoid.value && (isDraft.value ? can('finance.edit') : can('finance.approve')));
const studentName = computed(() => (student.value ? `${student.value.first_name} ${student.value.last_name}` : 'Student'));
const paidPct = computed(() => (invoice.value ? collectionRate(invoice.value.amount_paid, invoice.value.total_amount) : 0));
const paymentRows = computed(() =>
  allocations.value
    .map((a) => ({ allocation: a, payment: payments.value.find((p) => p.id === a.payment_id) }))
    .filter((r): r is { allocation: PaymentAllocation; payment: Payment } => Boolean(r.payment))
    .sort((a, b) => b.payment.paid_at.localeCompare(a.payment.paid_at)),
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const busy = ref(false);
async function issue() {
  const ok = await feedback.confirm({ title: 'Issue this invoice?', description: 'The family will see it in the parent portal and get a notification.', confirmLabel: 'Issue', tone: 'primary' });
  if (!ok) return;
  busy.value = true;
  await attempt(() => issueInvoices([id.value]), 'Invoice issued. The family has been notified.');
  busy.value = false;
  await load();
}

const voidOpen = ref(false);
async function confirmVoid(reason: string) {
  busy.value = true;
  const ok = await attempt(async () => {
    await voidInvoice(id.value, reason);
    return true;
  }, 'Invoice cancelled.');
  busy.value = false;
  if (ok) {
    voidOpen.value = false;
    await load();
  }
}

const removing = ref<InvoiceItem | null>(null);
const removeOpen = ref(false);
async function removeLine(item: InvoiceItem) {
  if (isDraft.value) {
    await attempt(() => removeInvoiceItem(item.id), 'Line removed.');
    await load();
    return;
  }
  removing.value = item;
  removeOpen.value = true;
}
async function confirmRemove(reason: string) {
  if (!removing.value) return;
  busy.value = true;
  const ok = await attempt(async () => {
    await removeInvoiceItem(removing.value!.id, reason);
    return true;
  }, 'Line removed.');
  busy.value = false;
  if (ok) {
    removeOpen.value = false;
    await load();
  }
}

// Add a line
const fees = ref<FeeStructure[]>([]);
const lineOpen = ref(false);
const line = reactive({ source: 'custom', feeId: '', description: '', amount: '', kind: 'discount' as 'charge' | 'discount', reason: '' });
const lineError = ref('');
async function openLine() {
  Object.assign(line, { source: 'custom', feeId: '', description: '', amount: '', kind: 'discount', reason: '' });
  lineError.value = '';
  lineOpen.value = true;
  if (!fees.value.length) {
    fees.value = (await listFeeStructures(schoolId.value, invoice.value?.academic_year_id).catch(() => [])).filter((f) => f.status === 'active');
  }
}
async function saveLine() {
  lineError.value = '';
  const currency = invoice.value!.currency;
  let item;
  if (line.source === 'fee') {
    if (!line.feeId) return void (lineError.value = 'Choose a fee.');
    item = { fee_structure_id: line.feeId };
  } else {
    const amount = parseMoneyToMinor(line.amount, currency) ?? 0;
    if (!line.description.trim()) return void (lineError.value = 'Describe the line, like Sibling discount.');
    if (amount <= 0) return void (lineError.value = 'Enter an amount above zero.');
    item = { description: line.description.trim(), amount, kind: line.kind, category: line.kind === 'discount' ? ('discount' as const) : ('other' as const) };
  }
  if (!isDraft.value && !line.reason.trim()) return void (lineError.value = 'Give a reason for changing an issued invoice.');
  busy.value = true;
  const ok = await attempt(async () => {
    await addInvoiceItem(id.value, item, line.reason);
    return true;
  }, line.kind === 'discount' && line.source === 'custom' ? 'Discount added.' : 'Line added.');
  busy.value = false;
  if (ok) {
    lineOpen.value = false;
    await load();
  }
}

// Details
const detailsOpen = ref(false);
const details = reactive({ title: '', dueDate: '', notes: '' });
function openDetails() {
  Object.assign(details, { title: invoice.value!.title, dueDate: invoice.value!.due_date, notes: invoice.value!.notes ?? '' });
  detailsOpen.value = true;
}
async function saveDetails() {
  busy.value = true;
  const ok = await attempt(async () => {
    await updateInvoice(id.value, details.title, details.dueDate, details.notes);
    return true;
  }, 'Invoice updated.');
  busy.value = false;
  if (ok) {
    detailsOpen.value = false;
    await load();
  }
}

const payOpen = ref(false);
const downloading = ref(false);
async function download() {
  if (!invoice.value || !documentSchool.value) return;
  downloading.value = true;
  await attempt(() =>
    downloadInvoicePdf({
      invoice: invoice.value!,
      items: items.value,
      school: documentSchool.value!,
      student: { name: studentName.value, admissionNumber: student.value?.admission_number ?? '', className: teaching.className(invoice.value!.class_id) },
      periodLabel: invoice.value!.term_id ? teaching.termLabel(invoice.value!.term_id) : teaching.years.value.find((y) => y.id === invoice.value!.academic_year_id)?.name ?? '',
    }),
  );
  downloading.value = false;
}
</script>

<template>
  <div class="mx-auto max-w-[1100px]">
    <nav class="mb-3 flex items-center gap-1.5 text-[13px] text-ink-muted" aria-label="Breadcrumb">
      <RouterLink :to="{ name: 'invoices', params: { slug } }" class="hover:text-ink">Invoices</RouterLink>
      <ChevronRight :size="14" aria-hidden="true" />
      <span class="text-ink">{{ invoice?.invoice_number ?? 'Invoice' }}</span>
    </nav>

    <KSkeleton v-if="loading && !invoice" :lines="10" />
    <div v-else-if="!invoice" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="FileText" title="Invoice not found" description="It may have been removed, or you may not have access to it." />
    </div>

    <template v-else>
      <header class="mb-6 flex flex-wrap items-start gap-4">
        <KIconTile :icon="FileText" tone="brand" solid :size="48" />
        <div class="min-w-0 flex-1">
          <h1 class="flex flex-wrap items-center gap-3 text-[26px] font-semibold tracking-tight">
            {{ invoice.invoice_number }}
            <KBadge :tone="INVOICE_STATUS_TONES[display]" dot>{{ INVOICE_STATUS_LABELS[display] }}</KBadge>
          </h1>
          <p class="mt-1 text-ink-muted">
            {{ invoice.title }} for
            <RouterLink v-if="can('students.view')" :to="{ name: 'student-detail', params: { slug, studentId: invoice.student_id } }" class="font-medium text-ink hover:text-brand-ink">{{ studentName }}</RouterLink>
            <span v-else class="font-medium text-ink">{{ studentName }}</span>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <KButton variant="secondary" :icon="Download" :loading="downloading" @click="download">PDF</KButton>
          <KButton v-if="isDraft && can('finance.create')" :icon="Send" :loading="busy" @click="issue">Issue invoice</KButton>
          <KButton v-if="isOpen && can('finance.create')" :icon="HandCoins" @click="payOpen = true">Record payment</KButton>
          <KButton v-if="!isVoid && !paymentRows.some((r) => r.payment.status === 'pending' || r.payment.status === 'confirmed') && can('finance.delete')" variant="ghost" :icon="Ban" class="text-danger-ink hover:bg-danger-soft" @click="voidOpen = true">Cancel invoice</KButton>
        </div>
      </header>

      <KAlert v-if="isVoid" tone="warning" class="mb-5" title="This invoice was cancelled">
        {{ invoice.void_reason }}<template v-if="invoice.voided_at"> ({{ formatDay(invoice.voided_at.slice(0, 10)) }})</template>
      </KAlert>
      <KAlert v-else-if="isDraft" tone="info" class="mb-5" title="Draft">Families cannot see this invoice until it is issued.</KAlert>

      <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div class="min-w-0 space-y-6">
          <section class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <div class="grid gap-4 border-b border-line bg-surface-muted/50 p-5 sm:grid-cols-4">
              <div>
                <p class="text-[11.5px] font-medium tracking-wide text-ink-muted uppercase">{{ words.group }}</p>
                <p class="mt-1 font-medium">{{ teaching.className(invoice.class_id) || 'Not in a class' }}</p>
              </div>
              <div>
                <p class="text-[11.5px] font-medium tracking-wide text-ink-muted uppercase">{{ words.period }}</p>
                <p class="mt-1 font-medium">{{ invoice.term_id ? teaching.termLabel(invoice.term_id) : 'Whole session' }}</p>
              </div>
              <div>
                <p class="text-[11.5px] font-medium tracking-wide text-ink-muted uppercase">Issued</p>
                <p class="mt-1 font-medium">{{ invoice.issue_date ? formatDay(invoice.issue_date) : 'Not yet' }}</p>
              </div>
              <div>
                <p class="text-[11.5px] font-medium tracking-wide text-ink-muted uppercase">Due</p>
                <p :class="['mt-1 font-medium', display === 'overdue' && 'text-danger-ink']">{{ formatDay(invoice.due_date) }}</p>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="k-table">
                <thead>
                  <tr>
                    <th scope="col">Description</th>
                    <th scope="col">Type</th>
                    <th scope="col" class="text-right">Amount</th>
                    <th v-if="canChange" scope="col" class="w-12"><span class="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in items" :key="item.id">
                    <td>
                      <p class="font-medium">{{ item.description }}</p>
                      <p v-if="item.note" class="text-[12px] text-ink-muted">{{ item.note }}</p>
                    </td>
                    <td class="text-ink-muted">{{ FEE_CATEGORY_LABELS[item.category] ?? item.category }}</td>
                    <td :class="['text-right font-medium tabular-nums', item.kind === 'discount' && 'text-success-ink']">
                      {{ item.kind === 'discount' ? 'Less ' : '' }}{{ money(item.amount, invoice.currency) }}
                    </td>
                    <td v-if="canChange">
                      <KButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${item.description}`" @click="removeLine(item)" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="flex flex-col gap-4 border-t border-line p-5 sm:flex-row sm:items-start">
              <KButton v-if="canChange" size="sm" variant="subtle" :icon="Plus" @click="openLine">Add a fee or discount</KButton>
              <dl class="ml-auto w-full max-w-xs space-y-1.5 text-[14px]">
                <div class="flex justify-between"><dt class="text-ink-muted">Subtotal</dt><dd class="tabular-nums">{{ money(invoice.subtotal, invoice.currency) }}</dd></div>
                <div v-if="invoice.discount_total" class="flex justify-between"><dt class="text-ink-muted">Discounts</dt><dd class="text-success-ink tabular-nums">Less {{ money(invoice.discount_total, invoice.currency) }}</dd></div>
                <div class="flex justify-between font-semibold"><dt>Total</dt><dd class="tabular-nums">{{ money(invoice.total_amount, invoice.currency) }}</dd></div>
                <div class="flex justify-between"><dt class="text-ink-muted">Paid</dt><dd class="tabular-nums">{{ money(invoice.amount_paid, invoice.currency) }}</dd></div>
                <div class="flex justify-between border-t border-line pt-2 text-[16px] font-semibold"><dt>Balance due</dt><dd class="tabular-nums">{{ money(invoice.balance, invoice.currency) }}</dd></div>
              </dl>
            </div>
          </section>

          <KCard title="Payments applied" :icon="Wallet" tone="success" :padded="false">
            <p v-if="!paymentRows.length" class="px-5 py-4 text-[13.5px] text-ink-muted">No payments yet.</p>
            <ul v-else class="divide-y divide-line">
              <li v-for="r in paymentRows" :key="r.allocation.id" class="flex flex-wrap items-center gap-3 px-5 py-3">
                <div class="min-w-0 flex-1">
                  <p class="font-medium">{{ r.payment.receipt_number ?? 'Awaiting approval' }}</p>
                  <p class="text-[12.5px] text-ink-muted">
                    {{ PAYMENT_METHOD_LABELS[r.payment.payment_method] }}, {{ formatDay(r.payment.paid_at) }}<template v-if="r.payment.payment_reference">, ref {{ r.payment.payment_reference }}</template>
                  </p>
                </div>
                <KBadge :tone="PAYMENT_STATUS_TONES[r.payment.status]" dot>{{ PAYMENT_STATUS_LABELS[r.payment.status] }}</KBadge>
                <span class="font-semibold tabular-nums">{{ money(r.allocation.amount, invoice.currency) }}</span>
              </li>
            </ul>
          </KCard>
        </div>

        <aside class="space-y-4">
          <div class="rounded-card border border-line bg-surface p-5 shadow-card">
            <div class="flex items-center gap-4">
              <KProgressRing :value="paidPct" :size="76" />
              <div>
                <p class="text-[12.5px] text-ink-muted">Balance due</p>
                <p class="text-[20px] font-semibold tabular-nums">{{ money(invoice.balance, invoice.currency) }}</p>
                <p class="text-[12.5px] text-ink-muted">{{ money(invoice.amount_paid, invoice.currency) }} of {{ money(invoice.total_amount, invoice.currency) }} paid</p>
              </div>
            </div>
          </div>
          <KCard title="Details" :icon="Pencil" tone="neutral">
            <p class="text-[12.5px] text-ink-muted">Notes for the family</p>
            <p class="mt-1 text-[13.5px] whitespace-pre-line">{{ invoice.notes || 'None' }}</p>
            <KButton v-if="!isVoid && can('finance.edit')" size="sm" variant="secondary" class="mt-3" :icon="Pencil" @click="openDetails">Edit title, due date and notes</KButton>
          </KCard>
        </aside>
      </div>

      <ReasonModal
        v-model:open="voidOpen"
        title="Cancel this invoice?"
        description="It stays on record as cancelled. Invoices with payments need those payments reversed or moved first."
        placeholder="Billed in error"
        confirm-label="Cancel invoice"
        tone="danger"
        :busy="busy"
        @submit="confirmVoid"
      />
      <ReasonModal
        v-model:open="removeOpen"
        :title="`Remove ${removing?.description ?? 'this line'}?`"
        description="This invoice has been issued, so the change is recorded with your reason."
        confirm-label="Remove line"
        tone="danger"
        :busy="busy"
        @submit="confirmRemove"
      />

      <KModal v-model:open="lineOpen" title="Add a fee or discount" :description="isDraft ? undefined : 'This invoice has been issued, so the change is recorded with your reason and the family sees the new total.'">
        <form id="line-form" class="space-y-4" novalidate @submit.prevent="saveLine">
          <KSelect v-model="line.source" label="Add" :options="[{ value: 'custom', label: 'A discount or other line' }, { value: 'fee', label: 'A fee from your fee structures' }]" />
          <KSelect v-if="line.source === 'fee'" v-model="line.feeId" label="Fee" :options="fees.map((f) => ({ value: f.id, label: `${f.name}, ${money(f.amount)}` }))" placeholder="Choose" />
          <template v-else>
            <KSelect v-model="line.kind" label="Type" :options="[{ value: 'discount', label: 'Discount, scholarship or waiver' }, { value: 'charge', label: 'Extra charge' }]" />
            <KInput v-model="line.description" label="Description" :placeholder="line.kind === 'discount' ? 'Sibling discount' : 'Replacement ID card'" />
            <KInput v-model="line.amount" :label="`Amount (${invoice.currency})`" inputmode="decimal" placeholder="10,000" />
          </template>
          <KTextarea v-if="!isDraft" v-model="line.reason" label="Reason" :rows="2" placeholder="Approved by the principal on 12/11/2026" />
          <p v-if="lineError" class="text-[13px] text-danger-ink" role="alert">{{ lineError }}</p>
        </form>
        <template #footer>
          <KButton variant="secondary" @click="lineOpen = false">Cancel</KButton>
          <KButton type="submit" form="line-form" :loading="busy">Add</KButton>
        </template>
      </KModal>

      <KModal v-model:open="detailsOpen" title="Edit invoice details">
        <form id="details-form" class="space-y-4" novalidate @submit.prevent="saveDetails">
          <KInput v-model="details.title" label="Title" />
          <KInput v-model="details.dueDate" type="date" label="Due date" />
          <KTextarea v-model="details.notes" label="Notes for the family" :rows="3" optional />
        </form>
        <template #footer>
          <KButton variant="secondary" @click="detailsOpen = false">Cancel</KButton>
          <KButton type="submit" form="details-form" :loading="busy">Save</KButton>
        </template>
      </KModal>

      <RecordPaymentModal v-model:open="payOpen" :student-id="invoice.student_id" :invoice-id="invoice.id" @recorded="load" />
    </template>
  </div>
</template>
