import Link from 'next/link';
import { cx } from '@/components/ui/cx';
import styles from './library.module.css';

const TABS = [
  { href: '/workouts', label: 'Workouts' },
  { href: '/exercises', label: 'Exercises' },
  { href: '/programs', label: 'Programs' },
  // Movement assessments: templates now (AS11), corrective exercises with step 2 (AS8).
  { href: '/corrective', label: 'Corrective' },
] as const;

/** The row at the top of the Workouts, Exercises, Programs and Corrective lists, to switch between them without the Library menu. */
export function LibraryTabs({ current }: { current: (typeof TABS)[number]['href'] }) {
  return (
    <nav aria-label="Library sections">
      <ul className={styles.tabs}>
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className={cx(styles.tab, t.href === current && styles.tabOn)}
              aria-current={t.href === current ? 'page' : undefined}
              data-ph-capture-attribute-label={`library_tab_${t.href.slice(1)}`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
