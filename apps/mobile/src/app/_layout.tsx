import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/providers/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

function ConfigurationMissing() {
  const c = usePalette();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: c.canvas, gap: 8 }}>
      <Text style={{ fontSize: 20, fontWeight: '600', color: c.ink }}>Connect Klasora to Supabase</Text>
      <Text style={{ fontSize: 15, color: c.inkMuted }}>
        Copy apps/mobile/.env.example to .env.local, fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then
        restart Expo with --clear.
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const c = usePalette();
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {isSupabaseConfigured ? (
        <AuthProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />
        </AuthProvider>
      ) : (
        <ConfigurationMissing />
      )}
    </SafeAreaProvider>
  );
}
