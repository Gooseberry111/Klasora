import { useState } from 'react';
import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { loginSchema, validate, type FieldErrors } from '@klasora/shared';
import { useAuth } from '@/providers/AuthProvider';
import { Button, Heading, Logo, Notice, Screen, TextField } from '@/components/ui';
import { spacing, usePalette } from '@/lib/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const c = usePalette();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setFormError('');
    const result = validate(loginSchema, { email, password });
    if (!result.success) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await signIn(result.data.email, result.data.password);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={{ marginTop: spacing(8), marginBottom: spacing(4) }}>
        <Logo size={48} />
      </View>
      <Heading title="Welcome back" subtitle="Sign in to your Klasora account." />
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <TextField
        label="Email address"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        error={errors.email}
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        error={errors.password}
        onSubmitEditing={submit}
      />
      <Button label="Sign in" onPress={submit} loading={submitting} />
      <Link href="/forgot-password" style={{ color: c.brandInk, fontWeight: '500', textAlign: 'center', padding: spacing(2) }}>
        Forgot your password?
      </Link>
      <Text style={{ color: c.inkMuted, textAlign: 'center', fontSize: 13 }}>
        Teachers, parents and students: accept your school's invitation first, then sign in here.
      </Text>
    </Screen>
  );
}
