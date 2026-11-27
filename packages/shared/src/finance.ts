/**
 * Phase 6: school finance. Fee structures, invoices, payments, allocations
 * and reports. Every amount is an integer number of minor units (kobo).
 */
import { z } from 'zod';
import { parseMoneyToMinor } from './money';

type Uuid = string;
type Timestamp = string;
type IsoDate = string;

// -----------------------------------------------------------------------------
// Fee structures
// -----------------------------------------------------------------------------
export const FEE_CATEGORIES = [
  'tuition', 'registration', 'examination', 'development_levy', 'transport', 'accommodation',
  'laboratory', 'books', 'uniform', 'feeding', 'excursion', 'other',
] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];

export const FEE_CATEGORY_LABELS: Record<FeeCategory | 'discount', string> = {
  tuition: 'Tuition',
  registration: 'Registration',
  examination: 'Examination',
  development_levy: 'Development levy',
  transport: 'Transport',
  accommodation: 'Accommodation and boarding',
  laboratory: 'Laboratory',
  books: 'Books and materials',
  uniform: 'Uniform',
  feeding: 'Feeding',
  excursion: 'Excursions and trips',
  other: 'Other',
  discount: 'Discount',
};

export const FEE_FREQUENCIES = ['per_term', 'per_year', 'once'] as const;
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number];
export const FEE_FREQUENCY_LABELS: Record<FeeFrequency, { label: string; description: string }> = {
  per_term: { label: 'Every term', description: 'Added to each term invoice in the session.' },
  per_year: { label: 'Once a session', description: 'Added to the first invoice of the session only.' },
  once: { label: 'Once only', description: 'Charged one time per student, like registration.' },
};

export interface FeeStructure {
  id: Uuid;
  school_id: Uuid;
  academic_year_id: Uuid;
  term_id: Uuid | null;
  name: string;
  description: string | null;
  category: FeeCategory;
  amount: number;
  frequency: FeeFrequency;
  class_id: Uuid | null;
  department_id: Uuid | null;
  is_mandatory: boolean;
  status: 'active' | 'inactive';
  created_at: Timestamp;
}

/** The form keeps the amount as typed ("150,000") and converts it when saving. */
export const feeStructureSchema = z
  .object({
    name: z.string().trim().min(1, { error: 'Give the fee a name, like Tuition.' }).max(120),
    description: z.string().trim().max(500),
    category: z.enum(FEE_CATEGORIES),
    amount: z.string().trim().min(1, { error: 'Enter the amount.' }),
    currency: z.string().length(3),
    frequency: z.enum(FEE_FREQUENCIES),
    academicYearId: z.string().min(1, { error: 'Choose the academic session.' }),
    termId: z.string(),
    appliesTo: z.enum(['everyone', 'class', 'department']),
    classId: z.string(),
    departmentId: z.string(),
    isMandatory: z.boolean(),
  })
  .refine((v) => (parseMoneyToMinor(v.amount, v.currency) ?? 0) > 0, { error: 'Enter an amount above zero, like 150,000.', path: ['amount'] })
  .refine((v) => v.appliesTo !== 'class' || v.classId !== '', { error: 'Choose the class.', path: ['classId'] })
  .refine((v) => v.appliesTo !== 'department' || v.departmentId !== '', { error: 'Choose the section.', path: ['departmentId'] })
  .refine((v) => v.termId === '' || v.frequency === 'per_term', { error: 'Only fees charged every term can be tied to one term.', path: ['termId'] });
export type FeeStructureInput = z.infer<typeof feeStructureSchema>;

// -----------------------------------------------------------------------------
// Invoices
// -----------------------------------------------------------------------------
export const INVOICE_STATUSES = ['draft', 'issued', 'part_paid', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** What people see. Overdue is worked out from the due date, not stored. */
export type InvoiceDisplayStatus = InvoiceStatus | 'overdue';

export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  draft: 'Draft',
  issued: 'Unpaid',
  part_paid: 'Part paid',
  paid: 'Paid',
  void: 'Cancelled',
  overdue: 'Overdue',
};
export const INVOICE_STATUS_TONES: Record<InvoiceDisplayStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  issued: 'info',
  part_paid: 'warning',
  paid: 'success',
  void: 'neutral',
  overdue: 'danger',
};

export interface Invoice {
  id: Uuid;
  school_id: Uuid;
  student_id: Uuid;
  invoice_number: string;
  academic_year_id: Uuid;
  term_id: Uuid | null;
  class_id: Uuid | null;
  title: string;
  issue_date: IsoDate | null;
  due_date: IsoDate;
  currency: string;
  subtotal: number;
  discount_total: number;
  total_amount: number;
  amount_paid: number;
  balance: number;
  status: InvoiceStatus;
  notes: string | null;
  issued_at: Timestamp | null;
  voided_at: Timestamp | null;
  void_reason: string | null;
  created_at: Timestamp;
}

export interface InvoiceItem {
  id: Uuid;
  invoice_id: Uuid;
  fee_structure_id: Uuid | null;
  description: string;
  category: FeeCategory | 'discount';
  kind: 'charge' | 'discount';
  amount: number;
  note: string | null;
  position: number;
}

/** Line sent to create_invoice and add_invoice_item. */
export interface InvoiceItemInput {
  fee_structure_id?: Uuid;
  description?: string;
  category?: FeeCategory | 'discount';
  kind?: 'charge' | 'discount';
  amount?: number;
}

