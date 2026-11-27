<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { CalendarClock, Clock, MapPin, Pencil, Plus, Trash2, UserRound } from 'lucide-vue-next';
import {
  WEEK_DAYS,
  formatTime,
  isoWeekday,
  timeToMinutes,
  timetableEntrySchema,
  validate,
  type FieldErrors,
  type SchoolMember,
  type TimetableEntry,
  type TimetableEntryInput,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KInput from '@/components/ui/KInput.vue';
import KModal from '@/components/ui/KModal.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import { listMembers } from '@/services/setup';
import { deleteTimetableEntry, listTimetable, saveTimetableEntry } from '@/services/academics';
import { useSchool, fullName } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

const { workspace, schoolId, can, words, feedback, attempt } = useSchool();
const teaching = useTeaching();
const canEdit = computed(() => can('academics.edit'));

type Mode = 'class' | 'teacher' | 'mine';
const isStaff = computed(() => can('academics.view'));
const mode = ref<Mode>('class');
const classId = ref('');
const teacherId = ref('');
const entries = ref<TimetableEntry[]>([]);
const members = ref<SchoolMember[]>([]);
const loading = ref(true);
const error = ref('');

/** Classes this person can choose between. */
const classOptions = computed(() => {
  if (isStaff.value) return teaching.classes.value.filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: c.name }));
  const own = workspace.myStudent?.class_id ? [{ value: workspace.myStudent.class_id, label: workspace.myStudent.class_name ?? words.value.group }] : [];
  const kids = workspace.children
    .filter((c) => c.class_id)
    .map((c) => ({ value: c.class_id!, label: `${c.first_name}: ${c.class_name}` }));
  return [...own, ...kids];
});

// Sensible starting view: teachers see their own week, everyone else a class.
watch(
  () => [teaching.loaded.value, classOptions.value.length],
  () => {
    if (!teaching.loaded.value || classId.value) return;
    if (isStaff.value && !teaching.oversees('academics.view') && teaching.taughtClassIds.value.size) mode.value = 'mine';
    classId.value = classOptions.value[0]?.value ?? '';
  },
  { immediate: true },
);

