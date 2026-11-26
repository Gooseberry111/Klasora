import { defineStore } from 'pinia';
import { reactive, ref, watch } from 'vue';
import {
  SUGGESTED_STRUCTURE,
  type AcademicStructure,
  type InstitutionType,
  type SchoolRegistrationInput,
} from '@klasora/shared';

const STORAGE_KEY = 'klasora.registration';

export interface InstitutionDraft {
  name: string;
  institutionType: InstitutionType | '';
  email: string;
  phone: string;
  country: string;
  state: string;
  city: string;
  address: string;
  website: string;
}

export interface AdministratorDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

function emptyInstitution(): InstitutionDraft {
  return { name: '', institutionType: '', email: '', phone: '', country: 'NG', state: '', city: '', address: '', website: '' };
}

function emptyAdministrator(): AdministratorDraft {
  return { firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' };
}

/**
 * Wizard state for school registration. Kept in memory so moving between
 * steps never loses input, and mirrored to sessionStorage (without passwords)
 * so an accidental refresh does not wipe the form.
 */
export const useRegistrationStore = defineStore('registration', () => {
  const step = ref(1);
  const institution = reactive<InstitutionDraft>(emptyInstitution());
  const academicStructure = ref<AcademicStructure | ''>('');
  const structureTouched = ref(false);
  const administrator = reactive<AdministratorDraft>(emptyAdministrator());
  const planCode = ref('starter');

  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved) {
      Object.assign(institution, saved.institution ?? {});
      academicStructure.value = saved.academicStructure ?? '';
      structureTouched.value = Boolean(saved.structureTouched);
      Object.assign(administrator, { ...saved.administrator, password: '', confirmPassword: '' });
      planCode.value = saved.planCode ?? 'starter';
      step.value = Math.min(Math.max(Number(saved.step) || 1, 1), 5);
    }
  } catch {
    /* ignore corrupt or unavailable storage */
  }

  // Suggest a structure from the institution type until the user picks one.
  watch(
    () => institution.institutionType,
    (type) => {
      if (type && !structureTouched.value) academicStructure.value = SUGGESTED_STRUCTURE[type];
    },
  );

  watch(
    [step, institution, academicStructure, structureTouched, administrator, planCode],
    () => {
      try {
        const { password: _p, confirmPassword: _c, ...safeAdmin } = administrator;
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            step: step.value,
            institution,
            academicStructure: academicStructure.value,
            structureTouched: structureTouched.value,
            administrator: safeAdmin,
            planCode: planCode.value,
          }),
        );
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  function chooseStructure(value: AcademicStructure) {
    academicStructure.value = value;
    structureTouched.value = true;
  }

  function payload(): SchoolRegistrationInput {
    return {
      ...institution,
      institutionType: institution.institutionType as InstitutionType,
      academicStructure: academicStructure.value as AcademicStructure,
      planCode: planCode.value,
    };
  }

  function reset() {
    step.value = 1;
    Object.assign(institution, emptyInstitution());
    Object.assign(administrator, emptyAdministrator());
    academicStructure.value = '';
    structureTouched.value = false;
    planCode.value = 'starter';
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return { step, institution, academicStructure, administrator, planCode, chooseStructure, payload, reset };
});
