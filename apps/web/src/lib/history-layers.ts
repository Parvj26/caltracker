'use client';

/**
 * Browser history for everything that covers the page: pop-ups, sheets, menus, full-screen editors, and the
 * "unsaved changes" guard (docs/design/ui-rules.md §8 "Back and swipe-back go exactly one step").
 *
 * Each open layer is one history entry on top of the page's own. Back (the button, iOS swipe-back, Android back)
 * then closes the top layer and nothing else; closing a layer any other way (×, Esc, Done, Save) steps back over its
 * entry, so Forward never reopens it. A page with unsaved changes keeps one invisible "guard" entry under its layers:
 * Back from the page itself asks "Discard changes?" first.
 *
 * How it stays in step with Next.js's router:
 * - Every entry gets a number (`ctSeq`), so a Back can tell which layers it went past.
 * - While this module is stepping back, other history writes (a Link's push, router.replace) wait until it is done,
 *   so a "close the menu, then go to the page" can't be undone by the close.
 * - Stepping back over layers that didn't change the address is hidden from the router (same page, nothing to load).
 *
 * `useHistoryLayer` (address-based pop-ups like AdaptiveDialog) works alongside: its entries are numbered here too.
 */

type BackResult = boolean | void | Promise<boolean | void>;

type Entry = {
  seq: number;
  /** A layer of ours, the page's unsaved-changes guard, or a useHistoryLayer pop-up (it handles its own Back). */
  kind: 'layer' | 'guard' | 'foreign';
  /** Back went past it. Return false to stay open (asking first): the entry goes back on. */
  onBack?: () => BackResult;
  /** The address when it was pushed. */
  href: string;
  /** Closed by the app: step back over it once nothing open is above it. */
  closing: boolean;
  /** Written to history (false while a push waits its turn). */
  pushed: boolean;
};

export type LayerHandle = {
  /** The layer closed some other way: step back over its entry. Resolves once done (await it before navigating). */
  release: () => Promise<void>;
};

const SEQ = 'ctSeq';
/** useHistoryLayer's own state key. */
const FOREIGN_KEY = 'ctLayer';
/** How long to wait for a step back the browser never reports (out of range) before carrying on. */
const TRAVERSAL_TIMEOUT_MS = 700;
/** How long a dialog's own Escape handling gets to close it (React re-renders) before it counts as "stayed open". */
export const DECIDE_MS = 0;

let lastSeq = 0;
const nextSeq = () => (lastSeq = Math.max(Date.now(), lastSeq + 1));

/** Our entries on top of the current page, bottom first. The top one is the current history entry. */
const stack: Entry[] = [];
/** The number of the current history entry, as far as we know. */
let currentSeq = 0;
/** Steps back/forward asked of the browser and not yet reported by popstate, oldest first. */
const traversals: { own: boolean; done: () => void; timer: ReturnType<typeof setTimeout> }[] = [];
/** Layers deciding whether Back may close them. */
let deciding = 0;
/** History writes waiting for the traversals and decisions above to finish. */
let deferred: (() => void)[] = [];
let settleQueued = false;

let nativeGo: History['go'] | null = null;
/** True while this module writes history itself (so the wrappers don't treat it as the page's). */
let writing = false;

type Guard = {
  active: boolean;
  /** Ask "Discard changes?"; resolves true for Discard. */
  ask: () => Promise<boolean>;
  entry: Entry | null;
  /** The coach chose Discard (or saved and left): let the page go. */
  bypassed: boolean;
};
const guards = new Set<Guard>();

function seqOf(state: unknown): number {
  if (state && typeof state === 'object') {
    const n = (state as Record<string, unknown>)[SEQ];
    if (typeof n === 'number') return n;
  }
  return 0;
}

const blocked = () => traversals.length > 0 || deciding > 0;

function flush() {
  while (!blocked() && deferred.length > 0) {
    const next = deferred.shift()!;
    next();
  }
  if (!blocked()) {
    ensureGuards();
    queueSettle();
  }
}

/** Steps `delta` entries (negative is back) and resolves once the browser reports it. Waits its turn. */
function traverse(delta: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const run = () => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        const i = traversals.findIndex((t) => t.done === done);
        if (i >= 0) {
          clearTimeout(traversals[i]!.timer);
          traversals.splice(i, 1);
        }
        resolve();
        flush();
      };
      traversals.push({ own: true, done, timer: setTimeout(done, TRAVERSAL_TIMEOUT_MS) });
      nativeGo!.call(window.history, delta);
    };
    if (blocked()) deferred.push(run);
    else run();
  });
}

