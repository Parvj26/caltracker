'use client';

import styles from './builder.module.css';

export type Link = {
  on: boolean;
  /** "Superset Bench Press with Bicep Curl". */
  label: string;
  /** Why it can't change now (a tooltip), or null when it can. */
  blocked: string | null;
  onToggle: () => void;
};

/**
 * The switch between two exercises: on joins them in a superset, off splits it there. iPad and desktop show a
 * labelled "Superset" switch; the phone list a link icon.
 */
export function SupersetSwitch({ link, variant }: { link: Link; variant: 'switch' | 'icon' }) {
  return (
    <div className={variant === 'icon' ? styles.linkRow : styles.switchRow} data-on={link.on ? '' : undefined}>
      <span className={styles.switchLine} aria-hidden="true" />
      <button
        type="button"
        className={variant === 'icon' ? styles.linkButton : styles.switchButton}
        aria-pressed={link.on}
        aria-label={link.label}
        title={link.blocked ?? undefined}
        disabled={link.blocked !== null}
        onClick={link.onToggle}
        data-ph-capture-attribute-label="workout_superset_switch"
      >
        {variant === 'icon' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
            <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
          </svg>
        ) : (
          <>
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchThumb} />
            </span>
            Superset
          </>
        )}
      </button>
      <span className={styles.switchLine} aria-hidden="true" />
    </div>
  );
}
