import { cx } from './cx';
import styles from './ui.module.css';

type LogoProps = {
  size?: 'md' | 'lg';
  /** `mark` shows only the C mark, for tight spaces such as the collapsed sidebar. */
  variant?: 'full' | 'mark';
  className?: string | undefined;
};

/** The CalTracker mark: a "C" drawn as an almost-closed progress ring, finishing with a pink dot.
 *  Same drawing as packages/design-tokens/assets/logo-mark.svg, coloured through tokens. */
export function LogoMark({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" className={cx(styles.logoMark, className)}>
      <rect width="120" height="120" rx="27" style={{ fill: 'var(--ct-lime)' }} />
      <path
        d="M84 36 A34 34 0 1 0 84 84"
        fill="none"
        strokeWidth="16"
        strokeLinecap="round"
        style={{ stroke: 'var(--ct-ink)' }}
      />
      <circle cx="90" cy="60" r="9" style={{ fill: 'var(--ct-pink)' }} />
    </svg>
  );
}

export function Logo({ size = 'md', variant = 'full', className }: LogoProps) {
  return (
    <span role="img" aria-label="CalTracker" className={cx(styles.logo, styles[`logo-${size}`], className)}>
      <LogoMark />
      {variant === 'full' ? <span aria-hidden="true">caltracker</span> : null}
    </span>
  );
}
