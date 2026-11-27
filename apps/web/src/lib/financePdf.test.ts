import { describe, expect, it } from 'vitest';
import type { Invoice, Payment } from '@klasora/shared';
import { buildInvoicePdf, buildReceiptPdf, invoiceFileName, pdfMoney, receiptFileName, type FinanceSchool } from './financePdf';

const school: FinanceSchool = {
  name: 'Greenfield Academy', motto: 'Knowledge and character', address: '14 Admiralty Way, Lekki, Lagos', email: 'office@greenfield.ng',
  phone: '+234 803 000 0000', logoUrl: null, paymentInstructions: 'Pay into Zenith Bank, account 1234567890.',
};
const student = { name: 'Chidi Okeke', admissionNumber: 'GA/2026/0001', className: 'JSS 1A' };

const invoice: Invoice = {
  id: 'i', school_id: 's', student_id: 'st', invoice_number: 'INV/2026/00012', academic_year_id: 'y', term_id: 't', class_id: 'k',
  title: 'First Term fees', issue_date: '2026-09-07', due_date: '2026-10-15', currency: 'NGN', subtotal: 16_000_000, discount_total: 1_000_000,
  total_amount: 15_000_000, amount_paid: 10_000_000, balance: 5_000_000, status: 'part_paid', notes: null, issued_at: null, voided_at: null,
  void_reason: null, created_at: '2026-09-07T08:00:00Z',
};

describe('finance PDFs', () => {
  it('writes amounts with the currency code, since the PDF font has no naira sign', () => {
    expect(pdfMoney(15_000_000, 'NGN')).toBe('NGN 150,000.00');
    expect(pdfMoney(125_050, 'NGN')).toBe('NGN 1,250.50');
  });

  it('builds an invoice with its lines, totals and payment instructions', async () => {
    const doc = {
      invoice, school, student, periodLabel: 'First Term, 2026/2027',
      items: [
        { id: 'a', invoice_id: 'i', fee_structure_id: 'f', description: 'Tuition', category: 'tuition' as const, kind: 'charge' as const, amount: 15_000_000, note: null, position: 0 },
        { id: 'b', invoice_id: 'i', fee_structure_id: 'g', description: 'Registration', category: 'registration' as const, kind: 'charge' as const, amount: 1_000_000, note: null, position: 1 },
        { id: 'c', invoice_id: 'i', fee_structure_id: null, description: 'Sibling discount', category: 'discount' as const, kind: 'discount' as const, amount: 1_000_000, note: null, position: 2 },
      ],
    };
    const text = (await buildInvoicePdf(doc)).output();
    for (const expected of ['INVOICE', 'INV/2026/00012', 'Chidi Okeke', 'Tuition', 'Sibling discount', 'NGN 150,000.00', 'NGN 50,000.00', '15/10/2026', 'Zenith Bank', 'Part paid']) {
      expect(text).toContain(expected);
    }
    expect(invoiceFileName(doc)).toBe('Chidi_Okeke_INV_2026_00012.pdf');
  });

  it('builds a receipt that shows where the money went', async () => {
    const payment: Payment = {
      id: 'p', school_id: 's', student_id: 'st', receipt_number: 'RCT/2026/00003', payment_reference: 'GTB 554433', amount: 10_000_000, currency: 'NGN',
      payment_method: 'bank_transfer', payment_provider: 'manual', is_manual: true, status: 'confirmed', paid_at: '2026-09-20', payer_name: 'Mrs Ngozi Okeke',
      notes: null, recorded_by: null, approved_by: null, approved_at: null, review_note: null, reversed_at: null, reversal_reason: null, created_at: '2026-09-20T09:00:00Z',
    };
    const doc = { payment, school, student, outstanding: 5_000_000, allocations: [{ invoiceNumber: 'INV/2026/00012', title: 'First Term fees', amount: 10_000_000 }] };
    const text = (await buildReceiptPdf(doc)).output();
    for (const expected of ['RECEIPT', 'RCT/2026/00003', 'Mrs Ngozi Okeke', 'Bank transfer', 'GTB 554433', '20/09/2026', 'INV/2026/00012', 'NGN 100,000.00', 'NGN 50,000.00', 'PAID', 'recorded manually']) {
      expect(text).toContain(expected);
    }
    expect(receiptFileName(doc)).toBe('Chidi_Okeke_RCT_2026_00003.pdf');
  });
});
