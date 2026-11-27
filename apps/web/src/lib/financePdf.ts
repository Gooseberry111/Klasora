/**
 * Printable invoices and receipts, built in the browser from data the viewer
 * is already allowed to read. jsPDF's built in fonts have no naira sign, so
 * amounts use the currency code instead (NGN 150,000.00).
 */
import {
  FEE_CATEGORY_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  minorUnitDigits,
  type Invoice,
  type InvoiceItem,
  type Payment,
} from '@klasora/shared';

export interface FinanceSchool {
  name: string;
  motto: string | null;
  address: string;
  email: string;
  phone: string;
  logoUrl: string | null;
  paymentInstructions: string | null;
}
export interface FinanceStudent {
  name: string;
  admissionNumber: string;
  className: string;
}

export function pdfMoney(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const major = Number(minor) / 10 ** digits;
  return `${currency.toUpperCase()} ${major.toLocaleString('en-NG', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

const dmy = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

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

const navy: [number, number, number] = [20, 36, 58];
const blue: [number, number, number] = [37, 99, 235];
const muted: [number, number, number] = [100, 116, 139];
const ink: [number, number, number] = [23, 32, 51];

async function header(pdf: import('jspdf').jsPDF, school: FinanceSchool, title: string, number: string) {
  const width = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(...navy);
  pdf.rect(0, 0, width, 110, 'F');
  let textX = 40;
  if (school.logoUrl) {
    const logo = await imageData(school.logoUrl);
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
  pdf.text(school.name, textX, 50, { maxWidth: width - textX - 180 });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  if (school.motto) pdf.text(school.motto, textX, 66);
  pdf.setTextColor(199, 210, 227);
  pdf.text(`${school.address}  |  ${school.phone}  |  ${school.email}`, textX, 84, { maxWidth: width - textX - 180 });

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text(title, width - 40, 50, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(number, width - 40, 68, { align: 'right' });
}

function panel(pdf: import('jspdf').jsPDF, y: number, fields: [string, string][]) {
  const width = pdf.internal.pageSize.getWidth();
  pdf.setDrawColor(229, 234, 241);
  pdf.setFillColor(247, 249, 252);
  pdf.roundedRect(40, y, width - 80, 64, 8, 8, 'FD');
  const colWidth = (width - 100) / fields.length;
  fields.forEach(([label, value], i) => {
    const x = 52 + i * colWidth;
    pdf.setFontSize(8.5);
    pdf.setTextColor(...muted);
    pdf.text(label.toUpperCase(), x, y + 22);
    pdf.setFontSize(11);
    pdf.setTextColor(...ink);
    pdf.setFont('helvetica', 'bold');
    pdf.text(value || ' ', x, y + 42, { maxWidth: colWidth - 10 });
    pdf.setFont('helvetica', 'normal');
  });
}

function footer(pdf: import('jspdf').jsPDF, note: string) {
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(229, 234, 241);
  pdf.line(40, height - 56, width - 40, height - 56);
  pdf.setFontSize(8.5);
  pdf.setTextColor(...muted);
  pdf.text(note, 40, height - 40, { maxWidth: width - 260 });
  pdf.text('Generated with Klasora. Education, connected.', width - 40, height - 40, { align: 'right' });
}

const safe = (s: string) => s.replace(/\W+/g, '_');

// -----------------------------------------------------------------------------
// Invoice
// -----------------------------------------------------------------------------
export interface InvoiceDocument {
  invoice: Invoice;
  items: InvoiceItem[];
  school: FinanceSchool;
  student: FinanceStudent;
  periodLabel: string;
}

export const invoiceFileName = (doc: InvoiceDocument) => `${safe(doc.student.name)}_${safe(doc.invoice.invoice_number)}.pdf`;

export async function buildInvoicePdf(doc: InvoiceDocument) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const { invoice } = doc;
  const money = (n: number) => pdfMoney(n, invoice.currency);

  await header(pdf, doc.school, 'INVOICE', invoice.invoice_number);
  panel(pdf, 130, [
    ['Billed to', doc.student.name],
    ['Admission number', doc.student.admissionNumber],
    ['Class', doc.student.className],
    ['Period', doc.periodLabel],
  ]);
  panel(pdf, 206, [
    ['Issued', dmy(invoice.issue_date) || 'Not issued yet'],
    ['Due', dmy(invoice.due_date)],
    ['Status', INVOICE_STATUS_LABELS[invoice.status]],
    ['Balance due', money(invoice.balance)],
  ]);

  autoTable(pdf, {
    startY: 290,
    margin: { left: 40, right: 40 },
    head: [['Description', 'Type', 'Amount']],
    body: doc.items.map((i) => [
      i.description,
      FEE_CATEGORY_LABELS[i.category] ?? i.category,
      i.kind === 'discount' ? `Less ${money(i.amount)}` : money(i.amount),
    ]),
    foot: [
      ['', 'Subtotal', money(invoice.subtotal)],
      ...(invoice.discount_total ? [['', 'Discounts', `Less ${money(invoice.discount_total)}`]] : []),
      ['', 'Total', money(invoice.total_amount)],
      ['', 'Paid', money(invoice.amount_paid)],
      ['', 'Balance due', money(invoice.balance)],
    ],
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 7, textColor: ink, lineColor: [229, 234, 241], lineWidth: 0.5 },
    headStyles: { fillColor: blue, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [247, 249, 252], textColor: ink, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: { 2: { halign: 'right' } },
    showFoot: 'lastPage',
  });
  let y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;

  const block = (title: string, text: string | null) => {
    if (!text) return;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...navy);
    pdf.text(title, 40, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(...ink);
    const lines = pdf.splitTextToSize(text, width - 80) as string[];
    pdf.text(lines, 40, y + 16);
    y += 30 + lines.length * 13;
  };
  block('How to pay', doc.school.paymentInstructions);
  block('Notes', invoice.notes);

  footer(pdf, `Please quote ${invoice.invoice_number} with your payment.`);
  return pdf;
}

export async function downloadInvoicePdf(doc: InvoiceDocument): Promise<void> {
  (await buildInvoicePdf(doc)).save(invoiceFileName(doc));
}

// -----------------------------------------------------------------------------
// Receipt
// -----------------------------------------------------------------------------
export interface ReceiptDocument {
  payment: Payment;
  allocations: { invoiceNumber: string; title: string; amount: number }[];
  school: FinanceSchool;
  student: FinanceStudent;
  /** What the student still owes across all invoices after this payment. */
  outstanding: number;
}

export const receiptFileName = (doc: ReceiptDocument) => `${safe(doc.student.name)}_${safe(doc.payment.receipt_number ?? 'receipt')}.pdf`;

export async function buildReceiptPdf(doc: ReceiptDocument) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const { payment } = doc;
  const money = (n: number) => pdfMoney(n, payment.currency);

  await header(pdf, doc.school, 'RECEIPT', payment.receipt_number ?? '');
  panel(pdf, 130, [
    ['Received from', payment.payer_name || doc.student.name],
    ['For', doc.student.name],
    ['Admission number', doc.student.admissionNumber],
    ['Class', doc.student.className],
  ]);
  panel(pdf, 206, [
    ['Amount', money(payment.amount)],
    ['Date received', dmy(payment.paid_at)],
    ['Method', PAYMENT_METHOD_LABELS[payment.payment_method]],
    ['Reference', payment.payment_reference ?? 'None'],
  ]);

  const allocated = doc.allocations.reduce((sum, a) => sum + a.amount, 0);
  autoTable(pdf, {
    startY: 290,
    margin: { left: 40, right: 40 },
    head: [['Applied to', 'Invoice', 'Amount']],
    body: [
      ...doc.allocations.map((a) => [a.title, a.invoiceNumber, money(a.amount)]),
      ...(payment.amount - allocated > 0 ? [['Kept as credit for future fees', '', money(payment.amount - allocated)]] : []),
    ],
    foot: [['', 'Total received', money(payment.amount)], ['', 'Still owed after this payment', money(doc.outstanding)]],
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 7, textColor: ink, lineColor: [229, 234, 241], lineWidth: 0.5 },
    headStyles: { fillColor: blue, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [247, 249, 252], textColor: ink, fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right' } },
  });
  let y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 30;

  // Paid stamp
  pdf.setDrawColor(22, 163, 74);
  pdf.setTextColor(22, 163, 74);
  pdf.setLineWidth(2);
  pdf.roundedRect(width - 170, y, 130, 44, 6, 6, 'S');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('PAID', width - 105, y + 29, { align: 'center' });
  pdf.setLineWidth(0.5);
  y += 20;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(...muted);
  pdf.text(payment.is_manual ? 'Payment recorded manually by the school bursary.' : 'Online payment verified by the payment provider.', 40, y);

  footer(pdf, 'Keep this receipt as proof of payment.');
  return pdf;
}

export async function downloadReceiptPdf(doc: ReceiptDocument): Promise<void> {
  (await buildReceiptPdf(doc)).save(receiptFileName(doc));
}
