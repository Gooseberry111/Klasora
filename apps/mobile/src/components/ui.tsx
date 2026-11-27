/** Klasora mobile primitives: consistent spacing, 44pt+ touch targets, accessible labels. */
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { radius, spacing, type, usePalette } from '@/lib/theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = usePalette();
  const content = <View style={{ padding: spacing(5), gap: spacing(4) }}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  const c = usePalette();
  return (
    <View style={{ gap: spacing(1) }}>
      <Text accessibilityRole="header" style={[type.title, { color: c.ink }]}>
        {title}
      </Text>
      {subtitle ? <Text style={[type.body, { color: c.inkMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const c = usePalette();
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.panel,
        padding: spacing(4),
        gap: spacing(3),
        shadowColor: '#14243A',
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}
    >
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  loading,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}) {
  const c = usePalette();
  const isDisabled = disabled || loading;
  const background = variant === 'primary' ? c.brand : variant === 'secondary' ? c.surface : 'transparent';
  const color = variant === 'primary' ? c.onBrand : variant === 'secondary' ? c.ink : c.brandInk;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 50,
        borderRadius: radius.control + 2,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing(4),
        backgroundColor: background,
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: c.lineStrong,
        opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1,
        transform: [{ scale: pressed && !isDisabled ? 0.98 : 1 }],
        shadowColor: variant === 'primary' ? '#2563EB' : '#000000',
        shadowOpacity: variant === 'primary' ? 0.35 : 0,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: variant === 'primary' ? 3 : 0,
      })}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{label}</Text>}
    </Pressable>
  );
}

export function TextField({ label, error, secureTextEntry, ...props }: TextInputProps & { label: string; error?: string }) {
  const c = usePalette();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={{ gap: spacing(1.5) }}>
      <Text style={[type.label, { color: c.ink }]}>{label}</Text>
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.inkSubtle}
          secureTextEntry={secureTextEntry && !revealed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            minHeight: 48,
            borderRadius: radius.control,
            borderWidth: 1,
            borderColor: error ? c.danger : focused ? c.brand : c.lineStrong,
            backgroundColor: c.surface,
            color: c.ink,
            paddingHorizontal: spacing(3),
            paddingRight: secureTextEntry ? spacing(16) : spacing(3),
            fontSize: 15,
          }}
          {...props}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            style={{ position: 'absolute', right: spacing(3), padding: spacing(1) }}
          >
            <Text style={{ color: c.brandInk, fontWeight: '500' }}>{revealed ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 13 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Notice({ tone, children }: { tone: 'danger' | 'success' | 'info'; children: ReactNode }) {
  const c = usePalette();
  const palette = {
    danger: { bg: c.dangerSoft, fg: c.danger },
    success: { bg: c.successSoft, fg: c.success },
    info: { bg: c.brandSoft, fg: c.brandInk },
  }[tone];
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: palette.bg, borderRadius: radius.control, padding: spacing(3) }}>
      <Text style={{ color: palette.fg, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" accessibilityLabel="Klasora">
      <Rect width={40} height={40} rx={10} fill="#14243A" />
      <Path d="M8 15.2c4-1.6 8-1.2 11.2 1.4V31c-3.2-2.4-7.2-2.8-11.2-1.4V15.2Z" fill="#FFFFFF" />
      <Path d="M32 15.2c-4-1.6-8-1.2-11.2 1.4V31c3.2-2.4 7.2-2.8 11.2-1.4V15.2Z" fill="#3B82F6" />
      <Path d="M11 10.6 20 7.4l9 3.2" stroke="#3B82F6" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx={11} cy={10.6} r={1.9} fill="#FFFFFF" />
      <Circle cx={20} cy={7.4} r={1.9} fill="#3B82F6" />
      <Circle cx={29} cy={10.6} r={1.9} fill="#FFFFFF" />
    </Svg>
  );
}
