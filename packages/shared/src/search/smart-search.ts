/**
 * The search engine behind every name search in the app (exercises, meals): typo-tolerant, partial words, any word
 * order, light stemming ("eggs" finds "Egg"), accents and case ignored. Ranked exact (1) -> starts-with (2) ->
 * contains (3) -> typo (4) -> matched only through extra words (5). Callers add their own boosts within a tier.
 */

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

/** The word and its stem (when different). */
export function formsOf(word: string): string[] {
  const s = stem(word);
  return s === word ? [word] : [word, s];
}

/** Words of `name` with their ranges in the original string (offsets stay valid). */
export function tokenizeWithRanges(name: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let text = '';
  let start = -1;
  let i = 0;
  for (const ch of name) {
    if (start >= 0 && /^\p{M}+$/u.test(ch)) {
      // A combining mark right after a letter (decomposed accent) belongs to that word.
      i += ch.length;
      continue;
    }
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

/* ---------- vocabulary and entries ---------- */

/** `forms` are ids into the index vocabulary. */
export type NameWord = { start: number; end: number; forms: number[] };

/** What matching needs from one searchable name. */
export type MatchableEntry = {
  /** Words of the name. */
  words: NameWord[];
  /** Normalised name, words joined by single spaces. */
  nameNorm: string;
  /** Name words with no spaces, for "benchpress" style queries. */
  joined: string;
  /** For each character of `joined`, the index of the name word it belongs to. */
  joinedWord: number[];
  /** Extra words (raw and stemmed) that match at the lowest tier, as vocabulary ids. */
  other: number[];
};

/** Interns word forms into one vocabulary so a query word is compared with each distinct form once. */
export function makeVocab(): { vocab: string[]; intern: (f: string) => number } {
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
  return { vocab, intern };
}

/** The name part of an entry. A name word found in `synonyms` also matches as the synonym. */
export function nameEntry(
  name: string,
  intern: (f: string) => number,
  synonyms?: Readonly<Record<string, string>>,
): Omit<MatchableEntry, 'other'> {
  const tokens = tokenizeWithRanges(name);
  const words: NameWord[] = tokens.map((t) => {
    const forms = formsOf(t.text);
    const synonym = synonyms && Object.hasOwn(synonyms, t.text) ? synonyms[t.text] : undefined;
    if (synonym) forms.push(...formsOf(synonym));
    return { start: t.start, end: t.end, forms: forms.map(intern) };
  });
  let joined = '';
  const joinedWord: number[] = [];
  tokens.forEach((t, wi) => {
    joined += t.text;
    for (let k = 0; k < t.text.length; k++) joinedWord.push(wi);
  });
  return { words, nameNorm: tokens.map((t) => t.text).join(' '), joined, joinedWord };
}

/** Vocabulary ids for extra words (each normalised, split and stemmed). */
export function otherWordIds(texts: readonly string[], intern: (f: string) => number): number[] {
  const other = new Set<number>();
  for (const text of texts) {
    for (const w of normalizeSearchText(text).split(' ')) {
      if (w) for (const f of formsOf(w)) other.add(intern(f));
    }
  }
  return [...other];
}

/* ---------- matching ---------- */

// Lower is better.
export const EXACT = 0;
export const PREFIX = 1;
export const TYPO = 2;
export const OTHER = 3;

export type WordMatch = { kind: number; word: number | 'joined' | null; joinedRange?: [number, number] };

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
export type QueryTable = { q: string; name: Int8Array; other: Int8Array };
const NONE = 9;

export function buildQueryTable(vocab: readonly string[], q: string): QueryTable {
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
      // A stem is a weak guess ("spring" -> "spr"): use it as a prefix only when it has 4+ letters.
      if (f.startsWith(qf) && (qf === q || qf.length >= 4)) kind = PREFIX;
    }
    if (kind === NONE && typoOk && withinEdits(q, f, typoBudget(Math.max(q.length, f.length)))) kind = TYPO;
    name[v] = kind;
    if (kind === EXACT || (q.length >= 3 && kind === PREFIX)) other[v] = OTHER;
    else if (qForms.includes(f)) other[v] = OTHER;
  }
  return { q, name, other };
}

