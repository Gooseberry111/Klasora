import { useColorScheme } from 'react-native';

/** Klasora mobile design tokens, the same palette as the web app, tuned for native. */
const light = {
  canvas: '#F7F9FC',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  ink: '#172033',
  inkMuted: '#64748B',
  inkSubtle: '#94A3B8',
  line: '#E5EAF1',
  lineStrong: '#D5DCE6',
  brand: '#2563EB',
  brandSoft: '#EFF6FF',
  brandInk: '#1D4ED8',
  navy: '#14243A',
  success: '#16A34A',
  successSoft: '#ECFDF3',
  warning: '#D97706',
  warningSoft: '#FFFBEB',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  onBrand: '#FFFFFF',
};

const dark: typeof light = {
  canvas: '#0B1322',
  surface: '#111B2D',
  surfaceMuted: '#16223A',
  ink: '#E6EBF3',
  inkMuted: '#97A5BA',
  inkSubtle: '#6B7A92',
  line: '#22304A',
  lineStrong: '#2D3D5A',
  brand: '#3B82F6',
  brandSoft: 'rgba(59,130,246,0.14)',
  brandInk: '#93C5FD',
  navy: '#0D1829',
  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.12)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245,158,11,0.12)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239,68,68,0.12)',
  onBrand: '#FFFFFF',
};

export type Palette = typeof light;

export const spacing = (n: number) => n * 4;
export const radius = { control: 8, card: 12, panel: 16 };
export const type = {
  title: { fontSize: 26, fontWeight: '600' as const, letterSpacing: -0.4 },
  section: { fontSize: 18, fontWeight: '600' as const },
  card: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15 },
  label: { fontSize: 13, fontWeight: '500' as const },
  small: { fontSize: 13 },
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
