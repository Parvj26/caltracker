import { EXERCISE_ALIASES, EXERCISE_NAME_SYNONYMS } from './aliases';
import { COMMON_EXERCISES } from './popular';
import { EXERCISE_OTHER_NAMES } from './synonyms';
import { toTrackingType } from './tracking';
import type { TrackingType } from './tracking';
import {
  EXACT,
  OTHER,
  TYPO,
  buildQueryTable as buildTable,
  highlightRanges as rangesFor,
  makeVocab,
  matchWordIn as matchWord,
  nameEntry,
  normalizeSearchText,
  otherWordIds,
} from '../search/smart-search';
import type { NameWord, QueryTable } from '../search/smart-search';

export { normalizeSearchText } from '../search/smart-search';

export { EXERCISE_ALIASES } from './aliases';
export { COMMON_EXERCISES } from './popular';
export { EXERCISE_OTHER_NAMES } from './synonyms';

export type ExerciseIndexRow = {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string | null;
  category: string | null;
  trackingType: TrackingType;
  source: 'builtin' | 'custom';
  imagePath: string | null;
};

export type MuscleChip = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Legs' | 'Glutes' | 'Core' | 'Full body';
export type EquipmentChip =
  | 'Barbell'
  | 'Dumbbell'
  | 'Cable'
  | 'Machine'
  | 'Kettlebell'
  | 'Bodyweight'
  | 'Band'
  | 'Other';

/** The filter chips, in the order the pickers show them. */
export const MUSCLE_CHIPS: readonly MuscleChip[] = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core', 'Full body'];
export const EQUIPMENT_CHIPS: readonly EquipmentChip[] = [
  'Barbell',
  'Dumbbell',
  'Cable',
  'Machine',
  'Kettlebell',
  'Bodyweight',
  'Band',
  'Other',
];

/** The `exercises` columns an index row needs (pass to `.select()`). */
export const EXERCISE_INDEX_COLUMNS =
  'id, name, primary_muscles, secondary_muscles, equipment, category, tracking_type, source, image_paths' as const;

/** One `exercises` row as selected with EXERCISE_INDEX_COLUMNS. */
export type ExerciseIndexDbRow = {
  id: string;
  name: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string | null;
  category: string | null;
  tracking_type: TrackingType;
  source: string;
  image_paths: string[];
};

/** A database row as the search index wants it: anything not custom is a built-in; only the first photo is kept. */
export function exerciseIndexRowFromDb(e: ExerciseIndexDbRow): ExerciseIndexRow {
  return {
    id: e.id,
    name: e.name,
    primaryMuscles: e.primary_muscles,
    secondaryMuscles: e.secondary_muscles,
    equipment: e.equipment,
    category: e.category,
    // A type this build doesn't know (a newer server's) reads as the fallback, so the picker and the log never crash.
    trackingType: toTrackingType(e.tracking_type),
    source: e.source === 'custom' ? 'custom' : 'builtin',
    imagePath: e.image_paths[0] ?? null,
  };
}

export type SearchFilters = { muscles: MuscleChip[]; equipment: EquipmentChip[]; customOnly: boolean };
export type SearchBoosts = { favourites: ReadonlySet<string>; recent: readonly string[] };
export type SearchHit = {
  row: ExerciseIndexRow;
  /** 0 = empty-query listing. */
  tier: 1 | 2 | 3 | 4 | 5 | 0;
  /** Ranges in row.name. Empty when the match was through an other name. */
  highlight: Array<[start: number, end: number]>;
  /** The "also known as" name that matched, when it ranked better than the real name. */
  alias?: string;
};

/** Precomputed search data for one row. Opaque to callers. */
export type IndexEntry = {
  row: ExerciseIndexRow;
  /** Null for the real name; otherwise the "also known as" name this entry searches as (built-ins only). */
  alias: string | null;
  /** Words of the real name, or of `alias`. */
  words: NameWord[];
  /** Normalised name, words joined by single spaces. */
  nameNorm: string;
  /** `nameNorm` without a leading equipment word ("barbell squat" -> "squat"), so plain queries rank plain names first. */
  plainNorm: string;
  /** Name words with no spaces, for "benchpress" style queries. */
  joined: string;
  /** For each character of `joined`, the index of the name word it belongs to. */
  joinedWord: number[];
  /** Muscle, equipment and category words (raw and stemmed), as vocabulary ids. */
  other: number[];
  muscleChips: Set<MuscleChip>;
  equipmentChip: EquipmentChip;
  /** Position in COMMON_EXERCISES (built-ins only); lower is more common, unlisted rows share the last place. */
  popularity: number;
};

/** `entries` holds one entry per row (the real name) plus one per "also known as" name of a built-in. */
export type ExerciseIndex = { rows: ExerciseIndexRow[]; entries: IndexEntry[]; vocab: string[] };