function rawPush(entry: Entry, url?: string) {
  entry.seq = nextSeq();
  // It goes on top of history, so on top of the stack too (it may have waited behind later ones).
  const at = stack.indexOf(entry);
  if (at >= 0) stack.splice(at, 1);
  stack.push(entry);
  entry.pushed = true;
  entry.href = url ? new URL(url, window.location.href).href : window.location.href;
  writing = true;
  try {
    // Through the (Next-patched) pushState, so the router's state is copied onto the entry.
    window.history.pushState({ [SEQ]: entry.seq }, '', url);
  } finally {
    writing = false;
  }
  currentSeq = entry.seq;
}

/** Run before every push: lets openLayer notice dialogs React already took out of the page. */
const beforePush = new Set<() => void>();
export function onBeforePush(fn: () => void) {
  beforePush.add(fn);
}

function push(entry: Entry) {
  for (const fn of beforePush) fn();
  // Closed layers still on top (a menu item that opens a dialog): step over them first, then push.
  settle();
  stack.push(entry);
  const run = () => {
    if (!stack.includes(entry) || entry.closing) {
      // Closed before it got its turn: never written.
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      return;
    }
    rawPush(entry);
  };
  if (blocked()) deferred.push(run);
  else run();
}

function topIsCurrent(): boolean {
  const top = stack[stack.length - 1];
  return top !== undefined && top.pushed && top.seq === currentSeq;
}

function queueSettle() {
  if (settleQueued) return;
  settleQueued = true;
  queueMicrotask(() => {
    settleQueued = false;
    settle();
  });
}

/** Steps back over the closed layers on top (all at once), and drops closed ones that history no longer holds. */
function settle() {
  if (blocked()) return;
  // Not pushed yet and closed already: nothing to undo.
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.closing && !stack[i]!.pushed) stack.splice(i, 1);
  if (!topIsCurrent()) {
    // The page moved on above our entries (a navigation): they are buried, not ours to step over any more.
    if (stack.length > 0 && stack.every((e) => e.seq !== currentSeq)) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.closing) stack.splice(i, 1);
    }
    return;
  }
  let n = 0;
  while (n < stack.length && stack[stack.length - 1 - n]!.closing) n++;
  if (n === 0) return;
  void traverse(-n);
}

/** Puts each active guard's entry under the layers: only when no layer is open, so the guard is always lowest. */
function ensureGuards() {
  if (blocked()) return;
  for (const g of guards) {
    if (!g.active || g.bypassed || g.entry) continue;
    if (stack.some((e) => !e.closing)) continue;
    const entry: Entry = { seq: 0, kind: 'guard', href: '', closing: false, pushed: false, onBack: () => guardBack(g) };
    g.entry = entry;
    push(entry);
  }
}

function guardBack(g: Guard): false {
  void g.ask().then((discard) => {
    if (!discard || !g.entry) return;
    g.bypassed = true;
    const i = stack.indexOf(g.entry);
    if (i >= 0) stack.splice(i, 1);
    g.entry = null;
    // From the guard entry (put back): over it and the page, to where Back was going.
    void traverse(-2);
  });
  return false;
}

async function handleGone(gone: Entry[]) {
  deciding++;
  try {
    let refused: Entry[] = [];
    for (let i = 0; i < gone.length; i++) {
      const entry = gone[i]!;
      if (entry.closing || entry.kind === 'foreign') continue;
      let result: boolean | void = undefined;
      try {
        result = await entry.onBack?.();
      } catch {
        result = undefined;
      }
      if (result === false) {
        refused = gone.slice(i).filter((e) => !e.closing && e.kind !== 'foreign');
        break;
      }
    }
    // Still open: back on, bottom first, under anything they opened meanwhile (that waited in `deferred`).
    for (const entry of refused.reverse()) rawPush(entry);
  } finally {
    deciding--;
    flush();
  }
}

function onPopState(e: PopStateEvent) {
  const landing = seqOf(e.state);
  currentSeq = landing;
  const gone: Entry[] = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i]!;
    if (entry.pushed && entry.seq > landing) {
      gone.push(entry);
      stack.splice(i, 1);
    }
  }
  const t = traversals[0];
  // Same page under the layers that went: the router has nothing to do (and nothing waiting must be undone).
  const lowest = gone[gone.length - 1];
  const sameAddress = lowest !== undefined && gone.every((g) => g.kind !== 'foreign') && window.location.href === lowest.href;
  if (t?.own) {
    if (sameAddress || deferred.length > 0) e.stopImmediatePropagation();
    t.done();
    return;
  }
  if (t) {
    // A step back asked by other code (useHistoryLayer's release): it's theirs, nothing to close here.
    clearTimeout(t.timer);
    traversals.shift();
  }
  if (sameAddress) e.stopImmediatePropagation();
  if (gone.length > 0) void handleGone(gone);
  else flush();
}

