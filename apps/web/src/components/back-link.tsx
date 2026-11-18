'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps, MouseEvent } from 'react';
import { previousEntryIs, rememberedUrl } from '@/lib/history-back';
import { ChevronIcon } from './ui/chevron-icon';
import { cx } from './ui/cx';
import layout from './ui/layout.module.css';

/**
 * A "Back to …" link that steps back in history when the page it leads to is the one just behind (so that page comes
 * back exactly as it was left: its filters, its week, its view) and opens it otherwise, at the address it last had
 * in this tab (useRememberUrl), else `href`. Either way Back afterwards
 * doesn't loop to the page you just left. `backTo` is the path that counts as "the same page" (default: href's own).
 */
export function BackLink({ href, backTo, onClick, ...rest }: ComponentProps<typeof Link> & { href: string; backTo?: string }) {
  const router = useRouter();
  const path = backTo ?? new URL(href, 'http://x').pathname;
  function go(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (previousEntryIs((url) => url.pathname === path)) router.back();
    // Not just behind (or the browser can't say): open it as last seen in this tab (same filters, same week).
    else router.push(rememberedUrl(path, href));
  }
  return <Link href={href} onClick={go} {...rest} />;
}

/**
 * "‹ Maya Thompson": the one back-link look (ParentLink, UI rules §8) with BackLink's behaviour (steps back when that
 * page is just behind, else opens it as last seen in this tab). Screen readers hear "Back to …".
 */
export function ParentBackLink({ href, label, backTo, className }: { href: string; label: string; backTo?: string; className?: string | undefined }) {
  return (
    <BackLink href={href} {...(backTo ? { backTo } : {})} className={cx(layout.backLink, className)} data-back-link="">
      <ChevronIcon direction="left" size={20} />
      <span className={layout.srOnly}>Back to </span>
      {label}
    </BackLink>
  );
}
