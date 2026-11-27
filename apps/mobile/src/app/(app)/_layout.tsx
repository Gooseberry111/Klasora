import { Redirect, Stack, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/providers/AuthProvider';
import { usePalette } from '@/lib/theme';
import { MOBILE_WELCOME_TOUR } from '@/lib/tours';

/**
 * Signed in area. First time users see the walkthrough before Home.
 * Role specific bottom tabs (parent, teacher, student, administrator) are
 * added in Phase 8 once those modules exist.
 */
export default function AppLayout() {
  const { ready, session, profile, hasCompletedTour } = useAuth();
  const segments = useSegments();
  const c = usePalette();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.canvas }}>
        <ActivityIndicator color={c.brand} accessibilityLabel="Loading" />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;

  const onWelcome = (segments as string[]).includes('welcome');
  if (profile && !onWelcome && !hasCompletedTour(MOBILE_WELCOME_TOUR)) return <Redirect href="/welcome" />;

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />;
}
