import { cx } from './cx';
import styles from './ui.module.css';

export function Logo({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string | undefined }) {
  return (
    <span role="img" aria-label="CalTracker" className={cx(styles.logo, styles[`logo-${size}`], className)}>
      <span className={styles.logoMark}>Cal</span>Tracker
    </span>
  );
}
