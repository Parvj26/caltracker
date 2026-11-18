import { WorkoutLogDoc, draftEdits, rebaseEdits, type LogEdit } from '@caltracker/shared';

// The live session's edits, kept on this device the moment they are made. Saving to the server waits a moment
// (typing a number is several key presses), and a save sent as the page closes (swipe back, the tab hidden, the app
// put away) may never arrive. The copy here lets the session page send it next time it opens, so a typed weight is
// never lost.
//
// Each tab keeps its own copy (keyed by log and tab), with the server copy it grew from (`base`), the coach it
// belongs to and when it was written. Opening the session merges every usable copy onto the server's: when the
// server is still at `base` the copy is taken whole; when it moved on (another tab or device saved since) only the
// copy's own changes are redone on top (draftEdits + rebaseEdits), so neither side's sets are lost. Copies of another
// coach, older than two days, or of a session that has ended are dropped; signing out removes them all.

export const DRAFT_PREFIX = 'caltracker:session-draft:';
export const DRAFT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type Draft = { userId: string; tabId: string; savedAt: number; base: WorkoutLogDoc; doc: WorkoutLogDoc };
export type StoredDraft = { key: string; raw: string };

export const draftKey = (logId: string, tabId: string) => `${DRAFT_PREFIX}${logId}:${tabId}`;

export function encodeDraft(d: Draft): string {
  return JSON.stringify({ v: 2, ...d });
}

export function decodeDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof Draft | 'v', unknown>>;
    if (v.v !== 2 || typeof v.userId !== 'string' || typeof v.tabId !== 'string' || typeof v.savedAt !== 'number') return null;
    const base = WorkoutLogDoc.safeParse(v.base);
    const doc = WorkoutLogDoc.safeParse(v.doc);
    if (!base.success || !doc.success || base.data.id !== doc.data.id) return null;
    return { userId: v.userId, tabId: v.tabId, savedAt: v.savedAt, base: base.data, doc: doc.data };
  } catch {
    return null;
  }
}

/** The kept copies for one session that this coach may use now, oldest first. */
export function usableDrafts(stored: readonly StoredDraft[], o: { logId: string; userId: string; now: number }): (Draft & { key: string; raw: string })[] {
  return stored
    .filter((s) => s.key.startsWith(`${DRAFT_PREFIX}${o.logId}:`))
    .map((s) => ({ s, d: decodeDraft(s.raw) }))
    .filter((x): x is { s: StoredDraft; d: Draft } => x.d !== null && x.d.userId === o.userId && o.now - x.d.savedAt <= DRAFT_MAX_AGE_MS)
    .sort((a, b) => a.d.savedAt - b.d.savedAt)
    .map(({ s, d }) => ({ ...d, key: s.key, raw: s.raw }));
}

/** Keys to remove when the app loads: broken, another coach's, or too old. */
export function staleDraftKeys(stored: readonly StoredDraft[], o: { userId: string; now: number }): string[] {
  return stored
    .filter((s) => s.key.startsWith(DRAFT_PREFIX))
    .filter((s) => {
      const d = decodeDraft(s.raw);
      return !d || d.userId !== o.userId || o.now - d.savedAt > DRAFT_MAX_AGE_MS;
    })
    .map((s) => s.key);
}

export type Merged = {
  doc: WorkoutLogDoc;
  /** The edits not on the server yet, for the stale-save path to redo (each with the revision it reached). */
  unsaved: { edit: LogEdit; revision: number }[];
  /** Some kept changes couldn't be redone (sets added or removed, a pick) because the session changed elsewhere. */
  partial: boolean;
  /** At least one kept copy brought changes. */
  restored: boolean;
};

/**
 * The server copy with every kept copy merged on (oldest first), then `local`, edits made on this page since it
 * opened. Copies built on a newer server copy than this one are left alone. Nothing merges once the session ended.
 */
export function mergeDrafts(server: WorkoutLogDoc, drafts: readonly Draft[], local: readonly LogEdit[] = []): Merged {
  let doc = server;
  let unsaved: Merged['unsaved'] = [];
  let partial = false;
  let restored = false;
  if (server.status !== 'in_progress') return { doc, unsaved, partial, restored };
  for (const d of drafts) {
    if (d.doc.status !== 'in_progress' || d.base.revision > server.revision || d.doc.revision <= d.base.revision) continue;
    const { edits, complete } = draftEdits(d.base, d.doc);
    if (doc === server && d.base.revision === server.revision) {
      // Nothing happened on the server since: the copy is the latest, whole (shape changes included).
      doc = d.doc;
      unsaved = edits.map((edit) => ({ edit, revision: d.doc.revision }));
      restored = true;
      continue;
    }
    const r = rebaseEdits(doc, edits);
    if (r.doc !== doc) restored = true;
    doc = r.doc;
    unsaved = [...unsaved, ...r.unsaved];
    if (!complete) partial = true;
  }
  if (local.length) {
    const r = rebaseEdits(doc, local);
    doc = r.doc;
    unsaved = [...unsaved, ...r.unsaved];
  }
  return { doc, unsaved, partial, restored };
}

// Storage can be missing or refuse (private windows, full): the page then works as before, saving to the server only.
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readAllDrafts(): StoredDraft[] {
  const s = storage();
  if (!s) return [];
  const out: StoredDraft[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(DRAFT_PREFIX)) continue;
      const raw = s.getItem(key);
      if (raw !== null) out.push({ key, raw });
    }
  } catch {
    // Unreadable: nothing kept.
  }
  return out;
}

export function writeDraft(d: Draft): void {
  try {
    storage()?.setItem(draftKey(d.doc.id, d.tabId), encodeDraft(d));
  } catch {
    // Not kept on the device; the server save still runs.
  }
}

/** Removes `key`, but only while it still holds `raw` (another open tab may have written it again since). */
export function removeDraftIfUnchanged(key: string, raw: string): void {
  try {
    const s = storage();
    if (s?.getItem(key) === raw) s.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

export function removeDraftKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** Every kept copy of one session (it has ended). */
export function clearSessionDrafts(logId: string): void {
  for (const s of readAllDrafts()) if (s.key.startsWith(`${DRAFT_PREFIX}${logId}:`)) removeDraftKey(s.key);
}

/** Every kept copy (signing out: they hold client data). */
export function clearAllDrafts(): void {
  for (const s of readAllDrafts()) removeDraftKey(s.key);
}

/** Drops broken, other coaches' and old copies (on app load). */
export function pruneDrafts(userId: string, now = Date.now()): void {
  for (const key of staleDraftKeys(readAllDrafts(), { userId, now })) removeDraftKey(key);
}

const TAB_KEY = 'caltracker:tab-id';
let memoryTabId: string | null = null;

/** This tab's id (kept for the tab's life, so a reload finds its own copy). */
export function tabId(): string {
  try {
    const kept = window.sessionStorage.getItem(TAB_KEY);
    if (kept) return kept;
    const id = crypto.randomUUID();
    window.sessionStorage.setItem(TAB_KEY, id);
    return id;
  } catch {
    memoryTabId ??= crypto.randomUUID();
    return memoryTabId;
  }
}
