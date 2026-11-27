<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Banknote, Building2, CreditCard, FileCheck2, HandCoins, Info } from 'lucide-vue-next';
import {
  MANUAL_PAYMENT_METHODS,
  METHODS_NEEDING_REFERENCE,
  PAYMENT_METHOD_LABELS,
  allocateOldestFirst,
  parseMoneyToMinor,
  paymentSchema,
  validate,
  type FieldErrors,
  type Invoice,
  type ManualPaymentMethod,
  type RecordedPayment,
} from '@klasora/shared';
import KModal from '@/components/ui/KModal.vue';
import KButton from '@/components/ui/KButton.vue';
import KInput from '@/components/ui/KInput.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KAlert from '@/components/ui/KAlert.vue';
import StudentSearch, { type StudentOption } from './StudentSearch.vue';
import { listInvoices, listStudentNames, recordPayment } from '@/services/finance';
import { useSchool } from '@/composables/useSchool';
import { todayIso, useFinance } from '@/composables/useFinance';

/** Records money received at the school and shows where it will be applied. */
const props = defineProps<{ studentId?: string; invoiceId?: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ recorded: [payment: RecordedPayment] }>();

const { schoolId, can, attempt, feedback } = useSchool();
const { currency, money } = useFinance();
const canApprove = computed(() => can('finance.approve'));

const methodIcons: Record<ManualPaymentMethod, typeof Banknote> = {
  cash: Banknote, bank_transfer: Building2, pos: CreditCard, cheque: FileCheck2, other: HandCoins,
};

const students = ref<StudentOption[]>([]);
const invoices = ref<Invoice[]>([]);
const errors = ref<FieldErrors>({});
const saving = ref(false);
const mode = ref<'auto' | 'manual'>('auto');
const manual = ref<Record<string, string>>({});
const form = reactive({ studentId: '', amount: '', method: 'cash' as ManualPaymentMethod, paidAt: todayIso(), reference: '', payerName: '', notes: '' });

watch(open, async (v) => {
  if (!v) return;
  Object.assign(form, { studentId: props.studentId ?? '', amount: '', method: 'cash', paidAt: todayIso(), reference: '', payerName: '', notes: '' });
  errors.value = {};
  mode.value = props.invoiceId ? 'manual' : 'auto';
  manual.value = {};
  touched.value = false;
  if (!props.studentId && !students.value.length) students.value = await listStudentNames(schoolId.value).catch(() => []);
});

watch(() => [form.studentId, open.value] as const, async ([id, isOpen]) => {
  invoices.value = [];
  if (!id || !isOpen) return;
  invoices.value = (await listInvoices(schoolId.value, { studentIds: [id], statuses: ['issued', 'part_paid'] }).catch(() => [])).sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (props.invoiceId) {
    const inv = invoices.value.find((i) => i.id === props.invoiceId);
    if (inv) {
      if (!form.amount) form.amount = String(inv.balance / 100);
      manual.value = { [inv.id]: form.amount };
    }
  }
}, { immediate: true });

const owed = computed(() => invoices.value.reduce((sum, i) => sum + i.balance, 0));
const amountMinor = computed(() => parseMoneyToMinor(form.amount, currency.value) ?? 0);
// Opened from one invoice: its amount follows the payment until someone edits it.
const touched = ref(false);
watch(() => form.amount, (amount) => {
  if (props.invoiceId && !touched.value && props.invoiceId in manual.value) manual.value = { ...manual.value, [props.invoiceId]: amount };
});
const manualAllocations = computed(() =>
  Object.entries(manual.value)
    .map(([invoice_id, text]) => ({ invoice_id, amount: parseMoneyToMinor(text, currency.value) ?? 0 }))
    .filter((a) => a.amount > 0),
);
const plan = computed(() => {
  if (mode.value === 'auto') return allocateOldestFirst(amountMinor.value, invoices.value);
  const allocations = manualAllocations.value;
  return { allocations, unallocated: amountMinor.value - allocations.reduce((s, a) => s + a.amount, 0) };
});
const overAllocated = computed(() => plan.value.unallocated < 0);
const needsReference = computed(() => METHODS_NEEDING_REFERENCE.includes(form.method));

async function submit() {
  const result = validate(paymentSchema, { ...form, currency: currency.value, today: todayIso() });
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  if (overAllocated.value) {
    errors.value = { amount: 'The amounts applied to invoices add up to more than the payment.' };
    return;
  }
  errors.value = {};
  saving.value = true;
  const recorded = await attempt(() =>
    recordPayment({
      studentId: form.studentId,
      amount: amountMinor.value,
      method: form.method,
      paidAt: form.paidAt,
      reference: form.reference,
      payerName: form.payerName,
      notes: form.notes,
      allocations: mode.value === 'auto' ? null : plan.value.allocations,
    }),
  );
  saving.value = false;
  if (!recorded) return;
  if (recorded.status === 'confirmed') feedback.success(`Payment confirmed. Receipt ${recorded.receipt_number}.`);
  else feedback.success('Payment recorded. It will count once someone approves it.');
  open.value = false;
  emit('recorded', recorded);
}
</script>