/** Row from generate_invoices. */
export interface InvoiceRunRow {
  class_id: Uuid;
  class_name: string;
  students: number;
  invoices: number;
  skipped: number;
  total_amount: number;
}

export function invoiceDisplayStatus(invoice: Pick<Invoice, 'status' | 'due_date' | 'balance'>, today: IsoDate): InvoiceDisplayStatus {
  if ((invoice.status === 'issued' || invoice.status === 'part_paid') && Number(invoice.balance) > 0 && invoice.due_date < today) return 'overdue';
  return invoice.status;
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------
export const MANUAL_PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos', 'cheque', 'other'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export type PaymentMethod = ManualPaymentMethod | 'online';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  pos: 'POS',
  cheque: 'Cheque',
  online: 'Online',
  other: 'Other',
};
/** Methods that need a reference, so the same money is never recorded twice. */
export const METHODS_NEEDING_REFERENCE: readonly ManualPaymentMethod[] = ['bank_transfer', 'pos', 'cheque'];

export type PaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'reversed';
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Awaiting approval',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  reversed: 'Reversed',
};
export const PAYMENT_STATUS_TONES: Record<PaymentStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
  reversed: 'neutral',
};

export interface Payment {
  id: Uuid;
  school_id: Uuid;
  student_id: Uuid;
  receipt_number: string | null;
  payment_reference: string | null;
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  payment_provider: 'manual' | 'paystack';
  is_manual: boolean;
  status: PaymentStatus;
  paid_at: IsoDate;
  payer_name: string | null;
  notes: string | null;
  recorded_by: Uuid | null;
  approved_by: Uuid | null;
  approved_at: Timestamp | null;
  review_note: string | null;
  reversed_at: Timestamp | null;
  reversal_reason: string | null;
  created_at: Timestamp;
}

export interface PaymentAllocation {
  id: Uuid;
  payment_id: Uuid;
  invoice_id: Uuid;
  amount: number;
}

/** Row returned by record_payment. */
export interface RecordedPayment {
  payment_id: Uuid;
  receipt_number: string | null;
  status: PaymentStatus;
  unallocated: number;
}

export const paymentSchema = z
  .object({
    studentId: z.string().min(1, { error: 'Choose the student.' }),
    amount: z.string().trim().min(1, { error: 'Enter the amount received.' }),
    currency: z.string().length(3),
    method: z.enum(MANUAL_PAYMENT_METHODS),
    paidAt: z.string().min(1, { error: 'Enter the date the money was received.' }),
    reference: z.string().trim().max(100),
    payerName: z.string().trim().max(120),
    notes: z.string().trim().max(1000),
    today: z.string(),
  })
  .refine((v) => (parseMoneyToMinor(v.amount, v.currency) ?? 0) > 0, { error: 'Enter an amount above zero.', path: ['amount'] })
  .refine((v) => v.paidAt <= v.today, { error: 'The payment date cannot be in the future.', path: ['paidAt'] })
  .refine((v) => !METHODS_NEEDING_REFERENCE.includes(v.method) || v.reference !== '', {
    error: 'Enter the transfer reference, POS slip or cheque number.',
    path: ['reference'],
  });
export type PaymentInput = z.infer<typeof paymentSchema>;

/**
 * Splits an amount across open invoices, oldest due date first. Mirrors the
 * database so the form can show where the money will go before saving.
 */
export function allocateOldestFirst(
  amount: number,
  invoices: Pick<Invoice, 'id' | 'due_date' | 'created_at' | 'balance'>[],
): { allocations: { invoice_id: Uuid; amount: number }[]; unallocated: number } {
  let left = amount;
  const allocations: { invoice_id: Uuid; amount: number }[] = [];
  const ordered = [...invoices].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.created_at.localeCompare(b.created_at));
  for (const invoice of ordered) {
    if (left <= 0) break;
    const open = Number(invoice.balance);
    if (open <= 0) continue;
    const take = Math.min(open, left);
    allocations.push({ invoice_id: invoice.id, amount: take });
    left -= take;
  }
  return { allocations, unallocated: left };
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------
export interface FinanceSummary {
  billed: number;
  collected: number;
  outstanding: number;
  invoices: number;
  paid_invoices: number;
  overdue_count: number;
  overdue_amount: number;
  students_owing: number;
  drafts: number;
  pending_payments: number;
  pending_amount: number;
  credit: number;
  by_class: { class_id: Uuid; name: string; students: number; billed: number; collected: number; outstanding: number }[];
  by_category: { category: FeeCategory | 'discount'; amount: number }[];
  by_method: { method: PaymentMethod; payments: number; amount: number }[];
  trend: { month: string; amount: number }[];
}

/** Row from student_balances. */
export interface StudentBalanceRow {
  student_id: Uuid;
  first_name: string;
  last_name: string;
  admission_number: string;
  class_id: Uuid | null;
  class_name: string | null;
  invoices: number;
  billed: number;
  paid: number;
  balance: number;
  overdue: number;
  last_payment: IsoDate | null;
}

/** Share collected, as a whole percentage. */
export function collectionRate(collected: number, billed: number): number {
  if (!billed) return 0;
  return Math.round((Number(collected) / Number(billed)) * 100);
}

/** "2026-11" becomes "Nov". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString('en-NG', { month: 'short' });
}
