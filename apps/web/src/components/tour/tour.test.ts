import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { academicVocabulary } from '@klasora/shared';
import { useTourStore } from '@/stores/tour';
import { welcomeTourSteps } from '@/lib/tours';
import { NAVIGATION, visibleNavigation } from '@/navigation';

describe('tour store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '<div data-tour="a"></div><div data-tour="c"></div>';
  });

  it('skips steps whose target is not on the page', () => {
    const tour = useTourStore();
    tour.start('t', [
      { target: 'a', title: 'A', body: '' },
      { target: 'b', title: 'B', body: '' },
      { target: 'c', title: 'C', body: '' },
      { title: 'Centred', body: '' },
    ]);
    expect(tour.steps.map((s) => s.title)).toEqual(['A', 'C', 'Centred']);
  });

  it('moves forward and back, and reports completion', () => {
    const tour = useTourStore();
    const finished = vi.fn();
    tour.start('t', [{ target: 'a', title: 'A', body: '' }, { title: 'B', body: '' }], finished);
    expect(tour.isFirst).toBe(true);
    tour.next();
    expect(tour.current?.title).toBe('B');
    tour.back();
    expect(tour.current?.title).toBe('A');
    tour.next();
    tour.next();
    expect(tour.active).toBe(false);
    expect(finished).toHaveBeenCalledWith(true);
  });

  it('reports a skipped tour as not completed', () => {
    const tour = useTourStore();
    const finished = vi.fn();
    tour.start('t', [{ title: 'Only', body: '' }], finished);
    tour.end(false);
    expect(finished).toHaveBeenCalledWith(false);
  });
});

describe('welcome tour content', () => {
  it('covers every navigation section and uses no dashes', () => {
    const steps = welcomeTourSteps(academicVocabulary('sectioned_school'), 'Demo Academy');
    const targets = steps.map((s) => s.target);
    for (const section of NAVIGATION) {
      expect(targets.some((t) => t === `nav-section-${section.id}` || section.items.some((i) => t === `nav-${i.routeName}`))).toBe(true);
    }
    for (const step of steps) expect(`${step.title} ${step.body}`).not.toMatch(/[–—]|\s-\s/);
  });
});

describe('navigation vocabulary', () => {
  it('renames items to suit a university', () => {
    const items = visibleNavigation(() => true, NAVIGATION, academicVocabulary('faculties_departments')).flatMap((s) => s.items);
    expect(items.find((i) => i.routeName === 'subjects')?.label).toBe('Courses');
    expect(items.find((i) => i.routeName === 'classes')?.label).toBe('Levels');
    expect(items.find((i) => i.routeName === 'departments')?.label).toBe('Faculties and departments');
  });
});
