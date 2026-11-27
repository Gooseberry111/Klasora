/**
 * Phase 6 data access: fee structures, invoices, payments, allocations and
 * financial reports. Totals are never written from the browser; every change
 * to an invoice or payment goes through a database function.
 */
import {
  parseMoneyToMinor,
  type FeeStructure,
  type FeeStructureInput,
  type FinanceSummary,
  type Invoice,
  type InvoiceItem,
  type InvoiceItemInput,
  type InvoiceRunRow,
  type ManualPaymentMethod,
  type Payment,
  type PaymentAllocation,
  type RecordedPayment,
  type StudentBalanceRow,
} from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { AppError, toAppError, unwrap } from '@/lib/errors';

const NONE = '00000000-0000-0000-0000-000000000000';

/** Postgres bigint arrives as a string in some paths; keep everything numeric. */
const num = (v: unknown) => Number(v ?? 0);
function normaliseInvoice(row: Invoice): Invoice {
  return { ...row, subtotal: num(row.subtotal), discount_total: num(row.discount_total), total_amount: num(row.total_amount), amount_paid: num(row.amount_paid), balance: num(row.balance) };
}

// -----------------------------------------------------------------------------
// Fee structures
// -----------------------------------------------------------------------------
export async function listFeeStructures(schoolId: string, yearId?: string): Promise<FeeStructure[]> {
  let query = supabase.from('fee_structures').select('*').eq('school_id', schoolId);
  if (yearId) query = query.eq('academic_year_id', yearId);
  const rows = unwrap(await query.order('category').order('name'), { fallback: "We couldn't load fee structures." }) as FeeStructure[];
  return rows.map((r) => ({ ...r, amount: num(r.amount) }));
}

export async function saveFeeStructure(schoolId: string, input: FeeStructureInput, id?: string): Promise<void> {
  const amount = parseMoneyToMinor(input.amount, input.currency);
  if (!amount) throw new AppError('Enter an amount above zero.');
  const row = {
    academic_year_id: input.academicYearId,
    term_id: input.termId || null,
    name: input.name.trim(),
    description: input.description.trim() || null,
    category: input.category,
    amount,
    frequency: input.frequency,
    class_id: input.appliesTo === 'class' ? input.classId : null,
    department_id: input.appliesTo === 'department' ? input.departmentId : null,
    is_mandatory: input.isMandatory,
  };
  const response = id
    ? await supabase.from('fee_structures').update(row).eq('id', id)
    : await supabase.from('fee_structures').insert({ ...row, school_id: schoolId });
  if (response.error) throw toAppError(response.error, { fallback: "We couldn't save this fee." });
}

export async function setFeeStatus(id: string, status: 'active' | 'inactive'): Promise<void> {
  const { error } = await supabase.from('fee_structures').update({ status }).eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't update this fee." });
}

export async function deleteFeeStructure(id: string): Promise<void> {
  const { error } = await supabase.from('fee_structures').delete().eq('id', id);
  if (error) throw toAppError(error, { fallback: "We couldn't delete this fee." });
}

export async function setPaymentInstructions(schoolId: string, text: string): Promise<void> {
  const { error } = await supabase.rpc('set_payment_instructions', { p_school_id: schoolId, p_text: text });
  if (error) throw toAppError(error, { fallback: "We couldn't save the payment instructions." });
}

// -----------------------------------------------------------------------------
// Invoices
// -----------------------------------------------------------------------------
export interface InvoiceFilter {
  termId?: string;
  yearId?: string;
  classId?: string;
  studentIds?: string[];
  statuses?: Invoice['status'][];
}

export async function listInvoices(schoolId: string, filter: InvoiceFilter = {}): Promise<Invoice[]> {
  let query = supabase.from('invoices').select('*').eq('school_id', schoolId);
  if (filter.termId) query = query.eq('term_id', filter.termId);
  if (filter.yearId) query = query.eq('academic_year_id', filter.yearId);
  if (filter.classId) query = query.eq('class_id', filter.classId);
  if (filter.studentIds) query = query.in('student_id', filter.studentIds.length ? filter.studentIds : [NONE]);
  if (filter.statuses) query = query.in('status', filter.statuses);
  const rows = unwrap(await query.order('created_at', { ascending: false }).limit(2000), { fallback: "We couldn't load invoices." }) as Invoice[];
  return rows.map(normaliseInvoice);
}

/** Invoices families can see, for the given children. */
export async function listFamilyInvoices(studentIds: string[]): Promise<Invoice[]> {
  const response = await supabase.from('invoices').select('*').in('student_id', studentIds.length ? studentIds : [NONE]).order('due_date', { ascending: false });
  return (unwrap(response, { fallback: "We couldn't load fees." }) as Invoice[]).map(normaliseInvoice);
}

