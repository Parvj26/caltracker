export const fontFamilies = { sans: 'Bricolage Grotesque', hand: 'Caveat' } as const;

export type TypeRole =
  | 'screenTitle'
  | 'bigNumber'
  | 'sectionHeading'
  | 'body'
  | 'caption'
  | 'button'
  | 'hand';

export interface TypeStyle {
  family: 'sans' | 'hand';
  weight: 500 | 700 | 800;
  size: { phone: number; tablet: number; web: number };
  trackingEm?: number;
  rotateDeg?: number;
  muted?: boolean;
  tabular?: boolean;
}

const same = (n: number) => ({ phone: n, tablet: n, web: n });

export const typeScale: Record<TypeRole, TypeStyle> = {
  screenTitle: { family: 'sans', weight: 800, size: { phone: 22, tablet: 24, web: 24 }, trackingEm: -0.02 },
  bigNumber: { family: 'sans', weight: 800, size: same(26), tabular: true },
  sectionHeading: { family: 'sans', weight: 700, size: same(16) },
  body: { family: 'sans', weight: 500, size: same(15) },
  caption: { family: 'sans', weight: 500, size: same(12), muted: true },
  button: { family: 'sans', weight: 800, size: { phone: 15, tablet: 16, web: 16 }, trackingEm: 0.03 },
  // Coach and app notes: the app font in bold, not handwriting, so they are easy to read (PO, 2026-11-09).
  hand: { family: 'sans', weight: 700, size: same(17) },
};
