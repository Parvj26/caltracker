'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps, MouseEvent } from 'react';
import { previousEntryIs, rememberedUrl } from '@/lib/history-back';

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
