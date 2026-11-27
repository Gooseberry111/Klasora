import { computed, ref, watch } from 'vue';
import { formatMoney, isoDate, type Payment, type School } from '@klasora/shared';
import { fetchSchool } from '@/services/workspace';
import { useWorkspaceStore } from '@/stores/workspace';
import { downloadReceiptPdf, type FinanceSchool, type FinanceStudent } from '@/lib/financePdf';
import { listAllocations, listFamilyInvoices } from '@/services/finance';

/** The school's currency, money formatting and the details printed on invoices and receipts. */
export function useFinance() {
  const workspace = useWorkspaceStore();
  const school = ref<School | null>(null);

  async function load() {
    if (!workspace.currentSchoolId) return;
    school.value = await fetchSchool(workspace.currentSchoolId).catch(() => null);
  }
  watch(() => workspace.currentSchoolId, load, { immediate: true });

  const currency = computed(() => school.value?.default_currency ?? 'NGN');
  const money = (minor: number | null | undefined, code?: string) => formatMoney(Number(minor ?? 0), code ?? currency.value);

  const documentSchool = computed<FinanceSchool | null>(() =>
    school.value
      ? {
          name: school.value.name,
          motto: school.value.motto,
          address: [school.value.address, school.value.city, school.value.state].filter(Boolean).join(', '),
          email: school.value.email,
          phone: school.value.phone,
          logoUrl: school.value.logo_url,
          paymentInstructions: school.value.payment_instructions ?? null,
        }
      : null,
  );

  /** Builds the receipt for a confirmed payment: where it went and what is still owed. */
  async function downloadReceipt(payment: Payment, student: FinanceStudent) {
    if (!documentSchool.value) await load();
    if (!documentSchool.value) return;
    const [allocations, invoices] = await Promise.all([listAllocations([payment.id]), listFamilyInvoices([payment.student_id])]);
    await downloadReceiptPdf({
      payment,
      school: documentSchool.value,
      student,
      allocations: allocations.map((a) => {
        const inv = invoices.find((i) => i.id === a.invoice_id);
        return { invoiceNumber: inv?.invoice_number ?? '', title: inv?.title ?? 'Invoice', amount: a.amount };
      }),
      outstanding: invoices.filter((i) => i.status === 'issued' || i.status === 'part_paid').reduce((sum, i) => sum + i.balance, 0),
    });
  }

  return { school, currency, money, documentSchool, reloadSchool: load, downloadReceipt };
}

/** Today as YYYY-MM-DD in local time. */
export const todayIso = () => isoDate(new Date());

/** A date some days from today, as YYYY-MM-DD. */
export function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
