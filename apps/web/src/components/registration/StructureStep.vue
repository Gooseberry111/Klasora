<script setup lang="ts">
import { computed } from 'vue';
import { Building, CalendarRange, Layers, ListOrdered } from 'lucide-vue-next';
import {
  ACADEMIC_STRUCTURES,
  ACADEMIC_STRUCTURE_DETAILS,
  INSTITUTION_TYPE_LABELS,
  SUGGESTED_STRUCTURE,
  type AcademicStructure,
  type FieldErrors,
} from '@klasora/shared';
import KChoiceCard from '@/components/ui/KChoiceCard.vue';
import { useRegistrationStore } from '@/stores/registration';

defineProps<{ errors: FieldErrors }>();
const registration = useRegistrationStore();

const icons: Record<AcademicStructure, typeof Layers> = {
  classes_grades: ListOrdered,
  sectioned_school: Layers,
  faculties_departments: Building,
  programmes_semesters: CalendarRange,
};

const suggested = computed(() => {
  const type = registration.institution.institutionType;
  return type ? SUGGESTED_STRUCTURE[type] : null;
});
const typeLabel = computed(() => {
  const type = registration.institution.institutionType;
  return type ? INSTITUTION_TYPE_LABELS[type].toLowerCase() : 'institution';
});
</script>

<template>
  <div>
    <p class="mb-5 text-[13.5px] text-ink-muted">
      This shapes how classes, terms and results are set up. You can refine the details after registration.
    </p>
    <fieldset>
      <legend class="sr-only">Academic structure</legend>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KChoiceCard
          v-for="value in ACADEMIC_STRUCTURES"
          :key="value"
          name="academic-structure"
          :value="value"
          :selected="registration.academicStructure === value"
          :title="ACADEMIC_STRUCTURE_DETAILS[value].label"
          :description="ACADEMIC_STRUCTURE_DETAILS[value].description"
          :icon="icons[value]"
          @select="registration.chooseStructure(value)"
        >
          <p v-if="suggested === value" class="mt-2 text-[12px] font-medium text-brand-ink">
            Recommended for a {{ typeLabel }}
          </p>
        </KChoiceCard>
      </div>
    </fieldset>
    <p v-if="errors.academicStructure" class="mt-3 text-[12.5px] text-danger-ink" role="alert">{{ errors.academicStructure }}</p>
  </div>
</template>
