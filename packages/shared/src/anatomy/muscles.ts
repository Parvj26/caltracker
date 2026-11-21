/**
 * The muscle-group catalogue and the body areas a coach can flag: one list, with stable ids, shared by the coach
 * website, the client app and the database (client_flags.region, and later assessment findings and exercise tags).
 *
 * Ids are stable forever: never rename or reuse one. A new region gets a new id (and a migration widening the
 * client_flags.region check). Names are what the coach reads ("Glute medius"); the map draws each region on the
 * front, the back or both (figure.ts).
 */

export type BodyView = 'front' | 'back';

/** The client's own left and right (never the viewer's). */
export type BodySide = 'L' | 'R';

export const MUSCLE_IDS = [
  'neck',
  'upper_traps',
  'mid_lower_traps',
  'chest',
  'shoulders',
  'rotator_cuff',
  'lats',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lower_back',
  'hip_flexors',
  'tfl',
  'glute_medius',
  'glute_max',
  'adductors',
  'quads',
  'hamstrings',
  'shins',
  'calves',
] as const;
export type MuscleId = (typeof MUSCLE_IDS)[number];

/** Joints and other places that are not one muscle group, for flags ("Left knee"). Not used by findings. */
export const BODY_AREA_IDS = ['elbow', 'wrist', 'hip', 'knee', 'ankle', 'foot'] as const;
export type BodyAreaId = (typeof BODY_AREA_IDS)[number];

export type BodyRegionId = MuscleId | BodyAreaId;

export type BodyRegion = {
  id: BodyRegionId;
  kind: 'muscle' | 'area';
  /** As the coach reads it, sentence case ("Glute medius", "TFL"). */
  name: string;
  /** For "Both …" ("Both knees"). Defaults to the name in lower case. */
  plural?: string;
  /** One side of it ("Left calf", "Right shoulder"). Defaults to the name. */
  singular?: string;
  /** 'LR': kept per side (findings rate L and R apart). 'none': one region across the middle (abs). */
  sides: 'LR' | 'none';
  /** Crosses the body's middle line, so a flag may sit in the centre ("Neck", "Lower back"). */
  midline: boolean;
  /** The views the map draws it on. */
  views: readonly BodyView[];
};

const FRONT: readonly BodyView[] = ['front'];
const BACK: readonly BodyView[] = ['back'];
const BOTH: readonly BodyView[] = ['front', 'back'];

const muscle = (id: MuscleId, name: string, views: readonly BodyView[], extra: Partial<BodyRegion> = {}): BodyRegion => ({
  id,
  kind: 'muscle',
  name,
  sides: 'LR',
  midline: false,
  views,
  ...extra,
});
const area = (id: BodyAreaId, name: string, plural: string): BodyRegion => ({ id, kind: 'area', name, plural, sides: 'LR', midline: false, views: BOTH });

/** Top to bottom, as the coach scans a body. */
export const MUSCLE_GROUPS: readonly BodyRegion[] = [
  muscle('neck', 'Neck', BOTH, { midline: true }),
  muscle('upper_traps', 'Upper traps', BACK, { singular: 'Upper trap' }),
  muscle('mid_lower_traps', 'Mid/lower traps', BACK, { singular: 'Mid/lower trap' }),
  muscle('chest', 'Chest', FRONT),
  muscle('shoulders', 'Shoulders', BOTH, { singular: 'Shoulder' }),
  muscle('rotator_cuff', 'Rotator cuff', BACK),
  muscle('lats', 'Lats', BACK, { singular: 'Lat' }),
  muscle('biceps', 'Biceps', FRONT),
  muscle('triceps', 'Triceps', BACK),
  muscle('forearms', 'Forearms', BOTH, { singular: 'Forearm' }),
  muscle('abs', 'Abs', FRONT, { sides: 'none', midline: true }),
  muscle('obliques', 'Obliques', FRONT, { singular: 'Oblique' }),
  muscle('lower_back', 'Lower back', BACK, { midline: true }),
  muscle('hip_flexors', 'Hip flexors', FRONT, { singular: 'Hip flexor' }),
  muscle('tfl', 'TFL', FRONT),
  muscle('glute_medius', 'Glute medius', BACK),
  muscle('glute_max', 'Glute max', BACK),
  muscle('adductors', 'Adductors', FRONT, { singular: 'Adductor' }),
  muscle('quads', 'Quads', FRONT, { singular: 'Quad' }),
  muscle('hamstrings', 'Hamstrings', BACK, { singular: 'Hamstring' }),
  muscle('shins', 'Shins', FRONT, { singular: 'Shin' }),
  muscle('calves', 'Calves', BOTH, { singular: 'Calf' }),
];

export const BODY_AREAS: readonly BodyRegion[] = [
  area('elbow', 'Elbow', 'elbows'),
  area('wrist', 'Wrist', 'wrists'),
  area('hip', 'Hip', 'hips'),
  area('knee', 'Knee', 'knees'),
  area('ankle', 'Ankle', 'ankles'),
  area('foot', 'Foot', 'feet'),
];

/** Every region a flag can point at: muscle groups first, then body areas. */
export const BODY_REGIONS: readonly BodyRegion[] = [...MUSCLE_GROUPS, ...BODY_AREAS];

const BY_ID = new Map<string, BodyRegion>(BODY_REGIONS.map((r) => [r.id, r]));

export const isMuscleId = (id: unknown): id is MuscleId => typeof id === 'string' && (MUSCLE_IDS as readonly string[]).includes(id);
export const isBodyRegionId = (id: unknown): id is BodyRegionId => typeof id === 'string' && BY_ID.has(id);

/** The region for an id, or undefined for an unknown one (an id from a newer app version, say). */
export function bodyRegion(id: string): BodyRegion | undefined {
  return BY_ID.get(id);
}

/** The muscle group for an id, or undefined (body areas are not muscle groups). */
export function muscleGroup(id: string): BodyRegion | undefined {
  const r = BY_ID.get(id);
  return r?.kind === 'muscle' ? r : undefined;
}

/** The sides a region is kept on: ['L', 'R'] or ['none']. */
export function regionSides(id: BodyRegionId): readonly ('L' | 'R' | 'none')[] {
  return BY_ID.get(id)?.sides === 'none' ? ['none'] : ['L', 'R'];
}

const lowerFirst = (name: string) => (/^[A-Z]{2,}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1));

/** "Glute medius · L", "Abs": the short label of one region on one side, as the map's picker heads it. */
export function regionSideLabel(id: string, side: BodySide | 'none'): string {
  const name = BY_ID.get(id)?.name ?? 'Unknown';
  return side === 'none' ? name : `${name} · ${side}`;
}

/** "Left glute medius", "Right knee": the accessible name of a region on one side. */
export function regionSideName(id: string, side: BodySide | 'none'): string {
  const r = BY_ID.get(id);
  const name = r?.name ?? 'Unknown';
  if (side === 'none') return name;
  return `${side === 'L' ? 'Left' : 'Right'} ${lowerFirst(r?.singular ?? name)}`;
}

/** "Both knees", "Both glute medius". */
export function regionBothName(id: string): string {
  const r = BY_ID.get(id);
  return `Both ${r?.plural ?? lowerFirst(r?.name ?? 'sides')}`;
}
