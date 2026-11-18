'use client';

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { FOCUSABLE, PICKER, isTouchScreen } from '@/components/calendar/show-dialog';
import { useHistoryLayer } from '@/lib/use-history-layer';
import { Button } from './button';
import { cx } from './cx';
import styles from './adaptive-dialog.module.css';

/** A bottom sheet below this (phone, phone sideways, iPad Split View); a centred dialog otherwise. Matches the CSS. */
export const SHEET_MEDIA = '(max-width: 599.98px), (max-height: 499.98px)';
/** How far a sheet is dragged down by its top bar before letting go closes it. */
const SWIPE_CLOSE_PX = 80;

export type AdaptiveDialogHandle = {
  /** Closes straight away (after a save, say), without the "Discard changes?" question. Resolves once closed. */
  close: () => Promise<void>;
  /** Closes the way × does: asks "Discard changes?" first while `dirty`, and does nothing while `busy`. */
  requestClose: () => void;
};

export type AdaptiveDialogProps = {
  /** Names this pop-up in the address while it is open (`?sheet=<historyId>`), so Back closes it. Unique per item. */
  historyId: string;
  title: ReactNode;
  /** The title is fixed product copy (no names): shown in session recordings. */
  titleSafe?: boolean;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** The action buttons, pinned under the scrolling body. Main action last. */
  footer?: ReactNode;
  /** Called once the dialog has closed, whichever way (×, Esc, backdrop, swipe down, Back, close()). */
  onClose: () => void;
  /** Unsaved changes: ×, Esc, backdrop, swipe down and Back ask "Discard changes?" first. */
  dirty?: boolean;
  /** Extra words after "Discard changes?" (what would be lost). */
  discardText?: string;
  /** Saving: nothing closes it until done. */
  busy?: boolean;
  /** Centred width on iPad and desktop: medium 560, wide 800. */
  size?: 'medium' | 'wide';
  role?: 'dialog' | 'alertdialog';
  /** The id of the text that describes the dialog (a confirm's question). */
  describedBy?: string;
  /** On touch screens start on the dialog itself, so no keyboard or picker pops open (pickers, long lists). */
  noKeyboardOnTouch?: boolean;
  /** Phone: the footer buttons stack full width, the last (main) one on top (destructive confirms). */
  stackFooterOnPhone?: boolean;
  /** Phone (narrow): fill the whole screen instead of growing to fit (long forms: Assign, pickers, scan entry). */
  fullScreenOnPhone?: boolean;
  className?: string;
  ref?: Ref<AdaptiveDialogHandle>;
};

/**
 * The one pop-up (docs/design/ui-rules.md §5). A bottom sheet when the window is narrow (< 600) or short (< 500, a
 * phone on its side or an iPad with the keyboard up), else a dialog centred in the window. The title bar and the
 * buttons stay put; only the middle scrolls, and the buttons stay above the on-screen keyboard. It is one step of
 * browser history, so Back and iOS swipe-back close it. Never open another dialog from inside one.
 *
 * Mount it to open it; it calls onClose when it has closed. Focus moves in on open and returns to whatever opened it.
 */