<template>
  <KModal v-model:open="open" title="Record a payment" description="For cash, bank transfers, POS and cheques received by the school." size="lg">
    <form id="payment-form" class="space-y-5" novalidate @submit.prevent="submit">
      <StudentSearch v-if="!studentId" v-model="form.studentId" :students="students" :error="errors.studentId" />

      <div>
        <p class="mb-1.5 text-[13px] font-medium">How was it paid?</p>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <button
            v-for="m in MANUAL_PAYMENT_METHODS"
            :key="m"
            type="button"
            :aria-pressed="form.method === m"
            :class="[
              'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[12.5px] font-medium transition',
              form.method === m ? 'border-brand bg-brand-soft text-brand-ink ring-2 ring-brand/20' : 'border-line hover:bg-surface-muted',
            ]"
            @click="form.method = m"
          >
            <component :is="methodIcons[m]" :size="18" aria-hidden="true" />
            {{ PAYMENT_METHOD_LABELS[m] }}
          </button>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <KInput v-model="form.amount" :label="`Amount received (${currency})`" inputmode="decimal" placeholder="50,000" :error="errors.amount" required />
        <KInput v-model="form.paidAt" type="date" label="Date received" :error="errors.paidAt" required />
        <KInput
          v-if="needsReference"
          v-model="form.reference"
          :label="form.method === 'cheque' ? 'Cheque number' : form.method === 'pos' ? 'POS slip number' : 'Transfer reference'"
          placeholder="As shown on the bank alert or slip"
          :error="errors.reference"
          required
        />
        <KInput v-else v-model="form.reference" label="Reference" placeholder="Receipt book number" optional />
        <KInput v-model="form.payerName" label="Paid by" placeholder="Mrs Ngozi Eze" optional />
      </div>

      <section v-if="form.studentId" class="rounded-card border border-line">
        <header class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h3 class="text-[14px] font-semibold">Apply to invoices</h3>
          <span class="text-[12.5px] text-ink-muted">Owed now: {{ money(owed) }}</span>
          <div class="ml-auto flex rounded-lg border border-line p-0.5 text-[12.5px]">
            <button type="button" :class="['rounded-md px-2.5 py-1', mode === 'auto' ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-muted']" @click="mode = 'auto'">Oldest first</button>
            <button type="button" :class="['rounded-md px-2.5 py-1', mode === 'manual' ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-muted']" @click="mode = 'manual'">Choose</button>
          </div>
        </header>
        <p v-if="!invoices.length" class="px-4 py-3 text-[13px] text-ink-muted">This student has no unpaid invoices. The payment will be kept as credit for future fees.</p>
        <ul v-else class="divide-y divide-line">
          <li v-for="inv in invoices" :key="inv.id" class="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-medium">{{ inv.title }}</p>
              <p class="text-[12px] text-ink-muted">{{ inv.invoice_number }}, owes {{ money(inv.balance, inv.currency) }}</p>
            </div>
            <span v-if="mode === 'auto'" class="text-[13px] font-semibold tabular-nums">
              {{ money(plan.allocations.find((a) => a.invoice_id === inv.id)?.amount ?? 0) }}
            </span>
            <div v-else class="w-36">
              <KInput
                :model-value="manual[inv.id] ?? ''"
                :aria-label="`Amount for ${inv.invoice_number}`"
                inputmode="decimal"
                placeholder="0"
                @update:model-value="touched = true; manual = { ...manual, [inv.id]: $event }"
              />
            </div>
          </li>
        </ul>
        <p v-if="plan.unallocated > 0 && amountMinor > 0" class="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-ink-muted">
          <Info :size="14" aria-hidden="true" /> {{ money(plan.unallocated) }} will be kept as credit for future fees.
        </p>
        <p v-if="overAllocated" class="border-t border-line px-4 py-2.5 text-[12.5px] text-danger-ink">The amounts above add up to more than the payment.</p>
      </section>

      <KTextarea v-model="form.notes" label="Notes" :rows="2" optional />

      <KAlert v-if="!canApprove" tone="info">This payment will wait for someone who can approve payments before it counts and a receipt is issued.</KAlert>
    </form>
    <template #footer>
      <KButton variant="secondary" @click="open = false">Cancel</KButton>
      <KButton type="submit" form="payment-form" :loading="saving">{{ canApprove ? 'Record and confirm' : 'Record payment' }}</KButton>
    </template>
  </KModal>
</template>
