import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import styles from './coming-soon.module.css';

/**
 * A part of the page whose feature has not shipped yet. It is greyed with a dashed outline, is not a link or a
 * button, and says "coming soon" in words so screen readers announce it too. `label` must be fixed product copy
 * (it is shown in session recordings).
 */
export function ComingSoon({ label, children, className }: { label: string; children?: ReactNode; className?: string | undefined }) {
  return (
    <span role="note" aria-label={`${label}, coming soon`} className={cx(styles.soon, className)}>
      <span data-ph-safe="">{label}</span>
      {children}
      <span className={styles.note} data-ph-safe="">
        coming soon
      </span>
    </span>
  );
}
