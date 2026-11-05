import { EXERCISE_ALIASES, EXERCISE_NAME_SYNONYMS } from './aliases';
import type { TrackingType } from './tracking';

export { EXERCISE_ALIASES } from './aliases';

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

export type SearchFilters = { muscles: MuscleChip[]; equipment: EquipmentChip[]; customOnly: boolean };
export type SearchBoosts = { favourites: ReadonlySet<string>; recent: readonly string[] };
export type SearchHit = {
  row: ExerciseIndexRow;
  /** 0 = empty-query listing. */
  tier: 1 | 2 | 3 | 4 | 5 | 0;
  /** Ranges in row.name. */
  highlight: Array<[start: number, end: number]>;
};

/** `forms` are ids into the index vocabulary. */
type NameWord = { start: number; end: number; forms: number[] };

/** Precomputed search data for one row. Opaque to callers. */
export type IndexEntry = {
  row: ExerciseIndexRow;
  words: NameWord[];
  /** Normalised name, words joined by single spaces. */
  nameNorm: string;
  /** Name words with no spaces, for "benchpress" style queries. */
  joined: string;
  /** For each character of `joined`, the index of the name word it belongs to. */
  joinedWord: number[];
  /** Muscle, equipment and category words (raw and stemmed), as vocabulary ids. */
  other: number[];
  muscleChips: Set<MuscleChip>;
  equipmentChip: EquipmentChip;
  nameLower: string;
};

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

const MUSCLE_TO_CHIP = new Map<string, MuscleChip>();
for (const [chip, muscles] of Object.entries(MUSCLE_CHIP_MUSCLES) as Array<[MuscleChip, readonly string[]]>) {
  for (const m of muscles) MUSCLE_TO_CHIP.set(m, chip);
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

export function normalizeSearchText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Light plural and verb ending stripper: curls -> curl, squatting -> squat, flies -> fly. */
function stem(w: string): string {
  const undouble = (x: string) => {
    const a = x.charAt(x.length - 1);
    return x.length >= 4 && a === x.charAt(x.length - 2) && !'lsz'.includes(a) ? x.slice(0, -1) : x;
  };
  if (w.length >= 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length - 3 >= 3) return undouble(w.slice(0, -3));
  if (w.endsWith('ed') && w.length - 2 >= 3) return undouble(w.slice(0, -2));
  if (/(ss|sh|ch|x|z)es$/.test(w) && w.length - 2 >= 3) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length - 1 >= 3) return w.slice(0, -1);
  return w;
}

function formsOf(word: string): string[] {
  const s = stem(word);
  return s === word ? [word] : [word, s];
}

/** Words of `name` with their ranges in the original string (offsets stay valid). */
function tokenizeWithRanges(name: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let text = '';
  let start = -1;
  let i = 0;
  for (const ch of name) {
    const n = ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
    const isWord = n.length > 0 && /^[\p{L}\p{N}]+$/u.test(n);
    if (isWord) {
      if (start < 0) start = i;
      text += n;
    } else if (start >= 0) {
      out.push({ text, start, end: i });
      text = '';
      start = -1;
    }
    i += ch.length;
  }
  if (start >= 0) out.push({ text, start, end: i });
  return out;
}

export function buildExerciseIndex(rows: ExerciseIndexRow[]): ExerciseIndex {
  const vocab: string[] = [];
  const vocabId = new Map<string, number>();
  const intern = (f: string): number => {
    let id = vocabId.get(f);
    if (id === undefined) {
      id = vocab.length;
      vocab.push(f);
      vocabId.set(f, id);
    }
    return id;
  };
  const entries = rows.map((row): IndexEntry => {
    const words: NameWord[] = tokenizeWithRanges(row.name).map((t) => {
      const forms = formsOf(t.text);
      const synonym = EXERCISE_NAME_SYNONYMS[t.text];
      if (synonym) forms.push(...formsOf(synonym));
      return { start: t.start, end: t.end, forms: forms.map(intern) };
    });
    let joined = '';
    const joinedWord: number[] = [];
    const nameWords = tokenizeWithRanges(row.name);
    nameWords.forEach((t, wi) => {
      joined += t.text;
      for (let k = 0; k < t.text.length; k++) joinedWord.push(wi);
    });

    const other = new Set<number>();
    const equipmentChip = equipmentChipOf(row.equipment);
    const texts = [...row.primaryMuscles, ...row.secondaryMuscles, row.equipment ?? '', row.category ?? '', equipmentChip];
    for (const text of texts) {
      for (const w of normalizeSearchText(text).split(' ')) {
        if (w) for (const f of formsOf(w)) other.add(intern(f));
      }
    }

    const muscleChips = new Set<MuscleChip>();
    for (const m of row.primaryMuscles) {
      const chip = MUSCLE_TO_CHIP.get(m);
      if (chip) muscleChips.add(chip);
    }
    if (row.category === 'strongman' || row.primaryMuscles.length + row.secondaryMuscles.length >= 4) {
      muscleChips.add('Full body');
    }

    return {
      row,
      words,
      nameNorm: nameWords.map((t) => t.text).join(' '),
      joined,
      joinedWord,
      other: [...other],
      muscleChips,
      equipmentChip,
      nameLower: row.name.toLowerCase(),
    };
  });
  return { rows, entries, vocab };
}

