import { useState } from 'react';
import { router } from 'expo-router';
import { forgotPasswordSchema, validate } from '@klasora/shared';
import { useAuth } from '@/providers/AuthProvider';
import { Button, Heading, Notice, Screen, TextField } from '@/components/ui';

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError('');
    const result = validate(forgotPasswordSchema, { email });
    if (!result.success) {
      setFieldError(result.errors.email);
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    try {
      await requestPasswordReset(result.data.email);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <Heading title="Reset your password" subtitle="We'll email you a link to choose a new password." />
      {sent ? (
        <Notice tone="success">
          If an account exists for {email.trim().toLowerCase()}, a reset link is on its way. Open it to set a new password.
        </Notice>
      ) : (
        <>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <TextField
            label="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            error={fieldError}
          />
          <Button label="Send reset link" onPress={submit} loading={submitting} />
        </>
      )}
      <Button label="Back to sign in" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
