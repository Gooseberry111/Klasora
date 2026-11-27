<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Check, Download, FileDown, HandCoins, Hourglass, Search, Undo2, Wallet, X } from 'lucide-vue-next';
import {
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  toCsv,
  type Payment,
  type PaymentStatus,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KInput from '@/components/ui/KInput.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KTabs from '@/components/ui/KTabs.vue';
import KPagination from '@/components/ui/KPagination.vue';
import ReasonModal from '@/components/finance/ReasonModal.vue';
import RecordPaymentModal from '@/components/finance/RecordPaymentModal.vue';
import { listPayments, listStudentNames, reversePayment, reviewPayment } from '@/services/finance';
import { downloadText, todayStamp } from '@/lib/download';
import { formatDay, useSchool } from '@/composables/useSchool';
import { useFinance } from '@/composables/useFinance';

const route = useRoute();
const { schoolId, slug, can, attempt, feedback } = useSchool();
const { money, downloadReceipt } = useFinance();
const canApprove = computed(() => can('finance.approve'));

const payments = ref<Payment[]>([]);
const names = ref(new Map<string, { name: string; admission: string }>());
const loading = ref(true);
const from = ref('');
const to = ref('');

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  const [rows, students] = await Promise.all([
    listPayments(schoolId.value, { from: from.value || undefined, to: to.value || undefined }).catch(() => []),
    names.value.size ? Promise.resolve(null) : listStudentNames(schoolId.value).catch(() => []),
  ]);
  payments.value = rows;
  if (students) names.value = new Map(students.map((s) => [s.id, { name: `${s.first_name} ${s.last_name}`, admission: s.admission_number }]));
  loading.value = false;
}
watch([schoolId, from, to], load, { immediate: true });

const tab = ref(route.query.tab === 'pending' ? 'pending' : 'all');
const pending = computed(() => payments.value.filter((p) => p.status === 'pending'));
const tabs = computed(() => [
  { key: 'all', label: 'All payments', icon: Wallet },
  { key: 'pending', label: 'Awaiting approval', icon: Hourglass, count: pending.value.length || undefined },
]);

