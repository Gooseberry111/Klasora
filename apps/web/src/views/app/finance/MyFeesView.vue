<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Baby, Landmark, Wallet } from 'lucide-vue-next';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KCard from '@/components/ui/KCard.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import StudentFinanceTab from '@/components/finance/StudentFinanceTab.vue';
import { useSchool } from '@/composables/useSchool';
import { useFinance } from '@/composables/useFinance';

/** Parent portal: invoices, payments and receipts for each child, and how to pay. */
const { workspace } = useSchool();
const { school } = useFinance();

const childId = ref('');
watch(() => workspace.children, (kids) => {
  if (!kids.some((k) => k.student_id === childId.value)) childId.value = kids[0]?.student_id ?? '';
}, { immediate: true });
const child = computed(() => workspace.children.find((k) => k.student_id === childId.value) ?? null);
</script>

<template>
  <div>
    <KPageHeader :icon="Wallet" eyebrow="Parent portal" title="Fees" :description="`Invoices, payments and receipts from ${workspace.currentSchool?.name ?? 'the school'}.`" />

    <div v-if="!workspace.children.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="Baby" title="No children are linked to you yet" description="Ask the school office to link your account to your child's record." />
    </div>

    <div v-else class="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div class="min-w-0 space-y-5">
        <div v-if="workspace.children.length > 1" class="flex flex-wrap gap-2" role="tablist" aria-label="Choose a child">
          <button
            v-for="k in workspace.children"
            :key="k.student_id"
            type="button"
            role="tab"
            :aria-selected="k.student_id === childId"
            :class="[
              'flex items-center gap-2 rounded-full border py-1.5 pr-4 pl-1.5 text-[13.5px] font-medium transition',
              k.student_id === childId ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface hover:bg-surface-muted',
            ]"
            @click="childId = k.student_id"
          >
            <KAvatar :name="`${k.first_name} ${k.last_name}`" :size="26" />
            {{ k.first_name }}
          </button>
        </div>

        <StudentFinanceTab
          v-if="child"
          :key="child.student_id"
          :student-id="child.student_id"
          :student-name="`${child.first_name} ${child.last_name}`"
          :admission-number="child.admission_number"
          :class-name="child.class_name ?? ''"
        />
      </div>

      <aside>
        <KCard title="How to pay" :icon="Landmark" tone="success">
          <p v-if="school?.payment_instructions" class="text-[13.5px] whitespace-pre-line">{{ school.payment_instructions }}</p>
          <p v-else class="text-[13.5px] text-ink-muted">Please ask the school bursary how to pay.</p>
          <p class="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-muted">
            Once the school confirms your payment, it appears here with a receipt you can download.
          </p>
        </KCard>
      </aside>
    </div>
  </div>
</template>
