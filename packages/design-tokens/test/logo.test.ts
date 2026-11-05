import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colors } from '../src/colors';

const svg = readFileSync(join(__dirname, '../assets/logo-mark.svg'), 'utf8');

describe('logo mark', () => {
  it('uses only brand colours: lime tile, ink ring, pink dot', () => {
    const fills = [...svg.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]!.toUpperCase());
    expect(new Set(fills)).toEqual(new Set([colors.light.lime, colors.light.ink, colors.light.pink].map((c) => c.toUpperCase())));
  });

  it('is named CalTracker for screen readers', () => {
    expect(svg).toContain('aria-label="CalTracker"');
  });
});
