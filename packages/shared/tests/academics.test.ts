import { describe, expect, it } from 'vitest';
import {
  assignmentState,
  attendanceRate,
  formatTime,
  gradeFor,
  isoWeekday,
  ordinal,
  timeToMinutes,
  timetableEntrySchema,
  validate,
  weekRange,
} from '../src';

describe('time helpers', () => {
  it('formats times the way schools write them', () => {
    expect(formatTime('08:00:00')).toBe('8:00am');
    expect(formatTime('12:30')).toBe('12:30pm');
    expect(formatTime('15:05')).toBe('3:05pm');
    expect(timeToMinutes('09:40:00')).toBe(580);
  });

  it('numbers weekdays from Monday', () => {
    expect(isoWeekday(new Date(2026, 10, 30))).toBe(1); // Monday
    expect(isoWeekday(new Date(2026, 10, 29))).toBe(7); // Sunday
    expect(weekRange(new Date(2026, 11, 3))).toEqual({ from: '2026-11-30', to: '2026-12-06' });
  });

  it('rejects a period that ends before it starts', () => {
    const base = { classId: 'c', subjectId: 's', label: '', teacherMembershipId: '', dayOfWeek: 1, room: '' };
    expect(validate(timetableEntrySchema, { ...base, startTime: '09:00', endTime: '08:00' }).success).toBe(false);
    expect(validate(timetableEntrySchema, { ...base, startTime: '08:00', endTime: '08:40' }).success).toBe(true);
    expect(validate(timetableEntrySchema, { ...base, subjectId: '', startTime: '08:00', endTime: '08:40' }).success).toBe(false);
  });
});

describe('attendance and assignments', () => {
  it('counts late arrivals as attended', () => {
    expect(attendanceRate({ present: 8, late: 1, total: 10 })).toBe(90);
    expect(attendanceRate({ present: 0, late: 0, total: 0 })).toBeNull();
  });

  it('shows open, past due and closed assignments correctly', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    expect(assignmentState({ status: 'published', due_at: '2026-11-28T12:00:00Z' }, now)).toBe('open');
    expect(assignmentState({ status: 'published', due_at: '2026-11-26T12:00:00Z' }, now)).toBe('past_due');
    expect(assignmentState({ status: 'closed', due_at: '2026-11-28T12:00:00Z' }, now)).toBe('closed');
    expect(assignmentState({ status: 'draft', due_at: '2026-11-28T12:00:00Z' }, now)).toBe('draft');
  });
});

describe('grading', () => {
  const bands = [
    { grade: 'A', min_score: 70, remark: 'Excellent' },
    { grade: 'C', min_score: 50, remark: 'Good' },
    { grade: 'F', min_score: 0, remark: 'Fail' },
  ];

  it('uses the band whose starting score is reached', () => {
    expect(gradeFor(bands, 70)?.grade).toBe('A');
    expect(gradeFor(bands, 69.99)?.grade).toBe('C');
    expect(gradeFor(bands, 0)?.grade).toBe('F');
    expect(gradeFor(bands, null)).toBeNull();
  });

  it('writes positions as ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  });
});
