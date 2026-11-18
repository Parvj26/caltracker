'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cycleTabTarget } from './focus-trap';
import { NAV_ICONS } from './nav-icons';
import { isLibraryPath } from './tab-bar-model';
import { useBackLayer } from '@/lib/open-layer';
import coach from './coach.module.css';
import styles from './library.module.css';

const PHONE_QUERY = '(max-width: 599.98px)';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SECTIONS = [
  { href: '/workouts', letter: 'W', name: 'Workouts', sub: 'Single sessions' },
  { href: '/exercises', letter: 'E', name: 'Exercise library', sub: 'Built-in and your own' },
  { href: '/programs', letter: 'P', name: 'Programs', sub: 'Weeks on a schedule' },
] as const;

/**
 * Keyboard and pointer handling for an open Library panel: focus starts on the first choice, Escape closes and returns
 * focus to the button that opened it, Tab goes round what the panel shows (and that button), and a press outside or a
 * change of page (back or forward) closes it.
 */
function usePanel(open: boolean, close: (refocus: boolean) => void, trigger: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>) {
  const pathname = usePathname();
  const openedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!open) openedOn.current = null;
    else if (openedOn.current === null) openedOn.current = pathname;
    else if (openedOn.current !== pathname) close(false);
  }, [open, pathname, close]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
    const choices = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.getClientRects().length > 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab') {
        const list = [...choices(), ...(trigger.current ? [trigger.current] : [])];
        const target = cycleTabTarget(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (target !== null) {
          e.preventDefault();
          list[target]?.focus();
        }
      }
    };
    const outside = (e: PointerEvent) => {
      const at = e.target as Node;
      if (!panel.current?.contains(at) && !trigger.current?.contains(at)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, close, trigger, panel]);
}

