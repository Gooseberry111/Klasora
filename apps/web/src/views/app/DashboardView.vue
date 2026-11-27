<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  ArrowRight,
  BookOpen,
  Building2,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Circle,
  CreditCard,
  CalendarCheck,
  GraduationCap,
  Globe,
  Mail,
  MapPin,
  Phone,
  School as SchoolIcon,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-vue-next';
import {
  ACADEMIC_STRUCTURE_DETAILS,
  COUNTRIES,
  INSTITUTION_TYPE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  buildSetupSteps,
  setupCompletion,
  type AcademicTerm,
  type AcademicYear,
  type School,
  type SetupProgress,
  type PeopleCounts,
  studentName,
} from '@klasora/shared';
import KStatCard from '@/components/ui/KStatCard.vue';
import KCard from '@/components/ui/KCard.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KAlert from '@/components/ui/KAlert.vue';
import KButton from '@/components/ui/KButton.vue';
import KSkeleton from '@/components/ui/KSkeleton.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KProgressRing from '@/components/ui/KProgressRing.vue';
import KIconTile from '@/components/ui/KIconTile.vue';
import { useAuthStore } from '@/stores/auth';
import { fetchSchool, fetchSchoolOverview, type SchoolOverview } from '@/services/workspace';
import { fetchSetupProgress, listAcademicYears, listTerms } from '@/services/setup';
import { fetchPeopleCounts, signedPhotoUrls } from '@/services/students';
import { attendanceReport } from '@/services/academics';
import TodayCard from '@/components/academics/TodayCard.vue';
import FeesSummaryCard from '@/components/finance/FeesSummaryCard.vue';
import { greetingFor } from '@/lib/time';
import { formatDay, useSchool } from '@/composables/useSchool';

const auth = useAuthStore();
const { workspace, slug, words, can } = useSchool();

const school = ref<School | null>(null);
const overview = ref<SchoolOverview | null>(null);
const progress = ref<SetupProgress | null>(null);
const years = ref<AcademicYear[]>([]);
const terms = ref<AcademicTerm[]>([]);
const people = ref<PeopleCounts | null>(null);
const attendanceToday = ref<{ rate: number | null; absent: number; classes: number } | null>(null);
const loading = ref(true);
const error = ref('');

