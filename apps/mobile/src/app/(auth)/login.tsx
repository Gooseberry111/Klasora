import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loginSchema, validate, type FieldErrors } from '@klasora/shared';
import { useAuth } from '@/providers/AuthProvider';
import { Button, Card, Logo, Notice, TextField } from '@/components/ui';
import { HeroBackground } from '@/components/visual';
import { Icon } from '@/components/icons';
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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ overflow: 'hidden', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
          <HeroBackground />
          <SafeAreaView edges={['top']}>
            <View style={{ paddingHorizontal: spacing(6), paddingTop: spacing(8), paddingBottom: spacing(16), gap: spacing(5) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(3) }}>
                <Logo size={44} />
                <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '700', letterSpacing: -0.5 }}>Klasora</Text>
              </View>
              <View>
                <Text style={{ color: '#93C5FD', fontSize: 12, fontWeight: '700', letterSpacing: 1.6 }}>EDUCATION, CONNECTED.</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '700', letterSpacing: -0.6, marginTop: spacing(2), lineHeight: 36 }}>
                  Your school,{'\n'}in your pocket.
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing(4) }}>
                {[
                  { icon: 'shield' as const, text: 'Secure' },
                  { icon: 'bell' as const, text: 'Up to date' },
                  { icon: 'users' as const, text: 'Connected' },
                ].map((item) => (
                  <View key={item.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name={item.icon} size={15} color="#93C5FD" />
                    <Text style={{ color: '#C7D2E3', fontSize: 13 }}>{item.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          </SafeAreaView>
        </View>

        <View style={{ paddingHorizontal: spacing(5), marginTop: -spacing(10), paddingBottom: spacing(10), gap: spacing(4) }}>
          <Card>
            <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 }}>
              Welcome back
            </Text>
            <Text style={{ color: c.inkMuted, fontSize: 15, marginTop: -spacing(2) }}>Sign in to your Klasora account.</Text>
            {formError ? <Notice tone="danger">{formError}</Notice> : null}
            <TextField
              label="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@school.com"
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
            <Link href="/forgot-password" style={{ color: c.brandInk, fontWeight: '600', textAlign: 'center', padding: spacing(2) }}>
              Forgot your password?
            </Link>
          </Card>
          <Text style={{ color: c.inkMuted, textAlign: 'center', fontSize: 13, lineHeight: 19, paddingHorizontal: spacing(4) }}>
            Teachers, parents and students: accept your school's invitation first, then sign in here.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
