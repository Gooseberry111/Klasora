import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  academicVocabulary,
  buildSetupSteps,
  setupCompletion,
  toAppError,
  type AcademicTerm,
  type AcademicYear,
  type ChildSummary,
  RELATIONSHIP_LABELS,
  studentName,
  type SetupProgress,
} from '@klasora/shared';
import { useAuth, type MobileSchool } from '@/providers/AuthProvider';
import { Card, Notice } from '@/components/ui';
import { HeroBackground, IconTile, ProgressBar, SectionTitle, StatTile } from '@/components/visual';
import { Icon } from '@/components/icons';
import { supabase } from '@/lib/supabase';
import { radius, spacing, type, usePalette } from '@/lib/theme';

function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function day(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? ''))).toUpperCase();
}

export default function HomeScreen() {
  const { profile, session, schools, currentSchool, permissions, selectSchool, clearSchool, signOut, reload } = useAuth();
  const c = usePalette();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const name = profile?.first_name || session?.user.email || 'there';
  const words = academicVocabulary(currentSchool?.academicStructure ?? 'classes_grades');

  const loadOverview = useCallback(async (school: MobileSchool | null) => {
    if (!school) return;
    const [p, y, t] = await Promise.all([
      supabase.rpc('get_setup_progress', { p_school_id: school.id }),
      supabase.from('academic_years').select('*').eq('school_id', school.id),
      supabase.from('academic_terms').select('*').eq('school_id', school.id).order('sequence'),
    ]);
    // Guardians see their own children. The call returns nothing for everyone else.
    const kids = await supabase.rpc('get_my_children', { p_school_id: school.id });
    const list = ((kids.data ?? []) as ChildSummary[]);
    setChildren(list);
    const paths = list.map((k) => k.photo_path).filter((x): x is string => Boolean(x));
    if (paths.length) {
      const signed = await supabase.storage.from('student-files').createSignedUrls(paths, 3600);
      const urls: Record<string, string> = {};
      for (const item of signed.data ?? []) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
      setPhotos(urls);
    }
    if (p.error) {
      // People without access to school figures (such as parents) still get their children.
      if (list.length) return;
      throw toAppError(p.error, { fallback: "We couldn't load your school overview." });
    }
    setProgress(((p.data as SetupProgress[] | null) ?? [])[0] ?? null);
    setYears((y.data ?? []) as AcademicYear[]);
    setTerms((t.data ?? []) as AcademicTerm[]);
  }, []);

  useEffect(() => {
    loadOverview(currentSchool).catch((e: Error) => setError(e.message));
  }, [currentSchool, loadOverview]);

  async function refresh() {
    setRefreshing(true);
    setError('');
    try {
      await reload();
      await loadOverview(currentSchool);
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

  const currentYear = years.find((y) => y.is_current) ?? null;
  const currentTerm = terms.find((t) => t.is_current) ?? null;
  const termPct = currentTerm
    ? Math.round(Math.min(100, Math.max(0, ((Date.now() - Date.parse(currentTerm.start_date)) / (Date.parse(currentTerm.end_date) - Date.parse(currentTerm.start_date))) * 100)))
    : 0;
  const daysLeft = currentTerm ? Math.max(0, Math.ceil((Date.parse(currentTerm.end_date) - Date.now()) / 86_400_000)) : 0;
  const isAdmin = ['settings.edit', 'academics.create', 'staff.create'].some((p) => permissions.has(p as never));
  const steps = progress ? buildSetupSteps(progress, words) : [];
  const completion = steps.length ? setupCompletion(steps) : 0;

  return (
    <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing(10) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brand} />}
      >
        {/* Hero */}
        <View style={{ overflow: 'hidden', borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
          <HeroBackground />
          <SafeAreaView edges={['top']}>
            <View style={{ paddingHorizontal: spacing(5), paddingTop: spacing(4), paddingBottom: spacing(8), gap: spacing(4) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(3) }}>
                <View style={{ width: 48, height: 48, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }}>
                  {currentSchool?.logoUrl ? (
                    <Image source={{ uri: currentSchool.logoUrl }} style={{ width: 48, height: 48 }} accessibilityIgnoresInvertColors />
                  ) : (
                    <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>{initials(currentSchool?.name ?? 'Klasora')}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                    {currentSchool?.name ?? 'Klasora'}
                  </Text>
                  <Text numberOfLines={1} style={{ color: '#8394AD', fontSize: 13 }}>
                    {currentSchool ? currentSchool.roles.map((r) => r.name).join(', ') : 'Education, connected.'}
                  </Text>
                </View>
              </View>
              <View>
                <Text style={{ color: '#C7D2E3', fontSize: 14 }}>
                  {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
                </Text>
                <Text accessibilityRole="header" style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '700', letterSpacing: -0.6, marginTop: spacing(1) }}>
                  {greeting()}, {name}
                </Text>
              </View>
              {currentSchool ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) }}>
                  <View style={styles.chip}>
                    <Icon name="calendar" size={14} color="#C7D2E3" />
                    <Text style={styles.chipText}>
                      {currentYear ? `${currentYear.name} session${currentTerm ? `, ${currentTerm.name}` : ''}` : 'No current session yet'}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          </SafeAreaView>
        </View>

        <View style={{ padding: spacing(5), gap: spacing(4), marginTop: -spacing(4) }}>
          {error ? <Notice tone="danger">{error}</Notice> : null}

          {schools.length === 0 ? (
            <Card>
              <IconTile icon="school" tone="brand" />
              <Text style={[type.card, { color: c.ink }]}>You're not part of a school yet</Text>
              <Text style={{ color: c.inkMuted, fontSize: 14, lineHeight: 20 }}>
                School owners register their institution on the Klasora website. If a school invited you, open the invitation link
                in your email, then pull down here to refresh.
              </Text>
            </Card>
          ) : null}

          {!currentSchool && schools.length > 0 ? (
            <>
              <SectionTitle>Choose a school</SectionTitle>
              {schools.map((school) => (
                <Pressable
                  key={school.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${school.name}`}
                  onPress={() => choose(school.id)}
                  style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surfaceMuted : c.surface, borderColor: c.line }]}
                >
                  <IconTile icon="building" tone="brand" size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.card, { color: c.ink }]}>{school.name}</Text>
                    <Text style={{ color: c.inkMuted, fontSize: 13, marginTop: 2 }}>{school.roles.map((r) => r.name).join(', ')}</Text>
                  </View>
                  <Icon name="chevronRight" size={18} color={c.inkSubtle} />
                </Pressable>
              ))}
            </>
          ) : null}

          {currentSchool && children.length ? (
            <>
              <SectionTitle>Your children</SectionTitle>
              {children.map((child) => (
                <View key={child.student_id} style={[styles.row, { backgroundColor: c.surface, borderColor: c.line }]}>
                  <View style={{ width: 52, height: 52, borderRadius: 26, overflow: 'hidden', backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                    {child.photo_path && photos[child.photo_path] ? (
                      <Image source={{ uri: photos[child.photo_path] }} style={{ width: 52, height: 52 }} accessibilityIgnoresInvertColors />
                    ) : (
                      <Text style={{ color: c.brandInk, fontWeight: '700', fontSize: 17 }}>{initials(studentName(child))}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.card, { color: c.ink }]}>{studentName(child)}</Text>
                    <Text style={{ color: c.inkMuted, fontSize: 13, marginTop: 2 }}>
                      {[child.class_name ?? 'Class not set yet', RELATIONSHIP_LABELS[child.relationship]].join(', ')}
                    </Text>
                    <Text style={{ color: c.inkSubtle, fontSize: 12, marginTop: 2 }}>{child.admission_number}</Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {currentSchool && progress ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) }}>
                <StatTile icon="users" tone="brand" label="People" value={progress.members} detail={progress.pending_invitations ? `${progress.pending_invitations} invited` : 'Active members'} />
                <StatTile icon="school" tone="violet" label={words.groups} value={progress.classes} detail={`${progress.campuses} campus${progress.campuses === 1 ? '' : 'es'}`} />
                <StatTile icon="book" tone="success" label={words.subjects} value={progress.subjects} detail={`${progress.class_subjects} assignments`} />
                <StatTile icon="calendar" tone="warning" label={words.periods} value={progress.terms} detail={currentTerm ? `${currentTerm.name} now` : 'None current'} />
              </View>

              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(3) }}>
                  <IconTile icon="calendar" tone="violet" size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.card, { color: c.ink }]}>{currentTerm ? currentTerm.name : `Current ${words.period.toLowerCase()}`}</Text>
                    <Text style={{ color: c.inkMuted, fontSize: 13 }}>
                      {currentTerm ? `${day(currentTerm.start_date)} to ${day(currentTerm.end_date)}` : `No ${words.period.toLowerCase()} is marked as current yet.`}
                    </Text>
                  </View>
                </View>
                {currentTerm ? (
                  <>
                    <ProgressBar value={termPct} tone="violet" />
                    <Text style={{ color: c.inkMuted, fontSize: 13 }}>
                      {termPct}% through, {daysLeft} day{daysLeft === 1 ? '' : 's'} to go
                    </Text>
                  </>
                ) : null}
              </Card>

              {isAdmin && !progress.setup_completed_at && completion < 100 ? (
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(3) }}>
                    <IconTile icon="sparkles" tone="brand" size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.card, { color: c.ink }]}>School setup: {completion}%</Text>
                      <Text style={{ color: c.inkMuted, fontSize: 13 }}>Finish the setup guide on the Klasora website.</Text>
                    </View>
                  </View>
                  <ProgressBar value={completion} />
                  {steps
                    .filter((s) => !s.optional)
                    .map((s) => (
                      <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(2) }}>
                        <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: s.done ? c.success : c.surfaceMuted }}>
                          {s.done ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}
                        </View>
                        <Text style={{ flex: 1, color: s.done ? c.inkMuted : c.ink, fontSize: 14, textDecorationLine: s.done ? 'line-through' : 'none' }}>{s.title}</Text>
                      </View>
                    ))}
                </Card>
              ) : null}
            </>
          ) : null}

          <SectionTitle>Account</SectionTitle>
          <View style={{ backgroundColor: c.surface, borderRadius: radius.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, overflow: 'hidden' }}>
            {currentSchool && schools.length > 1 ? (
              <MenuRow icon="repeat" label="Switch school" onPress={clearSchool} />
            ) : null}
            <MenuRow icon="compass" label="Replay the walkthrough" onPress={() => router.push('/welcome')} />
            <MenuRow icon="logOut" label="Sign out" danger onPress={() => void signOut()} last />
          </View>
          <Text style={{ color: c.inkSubtle, fontSize: 12, textAlign: 'center', marginTop: spacing(2) }}>Klasora. Education, connected.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({ icon, label, onPress, danger, last }: { icon: 'repeat' | 'compass' | 'logOut'; label: string; onPress: () => void; danger?: boolean; last?: boolean }) {
  const c = usePalette();
  const color = danger ? c.danger : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing(3),
        minHeight: 54,
        paddingHorizontal: spacing(4),
        backgroundColor: pressed ? c.surfaceMuted : 'transparent',
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.line,
      })}
    >
      <Icon name={icon} size={19} color={danger ? c.danger : c.inkMuted} />
      <Text style={{ flex: 1, color, fontSize: 15, fontWeight: '500' }}>{label}</Text>
      {!danger ? <Icon name="chevronRight" size={17} color={c.inkSubtle} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  chipText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
