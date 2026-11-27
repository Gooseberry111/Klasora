<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Plus, Trash2 } from 'lucide-vue-next';
import {
  FEE_CATEGORY_LABELS,
  FEE_FREQUENCY_LABELS,
  parseMoneyToMinor,
  type FeeStructure,
  type InvoiceItemInput,
} from '@klasora/shared';
import KModal from '@/components/ui/KModal.vue';
import KButton from '@/components/ui/KButton.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import StudentSearch, { type StudentOption } from './StudentSearch.vue';
import { createInvoice, listFeeStructures, listStudentNames } from '@/services/finance';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';
import { daysFromToday, useFinance } from '@/composables/useFinance';

/** One invoice for one student: fees from the school's list plus any extra lines. */
const props = defineProps<{ studentId?: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ created: [invoiceId: string] }>();

const { schoolId, words, attempt } = useSchool();
const teaching = useTeaching();
const { currency, money } = useFinance();

const students = ref<StudentOption[]>([]);
const fees = ref<FeeStructure[]>([]);
const chosenFees = ref<Set<string>>(new Set());
const extra = ref<{ description: string; amount: string; kind: 'charge' | 'discount' }[]>([]);
const form = reactive({ studentId: '', termId: '', title: '', dueDate: daysFromToday(14), notes: '', issue: true });
const error = ref('');
const saving = ref(false);

watch(open, async (v) => {
  if (!v) return;
  Object.assign(form, { studentId: props.studentId ?? '', termId: teaching.currentTerm.value?.id ?? '', title: '', dueDate: daysFromToday(14), notes: '', issue: true });
  chosenFees.value = new Set();
  extra.value = [];
  error.value = '';
  if (!props.studentId && !students.value.length) students.value = await listStudentNames(schoolId.value).catch(() => []);
  fees.value = (await listFeeStructures(schoolId.value).catch(() => [])).filter((f) => f.status === 'active');
});

const yearId = computed(() => teaching.terms.value.find((t) => t.id === form.termId)?.academic_year_id ?? teaching.currentYear.value?.id ?? '');
const feeOptions = computed(() => fees.value.filter((f) => f.academic_year_id === yearId.value && (!f.term_id || f.term_id === form.termId)));

function toggleFee(id: string, on: boolean) {
  const next = new Set(chosenFees.value);
  if (on) next.add(id);
  else next.delete(id);
  chosenFees.value = next;
}

const lines = computed<(InvoiceItemInput & { label: string; amount: number })[]>(() => [
  ...feeOptions.value.filter((f) => chosenFees.value.has(f.id)).map((f) => ({ fee_structure_id: f.id, label: f.name, amount: f.amount, kind: 'charge' as const })),
  ...extra.value
    .map((x) => ({ description: x.description.trim(), label: x.description.trim(), amount: parseMoneyToMinor(x.amount, currency.value) ?? 0, kind: x.kind, category: x.kind === 'discount' ? ('discount' as const) : ('other' as const) }))
    .filter((x) => x.description && x.amount > 0),
]);
const total = computed(() => lines.value.reduce((sum, l) => sum + (l.kind === 'discount' ? -l.amount : l.amount), 0));

async function submit() {
  error.value = '';
  if (!form.studentId) return void (error.value = 'Choose the student.');
  if (!lines.value.some((l) => l.kind === 'charge')) return void (error.value = 'Add at least one fee.');
  if (total.value < 0) return void (error.value = 'Discounts cannot be more than the fees.');
  if (!form.dueDate) return void (error.value = 'Choose a due date.');
  saving.value = true;
  const id = await attempt(
    () =>
      createInvoice({
        studentId: form.studentId,
        termId: form.termId || null,
        dueDate: form.dueDate,
        items: lines.value.map(({ label: _label, ...item }) => item),
        title: form.title,
        notes: form.notes,
        issue: form.issue,
      }),
    form.issue ? 'Invoice issued. The family has been notified.' : 'Draft invoice saved.',
  );
  saving.value = false;
  if (id) {
    open.value = false;
    emit('created', id);
  }
}
</script>