/** The three choices. The rail menu is the compact list; the iPhone sheet has big buttons. Both use the short lines. */
function Choices({ onPick, menu = false }: { onPick: () => void; menu?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={styles.choices} {...(menu ? { role: 'menu', 'aria-label': 'Library' } : {})}>
      {SECTIONS.map((s) => {
        const current = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <li key={s.href} {...(menu ? { role: 'none' } : {})}>
            <Link
              href={s.href}
              className={styles.choice}
              {...(menu ? { role: 'menuitem' } : {})}
              aria-current={current ? 'page' : undefined}
              data-ph-capture-attribute-label={`library_${s.href.slice(1)}`}
              onClick={onPick}
            >
              <span className={styles.letter} aria-hidden="true">
                {s.letter}
              </span>
              <span className={styles.choiceText}>
                <span className={styles.choiceName} data-ph-safe="">
                  {s.name}
                </span>
                <span className={styles.choiceSub} data-ph-safe="">
                  {s.sub}
                </span>
              </span>
              <span className={styles.chevron}>
                <ChevronIcon direction="right" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The labelled sidebar (desktop, 1200 px and up); below it the sidebar is an icon rail. Matches coach.module.css. */
const WIDE_QUERY = '(min-width: 1200px)';
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(WIDE_QUERY);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

/**
 * The sidebar's Library item (ui-rules §8 "Library menu"). Desktop (labelled sidebar): Library opens and closes in
 * place, with Workouts, Exercise library and Programs indented under it; it is open, with the page you are on lit,
 * on any of those pages. iPad (icon rail): a small menu right beside the icon, without dimming the page; Escape, a tap
 * outside, Back or a change of page closes it, and focus goes back to the icon. On an iPhone the tab bar has Library.
 */
export function LibraryNavItem({ className }: { className?: string | undefined }) {
  const pathname = usePathname();
  const wide = useWide();
  const current = isLibraryPath(pathname);
  const subId = useId();
  // Desktop: open while on a library page; the coach can fold it away.
  const [expanded, setExpanded] = useState(current);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (isLibraryPath(seenPath) !== current) setExpanded(current);
  }
  // iPad: the rail's menu.
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);
  usePanel(open, close, buttonRef, panelRef);
  // Back (and iOS swipe-back) closes the menu, not the page.
  useBackLayer(open, () => close(true));

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const button = buttonRef.current;
      if (!button) return;
      const { top: buttonTop, height: buttonHeight } = button.getBoundingClientRect();
      const menuEdge = (button.closest('aside') ?? button).getBoundingClientRect().right;
      const height = panelRef.current?.offsetHeight ?? 0;
      const gap = 12;
      // Its first choice level with the icon, kept inside the window.
      const top = Math.max(gap, Math.min(buttonTop + buttonHeight / 2 - 32, window.innerHeight - height - gap));
      setPlace({ top, left: menuEdge + 8 });
    };
    position();
    const phoneOrWide = [window.matchMedia(PHONE_QUERY), window.matchMedia(WIDE_QUERY)];
    const onLayout = () => {
      if (phoneOrWide.some((m) => m.matches)) setOpen(false);
    };
    window.addEventListener('resize', position);
    for (const m of phoneOrWide) m.addEventListener('change', onLayout);
    return () => {
      window.removeEventListener('resize', position);
      for (const m of phoneOrWide) m.removeEventListener('change', onLayout);
    };
  }, [open]);

  // Arrow keys move through the menu's choices.
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a[href]') ?? []);
    const at = links.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    links[(at + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus();
  };

  const showOpen = wide ? expanded : open;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cx(coach.navItem, styles.libraryButton, current && !(wide && expanded) && coach.navItemCurrent, className)}
        aria-label="Library"
        title="Library"
        aria-expanded={showOpen}
        aria-controls={wide ? subId : undefined}
        aria-haspopup={wide ? undefined : 'menu'}
        aria-current={current ? 'true' : undefined}
        data-ph-capture-attribute-label="nav_library"
        onClick={() => (wide ? setExpanded((x) => !x) : setOpen((o) => !o))}
      >
        {NAV_ICONS.workouts}
        <span className={coach.navLabel} data-ph-safe="">
          Library
        </span>
        <span className={styles.caret} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
        <ul id={subId} className={cx(styles.subnav, className)} aria-label="Library">
          {SECTIONS.map((s) => {
            const on = pathname === s.href || pathname.startsWith(`${s.href}/`);
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className={cx(styles.subItem, on && styles.subItemOn)}
                  aria-current={on ? 'page' : undefined}
                  data-ph-capture-attribute-label={`library_${s.href.slice(1)}`}
                  data-ph-safe=""
                >
                  {s.name}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      {open && !wide ? (
        <div ref={panelRef} className={styles.popover} style={place} data-library-menu="" onKeyDown={onMenuKey}>
          <Choices menu onPick={() => close(false)} />
        </div>
      ) : null}
    </>
  );
}

/** The iPhone's Library sheet: the same three choices as big buttons, just above the tab bar. */
export function LibrarySheet({ open, close, trigger }: { open: boolean; close: (refocus: boolean) => void; trigger: RefObject<HTMLButtonElement | null> }) {
  const panelRef = useRef<HTMLDivElement>(null);
  usePanel(open, close, trigger, panelRef);
  useBackLayer(open, () => close(true));
  useEffect(() => {
    if (!open) return;
    const phone = window.matchMedia(PHONE_QUERY);
    const onResize = () => {
      if (!phone.matches) close(false);
    };
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    phone.addEventListener('change', onResize);
    return () => {
      root.style.overflow = overflow;
      phone.removeEventListener('change', onResize);
    };
  }, [open, close]);
  if (!open) return null;
  return (
    <>
      <div className={coach.backdrop} data-menu-backdrop="" aria-hidden="true" />
      <div ref={panelRef} id="library-sheet" role="dialog" aria-modal="true" aria-label="Library" className={styles.sheet}>
        <span className={styles.grab} aria-hidden="true" />
        <button type="button" className={coach.srClose} onClick={() => close(true)}>
          Close library
        </button>
        <Choices onPick={() => close(false)} />
      </div>
    </>
  );
}