const method = ref('');
const status = ref<'' | PaymentStatus>('');
const query = ref('');
const studentName = (id: string) => names.value.get(id)?.name ?? 'Student';
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return payments.value.filter((p) => {
    if (tab.value === 'pending' && p.status !== 'pending') return false;
    if (method.value && p.payment_method !== method.value) return false;
    if (status.value && p.status !== status.value) return false;
    if (q && !`${p.receipt_number ?? ''} ${p.payment_reference ?? ''} ${p.payer_name ?? ''} ${studentName(p.student_id)} ${names.value.get(p.student_id)?.admission ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
});
const page = ref(1);
const pageSize = 50;
watch([filtered, tab], () => (page.value = 1));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const confirmedTotal = computed(() => filtered.value.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0));

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const recordOpen = ref(false);
const busy = ref<string | null>(null);

async function approve(p: Payment) {
  const ok = await feedback.confirm({
    title: `Approve ${money(p.amount, p.currency)} for ${studentName(p.student_id)}?`,
    description: 'Check the money has arrived, for example on the bank statement. The invoice balance updates and the family gets a receipt.',
    confirmLabel: 'Approve',
    tone: 'primary',
  });
  if (!ok) return;
  busy.value = p.id;
  await attempt(() => reviewPayment(p.id, true, ''), 'Payment approved. The receipt has been issued.');
  busy.value = null;
  await load();
}

const target = ref<Payment | null>(null);
const rejectOpen = ref(false);
const reverseOpen = ref(false);
async function confirmReject(reason: string) {
  busy.value = target.value!.id;
  const ok = await attempt(async () => {
    await reviewPayment(target.value!.id, false, reason);
    return true;
  }, 'Payment rejected.');
  busy.value = null;
  if (ok) {
    rejectOpen.value = false;
    await load();
  }
}
async function confirmReverse(reason: string) {
  busy.value = target.value!.id;
  const ok = await attempt(async () => {
    await reversePayment(target.value!.id, reason);
    return true;
  }, 'Payment reversed. The invoices it paid are open again.');
  busy.value = null;
  if (ok) {
    reverseOpen.value = false;
    await load();
  }
}

async function receipt(p: Payment) {
  busy.value = p.id;
  await attempt(() => downloadReceipt(p, { name: studentName(p.student_id), admissionNumber: names.value.get(p.student_id)?.admission ?? '', className: '' }));
  busy.value = null;
}

function exportCsv() {
  const rows = [
    ['Receipt', 'Student', 'Admission number', 'Amount', 'Method', 'Reference', 'Paid by', 'Date received', 'Status', 'Recorded manually'],
    ...filtered.value.map((p) => [
      p.receipt_number ?? '', studentName(p.student_id), names.value.get(p.student_id)?.admission ?? '', (p.amount / 100).toFixed(2),
      PAYMENT_METHOD_LABELS[p.payment_method], p.payment_reference ?? '', p.payer_name ?? '', p.paid_at, PAYMENT_STATUS_LABELS[p.status], p.is_manual ? 'Yes' : 'No',
    ]),
  ];
  downloadText(`payments_${todayStamp()}.csv`, toCsv(rows));
}
</script>

<template>
  <div>
    <KPageHeader :icon="Wallet" eyebrow="Finance" title="Payments" description="Money received from families. Manual payments are approved before they count, and every confirmed payment gets a receipt.">
      <template #actions>
        <KButton v-if="can('finance.export') && filtered.length" variant="secondary" :icon="Download" @click="exportCsv">Export</KButton>
        <KButton v-if="can('finance.create')" :icon="HandCoins" data-tour="record-payment" @click="recordOpen = true">Record payment</KButton>
      </template>
    </KPageHeader>

    <KTabs v-model="tab" :tabs="tabs" label="Payments" class="mb-5" />

    <div class="mb-5 grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-5">
      <KInput v-model="query" type="search" label="Search" placeholder="Name, receipt or reference" :icon="Search" />
      <KSelect v-model="method" label="Method" :options="[{ value: '', label: 'All' }, ...MANUAL_PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))]" />
      <KSelect v-if="tab === 'all'" v-model="status" label="Status" :options="[{ value: '', label: 'All' }, ...(['confirmed', 'pending', 'rejected', 'reversed'] as const).map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] }))]" />
      <KInput v-model="from" type="date" label="From" />
      <KInput v-model="to" type="date" label="To" />
    </div>

    <KSkeleton v-if="loading" :lines="10" />

    <div v-else-if="!filtered.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState
        :icon="tab === 'pending' ? Hourglass : Wallet"
        :title="tab === 'pending' ? 'Nothing waiting for approval' : payments.length ? 'No payments match' : 'No payments yet'"
        :description="tab === 'pending' ? 'Payments recorded by staff who cannot approve them appear here.' : 'Record cash, bank transfers, POS and cheques as families pay.'"
      >
        <KButton v-if="tab === 'all' && !payments.length && can('finance.create')" :icon="HandCoins" @click="recordOpen = true">Record a payment</KButton>
      </KEmptyState>
    </div>

    <div v-else class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-[13px] text-ink-muted">
        {{ filtered.length }} payment{{ filtered.length === 1 ? '' : 's' }}, <span class="font-semibold text-ink tabular-nums">{{ money(confirmedTotal) }}</span> confirmed
      </div>
      <div class="overflow-x-auto">
        <table class="k-table">
          <thead>
            <tr>
              <th scope="col">Receipt</th>
              <th scope="col">Student</th>
              <th scope="col">Method</th>
              <th scope="col">Received</th>
              <th scope="col" class="text-right">Amount</th>
              <th scope="col">Status</th>
              <th scope="col" class="text-right"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pageRows" :key="p.id">
              <td>
                <p class="font-medium">{{ p.receipt_number ?? 'Not issued yet' }}</p>
                <p class="text-[12px] text-ink-muted">{{ p.is_manual ? 'Recorded manually' : 'Online, verified' }}</p>
              </td>
              <td>
                <RouterLink v-if="can('students.view')" :to="{ name: 'student-detail', params: { slug, studentId: p.student_id }, query: { tab: 'finance' } }" class="font-medium hover:text-brand-ink">{{ studentName(p.student_id) }}</RouterLink>
                <p v-else class="font-medium">{{ studentName(p.student_id) }}</p>
                <p v-if="p.payer_name" class="text-[12px] text-ink-muted">Paid by {{ p.payer_name }}</p>
              </td>
              <td>
                <p>{{ PAYMENT_METHOD_LABELS[p.payment_method] }}</p>
                <p v-if="p.payment_reference" class="text-[12px] text-ink-muted">{{ p.payment_reference }}</p>
              </td>
              <td class="text-ink-muted">{{ formatDay(p.paid_at) }}</td>
              <td class="text-right font-semibold tabular-nums">{{ money(p.amount, p.currency) }}</td>
              <td>
                <KBadge :tone="PAYMENT_STATUS_TONES[p.status]" dot>{{ PAYMENT_STATUS_LABELS[p.status] }}</KBadge>
                <p v-if="p.review_note || p.reversal_reason" class="mt-1 max-w-48 text-[12px] text-ink-muted">{{ p.reversal_reason || p.review_note }}</p>
              </td>
              <td>
                <div class="flex justify-end gap-1">
                  <template v-if="p.status === 'pending' && canApprove">
                    <KButton size="sm" :icon="Check" :loading="busy === p.id" @click="approve(p)">Approve</KButton>
                    <KButton size="sm" variant="ghost" :icon="X" :aria-label="`Reject ${p.payment_reference ?? 'payment'}`" @click="target = p; rejectOpen = true" />
                  </template>
                  <template v-if="p.status === 'confirmed'">
                    <KButton size="sm" variant="ghost" :icon="FileDown" :loading="busy === p.id" :aria-label="`Download receipt ${p.receipt_number}`" @click="receipt(p)" />
                    <KButton v-if="canApprove" size="sm" variant="ghost" :icon="Undo2" :aria-label="`Reverse ${p.receipt_number}`" @click="target = p; reverseOpen = true" />
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <KPagination v-if="filtered.length > pageSize" v-model="page" :total="filtered.length" :page-size="pageSize" noun="payments" />
    </div>

    <RecordPaymentModal v-model:open="recordOpen" @recorded="load" />
    <ReasonModal
      v-model:open="rejectOpen"
      title="Reject this payment?"
      description="Use this when the money never arrived. The record is kept, and it never counts towards any invoice."
      placeholder="Not on the bank statement"
      confirm-label="Reject payment"
      tone="danger"
      :busy="Boolean(busy)"
      @submit="confirmReject"
    />
    <ReasonModal
      v-model:open="reverseOpen"
      title="Reverse this payment?"
      description="For a cheque that bounced or a payment recorded in error. The invoices it paid become unpaid again."
      placeholder="Cheque returned unpaid"
      confirm-label="Reverse payment"
      tone="danger"
      :busy="Boolean(busy)"
      @submit="confirmReverse"
    />
  </div>
</template>
