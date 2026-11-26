import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, { error: 'Enter an email address.' })
  .max(320, { error: 'This email address is too long.' })
  .pipe(z.email({ error: 'Enter a valid email address, like name@school.com.' }));

export const phoneSchema = z
  .string()
  .trim()
  .min(1, { error: 'Enter a phone number.' })
  .regex(/^\+?[0-9][0-9\s()-]{6,30}$/, { error: 'Enter a valid phone number, like +234 803 000 0000.' });

export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(32)
  .refine((v) => v === '' || /^\+?[0-9][0-9\s()-]{6,30}$/.test(v), {
    error: 'Enter a valid phone number, like +234 803 000 0000.',
  });

export const personNameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `Enter ${label}.` })
    .max(100, { error: `${label[0]?.toUpperCase()}${label.slice(1)} must be 100 characters or fewer.` });

/**
 * Password policy: at least 8 characters including a letter and a number.
 * Mirrors the Supabase Auth settings in `supabase/config.toml`.
 */
export const passwordSchema = z
  .string()
  .min(8, { error: 'Use at least 8 characters.' })
  .max(72, { error: 'Use 72 characters or fewer.' })
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), {
    error: 'Include at least one letter and one number.',
  });

export const optionalUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === '' || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v), {
    error: 'Enter a full web address starting with https://',
  });

/** Turns a failed parse into `{ fieldName: firstMessage }` for form display. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}

export type FieldErrors = Record<string, string>;

/** Validates `data` and returns either the parsed value or field errors. */
export function validate<S extends z.ZodType>(
  schema: S,
  data: unknown,
): { success: true; data: z.output<S> } | { success: false; errors: FieldErrors } {
  const parsed = schema.safeParse(data);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, errors: toFieldErrors(parsed.error) };
}
