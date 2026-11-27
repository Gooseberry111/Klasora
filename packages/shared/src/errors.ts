/**
 * Converts Supabase/Postgres/network failures into messages a school
 * administrator can act on. Shared by the web and mobile apps so both speak
 * the same language. Raw codes ("Error 400", "42501") never reach the UI.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

interface ErrorLike {
  message?: string;
  code?: string | number;
  status?: number;
  name?: string;
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'The email or password is incorrect.',
  email_not_confirmed: 'Please confirm your email address first. Check your inbox for the verification link.',
  user_already_exists: 'An account with this email already exists. Try signing in instead.',
  email_exists: 'An account with this email already exists. Try signing in instead.',
  weak_password: 'Choose a stronger password: at least 8 characters with letters and numbers.',
  same_password: 'Your new password must be different from your current one.',
  over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  over_email_send_rate_limit: 'We have sent several emails already. Please wait a few minutes before trying again.',
  otp_expired: 'This link has expired. Please request a new one.',
  session_not_found: 'Your session has ended. Please sign in again.',
  refresh_token_not_found: 'Your session has ended. Please sign in again.',
  signup_disabled: 'New registrations are paused right now. Please try again later.',
  reauthentication_needed: 'For your security, please sign in again before changing your password.',
};

const AUTH_MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/invalid login credentials/i, AUTH_MESSAGES.invalid_credentials!],
  [/email not confirmed/i, AUTH_MESSAGES.email_not_confirmed!],
  [/already registered/i, AUTH_MESSAGES.user_already_exists!],
  [/password should/i, AUTH_MESSAGES.weak_password!],
  [/jwt expired/i, 'Your session has expired. Please sign in again.'],
];

export interface ErrorContext {
  /** Shown when nothing more specific is known, e.g. "We couldn't save this role." */
  fallback: string;
  /** Shown for unique-constraint conflicts, e.g. "A role with this name already exists." */
  conflict?: string;
  /** Shown when a delete is blocked because the record is still referenced. */
  inUse?: string;
}

export function toAppError(error: unknown, context: ErrorContext): AppError {
  if (error instanceof AppError) return error;
  const e = (error ?? {}) as ErrorLike;
  const code = e.code === undefined ? undefined : String(e.code);
  const message = e.message ?? '';

  // Messages written for users by Klasora's own database functions.
  if (code?.startsWith('KL') && message) return new AppError(message, code, error);

  if (code && AUTH_MESSAGES[code]) return new AppError(AUTH_MESSAGES[code], code, error);
  for (const [pattern, friendly] of AUTH_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return new AppError(friendly, code, error);
  }

  if (
    (e.name === 'TypeError' && /fetch|network|load failed/i.test(message)) ||
    e.name === 'AuthRetryableFetchError'
  ) {
    return new AppError(
      "We couldn't reach Klasora. Check your internet connection and try again.",
      'network',
      error,
    );
  }

  switch (code) {
    case '42501':
      return new AppError("You don't have permission to do that. Ask your school administrator for access.", code, error);
    case '23505':
      return new AppError(context.conflict ?? 'This already exists. Please use different details.', code, error);
    case '23503':
    case '23001':
      return new AppError(
        context.inUse ?? 'This is still in use elsewhere, so it cannot be removed yet.',
        code,
        error,
      );
    case '23514':
    case '23502':
    case '22P02':
    case '22023':
    case '22001':
      return new AppError('Some of the details are not valid. Please check the highlighted fields and try again.', code, error);
    case 'PGRST301':
    case 'PGRST303':
      return new AppError('Your session has expired. Please sign in again.', code, error);
  }

  if (e.status === 429) {
    return new AppError(AUTH_MESSAGES.over_request_rate_limit!, '429', error);
  }

  return new AppError(context.fallback, code, error);
}

/** Throws a friendly AppError when a Supabase response carries an error. */
export function unwrap<T>(response: { data: T; error: unknown }, context: ErrorContext): NonNullable<T> {
  if (response.error) throw toAppError(response.error, context);
  if (response.data === null || response.data === undefined) {
    throw new AppError(context.fallback);
  }
  return response.data as NonNullable<T>;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return toAppError(error, { fallback }).message;
}
