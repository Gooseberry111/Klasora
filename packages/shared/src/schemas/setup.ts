import { z } from 'zod';
import { COUNTRIES } from '../constants';
import { emailSchema, optionalPhoneSchema, optionalUrlSchema, phoneSchema } from './common';

const countryCodes = COUNTRIES.map((c) => c.code) as [string, ...string[]];
/** Dates travel as ISO strings (YYYY MM DD), which is what date inputs and Postgres use. */
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Short codes such as "MAIN", "MTH" or "JSS_1". Letters, numbers and underscores. */
export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, { error: 'Enter a short code.' })
  .max(20, { error: 'Codes must be 20 characters or fewer.' })
  .regex(/^[A-Z0-9][A-Z0-9_]*$/, { error: 'Use letters, numbers and underscores only, like MTH or JSS_1.' });

export const optionalCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(20, { error: 'Codes must be 20 characters or fewer.' })
  .refine((v) => v === '' || /^[A-Z0-9][A-Z0-9_]*$/.test(v), {
    error: 'Use letters, numbers and underscores only.',
  });

const dateSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `Choose the ${label}.` })
    .refine((v) => isoDate.test(v) && !Number.isNaN(Date.parse(v)), { error: `Choose a valid ${label}.` });

export const schoolProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: 'Enter the name of your institution.' })
    .max(200, { error: 'The name must be 200 characters or fewer.' }),
  motto: z.string().trim().max(200, { error: 'The motto must be 200 characters or fewer.' }),
  registrationNumber: z.string().trim().max(100, { error: 'This number is too long.' }),
  email: emailSchema,
  phone: phoneSchema,
  website: optionalUrlSchema,
  country: z.enum(countryCodes, { error: 'Choose a country.' }),
  state: z.string().trim().min(1, { error: 'Enter the state or region.' }).max(100),
  city: z.string().trim().min(1, { error: 'Enter the city or town.' }).max(100),
  address: z.string().trim().min(5, { error: 'Enter the street address.' }).max(500),
  timezone: z.string().trim().min(1).max(64),
});
export type SchoolProfileInput = z.infer<typeof schoolProfileSchema>;

export const campusSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter the campus name.' }).max(150),
  code: codeSchema,
  address: z.string().trim().max(500),
  contactPhone: optionalPhoneSchema,
  status: z.enum(['active', 'inactive']),
});
export type CampusInput = z.infer<typeof campusSchema>;

export const academicYearSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: 'Enter a name, like 2026/2027.' })
      .max(60, { error: 'Names must be 60 characters or fewer.' }),
    startDate: dateSchema('start date'),
    endDate: dateSchema('end date'),
    status: z.enum(['planned', 'active', 'completed']),
  })
  .refine((v) => v.endDate > v.startDate, { error: 'The end date must be after the start date.', path: ['endDate'] })
  .refine((v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000 <= 731, {
    error: 'An academic year can last at most two years.',
    path: ['endDate'],
  });
export type AcademicYearInput = z.infer<typeof academicYearSchema>;

export const termSchema = z
  .object({
    name: z.string().trim().min(1, { error: 'Enter a name, like First Term.' }).max(60),
    sequence: z.coerce.number().int().min(1, { error: 'Choose the order.' }).max(12),
    startDate: dateSchema('start date'),
    endDate: dateSchema('end date'),
    status: z.enum(['planned', 'active', 'completed']),
  })
  .refine((v) => v.endDate > v.startDate, { error: 'The end date must be after the start date.', path: ['endDate'] });
export type TermInput = z.infer<typeof termSchema>;

export const departmentSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter a name.' }).max(120),
  code: optionalCodeSchema,
  kind: z.enum(['department', 'section', 'faculty']),
  parentId: z.string().nullable(),
  campusId: z.string().nullable(),
  description: z.string().trim().max(500, { error: 'Descriptions must be 500 characters or fewer.' }),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const classSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter a name, like JSS 1A.' }).max(80),
  level: z.string().trim().max(60),
  levelOrder: z.coerce.number().int().min(0).max(999),
  campusId: z.string().min(1, { error: 'Choose a campus.' }),
  departmentId: z.string().nullable(),
  academicYearId: z.string().nullable(),
  classTeacherMembershipId: z.string().nullable(),
  capacity: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 5000), {
      error: 'Enter a number between 1 and 5000, or leave it empty.',
    }),
  status: z.enum(['active', 'inactive']),
});
export type ClassInput = z.infer<typeof classSchema>;

export const subjectSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter a name.' }).max(120),
  code: codeSchema,
  departmentId: z.string().nullable(),
  description: z.string().trim().max(500, { error: 'Descriptions must be 500 characters or fewer.' }),
  status: z.enum(['active', 'inactive']),
});
export type SubjectInput = z.infer<typeof subjectSchema>;

export const staffInvitationSchema = z.object({
  email: emailSchema,
  roleId: z.string().min(1, { error: 'Choose a role for this person.' }),
  campusId: z.string().nullable(),
});
export type StaffInvitationInput = z.infer<typeof staffInvitationSchema>;
