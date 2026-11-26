<script setup lang="ts">
import { RouterView } from 'vue-router';
import { isSupabaseConfigured } from '@/lib/supabase';
import KFeedbackHost from '@/components/ui/KFeedbackHost.vue';
import ConfigurationMissing from '@/views/ConfigurationMissing.vue';
</script>

<template>
  <ConfigurationMissing v-if="!isSupabaseConfigured" />
  <template v-else>
    <RouterView />
    <KFeedbackHost />
  </template>
</template>
