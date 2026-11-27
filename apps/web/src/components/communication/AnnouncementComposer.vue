<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { CalendarClock, Check, Paperclip, Send, X } from 'lucide-vue-next';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_AUDIENCE_LABELS,
  announcementSchema,
  validate,
  type Announcement,
  type AnnouncementInput,
  type Campus,
  type FieldErrors,
} from '@klasora/shared';
import KModal from '@/components/ui/KModal.vue';
import KButton from '@/components/ui/KButton.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KTextarea from '@/components/ui/KTextarea.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { listCampuses } from '@/services/setup';
import { listRoleSummaries, type RoleSummary } from '@/services/roles';
import { publishAnnouncement, saveAnnouncementDraft, uploadCommunicationFile } from '@/services/communication';
import { fileName } from '@/services/academics';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

/** Writes, targets, schedules and publishes an announcement. */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ announcement?: Announcement | null }>();
const emit = defineEmits<{ saved: [id: string, status: string] }>();

const { schoolId, can, words, feedback } = useSchool();
const teaching = useTeaching();
const isApprover = computed(() => can('communication.approve'));

const campuses = ref<Campus[]>([]);
const roles = ref<RoleSummary[]>([]);
const errors = ref<FieldErrors>({});
const error = ref('');
const saving = ref(false);
const existingFiles = ref<string[]>([]);
const newFiles = ref<File[]>([]);

const blank: AnnouncementInput = {
  title: '', body: '', audience: 'everyone', campusId: '', classIds: [], roleIds: [],
  includeParents: true, includeStudents: true, includeTeachers: false, schedule: false, publishAt: '', expiresAt: '',
};
const form = reactive<AnnouncementInput>({ ...blank });

const local = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

watch(open, async (isOpen) => {
  if (!isOpen) return;
  const a = props.announcement;
  Object.assign(form, a
    ? {
        title: a.title, body: a.body, audience: a.audience, campusId: a.campus_id ?? '', classIds: [...a.class_ids], roleIds: [...a.role_ids],
        includeParents: a.include_parents, includeStudents: a.include_students, includeTeachers: a.include_teachers,
        schedule: Boolean(a.publish_at), publishAt: local(a.publish_at), expiresAt: local(a.expires_at),
      }
    : { ...blank, audience: isApprover.value ? 'everyone' : 'classes', classIds: [] });
  existingFiles.value = [...(a?.attachment_paths ?? [])];
  newFiles.value = [];
  errors.value = {};
  error.value = '';
  if (!campuses.value.length) campuses.value = await listCampuses(schoolId.value).catch(() => []);
  if (!roles.value.length && can('roles.view')) roles.value = await listRoleSummaries(schoolId.value).catch(() => []);
});

const classOptions = computed(() => (isApprover.value ? teaching.classes.value : teaching.classesFor('communication.create')).filter((c) => c.status === 'active'));
const audiences = computed(() => ANNOUNCEMENT_AUDIENCES.filter((a) => a !== 'roles' || roles.value.length));
/** Teachers publish straight to their own classes; anything wider is reviewed first. */
const needsApproval = computed(() => {
  if (isApprover.value) return false;
  return form.audience !== 'classes' || form.classIds.some((id) => !teaching.taughtClassIds.value.has(id));
});

function toggle(list: string[], id: string) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
}

function addFiles(event: Event) {
  const files = [...((event.target as HTMLInputElement).files ?? [])];
  (event.target as HTMLInputElement).value = '';
  newFiles.value = [...newFiles.value, ...files].slice(0, 10 - existingFiles.value.length);
}

