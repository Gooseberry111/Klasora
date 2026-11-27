<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RotateCcw, Upload } from 'lucide-vue-next';
import { STUDENT_IMPORT_COLUMNS, formatDmy, parseCsv, readStudentImport, studentImportTemplate, type ImportRow } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { importStudents } from '@/services/students';
import { downloadText } from '@/lib/download';
import { useSchool } from '@/composables/useSchool';

const router = useRouter();
const { schoolId, slug, words, feedback } = useSchool();

const fileName = ref('');
const rows = ref<ImportRow[]>([]);
const missingColumns = ref<string[]>([]);
const unknownHeaders = ref<string[]>([]);
const readError = ref('');
const importError = ref('');
const importing = ref(false);
const dragging = ref(false);

const invalid = computed(() => rows.value.filter((r) => r.errors.length));
const ready = computed(() => rows.value.length > 0 && invalid.value.length === 0 && missingColumns.value.length === 0);
// Rows with problems come first so none are hidden past the preview limit.
const preview = computed(() => [...invalid.value, ...rows.value.filter((r) => !r.errors.length)].slice(0, 200));

function reset() {
  fileName.value = '';
  rows.value = [];
  missingColumns.value = [];
  unknownHeaders.value = [];
  readError.value = '';
  importError.value = '';
}

async function readFile(file: File | undefined) {
  reset();
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    readError.value = 'Choose a CSV file. In Excel or Google Sheets, use File, then Save as or Download, and pick CSV.';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    readError.value = 'This file is larger than 2 MB. Split it into smaller files.';
    return;
  }
  fileName.value = file.name;
  const table = parseCsv(await file.text());
  if (table.length < 2) {
    readError.value = 'This file has no students in it. The first row should be the column names.';
    return;
  }
  if (table.length > 1001) {
    readError.value = 'Import up to 1,000 students at a time. Split the file and import each part.';
    return;
  }
  const result = readStudentImport(table);
  rows.value = result.rows;
  missingColumns.value = result.missingColumns;
  unknownHeaders.value = result.unknownHeaders;
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  void readFile(event.dataTransfer?.files?.[0]);
}

async function submit() {
  importing.value = true;
  importError.value = '';
  try {
    const count = await importStudents(
      schoolId.value,
      rows.value.map((r) => Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== ''))),
    );
    feedback.success(`${count} student${count === 1 ? '' : 's'} imported.`);
    await router.push({ name: 'students', params: { slug: slug.value } });
  } catch (e) {
    importError.value = (e as Error).message;
  } finally {
    importing.value = false;
  }
}

function downloadTemplate() {
  downloadText('klasora_student_import_template.csv', studentImportTemplate());
}
</script>

