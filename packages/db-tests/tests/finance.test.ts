/**
 * Phase 6: school finance. Covers invoice generation from fee structures,
 * payment recording, approval and allocation, duplicate prevention, who can
 * see what, and that totals can never be edited directly.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, expectSqlError, type TestDatabase } from '../src/harness';

type User = { id: string; email: string };

let db: TestDatabase;
let owner: User;
let bursar: User;
let clerk: User;
let teacher: User;
let parentA: User;
let parentB: User;
let outsider: User;
let schoolId: string;
let otherSchool: string;
let yearId: string;
let term1: string;
let term2: string;
let jss1: string;
let jss2: string;
let ada: string;
let bola: string;
let chidi: string;
let tuition: string;
let jss2Lab: string;
let registration: string;
let examFee: string;
let transport: string;

const naira = (n: number) => n * 100;

async function register(first: string, classId: string, guardianEmail: string) {
  const [row] = await db.rows<{ id: string }>(
    owner.id,
    `select public.register_student($1, $2::jsonb, null, $3::jsonb, $4) as id`,
    [schoolId, JSON.stringify({ first_name: first, last_name: 'Test', admission_date: '2026-09-01' }),
      JSON.stringify([{ first_name: 'Parent', last_name: first, email: guardianEmail, relationship: 'mother' }]), classId],
  );
  return row!.id;
}

async function linkGuardian(studentId: string, email: string) {
  const user = await db.createUser({ email });
  const [g] = await db.admin<{ guardian_id: string }>(`select guardian_id from public.student_guardians where student_id = $1`, [studentId]);
  const [invite] = await db.rows<{ token: string }>(owner.id, `select token from public.invite_guardian($1)`, [g!.guardian_id]);
  await db.rows(user.id, `select public.accept_invitation($1)`, [invite!.token]);
  return user;
}

const invoice = async (id: string) =>
  (await db.admin<{ status: string; total_amount: string; amount_paid: string; balance: string; invoice_number: string }>(
    `select status, total_amount, amount_paid, balance, invoice_number from public.invoices where id = $1`, [id]))[0]!;

const invoicesOf = (studentId: string) =>
  db.admin<{ id: string; term_id: string | null; status: string; total_amount: string; due_date: string }>(
    `select id, term_id, status, total_amount, due_date from public.invoices where student_id = $1 order by created_at`, [studentId]);

const generate = (userId: string, termId: string, classIds: string[] | null, dryRun: boolean, issue = false) =>
  db.rows<{ class_name: string; students: number; invoices: number; skipped: number; total_amount: string }>(
    userId,
    `select * from public.generate_invoices($1, $2, '2026-10-15', $3, $4)`,
    [termId, classIds, issue, dryRun],
  );

const pay = (userId: string, studentId: string, amount: number, method: string, reference: string | null, allocations: unknown = null) =>
  db.rows<{ payment_id: string; receipt_number: string | null; status: string; unallocated: string }>(
    userId,
    `select * from public.record_payment($1, $2, $3, current_date, $4, null, null, $5::jsonb)`,
    [studentId, amount, method, reference, allocations === null ? null : JSON.stringify(allocations)],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  owner = await db.createUser();
  schoolId = await db.registerSchool(owner.id, { name: 'Unity College', planCode: 'growth' });
  bursar = await db.addMember(owner.id, schoolId, 'accountant');
  teacher = await db.addMember(owner.id, schoolId, 'teacher');
  outsider = await db.createUser();
  otherSchool = await db.registerSchool(outsider.id, { name: 'Elsewhere Academy' });

  // A fees clerk can record payments but not approve them.
  const [role] = await db.rows<{ id: string }>(owner.id, `insert into public.roles (school_id, name, description) values ($1, 'Fees Clerk', 'Takes payments') returning id`, [schoolId]);
  await db.rows(owner.id, `select public.set_role_permissions($1, array['students.view', 'finance.view', 'finance.create'])`, [role!.id]);
  clerk = await db.createUser();
  const token = await db.invite(owner.id, schoolId, clerk.email, role!.id);
  await db.rows(clerk.id, `select public.accept_invitation($1)`, [token]);

  [{ id: yearId }] = await db.rows<{ id: string }>(owner.id, `insert into public.academic_years (school_id, name, start_date, end_date) values ($1, '2026/2027', '2026-09-01', '2027-07-31') returning id`, [schoolId]) as [{ id: string }];
  await db.admin(`update public.academic_years set is_current = true where id = $1`, [yearId]);
  [{ id: term1 }] = await db.rows<{ id: string }>(owner.id, `insert into public.academic_terms (school_id, academic_year_id, name, sequence, start_date, end_date) values ($1, $2, 'First Term', 1, '2026-09-01', '2026-12-18') returning id`, [schoolId, yearId]) as [{ id: string }];
  [{ id: term2 }] = await db.rows<{ id: string }>(owner.id, `insert into public.academic_terms (school_id, academic_year_id, name, sequence, start_date, end_date) values ($1, $2, 'Second Term', 2, '2027-01-04', '2027-04-02') returning id`, [schoolId, yearId]) as [{ id: string }];

  const campus = (await db.admin<{ id: string }>(`select id from public.campuses where school_id = $1`, [schoolId]))[0]!.id;
  jss1 = (await db.rows<{ id: string }>(owner.id, `insert into public.classes (school_id, campus_id, name, level_order) values ($1, $2, 'JSS 1', 1) returning id`, [schoolId, campus]))[0]!.id;
  jss2 = (await db.rows<{ id: string }>(owner.id, `insert into public.classes (school_id, campus_id, name, level_order) values ($1, $2, 'JSS 2', 2) returning id`, [schoolId, campus]))[0]!.id;

  ada = await register('Ada', jss1, 'mum.ada@example.com');
  chidi = await register('Chidi', jss1, 'mum.chidi@example.com');
  bola = await register('Bola', jss2, 'mum.bola@example.com');
  parentA = await linkGuardian(ada, 'mum.ada@example.com');
  parentB = await linkGuardian(bola, 'mum.bola@example.com');

  const fee = async (name: string, category: string, amount: number, frequency: string, extra: Record<string, unknown> = {}) => {
    const columns = ['school_id', 'academic_year_id', 'name', 'category', 'amount', 'frequency', ...Object.keys(extra)];
    const values = [schoolId, yearId, name, category, naira(amount), frequency, ...Object.values(extra)];
    const [row] = await db.rows<{ id: string }>(
      bursar.id,
      `insert into public.fee_structures (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      values,
    );
    return row!.id;
  };
  tuition = await fee('Tuition', 'tuition', 150_000, 'per_term');
  jss2Lab = await fee('Laboratory', 'laboratory', 20_000, 'per_term', { class_id: jss2 });
  registration = await fee('Registration', 'registration', 10_000, 'once');
  examFee = await fee('Examination', 'examination', 5_000, 'per_term', { term_id: term2 });
  transport = await fee('School bus', 'transport', 30_000, 'per_term', { is_mandatory: false });
});

describe('fee structures', () => {
  it('are managed by finance staff and hidden from everyone else', async () => {
    expect(await db.rows(teacher.id, `select id from public.fee_structures`)).toHaveLength(0);
    expect(await db.rows(parentA.id, `select id from public.fee_structures`)).toHaveLength(0);
    expect(await db.rows(outsider.id, `select id from public.fee_structures`)).toHaveLength(0);
    expect(await db.rows(clerk.id, `select id from public.fee_structures`)).toHaveLength(5);
    await expectSqlError(
      db.rows(teacher.id, `insert into public.fee_structures (school_id, academic_year_id, name, amount) values ($1, $2, 'Sneaky', 100)`, [schoolId, yearId]),
      '42501',
    );
  });

  it('refuses a term from another session and a one off fee tied to a term', async () => {
    const [otherYear] = await db.rows<{ id: string }>(owner.id, `insert into public.academic_years (school_id, name, start_date, end_date) values ($1, '2027/2028', '2027-09-01', '2028-07-31') returning id`, [schoolId]);
    await expectSqlError(
      db.rows(bursar.id, `insert into public.fee_structures (school_id, academic_year_id, term_id, name, amount) values ($1, $2, $3, 'Wrong', 100)`, [schoolId, otherYear!.id, term1]),
      'KL400',
    );
    await expectSqlError(
      db.rows(bursar.id, `insert into public.fee_structures (school_id, academic_year_id, term_id, name, amount, frequency) values ($1, $2, $3, 'Wrong', 100, 'once')`, [schoolId, yearId, term1]),
      '23514',
    );
  });
});

describe('invoice generation', () => {
  it('previews without writing anything', async () => {
    const preview = await generate(bursar.id, term1, null, true);
    const byClass = Object.fromEntries(preview.map((r) => [r.class_name, r]));
    // JSS 1: tuition and registration. JSS 2 adds the laboratory fee.
    expect(Number(byClass['JSS 1']!.total_amount)).toBe(2 * naira(160_000));
    expect(byClass['JSS 1']!.invoices).toBe(2);
    expect(Number(byClass['JSS 2']!.total_amount)).toBe(naira(180_000));
    expect(await invoicesOf(ada)).toHaveLength(0);
  });

  it('is limited to people who can create invoices', async () => {
    await expectSqlError(generate(teacher.id, term1, null, true), 'KL403');
    await expectSqlError(generate(outsider.id, term1, null, true), 'KL403');
  });

  it('bills each student once per term from the right fees', async () => {
    await generate(bursar.id, term1, null, false);
    const [first] = await invoicesOf(ada);
    expect(first!.status).toBe('draft');
    expect(Number(first!.total_amount)).toBe(naira(160_000));
    const items = await db.admin<{ description: string }>(`select description from public.invoice_items where invoice_id = $1 order by position`, [first!.id]);
    expect(items.map((i) => i.description)).toEqual(['Tuition', 'Registration']);
    expect(Number((await invoicesOf(bola))[0]!.total_amount)).toBe(naira(180_000));

    // Running it again skips everyone who already has a first term invoice.
    const again = await generate(bursar.id, term1, null, false);
    expect(again.every((r) => r.invoices === 0 && r.skipped === r.students)).toBe(true);
    expect(await invoicesOf(ada)).toHaveLength(1);
  });

  it('does not charge one off fees twice and adds term specific fees', async () => {
    const preview = await generate(bursar.id, term2, [jss1], true);
    // Second term: tuition and the examination fee, no registration.
    expect(Number(preview[0]!.total_amount)).toBe(2 * naira(155_000));
    expect(preview).toHaveLength(1);
  });

  it('numbers invoices without dashes and keeps drafts away from families', async () => {
    const [first] = await invoicesOf(ada);
    expect((await invoice(first!.id)).invoice_number).toMatch(/^INV\/\d{4}\/\d{5}$/);
    expect(await db.rows(parentA.id, `select id from public.invoices`)).toHaveLength(0);
  });
});

describe('issuing and changing invoices', () => {
  it('notifies guardians who may see finances when invoices are issued', async () => {
    const ids = (await db.admin<{ id: string }>(`select id from public.invoices where school_id = $1 and status = 'draft'`, [schoolId])).map((r) => r.id);
    await expectSqlError(db.rows(teacher.id, `select public.issue_invoices($1)`, [ids]), 'KL403');
    const [{ issue_invoices: count }] = await db.rows<{ issue_invoices: number }>(clerk.id, `select public.issue_invoices($1)`, [ids]) as [{ issue_invoices: number }];
    expect(count).toBe(3);

    const notes = await db.admin<{ title: string; body: string; sensitive: boolean }>(`select title, body, sensitive from public.notifications where user_id = $1 and kind = 'fees'`, [parentA.id]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe('New invoice for Ada');
    expect(notes[0]!.body).toContain('₦160,000');
    expect(notes[0]!.body).toMatch(/due on 15\/10\/2026/);
    expect(notes[0]!.sensitive).toBe(true);

    // Each parent sees only their own child's invoice.
    expect(await db.rows(parentA.id, `select id from public.invoices`)).toHaveLength(1);
    expect(await db.rows(parentB.id, `select id from public.invoices`)).toHaveLength(1);
    expect(await db.rows(parentA.id, `select i.id from public.invoice_items i`)).toHaveLength(2);
  });

  it('hides finances from a guardian whose link does not allow it', async () => {
    await db.admin(`update public.student_guardians set can_view_finances = false where student_id = $1`, [bola]);
    expect(await db.rows(parentB.id, `select id from public.invoices`)).toHaveLength(0);
    await db.admin(`update public.student_guardians set can_view_finances = true where student_id = $1`, [bola]);
  });

  it('never lets anyone edit totals directly', async () => {
    const [first] = await invoicesOf(ada);
    await expectSqlError(db.rows(owner.id, `update public.invoices set total_amount = 1 where id = $1`, [first!.id]), '42501');
    await expectSqlError(db.rows(owner.id, `insert into public.payments (school_id, student_id, amount, currency, payment_method, paid_at) values ($1, $2, 100, 'NGN', 'cash', current_date)`, [schoolId, ada]), '42501');
    await expectSqlError(db.rows(owner.id, `delete from public.invoice_items where invoice_id = $1`, [first!.id]), '42501');
  });

  it('needs approval rights and a reason to change an issued invoice', async () => {
    const [first] = await invoicesOf(ada);
    const discount = JSON.stringify({ kind: 'discount', description: 'Sibling discount', amount: naira(10_000) });
    await expectSqlError(db.rows(clerk.id, `select public.add_invoice_item($1, $2::jsonb, 'Sibling')`, [first!.id, discount]), 'KL403');
    await expectSqlError(db.rows(bursar.id, `select public.add_invoice_item($1, $2::jsonb, null)`, [first!.id, discount]), 'KL400');
    await db.rows(bursar.id, `select public.add_invoice_item($1, $2::jsonb, 'Second child in school')`, [first!.id, discount]);
    expect(Number((await invoice(first!.id)).total_amount)).toBe(naira(150_000));
  });

  it('adds optional fees to the students who take them', async () => {
    const [first] = await invoicesOf(ada);
    await db.rows(bursar.id, `select public.add_invoice_item($1, $2::jsonb, 'Started using the bus')`, [first!.id, JSON.stringify({ fee_structure_id: transport })]);
    expect(Number((await invoice(first!.id)).total_amount)).toBe(naira(180_000));
  });

  it('refuses a fee that is already billed from being deleted', async () => {
    await expectSqlError(db.rows(bursar.id, `delete from public.fee_structures where id = $1`, [tuition]), 'KL409');
  });
});

describe('payments', () => {
  it('confirms payments from someone who can approve them, oldest invoice first', async () => {
    const [first] = await invoicesOf(ada);
    const [result] = await pay(bursar.id, ada, naira(100_000), 'cash', null);
    expect(result!.status).toBe('confirmed');
    expect(result!.receipt_number).toMatch(/^RCT\/\d{4}\/\d{5}$/);
    const after = await invoice(first!.id);
    expect(after.status).toBe('part_paid');
    expect(Number(after.balance)).toBe(naira(80_000));

    const notes = await db.admin<{ title: string; body: string }>(`select title, body from public.notifications where user_id = $1 and kind = 'fees' order by created_at`, [parentA.id]);
    expect(notes.at(-1)!.title).toBe('Payment received for Ada');
    expect(notes.at(-1)!.body).toContain('₦100,000');
  });

  it('keeps payments from a clerk pending until approved', async () => {
    const [first] = await invoicesOf(ada);
    const [result] = await pay(clerk.id, ada, naira(30_000), 'bank_transfer', 'GTB 554433');
    expect(result!.status).toBe('pending');
    expect(result!.receipt_number).toBeNull();
    expect(Number((await invoice(first!.id)).balance)).toBe(naira(80_000));
    // Families do not see it until it is confirmed.
    expect(await db.rows(parentA.id, `select id from public.payments where id = $1`, [result!.payment_id])).toHaveLength(0);
    // Approvers are told about it.
    const waiting = await db.admin(`select id from public.notifications where user_id = $1 and title = 'Payment waiting for approval'`, [bursar.id]);
    expect(waiting).toHaveLength(1);

    await expectSqlError(db.rows(clerk.id, `select public.review_payment($1, true)`, [result!.payment_id]), 'KL403');
    await db.rows(bursar.id, `select public.review_payment($1, true, 'Seen on statement')`, [result!.payment_id]);
    expect(Number((await invoice(first!.id)).balance)).toBe(naira(50_000));
    expect(await db.rows(parentA.id, `select id from public.payments where id = $1`, [result!.payment_id])).toHaveLength(1);
  });

  it('refuses the same transfer reference twice', async () => {
    const message = await expectSqlError(pay(clerk.id, ada, naira(1_000), 'bank_transfer', 'gtb 554433'), 'KL409');
    expect(message).toMatch(/already recorded \(RCT\/\d{4}\/\d{5}\)/);
  });

  it('needs a reference for transfers and refuses future dates', async () => {
    await expectSqlError(pay(bursar.id, ada, naira(1_000), 'bank_transfer', null), 'KL400');
    await expectSqlError(
      db.rows(bursar.id, `select * from public.record_payment($1, 100, 'cash', current_date + 1)`, [ada]),
      'KL400',
    );
  });

  it('refuses to allocate more than is owed and keeps overpayments as credit', async () => {
    const [first] = await invoicesOf(ada);
    await expectSqlError(pay(bursar.id, ada, naira(60_000), 'cash', null, [{ invoice_id: first!.id, amount: naira(60_000) }]), 'KL409');
    const [result] = await pay(bursar.id, ada, naira(60_000), 'cash', null);
    expect(Number(result!.unallocated)).toBe(naira(10_000));
    const after = await invoice(first!.id);
    expect(after.status).toBe('paid');
    expect(Number(after.balance)).toBe(0);
  });

  it('cannot allocate to another student or another school', async () => {
    const [bolaInvoice] = await invoicesOf(bola);
    await expectSqlError(pay(bursar.id, ada, naira(1_000), 'cash', null, [{ invoice_id: bolaInvoice!.id, amount: naira(1_000) }]), 'KL400');
    await expectSqlError(pay(outsider.id, ada, naira(1_000), 'cash', null), 'KL403');
    expect(await db.rows(outsider.id, `select id from public.payments`)).toHaveLength(0);
    expect(otherSchool).toBeTruthy();
  });

  it('reverses a bounced payment and reopens the invoice', async () => {
    const [bolaInvoice] = await invoicesOf(bola);
    const [cheque] = await pay(bursar.id, bola, naira(180_000), 'cheque', 'CHQ 0001');
    expect((await invoice(bolaInvoice!.id)).status).toBe('paid');
    await expectSqlError(db.rows(bursar.id, `select public.reverse_payment($1, '')`, [cheque!.payment_id]), 'KL400');
    await db.rows(bursar.id, `select public.reverse_payment($1, 'Cheque bounced')`, [cheque!.payment_id]);
    const after = await invoice(bolaInvoice!.id);
    expect(after.status).toBe('issued');
    expect(Number(after.balance)).toBe(naira(180_000));
    // The cheque number can be used again for the replacement record.
    const [again] = await pay(bursar.id, bola, naira(180_000), 'cheque', 'CHQ 0001');
    expect(again!.status).toBe('confirmed');
  });

  it('does not cancel an invoice that has payments', async () => {
    const [first] = await invoicesOf(ada);
    await expectSqlError(db.rows(bursar.id, `select public.void_invoice($1, 'Mistake')`, [first!.id]), 'KL409');
    const [chidiInvoice] = await invoicesOf(chidi);
    await expectSqlError(db.rows(clerk.id, `select public.void_invoice($1, 'Mistake')`, [chidiInvoice!.id]), 'KL403');
    await db.rows(bursar.id, `select public.void_invoice($1, 'Left the school')`, [chidiInvoice!.id]);
    expect((await invoice(chidiInvoice!.id)).status).toBe('void');
  });
});

describe('reports', () => {
  it('summarises billing and collection for finance staff only', async () => {
    await expectSqlError(db.rows(teacher.id, `select public.finance_summary($1)`, [schoolId]), 'KL403');
    await expectSqlError(db.rows(parentA.id, `select public.finance_summary($1)`, [schoolId]), 'KL403');
    const [{ finance_summary: s }] = await db.rows<{ finance_summary: Record<string, unknown> }>(
      bursar.id, `select public.finance_summary($1, $2, $3)`, [schoolId, yearId, term1],
    ) as [{ finance_summary: Record<string, unknown> }];
    // Ada 180,000 (paid) and Bola 180,000 (paid); Chidi's invoice was cancelled.
    expect(Number(s.billed)).toBe(naira(360_000));
    expect(Number(s.collected)).toBe(naira(360_000));
    expect(Number(s.outstanding)).toBe(0);
    expect(Number(s.credit)).toBe(naira(10_000));
    expect((s.by_class as unknown[]).length).toBe(2);
    expect((s.trend as unknown[]).length).toBe(12);
  });

  it('lists balances per student', async () => {
    const rows = await db.rows<{ first_name: string; balance: string }>(bursar.id, `select * from public.student_balances($1, $2)`, [schoolId, yearId]);
    expect(rows.map((r) => r.first_name).sort()).toEqual(['Ada', 'Bola']);
    await expectSqlError(db.rows(clerk.id, `select * from public.student_balances($1)`, [otherSchool]), 'KL403');
  });
});
