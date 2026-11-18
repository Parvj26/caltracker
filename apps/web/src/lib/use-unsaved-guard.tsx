'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AdaptiveDialog, type AdaptiveDialogHandle } from '@/components/ui/adaptive-dialog';
import { Button } from '@/components/ui/button';
import { addLeaveGuard } from './history-layers';

export type UnsavedGuard = {
  /** Render this somewhere in the page: the "Discard changes?" question, while it is asked. */
  prompt: ReactNode;
  /** Before leaving in code (a button that calls router.push): true when there is nothing to lose or Discard was picked. */
  confirm: () => Promise<boolean>;
  /** Leaving on purpose (just saved, Discard confirmed): stops guarding and takes its history entry off. Await it. */
  release: () => Promise<void>;
};

/**
 * Guards a page's unsaved changes (ui-rules §8): while `dirty`, Back and iOS swipe-back, in-app links (Next Link or a
 * plain <a>) and closing or reloading the tab all ask "Discard changes?" first, with Keep editing and Discard.
 * Navigations made in code are not seen by the guard, so they must ask themselves:
 *
 *   const guard = useUnsavedGuard(dirty);
 *   // A button that leaves the page:
 *   onClick={async () => { if (await guard.confirm()) router.push('/workouts'); }}
 *   // After a save, nothing to lose: take the guard off first, then navigate.
 *   await guard.release(); router.replace(`/workouts/${id}`);
 *
 * Render `guard.prompt` somewhere in the page.
 */
export function useUnsavedGuard(
  dirty: boolean,
  {
    message = 'What you changed here isn’t saved yet.',
    parentHref,
  }: {
    message?: string;
    /** Where Discard on Back goes when the page was opened directly (nothing behind it in this tab): its list. */
    parentHref?: string | undefined;
  } = {},
): UnsavedGuard {
  const [asking, setAsking] = useState<((discard: boolean) => void) | null>(null);
  const guard = useRef<ReturnType<typeof addLeaveGuard> | null>(null);
  const dirtyRef = useRef(dirty);

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        setAsking((prev: ((discard: boolean) => void) | null) => {
          // Asked again while open (a link and Back together): the earlier question is answered "keep".
          prev?.(false);
          return resolve;
        });
      }),
    [],
  );

  const parent = useRef(parentHref);
  useEffect(() => {
    parent.current = parentHref;
  }, [parentHref]);

  useEffect(() => {
    const g = addLeaveGuard(ask, () => {
      if (parent.current) window.location.assign(parent.current);
    });
    guard.current = g;
    g.setActive(dirtyRef.current);
    return () => {
      g.remove();
      guard.current = null;
    };
  }, [ask]);

  useEffect(() => {
    dirtyRef.current = dirty;
    guard.current?.setActive(dirty);
  }, [dirty]);

  const confirm = useCallback(async () => (dirtyRef.current ? ask() : true), [ask]);
  const release = useCallback(() => guard.current?.release() ?? Promise.resolve(), []);

  const answer = useCallback(
    (discard: boolean) => {
      asking?.(discard);
      setAsking(null);
    },
    [asking],
  );

  return { prompt: asking ? <DiscardPrompt message={message} onAnswer={answer} /> : null, confirm, release };
}

/** "Discard changes?" with Keep editing and Discard. Escape, ×, a tap outside and Back all mean Keep editing. */
export function DiscardPrompt({ message, onAnswer }: { message: string; onAnswer: (discard: boolean) => void }) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const answered = useRef(false);
  const textId = useId();
  const reply = (discard: boolean) => {
    if (answered.current) return;
    answered.current = true;
    onAnswer(discard);
  };
  return (
    <AdaptiveDialog
      ref={ref}
      historyId="discard-changes"
      role="alertdialog"
      title="Discard changes?"
      titleSafe
      describedBy={textId}
      stackFooterOnPhone
      onClose={() => reply(false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => void ref.current?.close().then(() => reply(false))} phSafe>
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              answered.current = true;
              void ref.current?.close().then(() => onAnswer(true));
            }}
            phSafe
          >
            Discard
          </Button>
        </>
      }
    >
      <p id={textId} data-ph-safe="">
        {message}
      </p>
    </AdaptiveDialog>
  );
}
