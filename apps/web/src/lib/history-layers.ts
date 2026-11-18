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
 * `useHistoryLayer` (AdaptiveDialog) is built on the same stack: its entries also put `?sheet=<id>` in the address.
 */

type BackResult = boolean | void | Promise<boolean | void>;

type Entry = {
  seq: number;
  /** A layer (pop-up, sheet, menu, full-screen editor) or the page's unsaved-changes guard. */
  kind: 'layer' | 'guard';
  /** Shown in the address while open (`?<param>=<id>`), for useHistoryLayer. */
  address?: { param: string; id: string };
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
type Traversal = {
  /** Ours (not other code's history.back()). */
  own: boolean;
  /** Hide it from the router (and other listeners) as long as it stays on the same page. */
  hide: boolean;
  /** The page it started on: a step that leaves it is never hidden. */
  fromPath: string;
  done: (arrived: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};
/** Steps back/forward asked of the browser and not yet reported by popstate, oldest first. */
const traversals: Traversal[] = [];
/** Layers deciding whether Back may close them. */
let deciding = 0;
/** History writes waiting for the traversals and decisions above to finish. */
let deferred: (() => void)[] = [];
let settleQueued = false;

/** True while this module writes history itself (so the wrappers don't treat it as the page's). */
let writing = false;

type Guard = {
  active: boolean;
  /** Ask "Discard changes?"; resolves true for Discard. */
  ask: () => Promise<boolean>;
  entry: Entry | null;
  /** The coach chose Discard (or saved and left): let the page go. */
  bypassed: boolean;
  /** Discard on Back with nothing behind the page in this tab: go here instead (its parent list). */
  onNoHistory?: () => void;
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

/**
 * Steps `delta` entries (negative is back) and resolves once the browser reports it (true), or after a timeout when
 * it never does (false: out of range). Waits its turn behind other steps and decisions.
 */
function traverse(delta: number, { hide = false, then }: { hide?: boolean; then?: (arrived: boolean) => void } = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const run = () => {
      let settled = false;
      const done = (arrived: boolean) => {
        if (settled) return;
        settled = true;
        const i = traversals.findIndex((t) => t.done === done);
        if (i >= 0) {
          clearTimeout(traversals[i]!.timer);
          traversals.splice(i, 1);
        }
        // Before anything that waited runs.
        then?.(arrived);
        resolve(arrived);
        flush();
      };
      traversals.push({ own: true, hide, fromPath: window.location.pathname, done, timer: setTimeout(() => done(false), TRAVERSAL_TIMEOUT_MS) });
      // Looked up each time (not kept), so a test can stand in for the browser.
      window.history.go(delta);
    };
    if (blocked()) deferred.push(run);
    else run();
  });
}

/** The address with (or, `id` null, without) `?<param>=<id>`. */
function withParam(href: string, param: string, id: string | null): string {
  const url = new URL(href);
  if (id === null) url.searchParams.delete(param);
  else url.searchParams.set(param, id);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Pop-ups closed while they were in the address (`?sheet=<id>`). A write the router queued while one was open (a
 * server action's refresh mid-close) still carries its param: it is taken off, so the address never shows a closed
 * pop-up and the next one doesn't copy it.
 */
const closedAddresses = new Map<string, string>();
function withoutClosed(url: string | URL | null | undefined): string | URL | null | undefined {
  if (url == null || closedAddresses.size === 0) return url;
  const u = new URL(String(url), window.location.href);
  let changed = false;
  for (const [param, id] of closedAddresses) {
    const open = stack.some((e) => e.address?.param === param && e.address.id === id);
    if (!open && u.searchParams.get(param) === id) {
      u.searchParams.delete(param);
      changed = true;
    }
  }
  return changed ? `${u.pathname}${u.search}${u.hash}` : url;
}

/** The page a deferred push will land on: a write asked meanwhile belongs to that page. */
let pendingPushPath: string | null = null;

/** Writes history ourselves, through the (Next-patched) methods so the router's state and address stay in step. */
function write(fn: () => void) {
  writing = true;
  try {
    fn();
  } finally {
    writing = false;
  }
}

function rawPush(entry: Entry) {
  entry.seq = nextSeq();
  // It goes on top of history, so on top of the stack too (it may have waited behind later ones).
  const at = stack.indexOf(entry);
  if (at >= 0) stack.splice(at, 1);
  stack.push(entry);
  entry.pushed = true;
  let url: string | undefined;
  if (entry.address) {
    const { param, id } = entry.address;
    closedAddresses.delete(param);
    // A leftover ?sheet= (a shared link, a reload while open): off this entry first, so Back lands on the plain page.
    if (new URL(window.location.href).searchParams.has(param)) {
      const plain = withParam(window.location.href, param, null);
      write(() => window.history.replaceState(window.history.state, '', plain));
    }
    url = withParam(window.location.href, param, id);
  }
  entry.href = url ? new URL(url, window.location.href).href : window.location.href;
  write(() => window.history.pushState({ [SEQ]: entry.seq }, '', url));
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
  const over = stack.slice(stack.length - n);
  void traverse(-n, {
    then: (arrived) => {
      // The browser never reported it: count them gone anyway, so they are never stepped over twice.
      if (!arrived) for (const e of over) if (stack.includes(e)) stack.splice(stack.indexOf(e), 1);
    },
  });
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

/** Where this tab's history can't go back two steps (the page was opened directly, guard on top). */
function cannotGoBackTwo(): boolean {
  const nav = (window as unknown as { navigation?: { currentEntry?: { index?: number } } }).navigation;
  const index = nav?.currentEntry?.index;
  return typeof index === 'number' && index < 2;
}

function guardBack(g: Guard): false {
  void g.ask().then(async (discard) => {
    if (!discard || !g.entry) return;
    g.bypassed = true;
    const entry = g.entry;
    g.entry = null;
    if (!cannotGoBackTwo()) {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      // From the guard entry (put back): over it and the page, to where Back was going.
      if (await traverse(-2)) return;
      // Nothing that far back after all: still on the guard entry.
      stack.push(entry);
    }
    // The page is the first in this tab: step off the guard only, then the page's own way out (its parent list).
    entry.closing = true;
    if (!stack.includes(entry)) stack.push(entry);
    queueSettle();
    await waitGone(entry);
    g.onNoHistory?.();
  });
  return false;
}

async function handleGone(gone: Entry[]) {
  deciding++;
  try {
    let refused: Entry[] = [];
    for (let i = 0; i < gone.length; i++) {
      const entry = gone[i]!;
      if (entry.closing) continue;
      let result: boolean | void = undefined;
      try {
        result = await entry.onBack?.();
      } catch {
        result = undefined;
      }
      if (result === false) {
        refused = gone.slice(i).filter((e) => !e.closing);
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
  for (const g of gone) if (g.address) closedAddresses.set(g.address.param, g.address.id);
  const t = traversals[0];
  // Same address under the layers that went: the router has nothing to do (and nothing waiting must be undone).
  const lowest = gone[gone.length - 1];
  const sameAddress = lowest !== undefined && window.location.href === lowest.href;
  if (t?.own) {
    // Never hidden when it left the page: the router must show where it landed.
    // Nor when it closed a pop-up that was in the address (?sheet=): the router must drop it from its own state too.
    const samePage = window.location.pathname === t.fromPath;
    const inAddress = gone.some((g) => g.address);
    if (samePage && !inAddress && (t.hide || sameAddress || deferred.length > 0)) e.stopImmediatePropagation();
    t.done(true);
    return;
  }
  if (t) {
    // Other code's history.back(): the router sees it, and later writes wait for it (done below, via flush).
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
      void traverse(-pushed, { hide: true }).then(() => resolve());
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
  currentSeq = seqOf(h.state);

  h.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    if (writing) return innerPush.call(h, data, unused, url);
    for (const fn of beforePush) fn();
    settle();
    const target = url != null ? new URL(String(url), window.location.href) : new URL(window.location.href);
    const run = () => {
      if (pendingPushPath === target.pathname) pendingPushPath = null;
      const base = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const ours = stack.filter((s) => s.pushed);
      if (ours.length > 0 && topIsCurrent()) {
        // Code navigating (router.push) with layers or the guard on top: write the new entry on the page's own,
        // not above them, or Back would land on their dead entries.
        const leaving = target.pathname !== window.location.pathname;
        if (leaving) for (const g of guards) if (g.active) g.bypassed = true;
        void rewriteUnder(ours, () => {
          const seq = nextSeq();
          innerPush.call(h, { ...base, [SEQ]: seq }, unused, url);
          currentSeq = seq;
        }, { keep: !leaving });
        return;
      }
      const seq = nextSeq();
      innerPush.call(h, { ...base, [SEQ]: seq }, unused, url);
      currentSeq = seq;
      // A new page entry: anything of ours left in the stack is under it now.
      stack.length = 0;
      for (const g of guards) g.entry = null;
    };
    if (blocked()) {
      pendingPushPath = target.pathname;
      deferred.push(run);
    } else run();
  } as History['pushState'];

  h.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    if (writing) return innerReplace.call(h, data, unused, url);
    settle();
    // The page it was asked for: a push waiting its turn is where the router already is.
    const fromPath = pendingPushPath ?? window.location.pathname;
    const run = () => {
      // Asked on a page the tab has since left (a Back raced it): it belongs to that page, not this one.
      if (window.location.pathname !== fromPath) return;
      url = withoutClosed(url);
      const base = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const cur = h.state && typeof h.state === 'object' ? (h.state as Record<string, unknown>) : {};
      // Keep the entry's number whatever the caller passed (often null).
      const next: Record<string, unknown> = { ...base, [SEQ]: typeof cur[SEQ] === 'number' ? cur[SEQ] : nextSeq() };
      const target = url != null ? new URL(String(url), window.location.href).href : window.location.href;
      const ours = stack.filter((s) => s.pushed);
      if (target !== window.location.href && ours.length > 0 && topIsCurrent() && ours.every((s) => !s.address)) {
        // The page changed its own address (a search, a tab, a save) while layers or the guard are on top: write it
        // on the page's entry, then put ours back on top of it.
        // A different page (router.replace after a delete): the layers don't come back on top of it.
        const leaving = new URL(target).pathname !== window.location.pathname;
        if (leaving) for (const g of guards) if (g.active) g.bypassed = true;
        void rewriteUnder(
          ours,
          () => {
            const c = h.state && typeof h.state === 'object' ? (h.state as Record<string, unknown>) : {};
            innerReplace.call(h, { ...base, [SEQ]: typeof c[SEQ] === 'number' ? c[SEQ] : nextSeq() }, unused, url);
            currentSeq = seqOf(h.state);
          },
          { keep: !leaving },
        );
        return;
      }
      innerReplace.call(h, next, unused, url);
      currentSeq = next[SEQ] as number;
    };
    if (blocked()) deferred.push(run);
    else run();
  } as History['replaceState'];

  // Other code's own steps back (Next's router.back()): they wait their turn like ours, and later writes wait for them.
  h.back = function back() {
    settle();
    const run = () => {
      const done = () => {
        const i = traversals.findIndex((t) => t.done === done);
        if (i >= 0) {
          clearTimeout(traversals[i]!.timer);
          traversals.splice(i, 1);
        }
        flush();
      };
      traversals.push({ own: false, hide: false, fromPath: window.location.pathname, done, timer: setTimeout(done, TRAVERSAL_TIMEOUT_MS) });
      innerBack.call(h);
    };
    if (blocked()) deferred.push(run);
    else run();
  };

  window.addEventListener('popstate', onPopState, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('beforeunload', onBeforeUnload);
}

/**
 * Steps back to the page's entry (hidden from the router), applies `apply` there, then pushes `entries` again on top
 * (same layers, new address), unless `keep` is false (the page is being left).
 */
async function rewriteUnder(entries: Entry[], apply: () => void, { keep = true }: { keep?: boolean } = {}) {
  const again = keep ? entries.filter((e) => !e.closing) : [];
  for (const e of entries) {
    const i = stack.indexOf(e);
    if (i >= 0) stack.splice(i, 1);
  }
  if (!keep) for (const g of guards) g.entry = null;
  await traverse(-entries.length, {
    hide: true,
    then: () => {
      apply();
      for (const e of again) {
        // A guard whose page is saved and leaving stays off.
        if (e.kind === 'guard') {
          const g = [...guards].find((x) => x.entry === e);
          if (!g || !g.active || g.bypassed) {
            if (g) g.entry = null;
            continue;
          }
        }
        rawPush(e);
      }
    },
  });
}

/**
 * Pushes a history entry for a layer that just opened. `onBack` runs when Back goes past it: close the layer, or
 * return false to stay open (it is pushed again). Call `release()` when it closes any other way.
 */
export function pushLayer(onBack: () => BackResult, options: { address?: { param: string; id: string } } = {}): LayerHandle {
  installHistoryLayers();
  const entry: Entry = { seq: 0, kind: 'layer', href: '', closing: false, pushed: false, onBack };
  if (options.address) entry.address = options.address;
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
export function addLeaveGuard(ask: () => Promise<boolean>, onNoHistory?: () => void) {
  installHistoryLayers();
  const g: Guard = { active: false, ask, entry: null, bypassed: false };
  if (onNoHistory) g.onNoHistory = onNoHistory;
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

/**
 * For code that leaves the page (router.push) from a component that doesn't own the page's unsaved guard, such as a
 * pop-up in the page header while the builder below has unsaved edits: asks "Discard changes?" when a guard is active
 * and, on Discard, takes the guard off (like UnsavedGuard.confirm() then release()). True when it is fine to leave.
 */
export async function confirmLeavePage(): Promise<boolean> {
  const active = [...guards].filter((g) => g.active && !g.bypassed);
  if (active.length === 0) return true;
  if (!(await active[0]!.ask())) return false;
  for (const g of active) g.bypassed = true;
  await Promise.all(active.map((g) => dropGuardEntry(g)));
  return true;
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
  closedAddresses.clear();
  pendingPushPath = null;
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
