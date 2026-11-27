<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { Hourglass, Wallet } from 'lucide-vue-next';
import { collectionRate, invoiceDisplayStatus, type FinanceSummary, type Invoice } from '@klasora/shared';
import KCard from '@/components/ui/KCard.vue';
import KButton from '@/components/ui/KButton.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KProgressRing from '@/components/ui/KProgressRing.vue';
import { fetchFinanceSummary, listFamilyInvoices } from '@/services/finance';
import { formatDay, useSchool } from '@/composables/useSchool';
import { todayIso, useFinance } from '@/composables/useFinance';

/**
 * Dashboard card. Finance staff see the school's collection for the current
 * session; parents see what they owe for their children. Nobody else sees it.
 */
const props = defineProps<{ yearId?: string | null }>();
const { schoolId, slug, can, workspace } = useSchool();
const { money } = useFinance();

const mode = computed(() => (can('finance.view') ? 'school' : workspace.isGuardian ? 'family' : null));
const summary = ref<FinanceSummary | null>(null);
const invoices = ref<Invoice[]>([]);
const loading = ref(true);

async function load() {
  if (!schoolId.value || !mode.value) return;
  loading.value = true;
  if (mode.value === 'school') summary.value = await fetchFinanceSummary(schoolId.value, props.yearId ?? undefined).catch(() => null);
  else invoices.value = await listFamilyInvoices(workspace.children.map((c) => c.student_id)).catch(() => []);
  loading.value = false;
}
watch([schoolId, mode, () => props.yearId, () => workspace.children.length], load, { immediate: true });

const rate = computed(() => (summary.value ? collectionRate(summary.value.collected, summary.value.billed) : 0));
const owing = computed(() => invoices.value.filter((i) => i.balance > 0 && (i.status === 'issued' || i.status === 'part_paid')));
const familyOwed = computed(() => owing.value.reduce((s, i) => s + i.balance, 0));
const overdue = computed(() => owing.value.filter((i) => invoiceDisplayStatus(i, todayIso()) === 'overdue'));
const nextDue = computed(() => [...owing.value].sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null);
</script>

<template>
  <KCard v-if="mode" :icon="Wallet" tone="success" :title="mode === 'school' ? 'Fees this session' : 'School fees'">
    <template #actions>
      <KButton size="sm" variant="ghost" :to="{ name: mode === 'school' ? 'finance' : 'fees', params: { slug } }">Open</KButton>
    </template>
    <KSkeleton v-if="loading" :lines="3" />

    <template v-else-if="mode === 'school' && summary">
      <div v-if="!summary.invoices" class="text-[13.5px] text-ink-muted">No invoices issued yet this session.</div>
      <div v-else class="flex items-center gap-4">
        <KProgressRing :value="rate" :size="72" />
        <div class="min-w-0">
          <p class="text-[12.5px] text-ink-muted">{{ rate }}% collected</p>
          <p class="text-[20px] font-semibold tabular-nums">{{ money(summary.outstanding) }}</p>
          <p class="text-[12.5px] text-ink-muted">still owed by {{ summary.students_owing }} student{{ summary.students_owing === 1 ? '' : 's' }}</p>
        </div>
      </div>
      <RouterLink
        v-if="summary.pending_payments"
        :to="{ name: 'payments', params: { slug }, query: { tab: 'pending' } }"
        class="mt-4 flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning-ink"
      >
        <Hourglass :size="15" aria-hidden="true" />
        {{ summary.pending_payments }} payment{{ summary.pending_payments === 1 ? '' : 's' }} waiting for approval
      </RouterLink>
    </template>

    <template v-else-if="mode === 'family'">
      <p v-if="!invoices.length" class="text-[13.5px] text-ink-muted">No invoices from the school yet.</p>
      <template v-else>
        <p class="text-[12.5px] text-ink-muted">{{ familyOwed ? 'Outstanding' : 'All paid' }}</p>
        <p class="text-[24px] font-semibold tabular-nums">{{ money(familyOwed) }}</p>
        <p v-if="overdue.length" class="mt-1 text-[13px] font-medium text-danger-ink">{{ overdue.length }} invoice{{ overdue.length === 1 ? ' is' : 's are' }} past the due date</p>
        <p v-else-if="nextDue" class="mt-1 text-[13px] text-ink-muted">Next due {{ formatDay(nextDue.due_date) }}</p>
      </template>
    </template>
  </KCard>
</template>
