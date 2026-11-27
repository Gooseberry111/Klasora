<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowRightLeft, FileDown, FilePlus2, FileText, HandCoins, PiggyBank, ReceiptText, Wallet } from 'lucide-vue-next';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  invoiceDisplayStatus,
  type Invoice,
  type Payment,
  type PaymentAllocation,
} from '@klasora/shared';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KCard from '@/components/ui/KCard.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import RecordPaymentModal from './RecordPaymentModal.vue';
import InvoiceFormModal from './InvoiceFormModal.vue';
import { allocatePayment, fetchInvoice, listAllocations, listFamilyInvoices, listFamilyPayments } from '@/services/finance';
import { downloadInvoicePdf } from '@/lib/financePdf';
import { formatDay, useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';
import { todayIso, useFinance } from '@/composables/useFinance';

/**
 * A student's fees: what was billed, paid and is still owed. Staff with
 * finance access can bill and record payments here; families see their
 * issued invoices and confirmed payments, with PDFs.
 */
const props = defineProps<{ studentId: string; studentName: string; admissionNumber: string; className: string }>();

const { slug, can, attempt } = useSchool();
const teaching = useTeaching();
const { money, documentSchool, downloadReceipt } = useFinance();
const staff = computed(() => can('finance.view'));
const today = todayIso();

const invoices = ref<Invoice[]>([]);
const payments = ref<Payment[]>([]);
const allocations = ref<PaymentAllocation[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  [invoices.value, payments.value] = await Promise.all([
    listFamilyInvoices([props.studentId]).catch(() => []),
    listFamilyPayments([props.studentId]).catch(() => []),
  ]);
  allocations.value = payments.value.length ? await listAllocations(payments.value.map((p) => p.id)).catch(() => []) : [];
  loading.value = false;
}
watch(() => props.studentId, load, { immediate: true });

const live = computed(() => invoices.value.filter((i) => i.status !== 'draft' && i.status !== 'void'));
const totals = computed(() => ({
  billed: live.value.reduce((s, i) => s + i.total_amount, 0),
  paid: live.value.reduce((s, i) => s + i.amount_paid, 0),
  owed: live.value.reduce((s, i) => s + i.balance, 0),
  overdue: live.value.filter((i) => invoiceDisplayStatus(i, today) === 'overdue').reduce((s, i) => s + i.balance, 0),
}));
/** Confirmed money not yet applied to an invoice. */
const credits = computed(() =>
  payments.value
    .filter((p) => p.status === 'confirmed')
    .map((p) => ({ payment: p, left: p.amount - allocations.value.filter((a) => a.payment_id === p.id).reduce((s, a) => s + a.amount, 0) }))
    .filter((c) => c.left > 0),
);
const credit = computed(() => credits.value.reduce((s, c) => s + c.left, 0));
const nextDue = computed(() => live.value.filter((i) => i.balance > 0).sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null);

const payOpen = ref(false);
const invoiceOpen = ref(false);
const busy = ref<string | null>(null);

async function applyCredit() {
  busy.value = 'credit';
  await attempt(async () => {
    for (const c of credits.value) await allocatePayment(c.payment.id, null);
  }, 'Credit applied to unpaid invoices.');
  busy.value = null;
  await load();
}

const student = computed(() => ({ name: props.studentName, admissionNumber: props.admissionNumber, className: props.className }));

async function invoicePdf(inv: Invoice) {
  if (!documentSchool.value) return;
  busy.value = inv.id;
  await attempt(async () => {
    const data = await fetchInvoice(inv.id);
    if (!data) return;
    await downloadInvoicePdf({
      invoice: data.invoice,
      items: data.items,
      school: documentSchool.value!,
      student: { ...student.value, className: teaching.className(inv.class_id) || props.className },
      periodLabel: inv.term_id ? teaching.termLabel(inv.term_id) : teaching.years.value.find((y) => y.id === inv.academic_year_id)?.name ?? '',
    });
  });
  busy.value = null;
}

async function receipt(p: Payment) {
  busy.value = p.id;
  await attempt(() => downloadReceipt(p, student.value));
  busy.value = null;
}
</script>

<template>
  <div class="space-y-6">
    <KSkeleton v-if="loading" :lines="8" />
    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <div class="flex items-center gap-3">
            <KIconTile :icon="ReceiptText" tone="brand" />
            <div>
              <p class="text-[12.5px] text-ink-muted">Billed</p>
              <p class="text-[18px] font-semibold tabular-nums">{{ money(totals.billed) }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <div class="flex items-center gap-3">
            <KIconTile :icon="Wallet" tone="success" />
            <div>
              <p class="text-[12.5px] text-ink-muted">Paid</p>
              <p class="text-[18px] font-semibold tabular-nums">{{ money(totals.paid) }}</p>
            </div>
          </div>
        </div>
        <div :class="['rounded-card border p-4 shadow-card', totals.owed ? 'border-warning/30 bg-warning-soft/50' : 'border-line bg-surface']">
          <div class="flex items-center gap-3">
            <KIconTile :icon="HandCoins" tone="warning" />
            <div>
              <p class="text-[12.5px] text-ink-muted">Still owed</p>
              <p class="text-[18px] font-semibold tabular-nums">{{ money(totals.owed) }}</p>
              <p v-if="totals.overdue" class="text-[12px] text-danger-ink tabular-nums">{{ money(totals.overdue) }} overdue</p>
              <p v-else-if="nextDue" class="text-[12px] text-ink-muted">Next due {{ formatDay(nextDue.due_date) }}</p>
            </div>
          </div>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <div class="flex items-center gap-3">
            <KIconTile :icon="PiggyBank" tone="violet" />
            <div>
              <p class="text-[12.5px] text-ink-muted">Credit</p>
              <p class="text-[18px] font-semibold tabular-nums">{{ money(credit) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div v-if="staff && (can('finance.create') || (credit && can('finance.edit')))" class="flex flex-wrap gap-2">
        <KButton v-if="can('finance.create')" :icon="HandCoins" @click="payOpen = true">Record payment</KButton>
        <KButton v-if="can('finance.create')" variant="secondary" :icon="FilePlus2" @click="invoiceOpen = true">New invoice</KButton>
        <KButton v-if="credit && totals.owed && can('finance.edit')" variant="secondary" :icon="ArrowRightLeft" :loading="busy === 'credit'" @click="applyCredit">Apply {{ money(credit) }} credit</KButton>
      </div>

      <KCard title="Invoices" :icon="FileText" tone="brand" :padded="false">
        <KEmptyState v-if="!invoices.length" :icon="FileText" title="No invoices" :description="staff ? 'Invoices for this student appear here once they are created.' : 'Invoices from the school will appear here.'" />
        <ul v-else class="divide-y divide-line">
          <li v-for="inv in invoices" :key="inv.id" class="flex flex-wrap items-center gap-3 px-5 py-3">
            <div class="min-w-0 flex-1">
              <RouterLink v-if="staff" :to="{ name: 'invoice-detail', params: { slug, invoiceId: inv.id } }" class="font-medium hover:text-brand-ink">{{ inv.title }}</RouterLink>
              <p v-else class="font-medium">{{ inv.title }}</p>
              <p class="text-[12.5px] text-ink-muted">{{ inv.invoice_number }}, due {{ formatDay(inv.due_date) }}</p>
            </div>
            <div class="text-right">
              <p class="font-semibold tabular-nums">{{ money(inv.balance, inv.currency) }}</p>
              <p class="text-[12px] text-ink-muted tabular-nums">of {{ money(inv.total_amount, inv.currency) }}</p>
            </div>
            <KBadge :tone="INVOICE_STATUS_TONES[invoiceDisplayStatus(inv, today)]" dot>{{ INVOICE_STATUS_LABELS[invoiceDisplayStatus(inv, today)] }}</KBadge>
            <KButton size="sm" variant="ghost" :icon="FileDown" :loading="busy === inv.id" :aria-label="`Download ${inv.invoice_number}`" @click="invoicePdf(inv)" />
          </li>
        </ul>
      </KCard>

      <KCard title="Payments" :icon="Wallet" tone="success" :padded="false">
        <p v-if="!payments.length" class="px-5 py-4 text-[13.5px] text-ink-muted">No payments recorded yet.</p>
        <ul v-else class="divide-y divide-line">
          <li v-for="p in payments" :key="p.id" class="flex flex-wrap items-center gap-3 px-5 py-3">
            <div class="min-w-0 flex-1">
              <p class="font-medium">{{ money(p.amount, p.currency) }} by {{ PAYMENT_METHOD_LABELS[p.payment_method].toLowerCase() }}</p>
              <p class="text-[12.5px] text-ink-muted">
                {{ formatDay(p.paid_at) }}<template v-if="p.receipt_number">, receipt {{ p.receipt_number }}</template><template v-if="p.payment_reference">, ref {{ p.payment_reference }}</template>
              </p>
            </div>
            <KBadge :tone="PAYMENT_STATUS_TONES[p.status]" dot>{{ PAYMENT_STATUS_LABELS[p.status] }}</KBadge>
            <KButton v-if="p.status === 'confirmed'" size="sm" variant="ghost" :icon="FileDown" :loading="busy === p.id" :aria-label="`Download receipt ${p.receipt_number}`" @click="receipt(p)" />
          </li>
        </ul>
      </KCard>

      <RecordPaymentModal v-if="staff" v-model:open="payOpen" :student-id="studentId" @recorded="load" />
      <InvoiceFormModal v-if="staff" v-model:open="invoiceOpen" :student-id="studentId" @created="load" />
    </template>
  </div>
</template>