function sameOrigin(a: HTMLAnchorElement): URL | null {
  try {
    const url = new URL(a.href, window.location.href);
    return url.origin === window.location.origin ? url : null;
  } catch {
    return null;
  }
}

const BYPASS = new WeakSet<HTMLAnchorElement>();

/** A link tapped while layers are open or changes are unsaved: ask first, close the layers, then follow it. */
function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a[href]');
  if (!(a instanceof HTMLAnchorElement)) return;
  if (BYPASS.has(a)) {
    BYPASS.delete(a);
    return;
  }
  if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const url = sameOrigin(a);
  if (!url) return;
  const here = new URL(window.location.href);
  if (url.pathname === here.pathname && url.search === here.search) return;
  const guard = [...guards].find((g) => g.active && !g.bypassed);
  if (!guard && stack.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  void (async () => {
    if (guard) {
      if (!(await guard.ask())) return;
      for (const g of guards) if (g.active) g.bypassed = true;
    }
    await unwindAll();
    if (a.isConnected) {
      BYPASS.add(a);
      a.click();
    } else {
      window.location.assign(url.href);
    }
  })();
}

/** Steps back over every entry of ours on top of the page (layers and guard), without closing anything. */
function unwindAll(): Promise<void> {
  return new Promise<void>((resolve) => {
    const run = () => {
      for (const g of guards) g.entry = null;
      const pushed = stack.filter((s) => s.pushed).length;
      if (pushed === 0 || !topIsCurrent()) {
        stack.length = 0;
        resolve();
        return;
      }
      // Marked closed, so nothing is asked; the layers themselves go when the page changes.
      for (const s of stack) s.closing = true;
      void traverse(-pushed).then(resolve);
    };
    if (blocked()) deferred.push(run);
    else run();
  });
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (![...guards].some((g) => g.active && !g.bypassed)) return;
  e.preventDefault();
  // Older browsers need returnValue set to show the prompt.
  e.returnValue = '';
}

let installed = false;

/** Hooks into history once, in the browser. Safe to call often. */
export function installHistoryLayers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const h = window.history;
  // Kept to call with `h` (whatever wrapped them before: Next.js's patch, if it got here first).
  /* eslint-disable @typescript-eslint/unbound-method */
  const innerPush = h.pushState;
  const innerReplace = h.replaceState;
  const innerBack = h.back;
  /* eslint-enable @typescript-eslint/unbound-method */
  nativeGo = h.go.bind(h);
  currentSeq = seqOf(h.state);

  h.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    if (writing) return innerPush.call(h, data, unused, url);
    for (const fn of beforePush) fn();
    settle();
    const run = () => {
      const base = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const seq = nextSeq();
      const next = { ...base, [SEQ]: seq };
      innerPush.call(h, next, unused, url);
      currentSeq = seq;
      if (FOREIGN_KEY in base) {
        stack.push({ seq, kind: 'foreign', href: window.location.href, closing: false, pushed: true });
      } else {
        // A page: our entries are under it now.
        stack.length = 0;
        for (const g of guards) g.entry = null;
      }
    };
    if (blocked()) deferred.push(run);
    else run();
  } as History['pushState'];

  h.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    if (writing) return innerReplace.call(h, data, unused, url);
    settle();
    const run = () => {
      const base = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const cur = h.state && typeof h.state === 'object' ? (h.state as Record<string, unknown>) : {};
      const next: Record<string, unknown> = { ...base };
      // Keep the entry's number (and useHistoryLayer's marker) whatever the caller passed (often null).
      next[SEQ] = typeof cur[SEQ] === 'number' ? cur[SEQ] : nextSeq();
      if (!(FOREIGN_KEY in next) && FOREIGN_KEY in cur) next[FOREIGN_KEY] = cur[FOREIGN_KEY];
      const target = url != null ? new URL(String(url), window.location.href).href : window.location.href;
      const ours = stack.filter((s) => s.pushed);
      if (target !== window.location.href && ours.length > 0 && topIsCurrent() && ours.every((s) => s.kind !== 'foreign')) {
        // The page changed its own address (a search, a tab, a save) while layers or the guard are on top: write it
        // on the page's entry, then put ours back on top of it.
        void rewriteUnder(ours, () => {
          const c = h.state && typeof h.state === 'object' ? (h.state as Record<string, unknown>) : {};
          innerReplace.call(h, { ...base, [SEQ]: typeof c[SEQ] === 'number' ? c[SEQ] : nextSeq() }, unused, url);
          currentSeq = seqOf(h.state);
        });
        return;
      }
      innerReplace.call(h, next, unused, url);
      currentSeq = next[SEQ] as number;
    };
    if (blocked()) deferred.push(run);
    else run();
  } as History['replaceState'];

  // Other code's own steps back: later writes wait for them too.
  h.back = function back() {
    const done = () => {
      const i = traversals.findIndex((t) => t.done === done);
      if (i >= 0) traversals.splice(i, 1);
      flush();
    };
    traversals.push({ own: false, done, timer: setTimeout(done, TRAVERSAL_TIMEOUT_MS) });
    innerBack.call(h);
  };

  window.addEventListener('popstate', onPopState, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('beforeunload', onBeforeUnload);
}

