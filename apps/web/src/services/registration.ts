import { schoolRegistrationSchema, type SchoolRegistrationInput, type SubscriptionPlan } from '@klasora/shared';
import { supabase } from '@/lib/supabase';
import { AppError, toAppError } from '@/lib/errors';

export async function fetchPublicPlans(): Promise<SubscriptionPlan[]> {
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw toAppError(error, { fallback: "We couldn't load the subscription plans. Please refresh and try again." });
  return (data ?? []) as SubscriptionPlan[];
}

/** Calls the `register_school` RPC and returns the new school's id. */
export async function registerSchool(input: SchoolRegistrationInput): Promise<string> {
  const parsed = schoolRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('Some institution details are missing or invalid. Please review them and try again.');
  }
  const v = parsed.data;
  const { data, error } = await supabase.rpc('register_school', {
    p_name: v.name,
    p_institution_type: v.institutionType,
    p_academic_structure: v.academicStructure,
    p_email: v.email,
    p_phone: v.phone,
    p_country: v.country,
    p_state: v.state,
    p_city: v.city,
    p_address: v.address,
    p_website: v.website || null,
    p_plan_code: v.planCode,
  });
  if (error) throw toAppError(error, { fallback: "We couldn't create your school workspace. Please try again." });
  return data as string;
}

/** Reads a registration stored in user metadata while the email was being verified. */
export function readPendingRegistration(metadata: Record<string, unknown> | undefined): SchoolRegistrationInput | null {
  const pending = metadata?.pending_school;
  if (!pending) return null;
  const parsed = schoolRegistrationSchema.safeParse(pending);
  return parsed.success ? parsed.data : null;
}

export async function clearPendingRegistration(): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { pending_school: null } });
  if (error) throw toAppError(error, { fallback: "Your school was created, but we couldn't tidy up your sign-up details." });
}