/* ---------- matching ---------- */

// Lower is better.
const EXACT = 0;
const PREFIX = 1;
const TYPO = 2;
const OTHER = 3;

type Match = { kind: number; word: number | 'joined' | null; joinedRange?: [number, number] };

/** Damerau-Levenshtein (restricted) distance, giving up above `max`. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, (prev2[j - 2] ?? 0) + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev2 = prev;
    prev = cur;
  }
  return (prev[m] ?? max + 1) <= max;
}

function typoBudget(len: number): number {
  return len >= 8 ? 2 : len >= 5 ? 1 : 0;
}

/** How one query word relates to every vocabulary form, computed once per query. */
type QueryTable = { q: string; name: Int8Array; other: Int8Array };
const NONE = 9;

function buildTable(vocab: string[], q: string): QueryTable {
  const qForms = formsOf(q);
  const name = new Int8Array(vocab.length).fill(NONE);
  const other = new Int8Array(vocab.length).fill(NONE);
  const typoOk = q.length >= 5;
  for (let v = 0; v < vocab.length; v++) {
    const f = vocab[v] as string;
    let kind = NONE;
    for (let a = 0; a < qForms.length; a++) {
      const qf = qForms[a] as string;
      if (f === qf) {
        kind = EXACT;
        break;
      }
      if (f.startsWith(qf)) kind = PREFIX;
    }
    if (kind === NONE && typoOk && withinEdits(q, f, typoBudget(Math.max(q.length, f.length)))) kind = TYPO;
    name[v] = kind;
    if (kind === EXACT || (q.length >= 3 && kind === PREFIX)) other[v] = OTHER;
    else if (qForms.includes(f)) other[v] = OTHER;
  }
  return { q, name, other };
}

function matchWord(e: IndexEntry, t: QueryTable): Match | null {
  const words = e.words;
  let bestKind = NONE;
  let bestWord = -1;
  for (let i = 0; i < words.length; i++) {
    const forms = (words[i] as NameWord).forms;
    for (let b = 0; b < forms.length; b++) {
      const k = t.name[forms[b] as number] as number;
      if (k < bestKind) {
        bestKind = k;
        bestWord = i;
        if (k === EXACT) return { kind: EXACT, word: i };
      }
    }
  }
  if (bestKind === PREFIX) return { kind: PREFIX, word: bestWord };
  const q = t.q;
  if (q.length >= 5) {
    const at = e.joined.indexOf(q);
    if (at >= 0) {
      const first = e.joinedWord[at];
      const last = e.joinedWord[at + q.length - 1];
      if (first !== undefined && last !== undefined && first !== last) {
        return { kind: PREFIX, word: 'joined', joinedRange: [first, last] };
      }
    }
  }
  if (bestKind === TYPO) return { kind: TYPO, word: bestWord };
  for (let i = 0; i < e.other.length; i++) {
    if (t.other[e.other[i] as number] === OTHER) return { kind: OTHER, word: null };
  }
  return null;
}

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

/** Cheap A to Z (localeCompare is too slow to sort thousands of hits per keystroke). */
function compareNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

function passesFilters(e: IndexEntry, f: SearchFilters): boolean {
  if (f.customOnly && e.row.source !== 'custom') return false;
  if (f.muscles.length > 0 && !f.muscles.some((c) => e.muscleChips.has(c))) return false;
  if (f.equipment.length > 0 && !f.equipment.includes(e.equipmentChip)) return false;
  return true;
}

function rangesFor(e: IndexEntry, wordIdx: Set<number>): Array<[number, number]> {
  return [...wordIdx]
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const w = e.words[i];
      return w ? [[w.start, w.end] as [number, number]] : [];
    });
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
    return candidates
      .map((e): SearchHit => ({ row: e.row, tier: 0, highlight: [] }))
      .sort((a, b) => boostCompare(a.row, b.row) || compareNames(a.row.name, b.row.name));
  }

  const tokens = normQuery.split(' ');
  const { groups, expanded } = buildGroups(tokens);
  const tables = new Map<string, QueryTable>();
  for (const g of groups) for (const alt of g.alts) for (const q of alt) if (!tables.has(q)) tables.set(q, buildTable(index.vocab, q));
  const scored: Array<{ hit: SearchHit; e: IndexEntry; boost: number }> = [];

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
    else if (e.nameNorm === normQuery || e.nameNorm === expanded) tier = 1;
    else if (e.nameNorm.startsWith(normQuery) || e.nameNorm.startsWith(expanded)) tier = 2;
    else tier = 3;

    const fav = boosts.favourites.has(e.row.id) ? 0 : 1;
    const rec = recentRank.get(e.row.id) ?? Number.MAX_SAFE_INTEGER;
    scored.push({ hit: { row: e.row, tier, highlight: rangesFor(e, lit) }, e, boost: fav * 1e9 + Math.min(rec, 1e9 - 1) });
  }

  scored.sort(
    (a, b) =>
      a.hit.tier - b.hit.tier ||
      a.boost - b.boost ||
      a.e.row.name.length - b.e.row.name.length ||
      (a.e.nameLower < b.e.nameLower ? -1 : a.e.nameLower > b.e.nameLower ? 1 : compareNames(a.e.row.name, b.e.row.name)),
  );
  return scored.map((x) => x.hit);
}
