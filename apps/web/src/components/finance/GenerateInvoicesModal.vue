<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ArrowLeft, Eye, FileStack, Send } from 'lucide-vue-next';
import type { InvoiceRunRow } from '@klasora/shared';
import KModal from '@/components/ui/KModal.vue';
import KButton from '@/components/ui/KButton.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { generateInvoices } from '@/services/finance';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';
import { daysFromToday, useFinance } from '@/composables/useFinance';

/** Bills every active student in the chosen classes for a term, after a preview. */
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ done: [] }>();

const { words, attempt, feedback } = useSchool();
const teaching = useTeaching();
const { money } = useFinance();

const form = reactive({ termId: '', everyClass: true, classIds: [] as string[], dueDate: daysFromToday(21) });
const step = ref<'choose' | 'preview'>('choose');
const preview = ref<InvoiceRunRow[]>([]);
const working = ref(false);
const error = ref('');

watch(open, (v) => {
  if (!v) return;
  Object.assign(form, { termId: teaching.currentTerm.value?.id ?? teaching.terms.value[0]?.id ?? '', everyClass: true, classIds: [], dueDate: daysFromToday(21) });
  step.value = 'choose';
  preview.value = [];
  error.value = '';
});

const activeClasses = computed(() => teaching.classes.value.filter((c) => c.status === 'active'));
function toggleClass(id: string, on: boolean) {
  form.classIds = on ? [...form.classIds, id] : form.classIds.filter((x) => x !== id);
}
const classIds = computed(() => (form.everyClass ? null : form.classIds));

const totals = computed(() => ({
  invoices: preview.value.reduce((s, r) => s + r.invoices, 0),
  skipped: preview.value.reduce((s, r) => s + r.skipped, 0),
  amount: preview.value.reduce((s, r) => s + r.total_amount, 0),
}));

async function runPreview() {
  error.value = '';
  if (!form.termId) return void (error.value = `Choose the ${words.value.period.toLowerCase()}.`);
  if (!form.everyClass && !form.classIds.length) return void (error.value = `Choose at least one ${words.value.group.toLowerCase()}.`);
  if (!form.dueDate) return void (error.value = 'Choose a due date.');
  working.value = true;
  const rows = await attempt(() => generateInvoices({ termId: form.termId, classIds: classIds.value, dueDate: form.dueDate, issue: false, dryRun: true }));
  working.value = false;
  if (rows) {
    preview.value = rows;
    step.value = 'preview';
  }
}

async function create(issue: boolean) {
  if (issue) {
    const ok = await feedback.confirm({
      title: `Issue ${totals.value.invoices} invoices?`,
      description: 'Families who use the parent portal will see them straight away and get a notification.',
      confirmLabel: 'Issue invoices',
      tone: 'primary',
    });
    if (!ok) return;
  }
  working.value = true;
  const rows = await attempt(
    () => generateInvoices({ termId: form.termId, classIds: classIds.value, dueDate: form.dueDate, issue, dryRun: false }),
    issue ? 'Invoices issued. Families have been notified.' : 'Draft invoices created. Review them, then issue.',
  );
  working.value = false;
  if (rows) {
    open.value = false;
    emit('done');
  }
}
</script>

<template>
  <KModal v-model:open="open" title="Generate invoices" :description="`Bills every active student from your fee structures. Students who already have an invoice for the ${words.period.toLowerCase()} are skipped.`" size="lg">
    <div v-if="step === 'choose'" class="space-y-5">
      <div class="grid gap-4 sm:grid-cols-2">
        <KSelect v-model="form.termId" :label="words.period" :options="teaching.terms.value.map((t) => ({ value: t.id, label: teaching.termLabel(t.id) }))" placeholder="Choose" />
        <KInput v-model="form.dueDate" type="date" label="Due date" required />
      </div>
      <div class="rounded-card border border-line p-4">
        <KCheckbox v-model="form.everyClass" :label="`Every ${words.group.toLowerCase()}`" :description="`${activeClasses.length} active ${words.groups.toLowerCase()}`" />
        <div v-if="!form.everyClass" class="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-3">
          <KCheckbox v-for="c in activeClasses" :key="c.id" :model-value="form.classIds.includes(c.id)" :label="c.name" @update:model-value="toggleClass(c.id, $event)" />
        </div>
      </div>
      <p v-if="error" class="text-[13px] text-danger-ink" role="alert">{{ error }}</p>
    </div>

    <div v-else class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl bg-brand-soft/60 p-4">
          <p class="text-[12.5px] text-ink-muted">Invoices to create</p>
          <p class="text-[22px] font-semibold tabular-nums">{{ totals.invoices }}</p>
        </div>
        <div class="rounded-xl bg-surface-muted p-4">
          <p class="text-[12.5px] text-ink-muted">Total to bill</p>
          <p class="text-[22px] font-semibold tabular-nums">{{ money(totals.amount) }}</p>
        </div>
        <div class="rounded-xl bg-surface-muted p-4">
          <p class="text-[12.5px] text-ink-muted">Skipped</p>
          <p class="text-[22px] font-semibold tabular-nums">{{ totals.skipped }}</p>
        </div>
      </div>
      <div class="overflow-x-auto rounded-card border border-line">
        <table class="k-table">
          <thead>
            <tr>
              <th scope="col">{{ words.group }}</th>
              <th scope="col" class="text-right">Students</th>
              <th scope="col" class="text-right">New invoices</th>
              <th scope="col" class="text-right">Skipped</th>
              <th scope="col" class="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in preview" :key="r.class_id">
              <td class="font-medium">{{ r.class_name }}</td>
              <td class="text-right tabular-nums">{{ r.students }}</td>
              <td class="text-right tabular-nums">{{ r.invoices }}</td>
              <td class="text-right text-ink-muted tabular-nums">{{ r.skipped }}</td>
              <td class="text-right font-medium tabular-nums">{{ money(r.total_amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <KAlert v-if="!totals.invoices" tone="warning" title="Nothing to bill">
        Either every student already has an invoice for this {{ words.period.toLowerCase() }}, or no compulsory fees apply. Check your fee structures.
      </KAlert>
      <p v-else class="text-[12.5px] text-ink-muted">Skipped students already have an invoice for this {{ words.period.toLowerCase() }}, or have no fees that apply to them.</p>
    </div>

    <template #footer>
      <template v-if="step === 'choose'">
        <KButton variant="secondary" @click="open = false">Cancel</KButton>
        <KButton :icon="Eye" :loading="working" @click="runPreview">Preview</KButton>
      </template>
      <template v-else>
        <KButton variant="ghost" :icon="ArrowLeft" class="mr-auto" @click="step = 'choose'">Back</KButton>
        <KButton variant="secondary" :icon="FileStack" :disabled="!totals.invoices" :loading="working" @click="create(false)">Create drafts</KButton>
        <KButton :icon="Send" :disabled="!totals.invoices" :loading="working" @click="create(true)">Create and issue</KButton>
      </template>
    </template>
  </KModal>
</template>
