/** Where people write for help, to close a coach account or about their data. */
export const SUPPORT_EMAIL = 'support@caltracker.app';

/** The public legal pages (apps/web/src/app/(legal)). The phone opens these; the website links them by path. */
export const PRIVACY_URL = 'https://caltracker.app/privacy';
export const TERMS_URL = 'https://caltracker.app/terms';

export type SupportSurface = 'iOS app' | 'Coach website';

/**
 * "Help & feedback": a mailto link to support, its body pre-filled (under two blank lines for the person's message)
 * with what we need to help: which app, its version, the device and, on the website, the page. Never a name, email or
 * user id. Every value is URL-encoded, so an `&` or a newline in a device name stays inside the body.
 */
export function supportMailto(input: { surface: SupportSurface; release: string; device: string; page?: string }): string {
  const lines = ['', '', '---', `App: ${input.surface}`, `Version: ${input.release}`, `Device: ${input.device}`];
  if (input.page) lines.push(`Page: ${input.page}`);
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('CalTracker help')}&body=${encodeURIComponent(lines.join('\n'))}`;
}