<template>
  <KModal v-model:open="open" title="New invoice" description="Bill one student. To bill a whole class, use Generate invoices." size="lg">
    <form id="invoice-form" class="space-y-5" novalidate @submit.prevent="submit">
      <StudentSearch v-if="!studentId" v-model="form.studentId" :students="students" />
      <div class="grid gap-4 sm:grid-cols-2">
        <KSelect v-model="form.termId" :label="words.period" :options="[{ value: '', label: 'Whole session' }, ...teaching.terms.value.map((t) => ({ value: t.id, label: teaching.termLabel(t.id) }))]" />
        <KInput v-model="form.dueDate" type="date" label="Due date" required />
        <div class="sm:col-span-2"><KInput v-model="form.title" label="Title" placeholder="School fees" optional /></div>
      </div>

      <section class="rounded-card border border-line">
        <header class="border-b border-line px-4 py-3">
          <h3 class="text-[14px] font-semibold">Fees</h3>
          <p class="text-[12.5px] text-ink-muted">From your fee structures for this session.</p>
        </header>
        <p v-if="!feeOptions.length" class="px-4 py-3 text-[13px] text-ink-muted">No fees set up for this session yet. Add lines below, or set up fee structures first.</p>
        <ul v-else class="divide-y divide-line">
          <li v-for="f in feeOptions" :key="f.id" class="flex items-center gap-3 px-4 py-2.5">
            <KCheckbox :model-value="chosenFees.has(f.id)" :aria-label="`Add ${f.name}`" @update:model-value="toggleFee(f.id, $event)" />
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-medium">{{ f.name }}<span v-if="!f.is_mandatory" class="ml-2 text-[12px] font-normal text-ink-muted">Optional</span></p>
              <p class="text-[12px] text-ink-muted">{{ FEE_CATEGORY_LABELS[f.category] }}, {{ FEE_FREQUENCY_LABELS[f.frequency].label.toLowerCase() }}</p>
            </div>
            <span class="text-[13px] font-semibold tabular-nums">{{ money(f.amount) }}</span>
          </li>
        </ul>
      </section>

      <section class="space-y-2">
        <div v-for="(x, i) in extra" :key="i" class="grid grid-cols-[1fr_8rem_8rem_auto] items-end gap-2">
          <KInput v-model="x.description" :label="i === 0 ? 'Description' : undefined" :aria-label="`Line ${i + 1} description`" placeholder="Sibling discount" />
          <KInput v-model="x.amount" :label="i === 0 ? 'Amount' : undefined" :aria-label="`Line ${i + 1} amount`" inputmode="decimal" placeholder="10,000" />
          <KSelect v-model="x.kind" :label="i === 0 ? 'Type' : undefined" :options="[{ value: 'charge', label: 'Charge' }, { value: 'discount', label: 'Discount' }]" />
          <KButton variant="ghost" :icon="Trash2" :aria-label="`Remove line ${i + 1}`" @click="extra.splice(i, 1)" />
        </div>
        <KButton variant="subtle" size="sm" :icon="Plus" @click="extra.push({ description: '', amount: '', kind: 'charge' })">Add a line or discount</KButton>
      </section>

      <div class="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3">
        <span class="text-[13.5px] text-ink-muted">Total</span>
        <span class="text-[18px] font-semibold tabular-nums">{{ money(Math.max(total, 0)) }}</span>
      </div>

      <KTextarea v-model="form.notes" label="Notes for the family" :rows="2" optional />
      <KCheckbox v-model="form.issue" label="Issue now" description="The family sees it straight away and gets a notification. Leave unticked to save a draft." />
      <p v-if="error" class="text-[13px] text-danger-ink" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <KButton variant="secondary" @click="open = false">Cancel</KButton>
      <KButton type="submit" form="invoice-form" :loading="saving">{{ form.issue ? 'Create and issue' : 'Save draft' }}</KButton>
    </template>
  </KModal>
</template>
