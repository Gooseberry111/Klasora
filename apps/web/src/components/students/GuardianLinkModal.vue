<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Link2, UserPlus } from 'lucide-vue-next';
import {
  GUARDIAN_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  guardianFormSchema,
  validate,
  type FieldErrors,
  type Guardian,
  type GuardianFormInput,
  type GuardianLinkInput,
  type StudentGuardian,
} from '@klasora/shared';
import KModal from '@/components/ui/KModal.vue';
import KButton from '@/components/ui/KButton.vue';
import KInput from '@/components/ui/KInput.vue';
import KSelect from '@/components/ui/KSelect.vue';
import KCheckbox from '@/components/ui/KCheckbox.vue';
import KAlert from '@/components/ui/KAlert.vue';
import { linkGuardian, saveGuardian, updateGuardianLink } from '@/services/students';

/**
 * Adds a guardian to a student (new or existing), or edits an existing link:
 * relationship, primary contact and what the guardian may see.
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{
  schoolId: string;
  studentId: string;
  guardians: Guardian[];
  linkedIds: string[];
  /** When set, the modal edits this link instead of adding one. */
  link?: StudentGuardian | null;
}>();
const emit = defineEmits<{ saved: [] }>();

const mode = ref<'new' | 'existing'>('new');
const existingId = ref('');
const saving = ref(false);
const error = ref('');
const errors = ref<FieldErrors>({});
const person = reactive<GuardianFormInput>({ firstName: '', lastName: '', email: '', phone: '', occupation: '', address: '' });
const settings = reactive<GuardianLinkInput>({
  relationship: 'guardian',
  isPrimary: false,
  isEmergencyContact: false,
  canViewResults: true,
  canViewFinances: true,
  canReceiveNotifications: true,
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  error.value = '';
  errors.value = {};
  Object.assign(person, { firstName: '', lastName: '', email: '', phone: '', occupation: '', address: '' });
  existingId.value = '';
  mode.value = 'new';
  const l = props.link;
  Object.assign(settings, {
    relationship: l?.relationship ?? 'guardian',
    isPrimary: l?.is_primary ?? props.linkedIds.length === 0,
    isEmergencyContact: l?.is_emergency_contact ?? props.linkedIds.length === 0,
    canViewResults: l?.can_view_results ?? true,
    canViewFinances: l?.can_view_finances ?? true,
    canReceiveNotifications: l?.can_receive_notifications ?? true,
  });
});

const available = computed(() => props.guardians.filter((g) => !props.linkedIds.includes(g.id)));

async function submit() {
  error.value = '';
  saving.value = true;
  try {
    if (props.link) {
      await updateGuardianLink(props.link, settings);
    } else {
      let guardianId = existingId.value;
      if (mode.value === 'new') {
        const result = validate(guardianFormSchema, person);
        if (!result.success) {
          errors.value = result.errors;
          return;
        }
        const match = props.guardians.find((g) => result.data.email && g.email?.toLowerCase() === result.data.email);
        guardianId = match ? match.id : (await saveGuardian(props.schoolId, result.data)).id;
      }
      if (!guardianId) {
        error.value = 'Choose a guardian to link.';
        return;
      }
      await linkGuardian(props.schoolId, props.studentId, guardianId, settings);
    }
    emit('saved');
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <KModal v-model:open="open" :title="link ? 'Guardian settings' : 'Add a guardian'" size="lg">
    <div class="space-y-5">
      <KAlert v-if="error" tone="danger">{{ error }}</KAlert>

      <template v-if="!link">
        <div v-if="available.length" class="inline-flex rounded-xl border border-line p-1">
          <button type="button" :class="['flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium', mode === 'new' ? 'k-bg-brand text-white' : 'text-ink-muted']" @click="mode = 'new'">
            <UserPlus :size="15" aria-hidden="true" /> New guardian
          </button>
          <button type="button" :class="['flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium', mode === 'existing' ? 'k-bg-brand text-white' : 'text-ink-muted']" @click="mode = 'existing'">
            <Link2 :size="15" aria-hidden="true" /> Existing guardian
          </button>
        </div>

        <KSelect
          v-if="mode === 'existing'"
          v-model="existingId"
          label="Guardian"
          placeholder="Choose a guardian"
          :options="available.map((g) => ({ value: g.id, label: `${g.first_name} ${g.last_name}${g.email ? ` (${g.email})` : ''}` }))"
        />
        <div v-else class="grid gap-4 sm:grid-cols-2">
          <KInput v-model="person.firstName" label="First name" :error="errors.firstName" required autofocus />
          <KInput v-model="person.lastName" label="Last name" :error="errors.lastName" required />
          <KInput v-model="person.email" type="email" label="Email" hint="Needed for the parent portal." :error="errors.email" optional />
          <KInput v-model="person.phone" type="tel" label="Phone" :error="errors.phone" optional />
          <KInput v-model="person.occupation" label="Occupation" optional />
          <KInput v-model="person.address" label="Address" optional />
        </div>
      </template>

      <div class="grid gap-4 sm:grid-cols-2">
        <KSelect v-model="settings.relationship" label="Relationship to the student" :options="GUARDIAN_RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }))" />
      </div>
      <div class="grid gap-3 rounded-xl bg-surface-muted/60 p-4 sm:grid-cols-2">
        <KCheckbox v-model="settings.isPrimary" label="Primary guardian" description="The first person the school contacts." />
        <KCheckbox v-model="settings.isEmergencyContact" label="Emergency contact" />
        <KCheckbox v-model="settings.canViewResults" label="Can see results" description="Report cards and scores in the parent portal." />
        <KCheckbox v-model="settings.canViewFinances" label="Can see fees" description="Invoices and payments." />
        <KCheckbox v-model="settings.canReceiveNotifications" label="Receives notifications" />
      </div>
    </div>
    <template #footer>
      <KButton variant="secondary" @click="open = false">Cancel</KButton>
      <KButton :loading="saving" @click="submit">{{ link ? 'Save settings' : 'Add guardian' }}</KButton>
    </template>
  </KModal>
</template>
