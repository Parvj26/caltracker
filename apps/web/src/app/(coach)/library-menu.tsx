'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cycleTabTarget } from './focus-trap';
import { NAV_ICONS } from './nav-icons';
import { isLibraryPath } from './tab-bar-model';
import coach from './coach.module.css';
import styles from './library.module.css';

const PHONE_QUERY = '(max-width: 599.98px)';

const SECTIONS = [
  { href: '/workouts', letter: 'W', name: 'Workouts', sub: 'Single sessions you build and assign', phoneSub: 'Single sessions' },
  { href: '/exercises', letter: 'E', name: 'Exercise library', sub: 'Built-in and your own exercises', phoneSub: 'Built-in and your own' },
  { href: '/programs', letter: 'P', name: 'Programs', sub: 'Weeks of workouts on a schedule', phoneSub: 'Weeks on a schedule' },
] as const;

/**
 * Keyboard and pointer handling for an open Library panel: focus starts on the first choice, Escape closes and returns
 * focus to the button that opened it, Tab goes round the choices (and that button), and a press outside closes it.
 */
function usePanel(open: boolean, close: (refocus: boolean) => void, trigger: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const choices = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href]') ?? []);
    choices()[0]?.focus({ preventScroll: true });
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

function Choices({ phone, onPick }: { phone: boolean; onPick: () => void }) {
  const pathname = usePathname();
  return (
    <ul className={styles.choices}>
      {SECTIONS.map((s) => {
        const current = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <li key={s.href}>
            <Link
              href={s.href}
              className={styles.choice}
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
                  {phone ? s.phoneSub : s.sub}
                </span>
              </span>
              <ChevronIcon direction="right" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The sidebar's Library item (iPad and desktop). It opens a pop-up beside it with Workouts, Exercise library and
 * Programs; it is lit on any of those pages. On an iPhone the tab bar has Library instead, so the More sheet hides it.
 */
export function LibraryNavItem({ className }: { className?: string | undefined }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = isLibraryPath(pathname);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);
  usePanel(open, close, buttonRef, panelRef);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const button = buttonRef.current;
      if (!button) return;
      const { top: buttonTop } = button.getBoundingClientRect();
      const menuEdge = (button.closest('aside') ?? button).getBoundingClientRect().right;
      const height = panelRef.current?.offsetHeight ?? 0;
      const gap = 12;
      const top = Math.max(gap, Math.min(buttonTop - gap, window.innerHeight - height - gap));
      setPlace({ top, left: menuEdge + gap });
    };
    position();
    const phone = window.matchMedia(PHONE_QUERY);
    const onPhone = () => {
      if (phone.matches) setOpen(false);
    };
    window.addEventListener('resize', position);
    phone.addEventListener('change', onPhone);
    return () => {
      window.removeEventListener('resize', position);
      phone.removeEventListener('change', onPhone);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cx(coach.navItem, current && coach.navItemCurrent, className)}
        aria-label="Library"
        title="Library"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-current={current ? 'true' : undefined}
        data-ph-capture-attribute-label="nav_library"
        onClick={() => setOpen((o) => !o)}
      >
        {NAV_ICONS.workouts}
        <span className={coach.navLabel} data-ph-safe="">
          Library
        </span>
      </button>
      {open ? (
        <>
          <div className={styles.backdrop} aria-hidden="true" />
          <div ref={panelRef} role="dialog" aria-label="Library" className={styles.popover} style={place} data-library-menu="">
            <p className={styles.heading} aria-hidden="true">
              Library
            </p>
            <Choices phone={false} onPick={() => close(false)} />
          </div>
        </>
      ) : null}
    </>
  );
}

/** The iPhone's Library sheet: the same three choices as big buttons, just above the tab bar. */
export function LibrarySheet({ open, close, trigger }: { open: boolean; close: (refocus: boolean) => void; trigger: RefObject<HTMLButtonElement | null> }) {
  const panelRef = useRef<HTMLDivElement>(null);
  usePanel(open, close, trigger, panelRef);
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
        <Choices phone onPick={() => close(false)} />
      </div>
    </>
  );
}
