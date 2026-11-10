import styles from './admin.module.css';

export type PillTone = 'lime' | 'tape' | 'blue' | 'grey';

/** A small status tag ("Good", "Invite expired"). The words carry the meaning, not the colour. */
export function Pill({ tone = 'grey', children }: { tone?: PillTone; children: string }) {
  return <span className={`${styles.pill} ${styles[`pill-${tone}`]}`}>{children}</span>;
}