<template>
  <div class="mx-auto max-w-[1100px]">
    <KPageHeader
      :icon="FileSpreadsheet"
      title="Import students"
      description="Bring in your whole register from a spreadsheet. Nothing is saved until every row is correct."
      :breadcrumbs="[{ label: 'Students', to: { name: 'students', params: { slug } } }, { label: 'Import' }]"
    >
      <template #actions>
        <KButton variant="secondary" :icon="Download" @click="downloadTemplate">Download template</KButton>
      </template>
    </KPageHeader>

    <div v-if="!rows.length" class="grid gap-6 lg:grid-cols-[1fr_340px]">
      <label
        :class="[
          'flex cursor-pointer flex-col items-center justify-center rounded-[20px] border-2 border-dashed p-12 text-center transition-colors',
          dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface hover:border-brand/60',
        ]"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <KIconTile :icon="Upload" solid :size="56" />
        <p class="mt-5 text-[16px] font-semibold">Drop your CSV file here</p>
        <p class="mt-1 text-[13.5px] text-ink-muted">or click to choose a file</p>
        <input type="file" accept=".csv,text/csv" class="sr-only" @change="readFile(($event.target as HTMLInputElement).files?.[0])" />
        <KAlert v-if="readError" tone="danger" class="mt-6 text-left">{{ readError }}</KAlert>
      </label>

      <KCard title="How it works" :icon="CheckCircle2" tone="success">
        <ol class="list-decimal space-y-2.5 pl-4 text-[13.5px] text-ink-muted">
          <li>Download the template, or use your own spreadsheet with a header row.</li>
          <li>Only <strong class="text-ink">First name</strong> and <strong class="text-ink">Last name</strong> are required.</li>
          <li>Write dates as DD/MM/YYYY, like 14/03/2014.</li>
          <li>The {{ words.group.toLowerCase() }} must match a {{ words.group.toLowerCase() }} name in Klasora, like JSS 1A.</li>
          <li>Leave admission numbers empty and Klasora will create them.</li>
          <li>Guardians with the same email are linked to all their children.</li>
        </ol>
        <p class="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-muted">
          Recognised columns: {{ STUDENT_IMPORT_COLUMNS.map((c) => c.header).join(', ') }}.
        </p>
      </KCard>
    </div>

    <template v-else>
      <div class="mb-5 flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center">
        <KIconTile :icon="FileSpreadsheet" :tone="ready ? 'success' : 'warning'" solid :size="46" />
        <div class="flex-1">
          <p class="font-semibold">{{ fileName }}</p>
          <p class="text-[13.5px] text-ink-muted">
            {{ rows.length }} student{{ rows.length === 1 ? '' : 's' }} found.
            <span v-if="invalid.length" class="font-medium text-danger-ink">{{ invalid.length }} need{{ invalid.length === 1 ? 's' : '' }} fixing.</span>
            <span v-else-if="ready" class="font-medium text-success-ink">Everything looks good.</span>
          </p>
        </div>
        <div class="flex gap-2">
          <KButton variant="ghost" :icon="RotateCcw" @click="reset">Choose another file</KButton>
          <KButton :disabled="!ready" :loading="importing" :icon="Upload" @click="submit">Import {{ rows.length }}</KButton>
        </div>
      </div>

      <KAlert v-if="missingColumns.length" tone="danger" title="Some required columns are missing" class="mb-5">
        Add these columns to your file: {{ missingColumns.join(', ') }}.
      </KAlert>
      <KAlert v-if="unknownHeaders.length" tone="info" class="mb-5">These columns will be ignored: {{ unknownHeaders.join(', ') }}.</KAlert>
      <KAlert v-if="invalid.length" tone="warning" title="Fix these rows in your spreadsheet, then choose the file again" class="mb-5">
        Nothing has been saved yet.
      </KAlert>
      <KAlert v-if="importError" tone="danger" title="Nothing was imported" class="mb-5">{{ importError }}</KAlert>

      <div class="rounded-card border border-line bg-surface shadow-card">
        <div class="overflow-x-auto">
          <table class="k-table">
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Student</th>
                <th scope="col">Gender</th>
                <th scope="col">Born</th>
                <th scope="col">{{ words.group }}</th>
                <th scope="col">Guardian</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in preview" :key="row.line" :class="row.errors.length ? 'bg-danger-soft/40' : ''">
                <td class="text-ink-muted tabular-nums">{{ row.line }}</td>
                <td>
                  <span class="font-medium">{{ [row.values.first_name, row.values.middle_name, row.values.last_name].filter(Boolean).join(' ') || 'No name' }}</span>
                  <span v-if="row.values.admission_number" class="block text-[12.5px] text-ink-muted">{{ row.values.admission_number }}</span>
                </td>
                <td class="text-ink-muted capitalize">{{ row.values.gender }}</td>
                <td class="text-ink-muted tabular-nums">{{ formatDmy(row.values.date_of_birth) }}</td>
                <td>{{ row.values.class }}</td>
                <td class="text-ink-muted">
                  {{ [row.values.guardian_first_name, row.values.guardian_last_name].filter(Boolean).join(' ') }}
                  <span class="block text-[12.5px]">{{ row.values.guardian_email || row.values.guardian_phone }}</span>
                </td>
                <td>
                  <KBadge v-if="!row.errors.length" tone="success" dot>Ready</KBadge>
                  <ul v-else class="space-y-0.5 text-[12.5px] text-danger-ink">
                    <li v-for="message in row.errors" :key="message" class="flex gap-1.5"><AlertTriangle :size="13" class="mt-0.5 shrink-0" aria-hidden="true" /> {{ message }}</li>
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="rows.length > preview.length" class="border-t border-line px-5 py-3 text-[13px] text-ink-muted">
          Showing the first {{ preview.length }} rows. All {{ rows.length }} will be imported.
        </p>
      </div>
    </template>
  </div>
</template>
