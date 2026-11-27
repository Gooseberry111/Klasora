import type { ReportCard } from '@klasora/shared';

export interface ReportCardDocument {
  card: ReportCard;
  school: { name: string; motto: string | null; address: string; email: string; phone: string; logoUrl: string | null };
  student: { name: string; admissionNumber: string; className: string };
  termLabel: string;
  showPositions: boolean;
}

async function imageData(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const ordinal = (n: number) => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

export const reportCardFileName = (doc: ReportCardDocument) =>
  `${doc.student.name.replace(/\W+/g, '_')}_${doc.termLabel.replace(/\W+/g, '_')}_report_card.pdf`;

/** Builds and downloads the report card. */
export async function downloadReportCardPdf(doc: ReportCardDocument): Promise<void> {
  const pdf = await buildReportCardPdf(doc);
  pdf.save(reportCardFileName(doc));
}

/** Builds a printable A4 report card. jsPDF loads only when needed. */
export async function buildReportCardPdf(doc: ReportCardDocument) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const navy: [number, number, number] = [20, 36, 58];
  const blue: [number, number, number] = [37, 99, 235];
  const muted: [number, number, number] = [100, 116, 139];
  const { card } = doc;

  // Header band
  pdf.setFillColor(...navy);
  pdf.rect(0, 0, width, 110, 'F');
  let textX = 40;
  if (doc.school.logoUrl) {
    const logo = await imageData(doc.school.logoUrl);
    if (logo) {
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(40, 22, 66, 66, 8, 8, 'F');
      try {
        pdf.addImage(logo, 44, 26, 58, 58);
        textX = 122;
      } catch {
        textX = 40;
      }
    }
  }
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(doc.school.name, textX, 50);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  if (doc.school.motto) pdf.text(doc.school.motto, textX, 66);
  pdf.setTextColor(199, 210, 227);
  pdf.text(`${doc.school.address}  |  ${doc.school.phone}  |  ${doc.school.email}`, textX, 84, { maxWidth: width - textX - 40 });

  // Title
  pdf.setTextColor(...navy);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('STUDENT REPORT CARD', 40, 142);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(...muted);
  pdf.text(doc.termLabel, width - 40, 142, { align: 'right' });

  // Student panel
  pdf.setDrawColor(229, 234, 241);
  pdf.setFillColor(247, 249, 252);
  pdf.roundedRect(40, 156, width - 80, 64, 8, 8, 'FD');
  const fields: [string, string][] = [
    ['Student', doc.student.name],
    ['Admission number', doc.student.admissionNumber],
    ['Class', doc.student.className],
    ['Average', card.average !== null ? `${card.average.toFixed(2)} (${card.grade ?? ''})` : 'Not available'],
  ];
  if (doc.showPositions && card.position) fields.push(['Position', `${ordinal(card.position)} of ${card.class_size ?? ''}`]);
  const colWidth = (width - 100) / fields.length;
  fields.forEach(([label, value], i) => {
    const x = 52 + i * colWidth;
    pdf.setFontSize(8.5);
    pdf.setTextColor(...muted);
    pdf.text(label.toUpperCase(), x, 178);
    pdf.setFontSize(11);
    pdf.setTextColor(23, 32, 51);
    pdf.setFont('helvetica', 'bold');
    pdf.text(value, x, 198, { maxWidth: colWidth - 10 });
    pdf.setFont('helvetica', 'normal');
  });

  // Subjects
  autoTable(pdf, {
    startY: 238,
    margin: { left: 40, right: 40 },
    head: [['Subject', 'Score', 'Grade', 'Remark', ...(doc.showPositions ? ['Position'] : [])]],
    body: card.subjects.map((s) => [
      s.name,
      Number(s.total).toFixed(1),
      s.grade ?? '',
      s.remark ?? '',
      ...(doc.showPositions ? [s.position ? ordinal(s.position) : ''] : []),
    ]),
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 7, textColor: [23, 32, 51], lineColor: [229, 234, 241], lineWidth: 0.5 },
    headStyles: { fillColor: blue, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center', fontStyle: 'bold' }, 4: { halign: 'center' } },
  });
  let y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;

  // Attendance
  const a = card.attendance;
  const attended = (a.present ?? 0) + (a.late ?? 0);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...navy);
  pdf.text('Attendance', 40, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(23, 32, 51);
  y += 16;
  pdf.text(
    a.total
      ? `Present ${a.present ?? 0}, late ${a.late ?? 0}, absent ${a.absent ?? 0}, excused ${a.excused ?? 0}, out of ${a.total} school days (${Math.round((attended / a.total) * 100)}% attendance).`
      : 'No attendance was recorded this term.',
    40,
    y,
    { maxWidth: width - 80 },
  );
  y += 28;

  // Comments
  const comment = (title: string, text: string | null) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...navy);
    pdf.text(title, 40, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(23, 32, 51);
    const lines = pdf.splitTextToSize(text || 'No comment.', width - 80) as string[];
    pdf.text(lines, 40, y + 16);
    y += 30 + lines.length * 13;
  };
  comment("Class teacher's comment", card.teacher_comment);
  comment("Principal's comment", card.principal_comment);

  // Footer
  const height = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(229, 234, 241);
  pdf.line(40, height - 56, width - 40, height - 56);
  pdf.setFontSize(8.5);
  pdf.setTextColor(...muted);
  pdf.text(
    card.published_at ? `Approved and published on ${new Date(card.published_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Draft report card, not yet published.',
    40,
    height - 40,
  );
  pdf.text('Generated with Klasora. Education, connected.', width - 40, height - 40, { align: 'right' });

  return pdf;
}
