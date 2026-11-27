<script setup lang="ts">
import { computed, ref } from 'vue';
import { Search, X } from 'lucide-vue-next';
import KAvatar from '@/components/ui/KAvatar.vue';

export interface StudentOption {
  id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
  status?: string;
}

/** Finds a student by name or admission number. */
const props = defineProps<{ students: StudentOption[]; label?: string; error?: string }>();
const model = defineModel<string>({ required: true });

const query = ref('');
const focused = ref(false);
const chosen = computed(() => props.students.find((s) => s.id === model.value) ?? null);
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.students.slice(0, 8);
  return props.students
    .filter((s) => `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(q))
    .slice(0, 8);
});

function onBlur() {
  window.setTimeout(() => (focused.value = false), 150);
}

function choose(s: StudentOption) {
  model.value = s.id;
  query.value = '';
  focused.value = false;
}
</script>

<template>
  <div>
    <p class="mb-1.5 text-[13px] font-medium">{{ label ?? 'Student' }}</p>
    <div v-if="chosen" class="flex items-center gap-3 rounded-xl border border-line bg-surface-muted/50 px-3 py-2">
      <KAvatar :name="`${chosen.first_name} ${chosen.last_name}`" :size="30" />
      <div class="min-w-0 flex-1">
        <p class="font-medium">{{ chosen.first_name }} {{ chosen.last_name }}</p>
        <p class="text-[12.5px] text-ink-muted">{{ chosen.admission_number }}</p>
      </div>
      <button type="button" class="rounded-lg p-1.5 text-ink-subtle hover:bg-surface hover:text-ink" aria-label="Choose a different student" @click="model = ''">
        <X :size="16" aria-hidden="true" />
      </button>
    </div>
    <div v-else class="relative">
      <Search :size="16" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
      <input
        v-model="query"
        type="search"
        class="h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-[14px] outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-3 focus:ring-brand/15"
        placeholder="Search by name or admission number"
        aria-label="Search students"
        @focus="focused = true"
        @blur="onBlur"
      />
      <ul v-if="focused" class="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lg" role="listbox">
        <li v-if="!matches.length" class="px-3 py-2 text-[13px] text-ink-muted">No students match.</li>
        <li v-for="s in matches" :key="s.id">
          <button type="button" class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-muted" role="option" :aria-selected="false" @mousedown.prevent="choose(s)">
            <KAvatar :name="`${s.first_name} ${s.last_name}`" :size="30" />
            <span class="min-w-0 flex-1">
              <span class="block font-medium">{{ s.first_name }} {{ s.last_name }}</span>
              <span class="block text-[12px] text-ink-muted">{{ s.admission_number }}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
    <p v-if="error" class="mt-1.5 text-[12.5px] text-danger-ink">{{ error }}</p>
  </div>
</template>
