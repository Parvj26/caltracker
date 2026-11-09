import type { ReactNode } from 'react';

/** Simple line icons for the coach sidebar. Decorative: the link text or aria-label names each item. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const NAV_ICONS = {
  home: (
    <Icon>
      <path d="M4 11 12 4l8 7M6 9.5V19a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1V9.5" />
    </Icon>
  ),
  clients: (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2" />
    </Icon>
  ),
  workouts: (
    <Icon>
      <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
    </Icon>
  ),
  programs: (
    <Icon>
      <rect x="4" y="4" width="16" height="17" rx="3" />
      <path d="M8 2.5v3M16 2.5v3M4 9.5h16M8.5 13.5h7M8.5 17h4" />
    </Icon>
  ),
  exercises: (
    <Icon>
      <path d="M5 4.5h11.5a2.5 2.5 0 0 1 2.5 2.5v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
      <path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H19M9 8.5h6" />
    </Icon>
  ),
  meals: (
    <Icon>
      <path d="M3.5 12h17a8.5 8.5 0 0 1-17 0Z" />
      <path d="M9 8.5c0-1.5 1-2 1-3.5M13 8.5c0-1.5 1-2 1-3.5" />
    </Icon>
  ),
  activity: (
    <Icon>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </Icon>
  ),
  messages: (
    <Icon>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8L7 21v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5Z" />
    </Icon>
  ),
  community: (
    <Icon>
      <circle cx="12" cy="7.5" r="3" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M6.5 20c.5-3.4 2.7-5.5 5.5-5.5s5 2.1 5.5 5.5M1.8 18c.3-2 1.5-3.4 3.2-3.6M22.2 18c-.3-2-1.5-3.4-3.2-3.6" />
    </Icon>
  ),
  signOut: (
    <Icon>
      <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16.5 14.5 12 10 7.5M14.5 12H4" />
    </Icon>
  ),
} as const;

export type NavIconName = keyof typeof NAV_ICONS;