/** Muscle names in the library (free-exercise-db) grouped under the filter chips. */
export const MUSCLE_CHIP_MUSCLES: Readonly<Record<MuscleChip, readonly string[]>> = {
  Chest: ['chest'],
  Back: ['lats', 'middle back', 'lower back', 'traps'],
  // The full free-exercise-db also has "neck"; it sits with the shoulders.
  Shoulders: ['shoulders', 'neck'],
  Arms: ['biceps', 'triceps', 'forearms'],
  Legs: ['quadriceps', 'hamstrings', 'calves', 'adductors', 'abductors'],
  Glutes: ['glutes'],
  Core: ['abdominals'],
  // Decided by category or muscle count, not by muscle name.
  'Full body': [],
};

const POPULARITY = new Map<string, number>(COMMON_EXERCISES.map((name, i) => [name, i]));
const UNLISTED = COMMON_EXERCISES.length;

const MUSCLE_TO_CHIP = new Map<string, MuscleChip>();
for (const [chip, muscles] of Object.entries(MUSCLE_CHIP_MUSCLES) as Array<[MuscleChip, readonly string[]]>) {
  for (const m of muscles) MUSCLE_TO_CHIP.set(m, chip);
}

/** The muscle chips of these muscles (an exercise's primary muscles, say), once each, in MUSCLE_CHIPS order. */
export function muscleChipsOf(muscles: readonly string[]): MuscleChip[] {
  const found = new Set<MuscleChip>();
  for (const m of muscles) {
    const chip = MUSCLE_TO_CHIP.get(m);
    if (chip) found.add(chip);
  }
  return MUSCLE_CHIPS.filter((c) => found.has(c));
}

export function equipmentChipOf(equipment: string | null): EquipmentChip {
  switch (equipment) {
    case 'barbell':
    case 'e-z curl bar':
      return 'Barbell';
    case 'dumbbell':
      return 'Dumbbell';
    case 'cable':
      return 'Cable';
    case 'machine':
      return 'Machine';
    case 'kettlebells':
      return 'Kettlebell';
    case 'body only':
      return 'Bodyweight';
    case 'bands':
      return 'Band';
    default:
      return 'Other';
  }
}

const LEADING_EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'smith machine', 'ez bar', 'band', 'bodyweight'];

function withoutLeadingEquipment(nameNorm: string): string {
  for (const e of LEADING_EQUIPMENT) {
    if (nameNorm.startsWith(`${e} `)) return nameNorm.slice(e.length + 1);
  }
  return nameNorm;
}

export function buildExerciseIndex(rows: ExerciseIndexRow[]): ExerciseIndex {
  const { vocab, intern } = makeVocab();
  const entryFor = (row: ExerciseIndexRow, alias: string | null): IndexEntry => {
    const name = alias ?? row.name;
    const { words, nameNorm, joined, joinedWord } = nameEntry(name, intern, EXERCISE_NAME_SYNONYMS);
    const equipmentChip = equipmentChipOf(row.equipment);
    const other = otherWordIds(
      [...row.primaryMuscles, ...row.secondaryMuscles, row.equipment ?? '', row.category ?? '', equipmentChip],
      intern,
    );

    const muscleChips = new Set<MuscleChip>(muscleChipsOf(row.primaryMuscles));
    if (row.category === 'strongman' || row.primaryMuscles.length + row.secondaryMuscles.length >= 4) {
      muscleChips.add('Full body');
    }

    return {
      row,
      alias,
      words,
      nameNorm,
      plainNorm: withoutLeadingEquipment(nameNorm),
      joined,
      joinedWord,
      other,
      muscleChips,
      equipmentChip,
      popularity: row.source === 'builtin' ? (POPULARITY.get(row.name) ?? UNLISTED) : UNLISTED,
    };
  };
  const entries: IndexEntry[] = [];
  for (const row of rows) {
    entries.push(entryFor(row, null));
    // Other names belong to the library exercise: a custom exercise that shares its name does not get them.
    const others = row.source === 'builtin' && Object.hasOwn(EXERCISE_OTHER_NAMES, row.name) ? EXERCISE_OTHER_NAMES[row.name] : undefined;
    if (others) for (const alias of others) entries.push(entryFor(row, alias));
  }
  return { rows, entries, vocab };
}

/* ---------- matching ---------- */

type Group = { alts: string[][] };

function buildGroups(tokens: string[]): { groups: Group[]; expanded: string } {
  const groups: Group[] = [];
  const expandedParts: string[] = [];
  for (const t of tokens) {
    const alias = Object.hasOwn(EXERCISE_ALIASES, t) ? EXERCISE_ALIASES[t] : undefined;
    const expansion = alias ? normalizeSearchText(alias).split(' ') : null;
    groups.push({ alts: expansion ? [[t], expansion] : [[t]] });
    expandedParts.push(expansion ? expansion.join(' ') : t);
  }
  return { groups, expanded: expandedParts.join(' ') };
}

const COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });

