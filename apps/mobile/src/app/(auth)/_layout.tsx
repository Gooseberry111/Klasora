import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { usePalette } from '@/lib/theme';

/** Signed-out area. Signed-in users are sent to the app. */
export default function AuthLayout() {
  const { ready, session } = useAuth();
  const c = usePalette();
  if (!ready) return null;
  if (session) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />;
}
