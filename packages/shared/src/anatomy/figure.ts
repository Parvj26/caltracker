import type { BodyAreaId, BodyRegionId, BodySide, BodyView, MuscleId } from './muscles';
import { bodyRegion } from './muscles';

/**
 * The body map's drawing, as plain data (SVG path strings in a 200 × 420 box), so the coach website and the client
 * app draw the same figure. From the approved AS4 / AS9 boards.
 *
 * Every shape is drawn once for the viewer's left half (x < 100) and mirrored (x → 200 − x) for the other half. On
 * the front view the viewer's left is the client's RIGHT; on the back view it is the client's LEFT.
 */

export const FIGURE_WIDTH = 200;
export const FIGURE_HEIGHT = 420;

/** The head: an ellipse above the body. */
export const FIGURE_HEAD = { cx: 100, cy: 28, rx: 15, ry: 19 } as const;

/** Half the body's outline (viewer's left); mirrored for the other half. Regions are clipped to it. */
export const FIGURE_SILHOUETTE =
  'M100.6,49 L93,49 C93,56 92,60 88,62 C80,65 70,66 62,70 C54,74 51,84 51,96 C50,112 49,126 48,140 C47,150 45,158 43,168 C41,182 39,196 37,212 C35,220 33,228 34,236 C36,240 41,240 43,236 C44,228 45,220 46,214 C49,200 53,186 56,172 C58,162 60,150 61,140 C62,128 64,118 66,108 C67,128 69,150 70,168 C68,180 66,192 65,206 C64,232 65,258 68,284 C68,292 67,300 67,310 C67,334 70,358 74,382 C74,390 70,396 68,402 C72,408 84,408 90,404 C90,396 88,388 88,380 C90,358 92,334 92,312 C92,300 92,292 93,286 C95,262 97,240 99,222 L100.6,222 Z';

const DELTS = 'M64,70 C56,73 52,82 52,96 C53,104 55,108 58,110 C60,100 63,92 68,86 C70,80 70,74 64,70 Z';
const UPPER_ARM = 'M60,110 C64,110 65,116 65,126 C64,138 62,148 58,154 C53,152 50,142 50,130 C50,118 54,110 60,110 Z';
const FOREARM = 'M46,158 C52,154 58,156 59,164 C57,180 52,196 46,214 C41,212 38,202 39,190 C40,176 43,166 46,158 Z';

/** Muscle shapes per view, viewer's left half, in drawing order. */
export const FIGURE_MUSCLES: Record<BodyView, Partial<Record<MuscleId, string>>> = {
  front: {
    neck: 'M93.5,50 L99,50 L99,64 C96,64 93,63.5 89,62.5 C91.5,59 93,55 93.5,50 Z',
    chest: 'M70,72 C80,68 92,68 99,70 L99,102 C90,106 78,106 68,100 C67,92 68,82 70,72 Z',
    shoulders: DELTS,
    biceps: UPPER_ARM,
    forearms: FOREARM,
    abs: 'M88.5,108 L99,108 L99,198 L91,198 C89,176 88.5,140 88.5,108 Z',
    obliques: 'M71,106 C77,108 83,110 86,112 C86,138 87,166 87,186 C81,184 75,180 71,176 C72,156 72,130 71,106 Z',
    tfl: 'M67,186 C71,184 75,188 76,196 C75,206 72,214 68,220 C66,210 65,196 67,186 Z',
    hip_flexors: 'M78,190 C84,190 90,196 93,206 C93,212 92,216 90,218 C86,210 81,204 77,200 C77,196 77,193 78,190 Z',
    quads: 'M70,222 C74,208 84,210 89,224 C91,246 88,270 84,286 C78,290 72,286 70,280 C67,262 67,240 70,222 Z',
    adductors: 'M93,224 C96,219 99,218 99,220 L99,228 C98,244 94,262 89,274 C89,256 90,240 93,224 Z',
    shins: 'M70,302 C73,297 77,298 78,304 C78,330 76,356 75,378 C72,376 71,356 70,336 C69,322 69,312 70,302 Z',
    calves: 'M81,298 C88,295 93,306 92,326 C91,342 87,352 82,358 C79,340 78,316 81,298 Z',
  },
  back: {
    neck: 'M93.5,49 L99,49 L99,52 L93.2,51.5 Z',
    upper_traps: 'M93,51 C92,58 86,63 74,67 C82,70 92,74 99,78 L99,51 Z',
    mid_lower_traps: 'M99,81 C92,78 84,75 77,72 C83,88 92,112 99,132 Z',
    rotator_cuff: 'M76,76 C80,84 86,96 89,106 C82,103 76,100 70,97 C69,88 71,80 76,76 Z',
    shoulders: DELTS,
    triceps: UPPER_ARM,
    forearms: FOREARM,
    lats: 'M70,96 C77,100 88,118 96,136 C93,150 84,160 74,168 C71,148 69,122 70,96 Z',
    lower_back: 'M91.5,140 L99,140 L99,192 L92.5,192 C90.5,174 90.5,156 91.5,140 Z',
    glute_medius: 'M68,182 C76,176 87,180 92,190 C84,195 75,199 67,204 C66,196 66,188 68,182 Z',
    glute_max: 'M69,208 C78,198 90,194 99,196 L99,236 C90,242 78,242 70,234 C67,226 67,216 69,208 Z',
    hamstrings: 'M68,244 C78,248 90,248 97,242 C96,262 91,280 86,290 C80,292 74,288 72,282 C68,270 67,256 68,244 Z',
    calves: 'M70,302 C76,294 86,294 90,304 C92,322 88,344 82,356 C76,352 72,342 70,330 C69,320 69,310 70,302 Z',
  },
};