export async function fetchInvoice(id: string): Promise<{ invoice: Invoice; items: InvoiceItem[]; allocations: PaymentAllocation[]; payments: Payment[] } | null> {
  const { data, error } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();
  if (error) throw toAppError(error, { fallback: "We couldn't load this invoice." });
  if (!data) return null;
  const [items, allocations] = await Promise.all([
    supabase.from('invoice_items').select('*').eq('invoice_id', id).order('position'),
    supabase.from('payment_allocations').select('*').eq('invoice_id', id),
  ]);
  const allocs = ((allocations.data ?? []) as PaymentAllocation[]).map((a) => ({ ...a, amount: num(a.amount) }));
  const payments = allocs.length ? await listPaymentsByIds(allocs.map((a) => a.payment_id)) : [];
  return {
    invoice: normaliseInvoice(data as Invoice),
    items: ((items.data ?? []) as InvoiceItem[]).map((i) => ({ ...i, amount: num(i.amount) })),
    allocations: allocs,
    payments,
  };
}

export async function createInvoice(input: {
  studentId: string;
  termId: string | null;
  dueDate: string;
  items: InvoiceItemInput[];
  title?: string;
  notes?: string;
  issue: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_invoice', {
    p_student_id: input.studentId,
    p_term_id: input.termId,
    p_due_date: input.dueDate,
    p_items: input.items,
    p_title: input.title || null,
    p_notes: input.notes || null,
    p_issue: input.issue,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't create this invoice." });
  return data as string;
}

export async function generateInvoices(input: { termId: string; classIds: string[] | null; dueDate: string | null; issue: boolean; dryRun: boolean }): Promise<InvoiceRunRow[]> {
  const { data, error } = await supabase.rpc('generate_invoices', {
    p_term_id: input.termId,
    p_class_ids: input.classIds,
    p_due_date: input.dueDate,
    p_issue: input.issue,
    p_dry_run: input.dryRun,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't prepare the invoices." });
  return ((data ?? []) as InvoiceRunRow[]).map((r) => ({ ...r, total_amount: num(r.total_amount) }));
}

export async function issueInvoices(ids: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('issue_invoices', { p_invoice_ids: ids });
  if (error) throw toAppError(error, { fallback: "We couldn't issue these invoices." });
  return Number(data ?? 0);
}

export async function addInvoiceItem(invoiceId: string, item: InvoiceItemInput, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('add_invoice_item', { p_invoice_id: invoiceId, p_item: item, p_reason: reason || null });
  if (error) throw toAppError(error, { fallback: "We couldn't add this line." });
}

export async function removeInvoiceItem(itemId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('remove_invoice_item', { p_item_id: itemId, p_reason: reason || null });
  if (error) throw toAppError(error, { fallback: "We couldn't remove this line." });
}

export async function updateInvoice(invoiceId: string, title: string, dueDate: string, notes: string): Promise<void> {
  const { error } = await supabase.rpc('update_invoice', { p_invoice_id: invoiceId, p_title: title, p_due_date: dueDate, p_notes: notes });
  if (error) throw toAppError(error, { fallback: "We couldn't save this invoice." });
}

export async function voidInvoice(invoiceId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('void_invoice', { p_invoice_id: invoiceId, p_reason: reason });
  if (error) throw toAppError(error, { fallback: "We couldn't cancel this invoice." });
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------
const normalisePayment = (p: Payment): Payment => ({ ...p, amount: num(p.amount) });

export async function listPayments(schoolId: string, filter: { status?: Payment['status']; studentIds?: string[]; from?: string; to?: string } = {}): Promise<Payment[]> {
  let query = supabase.from('payments').select('*').eq('school_id', schoolId);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.studentIds) query = query.in('student_id', filter.studentIds.length ? filter.studentIds : [NONE]);
  if (filter.from) query = query.gte('paid_at', filter.from);
  if (filter.to) query = query.lte('paid_at', filter.to);
  const rows = unwrap(await query.order('paid_at', { ascending: false }).order('created_at', { ascending: false }).limit(2000), { fallback: "We couldn't load payments." }) as Payment[];
  return rows.map(normalisePayment);
}

export async function listFamilyPayments(studentIds: string[]): Promise<Payment[]> {
  const response = await supabase.from('payments').select('*').in('student_id', studentIds.length ? studentIds : [NONE]).order('paid_at', { ascending: false });
  return (unwrap(response, { fallback: "We couldn't load payments." }) as Payment[]).map(normalisePayment);
}

export async function listPaymentsByIds(ids: string[]): Promise<Payment[]> {
  const response = await supabase.from('payments').select('*').in('id', ids.length ? ids : [NONE]);
  return (unwrap(response, { fallback: "We couldn't load payments." }) as Payment[]).map(normalisePayment);
}

export async function listAllocations(paymentIds: string[]): Promise<PaymentAllocation[]> {
  const response = await supabase.from('payment_allocations').select('*').in('payment_id', paymentIds.length ? paymentIds : [NONE]);
  return ((unwrap(response, { fallback: "We couldn't load allocations." }) as PaymentAllocation[]) ?? []).map((a) => ({ ...a, amount: num(a.amount) }));
}

export async function recordPayment(input: {
  studentId: string;
  amount: number;
  method: ManualPaymentMethod;
  paidAt: string;
  reference: string;
  payerName: string;
  notes: string;
  allocations: { invoice_id: string; amount: number }[] | null;
}): Promise<RecordedPayment> {
  const { data, error } = await supabase.rpc('record_payment', {
    p_student_id: input.studentId,
    p_amount: input.amount,
    p_method: input.method,
    p_paid_at: input.paidAt,
    p_reference: input.reference || null,
    p_payer_name: input.payerName || null,
    p_notes: input.notes || null,
    p_allocations: input.allocations,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't record this payment." });
  const row = ((data ?? []) as RecordedPayment[])[0];
  if (!row) throw new AppError("We couldn't record this payment.");
  return { ...row, unallocated: num(row.unallocated) };
}

export async function reviewPayment(paymentId: string, approve: boolean, note: string): Promise<void> {
  const { error } = await supabase.rpc('review_payment', { p_payment_id: paymentId, p_approve: approve, p_note: note || null });
  if (error) throw toAppError(error, { fallback: "We couldn't review this payment." });
}

export async function reversePayment(paymentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reverse_payment', { p_payment_id: paymentId, p_reason: reason });
  if (error) throw toAppError(error, { fallback: "We couldn't reverse this payment." });
}

export async function allocatePayment(paymentId: string, allocations: { invoice_id: string; amount: number }[] | null): Promise<number> {
  const { data, error } = await supabase.rpc('allocate_payment', { p_payment_id: paymentId, p_allocations: allocations });
  if (error) throw toAppError(error, { fallback: "We couldn't allocate this payment." });
  return num(data);
}

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------
export async function fetchFinanceSummary(schoolId: string, yearId?: string, termId?: string): Promise<FinanceSummary> {
  const { data, error } = await supabase.rpc('finance_summary', { p_school_id: schoolId, p_year_id: yearId || null, p_term_id: termId || null });
  if (error) throw toAppError(error, { fallback: "We couldn't load the finance summary." });
  const s = data as FinanceSummary;
  const n = (k: keyof FinanceSummary) => num(s[k]);
  return {
    ...s,
    billed: n('billed'), collected: n('collected'), outstanding: n('outstanding'), invoices: n('invoices'), paid_invoices: n('paid_invoices'),
    overdue_count: n('overdue_count'), overdue_amount: n('overdue_amount'), students_owing: n('students_owing'), drafts: n('drafts'),
    pending_payments: n('pending_payments'), pending_amount: n('pending_amount'), credit: n('credit'),
    by_class: (s.by_class ?? []).map((c) => ({ ...c, students: num(c.students), billed: num(c.billed), collected: num(c.collected), outstanding: num(c.outstanding) })),
    by_category: (s.by_category ?? []).map((c) => ({ ...c, amount: num(c.amount) })),
    by_method: (s.by_method ?? []).map((m) => ({ ...m, payments: num(m.payments), amount: num(m.amount) })),
    trend: (s.trend ?? []).map((t) => ({ ...t, amount: num(t.amount) })),
  };
}

export async function fetchStudentBalances(schoolId: string, filter: { yearId?: string; termId?: string; classId?: string } = {}): Promise<StudentBalanceRow[]> {
  const { data, error } = await supabase.rpc('student_balances', {
    p_school_id: schoolId,
    p_year_id: filter.yearId || null,
    p_term_id: filter.termId || null,
    p_class_id: filter.classId || null,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't load balances." });
  return ((data ?? []) as StudentBalanceRow[]).map((r) => ({
    ...r, invoices: num(r.invoices), billed: num(r.billed), paid: num(r.paid), balance: num(r.balance), overdue: num(r.overdue),
  }));
}

/** Student names for finance lists, without loading every student field. */
export async function listStudentNames(schoolId: string, ids?: string[]): Promise<{ id: string; first_name: string; last_name: string; admission_number: string; status: string }[]> {
  let query = supabase.from('students').select('id, first_name, last_name, admission_number, status').eq('school_id', schoolId);
  if (ids) query = query.in('id', ids.length ? ids : [NONE]);
  const response = await query.order('last_name').order('first_name').limit(5000);
  return unwrap(response, { fallback: "We couldn't load students." }) as { id: string; first_name: string; last_name: string; admission_number: string; status: string }[];
}