/** Step back to the page's entry, apply `write` there, then push `entries` again (same layers, new address). */
async function rewriteUnder(entries: Entry[], write: () => void) {
  const keep = entries.filter((e) => !e.closing);
  for (const e of entries) {
    const i = stack.indexOf(e);
    if (i >= 0) stack.splice(i, 1);
  }
  await traverse(-entries.length);
  write();
  // A guard whose page is saved and leaving stays off.
  for (const e of keep) {
    if (e.kind === 'guard') {
      const g = [...guards].find((x) => x.entry === e);
      if (!g || !g.active || g.bypassed) {
        if (g) g.entry = null;
        continue;
      }
    }
    rawPush(e);
  }
}

/**
 * Pushes a history entry for a layer that just opened. `onBack` runs when Back goes past it: close the layer, or
 * return false to stay open (it is pushed again). Call `release()` when it closes any other way.
 */
export function pushLayer(onBack: () => BackResult): LayerHandle {
  installHistoryLayers();
  const entry: Entry = { seq: 0, kind: 'layer', href: '', closing: false, pushed: false, onBack };
  push(entry);
  return {
    release: () => {
      if (!stack.includes(entry)) return Promise.resolve();
      entry.closing = true;
      queueSettle();
      return waitGone(entry);
    },
  };
}

/** Resolves once `entry` has left the stack (stepped over, or buried by a navigation); at worst after a timeout. */
function waitGone(entry: Entry): Promise<void> {
  return new Promise<void>((resolve) => {
    const giveUp = setTimeout(resolve, TRAVERSAL_TIMEOUT_MS + 100);
    const check = () => {
      if (stack.includes(entry)) setTimeout(check, 10);
      else {
        clearTimeout(giveUp);
        resolve();
      }
    };
    setTimeout(check, 0);
  });
}

/**
 * Registers a page's unsaved changes. While `active`, Back from the page asks (`ask`) before leaving, links ask
 * before following, and closing the tab warns.
 */
export function addLeaveGuard(ask: () => Promise<boolean>) {
  installHistoryLayers();
  const g: Guard = { active: false, ask, entry: null, bypassed: false };
  guards.add(g);
  return {
    setActive(active: boolean) {
      if (g.active === active) return;
      g.active = active;
      if (active) {
        g.bypassed = false;
        ensureGuards();
      } else {
        void dropGuardEntry(g);
      }
    },
    /** Leaving on purpose (after a save, or a confirmed Discard): take the guard entry off first. */
    release(): Promise<void> {
      g.bypassed = true;
      return dropGuardEntry(g);
    },
    remove() {
      void dropGuardEntry(g);
      guards.delete(g);
    },
  };
}

function dropGuardEntry(g: Guard): Promise<void> {
  const entry = g.entry;
  g.entry = null;
  if (!entry || !stack.includes(entry)) return Promise.resolve();
  entry.closing = true;
  queueSettle();
  return waitGone(entry);
}

/** For tests: forget everything (history itself is left as it is). */
export function resetHistoryLayersForTests() {
  stack.length = 0;
  for (const t of traversals) clearTimeout(t.timer);
  traversals.length = 0;
  deferred = [];
  deciding = 0;
  guards.clear();
  currentSeq = seqOf(window.history.state);
}

/** Whether Back would close a layer of ours (tests and the page's own checks). */
export function openLayerCount(): number {
  return stack.filter((e) => e.kind !== 'guard' && !e.closing).length;
}

if (typeof window !== 'undefined') installHistoryLayers();
