import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/providers/AuthProvider';
import { Button, Card, Heading, Notice } from '@/components/ui';
import { radius, spacing, type, usePalette } from '@/lib/theme';

export default function HomeScreen() {
  const { profile, session, schools, currentSchool, permissions, selectSchool, clearSchool, signOut, reload } = useAuth();
  const c = usePalette();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const name = profile?.first_name || session?.user.email || 'there';

  async function refresh() {
    setRefreshing(true);
    setError('');
    try {
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function choose(schoolId: string) {
    setError('');
    try {
      await selectSchool(schoolId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing(5), gap: spacing(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brand} />}
      >
        <Heading
          title={`Hello, ${name}`}
          subtitle={currentSchool ? currentSchool.name : schools.length ? 'Choose a school to continue.' : undefined}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {schools.length === 0 ? (
          <Card>
            <Text style={[type.card, { color: c.ink }]}>You're not part of a school yet</Text>
            <Text style={{ color: c.inkMuted, fontSize: 14 }}>
              School owners register their institution on the Klasora website. If a school invited you, open the invitation
              link in your email, then pull down here to refresh.
            </Text>
          </Card>
        ) : null}

        {!currentSchool && schools.length > 0 ? (
          <View style={{ gap: spacing(2) }}>
            {schools.map((school) => (
              <Pressable
                key={school.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${school.name}`}
                onPress={() => choose(school.id)}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? c.surfaceMuted : c.surface,
                  borderColor: c.line,
                  borderWidth: 1,
                  borderRadius: radius.card,
                  padding: spacing(4),
                  minHeight: 64,
                })}
              >
                <Text style={[type.card, { color: c.ink }]}>{school.name}</Text>
                <Text style={{ color: c.inkMuted, fontSize: 13, marginTop: 2 }}>
                  {school.roles.map((r) => r.name).join(', ')}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {currentSchool ? (
          <Card>
            <Text style={[type.small, { color: c.inkMuted }]}>Your access</Text>
            {currentSchool.roles.map((role) => (
              <Text key={role.id} style={[type.card, { color: c.ink }]}>
                {role.name}
              </Text>
            ))}
            <Text style={{ color: c.inkMuted, fontSize: 13 }}>
              {permissions.size} permission{permissions.size === 1 ? '' : 's'} in this school. More of your school's
              tools arrive in the app as each Klasora module launches.
            </Text>
            {schools.length > 1 ? (
              <Button label="Switch school" variant="secondary" onPress={clearSchool} />
            ) : null}
          </Card>
        ) : null}

        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}
