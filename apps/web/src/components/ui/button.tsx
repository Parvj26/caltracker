'use client';

import Link from 'next/link';
import { useId, type ButtonHTMLAttributes, type ComponentProps, type MouseEvent } from 'react';
import { cx } from './cx';
import styles from './ui.module.css';

/**
 * The button set (docs/design/ui-rules.md §4):
 * - `primary` (Main): ink, white text, a decorative lime under-shadow. The one main action of a view.
 * - `create`: lime with an ink border, for making a new thing ("+ New workout"). The only lime button.
 * - `secondary`: ink outline (Cancel, alternatives).
 * - `quiet`: light grey, ink text, no border: the one action repeated on every list row (Assign, Resend).
 * - `danger`: red, only the confirm button of a destructive confirm ("Delete workout").
 * - `finish`: blue, Finish in live sessions only.
 */
export type ButtonVariant = 'primary' | 'create' | 'secondary' | 'quiet' | 'danger' | 'finish';
/** `regular` is 48 px tall; `compact` 44 px, for dense toolbars and list rows. */
export type ButtonSize = 'regular' | 'compact';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** While true the button can't be used and is announced as busy. */
  pending?: boolean;
  /**
   * Why the button can't be used yet ("Pick at least 1 client"): read out with the button (aria-describedby). A
   * disabled button stays focusable (aria-disabled) so this can be found.
   */
  disabledReason?: string | undefined;
  /** Its text, its labels (aria-label, title) and everything inside it are fixed product copy (never a name, number or anything typed): shown in session recordings. */
  phSafe?: boolean;
};

/**
 * A kit button. `disabled` (and `pending`) keep it focusable: it gets aria-disabled, shows at half strength and does
 * nothing when pressed, instead of the native disabled attribute that hides it from the keyboard.
 */
export function Button({
  variant = 'primary',
  size = 'regular',
  pending = false,
  phSafe = false,
  disabled,
  disabledReason,
  className,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const inert = Boolean(disabled) || pending;
  const reason = inert && disabledReason && !pending ? disabledReason : null;
  const describedBy = cx(rest['aria-describedby'], reason ? reasonId : null) || undefined;
  return (
    <>
      <button
        {...rest}
        data-ph-safe={phSafe ? '' : undefined}
        type={type}
        aria-disabled={inert || undefined}
        aria-busy={pending || undefined}
        aria-describedby={describedBy}
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          // Also stops a disabled submit button from sending its form (a click, or Enter in a field).
          if (inert) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
        className={cx(styles.button, styles[variant], size === 'compact' && styles.compact, className)}
      />
      {reason ? (
        <span id={reasonId} hidden>
          {reason}
        </span>
      ) : null}
    </>
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Its text, its labels (aria-label, title) and everything inside it are fixed product copy (never a name, number or anything typed): shown in session recordings. */
  phSafe?: boolean;
};

/** A link that looks like a Button (use for navigation and external links). Callers add rel/target for external URLs. */
export function ButtonLink({ variant = 'primary', size = 'regular', phSafe = false, className, ...rest }: ButtonLinkProps) {
  return (
    <Link
      {...rest}
      data-ph-safe={phSafe ? '' : undefined}
      className={cx(styles.button, styles[variant], size === 'compact' && styles.compact, className)}
    />
  );
}
