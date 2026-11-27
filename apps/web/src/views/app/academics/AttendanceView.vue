<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { BarChart3, CalendarCheck, CheckCheck, ClipboardCheck, Lock, MessageSquareText, Save, Send, UserCheck, UserX, Clock3 } from 'lucide-vue-next';
import {
  ATTENDANCE_SESSION_LABELS,
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  attendanceRate,
  formatDmy,
  isoDate,
  monthRange,
  studentName,
  weekRange,
  type AttendanceRecord,
  type AttendanceReportRow,
  type AttendanceSession,
  type AttendanceSessionType,
  type AttendanceStatus,
  type Student,
} from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KButton from '@/components/ui/KButton.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KCard from '@/components/ui/KCard.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KTabs from '@/components/ui/KTabs.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { listEnrollments, listStudents, signedPhotoUrls } from '@/services/students';
import { attendanceReport, getAttendanceSession, listSessions, saveAttendance } from '@/services/academics';
import { supabase } from '@/lib/supabase';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

const { schoolId, slug, can, words, feedback, attempt } = useSchool();
const teaching = useTeaching();
const todayIso = isoDate(new Date());

const tab = ref(can('attendance.create') ? 'take' : 'reports');
const tabs = computed(() => [
  ...(can('attendance.create') ? [{ key: 'take', label: 'Take attendance', icon: ClipboardCheck }] : []),
  { key: 'reports', label: 'Reports', icon: BarChart3 },
]);

// =============================================================================
// Take attendance
// =============================================================================
const classOptions = computed(() => teaching.classesFor('attendance.create').map((c) => ({ value: c.id, label: c.name })));
const classId = ref('');
const date = ref(todayIso);
const sessionType = ref<AttendanceSessionType>('daily');
const subjectId = ref('');
watch(classOptions, (opts) => {
  if (!classId.value && opts.length) classId.value = opts[0]!.value;
}, { immediate: true });

const students = ref<Student[]>([]);
const photos = ref<Record<string, string>>({});
const session = ref<AttendanceSession | null>(null);
const marks = reactive<Record<string, { status: AttendanceStatus | null; remarks: string; noteOpen: boolean }>>({});
const loadingRegister = ref(false);
const registerError = ref('');
const saving = ref(false);

async function loadRegister() {
  if (!schoolId.value || !classId.value) return;
  if (sessionType.value === 'subject' && !subjectId.value) return;
  loadingRegister.value = true;
  registerError.value = '';
  try {
    const [enrollments, all, existing] = await Promise.all([
      listEnrollments(schoolId.value, { classId: classId.value }),
      listStudents(schoolId.value),
      getAttendanceSession(classId.value, date.value, sessionType.value, sessionType.value === 'subject' ? subjectId.value : null),
    ]);
    const onDate = new Set(
      enrollments.filter((e) => e.start_date <= date.value && (!e.end_date || e.end_date >= date.value)).map((e) => e.student_id),
    );
    students.value = all.filter((s) => onDate.has(s.id)).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    session.value = existing.session;
    const byStudent = new Map<string, AttendanceRecord>(existing.records.map((r) => [r.student_id, r]));
    for (const key of Object.keys(marks)) delete marks[key];
    for (const s of students.value) {
      const r = byStudent.get(s.id);
      marks[s.id] = { status: r?.status ?? null, remarks: r?.remarks ?? '', noteOpen: Boolean(r?.remarks) };
    }
    photos.value = await signedPhotoUrls(students.value.map((s) => s.photo_path)).catch(() => ({}));
  } catch (e) {
    registerError.value = (e as Error).message;
  } finally {
    loadingRegister.value = false;
  }
}
watch([schoolId, classId, date, sessionType, subjectId], loadRegister, { immediate: true });

const locked = computed(() => session.value?.status === 'submitted' && !can('attendance.edit'));
const counts = computed(() => {
  const c = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
  for (const s of students.value) {
    const status = marks[s.id]?.status;
    if (status) c[status] += 1;
    else c.unmarked += 1;
  }
  return c;
});

function markAll(status: AttendanceStatus) {
  for (const s of students.value) if (!marks[s.id]!.status || status === 'present') marks[s.id]!.status = status;
}

const STATUS_STYLE: Record<AttendanceStatus, { on: string; key: string }> = {
  present: { on: 'bg-success text-white ring-success', key: 'P' },
  absent: { on: 'bg-danger text-white ring-danger', key: 'A' },
  late: { on: 'bg-warning text-white ring-warning', key: 'L' },
  excused: { on: 'bg-info text-white ring-info', key: 'E' },
};

