import { WorkoutLogDoc } from '@caltracker/shared';

// The live session's edits, kept on this device the moment they are made. Saving to the server waits a moment
// (typing a number is several key presses), and a save sent as the page closes (swipe back, the tab hidden, the app
// put away) may never arrive. The copy here lets the session page send it next time it opens, so a typed weight is
// never lost. Removed once the server has it.

type Draft = { base: number; doc: WorkoutLogDoc };

const KEY = 'caltracker:session-draft:';
export const draftKey = (logId: string) => `${KEY}${logId}`;

/** `doc` (this page's copy) and `base`, the server revision it was built on (the last one saved). */
export function encodeDraft(doc: WorkoutLogDoc, base: number): string {
  return JSON.stringify({ base, doc } satisfies Draft);
}

function decode(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { base?: unknown; doc?: unknown };
    if (typeof v.base !== 'number') return null;
    const doc = WorkoutLogDoc.safeParse(v.doc);
    return doc.success ? { base: v.base, doc: doc.data } : null;
  } catch {
    return null;
  }
}

/**
 * The kept copy to carry on from, when it has edits `server` doesn't: the same session, still in progress, and grown
 * from the copy the server has (nobody else changed it since). Null otherwise; the server's copy then wins.
 */
export function draftToRestore(raw: string | null, server: WorkoutLogDoc): WorkoutLogDoc | null {
  const d = decode(raw);
  if (!d || d.doc.id !== server.id) return null;
  if (server.status !== 'in_progress' || d.doc.status !== 'in_progress') return null;
  if (d.doc.revision <= server.revision || server.revision < d.base) return null;
  return d.doc;
}

/** True when there is nothing kept beyond `savedRevision`, so the copy can go. */
export function isDraftSaved(raw: string | null, savedRevision: number): boolean {
  const d = decode(raw);
  return !d || d.doc.revision <= savedRevision;
}

// Storage can be missing or refuse (private windows, full): the page then works as before, saving to the server only.
export function readDraft(logId: string): string | null {
  try {
    return window.localStorage.getItem(draftKey(logId));
  } catch {
    return null;
  }
}

export function writeDraft(doc: WorkoutLogDoc, base: number): void {
  try {
    window.localStorage.setItem(draftKey(doc.id), encodeDraft(doc, base));
  } catch {
    // Not kept on the device; the server save still runs.
  }
}

export function clearDraft(logId: string): void {
  try {
    window.localStorage.removeItem(draftKey(logId));
  } catch {
    // Nothing to do.
  }
}
