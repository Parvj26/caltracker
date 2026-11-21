import {
  BODY_AREAS,
  MUSCLE_GROUPS,
  pinPoints,
  regionOnView,
  regionSideName,
  viewerLeftSide,
  type BodyRegionId,
  type BodySide,
  type BodyView,
  type ClientFlag,
} from '@caltracker/shared';

/**
 * What the body map shows per region: possibly over-active, possibly under-active, normal, or not marked. Every state
 * has a second cue besides colour (UI rules §2.7): solid red, blue hatching, green with an outline and a tick, grey.
 */
export type MuscleState = 'over' | 'under' | 'normal' | 'unmarked';

/** Keyed `${id}.L` / `${id}.R` (the client's own sides), or `${id}` for a one-piece region (abs) or both sides. */
export type RegionStates = Partial<Record<string, MuscleState>>;

export type RegionSide = BodySide | 'none';

export const regionKey = (id: string, side: RegionSide) => (side === 'none' ? id : `${id}.${side}`);

/** A region's state on one side: its sided key first, then the whole region, else unmarked. */
export function stateOf(states: RegionStates | undefined, id: string, side: RegionSide): MuscleState {
  if (!states) return 'unmarked';
  return states[regionKey(id, side)] ?? states[id] ?? 'unmarked';
}

export type Paint = {
  /** Which fill: a token colour, or the hatching pattern for under. */
  fill: 'over' | 'under' | 'normal' | 'unmarked';
  /** Normal: a dark green outline and a tick on top. */
  outline: boolean;
  tick: boolean;
  /** Words for screen readers and the legend ('' for unmarked). */
  words: string;
};

export function paintFor(state: MuscleState): Paint {
  switch (state) {
    case 'over':
      return { fill: 'over', outline: false, tick: false, words: 'possibly overactive' };
    case 'under':
      return { fill: 'under', outline: false, tick: false, words: 'possibly underactive' };
    case 'normal':
      return { fill: 'normal', outline: true, tick: true, words: 'normal' };
    default:
      return { fill: 'unmarked', outline: false, tick: false, words: '' };
  }
}

/** "Left glute medius, possibly underactive, flag 2". */
export function regionLabel(id: string, side: RegionSide, state: MuscleState, flagNumbers: readonly number[] = []): string {
  const parts = [regionSideName(id, side)];
  const words = paintFor(state).words;
  if (words) parts.push(words);
  if (flagNumbers.length) parts.push(flagNumbers.length === 1 ? `flag ${flagNumbers[0]}` : `flags ${flagNumbers.join(', ')}`);
  return parts.join(', ');
}

export type MapTarget = { id: BodyRegionId; side: RegionSide; kind: 'muscle' | 'area' };

/**
 * The tappable regions of a view, in keyboard order: muscles top to bottom, the viewer's left half before the right,
 * then the body areas (joints). A one-piece region (abs) is one target.
 */
export function mapTargets(view: BodyView, withAreas: boolean): MapTarget[] {
  const left = viewerLeftSide(view);
  const right: BodySide = left === 'L' ? 'R' : 'L';
  const out: MapTarget[] = [];
  for (const m of MUSCLE_GROUPS) {
    if (!regionOnView(m.id, view)) continue;
    if (m.sides === 'none') out.push({ id: m.id, side: 'none', kind: 'muscle' });
    else out.push({ id: m.id, side: left, kind: 'muscle' }, { id: m.id, side: right, kind: 'muscle' });
  }
  if (withAreas) for (const a of BODY_AREAS) out.push({ id: a.id, side: left, kind: 'area' }, { id: a.id, side: right, kind: 'area' });
  return out;
}

export type MapPin = { key: string; label: string; x: number; y: number };

/**
 * Numbered pins for flags on one view: flag n (1-based, in the order given) on each point of its region and side.
 * General flags (no region) and regions not on this view get none.
 */
export function flagPins(flags: readonly Pick<ClientFlag, 'id' | 'region' | 'side'>[], view: BodyView): MapPin[] {
  return flags.flatMap((f, i) =>
    f.region === null ? [] : pinPoints(f.region, f.side, view).map((p, j) => ({ key: `${f.id}-${j}`, label: String(i + 1), x: p.x, y: p.y })),
  );
}

/** Which flag numbers sit on a region and side (for its accessible name). */
export function flagNumbersOn(flags: readonly Pick<ClientFlag, 'region' | 'side'>[], id: string, side: RegionSide): number[] {
  return flags.flatMap((f, i) =>
    f.region === id && (side === 'none' || f.side === side || f.side === 'both' || f.side === 'centre') ? [i + 1] : [],
  );
}
