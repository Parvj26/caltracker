import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';
import styles from './layout.module.css';

/**
 * A plain list of ListRows (docs/design/ui-rules.md §7): rows with dividers, no box around them. `columns` adds a
 * header row of column names that shows only when the list is wide enough for the rows' `cells` (a desktop table).
 */
export function RowList({
  children,
  columns,
  className,
  ...rest
}: { children: ReactNode; columns?: string[] | undefined; className?: string | undefined } & Omit<ComponentProps<'ul'>, 'children' | 'className'>) {
  return (
    <div className={cx(styles.rowList, className)} data-columns={columns ? columns.length : undefined}>
      {columns ? (
        <div className={styles.columnHeader} aria-hidden="true">
          <span />
          <span>{columns[0]}</span>
          {columns.slice(1).map((c) => (
            <span key={c} className={styles.cell}>
              {c}
            </span>
          ))}
          <span />
        </div>
      ) : null}
      <ul className={styles.rowListItems} {...rest}>
        {children}
      </ul>
    </div>
  );
}

export type ListRowProps = {
  /** The whole row opens this. Leave out for a row with nothing to open (a pending invite): then only its action and ⋯ act. */
  href?: string | undefined;
  title: ReactNode;
  /** One meta line (status chips go here, always in the same place). */
  meta?: ReactNode;
  /** Avatar or thumbnail. */
  leading?: ReactNode;
  /** Small non-interactive info at the end (a time, an unread count, a chevron). */
  end?: ReactNode;
  /** At most one visible action, `quiet` (UI rules §7.3). */
  action?: ReactNode;
  /** The ⋯ menu. */
  more?: ReactNode;
  /** Extra columns for a wide list with column headers (RowList `columns`); hidden when narrow (the meta line has them). */
  cells?: ReactNode[];
  /** This row is the one open beside the list. */
  current?: boolean;
  /** Bold title (an unread conversation). */
  emphasis?: boolean;
  linkProps?: Omit<ComponentProps<typeof Link>, 'href' | 'className' | 'children'> & Record<`data-${string}`, string | number | undefined>;
  /** Instead of `href`: the whole row is a button that opens something on this page (a pending invite's window). */
  onOpen?: (() => void) | undefined;
  /** The row button's name when `onOpen` is set (else its text). */
  openLabel?: string | undefined;
  /** data-* attributes for the row itself (the <li>), so tests and scripts can find it. */
  itemProps?: Record<`data-${string}`, string | number | undefined>;
  className?: string | undefined;
};

/**
 * One row of a list: leading avatar, title (up to 2 lines), one meta line, and at most one quiet action plus ⋯ at the
 * end. The whole row (all but the action and ⋯, which stay their own buttons) is one link, at least 56 px tall, with
 * hover and keyboard focus.
 */
export function ListRow({ href, title, meta, leading, end, action, more, cells, current = false, emphasis = false, linkProps, itemProps, onOpen, openLabel, className }: ListRowProps) {
  const inner = (
    <>
      {leading ? <span className={styles.listRowLeading}>{leading}</span> : null}
      <span className={styles.listRowText}>
        <span className={styles.listRowTitle}>{title}</span>
        {meta ? <span className={styles.listRowMeta}>{meta}</span> : null}
      </span>
      {cells?.map((c, i) => (
        <span key={i} className={styles.cell}>
          {c}
        </span>
      ))}
      {end ? <span className={styles.listRowEnd}>{end}</span> : null}
    </>
  );
  return (
    <li className={cx(styles.listRow, current && styles.listRowCurrent, emphasis && styles.listRowEmphasis, className)} {...itemProps}>
      {href !== undefined ? (
        <Link href={href} className={styles.listRowLink} aria-current={current ? 'page' : undefined} {...linkProps}>
          {inner}
        </Link>
      ) : onOpen ? (
        // The action and ⋯ are siblings of this button (never inside it), so tapping them never opens the row.
        <button type="button" className={cx(styles.listRowLink, styles.listRowButton)} onClick={onOpen} aria-label={openLabel}>
          {inner}
        </button>
      ) : (
        <div className={cx(styles.listRowLink, styles.listRowStatic)}>{inner}</div>
      )}
      {action || more ? (
        <span className={styles.listRowActions}>
          {action}
          {more}
        </span>
      ) : null}
    </li>
  );
}
