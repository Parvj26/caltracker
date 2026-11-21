import Link from 'next/link';
import { cx } from '@/components/ui/cx';
import styles from './templates/templates.module.css';

/**
 * Library › Corrective's own sections (AS8, AS11): the corrective exercises first, then the assessment templates. With
 * one section there would be nothing to switch, so the row stays hidden.
 */
const SECTIONS: readonly { href: string; label: string }[] = [
  { href: '/corrective/exercises', label: 'Exercises' },
  { href: '/corrective/templates', label: 'Templates' },
];

export function CorrectiveTabs({ current }: { current: string }) {
  if (SECTIONS.length < 2) return null;
  return (
    <nav aria-label="Corrective sections">
      <ul className={styles.subTabs}>
        {SECTIONS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className={cx(styles.subTab, s.href === current && styles.subTabOn)} aria-current={s.href === current ? 'page' : undefined}>
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
