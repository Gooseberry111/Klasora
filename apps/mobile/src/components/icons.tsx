/**
 * A small set of Lucide icons (ISC licence) drawn with react native svg, so
 * mobile uses the same icon language as the web app without another package.
 */
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

export type IconName =
  | 'users'
  | 'book'
  | 'calendar'
  | 'building'
  | 'graduation'
  | 'bell'
  | 'shield'
  | 'chevronRight'
  | 'logOut'
  | 'compass'
  | 'check'
  | 'school'
  | 'sparkles'
  | 'repeat';

export function Icon({ name, size = 20, color = '#172033', strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {name === 'users' && (
        <>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...common} />
          <Circle cx={9} cy={7} r={4} {...common} />
          <Path d="M22 21v-2a4 4 0 0 0-3-3.87" {...common} />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" {...common} />
        </>
      )}
      {name === 'book' && (
        <>
          <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" {...common} />
          <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" {...common} />
        </>
      )}
      {name === 'calendar' && (
        <>
          <Rect width={18} height={18} x={3} y={4} rx={2} {...common} />
          <Path d="M16 2v4M8 2v4M3 10h18" {...common} />
        </>
      )}
      {name === 'building' && (
        <>
          <Path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" {...common} />
          <Path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4" {...common} />
        </>
      )}
      {name === 'graduation' && (
        <>
          <Path d="M22 10v6M2 10l10-5 10 5-10 5z" {...common} />
          <Path d="M6 12v5c3 3 9 3 12 0v-5" {...common} />
        </>
      )}
      {name === 'school' && (
        <>
          <Path d="M14 22v-4a2 2 0 1 0-4 0v4" {...common} />
          <Path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2" {...common} />
          <Path d="M18 5v17M6 5v17" {...common} />
          <Path d="m4 6 8-4 8 4" {...common} />
          <Circle cx={12} cy={9} r={2} {...common} />
        </>
      )}
      {name === 'bell' && (
        <>
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" {...common} />
          <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" {...common} />
        </>
      )}
      {name === 'shield' && (
        <>
          <Path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" {...common} />
          <Path d="m9 12 2 2 4-4" {...common} />
        </>
      )}
      {name === 'chevronRight' && <Path d="m9 18 6-6-6-6" {...common} />}
      {name === 'logOut' && (
        <>
          <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" {...common} />
          <Polyline points="16 17 21 12 16 7" {...common} />
          <Line x1={21} x2={9} y1={12} y2={12} {...common} />
        </>
      )}
      {name === 'compass' && (
        <>
          <Circle cx={12} cy={12} r={10} {...common} />
          <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" {...common} />
        </>
      )}
      {name === 'check' && <Path d="M20 6 9 17l-5-5" {...common} />}
      {name === 'sparkles' && (
        <Path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" {...common} />
      )}
      {name === 'repeat' && (
        <>
          <Path d="m17 2 4 4-4 4" {...common} />
          <Path d="M3 11v-1a4 4 0 0 1 4-4h14" {...common} />
          <Path d="m7 22-4-4 4-4" {...common} />
          <Path d="M21 13v1a4 4 0 0 1-4 4H3" {...common} />
        </>
      )}
    </Svg>
  );
}
