/**
 * The unsent text of each conversation, kept for this tab only (sessionStorage), so Back, switching conversations or a
 * reload doesn't lose it. Keys are `ct-message-draft:<coachId>:<clientId>`. They hold client conversation text, so
 * signing out removes them all (clearMessageDrafts).
 */
export const MESSAGE_DRAFT_PREFIX = 'ct-message-draft:';

export const messageDraftKey = (coachId: string, clientId: string) => `${MESSAGE_DRAFT_PREFIX}${coachId}:${clientId}`;

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readMessageDraft(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Empty (or blank) text removes the key. */
export function writeMessageDraft(key: string, text: string): void {
  try {
    const s = store();
    if (!s) return;
    if (text.trim() === '') s.removeItem(key);
    else s.setItem(key, text);
  } catch {
    // Storage blocked (a private window): the draft just isn't kept.
  }
}

/** Every kept message draft in this tab (signing out). */
export function clearMessageDrafts(): void {
  try {
    const s = store();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(MESSAGE_DRAFT_PREFIX)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // Nothing to do.
  }
}
