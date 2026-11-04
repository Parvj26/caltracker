import { cx } from './cx';
import styles from './ui.module.css';

type LogoProps = {
  size?: 'md' | 'lg';
  /** `mark` shows only the lime "Cal" tile, for tight spaces such as the collapsed sidebar. */
  variant?: 'full' | 'mark';
  className?: string | undefined;
};

export function Logo({ size = 'md', variant = 'full', className }: LogoProps) {
  return (
    <span role="img" aria-label="CalTracker" className={cx(styles.logo, styles[`logo-${size}`], className)}>
      <span className={styles.logoMark}>Cal</span>
      {variant === 'full' ? 'Tracker' : null}
    </span>
  );
}
