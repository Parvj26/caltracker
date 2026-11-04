import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';
import { cx } from './cx';
import styles from './ui.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'finish';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** While true the button is disabled and announced as busy. */
  pending?: boolean;
};

export function Button({ variant = 'primary', pending = false, disabled, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(styles.button, styles[variant], className)}
    />
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant };

/** A link that looks like a Button (use for navigation and external links). Callers add rel/target for external URLs. */
export function ButtonLink({ variant = 'primary', className, ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={cx(styles.button, styles[variant], className)} />;
}
