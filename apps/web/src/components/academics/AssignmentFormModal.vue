<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Paperclip, X } from 'lucide-vue-next';
import { assignmentSchema, isoDate, validate, type Assignment, type AssignmentInput, type FieldErrors } from '@klasora/shared';
import KModal from '@/components/ui/KModal.vue';
import KButton from '@/components/ui/KButton.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { fileName, saveAssignment, uploadAcademicFile } from '@/services/academics';
import { useWorkspaceStore } from '@/stores/workspace';
import { useTeaching } from '@/composables/useTeaching';

/** Creates or edits an assignment, including its attachments. */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ assignment?: Assignment | null; presetClassId?: string }>();
const emit = defineEmits<{ saved: [assignment: Assignment] }>();

const workspace = useWorkspaceStore();
const teaching = useTeaching();
const errors = ref<FieldErrors>({});
const error = ref('');
const saving = ref(false);
const existingFiles = ref<string[]>([]);
const newFiles = ref<File[]>([]);

const form = reactive<AssignmentInput>({ title: '', description: '', classId: '', subjectId: '', dueDate: '', dueTime: '16:00', maximumScore: '', allowLate: false });

watch(open, (isOpen) => {
  if (!isOpen) return;
  const a = props.assignment;
  const due = a ? new Date(a.due_at) : new Date(Date.now() + 7 * 86_400_000);
  Object.assign(form, {
    title: a?.title ?? '',
    description: a?.description ?? '',
    classId: a?.class_id ?? props.presetClassId ?? classOptions.value[0]?.value ?? '',
    subjectId: a?.subject_id ?? '',
    dueDate: isoDate(due),
    dueTime: a ? `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}` : '16:00',
    maximumScore: a?.maximum_score ? String(a.maximum_score) : '',
    allowLate: a?.allow_late ?? false,
  });
  existingFiles.value = [...(a?.attachment_paths ?? [])];
  newFiles.value = [];
  errors.value = {};
  error.value = '';
});

const classOptions = computed(() => teaching.classesFor('assignments.create').map((c) => ({ value: c.id, label: c.name })));
const subjectOptions = computed(() => teaching.subjectsFor(form.classId, 'assignments.create').map((s) => ({ value: s.id, label: s.name })));
watch(subjectOptions, (opts) => {
  if (!opts.some((o) => o.value === form.subjectId)) form.subjectId = opts[0]?.value ?? '';
});

function addFiles(event: Event) {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  (event.target as HTMLInputElement).value = '';
  newFiles.value = [...newFiles.value, ...files].slice(0, 10 - existingFiles.value.length);
}

async function submit(status: Assignment['status']) {
  error.value = '';
  const result = validate(assignmentSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  errors.value = {};
  saving.value = true;
  try {
    const mine = workspace.myMembershipIds[0] ?? null;
    let saved = await saveAssignment(
      workspace.currentSchoolId!,
      result.data,
      { status, teacherMembershipId: mine, attachmentPaths: existingFiles.value },
      props.assignment?.id,
    );
    if (newFiles.value.length) {
      const uploaded: string[] = [];
      for (const file of newFiles.value) uploaded.push(await uploadAcademicFile(`${saved.school_id}/assignments/${saved.id}`, file));
      saved = await saveAssignment(saved.school_id, result.data, { status, teacherMembershipId: mine, attachmentPaths: [...existingFiles.value, ...uploaded] }, saved.id);
    }
    emit('saved', saved);
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <KModal v-model:open="open" :title="assignment ? 'Edit assignment' : 'New assignment'" size="lg">
    <div class="space-y-4">
      <KAlert v-if="error" tone="danger">{{ error }}</KAlert>
      <KInput v-model="form.title" label="Title" placeholder="Fractions worksheet" :error="errors.title" required autofocus />
      <div class="grid gap-4 sm:grid-cols-2">
        <KSelect v-model="form.classId" :label="teaching.classes.value.length ? workspace.words.group : 'Class'" :options="classOptions" :error="errors.classId" :disabled="Boolean(assignment)" />
        <KSelect v-model="form.subjectId" :label="workspace.words.subject" :options="subjectOptions" placeholder="Choose" :error="errors.subjectId" />
      </div>
      <KTextarea v-model="form.description" label="Instructions" :rows="5" placeholder="What should students do? Include page numbers or questions." optional />
      <div class="grid gap-4 sm:grid-cols-3">
        <KInput v-model="form.dueDate" type="date" label="Due date" :error="errors.dueDate" required />
        <KInput v-model="form.dueTime" type="time" label="Due time" :error="errors.dueTime" required />
        <KInput v-model="form.maximumScore" label="Maximum score" inputmode="numeric" placeholder="20" hint="Leave empty for ungraded work." :error="errors.maximumScore" optional />
      </div>
      <KCheckbox v-model="form.allowLate" label="Accept late submissions" description="Late work is marked as late." />
      <div>
        <p class="k-label mb-2">Attachments</p>
        <ul class="mb-2 space-y-1.5">
          <li v-for="(path, i) in existingFiles" :key="path" class="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-[13px]">
            <Paperclip :size="14" class="text-ink-subtle" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ fileName(path) }}</span>
            <button type="button" class="text-ink-subtle hover:text-danger-ink" :aria-label="`Remove ${fileName(path)}`" @click="existingFiles.splice(i, 1)"><X :size="15" /></button>
          </li>
          <li v-for="(file, i) in newFiles" :key="file.name + i" class="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-[13px]">
            <Paperclip :size="14" class="text-brand-ink" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
            <button type="button" class="text-ink-subtle hover:text-danger-ink" :aria-label="`Remove ${file.name}`" @click="newFiles.splice(i, 1)"><X :size="15" /></button>
          </li>
        </ul>
        <label class="inline-flex cursor-pointer items-center gap-2 rounded-control border border-dashed border-line-strong px-3 py-2 text-[13px] text-ink-muted hover:border-brand/50 hover:text-ink">
          <Paperclip :size="15" aria-hidden="true" /> Attach files
          <input type="file" multiple class="sr-only" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,image/*" @change="addFiles" />
        </label>
      </div>
    </div>
    <template #footer>
      <KButton variant="secondary" @click="open = false">Cancel</KButton>
      <KButton v-if="!assignment || assignment.status === 'draft'" variant="secondary" :loading="saving" @click="submit('draft')">Save draft</KButton>
      <KButton :loading="saving" @click="submit(assignment && assignment.status !== 'draft' ? assignment.status : 'published')">
        {{ assignment && assignment.status !== 'draft' ? 'Save changes' : 'Publish to students' }}
      </KButton>
    </template>
  </KModal>
</template>
