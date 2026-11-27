import { describe, expect, it } from 'vitest';
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_LABELS, announcementSchema, defaultChannels, relativeTime, validate } from '../src';

const base = {
  title: 'Mid term break', body: 'School closes on Friday.', audience: 'everyone' as const, campusId: '', classIds: [], roleIds: [],
  includeParents: true, includeStudents: true, includeTeachers: false, schedule: false, publishAt: '', expiresAt: '',
};

describe('announcements', () => {
  it('needs classes or roles when those audiences are chosen', () => {
    expect(validate(announcementSchema, base).success).toBe(true);
    const r = validate(announcementSchema, { ...base, audience: 'classes' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.classIds).toBe('Choose at least one class.');
    expect(validate(announcementSchema, { ...base, audience: 'roles' }).success).toBe(false);
    expect(validate(announcementSchema, { ...base, audience: 'classes', classIds: ['c'], includeParents: false, includeStudents: false }).success).toBe(false);
  });

  it('only schedules for the future and expires after sending', () => {
    expect(validate(announcementSchema, { ...base, schedule: true, publishAt: '2000-01-01T08:00' }).success).toBe(false);
    expect(validate(announcementSchema, { ...base, schedule: true, publishAt: '2999-01-01T08:00', expiresAt: '2998-01-01T08:00' }).success).toBe(false);
    expect(validate(announcementSchema, { ...base, schedule: true, publishAt: '2999-01-01T08:00', expiresAt: '2999-02-01T08:00' }).success).toBe(true);
  });
});

describe('notifications', () => {
  it('describes every kind and has sensible defaults', () => {
    for (const kind of NOTIFICATION_KINDS) expect(NOTIFICATION_KIND_LABELS[kind].label).toBeTruthy();
    expect(defaultChannels('absence')).toEqual({ push: true, email: false });
    expect(defaultChannels('announcement')).toEqual({ push: true, email: true });
  });

  it('writes times relative to now', () => {
    const now = new Date('2026-11-27T12:00:00');
    expect(relativeTime('2026-11-27T11:59:40', now)).toBe('Just now');
    expect(relativeTime('2026-11-27T11:45:00', now)).toBe('15 min');
    expect(relativeTime('2026-11-27T09:00:00', now)).toBe('3 h');
    expect(relativeTime('2026-11-26T18:00:00', now)).toBe('Yesterday');
  });
});
