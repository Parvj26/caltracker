import { describe, expect, it } from 'vitest';
import {
  BODY_AREAS,
  BODY_REGIONS,
  FIGURE_AREAS,
  FIGURE_MUSCLES,
  MUSCLE_GROUPS,
  MUSCLE_IDS,
  bodyRegion,
  isBodyRegionId,
  isMuscleId,
  muscleGroup,
  pinPoints,
  regionBothName,
  regionOnView,
  regionSideLabel,
  regionSideName,
  regionSides,
} from '../../src/index';

describe('muscle catalogue', () => {
  it('lists every muscle id once, in the catalogue order', () => {
    expect(MUSCLE_GROUPS.map((m) => m.id)).toEqual([...MUSCLE_IDS]);
    expect(new Set(BODY_REGIONS.map((r) => r.id)).size).toBe(BODY_REGIONS.length);
  });

  it('keeps ids stable: lower snake case, and the board regions are all there', () => {
    for (const r of BODY_REGIONS) expect(r.id).toMatch(/^[a-z][a-z_]{1,39}$/);
    // The approved boards name these; steps 2 and 3 tag exercises and findings to them.
    for (const id of ['neck', 'hip_flexors', 'tfl', 'glute_medius', 'glute_max', 'adductors', 'calves', 'lats', 'upper_traps', 'mid_lower_traps']) {
      expect(isMuscleId(id)).toBe(true);
    }
    expect(bodyRegion('tfl')?.name).toBe('TFL');
    expect(bodyRegion('hip_flexors')?.name).toBe('Hip flexors');
  });

  it('draws every muscle on at least one view, and only on the views it lists', () => {
    for (const m of MUSCLE_GROUPS) {
      expect(m.views.length).toBeGreaterThan(0);
      for (const view of ['front', 'back'] as const) {
        expect(FIGURE_MUSCLES[view][m.id as keyof (typeof FIGURE_MUSCLES)['front']] !== undefined).toBe(m.views.includes(view));
        expect(regionOnView(m.id, view)).toBe(m.views.includes(view));
      }
    }
  });

  it('gives each body area a tap point, on both views, and keeps areas out of muscle lookups', () => {
    for (const a of BODY_AREAS) {
      expect(FIGURE_AREAS[a.id as keyof typeof FIGURE_AREAS]).toBeDefined();
      expect(regionOnView(a.id, 'front') && regionOnView(a.id, 'back')).toBe(true);
      expect(isMuscleId(a.id)).toBe(false);
      expect(muscleGroup(a.id)).toBeUndefined();
      expect(isBodyRegionId(a.id)).toBe(true);
    }
    expect(isBodyRegionId('spleen')).toBe(false);
    expect(isBodyRegionId(null)).toBe(false);
  });

  it('supports sides: L and R for most, one region for abs', () => {
    expect(regionSides('glute_medius')).toEqual(['L', 'R']);
    expect(regionSides('abs')).toEqual(['none']);
    expect(bodyRegion('neck')?.midline).toBe(true);
    expect(bodyRegion('lower_back')?.midline).toBe(true);
    expect(bodyRegion('knee')?.midline).toBe(false);
  });

  it('names a region on a side', () => {
    expect(regionSideLabel('glute_medius', 'L')).toBe('Glute medius · L');
    expect(regionSideLabel('abs', 'none')).toBe('Abs');
    expect(regionSideName('knee', 'L')).toBe('Left knee');
    expect(regionSideName('tfl', 'R')).toBe('Right TFL');
    expect(regionSideName('hip_flexors', 'R')).toBe('Right hip flexor');
    expect(regionSideName('calves', 'L')).toBe('Left calf');
    expect(regionBothName('calves')).toBe('Both calves');
    expect(regionBothName('knee')).toBe('Both knees');
    expect(regionBothName('foot')).toBe('Both feet');
    expect(regionBothName('glute_medius')).toBe('Both glute medius');
  });
});

describe('pinPoints', () => {
  it('puts the left knee on the viewer’s right on the front and the viewer’s left on the back (as the board)', () => {
    expect(pinPoints('knee', 'L', 'front')).toEqual([{ x: 121, y: 293 }]);
    expect(pinPoints('knee', 'L', 'back')).toEqual([{ x: 79, y: 293 }]);
    expect(pinPoints('knee', 'both', 'front')).toHaveLength(2);
  });

  it('centres a midline flag, and splits a centre flag on a sided region into both sides', () => {
    const [neck] = pinPoints('neck', 'centre', 'front');
    expect(neck!.x).toBe(100);
    expect(neck!.y).toBeGreaterThan(50);
    expect(neck!.y).toBeLessThan(64);
    expect(pinPoints('quads', 'centre', 'front')).toHaveLength(2);
  });

  it('has no pin on a view without the region', () => {
    expect(pinPoints('glute_medius', 'L', 'front')).toEqual([]);
    expect(pinPoints('chest', 'R', 'back')).toEqual([]);
  });
});