/** A to Z ignoring case and accents, so "Étirement" sorts with the Es. */
function compareNames(a: string, b: string): number {
  return COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function passesFilters(e: IndexEntry, f: SearchFilters): boolean {
  if (f.customOnly && e.row.source !== 'custom') return false;
  if (f.muscles.length > 0 && !f.muscles.some((c) => e.muscleChips.has(c))) return false;
  if (f.equipment.length > 0 && !f.equipment.includes(e.equipmentChip)) return false;
  return true;
}

export function searchExercises(
  index: ExerciseIndex,
  query: string,
  filters: SearchFilters,
  boosts: SearchBoosts,
): SearchHit[] {
  const recentRank = new Map<string, number>();
  boosts.recent.forEach((id, i) => {
    if (!recentRank.has(id)) recentRank.set(id, i);
  });
  const boostCompare = (a: ExerciseIndexRow, b: ExerciseIndexRow): number => {
    const fa = boosts.favourites.has(a.id) ? 0 : 1;
    const fb = boosts.favourites.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ra = recentRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = recentRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  };

  const candidates = index.entries.filter((e) => passesFilters(e, filters));
  const normQuery = normalizeSearchText(query);

  if (normQuery === '') {
    // Nothing typed: favourites, then recent exercises, then the popular library exercises (COMMON_EXERCISES
    // order), then everything else A to Z. Each row appears once (other names are left out).
    return candidates
      .filter((e) => e.alias === null)
      .sort((a, b) => boostCompare(a.row, b.row) || a.popularity - b.popularity || compareNames(a.row.name, b.row.name))
      .map((e): SearchHit => ({ row: e.row, tier: 0, highlight: [] }));
  }

  const tokens = normQuery.split(' ');
  const { groups, expanded } = buildGroups(tokens);
  const tables = new Map<string, QueryTable>();
  for (const g of groups) for (const alt of g.alts) for (const q of alt) if (!tables.has(q)) tables.set(q, buildTable(index.vocab, q));
  const scored: Array<{ hit: SearchHit; e: IndexEntry; boost: number; whole: number; full: number; viaAlias: number }> = [];

  for (const e of candidates) {
    let worst = EXACT;
    const lit = new Set<number>();
    let ok = true;

    for (const g of groups) {
      let bestKind = Infinity;
      let bestWords: number[] = [];
      for (const alt of g.alts) {
        let altKind = EXACT;
        const altWords: number[] = [];
        let altOk = true;
        for (const q of alt) {
          const m = matchWord(e, tables.get(q) as QueryTable);
          if (!m) {
            altOk = false;
            break;
          }
          if (m.kind > altKind) altKind = m.kind;
          if (m.word === 'joined' && m.joinedRange) {
            for (let i = m.joinedRange[0]; i <= m.joinedRange[1]; i++) altWords.push(i);
          } else if (typeof m.word === 'number') {
            altWords.push(m.word);
          }
        }
        if (altOk && altKind < bestKind) {
          bestKind = altKind;
          bestWords = altWords;
        }
      }
      if (bestKind === Infinity) {
        ok = false;
        break;
      }
      if (bestKind > worst) worst = bestKind;
      for (const w of bestWords) lit.add(w);
    }
    if (!ok) continue;

    let tier: 1 | 2 | 3 | 4 | 5;
    if (worst === OTHER) tier = 5;
    else if (worst === TYPO) tier = 4;
    else if (e.nameNorm === normQuery || e.nameNorm === expanded || e.plainNorm === normQuery || e.plainNorm === expanded) tier = 1;
    else if (
      e.nameNorm.startsWith(normQuery) || e.nameNorm.startsWith(expanded) ||
      e.plainNorm.startsWith(normQuery) || e.plainNorm.startsWith(expanded)
    ) tier = 2;
    else tier = 3;

    const fav = boosts.favourites.has(e.row.id) ? 0 : 1;
    const rec = recentRank.get(e.row.id) ?? Number.MAX_SAFE_INTEGER;
    const hit: SearchHit = e.alias === null ? { row: e.row, tier, highlight: rangesFor(e, lit) } : { row: e.row, tier, highlight: [], alias: e.alias };
    scored.push({ hit, e, boost: fav * 1e9 + Math.min(rec, 1e9 - 1), whole: worst === EXACT ? 0 : 1, full: e.nameNorm === normQuery || e.nameNorm === expanded ? 0 : 1, viaAlias: e.alias === null ? 0 : 1 });
  }

  scored.sort(
    (a, b) =>
      a.hit.tier - b.hit.tier ||
      a.whole - b.whole ||
      // The whole name typed beats a name that matches only without its equipment word
      // ("bench press": the other name "Bench Press" beats "Machine Bench Press").
      a.full - b.full ||
      // The coach's favourites, then their recent exercises.
      a.boost - b.boost ||
      // Then the exercises most coaches mean ("bench": Barbell Bench Press before Bench Dips).
      a.e.popularity - b.e.popularity ||
      // A real name beats an other name that matches just as well.
      a.viaAlias - b.viaAlias ||
      a.e.row.name.length - b.e.row.name.length ||
      compareNames(a.e.row.name, b.e.row.name),
  );
  // A row can match through its real name and its other names: keep only its best placed hit.
  const seen = new Set<ExerciseIndexRow>();
  const out: SearchHit[] = [];
  for (const x of scored) {
    if (seen.has(x.e.row)) continue;
    seen.add(x.e.row);
    out.push(x.hit);
  }
  return out;
}
