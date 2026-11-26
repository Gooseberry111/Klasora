import { z } from 'zod';
import { ALL_PERMISSION_KEYS } from '../permissions';
import { emailSchema } from './common';

export const roleFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: 'Enter a role name of at least 2 characters.' })
    .max(60, { error: 'Role names must be 60 characters or fewer.' }),
  description: z.string().trim().max(300, { error: 'Descriptions must be 300 characters or fewer.' }),
});
export type RoleFormInput = z.infer<typeof roleFormSchema>;

export const rolePermissionsSchema = z.object({
  roleId: z.uuid(),
  permissionKeys: z.array(z.enum(ALL_PERMISSION_KEYS as [string, ...string[]])),
});
export type RolePermissionsInput = z.infer<typeof rolePermissionsSchema>;

export const invitationFormSchema = z.object({
  email: emailSchema,
  roleId: z.uuid({ error: 'Choose a role for this person.' }),
  campusId: z.uuid().nullable(),
});
export type InvitationFormInput = z.infer<typeof invitationFormSchema>;
