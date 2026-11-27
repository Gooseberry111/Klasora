import { describe, expect, it } from 'vitest';
import {
  allocateOldestFirst,
  collectionRate,
  feeStructureSchema,
  invoiceDisplayStatus,
  paymentSchema,
  validate,
} from '../src';

const fee = {
  name: 'Tuition', description: '', category: 'tuition' as const, amount: '150,000', currency: 'NGN', frequency: 'per_term' as const,
  academicYearId: 'y', termId: '', appliesTo: 'everyone' as const, classId: '', departmentId: '', isMandatory: true,
};

describe('fee structures', () => {
  it('needs a positive amount and a target when one is chosen', () => {
    expect(validate(feeStructureSchema, fee).success).toBe(true);
    expect(validate(feeStructureSchema, { ...fee, amount: '0' }).success).toBe(false);
    expect(validate(feeStructureSchema, { ...fee, amount: 'abc' }).success).toBe(false);
    const r = validate(feeStructureSchema, { ...fee, appliesTo: 'class' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.classId).toBe('Choose the class.');
    expect(validate(feeStructureSchema, { ...fee, frequency: 'once', termId: 't' }).success).toBe(false);
  });
});

describe('payments', () => {
  const base = { studentId: 's', amount: '50,000', currency: 'NGN', method: 'cash' as const, paidAt: '2026-11-27', reference: '', payerName: '', notes: '', today: '2026-11-27' };

  it('needs references for transfers and refuses future dates', () => {
    expect(validate(paymentSchema, base).success).toBe(true);
    expect(validate(paymentSchema, { ...base, method: 'bank_transfer' }).success).toBe(false);
    expect(validate(paymentSchema, { ...base, method: 'bank_transfer', reference: 'GTB 1' }).success).toBe(true);
    expect(validate(paymentSchema, { ...base, paidAt: '2026-11-28' }).success).toBe(false);
  });

  it('allocates oldest invoices first and keeps the rest as credit', () => {
    const invoices = [
      { id: 'b', due_date: '2026-12-01', created_at: '2026-11-01', balance: 30_000 },
      { id: 'a', due_date: '2026-10-01', created_at: '2026-09-01', balance: 50_000 },
      { id: 'c', due_date: '2026-12-01', created_at: '2026-11-02', balance: 0 },
    ];
    expect(allocateOldestFirst(60_000, invoices)).toEqual({ allocations: [{ invoice_id: 'a', amount: 50_000 }, { invoice_id: 'b', amount: 10_000 }], unallocated: 0 });
    expect(allocateOldestFirst(100_000, invoices).unallocated).toBe(20_000);
  });
});

describe('invoices and reports', () => {
  it('marks unpaid invoices past their due date as overdue', () => {
    expect(invoiceDisplayStatus({ status: 'issued', due_date: '2026-11-01', balance: 10 }, '2026-11-27')).toBe('overdue');
    expect(invoiceDisplayStatus({ status: 'part_paid', due_date: '2026-12-01', balance: 10 }, '2026-11-27')).toBe('part_paid');
    expect(invoiceDisplayStatus({ status: 'paid', due_date: '2026-11-01', balance: 0 }, '2026-11-27')).toBe('paid');
    expect(invoiceDisplayStatus({ status: 'draft', due_date: '2026-11-01', balance: 10 }, '2026-11-27')).toBe('draft');
  });

  it('works out the collection rate', () => {
    expect(collectionRate(0, 0)).toBe(0);
    expect(collectionRate(75, 100)).toBe(75);
    expect(collectionRate(2, 3)).toBe(67);
  });
});
