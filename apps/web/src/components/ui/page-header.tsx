import Link from 'next/link';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { ButtonLink } from './button';
import { ChevronIcon } from './chevron-icon';
import { cx } from './cx';
import styles from './layout.module.css';

export type PageHeaderProps = {
  /** The page's one h1. In an editor this is the thing's name. */
  title: ReactNode;
  /** "‹ Meals": the parent page, one style everywhere. */
  back?: { href: string; label: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void } | undefined;
  /** A count right after the title ("12"), counting what the coach means. */
  count?: ReactNode;
  /** One short line under the title. */
  subtitle?: ReactNode;
  /** At most one main or create button (UI rules §8). */
  action?: ReactNode;
  /** The ⋯ menu, after the action. */
  more?: ReactNode;
  /** Render the title as a plain paragraph when another element on the page is the h1 (two-pane pages). */
  titleAs?: 'h1' | 'p';
  titleId?: string;
  /** Phone-sized header: the action and ⋯ go on their own row under the title, so a long title keeps the full width. */
  stackOnPhone?: boolean;
  className?: string | undefined;
};

/**
 * The page title row (docs/design/ui-rules.md §8): an optional "‹ Parent" back link, the h1 with an optional count and
 * subtitle, and on the right at most one main/create button plus ⋯. On a phone the action shrinks to a compact button.
 */
export function PageHeader({ title, back, count, subtitle, action, more, titleAs = 'h1', titleId, stackOnPhone = false, className }: PageHeaderProps) {
  const Title = titleAs;
  return (
    <header className={cx(styles.pageHeader, className)} data-stack={stackOnPhone ? '' : undefined}>
      {back ? <ParentLink href={back.href} label={back.label} onClick={back.onClick} /> : null}
      <div className={styles.pageHeaderRow}>
        <div className={styles.pageHeaderText}>
          <Title id={titleId} className={styles.pageTitle}>
            {title}
            {count !== undefined && count !== null ? <span className={styles.pageCount}> {count}</span> : null}
          </Title>
          {subtitle ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
        </div>
        {action || more ? (
          <div className={styles.pageActions}>
            {action}
            {more}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** "‹ Meals": the one back-link style. The visible text is the parent's name; screen readers hear "Back to Meals". */
export function ParentLink({
  href,
  label,
  onClick,
  className,
}: {
  href: string;
  label: string;
  onClick?: ((e: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  className?: string | undefined;
}) {
  return (
    <Link href={href} {...(onClick ? { onClick } : {})} className={cx(styles.backLink, className)} data-back-link="">
      <ChevronIcon direction="left" size={20} />
      <span className={styles.srOnly}>Back to </span>
      {label}
    </Link>
  );
}

/**
 * "+ New meal": the create button for a list page's header. On a phone it is compact and reads "+ New" (the full name
 * stays in its accessible name), per UI rules §8.
 */
export function CreateLink({ href, thing, className, ...rest }: { href: string; thing: string; className?: string } & Omit<ComponentProps<typeof ButtonLink>, 'href' | 'children'>) {
  return (
    <ButtonLink href={href} variant="create" aria-label={`New ${thing}`} className={cx(styles.createLink, className)} {...rest}>
      <span>
        + New<span className={styles.createThing}> {thing}</span>
      </span>
    </ButtonLink>
  );
}