async function load() {
  if (!schoolId.value) return;
  loading.value = true;
  error.value = '';
  try {
    if (!members.value.length && (can('staff.view') || can('academics.edit'))) members.value = await listMembers(schoolId.value).catch(() => []);
    if (mode.value === 'class') {
      entries.value = classId.value ? await listTimetable(schoolId.value, { classIds: [classId.value] }) : [];
    } else {
      const ids =
        mode.value === 'mine'
          ? workspace.myMembershipIds
          : members.value.filter((m) => m.user_id === members.value.find((x) => x.membership_id === teacherId.value)?.user_id).map((m) => m.membership_id);
      entries.value = ids.length ? await listTimetable(schoolId.value, { teacherMembershipIds: ids }) : [];
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch([schoolId, mode, classId, teacherId], load, { immediate: true });

const teacherOptions = computed(() => {
  const seen = new Set<string>();
  return members.value
    .filter((m) => m.status === 'active' && m.role_key !== 'parent' && m.role_key !== 'student')
    .filter((m) => (seen.has(m.user_id) ? false : (seen.add(m.user_id), true)))
    .map((m) => ({ value: m.membership_id, label: fullName(m) }));
});
const teacherName = (id: string | null) => {
  const m = members.value.find((x) => x.membership_id === id);
  return m ? fullName(m) : workspace.myMembershipIds.includes(id ?? '') ? 'You' : null;
};

// ---------------------------------------------------------------------------
// Grid geometry
// ---------------------------------------------------------------------------
const days = computed(() => WEEK_DAYS.filter((d) => d.value <= 5 || entries.value.some((e) => e.day_of_week === d.value)));
const startMinute = computed(() => Math.min(7 * 60 + 30, ...entries.value.map((e) => timeToMinutes(e.start_time))));
const endMinute = computed(() => Math.max(15 * 60, ...entries.value.map((e) => timeToMinutes(e.end_time))));
const PX = 1.6;
/** Pixel height of a period block, used to decide how many lines fit. */
const blockHeight = (e: TimetableEntry) => (timeToMinutes(e.end_time) - timeToMinutes(e.start_time)) * PX - 2;
const hours = computed(() => {
  const list: number[] = [];
  for (let m = Math.ceil(startMinute.value / 60) * 60; m <= endMinute.value; m += 60) list.push(m);
  return list;
});
const today = isoWeekday();

const PALETTE = [
  'from-[#3B82F6] to-[#1D4ED8]', 'from-[#8B5CF6] to-[#6D28D9]', 'from-[#10B981] to-[#047857]', 'from-[#F59E0B] to-[#B45309]',
  'from-[#06B6D4] to-[#0E7490]', 'from-[#EC4899] to-[#BE185D]', 'from-[#6366F1] to-[#4338CA]', 'from-[#14B8A6] to-[#0F766E]',
];
function colour(entry: TimetableEntry) {
  if (!entry.subject_id) return 'from-[#94A3B8] to-[#64748B]';
  let hash = 0;
  for (const ch of entry.subject_id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
const titleOf = (e: TimetableEntry) => (e.subject_id ? teaching.subjectName(e.subject_id) : e.label) || 'Period';
const dayEntries = (day: number) => entries.value.filter((e) => e.day_of_week === day);

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------
const open = ref(false);
const editing = ref<TimetableEntry | null>(null);
const saving = ref(false);
const errors = ref<FieldErrors>({});
const form = reactive<TimetableEntryInput>({ classId: '', subjectId: '', label: '', teacherMembershipId: '', dayOfWeek: 1, startTime: '08:00', endTime: '08:40', room: '' });

function openForm(entry?: TimetableEntry, day?: number) {
  editing.value = entry ?? null;
  const last = day ? dayEntries(day).at(-1) : undefined;
  Object.assign(form, {
    classId: entry?.class_id ?? classId.value,
    subjectId: entry?.subject_id ?? '',
    label: entry?.label ?? '',
    teacherMembershipId: entry?.teacher_membership_id ?? '',
    dayOfWeek: entry?.day_of_week ?? day ?? 1,
    startTime: (entry?.start_time ?? last?.end_time ?? '08:00').slice(0, 5),
    endTime: (entry?.end_time ?? '').slice(0, 5) || addMinutes((last?.end_time ?? '08:00').slice(0, 5), 40),
    room: entry?.room ?? '',
  });
  errors.value = {};
  open.value = true;
}

function addMinutes(time: string, minutes: number) {
  const total = timeToMinutes(time) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// When a subject is chosen, suggest the teacher already assigned to it in that class.
watch(
  () => [form.subjectId, form.classId],
  () => {
    if (editing.value || !form.subjectId) return;
    const assigned = teaching.classSubjects.value.find((cs) => cs.class_id === form.classId && cs.subject_id === form.subjectId);
    if (assigned?.teacher_membership_id) form.teacherMembershipId = assigned.teacher_membership_id;
  },
);

async function submit() {
  const result = validate(timetableEntrySchema, form);
  if (!result.success) {
    errors.value = result.errors;
    return;
  }
  saving.value = true;
  const saved = await attempt(
    () => saveTimetableEntry(schoolId.value, teaching.currentYear.value?.id ?? null, result.data, editing.value?.id),
    editing.value ? 'Period updated.' : 'Period added.',
  );
  saving.value = false;
  if (saved) {
    open.value = false;
    await load();
  }
}

async function remove() {
  if (!editing.value) return;
  const ok = await feedback.confirm({ title: `Remove ${titleOf(editing.value)}?`, description: 'This period will be taken off the timetable.', confirmLabel: 'Remove', tone: 'danger' });
  if (!ok) return;
  await attempt(() => deleteTimetableEntry(editing.value!.id), 'Period removed.');
  open.value = false;
  await load();
}

const subjectOptions = computed(() => [
  { value: '', label: 'Not a lesson (break, assembly)' },
  ...(form.classId ? teaching.subjectsFor(form.classId, 'academics.view') : teaching.subjects.value).map((s) => ({ value: s.id, label: s.name })),
]);
</script>

<template>
  <div>
    <KPageHeader
      :icon="CalendarClock"
      eyebrow="Academics"
      title="Timetable"
      :description="isStaff ? `Plan the school week. Klasora stops clashes for ${words.groups.toLowerCase()}, teachers and rooms.` : 'Your week at a glance.'"
    >
      <template #actions>
        <KButton v-if="canEdit && mode === 'class' && classId" :icon="Plus" @click="openForm()">Add period</KButton>
      </template>
    </KPageHeader>

    <div class="mb-5 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-end">
      <div v-if="isStaff" class="inline-flex rounded-xl border border-line p-1">
        <button
          v-for="m in ([
            ...(teaching.taughtClassIds.value.size ? [{ key: 'mine', label: 'My week' }] : []),
            { key: 'class', label: `By ${words.group.toLowerCase()}` },
            ...(teacherOptions.length ? [{ key: 'teacher', label: 'By teacher' }] : []),
          ] as { key: Mode; label: string }[])"
          :key="m.key"
          type="button"
          :class="['rounded-lg px-3 py-1.5 text-[13px] font-medium', mode === m.key ? 'k-bg-brand text-white shadow-brand' : 'text-ink-muted hover:text-ink']"
          @click="mode = m.key"
        >
          {{ m.label }}
        </button>
      </div>
      <div v-if="mode === 'class'" class="sm:w-64">
        <KSelect v-model="classId" :label="words.group" :options="classOptions" placeholder="Choose" />
      </div>
      <div v-if="mode === 'teacher'" class="sm:w-64">
        <KSelect v-model="teacherId" label="Teacher" :options="teacherOptions" placeholder="Choose a teacher" />
      </div>
    </div>

    <KAlert v-if="error" tone="danger" class="mb-5">{{ error }}</KAlert>
    <KSkeleton v-if="loading" line-class="h-96 rounded-card" />

    <div v-else-if="!classOptions.length && !isStaff" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="CalendarClock" title="No timetable yet" description="Your timetable appears here once you are placed in a class." />
    </div>

    <div v-else-if="!entries.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState
        :icon="CalendarClock"
        title="Nothing scheduled yet"
        :description="canEdit && mode === 'class' ? 'Add the first period. Breaks and assemblies can be added too.' : 'Periods appear here once the timetable is set.'"
      >
        <KButton v-if="canEdit && mode === 'class' && classId" :icon="Plus" @click="openForm()">Add period</KButton>
      </KEmptyState>
    </div>

    <template v-else>
      <!-- Week grid (tablet and larger) -->
      <div class="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-card md:block">
        <div class="grid min-w-[760px]" :style="{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }">
          <div class="border-b border-line" />
          <div
            v-for="d in days"
            :key="d.value"
            :class="['border-b border-l border-line px-3 py-3 text-center text-[13px] font-semibold', d.value === today ? 'bg-brand-soft text-brand-ink' : '']"
          >
            {{ d.label }}
          </div>

          <div class="relative" :style="{ height: `${(endMinute - startMinute) * PX}px` }">
            <span
              v-for="h in hours"
              :key="h"
              class="absolute right-2 -translate-y-1/2 text-[11px] text-ink-subtle tabular-nums"
              :style="{ top: `${(h - startMinute) * PX}px` }"
            >
              {{ formatTime(`${Math.floor(h / 60)}:00`) }}
            </span>
          </div>
          <div
            v-for="d in days"
            :key="d.value"
            :class="['group/day relative border-l border-line', d.value === today ? 'bg-brand-soft/30' : '']"
            :style="{ height: `${(endMinute - startMinute) * PX}px` }"
          >
            <div v-for="h in hours" :key="h" class="absolute inset-x-0 border-t border-dashed border-line" :style="{ top: `${(h - startMinute) * PX}px` }" />
            <button
              v-for="e in dayEntries(d.value)"
              :key="e.id"
              type="button"
              :disabled="!canEdit"
              :class="['absolute inset-x-1.5 overflow-hidden rounded-lg bg-gradient-to-br px-2.5 py-1.5 text-left text-white shadow-sm ring-1 ring-white/20 transition hover:brightness-110 disabled:cursor-default disabled:hover:brightness-100', colour(e)]"
              :style="{ top: `${(timeToMinutes(e.start_time) - startMinute) * PX + 1}px`, height: `${(timeToMinutes(e.end_time) - timeToMinutes(e.start_time)) * PX - 2}px` }"
              @click="openForm(e)"
            >
              <span class="block truncate text-[12.5px] font-semibold">{{ titleOf(e) }}</span>
              <span class="block truncate text-[11px] opacity-90">{{ formatTime(e.start_time) }} to {{ formatTime(e.end_time) }}</span>
              <template v-if="blockHeight(e) >= 56">
                <span v-if="mode !== 'class'" class="block truncate text-[11px] opacity-90">{{ teaching.className(e.class_id) }}{{ e.room ? `, ${e.room}` : '' }}</span>
                <span v-else class="block truncate text-[11px] opacity-90">{{ [teacherName(e.teacher_membership_id), e.room].filter(Boolean).join(', ') }}</span>
              </template>
            </button>
            <button
              v-if="canEdit && mode === 'class'"
              type="button"
              class="absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-md bg-surface text-ink-subtle opacity-0 shadow ring-1 ring-line transition group-hover/day:opacity-100 hover:text-brand-ink"
              :aria-label="`Add a period on ${d.label}`"
              @click="openForm(undefined, d.value)"
            >
              <Plus :size="15" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <!-- Day list (phones) -->
      <div class="space-y-4 md:hidden">
        <section v-for="d in days" :key="d.value" class="rounded-card border border-line bg-surface shadow-card">
          <h2 :class="['border-b border-line px-4 py-3 text-[14px] font-semibold', d.value === today ? 'text-brand-ink' : '']">
            {{ d.label }}<span v-if="d.value === today" class="ml-2 text-[12px] font-medium">Today</span>
          </h2>
          <p v-if="!dayEntries(d.value).length" class="px-4 py-3 text-[13px] text-ink-muted">Nothing scheduled.</p>
          <ul v-else class="divide-y divide-line">
            <li v-for="e in dayEntries(d.value)" :key="e.id" class="flex items-center gap-3 px-4 py-3">
              <span :class="['h-10 w-1.5 shrink-0 rounded-full bg-gradient-to-b', colour(e)]" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ titleOf(e) }}</p>
                <p class="flex flex-wrap gap-x-3 text-[12.5px] text-ink-muted">
                  <span class="flex items-center gap-1"><Clock :size="12" aria-hidden="true" /> {{ formatTime(e.start_time) }} to {{ formatTime(e.end_time) }}</span>
                  <span v-if="e.room" class="flex items-center gap-1"><MapPin :size="12" aria-hidden="true" /> {{ e.room }}</span>
                  <span v-if="mode !== 'class'">{{ teaching.className(e.class_id) }}</span>
                  <span v-else-if="teacherName(e.teacher_membership_id)" class="flex items-center gap-1"><UserRound :size="12" aria-hidden="true" /> {{ teacherName(e.teacher_membership_id) }}</span>
                </p>
              </div>
              <KButton v-if="canEdit" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${titleOf(e)}`" @click="openForm(e)" />
            </li>
          </ul>
        </section>
      </div>
    </template>

    <KModal v-model:open="open" :title="editing ? `Edit ${titleOf(editing)}` : 'Add a period'" :description="teaching.className(form.classId)">
      <form id="period-form" class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submit">
        <div class="sm:col-span-2">
          <KSelect v-model="form.subjectId" :label="words.subject" :options="subjectOptions" :error="errors.subjectId" />
        </div>
        <div v-if="!form.subjectId" class="sm:col-span-2">
          <KInput v-model="form.label" label="Name" placeholder="Break" :error="errors.label" />
        </div>
        <KSelect
          :model-value="String(form.dayOfWeek)"
          label="Day"
          :options="WEEK_DAYS.map((d) => ({ value: String(d.value), label: d.label }))"
          @update:model-value="form.dayOfWeek = Number($event)"
        />
        <KInput v-model="form.room" label="Room" placeholder="Lab 1" optional />
        <KInput v-model="form.startTime" type="time" label="Starts" :error="errors.startTime" required />
        <KInput v-model="form.endTime" type="time" label="Ends" :error="errors.endTime" required />
        <div v-if="form.subjectId && teacherOptions.length" class="sm:col-span-2">
          <KSelect v-model="form.teacherMembershipId" label="Teacher" :options="[{ value: '', label: 'Not set' }, ...teacherOptions]" />
        </div>
      </form>
      <template #footer>
        <KButton v-if="editing" variant="ghost" :icon="Trash2" class="mr-auto text-danger-ink hover:bg-danger-soft" @click="remove">Remove</KButton>
        <KButton variant="secondary" @click="open = false">Cancel</KButton>
        <KButton type="submit" form="period-form" :loading="saving">{{ editing ? 'Save changes' : 'Add period' }}</KButton>
      </template>
    </KModal>
  </div>
</template>
