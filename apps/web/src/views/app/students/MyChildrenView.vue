<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ArrowRight, Baby, School } from 'lucide-vue-next';
import { RELATIONSHIP_LABELS, STUDENT_STATUS_LABELS, studentName } from '@klasora/shared';
import KPageHeader from '@/components/ui/KPageHeader.vue';
import KAvatar from '@/components/ui/KAvatar.vue';
import KBadge from '@/components/ui/KBadge.vue';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import { signedPhotoUrls } from '@/services/students';
import { useSchool } from '@/composables/useSchool';

const { workspace, slug } = useSchool();
const photos = ref<Record<string, string>>({});

watch(
  () => workspace.children,
  async (kids) => (photos.value = await signedPhotoUrls(kids.map((k) => k.photo_path)).catch(() => ({}))),
  { immediate: true },
);
</script>

<template>
  <div>
    <KPageHeader
      :icon="Baby"
      eyebrow="Parent portal"
      title="My children"
      :description="`Your children at ${workspace.currentSchool?.name ?? 'this school'}. Attendance, assignments and results appear on each profile as the school turns them on.`"
    />

    <div v-if="!workspace.children.length" class="rounded-card border border-line bg-surface shadow-card">
      <KEmptyState :icon="Baby" title="No children are linked to you yet" description="Ask the school office to link your account to your child's record." />
    </div>

    <div v-else class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <RouterLink
        v-for="child in workspace.children"
        :key="child.student_id"
        :to="{ name: 'student-detail', params: { slug, studentId: child.student_id } }"
        class="group k-fade-up overflow-hidden rounded-[20px] border border-line bg-surface shadow-card transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-hover"
      >
        <div class="k-bg-hero relative h-20"><div class="k-dots-light absolute inset-0" aria-hidden="true" /></div>
        <div class="px-5 pb-5">
          <div class="-mt-10 rounded-full ring-4 ring-surface w-fit">
            <KAvatar :name="studentName(child)" :src="child.photo_path ? photos[child.photo_path] : null" :size="80" />
          </div>
          <p class="mt-3 text-[17px] font-semibold">{{ studentName(child) }}</p>
          <p class="text-[13px] text-ink-muted tabular-nums">{{ child.admission_number }}</p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <KBadge v-if="child.class_name" tone="brand"><School :size="12" aria-hidden="true" /> {{ child.class_name }}</KBadge>
            <KBadge tone="neutral">{{ RELATIONSHIP_LABELS[child.relationship] }}</KBadge>
            <KBadge v-if="child.status !== 'active'" tone="warning">{{ STUDENT_STATUS_LABELS[child.status] }}</KBadge>
          </div>
          <p class="mt-4 flex items-center gap-1.5 text-[13.5px] font-medium text-brand-ink">
            View profile <ArrowRight :size="15" class="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </p>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
