import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/providers/AuthProvider';
import { usePalette } from '@/lib/theme';

/**
 * Signed-in area. Role-specific bottom tabs (parent, teacher, student,
 * administrator) are added in Phase 8 once those modules exist.
 */
export default function AppLayout() {
  const { ready, session } = useAuth();
  const c = usePalette();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.canvas }}>
        <ActivityIndicator color={c.brand} accessibilityLabel="Loading" />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />;
}
