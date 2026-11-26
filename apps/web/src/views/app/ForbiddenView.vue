<script setup lang="ts">
import { Lock } from 'lucide-vue-next';
import KEmptyState from '@/components/ui/KEmptyState.vue';
import KButton from '@/components/ui/KButton.vue';
import { useWorkspaceStore } from '@/stores/workspace';

const workspace = useWorkspaceStore();
</script>

<template>
  <KEmptyState
    :icon="Lock"
    title="You don't have access to this page"
    description="Your role in this school doesn't include this area. If you need it, ask your school administrator to update your role."
  >
    <KButton :to="{ name: 'dashboard', params: { slug: workspace.currentSchool?.slug } }">Back to dashboard</KButton>
  </KEmptyState>
</template>
