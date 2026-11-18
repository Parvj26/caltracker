'use client';

import { useState, type InputHTMLAttributes } from 'react';
import styles from './ui.module.css';

/**
 * A password box with a 44 px eye button that shows or hides what was typed (UI rules §9.2). The button keeps the
 * name "Show password" and says whether it is on with aria-pressed. Used by TextField for every type="password".
 */
export function PasswordInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <span className={styles.reveal}>
      <input {...rest} type={shown ? 'text' : 'password'} className={className} />
      <button
        type="button"
        className={styles.revealButton}
        aria-label="Show password"
        aria-pressed={shown}
        data-ph-safe=""
        onClick={() => setShown((v) => !v)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {shown ? null : <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}
