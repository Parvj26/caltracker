'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps, MouseEvent } from 'react';
import { previousEntryIs } from '@/lib/history-back';

/**
 * A "Back to …" link that steps back in history when the page it leads to is the one just behind (so that page comes
 * back exactly as it was left: its filters, its week, its view) and opens `href` otherwise. Either way Back afterwards
 * doesn't loop to the page you just left. `backTo` is the path that counts as "the same page" (default: href's own).
 */
export function BackLink({ href, backTo, onClick, ...rest }: ComponentProps<typeof Link> & { href: string; backTo?: string }) {
  const router = useRouter();
  const path = backTo ?? new URL(href, 'http://x').pathname;
  function go(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!previousEntryIs((url) => url.pathname === path)) return;
    e.preventDefault();
    router.back();
  }
  return <Link href={href} onClick={go} {...rest} />;
}
