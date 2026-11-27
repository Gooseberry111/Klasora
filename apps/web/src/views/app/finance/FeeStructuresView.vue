<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { Archive, ArchiveRestore, Landmark, Pencil, Plus, Receipt, Tags, Trash2 } from 'lucide-vue-next';
import {
  FEE_CATEGORIES,
  FEE_CATEGORY_LABELS,
  FEE_FREQUENCIES,
  FEE_FREQUENCY_LABELS,
  feeStructureSchema,
  validate,
  type Department,
  type FeeCategory,
  type FeeStructure,
  type FeeStructureInput,
  type FieldErrors,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KModal from '@/components/ui/KModal.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { deleteFeeStructure, listFeeStructures, saveFeeStructure, setFeeStatus, setPaymentInstructions } from '@/services/finance';
import { listDepartments } from '@/services/setup';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';
import { useFinance } from '@/composables/useFinance';

const { schoolId, slug, words, can, attempt, feedback } = useSchool();
const teaching = useTeaching();
const { school, currency, money, reloadSchool } = useFinance();

const yearId = ref('');
watch(teaching.currentYear, (y) => {
  if (!yearId.value && y) yearId.value = y.id;
}, { immediate: true });
watch(teaching.years, (ys) => {
  if (!yearId.value && ys.length) yearId.value = ys[0]!.id;
});

const fees = ref<FeeStructure[]>([]);
const departments = ref<Department[]>([]);
const loading = ref(true);
const showArchived = ref(false);

async function load() {
  if (!schoolId.value || !yearId.value) {
    loading.value = !teaching.loaded.value;
    return;
  }
  loading.value = true;
  [fees.value, departments.value] = await Promise.all([
    listFeeStructures(schoolId.value, yearId.value).catch(() => []),
    departments.value.length ? Promise.resolve(departments.value) : listDepartments(schoolId.value).catch(() => []),
  ]);
  loading.value = false;
}
watch([schoolId, yearId, () => teaching.loaded.value], load, { immediate: true });

const visible = computed(() => fees.value.filter((f) => showArchived.value || f.status === 'active'));
const groups = computed(() => {
  const map = new Map<FeeCategory, FeeStructure[]>();
  for (const f of visible.value) map.set(f.category, [...(map.get(f.category) ?? []), f]);
  return FEE_CATEGORIES.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
});
const archivedCount = computed(() => fees.value.filter((f) => f.status !== 'active').length);

/** What a student in a class with no special fees pays each term, from compulsory fees for everyone. */
const baseTermTotal = computed(() =>
  fees.value.filter((f) => f.status === 'active' && f.is_mandatory && f.frequency === 'per_term' && !f.term_id && !f.class_id && !f.department_id).reduce((s, f) => s + f.amount, 0),
);

function appliesTo(f: FeeStructure) {
  if (f.class_id) return teaching.className(f.class_id);
  if (f.department_id) return departments.value.find((d) => d.id === f.department_id)?.name ?? words.value.unit;
  return 'Every student';
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------
const open = ref(false);
const editing = ref<FeeStructure | null>(null);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const blank = (): FeeStructureInput => ({
  name: '', description: '', category: 'tuition', amount: '', currency: currency.value, frequency: 'per_term',
  academicYearId: yearId.value, termId: '', appliesTo: 'everyone', classId: '', departmentId: '', isMandatory: true,
});
const form = reactive<FeeStructureInput>(blank());

function openForm(fee?: FeeStructure) {
  editing.value = fee ?? null;
  Object.assign(form, blank());
  if (fee) {
    Object.assign(form, {
      name: fee.name, description: fee.description ?? '', category: fee.category, amount: String(fee.amount / 100), frequency: fee.frequency,
      academicYearId: fee.academic_year_id, termId: fee.term_id ?? '', isMandatory: fee.is_mandatory,
      appliesTo: fee.class_id ? 'class' : fee.department_id ? 'department' : 'everyone', classId: fee.class_id ?? '', departmentId: fee.department_id ?? '',
    });
  }
  errors.value = {};
  open.value = true;
}
watch(() => form.category, (c) => {
  if (editing.value) return;
  if (c === 'registration') form.frequency = 'once';
  if (c === 'transport' || c === 'accommodation' || c === 'feeding' || c === 'excursion') form.isMandatory = false;
});
watch(() => form.frequency, (f) => {
  if (f !== 'per_term') form.termId = '';
});

const termOptions = computed(() => [
  { value: '', label: `Every ${words.value.period.toLowerCase()}` },
  ...teaching.terms.value.filter((t) => t.academic_year_id === form.academicYearId).map((t) => ({ value: t.id, label: t.name })),
]);

async function submit() {
  const result = validate(feeStructureSchema, { ...form, currency: currency.value });
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const ok = await attempt(async () => {
    await saveFeeStructure(schoolId.value, result.data, editing.value?.id);
    return true;
  }, editing.value ? 'Fee updated.' : 'Fee added.');
  saving.value = false;
  if (ok) {
    open.value = false;
    if (form.academicYearId !== yearId.value) yearId.value = form.academicYearId;
    await load();
  }
}

async function toggleArchive(fee: FeeStructure) {
  await attempt(() => setFeeStatus(fee.id, fee.status === 'active' ? 'inactive' : 'active'), fee.status === 'active' ? 'Fee archived. It will not be added to new invoices.' : 'Fee restored.');
  await load();
}

async function remove(fee: FeeStructure) {
  const ok = await feedback.confirm({ title: `Delete ${fee.name}?`, description: 'Fees that are already on invoices cannot be deleted. Archive them instead.', confirmLabel: 'Delete', tone: 'danger' });
  if (!ok) return;
  await attempt(() => deleteFeeStructure(fee.id), 'Fee deleted.');
  await load();
}

// ---------------------------------------------------------------------------
// Payment instructions
// ---------------------------------------------------------------------------
const instructionsOpen = ref(false);
const instructions = ref('');
const savingInstructions = ref(false);
function editInstructions() {
  instructions.value = school.value?.payment_instructions ?? '';
  instructionsOpen.value = true;
}
async function saveInstructions() {
  savingInstructions.value = true;
  const ok = await attempt(async () => {
    await setPaymentInstructions(schoolId.value, instructions.value);
    return true;
  }, 'Payment instructions saved.');
  savingInstructions.value = false;
  if (ok) {
    instructionsOpen.value = false;
    await reloadSchool();
  }
}
</script>

<template>
  <div>
    <KPageHeader :icon="Tags" eyebrow="Finance" title="Fee structures" :description="`What your school charges, who pays it and how often. Invoices are built from this list each ${words.period.toLowerCase()}.`">
      <template #actions>
        <KButton v-if="can('finance.create') && teaching.years.value.length" :icon="Plus" @click="openForm()">New fee</KButton>
      </template>
    </KPageHeader>

    <KAlert v-if="teaching.loaded.value && !teaching.years.value.length" tone="info" class="mb-5" title="Set up your academic session first">
      Fees belong to an academic session. <RouterLink :to="{ name: 'academic-calendar', params: { slug } }" class="font-medium underline">Open academic sessions</RouterLink>
    </KAlert>

    <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div class="min-w-0 space-y-4">
        <div class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-end">
          <div class="sm:w-64">
            <KSelect v-model="yearId" label="Academic session" :options="teaching.years.value.map((y) => ({ value: y.id, label: y.name }))" placeholder="Choose" />
          </div>
          <KCheckbox v-if="archivedCount" v-model="showArchived" :label="`Show archived (${archivedCount})`" class="sm:ml-auto sm:pb-2" />
        </div>

        <KSkeleton v-if="loading" :lines="8" />

        <div v-else-if="!groups.length" class="rounded-card border border-line bg-surface shadow-card">
          <KEmptyState :icon="Tags" title="No fees for this session yet" description="Add tuition first, then other charges like examination fees, levies, transport or boarding.">
            <KButton v-if="can('finance.create')" :icon="Plus" @click="openForm()">Add your first fee</KButton>
          </KEmptyState>
        </div>

        <template v-else>
          <section v-for="g in groups" :key="g.category" class="rounded-card border border-line bg-surface shadow-card">
            <header class="flex items-center gap-2 border-b border-line px-5 py-3">
              <h2 class="text-[15px] font-semibold">{{ FEE_CATEGORY_LABELS[g.category] }}</h2>
              <span class="text-[12.5px] text-ink-muted">{{ g.items.length }}</span>
            </header>
            <ul class="divide-y divide-line">
              <li v-for="f in g.items" :key="f.id" :class="['flex flex-wrap items-center gap-3 px-5 py-3', f.status !== 'active' && 'opacity-60']">
                <div class="min-w-0 flex-1">
                  <p class="flex flex-wrap items-center gap-2 font-medium">
                    {{ f.name }}
                    <KBadge v-if="!f.is_mandatory" tone="info">Optional</KBadge>
                    <KBadge v-if="f.status !== 'active'">Archived</KBadge>
                  </p>
                  <p class="text-[12.5px] text-ink-muted">
                    {{ appliesTo(f) }}, {{ FEE_FREQUENCY_LABELS[f.frequency].label.toLowerCase() }}<template v-if="f.term_id">, {{ teaching.termLabel(f.term_id) }} only</template>
                  </p>
                </div>
                <span class="text-[15px] font-semibold tabular-nums">{{ money(f.amount) }}</span>
                <div class="flex gap-1">
                  <KButton v-if="can('finance.edit')" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${f.name}`" @click="openForm(f)" />
                  <KButton v-if="can('finance.edit')" size="sm" variant="ghost" :icon="f.status === 'active' ? Archive : ArchiveRestore" :aria-label="f.status === 'active' ? `Archive ${f.name}` : `Restore ${f.name}`" @click="toggleArchive(f)" />
                  <KButton v-if="can('finance.delete')" size="sm" variant="ghost" :icon="Trash2" class="text-danger-ink hover:bg-danger-soft" :aria-label="`Delete ${f.name}`" @click="remove(f)" />
                </div>
              </li>
            </ul>
          </section>
        </template>
      </div>

      <aside class="space-y-4">
        <div class="relative overflow-hidden rounded-card bg-gradient-to-br from-navy to-[#1E3A8A] p-5 text-white shadow-card">
          <KIconTile :icon="Receipt" tone="brand" solid />
          <p class="mt-4 text-[12.5px] text-white/70">Compulsory fees for every student, each {{ words.period.toLowerCase() }}</p>
          <p class="mt-1 text-[28px] font-semibold tabular-nums">{{ money(baseTermTotal) }}</p>
          <p class="mt-2 text-[12.5px] text-white/70">{{ words.groups }} with their own fees, one off charges and optional fees come on top.</p>
        </div>

        <KCard title="How families pay" :icon="Landmark" tone="success">
          <p v-if="school?.payment_instructions" class="text-[13.5px] whitespace-pre-line">{{ school.payment_instructions }}</p>
          <p v-else class="text-[13.5px] text-ink-muted">Add your bank details and bursary hours. They appear on invoices and on the parents' Fees page.</p>
          <KButton v-if="can('finance.edit')" size="sm" variant="secondary" class="mt-3" :icon="Pencil" @click="editInstructions">{{ school?.payment_instructions ? 'Edit' : 'Add instructions' }}</KButton>
        </KCard>
      </aside>
    </div>

    <KModal v-model:open="open" :title="editing ? 'Edit fee' : 'New fee'" description="Changes apply to invoices created from now on. Existing invoices keep their amounts." size="lg">
      <form id="fee-form" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submit">
        <div class="sm:col-span-2"><KInput v-model="form.name" label="Name" placeholder="Tuition" :error="errors.name" required autofocus /></div>
        <KSelect v-model="form.category" label="Type of fee" :options="FEE_CATEGORIES.map((c) => ({ value: c, label: FEE_CATEGORY_LABELS[c] }))" />
        <KInput v-model="form.amount" :label="`Amount (${currency})`" inputmode="decimal" placeholder="150,000" :error="errors.amount" required />
        <KSelect v-model="form.academicYearId" label="Academic session" :options="teaching.years.value.map((y) => ({ value: y.id, label: y.name }))" :error="errors.academicYearId" />
        <KSelect v-model="form.frequency" label="How often" :options="FEE_FREQUENCIES.map((f) => ({ value: f, label: FEE_FREQUENCY_LABELS[f].label }))" :hint="FEE_FREQUENCY_LABELS[form.frequency].description" />
        <KSelect v-if="form.frequency === 'per_term'" v-model="form.termId" :label="words.period" :options="termOptions" :error="errors.termId" />
        <KSelect
          v-model="form.appliesTo"
          label="Who pays it"
          :options="[
            { value: 'everyone', label: 'Every student' },
            { value: 'class', label: `One ${words.group.toLowerCase()}` },
            ...(departments.length ? [{ value: 'department', label: `One ${words.unit.toLowerCase()}` }] : []),
          ]"
        />
        <KSelect v-if="form.appliesTo === 'class'" v-model="form.classId" :label="words.group" :options="teaching.classes.value.map((c) => ({ value: c.id, label: c.name }))" placeholder="Choose" :error="errors.classId" />
        <KSelect v-if="form.appliesTo === 'department'" v-model="form.departmentId" :label="words.unit" :options="departments.map((d) => ({ value: d.id, label: d.name }))" placeholder="Choose" :error="errors.departmentId" />
        <div class="sm:col-span-2"><KTextarea v-model="form.description" label="Description" :rows="2" optional /></div>
        <div class="sm:col-span-2">
          <KCheckbox v-model="form.isMandatory" label="Compulsory" description="Compulsory fees are added to every invoice automatically. Optional fees, like the school bus, are added only for students who take them." />
        </div>
      </form>
      <template #footer>
        <KButton variant="secondary" @click="open = false">Cancel</KButton>
        <KButton type="submit" form="fee-form" :loading="saving">{{ editing ? 'Save changes' : 'Add fee' }}</KButton>
      </template>
    </KModal>

    <KModal v-model:open="instructionsOpen" title="How families pay" description="Shown on invoices and on the Fees page in the parent portal.">
      <form id="instructions-form" novalidate @submit.prevent="saveInstructions">
        <KTextarea v-model="instructions" label="Payment instructions" :rows="6" :maxlength="2000" placeholder="Pay into Greenfield Academy, Zenith Bank, account 1234567890. Use your child's admission number as the reference. The bursary is open 8am to 3pm on school days." />
      </form>
      <template #footer>
        <KButton variant="secondary" @click="instructionsOpen = false">Cancel</KButton>
        <KButton type="submit" form="instructions-form" :loading="savingInstructions">Save</KButton>
      </template>
    </KModal>
  </div>
</template>