async function save(submit: boolean) {
  if (submit && counts.value.unmarked > 0) {
    feedback.error(`Mark every student before submitting. ${counts.value.unmarked} still need a status.`);
    return;
  }
  if (submit) {
    const ok = await feedback.confirm({
      title: 'Submit this register?',
      description: can('attendance.edit')
        ? 'It will be recorded as final. You can still correct it afterwards.'
        : 'After submitting, only an administrator can make corrections.',
      confirmLabel: 'Submit register',
      tone: 'primary',
    });
    if (!ok) return;
  }
  const records = students.value
    .filter((s) => marks[s.id]!.status)
    .map((s) => ({ student_id: s.id, status: marks[s.id]!.status!, remarks: marks[s.id]!.remarks }));
  saving.value = true;
  const done = await attempt(
    () =>
      saveAttendance({
        classId: classId.value,
        date: date.value,
        sessionType: sessionType.value,
        subjectId: sessionType.value === 'subject' ? subjectId.value : null,
        records,
        submit,
      }),
    submit ? 'Register submitted.' : 'Register saved as a draft.',
  );
  saving.value = false;
  if (done) await loadRegister();
}

// =============================================================================
// Reports
// =============================================================================
type Range = 'today' | 'week' | 'month' | 'custom';
const range = ref<Range>('week');
const from = ref(weekRange().from);
const to = ref(todayIso);
watch(range, (r) => {
  if (r === 'today') [from.value, to.value] = [todayIso, todayIso];
  if (r === 'week') [from.value, to.value] = [weekRange().from, todayIso];
  if (r === 'month') [from.value, to.value] = [monthRange().from, todayIso];
});

const report = ref<AttendanceReportRow[]>([]);
const todaySessions = ref<AttendanceSession[]>([]);
const loadingReport = ref(false);
const reportError = ref('');

async function loadReport() {
  if (!schoolId.value || from.value > to.value) return;
  loadingReport.value = true;
  reportError.value = '';
  try {
    [report.value, todaySessions.value] = await Promise.all([
      attendanceReport(schoolId.value, from.value, to.value),
      listSessions(schoolId.value, todayIso, todayIso),
    ]);
  } catch (e) {
    reportError.value = (e as Error).message;
  } finally {
    loadingReport.value = false;
  }
}
watch([schoolId, from, to, tab], () => tab.value === 'reports' && void loadReport(), { immediate: true });

const totals = computed(() => {
  const t = { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
  for (const r of report.value) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r[k];
  return t;
});
const byClass = computed(() => {
  const map = new Map<string, { classId: string; days: number; present: number; absent: number; late: number; excused: number; total: number }>();
  for (const r of report.value) {
    const row = map.get(r.class_id) ?? { classId: r.class_id, days: 0, present: 0, absent: 0, late: 0, excused: 0, total: 0 };
    row.days += 1;
    row.present += r.present;
    row.absent += r.absent;
    row.late += r.late;
    row.excused += r.excused;
    row.total += r.total;
    map.set(r.class_id, row);
  }
  return [...map.values()].sort((a, b) => (attendanceRate(a) ?? 0) - (attendanceRate(b) ?? 0));
});
const byDay = computed(() => {
  const map = new Map<string, { present: number; late: number; total: number }>();
  for (const r of report.value) {
    const row = map.get(r.attendance_date) ?? { present: 0, late: 0, total: 0 };
    row.present += r.present;
    row.late += r.late;
    row.total += r.total;
    map.set(r.attendance_date, row);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ date: d, rate: attendanceRate(v) ?? 0 }));
});
const notTakenToday = computed(() => {
  const taken = new Set(todaySessions.value.filter((s) => s.session_type === 'daily' || s.session_type === 'morning').map((s) => s.class_id));
  return teaching.classesFor('attendance.view').filter((c) => !taken.has(c.id));
});

