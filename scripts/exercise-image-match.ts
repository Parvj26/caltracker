// Deterministic matching of library exercises to source exercises that have pictures (no fuzzy guessing: a wrong
// picture is worse than none). Pure; no I/O.

/** Shorthands and spellings that mean the same word. Applied per word after splitting on punctuation. */
const WORD_ALIASES: Record<string, string> = {
  db: 'dumbbell',
  dbs: 'dumbbell',
  bb: 'barbell',
  kb: 'kettlebell',
  kettlebells: 'kettlebell',
  flyes: 'fly',
  flys: 'fly',
  flies: 'fly',
};

/** Two-word forms written as one word ("pull up", "pull-up", "pullups" all become "pullup"). */
const JOINED = ['pull up', 'chin up', 'push up', 'sit up', 'step up', 'pull down', 'push down'];

function singular(word: string): string {
  if (word.length <= 3 || word.endsWith('ss') || word.endsWith('us')) return word;
  if (/(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Lower case, punctuation to spaces, "&" to "and", shorthands expanded, plurals made singular. */
export function normaliseExerciseName(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  s = s
    .split(/\s+/)
    .map((w) => WORD_ALIASES[w] ?? w)
    .map(singular)
    .join(' ');
  for (const pair of JOINED) s = s.replace(new RegExp(`\\b${pair}\\b`, 'g'), pair.replace(' ', ''));
  return s;
}

export interface SourceExercise {
  id: string;
  name: string;
  images: string[];
}

export interface LibraryExercise {
  id: string;
  name: string;
}

export interface AliasTable {
  /** Library exercise id -> source exercise id, each pair checked by a person against the pictures. */
  aliases: Record<string, string>;
  /** What the person saw in the pictures that makes each alias right. Every alias needs one. */
  aliasNotes: Record<string, string>;
  /** Near misses a person looked at and turned down, kept so nobody adds them later by mistake. */
  rejected: { library: string; source: string; reason: string }[];
}

export type MatchKind = 'own' | 'exact' | 'alias';

export interface Match {
  kind: MatchKind;
  sourceId: string;
  images: string[];
}

export interface Unmatched {
  id: string;
  name: string;
  /** Why nothing was used: no candidate, or several equally good ones. */
  reason: 'no-match' | 'ambiguous';
  candidates: string[];
}

export interface MatchResult {
  matches: Record<string, Match>;
  unmatched: Unmatched[];
}

/** Throws on an alias that points at something unknown, has no pictures, or contradicts a rejection. */
export function validateAliases(table: AliasTable, libraryIds: Iterable<string>, sources: SourceExercise[]): void {
  const lib = new Set(libraryIds);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const rejected = new Set(table.rejected.map((r) => `${r.library}\u0000${r.source}`));
  for (const [from, to] of Object.entries(table.aliases)) {
    if (!lib.has(from)) throw new Error(`Alias for unknown library exercise ${from}`);
    const src = byId.get(to);
    if (!src) throw new Error(`Alias ${from} -> unknown source exercise ${to}`);
    if (src.images.length === 0) throw new Error(`Alias ${from} -> ${to}, which has no pictures`);
    if (rejected.has(`${from}\u0000${to}`)) throw new Error(`Alias ${from} -> ${to} is also listed as rejected`);
    if (!table.aliasNotes[from]?.trim()) throw new Error(`Alias ${from} -> ${to} needs a note saying why it is right`);
  }
  for (const r of table.rejected) {
    if (!lib.has(r.library)) throw new Error(`Rejection for unknown library exercise ${r.library}`);
    if (!byId.has(r.source)) throw new Error(`Rejection names unknown source exercise ${r.source}`);
    if (r.reason.trim() === '') throw new Error(`Rejection ${r.library} -> ${r.source} needs a reason`);
  }
}

/**
 * For each library exercise: its own source pictures when it has some, else the alias table, else a source
 * exercise whose normalised name is identical (only when exactly one has pictures). Everything else is unmatched.
 */
export function matchExercises(library: LibraryExercise[], sources: SourceExercise[], table: AliasTable): MatchResult {
  validateAliases(
    table,
    library.map((l) => l.id),
    sources,
  );
  const byId = new Map(sources.map((s) => [s.id, s]));
  const byName = new Map<string, SourceExercise[]>();
  for (const s of sources) {
    if (s.images.length === 0) continue;
    const key = normaliseExerciseName(s.name);
    byName.set(key, [...(byName.get(key) ?? []), s]);
  }

  const matches: Record<string, Match> = {};
  const unmatched: Unmatched[] = [];
  for (const l of library) {
    const own = byId.get(l.id);
    if (own && own.images.length > 0) {
      matches[l.id] = { kind: 'own', sourceId: own.id, images: own.images };
      continue;
    }
    const alias = table.aliases[l.id];
    if (alias) {
      matches[l.id] = { kind: 'alias', sourceId: alias, images: byId.get(alias)!.images };
      continue;
    }
    const same = (byName.get(normaliseExerciseName(l.name)) ?? []).filter((s) => s.id !== l.id);
    if (same.length === 1) {
      matches[l.id] = { kind: 'exact', sourceId: same[0]!.id, images: same[0]!.images };
    } else {
      unmatched.push({ id: l.id, name: l.name, reason: same.length > 1 ? 'ambiguous' : 'no-match', candidates: same.map((s) => s.id) });
    }
  }
  return { matches, unmatched };
}
