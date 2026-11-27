<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { AlertTriangle, Banknote, ChartColumnBig, Download, FileStack, Hourglass, Landmark, PiggyBank, ReceiptText, Table2, Users, Wallet } from 'lucide-vue-next';
import {
  FEE_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  collectionRate,
  monthLabel,
  toCsv,
  type FinanceSummary,
  type StudentBalanceRow,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KStatCard from '@/components/ui/KStatCard.vue';
import KCard from '@/components/ui/KCard.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KProgressRing from '@/components/ui/KProgressRing.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import { fetchFinanceSummary, fetchStudentBalances } from '@/services/finance';
import { downloadText, todayStamp } from '@/lib/download';
import { formatDay, useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';
import { useFinance } from '@/composables/useFinance';

const { schoolId, slug, words, can } = useSchool();
const teaching = useTeaching();
const { money } = useFinance();

const yearId = ref('');
const termId = ref('');
watch(teaching.currentYear, (y) => {
  if (!yearId.value && y) yearId.value = y.id;
}, { immediate: true });
watch(yearId, () => (termId.value = ''));

const summary = ref<FinanceSummary | null>(null);
const balances = ref<StudentBalanceRow[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  if (!schoolId.value || !teaching.loaded.value) return;
  loading.value = true;
  error.value = '';
  try {
    [summary.value, balances.value] = await Promise.all([
      fetchFinanceSummary(schoolId.value, yearId.value, termId.value),
      fetchStudentBalances(schoolId.value, { yearId: yearId.value, termId: termId.value }),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([schoolId, yearId, termId, () => teaching.loaded.value], load, { immediate: true });

const rate = computed(() => (summary.value ? collectionRate(summary.value.collected, summary.value.billed) : 0));
const debtors = computed(() => balances.value.filter((b) => b.balance > 0));

// Collections by month: one series, one hue, bars anchored to the baseline.
const chartHeight = 180;
const trend = computed(() => summary.value?.trend ?? []);
const trendMax = computed(() => Math.max(1, ...trend.value.map((t) => t.amount)));
const hovered = ref<number | null>(null);
const showTable = ref(false);
const barHeight = (amount: number) => (amount > 0 ? Math.max(4, Math.round((amount / trendMax.value) * chartHeight)) : 0);

const categoryMax = computed(() => Math.max(1, ...(summary.value?.by_category ?? []).map((c) => c.amount)));
const methodMax = computed(() => Math.max(1, ...(summary.value?.by_method ?? []).map((m) => m.amount)));

const periodLabel = computed(() => (termId.value ? teaching.termLabel(termId.value) : teaching.years.value.find((y) => y.id === yearId.value)?.name ?? 'All sessions'));

function exportBalances() {
  const rows = [
    ['Student', 'Admission number', words.value.group, 'Invoices', 'Billed', 'Paid', 'Balance', 'Overdue', 'Last payment'],
    ...balances.value.map((b) => [
      `${b.first_name} ${b.last_name}`, b.admission_number, b.class_name ?? '', b.invoices, (b.billed / 100).toFixed(2), (b.paid / 100).toFixed(2),
      (b.balance / 100).toFixed(2), (b.overdue / 100).toFixed(2), b.last_payment ?? '',
    ]),
  ];
  downloadText(`fee_balances_${todayStamp()}.csv`, toCsv(rows));
}

function exportClasses() {
  const rows = [
    [words.value.group, 'Students', 'Billed', 'Collected', 'Outstanding', 'Collected %'],
    ...(summary.value?.by_class ?? []).map((c) => [c.name, c.students, (c.billed / 100).toFixed(2), (c.collected / 100).toFixed(2), (c.outstanding / 100).toFixed(2), collectionRate(c.collected, c.billed)]),
  ];
  downloadText(`fees_by_class_${todayStamp()}.csv`, toCsv(rows));
}
</script>

<template>
  <div>
    <KPageHeader :icon="ChartColumnBig" eyebrow="Finance" title="Financial reports" description="What has been billed, what has come in and who still owes, by class, fee type and month.">
      <template #actions>
        <KButton v-if="can('finance.export') && balances.length" variant="secondary" :icon="Download" @click="exportBalances">Export balances</KButton>
      </template>
    </KPageHeader>

    <div class="mb-5 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row">
      <div class="sm:w-64">
        <KSelect v-model="yearId" label="Academic session" :options="[{ value: '', label: 'All sessions' }, ...teaching.years.value.map((y) => ({ value: y.id, label: y.name }))]" />
      </div>
      <div class="sm:w-64">
        <KSelect
          v-model="termId"
          :label="words.period"
          :options="[{ value: '', label: `Every ${words.period.toLowerCase()}` }, ...teaching.terms.value.filter((t) => !yearId || t.academic_year_id === yearId).map((t) => ({ value: t.id, label: t.name }))]"
        />
      </div>
    </div>

    <KAlert v-if="error" tone="danger" class="mb-5">{{ error }}</KAlert>
    <KSkeleton v-if="loading && !summary" :lines="12" />

    <template v-else-if="summary">
      <div v-if="summary.pending_payments || summary.drafts" class="mb-5 grid gap-3 md:grid-cols-2">
        <RouterLink v-if="summary.pending_payments" :to="{ name: 'payments', params: { slug }, query: { tab: 'pending' } }" class="flex items-center gap-3 rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-warning-ink hover:brightness-[0.98]">
          <Hourglass :size="18" aria-hidden="true" />
          <span class="text-[13.5px]"><strong>{{ summary.pending_payments }}</strong> payment{{ summary.pending_payments === 1 ? '' : 's' }} worth <strong>{{ money(summary.pending_amount) }}</strong> waiting for approval</span>
        </RouterLink>
        <RouterLink v-if="summary.drafts" :to="{ name: 'invoices', params: { slug } }" class="flex items-center gap-3 rounded-card border border-info/30 bg-info-soft px-4 py-3 text-info-ink hover:brightness-[0.98]">
          <FileStack :size="18" aria-hidden="true" />
          <span class="text-[13.5px]"><strong>{{ summary.drafts }}</strong> draft invoice{{ summary.drafts === 1 ? '' : 's' }} not yet issued to families</span>
        </RouterLink>
      </div>

      <!-- Headline -->
      <section class="relative mb-6 overflow-hidden rounded-card bg-gradient-to-br from-navy to-[#1E3A8A] p-6 text-white shadow-card">
        <div class="flex flex-col gap-6 md:flex-row md:items-center">
          <KProgressRing :value="rate" :size="112" :stroke="10" light />
          <div class="flex-1">
            <p class="text-[13px] text-white/70">{{ periodLabel }}</p>
            <p class="mt-1 text-[30px] leading-tight font-semibold tabular-nums">{{ rate }}% collected</p>
            <p class="mt-1 text-[14px] text-white/80">{{ money(summary.collected) }} of {{ money(summary.billed) }} billed across {{ summary.invoices }} invoices</p>
          </div>
          <div class="grid grid-cols-2 gap-6 md:text-right">
            <div>
              <p class="text-[12.5px] text-white/70">Still owed</p>
              <p class="text-[20px] font-semibold tabular-nums">{{ money(summary.outstanding) }}</p>
            </div>
            <div>
              <p class="text-[12.5px] text-white/70">Fully paid</p>
              <p class="text-[20px] font-semibold tabular-nums">{{ summary.paid_invoices }} of {{ summary.invoices }}</p>
            </div>
          </div>
        </div>
      </section>

      <div class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KStatCard label="Billed" :value="money(summary.billed)" :detail="`${summary.invoices} invoices issued`" :icon="ReceiptText" tone="brand" />
        <KStatCard label="Collected" :value="money(summary.collected)" :detail="`${rate}% of what was billed`" :icon="PiggyBank" tone="success" />
        <KStatCard label="Overdue" :value="money(summary.overdue_amount)" :detail="`${summary.overdue_count} invoices past their due date`" :icon="AlertTriangle" tone="warning" />
        <KStatCard label="Students owing" :value="summary.students_owing" :detail="summary.credit ? `${money(summary.credit)} held as credit` : 'Students with a balance'" :icon="Users" tone="violet" />
      </div>

      <div class="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div class="min-w-0 space-y-6">
          <!-- Collections trend -->
          <section class="rounded-card border border-line bg-surface shadow-card">
            <header class="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
              <div class="flex-1">
                <h2 class="text-[15px] font-semibold">Money collected each month</h2>
                <p class="text-[12.5px] text-ink-muted">Confirmed payments over the last twelve months, for the whole school.</p>
              </div>
              <KButton size="sm" variant="ghost" :icon="showTable ? ChartColumnBig : Table2" @click="showTable = !showTable">{{ showTable ? 'Show chart' : 'Show table' }}</KButton>
            </header>
            <div v-if="showTable" class="overflow-x-auto">
              <table class="k-table">
                <thead><tr><th scope="col">Month</th><th scope="col" class="text-right">Collected</th></tr></thead>
                <tbody>
                  <tr v-for="t in trend" :key="t.month"><td>{{ monthLabel(t.month) }} {{ t.month.slice(0, 4) }}</td><td class="text-right tabular-nums">{{ money(t.amount) }}</td></tr>
                </tbody>
              </table>
            </div>
            <div v-else class="px-5 pt-4 pb-5">
              <div class="mb-3 h-10">
                <template v-if="hovered !== null && trend[hovered]">
                  <p class="text-[12.5px] text-ink-muted">{{ monthLabel(trend[hovered]!.month) }} {{ trend[hovered]!.month.slice(0, 4) }}</p>
                  <p class="text-[17px] font-semibold tabular-nums">{{ money(trend[hovered]!.amount) }}</p>
                </template>
                <template v-else>
                  <p class="text-[12.5px] text-ink-muted">Highest month</p>
                  <p class="text-[17px] font-semibold tabular-nums">{{ money(trendMax === 1 ? 0 : trendMax) }}</p>
                </template>
              </div>
              <div class="relative" :style="{ height: `${chartHeight}px` }">
                <div class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" aria-hidden="true" />
                <div class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" aria-hidden="true" />
                <div class="absolute inset-0 flex items-end gap-[2px] border-b border-line" role="list" aria-label="Money collected each month">
                  <button
                    v-for="(t, i) in trend"
                    :key="t.month"
                    type="button"
                    role="listitem"
                    class="group flex h-full flex-1 items-end justify-center focus:outline-none"
                    :aria-label="`${monthLabel(t.month)} ${t.month.slice(0, 4)}: ${money(t.amount)}`"
                    @mouseenter="hovered = i"
                    @mouseleave="hovered = null"
                    @focus="hovered = i"
                    @blur="hovered = null"
                  >
                    <span
                      :class="['w-full max-w-9 rounded-t-[4px] transition-colors', hovered === i ? 'bg-brand-ink' : 'bg-brand group-focus-visible:bg-brand-ink']"
                      :style="{ height: `${barHeight(t.amount)}px` }"
                    />
                  </button>
                </div>
              </div>
              <div class="mt-2 flex gap-[2px]" aria-hidden="true">
                <span v-for="t in trend" :key="t.month" class="flex-1 text-center text-[11px] text-ink-subtle">{{ monthLabel(t.month) }}</span>
              </div>
            </div>
          </section>

          <!-- By class -->
          <section class="rounded-card border border-line bg-surface shadow-card">
            <header class="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
              <div class="flex-1">
                <h2 class="text-[15px] font-semibold">By {{ words.group.toLowerCase() }}</h2>
                <p class="text-[12.5px] text-ink-muted">How much of each {{ words.group.toLowerCase() }}'s fees have come in.</p>
              </div>
              <KButton v-if="can('finance.export') && summary.by_class.length" size="sm" variant="ghost" :icon="Download" @click="exportClasses">Export</KButton>
            </header>
            <KEmptyState v-if="!summary.by_class.length" :icon="Banknote" title="No invoices issued yet" description="Once invoices are issued, each class's collection appears here." />
            <div v-else class="overflow-x-auto">
              <table class="k-table">
                <thead>
                  <tr>
                    <th scope="col">{{ words.group }}</th>
                    <th scope="col" class="text-right">Students</th>
                    <th scope="col" class="text-right">Billed</th>
                    <th scope="col" class="text-right">Outstanding</th>
                    <th scope="col" class="w-48">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in summary.by_class" :key="c.class_id">
                    <td class="font-medium">{{ c.name }}</td>
                    <td class="text-right tabular-nums">{{ c.students }}</td>
                    <td class="text-right tabular-nums">{{ money(c.billed) }}</td>
                    <td class="text-right tabular-nums">{{ money(c.outstanding) }}</td>
                    <td>
                      <div class="flex items-center gap-2" :title="`${money(c.collected)} collected`">
                        <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                          <div class="h-full rounded-full bg-brand" :style="{ width: `${collectionRate(c.collected, c.billed)}%` }" />
                        </div>
                        <span class="w-10 text-right text-[12.5px] font-medium tabular-nums">{{ collectionRate(c.collected, c.billed) }}%</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Debtors -->
          <section class="rounded-card border border-line bg-surface shadow-card">
            <header class="border-b border-line px-5 py-4">
              <h2 class="text-[15px] font-semibold">Largest balances</h2>
              <p class="text-[12.5px] text-ink-muted">Students who still owe, largest first. Export for the full list.</p>
            </header>
            <p v-if="!debtors.length" class="px-5 py-4 text-[13.5px] text-ink-muted">Nobody owes anything for this period.</p>
            <ul v-else class="divide-y divide-line">
              <li v-for="b in debtors.slice(0, 10)" :key="b.student_id">
                <RouterLink :to="{ name: 'student-detail', params: { slug, studentId: b.student_id }, query: { tab: 'finance' } }" class="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/50">
                  <KAvatar :name="`${b.first_name} ${b.last_name}`" :size="34" />
                  <div class="min-w-0 flex-1">
                    <p class="font-medium">{{ b.first_name }} {{ b.last_name }}</p>
                    <p class="text-[12.5px] text-ink-muted">
                      {{ b.class_name ?? 'No class' }}, {{ b.last_payment ? `last paid ${formatDay(b.last_payment)}` : 'no payments yet' }}
                    </p>
                  </div>
                  <div class="text-right">
                    <p class="font-semibold tabular-nums">{{ money(b.balance) }}</p>
                    <p v-if="b.overdue" class="text-[12px] text-danger-ink tabular-nums">{{ money(b.overdue) }} overdue</p>
                  </div>
                </RouterLink>
              </li>
            </ul>
          </section>
        </div>

        <aside class="space-y-6">
          <KCard title="Billed by fee type" :icon="ReceiptText" tone="brand">
            <p v-if="!summary.by_category.length" class="text-[13.5px] text-ink-muted">Nothing billed yet.</p>
            <ul v-else class="space-y-3">
              <li v-for="c in summary.by_category.filter((x) => x.category !== 'discount')" :key="c.category" :title="money(c.amount)">
                <div class="mb-1 flex justify-between text-[13px]">
                  <span>{{ FEE_CATEGORY_LABELS[c.category] ?? c.category }}</span>
                  <span class="font-medium tabular-nums">{{ money(c.amount) }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div class="h-full rounded-full bg-brand" :style="{ width: `${Math.max(2, (c.amount / categoryMax) * 100)}%` }" />
                </div>
              </li>
              <li v-for="c in summary.by_category.filter((x) => x.category === 'discount')" :key="c.category" class="flex justify-between border-t border-line pt-3 text-[13px]">
                <span class="text-ink-muted">Discounts given</span>
                <span class="font-medium tabular-nums">{{ money(Math.abs(c.amount)) }}</span>
              </li>
            </ul>
          </KCard>

          <KCard title="How families paid" description="Confirmed payments in the last twelve months." :icon="Wallet" tone="success">
            <p v-if="!summary.by_method.length" class="text-[13.5px] text-ink-muted">No payments yet.</p>
            <ul v-else class="space-y-3">
              <li v-for="m in summary.by_method" :key="m.method" :title="`${m.payments} payments`">
                <div class="mb-1 flex justify-between text-[13px]">
                  <span>{{ PAYMENT_METHOD_LABELS[m.method] }} <span class="text-ink-muted">({{ m.payments }})</span></span>
                  <span class="font-medium tabular-nums">{{ money(m.amount) }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div class="h-full rounded-full bg-success" :style="{ width: `${Math.max(2, (m.amount / methodMax) * 100)}%` }" />
                </div>
              </li>
            </ul>
          </KCard>

          <RouterLink :to="{ name: 'fee-structures', params: { slug } }" class="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card hover:bg-surface-muted/50">
            <Landmark :size="18" class="text-brand" aria-hidden="true" />
            <span class="text-[13.5px] font-medium">Review fee structures and payment instructions</span>
          </RouterLink>
        </aside>
      </div>
    </template>
  </div>
</template>
