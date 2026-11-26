<script setup lang="ts">
import { computed } from 'vue';
import { COUNTRIES, INSTITUTION_TYPES, INSTITUTION_TYPE_LABELS, NIGERIAN_STATES, type FieldErrors } from '@klasora/shared';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import { useRegistrationStore } from '@/stores/registration';

defineProps<{ errors: FieldErrors }>();
const registration = useRegistrationStore();

const typeOptions = INSTITUTION_TYPES.map((value) => ({ value, label: INSTITUTION_TYPE_LABELS[value] }));
const countryOptions = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));
const stateOptions = NIGERIAN_STATES.map((s) => ({ value: s, label: s }));
// Bound from script: a literal "https://" in a static attribute trips vue-tsc's template codegen.
const websitePlaceholder = 'https://yourschool.com';
const isNigeria = computed(() => registration.institution.country === 'NG');
</script>

<template>
  <div class="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
    <div class="sm:col-span-2">
      <KInput
        v-model="registration.institution.name"
        label="Institution name"
        placeholder="e.g. Greenfield Academy"
        autocomplete="organization"
        :maxlength="200"
        :error="errors.name"
        required
      />
    </div>
    <div class="sm:col-span-2">
      <KSelect
        v-model="registration.institution.institutionType"
        label="Type of institution"
        placeholder="Choose a type"
        :options="typeOptions"
        :error="errors.institutionType"
        required
      />
    </div>
    <KInput
      v-model="registration.institution.email"
      label="Institution email"
      type="email"
      inputmode="email"
      placeholder="office@school.com"
      :error="errors.email"
      required
    />
    <KInput
      v-model="registration.institution.phone"
      label="Institution phone"
      type="tel"
      inputmode="tel"
      autocomplete="tel"
      placeholder="+234 803 000 0000"
      :error="errors.phone"
      required
    />
    <KSelect v-model="registration.institution.country" label="Country" :options="countryOptions" :error="errors.country" required />
    <div>
      <KSelect
        v-if="isNigeria"
        v-model="registration.institution.state"
        label="State"
        placeholder="Choose a state"
        :options="stateOptions"
        :error="errors.state"
        required
      />
      <KInput v-else v-model="registration.institution.state" label="State / region" :error="errors.state" required />
    </div>
    <KInput v-model="registration.institution.city" label="City / town" autocomplete="address-level2" :error="errors.city" required />
    <KInput
      v-model="registration.institution.website"
      label="Website"
      type="url"
      inputmode="url"
      :placeholder="websitePlaceholder"
      :error="errors.website"
      optional
    />
    <div class="sm:col-span-2">
      <KInput
        v-model="registration.institution.address"
        label="Street address"
        autocomplete="street-address"
        placeholder="12 Allen Avenue"
        :maxlength="500"
        :error="errors.address"
        required
      />
    </div>
  </div>
</template>
