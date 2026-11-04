import type { ButtonHTMLAttributes } from 'react';
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
