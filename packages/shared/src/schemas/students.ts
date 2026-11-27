import { z } from 'zod';
import { optionalPhoneSchema } from './common';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (isoDate.test(v) && !Number.isNaN(Date.parse(v))), { error: `Choose a valid ${label}.` });

const optionalText = (max: number, label = 'This') =>
  z.string().trim().max(max, { error: `${label} must be ${max} characters or fewer.` });

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { error: 'Enter a valid email address, like name@example.com.' });

export const admissionNumberSchema = z
  .string()
  .trim()
  .max(30, { error: 'Admission numbers must be 30 characters or fewer.' })
  .refine((v) => v === '' || /^[A-Za-z0-9][A-Za-z0-9/._ -]*$/.test(v), {
    error: 'Use letters, numbers, spaces, slashes and full stops only.',
  });

export const studentFormSchema = z
  .object({
    firstName: z.string().trim().min(1, { error: 'Enter the first name.' }).max(100),
    middleName: optionalText(100, 'The middle name'),
    lastName: z.string().trim().min(1, { error: 'Enter the last name.' }).max(100),
    gender: z.enum(['', 'female', 'male']),
    dateOfBirth: optionalDate('date of birth'),
    admissionNumber: admissionNumberSchema,
    admissionDate: z.string().trim().refine((v) => isoDate.test(v), { error: 'Choose the admission date.' }),
    campusId: z.string(),
    classId: z.string(),
    status: z.enum(['applicant', 'active', 'suspended', 'graduated', 'withdrawn', 'transferred']),
    previousSchool: optionalText(200, 'The previous school'),
  })
  .refine((v) => !v.dateOfBirth || v.dateOfBirth <= new Date().toISOString().slice(0, 10), {
    error: 'The date of birth cannot be in the future.',
    path: ['dateOfBirth'],
  });
export type StudentFormInput = z.infer<typeof studentFormSchema>;

export const studentDetailsSchema = z.object({
  homeAddress: optionalText(500, 'The address'),
  bloodGroup: z.enum(['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
  genotype: z.enum(['', 'AA', 'AS', 'AC', 'SS', 'SC', 'CC']),
  medicalConditions: optionalText(2000),
  allergies: optionalText(1000),
  medications: optionalText(1000),
  accessibilityNeeds: optionalText(1000),
  emergencyContactName: optionalText(200),
  emergencyContactPhone: optionalPhoneSchema,
  emergencyContactRelationship: optionalText(60),
});
export type StudentDetailsInput = z.infer<typeof studentDetailsSchema>;

export const guardianFormSchema = z
  .object({
    firstName: z.string().trim().min(1, { error: 'Enter the first name.' }).max(100),
    lastName: z.string().trim().min(1, { error: 'Enter the last name.' }).max(100),
    email: optionalEmail,
    phone: optionalPhoneSchema,
    occupation: optionalText(120),
    address: optionalText(500),
  })
  .refine((v) => v.email !== '' || v.phone !== '', {
    error: 'Add an email address or phone number so the school can reach them.',
    path: ['email'],
  });
export type GuardianFormInput = z.infer<typeof guardianFormSchema>;

export const guardianLinkSchema = z.object({
  relationship: z.enum(['mother', 'father', 'guardian', 'grandparent', 'sibling', 'aunt_uncle', 'sponsor', 'other']),
  isPrimary: z.boolean(),
  isEmergencyContact: z.boolean(),
  canViewResults: z.boolean(),
  canViewFinances: z.boolean(),
  canReceiveNotifications: z.boolean(),
});
export type GuardianLinkInput = z.infer<typeof guardianLinkSchema>;

export const staffProfileSchema = z.object({
  staffNumber: admissionNumberSchema,
  jobTitle: optionalText(120, 'The job title'),
  departmentId: z.string(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'volunteer']),
  employmentStatus: z.enum(['active', 'on_leave', 'left']),
  employmentStartDate: optionalDate('start date'),
  qualifications: optionalText(1000),
});
export type StaffProfileInput = z.infer<typeof staffProfileSchema>;
