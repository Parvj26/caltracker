'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { SUPPORT_EMAIL, supportMailto } from '@caltracker/shared';
import { copyText } from './copy-text';
import { LAST_PAGE_KEY, supportPage } from './support-page';
import styles from './help.module.css';

const noSubscribe = () => () => {};
const readLastPage = () => {
  try {
    return sessionStorage.getItem(LAST_PAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * The support address as text you can select, a Copy button, and "Open in my mail app": an email pre-filled with the
 * website's release, the browser and the page the coach was on before Help. The browser details exist only in the
 * browser, so the server renders the link without them.
 */
export function SupportBox() {
  const pathname = usePathname();
  const device = useSyncExternalStore(noSubscribe, () => navigator.userAgent, () => 'unknown');
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => null);
  const lastPage = useSyncExternalStore(noSubscribe, readLastPage, () => null);
  const href = supportMailto({
    surface: 'Coach website',
    release: process.env.NEXT_PUBLIC_RELEASE ?? 'dev',
    device,
    ...(origin ? { page: supportPage(lastPage, origin, pathname) } : {}),
  });

  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(SUPPORT_EMAIL, { clipboard: navigator.clipboard, document });
    setCopied(ok ? 'yes' : 'no');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2500);
  };

  return (
    <section className={styles.support} aria-labelledby="support-heading">
      <h2 id="support-heading" className={styles.supportHeading}>Write to us</h2>
      <div className={styles.mailbox}>
        <span className={styles.address} data-ph-safe="">{SUPPORT_EMAIL}</span>
        <button type="button" className={styles.copy} onClick={() => void copy()} data-ph-capture-attribute-label="help_copy_email">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
          </svg>
          <span data-ph-safe="">{copied === 'yes' ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <p className={styles.copyStatus} role="status" data-ph-safe="">
        {copied === 'yes' ? 'Email address copied.' : copied === 'no' ? 'Couldn’t copy. Press and hold the address to copy it.' : ''}
      </p>
      <a href={href} className={styles.mailLink} data-ph-capture-attribute-label="help_feedback">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
        <span data-ph-safe="">Open in my mail app</span>
      </a>
    </section>
  );
}
