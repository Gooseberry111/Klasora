/**
 * Money helpers. Klasora stores every monetary amount as an integer number of
 * minor units (kobo for NGN, cents for USD) in a Postgres `bigint` column.
 * Floating-point values never touch the database.
 */

const MINOR_UNIT_DIGITS: Record<string, number> = {
  NGN: 2,
  GHS: 2,
  KES: 2,
  ZAR: 2,
  GBP: 2,
  USD: 2,
};

export function minorUnitDigits(currency: string): number {
  return MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? 2;
}

/** Formats an amount held in minor units, e.g. formatMoney(1_500_000, 'NGN') → "₦15,000". */
export function formatMoney(
  amountMinor: number | bigint,
  currency: string,
  options: { locale?: string; showMinor?: boolean } = {},
): string {
  const digits = minorUnitDigits(currency);
  const major = Number(amountMinor) / 10 ** digits;
  const showMinor = options.showMinor ?? !Number.isInteger(major);
  return new Intl.NumberFormat(options.locale ?? 'en-NG', {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: showMinor ? digits : 0,
    maximumFractionDigits: showMinor ? digits : 0,
  }).format(major);
}

/** Converts a user-entered major-unit string ("15,000.50") to integer minor units without float error. */
export function parseMoneyToMinor(input: string, currency: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = minorUnitDigits(currency);
  const [whole = '0', fraction = ''] = cleaned.split('.');
  if (fraction.length > digits) return null;
  const value = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(value) ? value : null;
}
