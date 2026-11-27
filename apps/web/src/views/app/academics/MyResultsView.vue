<script setup lang="ts">
import { watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { Trophy } from 'lucide-vue-next';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import { useSchool } from '@/composables/useSchool';

/** A student's results live on their own profile; this page sends them there. */
const router = useRouter();
const { workspace, slug } = useSchool();

watchEffect(() => {
  const me = workspace.myStudent;
  if (me) void router.replace({ name: 'student-detail', params: { slug: slug.value, studentId: me.student_id }, query: { tab: 'results' } });
});
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card">
    <KEmptyState :icon="Trophy" title="Results are for students" description="Your results appear here once your school links your student record to this account." />
  </div>
</template>