/** Body areas (joints) on both views: a small round tap area, viewer's left half. */
export const FIGURE_AREAS: Record<BodyAreaId, { x: number; y: number; r: number }> = {
  elbow: { x: 57, y: 156, r: 7 },
  wrist: { x: 43, y: 220, r: 6 },
  hip: { x: 68, y: 202, r: 7 },
  knee: { x: 79, y: 293, r: 8 },
  ankle: { x: 79, y: 386, r: 7 },
  foot: { x: 79, y: 402, r: 6 },
};

/** The average of a path's points: where a pin or a tick sits on a region. */
export function pathCentre(d: string): { x: number; y: number } {
  const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  let sx = 0;
  let sy = 0;
  let c = 0;
  for (let i = 0; i + 1 < n.length; i += 2) {
    sx += n[i]!;
    sy += n[i + 1]!;
    c++;
  }
  return c === 0 ? { x: 0, y: 0 } : { x: sx / c, y: sy / c };
}

/** The client's side drawn on the viewer's left half of a view. */
export const viewerLeftSide = (view: BodyView): BodySide => (view === 'front' ? 'R' : 'L');

/** True when the client's `side` is drawn mirrored (the viewer's right half) on this view. */
export const isMirrored = (view: BodyView, side: BodySide): boolean => side !== viewerLeftSide(view);

/** Whether a region is drawn (or can be tapped) on a view. */
export function regionOnView(id: BodyRegionId, view: BodyView): boolean {
  const r = bodyRegion(id);
  if (!r) return false;
  return r.kind === 'area' ? true : FIGURE_MUSCLES[view][id as MuscleId] !== undefined;
}

/**
 * Where a pin goes for a region on a view: one point per side, or one in the middle (x = 100) for 'centre'.
 * Empty when the region is not on that view.
 */
export function pinPoints(id: BodyRegionId, side: BodySide | 'both' | 'centre', view: BodyView): { x: number; y: number }[] {
  if (!regionOnView(id, view)) return [];
  const r = bodyRegion(id)!;
  const base = r.kind === 'area' ? FIGURE_AREAS[id as BodyAreaId] : pathCentre(FIGURE_MUSCLES[view][id as MuscleId]!);
  const at = (s: BodySide) => ({ x: isMirrored(view, s) ? FIGURE_WIDTH - base.x : base.x, y: base.y });
  if (side === 'centre') return r.midline || r.sides === 'none' ? [{ x: FIGURE_WIDTH / 2, y: base.y }] : [at('L'), at('R')];
  if (side === 'both') return [at('L'), at('R')];
  return [at(side)];
}
