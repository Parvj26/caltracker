import type { ColorToken } from './colors';

type Rgba = { r: number; g: number; b: number; a: number };

function parse(input: string): Rgba {
  const s = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = [...h].map((ch) => ch + ch).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  throw new Error(`Unsupported colour: ${input}`);
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio. An alpha foreground is blended onto `bg` first. */
export function contrastRatio(fg: string, bg: string): number {
  const b = parse(bg);
  const f = parse(fg);
  const blended = {
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
  };
  const l1 = luminance(blended);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const pastels = ['lime', 'pink', 'blue', 'drop', 'celebrateBg', 'tape'] as const;
const neutrals = ['bg', 'surface', 'surfaceSidebar'] as const;

export const CONTRAST_PAIRS: ReadonlyArray<{
  fg: ColorToken | 'white';
  bg: ColorToken;
  min: number;
  use: string;
}> = [
  ...neutrals.map((bg) => ({ fg: 'ink' as const, bg, min: 15, use: 'Body text' })),
  ...pastels.map((bg) => ({ fg: 'ink' as const, bg, min: 12, use: 'Text on a pastel tile' })),
  ...neutrals.map((bg) => ({ fg: 'inkMuted' as const, bg, min: 4.5, use: 'Secondary text' })),
  { fg: 'white', bg: 'ink', min: 15, use: 'Label on a primary button' },
  { fg: 'magenta', bg: 'bg', min: 3, use: 'Handwritten notes (large text only)' },
  { fg: 'white', bg: 'magenta', min: 3, use: 'Finish button label (large bold text only)' },
];

