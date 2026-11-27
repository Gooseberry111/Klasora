import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useAuth } from '@/providers/AuthProvider';
import { Button, Logo } from '@/components/ui';
import { HeroBackground, IconTile, toneColors, type Tone } from '@/components/visual';
import type { IconName } from '@/components/icons';
import { spacing } from '@/lib/theme';

import { MOBILE_WELCOME_TOUR } from '@/lib/tours';

interface Slide {
  icon: IconName;
  tone: Tone;
  title: string;
  body: string;
}

/**
 * The first run walkthrough. It explains what the app does and where things
 * are, then never shows again (it can be replayed from Home).
 */
export default function WelcomeScreen() {
  const { profile, currentSchool, completeTour } = useAuth();
  const { width } = useWindowDimensions();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const slides: Slide[] = [
    {
      icon: 'sparkles',
      tone: 'brand',
      title: `Welcome to Klasora${profile?.first_name ? `, ${profile.first_name}` : ''}`,
      body: `${currentSchool?.name ?? 'Your school'} is now in your pocket. Here is a quick look at how the app works.`,
    },
    {
      icon: 'calendar',
      tone: 'violet',
      title: 'Your day at a glance',
      body: 'Home shows the current session and term, how far through the term you are, and the key figures for your school.',
    },
    {
      icon: 'school',
      tone: 'success',
      title: 'Your whole school, organised',
      body: 'Classes, subjects and staff are set up by your administrators on the Klasora website, and appear here automatically.',
    },
    {
      icon: 'bell',
      tone: 'warning',
      title: 'Always up to date',
      body: 'Pull down on any screen to refresh. Announcements, attendance and results arrive here as your school turns them on.',
    },
    {
      icon: 'shield',
      tone: 'info',
      title: 'Private and secure',
      body: 'You only see what your role allows, and your sign in is stored securely on this device.',
    },
  ];

  const last = index === slides.length - 1;

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  function goTo(next: number) {
    scroller.current?.scrollTo({ x: next * width, animated: true });
    setIndex(next);
  }

  async function finish() {
    setFinishing(true);
    await completeTour(MOBILE_WELCOME_TOUR).catch(() => undefined);
    router.replace('/');
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0C1A30' }}>
      <HeroBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(5), paddingTop: spacing(2) }}>
          <Logo size={34} />
          {!last ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Skip the walkthrough" onPress={finish} hitSlop={12} style={{ padding: spacing(2) }}>
              <Text style={{ color: '#C7D2E3', fontSize: 15, fontWeight: '500' }}>Skip</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          style={{ flex: 1 }}
        >
          {slides.map((slide, i) => (
            <View key={slide.title} style={{ width, paddingHorizontal: spacing(7), justifyContent: 'center' }} accessibilityLabel={`Slide ${i + 1} of ${slides.length}`}>
              {/* Glowing rings behind the icon echo the connected network in the logo. */}
              <View style={{ alignItems: 'center', justifyContent: 'center', height: 220 }}>
                <Svg width={220} height={220} style={{ position: 'absolute' }}>
                  <Circle cx={110} cy={110} r={104} stroke="#FFFFFF" strokeOpacity={0.08} strokeWidth={1} fill="none" />
                  <Circle cx={110} cy={110} r={76} stroke={toneColors[slide.tone][0]} strokeOpacity={0.35} strokeWidth={1} fill={toneColors[slide.tone][0]} fillOpacity={0.08} />
                  <Circle cx={30} cy={70} r={4} fill="#93C5FD" opacity={0.6} />
                  <Circle cx={194} cy={150} r={5} fill="#93C5FD" opacity={0.5} />
                  <Circle cx={160} cy={20} r={3} fill="#67E8F9" opacity={0.6} />
                </Svg>
                <IconTile icon={slide.icon} tone={slide.tone} size={84} />
              </View>
              <Text accessibilityRole="header" style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '700', letterSpacing: -0.5, textAlign: 'center', marginTop: spacing(8) }}>
                {slide.title}
              </Text>
              <Text style={{ color: '#C7D2E3', fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: spacing(3) }}>{slide.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={{ paddingHorizontal: spacing(5), paddingBottom: spacing(6), gap: spacing(5) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing(1.5) }} accessibilityLabel={`Step ${index + 1} of ${slides.length}`}>
            {slides.map((s, i) => (
              <View key={s.title} style={{ height: 8, width: i === index ? 24 : 8, borderRadius: 4, backgroundColor: i === index ? '#60A5FA' : 'rgba(255,255,255,0.25)' }} />
            ))}
          </View>
          <Button label={last ? 'Get started' : 'Next'} loading={finishing} onPress={() => (last ? void finish() : goTo(index + 1))} />
        </View>
      </SafeAreaView>
    </View>
  );
}
