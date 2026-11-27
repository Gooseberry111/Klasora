/** Signature Klasora surfaces for mobile: gradient hero panels, icon tiles and stat tiles. */
import { useId, type ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Icon, type IconName } from './icons';
import { radius, spacing, usePalette } from '@/lib/theme';

export type Tone = 'brand' | 'violet' | 'success' | 'info' | 'warning';

export const toneColors: Record<Tone, [string, string]> = {
  brand: ['#3B82F6', '#1D4ED8'],
  violet: ['#A78BFA', '#6D28D9'],
  success: ['#22C55E', '#15803D'],
  info: ['#22D3EE', '#0E7490'],
  warning: ['#FBBF24', '#D97706'],
};

/** Navy panel with blue and cyan glows and a fine dot texture. */
export function HeroBackground({ style }: { style?: ViewStyle }) {
  const id = useId().replace(/:/g, '');
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`base${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#14243A" />
            <Stop offset="1" stopColor="#0C1A30" />
          </LinearGradient>
          <RadialGradient id={`glowA${id}`} cx="100%" cy="0%" r="75%">
            <Stop offset="0" stopColor="#3B82F6" stopOpacity="0.6" />
            <Stop offset="1" stopColor="#3B82F6" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`glowB${id}`} cx="0%" cy="100%" r="70%">
            <Stop offset="0" stopColor="#0891B2" stopOpacity="0.4" />
            <Stop offset="1" stopColor="#0891B2" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#base${id})`} />
        <Rect width="100%" height="100%" fill={`url(#glowA${id})`} />
        <Rect width="100%" height="100%" fill={`url(#glowB${id})`} />
        {Array.from({ length: 6 }).map((_, row) =>
          Array.from({ length: 14 }).map((__, col) => (
            <Circle key={`${row}${col}`} cx={`${col * 7.5 + 3}%`} cy={row * 22 + 10} r={1} fill="#FFFFFF" opacity={0.07} />
          )),
        )}
      </Svg>
    </View>
  );
}

export function IconTile({ icon, tone = 'brand', size = 44 }: { icon: IconName; tone?: Tone; size?: number }) {
  const id = useId().replace(/:/g, '');
  const [from, to] = toneColors[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#t${id})`} />
        <Rect width={size} height={size / 2} fill="#FFFFFF" opacity={0.14} />
      </Svg>
      <Icon name={icon} size={size * 0.48} color="#FFFFFF" />
    </View>
  );
}

export function StatTile({ icon, tone, label, value, detail }: { icon: IconName; tone: Tone; label: string; value: string | number; detail?: string }) {
  const c = usePalette();
  return (
    <View
      style={{
        flexBasis: '47%',
        flexGrow: 1,
        backgroundColor: c.surface,
        borderRadius: radius.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.line,
        padding: spacing(4),
        gap: spacing(2),
        shadowColor: '#14243A',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}
    >
      <IconTile icon={icon} tone={tone} size={38} />
      <Text style={{ color: c.inkMuted, fontSize: 13, fontWeight: '500', marginTop: spacing(1) }}>{label}</Text>
      <Text style={{ color: c.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 }}>{value}</Text>
      {detail ? (
        <Text numberOfLines={1} style={{ color: c.inkSubtle, fontSize: 12 }}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing(2) }}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontSize: 17, fontWeight: '600' }}>
        {children}
      </Text>
      {action}
    </View>
  );
}

export function ProgressBar({ value, tone = 'brand', track }: { value: number; tone?: Tone; track?: string }) {
  const c = usePalette();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: track ?? c.surfaceMuted, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: toneColors[tone][0] }} />
    </View>
  );
}
