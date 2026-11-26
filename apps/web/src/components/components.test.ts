import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import KButton from './ui/KButton.vue';
import KInput from './ui/KInput.vue';
import KCheckbox from './ui/KCheckbox.vue';
import { useRegistrationStore } from '@/stores/registration';
import { useFeedbackStore } from '@/stores/feedback';

describe('KButton', () => {
  it('disables itself and announces busy state while loading', () => {
    const wrapper = mount(KButton, { props: { loading: true }, slots: { default: 'Save' } });
    const button = wrapper.get('button');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it('emits clicks when enabled', async () => {
    const wrapper = mount(KButton, { slots: { default: 'Go' } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});

describe('KInput', () => {
  it('links its label and exposes errors to assistive technology', () => {
    const wrapper = mount(KInput, { props: { label: 'Email', error: 'Enter a valid email address.', id: 'email' } });
    const input = wrapper.get('input');
    expect(wrapper.get('label').attributes('for')).toBe('email');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe('email-error');
    expect(wrapper.get('[role="alert"]').text()).toBe('Enter a valid email address.');
  });

  it('toggles password visibility', async () => {
    const wrapper = mount(KInput, { props: { label: 'Password', type: 'password' } });
    expect(wrapper.get('input').attributes('type')).toBe('password');
    await wrapper.get('button[aria-label="Show password"]').trigger('click');
    expect(wrapper.get('input').attributes('type')).toBe('text');
  });

  it('forwards extra attributes to the input element', () => {
    const wrapper = mount(KInput, { props: { label: 'Name' }, attrs: { autofocus: '', 'data-test': 'x' } });
    expect(wrapper.get('input').attributes('data-test')).toBe('x');
  });

  it('supports v-model', async () => {
    const wrapper = mount(KInput, {
      props: { label: 'Name', modelValue: '', 'onUpdate:modelValue': (v: string) => wrapper.setProps({ modelValue: v }) },
    });
    await wrapper.get('input').setValue('Greenfield');
    expect(wrapper.props('modelValue')).toBe('Greenfield');
  });
});

describe('KCheckbox', () => {
  it('uses an aria-label when it has no visible label', () => {
    const wrapper = mount(KCheckbox, { props: { ariaLabel: 'View Students' } });
    expect(wrapper.get('input').attributes('aria-label')).toBe('View Students');
  });
});

describe('registration store', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  it('suggests an academic structure from the institution type until the user chooses', async () => {
    const store = useRegistrationStore();
    store.institution.institutionType = 'university';
    await Promise.resolve();
    expect(store.academicStructure).toBe('faculties_departments');

    store.chooseStructure('programmes_semesters');
    store.institution.institutionType = 'primary';
    await Promise.resolve();
    expect(store.academicStructure).toBe('programmes_semesters');
  });

  it('survives a reload without ever persisting passwords', async () => {
    const store = useRegistrationStore();
    store.institution.name = 'Greenfield Academy';
    store.administrator.email = 'ada@greenfield.test';
    store.administrator.password = 'secret123';
    store.step = 3;
    await new Promise((r) => setTimeout(r, 0));

    const raw = sessionStorage.getItem('klasora.registration') ?? '';
    expect(raw).toContain('Greenfield Academy');
    expect(raw).not.toContain('secret123');

    setActivePinia(createPinia());
    const restored = useRegistrationStore();
    expect(restored.institution.name).toBe('Greenfield Academy');
    expect(restored.step).toBe(3);
    expect(restored.administrator.password).toBe('');
  });
});

describe('feedback store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('resolves confirmations with the user choice', async () => {
    const feedback = useFeedbackStore();
    const pending = feedback.confirm({ title: 'Delete role?', description: 'This cannot be undone.' });
    feedback.settleConfirmation(true);
    await expect(pending).resolves.toBe(true);
  });

  it('cancels a previous confirmation when a new one opens', async () => {
    const feedback = useFeedbackStore();
    const first = feedback.confirm({ title: 'A', description: '' });
    void feedback.confirm({ title: 'B', description: '' });
    await expect(first).resolves.toBe(false);
  });
});
