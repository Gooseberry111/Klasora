import { z } from 'zod';
import { emailSchema, passwordSchema, personNameSchema, optionalPhoneSchema } from './common';
import { THEME_PREFERENCES } from '../constants';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Enter your password.' }),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const newPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    error: 'The passwords do not match.',
  });
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;

/** Sign-up used when accepting an invitation (no school is created). */
export const inviteeSignUpSchema = z
  .object({
    firstName: personNameSchema('your first name'),
    lastName: personNameSchema('your last name'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    error: 'The passwords do not match.',
  });
export type InviteeSignUpInput = z.infer<typeof inviteeSignUpSchema>;

export const profileUpdateSchema = z.object({
  firstName: personNameSchema('your first name'),
  lastName: personNameSchema('your last name'),
  phone: optionalPhoneSchema,
  theme: z.enum(THEME_PREFERENCES),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
