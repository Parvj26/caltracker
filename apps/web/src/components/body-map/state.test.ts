import { describe, expect, it } from 'vitest';
import type { ClientFlag } from '@caltracker/shared';
import { flagNumbersOn, flagPins, mapTargets, paintFor, regionKey, regionLabel, stateOf } from './state';

describe('body map state mapping', () => {
  it('gives every state a second cue besides colour', () => {
    expect(paintFor('over')).toEqual({ fill: 'over', outline: false, tick: false, words: 'possibly overactive' });
    expect(paintFor('under')).toEqual({ fill: 'under', outline: false, tick: false, words: 'possibly underactive' });
    expect(paintFor('normal')).toEqual({ fill: 'normal', outline: true, tick: true, words: 'normal' });
    expect(paintFor('unmarked')).toEqual({ fill: 'unmarked', outline: false, tick: false, words: '' });
  });

  it('reads a sided state first, then the whole region, else unmarked', () => {
    const states = { 'glute_medius.L': 'under', calves: 'over' } as const;
    expect(stateOf(states, 'glute_medius', 'L')).toBe('under');
    expect(stateOf(states, 'glute_medius', 'R')).toBe('unmarked');
    expect(stateOf(states, 'calves', 'R')).toBe('over');
    expect(stateOf(undefined, 'calves', 'R')).toBe('unmarked');
    expect(regionKey('abs', 'none')).toBe('abs');
    expect(regionKey('tfl', 'R')).toBe('tfl.R');
  });

  it('names a region for screen readers with its state and flags', () => {
    expect(regionLabel('glute_medius', 'L', 'under')).toBe('Left glute medius, possibly underactive');
    expect(regionLabel('knee', 'L', 'unmarked', [2])).toBe('Left knee, flag 2');
    expect(regionLabel('abs', 'none', 'normal', [1, 3])).toBe('Abs, normal, flags 1, 3');
  });

  it('lists tappable regions per view: front muscles, back muscles, joints only when asked', () => {
    const front = mapTargets('front', false);
    expect(front[0]).toEqual({ id: 'neck', side: 'R', kind: 'muscle' });
    expect(front.find((t) => t.id === 'abs')).toEqual({ id: 'abs', side: 'none', kind: 'muscle' });
    expect(front.some((t) => t.id === 'glute_medius')).toBe(false);
    expect(front.some((t) => t.kind === 'area')).toBe(false);
    const back = mapTargets('back', true);
    expect(back[0]).toEqual({ id: 'neck', side: 'L', kind: 'muscle' });
    expect(back.filter((t) => t.id === 'knee')).toHaveLength(2);
  });

  const f = (id: string, region: ClientFlag['region'], side: ClientFlag['side']) => ({ id, region, side });

  it('numbers flag pins in list order, one per point, and skips General flags', () => {
    const flags = [f('a', 'neck', 'centre'), f('g', null, 'centre'), f('b', 'knee', 'L')];
    const front = flagPins(flags, 'front');
    expect(front.map((p) => p.label)).toEqual(['1', '3']);
    expect(front[0]!.x).toBe(100);
    expect(front[1]).toMatchObject({ x: 121, y: 293 });
    expect(flagPins([f('c', 'glute_medius', 'both')], 'back')).toHaveLength(2);
    expect(flagPins([f('c', 'glute_medius', 'both')], 'front')).toHaveLength(0);
  });

  it('finds the flags on a region side', () => {
    const flags = [f('a', 'knee', 'L'), f('b', 'knee', 'both'), f('c', 'knee', 'R')];
    expect(flagNumbersOn(flags, 'knee', 'L')).toEqual([1, 2]);
    expect(flagNumbersOn(flags, 'knee', 'R')).toEqual([2, 3]);
  });
});
