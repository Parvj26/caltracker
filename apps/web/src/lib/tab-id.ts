// An id for this browser tab, kept for the tab's life (sessionStorage, so a reload keeps it), and a way to ask which
// tabs of the app are open now (BroadcastChannel). "Duplicate tab" copies sessionStorage, so a new tab can start
// with another open tab's id: it says which id it has as it loads, and when an open tab answers that it has it, the
// new tab takes a fresh one.

const KEY = 'caltracker:tab-id';
const CHANNEL = 'caltracker-tabs';

type Message = { t: 'claim'; id: string } | { t: 'taken'; id: string } | { t: 'who'; nonce: string } | { t: 'here'; nonce: string; id: string };

let current: string | null = null;
let channel: BroadcastChannel | null = null;
let claiming = false;

function fresh(): string {
  const id = crypto.randomUUID();
  current = id;
  try {
    window.sessionStorage.setItem(KEY, id);
  } catch {
    // Kept in memory only.
  }
  return id;
}

/** This tab's id. */
export function tabId(): string {
  if (current) return current;
  try {
    const kept = window.sessionStorage.getItem(KEY);
    if (kept) return (current = kept);
  } catch {
    // Storage blocked: an id for this page only.
  }
  return fresh();
}

function open(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(CHANNEL);
  return channel;
}

/** Joins the open tabs (once per page load): answers "who is open", and fixes a duplicated tab's id. */
export function startTabPresence(): () => void {
  const ch = open();
  if (!ch) return () => {};
  const onMessage = (e: MessageEvent<Message>) => {
    const m = e.data;
    if (m.t === 'claim' && m.id === tabId() && !claiming) ch.postMessage({ t: 'taken', id: m.id } satisfies Message);
    else if (m.t === 'taken' && m.id === tabId() && claiming) fresh();
    else if (m.t === 'who') ch.postMessage({ t: 'here', nonce: m.nonce, id: tabId() } satisfies Message);
  };
  ch.addEventListener('message', onMessage);
  // A new page says its id; an open tab with the same one answers within a moment.
  claiming = true;
  ch.postMessage({ t: 'claim', id: tabId() } satisfies Message);
  const settle = setTimeout(() => {
    claiming = false;
  }, 300);
  return () => {
    clearTimeout(settle);
    claiming = false;
    ch.removeEventListener('message', onMessage);
  };
}

/** The ids of the app's tabs open now (this one included), or null when the browser can't say. */
export function openTabIds(waitMs = 250): Promise<Set<string> | null> {
  const ch = open();
  if (!ch) return Promise.resolve(null);
  const nonce = crypto.randomUUID();
  const ids = new Set([tabId()]);
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent<Message>) => {
      if (e.data.t === 'here' && e.data.nonce === nonce) ids.add(e.data.id);
    };
    ch.addEventListener('message', onMessage);
    ch.postMessage({ t: 'who', nonce } satisfies Message);
    setTimeout(() => {
      ch.removeEventListener('message', onMessage);
      resolve(ids);
    }, waitMs);
  });
}
