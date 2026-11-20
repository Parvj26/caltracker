import type { Size } from './ui-audit-allowlist';

// The 3-size UI audit's sizes and in-page rules (docs/design/ui-audit.md), shared by ui-audit.spec.ts (whole pages)
// and specs that audit a pop-up they opened (pass `scope`: only hscroll, target, overlap and text, inside it).

export const SIZES: { size: Size; use: { viewport: { width: number; height: number }; isMobile: boolean; hasTouch: boolean } }[] = [
  { size: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { size: 'tablet', use: { viewport: { width: 820, height: 1180 }, isMobile: false, hasTouch: true } },
  { size: 'desktop', use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false } },
];


export type Found = { rule: string; detail: string };

/**
 * Runs in the page. Returns the problems found and which allow-list entries (by index) excused something.
 * Self-contained: Playwright sends this function's source to the browser, so it can't use anything from outside.
 */
export function auditInPage(args: { minTarget: number; allow: { i: number; rule: string; selector?: string }[]; scope?: string }) {
  const found: { rule: string; detail: string }[] = [];
  const used = new Set<number>();
  const W = innerWidth;
  // A pop-up's own audit: only what is inside it (the page behind is audited on its own).
  const root: Element = (args.scope ? document.querySelector(args.scope) : null) ?? document.body;

  const excused = (rule: string, ...els: Element[]) => {
    for (const a of args.allow) {
      if (a.rule !== rule) continue;
      if (!a.selector || els.some((el) => el.matches(a.selector!))) {
        used.add(a.i);
        return true;
      }
    }
    return false;
  };
  // A short way to point at an element: tag, its CSS module class names (unhashed) and its name.
  const describe = (el: Element) => {
    const classes = [...el.classList].map((c) => c.replace(/^.*?_(?=[a-zA-Z])/, '')).filter(Boolean).slice(0, 2);
    const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || el.getAttribute('name') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    return `<${el.tagName.toLowerCase()}${classes.map((c) => ` _${c}`).join('')}>${name ? ` "${name}"` : ''}`;
  };
  type Box = { l: number; t: number; r: number; b: number };
  /** The part of the element the user can see (cut by scrolling/clipping parents and the screen's sides), or null. */
  const shown = (el: Element): Box | null => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    if (el.closest('[inert]')) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return null; // visually hidden (screen-reader only)
    const box = { l: Math.max(rect.left, 0), t: rect.top, r: Math.min(rect.right, W), b: rect.bottom };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const p = a.getBoundingClientRect();
        box.l = Math.max(box.l, p.left);
        box.t = Math.max(box.t, p.top);
        box.r = Math.min(box.r, p.right);
        box.b = Math.min(box.b, p.bottom);
      }
      if (s.position === 'fixed') break;
    }
    return box.r - box.l > 1 && box.b - box.t > 1 ? box : null;
  };
  /** The pinned bar (fixed or sticky) an element sits in: page content scrolling under a pinned bar is by design. */
  const pinnedIn = (el: Element): Element | null => {
    for (let a: Element | null = el; a; a = a.parentElement) {
      const p = getComputedStyle(a).position;
      if (p === 'fixed' || p === 'sticky') return a;
    }
    return null;
  };

  // hscroll
  const sw = document.scrollingElement!.scrollWidth;
  if (sw > W + 1 && !excused('hscroll')) found.push({ rule: 'hscroll', detail: `page is ${sw}px wide on a ${W}px screen` });

  // target + overlap
  const controls: { el: Element; box: Box; pin: Element | null }[] = [];
  const seen = new Set<Element>();
  for (const el of root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary')) {
    // A field inside a label is tapped through its label, so the label is the target (label > input).
    const target = (el.matches('input, select, textarea') && el.closest('label')) || el;
    if (seen.has(target)) continue;
    seen.add(target);
    const box = shown(target);
    if (!box) continue;
    // Inline text links inside a sentence are exempt (WCAG 2.5.8 "inline" exception).
    if (target.matches('a') && target.closest('p') && getComputedStyle(target).display === 'inline') continue;
    controls.push({ el: target, box, pin: pinnedIn(target) });
    const r = target.getBoundingClientRect();
    if ((r.width < args.minTarget - 0.5 || r.height < args.minTarget - 0.5) && !excused('target', target)) {
      found.push({ rule: 'target', detail: `${describe(target)} is ${Math.round(r.width)}x${Math.round(r.height)} (min ${args.minTarget})` });
    }
  }
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!;
      const b = controls[j]!;
      if (a.pin !== b.pin || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.box.r, b.box.r) - Math.max(a.box.l, b.box.l);
      const h = Math.min(a.box.b, b.box.b) - Math.max(a.box.t, b.box.t);
      if (w > 2 && h > 2 && !excused('overlap', a.el, b.el)) {
        found.push({ rule: 'overlap', detail: `${describe(a.el)} overlaps ${describe(b.el)} by ${Math.round(w)}x${Math.round(h)}` });
      }
    }
  }

  // text
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const tiny = new Set<string>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent?.trim() || el.closest('script, style, noscript')) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size >= 12 || !shown(el) || excused('text', el)) continue;
    const line = `${describe(el)} is ${size}px`;
    if (!tiny.has(line)) found.push({ rule: 'text', detail: line });
    tiny.add(line);
  }

  if (args.scope) return { found, used: [...used] };

  // logo
  const logos = [...document.querySelectorAll('[role=img][aria-label="CalTracker"]')].filter((el) => shown(el)).length;
  if (logos !== 1 && !excused('logo')) found.push({ rule: 'logo', detail: `${logos} visible logos (want exactly 1)` });

  // heading
  const h1 = [...document.querySelectorAll('h1')].find((el) => shown(el));
  if (!h1) {
    if (!excused('heading')) found.push({ rule: 'heading', detail: 'no visible main heading (h1)' });
  } else {
    const r = h1.getBoundingClientRect();
    if ((r.top < 0 || r.bottom > innerHeight) && !excused('heading', h1)) {
      found.push({ rule: 'heading', detail: `${describe(h1)} is not on the first screen (top ${Math.round(r.top)})` });
    }
  }
  return { found, used: [...used] };
}