/** The best way one query word matches an entry, or null. */
export function matchWordIn(e: MatchableEntry, t: QueryTable): WordMatch | null {
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
    // The join must start at the beginning of a name word ("bellc" must not find "Barbell Curl").
    for (let at = e.joined.indexOf(q); at >= 0; at = e.joined.indexOf(q, at + 1)) {
      const first = e.joinedWord[at];
      const last = e.joinedWord[at + q.length - 1];
      if (first === undefined || last === undefined || first === last) continue;
      if (at > 0 && e.joinedWord[at - 1] === first) continue;
      return { kind: PREFIX, word: 'joined', joinedRange: [first, last] };
    }
  }
  if (bestKind === TYPO) return { kind: TYPO, word: bestWord };
  for (let i = 0; i < e.other.length; i++) {
    if (t.other[e.other[i] as number] === OTHER) return { kind: OTHER, word: null };
  }
  return null;
}

/** Name ranges of the given word indexes, in order. */
export function highlightRanges(e: MatchableEntry, wordIdx: ReadonlySet<number>): Array<[number, number]> {
  return [...wordIdx]
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const w = e.words[i];
      return w ? [[w.start, w.end] as [number, number]] : [];
    });
}

/* ---------- the generic index ---------- */

export type SmartDoc = {
  name: string;
  /** Words that match only at tier 5 (e.g. muscles of an exercise). */
  extraWords?: readonly string[];
  /** Name word -> another word it also matches as. */
  synonyms?: Readonly<Record<string, string>>;
};
export type SmartEntry<T> = MatchableEntry & { item: T };
export type SmartIndex<T> = { items: T[]; entries: SmartEntry<T>[]; vocab: string[] };
export type SmartHit<T> = { item: T; tier: 1 | 2 | 3 | 4 | 5; highlight: Array<[number, number]> };

export function buildSmartIndex<T>(items: readonly T[], doc: (item: T) => SmartDoc): SmartIndex<T> {
  const { vocab, intern } = makeVocab();
  const entries = items.map((item): SmartEntry<T> => {
    const d = doc(item);
    return { item, ...nameEntry(d.name, intern, d.synonyms), other: otherWordIds(d.extraWords ?? [], intern) };
  });
  return { items: [...items], entries, vocab };
}

/** Every item matching all query words, with its tier. Unordered within a tier: callers sort with their boosts. */
export function smartMatch<T>(index: SmartIndex<T>, query: string): SmartHit<T>[] {
  const normQuery = normalizeSearchText(query);
  if (normQuery === '') return [];
  const tokens = [...new Set(normQuery.split(' '))];
  const tables = tokens.map((q) => buildQueryTable(index.vocab, q));
  const out: SmartHit<T>[] = [];
  for (const e of index.entries) {
    let worst = EXACT;
    const lit = new Set<number>();
    let ok = true;
    for (const t of tables) {
      const m = matchWordIn(e, t);
      if (!m) {
        ok = false;
        break;
      }
      if (m.kind > worst) worst = m.kind;
      if (m.word === 'joined' && m.joinedRange) {
        for (let i = m.joinedRange[0]; i <= m.joinedRange[1]; i++) lit.add(i);
      } else if (typeof m.word === 'number') lit.add(m.word);
    }
    if (!ok) continue;
    const tier: SmartHit<T>['tier'] =
      worst === OTHER ? 5 : worst === TYPO ? 4 : e.nameNorm === normQuery ? 1 : e.nameNorm.startsWith(normQuery) ? 2 : 3;
    out.push({ item: e.item, tier, highlight: highlightRanges(e, lit) });
  }
  return out;
}
