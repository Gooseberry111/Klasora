<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { CalendarClock, MapPin } from 'lucide-vue-next';
import { WEEK_DAYS, formatTime, isoWeekday, timeToMinutes, type TimetableEntry } from '@klasora/shared';
import KCard from '@/components/ui/KCard.vue';
import { listTimetable } from '@/services/academics';
import { useSchool } from '@/composables/useSchool';
import { useTeaching } from '@/composables/useTeaching';

/** Today's lessons for the signed in teacher, student or parent. Hidden when there are none. */
const { workspace, schoolId, slug } = useSchool();
const teaching = useTeaching();
const entries = ref<TimetableEntry[]>([]);
const day = isoWeekday();

async function load() {
  if (!schoolId.value) return;
  const childClasses = workspace.children.map((c) => c.class_id).filter((x): x is string => Boolean(x));
  const ownClass = workspace.myStudent?.class_id ? [workspace.myStudent.class_id] : [];
  const lists = await Promise.all([
    workspace.myMembershipIds.length ? listTimetable(schoolId.value, { teacherMembershipIds: workspace.myMembershipIds }).catch(() => []) : Promise.resolve([]),
    ownClass.length || childClasses.length ? listTimetable(schoolId.value, { classIds: [...ownClass, ...childClasses] }).catch(() => []) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  entries.value = lists
    .flat()
    .filter((e) => e.day_of_week === day && (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}
watch([schoolId, () => workspace.children, () => workspace.myStudent], load, { immediate: true });

const now = computed(() => new Date().getHours() * 60 + new Date().getMinutes());
const title = (e: TimetableEntry) => (e.subject_id ? teaching.subjectName(e.subject_id) : e.label) || 'Period';
</script>

<template>
  <KCard v-if="entries.length" :icon="CalendarClock" tone="info" :title="`Today, ${WEEK_DAYS[day - 1]!.label}`" :padded="false">
    <template #actions>
      <RouterLink :to="{ name: 'timetable', params: { slug } }" class="text-[13px] font-medium text-brand-ink hover:underline">Full week</RouterLink>
    </template>
    <ol class="divide-y divide-line">
      <li
        v-for="e in entries"
        :key="e.id"
        :class="['flex items-center gap-3 px-5 py-3', timeToMinutes(e.start_time) <= now && now < timeToMinutes(e.end_time) ? 'bg-brand-soft/60' : '', timeToMinutes(e.end_time) <= now ? 'opacity-55' : '']"
      >
        <span class="w-[92px] shrink-0 text-[12.5px] text-ink-muted tabular-nums">{{ formatTime(e.start_time) }} to {{ formatTime(e.end_time) }}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{{ title(e) }}</span>
          <span class="flex items-center gap-2 text-[12px] text-ink-muted">
            {{ teaching.className(e.class_id) }}
            <span v-if="e.room" class="flex items-center gap-0.5"><MapPin :size="11" aria-hidden="true" /> {{ e.room }}</span>
          </span>
        </span>
        <span v-if="timeToMinutes(e.start_time) <= now && now < timeToMinutes(e.end_time)" class="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">Now</span>
      </li>
    </ol>
  </KCard>
</template>