export function AdaptiveDialog({
  historyId,
  title,
  titleSafe = false,
  subtitle,
  children,
  footer,
  onClose,
  dirty = false,
  discardText,
  busy = false,
  size = 'medium',
  role = 'dialog',
  describedBy,
  noKeyboardOnTouch = false,
  stackFooterOnPhone = false,
  fullScreenOnPhone = false,
  className,
  ref,
}: AdaptiveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const discardId = useId();
  const [asking, setAsking] = useState(false);
  const closed = useRef(false);
  const state = useRef({ dirty, busy, onClose });
  useEffect(() => {
    state.current = { dirty, busy, onClose };
  }, [dirty, busy, onClose]);

  const finish = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    state.current.onClose();
  }, []);

  const { release } = useHistoryLayer({
    id: historyId,
    onBack: () => {
      if (closed.current) return;
      const { dirty: isDirty, busy: isBusy } = state.current;
      if (isBusy) return false;
      if (isDirty) {
        setAsking(true);
        return false;
      }
      closed.current = true;
      finish();
    },
  });

  const close = useCallback(async () => {
    if (closed.current) return;
    closed.current = true;
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    await release();
    state.current.onClose();
  }, [release]);

  const requestClose = useCallback(() => {
    if (closed.current || state.current.busy) return;
    if (state.current.dirty) {
      setAsking(true);
      return;
    }
    void close();
  }, [close]);

  useImperativeHandle(ref, () => ({ close, requestClose }), [close, requestClose]);

  // Open on mount, give focus back to the opener on unmount.
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) {
      const target = openingFocus(dialog, bodyRef.current, footerRef.current, role, noKeyboardOnTouch);
      if (target === dialog) dialog.tabIndex = -1;
      dialog.showModal();
      target.focus();
    }
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [noKeyboardOnTouch, role]);

  // Changes saved or undone meanwhile, or saving: nothing to ask about.
  const showDiscard = asking && dirty && !busy;
  // The question takes focus, so a keyboard or screen reader user meets it.
  useEffect(() => {
    if (showDiscard) discardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [showDiscard]);

  // The on-screen keyboard: keep the dialog (and its buttons) inside the visible part of the window.
  useEffect(() => {
    const dialog = dialogRef.current;
    const vv = window.visualViewport;
    if (!dialog || !vv) return;
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      dialog.style.setProperty('--ad-vv-h', `${vv.height}px`);
      dialog.style.setProperty('--ad-kb', `${covered}px`);
      const focused = document.activeElement;
      if (covered > 0 && focused instanceof HTMLElement && dialog.contains(focused) && focused.matches('input, select, textarea')) {
        focused.scrollIntoView({ block: 'nearest' });
      }
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Backdrop: a press that starts and ends outside the box (not a text selection dragged out of it).
  const pressedOutside = useRef(false);
  const outside = (e: { clientX: number; clientY: number }) => {
    const box = dialogRef.current?.getBoundingClientRect();
    if (!box) return false;
    return e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
  };

  // Swipe down on the sheet's top bar.
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const onDragStart = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || !window.matchMedia(SHEET_MEDIA).matches) return;
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { startY: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const dialog = dialogRef.current;
    if (!d || !dialog) return;
    d.dy = Math.max(0, e.clientY - d.startY);
    dialog.style.transform = d.dy > 0 ? `translateY(${d.dy}px)` : '';
  };
  const onDragEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (dialogRef.current) dialogRef.current.style.transform = '';
    if (d && d.dy > SWIPE_CLOSE_PX) requestClose();
  };

  return (
    <dialog
      ref={dialogRef}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      className={cx(styles.dialog, size === 'wide' && styles.wide, stackFooterOnPhone && styles.stack, fullScreenOnPhone && styles.full, className)}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onKeyDown={(e: KeyboardEvent<HTMLDialogElement>) => {
        // A control inside (a search box clearing itself) already handled it.
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        // Ours to decide (busy, unsaved changes), not the browser's.
        e.preventDefault();
        // Esc in a search field with text clears the text first; the next Esc closes.
        const field = e.target;
        if (field instanceof HTMLInputElement && field.type === 'search' && field.value !== '') {
          clearField(field);
          return;
        }
        e.stopPropagation();
        if (showDiscard) setAsking(false);
        else requestClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClose={() => {
        // Closed by the browser itself (not by us): treat it as a close.
        if (closed.current) return;
        closed.current = true;
        void release().then(() => state.current.onClose());
      }}
      onPointerDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget && outside(e);
      }}
      onClick={(e: MouseEvent<HTMLDialogElement>) => {
        if (pressedOutside.current && e.target === e.currentTarget && outside(e)) requestClose();
        pressedOutside.current = false;
      }}
    >
      <div className={styles.header} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        <span className={styles.grabber} aria-hidden="true" />
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title} {...(titleSafe ? { 'data-ph-safe': '' } : {})}>
            {title}
          </h2>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        <button type="button" className={styles.close} aria-label="Close" aria-disabled={busy || undefined} onClick={requestClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div ref={bodyRef} className={styles.body}>
        {children}
      </div>
      {showDiscard ? (
        <div ref={discardRef} className={styles.discard} role="group" aria-labelledby={discardId}>
          <p id={discardId} className={styles.discardText} data-ph-safe="">
            <strong>Discard changes?</strong>
            {discardText ? ` ${discardText}` : null}
          </p>
          <div className={styles.discardActions}>
            <Button variant="secondary" size="compact" onClick={() => setAsking(false)} phSafe>
              Keep editing
            </Button>
            <Button variant="danger" size="compact" onClick={() => void close()} phSafe>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      {footer ? (
        <div ref={footerRef} className={styles.footer}>
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Where focus starts (UI rules §5.7): a confirm starts on its safe button (the first in the footer, Cancel); a form on
 * its [autofocus] field or its first control, but never on a native picker (that pops open: its search box, else the
 * dialog itself). With noKeyboardOnTouch a touch screen starts on the dialog itself, so no keyboard pops up.
 */
function openingFocus(
  dialog: HTMLDialogElement,
  body: HTMLElement | null,
  footer: HTMLElement | null,
  role: 'dialog' | 'alertdialog',
  noKeyboardOnTouch: boolean,
): HTMLElement {
  if (noKeyboardOnTouch && isTouchScreen()) return dialog;
  if (role === 'alertdialog') return footer?.querySelector<HTMLElement>('button') ?? dialog;
  const first = body?.querySelector<HTMLElement>('[autofocus]') ?? body?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
  if (first?.matches(PICKER)) return body?.querySelector<HTMLElement>('input[type="search"]:not(:disabled)') ?? dialog;
  return first ?? dialog;
}

/** Empties a (React-controlled) field the way typing would, so its onChange runs. */
function clearField(field: HTMLInputElement) {
  // The native setter, called on this field (React ignores a plain `field.value = ''`).
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setValue?.call(field, '');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