async function load() {
  const schoolId = workspace.currentSchoolId;
  if (!schoolId) return;
  loading.value = true;
  error.value = '';
  try {
    const [s, o, p, y, t] = await Promise.all([
      fetchSchool(schoolId),
      fetchSchoolOverview(schoolId, { canViewStaff: can('staff.view'), canViewBilling: can('billing.view') }),
      fetchSetupProgress(schoolId),
      listAcademicYears(schoolId),
      listTerms(schoolId),
    ]);
    school.value = s;
    overview.value = o;
    progress.value = p;
    years.value = y;
    terms.value = t;
    people.value = workspace.canAny(['students.view', 'staff.view']) ? await fetchPeopleCounts(schoolId).catch(() => null) : null;
    if (can('attendance.view') && can('students.view')) {
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const rows = await attendanceReport(schoolId, day, day).catch(() => []);
      const t = rows.reduce((acc, r) => ({ present: acc.present + r.present + r.late, total: acc.total + r.total, absent: acc.absent + r.absent }), { present: 0, total: 0, absent: 0 });
      attendanceToday.value = { rate: t.total ? Math.round((t.present / t.total) * 100) : null, absent: t.absent, classes: rows.length };
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
watch(() => workspace.currentSchoolId, load, { immediate: true });

const greeting = computed(() => greetingFor(new Date(), school.value?.timezone));
const today = computed(() =>
  new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
);

const currentYear = computed(() => years.value.find((y) => y.is_current) ?? null);
const currentTerm = computed(() => terms.value.find((t) => t.is_current) ?? null);
const yearTerms = computed(() =>
  currentYear.value ? terms.value.filter((t) => t.academic_year_id === currentYear.value!.id) : [],
);

/** Where today sits in the current term: before it, during it, or after it. */
const termProgress = computed(() => {
  const term = currentTerm.value;
  if (!term) return null;
  const start = Date.parse(term.start_date);
  const end = Date.parse(term.end_date) + 86_400_000;
  const now = Date.now();
  const pct = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  if (now < start) return { state: 'upcoming' as const, pct: 0, days: Math.ceil((start - now) / 86_400_000) };
  if (now >= end) return { state: 'ended' as const, pct: 100, days: 0 };
  return { state: 'running' as const, pct, days: Math.ceil((end - now) / 86_400_000) };
});

/** Guardians without staff access see their children instead of school figures. */
const parentOnly = computed(
  () => workspace.isGuardian && !workspace.canAny(['students.view', 'staff.view', 'academics.view', 'settings.view', 'finance.view']),
);
const childPhotos = ref<Record<string, string>>({});
watch(
  () => workspace.children,
  async (kids) => (childPhotos.value = kids.length ? await signedPhotoUrls(kids.map((k) => k.photo_path)).catch(() => ({})) : {}),
  { immediate: true },
);

const isAdmin = computed(() => workspace.canAny(['settings.edit', 'academics.create', 'staff.create']));
const steps = computed(() =>
  progress.value
    ? buildSetupSteps(progress.value, words.value).filter((s) => s.anyOf.some((p) => workspace.can(p)))
    : [],
);
const completion = computed(() => (progress.value ? setupCompletion(buildSetupSteps(progress.value, words.value)) : 0));
const nextStep = computed(() => steps.value.find((s) => !s.done && !s.optional) ?? steps.value.find((s) => !s.done));
const showSetup = computed(() => isAdmin.value && progress.value && !progress.value.setup_completed_at && completion.value < 100);

const trialDaysLeft = computed(() => {
  const sub = overview.value?.subscription;
  if (!sub || sub.status !== 'trialing' || !sub.trial_ends_at) return null;
  return Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86_400_000));
});

const subscriptionDetail = computed(() => {
  const sub = overview.value?.subscription;
  if (!sub) return '';
  if (trialDaysLeft.value !== null) {
    return trialDaysLeft.value === 0 ? 'Trial ends today' : `${trialDaysLeft.value} day${trialDaysLeft.value === 1 ? '' : 's'} left in trial`;
  }
  return SUBSCRIPTION_STATUS_LABELS[sub.status];
});

const contact = computed(() => {
  const s = school.value;
  if (!s) return [];
  return [
    { icon: MapPin, label: 'Address', value: [s.address, s.city, s.state, COUNTRIES.find((c) => c.code === s.country)?.name ?? s.country].join(', ') },
    { icon: Mail, label: 'Email', value: s.email },
    { icon: Phone, label: 'Phone', value: s.phone },
    { icon: Globe, label: 'Website', value: s.website ?? 'Not added' },
  ];
});
</script>

<template>
  <div class="space-y-6">
    <!-- Hero -->
    <section class="k-bg-hero k-fade-up relative overflow-hidden rounded-[20px] px-6 py-7 text-white shadow-hover sm:px-9 sm:py-9">
      <div class="k-dots-light pointer-events-none absolute inset-0" aria-hidden="true" />
      <svg class="pointer-events-none absolute -right-10 -bottom-16 opacity-[0.16]" width="380" height="300" viewBox="0 0 380 300" fill="none" aria-hidden="true">
        <g stroke="#93C5FD" stroke-width="1.4">
          <path d="M20 240 L130 150 L250 210 L350 80" />
          <path d="M130 150 L180 40 L350 80" />
          <path d="M20 240 L100 300 L250 210" />
        </g>
        <g fill="#93C5FD">
          <circle cx="20" cy="240" r="6" /><circle cx="130" cy="150" r="8" /><circle cx="250" cy="210" r="6" />
          <circle cx="350" cy="80" r="6" /><circle cx="180" cy="40" r="5" />
        </g>
      </svg>

      <div class="relative flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex min-w-0 items-start gap-5">
          <div class="hidden shrink-0 sm:block">
            <KAvatar :name="workspace.currentSchool?.name ?? 'School'" :src="school?.logo_url" :size="60" square class="shadow-lg ring-4 ring-white/10" />
          </div>
          <div class="min-w-0">
            <p class="flex items-center gap-2 text-[13px] text-[#C7D2E3]">
              <CalendarDays :size="15" aria-hidden="true" /> {{ today }}
            </p>
            <h1 class="mt-2 text-[26px] leading-tight font-semibold tracking-tight sm:text-[30px]">
              {{ greeting }}, {{ auth.firstName }}
            </h1>
            <p class="mt-1.5 text-[14.5px] text-[#C7D2E3]">
              Here's what's happening at {{ workspace.currentSchool?.name ?? 'your school' }} today.
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <span
                v-if="currentYear"
                class="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-medium ring-1 ring-white/15"
              >
                <CalendarRange :size="14" aria-hidden="true" />
                {{ currentYear.name }} session<template v-if="currentTerm">, {{ currentTerm.name }}</template>
              </span>
              <span
                v-else-if="!loading"
                class="inline-flex items-center gap-1.5 rounded-full bg-[#F59E0B]/15 px-3 py-1 text-[12.5px] font-medium text-[#FCD34D] ring-1 ring-[#F59E0B]/30"
              >
                <CalendarRange :size="14" aria-hidden="true" /> No current session yet
              </span>
              <span
                v-if="school?.motto"
                class="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12.5px] italic ring-1 ring-white/15"
              >
                “{{ school.motto }}”
              </span>
            </div>
          </div>
        </div>

        <div v-if="showSetup" class="flex shrink-0 items-center gap-5 rounded-2xl bg-white/[0.07] p-4 pr-5 ring-1 ring-white/10 backdrop-blur">
          <KProgressRing :value="completion" :size="76" light />
          <div>
            <p class="text-[13px] text-[#C7D2E3]">School setup</p>
            <p class="text-[15px] font-semibold">{{ nextStep ? 'Next: ' + nextStep.title : 'Almost there' }}</p>
            <KButton class="mt-3" variant="white" size="sm" :icon-right="ArrowRight" :to="{ name: 'setup', params: { slug } }">
              Continue setup
            </KButton>
          </div>
        </div>
        <div v-else-if="can('staff.create')" class="flex shrink-0 gap-2">
          <KButton variant="glass" :icon="UserPlus" :to="{ name: 'staff', params: { slug } }">Invite staff</KButton>
        </div>
      </div>
    </section>

    <KAlert v-if="error" tone="danger">
      {{ error }}
      <template #action><KButton size="sm" variant="secondary" @click="load">Retry</KButton></template>
    </KAlert>

    <!-- Parents: their children first. -->
    <section v-if="workspace.isGuardian" aria-labelledby="children-heading">
      <div class="mb-3 flex items-center justify-between">
        <h2 id="children-heading" class="k-section-title">Your children</h2>
        <RouterLink :to="{ name: 'children', params: { slug } }" class="text-[13.5px] font-medium text-brand-ink hover:underline">See all</RouterLink>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <RouterLink
          v-for="child in workspace.children"
          :key="child.student_id"
          :to="{ name: 'student-detail', params: { slug, studentId: child.student_id } }"
          class="group flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-hover"
        >
          <KAvatar :name="studentName(child)" :src="child.photo_path ? childPhotos[child.photo_path] : null" :size="52" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15px] font-semibold group-hover:text-brand-ink">{{ studentName(child) }}</span>
            <span class="block text-[13px] text-ink-muted">{{ child.class_name ?? 'Class not set yet' }}</span>
          </span>
          <ArrowRight :size="17" class="text-ink-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </RouterLink>
      </div>
    </section>

    <!-- Key figures: every number comes from the database. -->
    <div v-if="!parentOnly" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KStatCard
        v-if="can('students.view')"
        label="Students"
        :icon="GraduationCap"
        tone="brand"
        :loading="loading"
        :value="people?.active_students ?? 0"
        :detail="people ? `${people.guardians_with_access} parent${people.guardians_with_access === 1 ? '' : 's'} using the portal` : ''"
        :to="{ name: 'students', params: { slug } }"
      />
      <KStatCard
        :label="can('staff.view') ? 'Teachers and staff' : 'People in your school'"
        :icon="Users"
        tone="info"
        :loading="loading"
        :value="people?.staff ?? progress?.members ?? 0"
        :detail="people ? `${people.teachers} teacher${people.teachers === 1 ? '' : 's'}${progress?.pending_invitations ? `, ${progress.pending_invitations} invited` : ''}` : 'Active members'"
        :to="can('staff.view') ? { name: 'staff', params: { slug } } : undefined"
      />
      <KStatCard
        v-if="attendanceToday"
        label="Attendance today"
        :icon="CalendarCheck"
        tone="success"
        :loading="loading"
        :value="attendanceToday.rate === null ? 'Not taken' : `${attendanceToday.rate}%`"
        :detail="attendanceToday.classes ? `${attendanceToday.absent} absent across ${attendanceToday.classes} registers` : 'No registers submitted yet'"
        :to="{ name: 'attendance', params: { slug } }"
      />
      <KStatCard
        v-else
        :label="words.groups"
        :icon="SchoolIcon"
        tone="violet"
        :loading="loading"
        :value="progress?.classes ?? 0"
        :detail="progress?.classes ? `Across ${progress.campuses} campus${progress.campuses === 1 ? '' : 'es'}` : `No ${words.groups.toLowerCase()} yet`"
        :to="can('academics.view') ? { name: 'classes', params: { slug } } : undefined"
      />
      <KStatCard
        v-if="!can('students.view')"
        :label="words.subjects"
        :icon="BookOpen"
        tone="success"
        :loading="loading"
        :value="progress?.subjects ?? 0"
        :detail="progress?.class_subjects ? `${progress.class_subjects} ${words.group.toLowerCase()} assignments` : 'Not assigned yet'"
        :to="can('academics.view') ? { name: 'subjects', params: { slug } } : undefined"
      />
      <KStatCard
        v-if="can('billing.view')"
        label="Subscription"
        :icon="CreditCard"
        tone="warning"
        :loading="loading"
        :value="overview?.subscription?.plan?.name ?? 'None'"
        :detail="subscriptionDetail"
      />
      <KStatCard
        v-else
        label="Campuses"
        :icon="Building2"
        tone="info"
        :loading="loading"
        :value="progress?.campuses ?? 0"
        :detail="overview?.campuses.find((c) => c.is_main)?.name ? `Main: ${overview?.campuses.find((c) => c.is_main)?.name}` : ''"
        :to="can('settings.view') ? { name: 'campuses', params: { slug } } : undefined"
      />
    </div>

    <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <div class="space-y-6 lg:col-span-2">
      <!-- Setup checklist, or the academic calendar once setup is done -->
      <KCard
        v-if="isAdmin && steps.length"
        data-tour="dashboard-setup"
        :padded="false"
        :icon="Sparkles"
        title="Get your school ready"
        :description="`${completion}% complete. Each step unlocks more of Klasora.`"
      >
        <template #actions>
          <KButton size="sm" variant="secondary" :to="{ name: 'setup', params: { slug } }">Open setup guide</KButton>
        </template>
        <div class="px-5 pt-4">
          <div class="h-2 overflow-hidden rounded-full bg-surface-muted">
            <div class="k-bg-brand h-full rounded-full transition-[width] duration-700" :style="{ width: `${completion}%` }" />
          </div>
        </div>
        <KSkeleton v-if="loading" :lines="5" class="p-5" />
        <ul v-else class="divide-y divide-line p-2">
          <li v-for="step in steps" :key="step.key">
            <RouterLink
              :to="{ name: step.routeName, params: { slug } }"
              class="group flex items-center gap-3.5 rounded-xl px-3 py-3 transition-colors hover:bg-surface-muted/70"
            >
              <CheckCircle2 v-if="step.done" :size="22" class="shrink-0 text-success" aria-hidden="true" />
              <Circle v-else :size="22" class="shrink-0 text-line-strong" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span :class="['block text-[14px] font-medium', step.done ? 'text-ink-muted line-through decoration-line-strong' : 'text-ink']">
                  {{ step.title }}
                </span>
                <span class="block truncate text-[12.5px] text-ink-muted">{{ step.summary }}</span>
              </span>
              <KBadge v-if="step.optional && !step.done" tone="neutral">Optional</KBadge>
              <span class="sr-only">{{ step.done ? 'Done' : 'Not done' }}</span>
              <ArrowRight :size="16" class="shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-brand-ink" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </KCard>

      <KCard v-else :icon="CalendarRange" tone="info" title="Academic calendar" :description="currentYear ? `${currentYear.name} session` : 'No session has been set up yet'">
        <template #actions>
          <KButton v-if="can('academics.view')" size="sm" variant="secondary" :to="{ name: 'academic-calendar', params: { slug } }">View calendar</KButton>
        </template>
        <KSkeleton v-if="loading" :lines="3" />
        <p v-else-if="!yearTerms.length" class="text-[13.5px] text-ink-muted">
          Once your school adds {{ words.periods.toLowerCase() }}, they will appear here with their dates.
        </p>
        <ol v-else class="grid gap-3 sm:grid-cols-3">
          <li
            v-for="term in yearTerms"
            :key="term.id"
            :class="['rounded-xl border p-4', term.is_current ? 'border-brand/40 bg-brand-soft' : 'border-line bg-surface-muted/40']"
          >
            <p class="text-[13.5px] font-semibold">{{ term.name }}</p>
            <p class="mt-1 text-[12.5px] text-ink-muted">{{ formatDay(term.start_date) }} to {{ formatDay(term.end_date) }}</p>
            <KBadge v-if="term.is_current" tone="brand" class="mt-2">Current</KBadge>
          </li>
        </ol>
      </KCard>

      <!-- School profile -->
      <KCard :icon="SchoolIcon" title="School profile" :description="school ? INSTITUTION_TYPE_LABELS[school.institution_type] : ''">
        <template #actions>
          <KButton v-if="can('settings.view')" size="sm" variant="ghost" :to="{ name: 'settings', params: { slug } }">Edit profile</KButton>
        </template>
        <KSkeleton v-if="loading" :lines="4" />
        <dl v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div v-for="item in contact" :key="item.label" class="flex min-w-0 gap-3">
            <KIconTile :icon="item.icon" tone="neutral" :size="34" />
            <div class="min-w-0">
              <dt class="text-[12.5px] text-ink-muted">{{ item.label }}</dt>
              <dd class="mt-0.5 truncate text-[14px] text-ink">{{ item.value }}</dd>
            </div>
          </div>
        </dl>
        <p v-if="school" class="mt-5 border-t border-line pt-4 text-[13px] text-ink-muted">
          Organised as <span class="font-medium text-ink">{{ ACADEMIC_STRUCTURE_DETAILS[school.academic_structure].label.toLowerCase() }}</span>.
          Times are shown in {{ school.timezone.replace('_', ' ') }}.
        </p>
      </KCard>
      </div>

      <div class="space-y-6">
      <TodayCard />
      <FeesSummaryCard :year-id="currentYear?.id ?? null" />
      <!-- Current term -->
      <KCard :icon="CalendarDays" tone="violet" :title="currentTerm ? currentTerm.name : `Current ${words.period.toLowerCase()}`">
        <KSkeleton v-if="loading" :lines="3" />
        <template v-else-if="currentTerm && termProgress">
          <div class="flex items-end justify-between">
            <div v-if="termProgress.state === 'ended'">
              <p class="text-[20px] leading-tight font-semibold">This {{ words.period.toLowerCase() }} has ended</p>
              <p class="mt-1 text-[12.5px] text-ink-muted">Mark the next {{ words.period.toLowerCase() }} as current when it begins.</p>
            </div>
            <div v-else>
              <p class="text-[30px] leading-none font-semibold tracking-tight tabular-nums">{{ termProgress.days }}</p>
              <p class="mt-1 text-[12.5px] text-ink-muted">
                {{ termProgress.state === 'upcoming' ? `days until the ${words.period.toLowerCase()} starts` : `days until the ${words.period.toLowerCase()} ends` }}
              </p>
            </div>
            <KBadge v-if="termProgress.state === 'running'" tone="brand">{{ termProgress.pct }}% through</KBadge>
            <KBadge v-else :tone="termProgress.state === 'ended' ? 'neutral' : 'info'">{{ termProgress.state === 'ended' ? 'Ended' : 'Upcoming' }}</KBadge>
          </div>
          <div class="mt-4 h-2 overflow-hidden rounded-full bg-surface-muted">
            <div class="h-full rounded-full bg-gradient-to-r from-[#A78BFA] to-[#6D28D9]" :style="{ width: `${termProgress.pct}%` }" />
          </div>
          <p class="mt-3 text-[12.5px] text-ink-muted">{{ formatDay(currentTerm.start_date) }} to {{ formatDay(currentTerm.end_date) }}</p>
        </template>
        <div v-else class="text-[13.5px] text-ink-muted">
          <p>No {{ words.period.toLowerCase() }} is marked as current.</p>
          <KButton
            v-if="can('academics.edit')"
            class="mt-4"
            size="sm"
            variant="subtle"
            :to="{ name: 'academic-calendar', params: { slug } }"
          >
            Set the current {{ words.period.toLowerCase() }}
          </KButton>
        </div>
      </KCard>

      <!-- Access -->
      <KCard :icon="ShieldCheck" tone="success" title="Your access">
        <ul class="space-y-3">
          <li v-for="role in workspace.currentRoles" :key="role.id" class="flex items-center justify-between gap-3">
            <span class="text-[14px] font-medium">{{ role.name }}</span>
            <KBadge :tone="role.role_key === 'owner' ? 'brand' : 'neutral'">{{ role.is_system_role ? 'Standard role' : 'Custom role' }}</KBadge>
          </li>
        </ul>
        <p class="mt-4 border-t border-line pt-4 text-[13px] text-ink-muted">
          <template v-if="workspace.permissions.size === 0 && workspace.isGuardian">
            You can see the {{ workspace.children.length === 1 ? 'child' : `${workspace.children.length} children` }} linked to you.
          </template>
          <template v-else>
            You hold {{ workspace.permissions.size }} permission{{ workspace.permissions.size === 1 ? '' : 's' }} in this school.
          </template>
        </p>
        <KButton
          v-if="can('roles.view')"
          class="mt-4"
          variant="secondary"
          size="sm"
          :to="{ name: 'roles', params: { slug } }"
        >
          Review roles and permissions
        </KButton>
      </KCard>
      </div>
    </div>
  </div>
</template>
