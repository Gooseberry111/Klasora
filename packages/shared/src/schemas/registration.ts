import { z } from 'zod';
import { ACADEMIC_STRUCTURES, COUNTRIES, INSTITUTION_TYPES } from '../constants';
import {
  emailSchema,
  optionalUrlSchema,
  passwordSchema,
  personNameSchema,
  phoneSchema,
} from './common';

const countryCodes = COUNTRIES.map((c) => c.code) as [string, ...string[]];

/** Step 1: institution information. */
export const institutionStepSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: 'Enter the name of your institution.' })
    .max(200, { error: 'The name must be 200 characters or fewer.' }),
  institutionType: z.enum(INSTITUTION_TYPES, { error: 'Choose the type of institution.' }),
  email: emailSchema,
  phone: phoneSchema,
  country: z.enum(countryCodes, { error: 'Choose a country.' }),
  state: z.string().trim().min(1, { error: 'Enter the state or region.' }).max(100),
  city: z.string().trim().min(1, { error: 'Enter the city or town.' }).max(100),
  address: z
    .string()
    .trim()
    .min(5, { error: 'Enter the street address.' })
    .max(500, { error: 'The address must be 500 characters or fewer.' }),
  website: optionalUrlSchema,
});
export type InstitutionStepInput = z.infer<typeof institutionStepSchema>;

/** Step 2: academic structure. */
export const structureStepSchema = z.object({
  academicStructure: z.enum(ACADEMIC_STRUCTURES, { error: 'Choose how your institution is organised.' }),
});
export type StructureStepInput = z.infer<typeof structureStepSchema>;

/** Step 3: the first administrator (the school owner). */
export const administratorStepSchema = z
  .object({
    firstName: personNameSchema('your first name'),
    lastName: personNameSchema('your last name'),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    error: 'The passwords do not match.',
  });
export type AdministratorStepInput = z.infer<typeof administratorStepSchema>;

/** Step 4: subscription plan. */
export const planStepSchema = z.object({
  planCode: z.string().trim().min(1, { error: 'Choose a plan to continue.' }),
});
export type PlanStepInput = z.infer<typeof planStepSchema>;

/**
 * The payload sent to the `public.register_school` RPC. It is also stored in the
 * new user's metadata (`pending_school`) when email verification is required, so
 * registration can finish after the user confirms their address.
 */
export const schoolRegistrationSchema = institutionStepSchema
  .extend(structureStepSchema.shape)
  .extend(planStepSchema.shape);
export type SchoolRegistrationInput = z.infer<typeof schoolRegistrationSchema>;
