import { describe, expect, it } from 'vitest';
import { buildReportCardPdf, reportCardFileName, type ReportCardDocument } from './reportCardPdf';

describe('report card PDF', () => {
  it('builds a complete card without errors', async () => {
    const doc: ReportCardDocument = {
      card: {
        id: 'rc', school_id: 's', student_id: 'st', class_id: 'k', academic_year_id: 'y', term_id: 't',
        average: 77.5, grade: 'A', position: 2, class_size: 30,
        subjects: [
          { subject_id: 'a', name: 'Mathematics', code: 'MTH', total: 82, grade: 'A', remark: 'Excellent', position: 1 },
          { subject_id: 'b', name: 'English Language', code: 'ENG', total: 73, grade: 'A', remark: 'Excellent', position: 4 },
        ],
        attendance: { present: 50, late: 2, absent: 3, excused: 1, total: 56 },
        teacher_comment: 'A hardworking pupil.', principal_comment: 'Keep it up.',
        status: 'published', generated_at: '2026-12-18T10:00:00Z', published_by: null, published_at: '2026-12-18T10:00:00Z',
        created_at: '2026-12-18T10:00:00Z', updated_at: '2026-12-18T10:00:00Z',
      },
      school: { name: 'Greenfield Academy', motto: 'Knowledge and character', address: '14 Admiralty Way, Lekki, Lagos', email: 'office@greenfield.ng', phone: '+234 803 000 0000', logoUrl: null },
      student: { name: 'Chidi Okeke', admissionNumber: 'GA/2026/0001', className: 'JSS 1A' },
      termLabel: 'First Term, 2026/2027',
      showPositions: true,
    };
    const text = (await buildReportCardPdf(doc)).output();
    for (const expected of ['Chidi Okeke', 'GA/2026/0001', 'Mathematics', 'A hardworking pupil', 'Keep it up', '2nd of 30', '93% attendance']) {
      expect(text).toContain(expected);
    }
    expect(reportCardFileName(doc)).toBe('Chidi_Okeke_First_Term_2026_2027_report_card.pdf');
  });
});
