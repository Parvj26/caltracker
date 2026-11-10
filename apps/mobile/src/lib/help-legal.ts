import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL, supportMailto } from '@caltracker/shared';

// Settings' HELP & LEGAL box and the sign-in links (the account-canvas Settings board). Pure, so it's unit-tested;
// open-help-legal.ts does the opening.

export type HelpLegalKey = 'help' | 'privacy' | 'terms';

export type HelpLegalRow = {
  key: HelpLegalKey;
  testID: string;
  label: string;
  /** The grey second line under the label. */
  detail?: string;
  /** The web page the row opens; Help opens an email instead. */
  url?: string;
};

export const HELP_LEGAL_ROWS: readonly HelpLegalRow[] = [
  { key: 'help', testID: 'settings-help', label: 'Help & feedback', detail: `Email ${SUPPORT_EMAIL}` },
  { key: 'privacy', testID: 'settings-privacy', label: 'Privacy policy', url: PRIVACY_URL },
  { key: 'terms', testID: 'settings-terms', label: 'Terms of use', url: TERMS_URL },
];

export const SIGN_IN_LEGAL_LINKS = [
  { testID: 'sign-in-privacy', label: 'Privacy', url: PRIVACY_URL },
  { testID: 'sign-in-terms', label: 'Terms', url: TERMS_URL },
] as const;

/** "1.0.0 (3)": the app version and its build number. */
export function releaseLabel(version: string | null | undefined, build: string | null | undefined): string {
  if (!version) return 'unknown';
  return build ? `${version} (${build})` : version;
}

/** The line at the foot of Settings. */
export const versionLine = (release: string) => `CalTracker ${release}`;

/** "iPhone 15, iOS 26.1". */
export function deviceLabel(model: string | null | undefined, osName: string | null | undefined, osVersion: string | null | undefined): string {
  const system = [osName, osVersion].filter(Boolean).join(' ');
  return [model || 'Unknown device', system].filter(Boolean).join(', ');
}

export const helpMailto = (release: string, device: string) => supportMailto({ surface: 'iOS app', release, device });