// Per student breakdown for one class
const openClass = ref<string | null>(null);
const classStudents = ref<{ student: Student; present: number; absent: number; late: number; excused: number; total: number }[]>([]);
async function toggleClass(id: string) {
  if (openClass.value === id) {
    openClass.value = null;
    return;
  }
  openClass.value = id;
  classStudents.value = [];
  const { data: sessions } = await supabase.from('attendance_sessions').select('id').eq('class_id', id).gte('attendance_date', from.value).lte('attendance_date', to.value).in('session_type', ['daily', 'morning']);
  const ids = (sessions ?? []).map((s) => (s as { id: string }).id);
  if (!ids.length) return;
  const [{ data: records }, all] = await Promise.all([
    supabase.from('attendance_records').select('student_id, status').in('session_id', ids),
    listStudents(schoolId.value),
  ]);
  const tally = new Map<string, { present: number; absent: number; late: number; excused: number; total: number }>();
  for (const r of (records ?? []) as { student_id: string; status: AttendanceStatus }[]) {
    const t = tally.get(r.student_id) ?? { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
    t[r.status] += 1;
    t.total += 1;
    tally.set(r.student_id, t);
  }
  classStudents.value = all
    .filter((s) => tally.has(s.id))
    .map((s) => ({ student: s, ...tally.get(s.id)! }))
    .sort((a, b) => (attendanceRate(a) ?? 0) - (attendanceRate(b) ?? 0));
}

const rateTone = (rate: number | null) => (rate === null ? 'neutral' : rate >= 90 ? 'success' : rate >= 75 ? 'warning' : 'danger');
</script>

<template>
  <div>
    <KPageHeader :icon="CalendarCheck" eyebrow="Academics" title="Attendance" description="Take daily registers in seconds and follow attendance across the school." />

    <KTabs v-model="tab" :tabs="tabs" label="Attendance" class="mb-6" />

    <!-- ================= Take attendance ================= -->
    <div v-if="tab === 'take'">
      <div v-if="teaching.loaded.value && !classOptions.length" class="rounded-card border border-line bg-surface shadow-card">
        <KEmptyState :icon="ClipboardCheck" title="No classes to register" :description="`Registers can be taken for ${words.groups.toLowerCase()} you teach. Ask an administrator to make you a class or subject teacher.`" />
      </div>

      <template v-else>
        <div class="mb-5 grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
          <KSelect v-model="classId" :label="words.group" :options="classOptions" />
          <KInput v-model="date" type="date" label="Date" :max="todayIso" />
          <KSelect v-model="sessionType" label="Register" :options="Object.entries(ATTENDANCE_SESSION_LABELS).map(([value, label]) => ({ value, label }))" />
          <KSelect
            v-if="sessionType === 'subject'"
            v-model="subjectId"
            :label="words.subject"
            placeholder="Choose"
            :options="teaching.subjectsFor(classId, 'attendance.create').map((s) => ({ value: s.id, label: s.name }))"
          />
        </div>

        <KAlert v-if="registerError" tone="danger" class="mb-5">{{ registerError }}</KAlert>
        <KAlert v-if="session?.status === 'submitted'" :tone="locked ? 'info' : 'success'" class="mb-5" :title="locked ? 'This register has been submitted' : 'Submitted register'">
          {{ locked ? 'Only an administrator can correct it now.' : 'You can still correct it because you have permission to edit attendance.' }}
        </KAlert>

        <KSkeleton v-if="loadingRegister" :lines="8" />
        <div v-else-if="!students.length" class="rounded-card border border-line bg-surface shadow-card">
          <KEmptyState :icon="UserCheck" :title="`No students in ${teaching.className(classId)} on this date`" description="Add students to the class from the class page." />
        </div>

        <div v-else class="rounded-card border border-line bg-surface shadow-card">
          <div class="flex flex-wrap items-center gap-2 border-b border-line p-4">
            <KBadge tone="success" dot>{{ counts.present }} present</KBadge>
            <KBadge tone="danger" dot>{{ counts.absent }} absent</KBadge>
            <KBadge tone="warning" dot>{{ counts.late }} late</KBadge>
            <KBadge tone="info" dot>{{ counts.excused }} excused</KBadge>
            <KBadge v-if="counts.unmarked" tone="neutral">{{ counts.unmarked }} not marked</KBadge>
            <KButton v-if="!locked" class="ml-auto" size="sm" variant="subtle" :icon="CheckCheck" @click="markAll('present')">Mark all present</KButton>
          </div>
          <ul class="divide-y divide-line">
            <li v-for="s in students" :key="s.id" class="px-4 py-3">
              <div class="flex flex-wrap items-center gap-3">
                <KAvatar :name="studentName(s)" :src="s.photo_path ? photos[s.photo_path] : null" :size="38" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium">{{ studentName(s) }}</p>
                  <p class="text-[12px] text-ink-muted tabular-nums">{{ s.admission_number }}</p>
                </div>
                <div class="flex items-center gap-1.5" role="radiogroup" :aria-label="`Attendance for ${studentName(s)}`">
                  <button
                    v-for="status in ATTENDANCE_STATUSES"
                    :key="status"
                    type="button"
                    role="radio"
                    :aria-checked="marks[s.id]!.status === status"
                    :aria-label="ATTENDANCE_STATUS_LABELS[status]"
                    :title="ATTENDANCE_STATUS_LABELS[status]"
                    :disabled="locked"
                    :class="[
                      'flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-[13px] font-semibold ring-1 transition sm:px-3',
                      marks[s.id]!.status === status ? STATUS_STYLE[status].on : 'bg-surface text-ink-muted ring-line hover:bg-surface-muted',
                      'disabled:cursor-not-allowed disabled:opacity-70',
                    ]"
                    @click="marks[s.id]!.status = status"
                  >
                    <span class="sm:hidden">{{ STATUS_STYLE[status].key }}</span>
                    <span class="hidden sm:inline">{{ ATTENDANCE_STATUS_LABELS[status] }}</span>
                  </button>
                  <button
                    type="button"
                    :class="['flex size-9 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-muted hover:text-ink', marks[s.id]!.remarks ? 'text-brand-ink' : '']"
                    :aria-label="`Add a note for ${studentName(s)}`"
                    :disabled="locked"
                    @click="marks[s.id]!.noteOpen = !marks[s.id]!.noteOpen"
                  >
                    <MessageSquareText :size="17" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div v-if="marks[s.id]!.noteOpen || (marks[s.id]!.status && marks[s.id]!.status !== 'present' && marks[s.id]!.remarks)" class="mt-2 sm:pl-[50px]">
                <KInput v-model="marks[s.id]!.remarks" :readonly="locked" placeholder="Note, for example: sick, family emergency" :aria-label="`Note for ${studentName(s)}`" />
              </div>
            </li>
          </ul>
          <div v-if="!locked" class="flex flex-col-reverse gap-2 border-t border-line p-4 sm:flex-row sm:justify-end">
            <KButton variant="secondary" :icon="Save" :loading="saving" @click="save(false)">Save draft</KButton>
            <KButton :icon="session?.status === 'submitted' ? Save : Send" :loading="saving" @click="save(session?.status !== 'submitted')">
              {{ session?.status === 'submitted' ? 'Save corrections' : 'Submit register' }}
            </KButton>
          </div>
          <p v-else class="flex items-center gap-2 border-t border-line p-4 text-[13px] text-ink-muted"><Lock :size="15" aria-hidden="true" /> Submitted {{ session?.submitted_at ? new Date(session.submitted_at).toLocaleString('en-NG') : '' }}</p>
        </div>
      </template>
    </div>

    <!-- ================= Reports ================= -->
    <div v-else>
      <div class="mb-5 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card md:flex-row md:items-end">
        <div class="inline-flex rounded-xl border border-line p-1">
          <button
            v-for="r in ([{ key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }, { key: 'custom', label: 'Custom' }] as { key: Range; label: string }[])"
            :key="r.key"
            type="button"
            :class="['rounded-lg px-3 py-1.5 text-[13px] font-medium', range === r.key ? 'k-bg-brand text-white shadow-brand' : 'text-ink-muted hover:text-ink']"
            @click="range = r.key"
          >
            {{ r.label }}
          </button>
        </div>
        <template v-if="range === 'custom'">
          <KInput v-model="from" type="date" label="From" :max="to" />
          <KInput v-model="to" type="date" label="To" :max="todayIso" />
        </template>
      </div>

      <KAlert v-if="reportError" tone="danger" class="mb-5">{{ reportError }}</KAlert>

      <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div v-for="card in [
          { label: 'Attendance rate', value: attendanceRate(totals) === null ? 'No data' : `${attendanceRate(totals)}%`, icon: UserCheck, tone: 'success' },
          { label: 'Absences', value: totals.absent, icon: UserX, tone: 'danger' },
          { label: 'Late arrivals', value: totals.late, icon: Clock3, tone: 'warning' },
          { label: 'Registers taken', value: report.length, icon: ClipboardCheck, tone: 'brand' },
        ] as const" :key="card.label" class="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
          <KIconTile :icon="card.icon" :tone="card.tone" solid :size="40" />
          <span>
            <span class="block text-[12.5px] text-ink-muted">{{ card.label }}</span>
            <KSkeleton v-if="loadingReport" line-class="mt-1 h-6 w-12" />
            <span v-else class="block text-[22px] leading-7 font-semibold tabular-nums">{{ card.value }}</span>
          </span>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        <KCard title="Daily attendance rate" :icon="BarChart3" class="lg:col-span-2">
          <p v-if="!byDay.length" class="text-[13.5px] text-ink-muted">No registers in this period.</p>
          <div v-else class="flex h-48 items-end gap-1.5" role="img" :aria-label="`Attendance rate by day, from ${formatDmy(from)} to ${formatDmy(to)}`">
            <div v-for="d in byDay" :key="d.date" class="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span class="text-[10.5px] font-medium text-ink-muted tabular-nums opacity-0 group-hover:opacity-100">{{ d.rate }}%</span>
              <div
                :class="['w-full max-w-10 rounded-t-md', d.rate >= 90 ? 'bg-gradient-to-t from-[#16A34A] to-[#4ADE80]' : d.rate >= 75 ? 'bg-gradient-to-t from-[#D97706] to-[#FBBF24]' : 'bg-gradient-to-t from-[#DC2626] to-[#F87171]']"
                :style="{ height: `${Math.max(4, d.rate)}%` }"
                :title="`${formatDmy(d.date)}: ${d.rate}%`"
              />
              <span class="text-[10.5px] text-ink-subtle">{{ new Date(d.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) }}</span>
            </div>
          </div>
        </KCard>

        <KCard title="Not yet taken today" :icon="ClipboardCheck" tone="warning">
          <p v-if="!notTakenToday.length" class="text-[13.5px] text-success-ink">Every register has been taken today.</p>
          <ul v-else class="flex flex-wrap gap-1.5">
            <li v-for="c in notTakenToday" :key="c.id"><KBadge tone="warning">{{ c.name }}</KBadge></li>
          </ul>
        </KCard>

        <KCard :title="`By ${words.group.toLowerCase()}`" description="Lowest attendance first. Select a row to see each student." :padded="false" class="lg:col-span-3">
          <KEmptyState v-if="!byClass.length" compact :icon="BarChart3" title="No registers in this period" />
          <div v-else class="overflow-x-auto">
            <table class="k-table">
              <thead>
                <tr>
                  <th scope="col">{{ words.group }}</th>
                  <th scope="col">Days</th>
                  <th scope="col">Present</th>
                  <th scope="col">Absent</th>
                  <th scope="col">Late</th>
                  <th scope="col">Excused</th>
                  <th scope="col">Rate</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="row in byClass" :key="row.classId">
                  <tr class="cursor-pointer" :aria-expanded="openClass === row.classId" @click="toggleClass(row.classId)">
                    <td class="font-medium">{{ teaching.className(row.classId) }}</td>
                    <td class="tabular-nums">{{ row.days }}</td>
                    <td class="tabular-nums">{{ row.present }}</td>
                    <td class="tabular-nums">{{ row.absent }}</td>
                    <td class="tabular-nums">{{ row.late }}</td>
                    <td class="tabular-nums">{{ row.excused }}</td>
                    <td class="w-48">
                      <div class="flex items-center gap-2">
                        <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                          <div :class="['h-full rounded-full', { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', neutral: 'bg-line-strong' }[rateTone(attendanceRate(row))]]" :style="{ width: `${attendanceRate(row) ?? 0}%` }" />
                        </div>
                        <span class="w-10 text-right font-medium tabular-nums">{{ attendanceRate(row) }}%</span>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="openClass === row.classId">
                    <td colspan="7" class="bg-surface-muted/40">
                      <p v-if="!classStudents.length" class="text-[13px] text-ink-muted">Loading students</p>
                      <ul v-else class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <li v-for="item in classStudents" :key="item.student.id" class="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 ring-1 ring-line">
                          <RouterLink :to="{ name: 'student-detail', params: { slug, studentId: item.student.id }, query: { tab: 'attendance' } }" class="truncate text-[13.5px] font-medium hover:text-brand-ink" @click.stop>
                            {{ studentName(item.student) }}
                          </RouterLink>
                          <KBadge :tone="rateTone(attendanceRate(item))">{{ attendanceRate(item) }}%, {{ item.absent }} absent</KBadge>
                        </li>
                      </ul>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </KCard>
      </div>
    </div>
  </div>
</template>