async function submit(publish: boolean) {
  error.value = '';
  const result = validate(announcementSchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  errors.value = {};
  saving.value = true;
  try {
    let saved = await saveAnnouncementDraft(schoolId.value, result.data, existingFiles.value, props.announcement?.id);
    if (newFiles.value.length) {
      const paths = [...existingFiles.value];
      for (const file of newFiles.value) paths.push(await uploadCommunicationFile(`${saved.school_id}/announcements/${saved.id}`, file));
      saved = await saveAnnouncementDraft(schoolId.value, result.data, paths, saved.id);
    }
    let status = 'draft';
    if (publish) status = await publishAnnouncement(saved.id);
    feedback.success(
      status === 'published'
        ? result.data.schedule ? 'Announcement scheduled.' : 'Announcement published.'
        : status === 'pending' ? 'Sent to the principal for approval.' : 'Draft saved.',
    );
    emit('saved', saved.id, status);
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <KModal v-model:open="open" :title="announcement ? 'Edit announcement' : 'New announcement'" size="lg">
    <div class="space-y-5">
      <KAlert v-if="error" tone="danger">{{ error }}</KAlert>
      <KAlert v-if="announcement?.review_note" tone="warning" title="Returned for changes">{{ announcement.review_note }}</KAlert>

      <KInput v-model="form.title" label="Title" placeholder="Mid term break" :error="errors.title" required autofocus />
      <KTextarea v-model="form.body" label="Message" :rows="6" placeholder="Write your announcement" :error="errors.body" required />

      <fieldset>
        <legend class="k-label mb-2">Who should receive it?</legend>
        <div class="grid gap-2 sm:grid-cols-3">
          <button
            v-for="a in audiences"
            :key="a"
            type="button"
            :aria-pressed="form.audience === a"
            :class="[
              'rounded-xl border p-3 text-left transition-colors',
              form.audience === a ? 'border-brand bg-brand-soft ring-2 ring-brand/30' : 'border-line hover:border-line-strong',
            ]"
            @click="form.audience = a"
          >
            <span class="flex items-center justify-between text-[13.5px] font-semibold">
              {{ ANNOUNCEMENT_AUDIENCE_LABELS[a].label }}
              <Check v-if="form.audience === a" :size="15" class="text-brand" aria-hidden="true" />
            </span>
            <span class="mt-0.5 block text-[12px] text-ink-muted">{{ ANNOUNCEMENT_AUDIENCE_LABELS[a].description }}</span>
          </button>
        </div>
      </fieldset>

      <div v-if="form.audience === 'classes'" class="space-y-3 rounded-xl bg-surface-muted/60 p-4">
        <p class="k-label">{{ words.groups }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in classOptions"
            :key="c.id"
            type="button"
            :aria-pressed="form.classIds.includes(c.id)"
            :class="['rounded-full border px-3 py-1.5 text-[13px] font-medium', form.classIds.includes(c.id) ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink-muted hover:text-ink']"
            @click="toggle(form.classIds, c.id)"
          >
            {{ c.name }}
          </button>
        </div>
        <p v-if="errors.classIds" class="text-[12.5px] text-danger-ink">{{ errors.classIds }}</p>
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <KCheckbox v-model="form.includeParents" label="Parents and guardians" />
          <KCheckbox v-model="form.includeStudents" label="Students" />
          <KCheckbox v-model="form.includeTeachers" label="Their teachers" />
        </div>
      </div>

      <div v-if="form.audience === 'roles'" class="rounded-xl bg-surface-muted/60 p-4">
        <p class="k-label mb-2">Roles</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="r in roles"
            :key="r.id"
            type="button"
            :aria-pressed="form.roleIds.includes(r.id)"
            :class="['rounded-full border px-3 py-1.5 text-[13px] font-medium', form.roleIds.includes(r.id) ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink-muted hover:text-ink']"
            @click="toggle(form.roleIds, r.id)"
          >
            {{ r.name }}
          </button>
        </div>
        <p v-if="errors.roleIds" class="mt-2 text-[12.5px] text-danger-ink">{{ errors.roleIds }}</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <KSelect
          v-if="campuses.length > 1 && form.audience !== 'roles'"
          v-model="form.campusId"
          label="Campus"
          :options="[{ value: '', label: 'Every campus' }, ...campuses.map((c) => ({ value: c.id, label: c.name }))]"
        />
        <KInput v-model="form.expiresAt" type="datetime-local" label="Stop showing it after" hint="Optional. Useful for event reminders." :error="errors.expiresAt" optional />
      </div>

      <div class="rounded-xl border border-line p-4">
        <KCheckbox v-model="form.schedule" label="Send it later" description="Choose when it goes out. Until then nobody sees it." />
        <div v-if="form.schedule" class="mt-3 sm:w-72">
          <KInput v-model="form.publishAt" type="datetime-local" label="Send at" :icon="CalendarClock" :error="errors.publishAt" />
        </div>
      </div>

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
        <label class="inline-flex cursor-pointer items-center gap-2 rounded-control border border-dashed border-line-strong px-3 py-2 text-[13px] text-ink-muted hover:text-ink">
          <Paperclip :size="15" aria-hidden="true" /> Attach files
          <input type="file" multiple class="sr-only" accept=".pdf,.doc,.docx,image/*" @change="addFiles" />
        </label>
      </div>

      <KAlert v-if="needsApproval" tone="info">The principal will review this before it is sent, because it goes beyond the classes you teach.</KAlert>
    </div>
    <template #footer>
      <KButton variant="secondary" @click="open = false">Cancel</KButton>
      <KButton variant="secondary" :loading="saving" @click="submit(false)">Save draft</KButton>
      <KButton :icon="Send" :loading="saving" @click="submit(true)">
        {{ needsApproval ? 'Submit for approval' : form.schedule ? 'Schedule' : 'Publish now' }}
      </KButton>
    </template>
  </KModal>
</template>
