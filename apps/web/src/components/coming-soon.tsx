import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import styles from './coming-soon.module.css';

/**
 * A part of the page whose feature has not shipped yet. It is greyed with a dashed outline, is not a link or a
 * button, and says "coming soon" in words so screen readers announce it too.
 */
export function ComingSoon({ label, children, className }: { label: string; children?: ReactNode; className?: string | undefined }) {
  return (
    <span aria-disabled="true" className={cx(styles.soon, className)}>
      <span>{label}</span>
      {children}
      <span className={styles.note}>coming soon</span>
    </span>
  );
}
