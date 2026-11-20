import Link from 'next/link';
import styles from './admin.module.css';

/** "Show test accounts": a link that flips ?test=1, so the server renders the page with or without test workspaces. */
export function TestToggle({ on, href }: { on: boolean; href: string }) {
  return (
    <Link href={href} role="switch" aria-checked={on} className={styles.toggle} scroll={false}>
      <span className={styles.toggleTrack} aria-hidden="true">
        <span className={styles.toggleKnob} />
      </span>
      Show test accounts
    </Link>
  );
}
