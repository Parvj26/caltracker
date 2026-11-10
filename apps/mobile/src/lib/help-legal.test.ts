import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_LEGAL_ROWS, SIGN_IN_LEGAL_LINKS, deviceLabel, helpMailto, releaseLabel, versionLine } from './help-legal';

const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('Settings: HELP & LEGAL rows', () => {
  it('lists Help & feedback, Privacy policy and Terms of use, in the board’s order', () => {
    expect(HELP_LEGAL_ROWS.map((r) => [r.testID, r.label, r.detail ?? null])).toEqual([
      ['settings-help', 'Help & feedback', 'Email support@caltracker.app'],
      ['settings-privacy', 'Privacy policy', null],
      ['settings-terms', 'Terms of use', null],
    ]);
  });

  it('opens the public web pages for privacy and terms', () => {
    const url = Object.fromEntries(HELP_LEGAL_ROWS.map((r) => [r.key, r.url]));
    expect(url.privacy).toBe('https://caltracker.app/privacy');
    expect(url.terms).toBe('https://caltracker.app/terms');
    expect(url.help).toBeUndefined();
  });

  it('emails support with the app version and device, and nothing personal', () => {
    const url = helpMailto('1.0.0 (3)', 'iPhone 15, iOS 26.1');
    expect(url.startsWith('mailto:support@caltracker.app?subject=CalTracker%20help&body=')).toBe(true);
    expect(new URL(url).searchParams.get('body')).toBe('\n\n---\nApp: iOS app\nVersion: 1.0.0 (3)\nDevice: iPhone 15, iOS 26.1');
  });
});

describe('version and device', () => {
  it('reads the version with its build number, as on the board', () => {
    expect(releaseLabel('1.0.0', '3')).toBe('1.0.0 (3)');
    expect(versionLine(releaseLabel('1.0.0', '3'))).toBe('CalTracker 1.0.0 (3)');
  });

  it('leaves out a missing build number, and never shows an empty version', () => {
    expect(releaseLabel('1.0.0', null)).toBe('1.0.0');
    expect(releaseLabel(null, null)).toBe('unknown');
  });

  it('names the device and its system', () => {
    expect(deviceLabel('iPhone 15', 'iOS', '26.1')).toBe('iPhone 15, iOS 26.1');
    expect(deviceLabel(null, 'iPadOS', '26.1')).toBe('Unknown device, iPadOS 26.1');
    expect(deviceLabel(null, null, null)).toBe('Unknown device');
  });
});

describe('sign-in legal links', () => {
  it('links Privacy and Terms', () => {
    expect(SIGN_IN_LEGAL_LINKS).toEqual([
      { testID: 'sign-in-privacy', label: 'Privacy', url: 'https://caltracker.app/privacy' },
      { testID: 'sign-in-terms', label: 'Terms', url: 'https://caltracker.app/terms' },
    ]);
  });
});

// No component renderer runs under vitest here, so these check the screens wire the tested pieces in.
describe('screens', () => {
  it('the Settings sheet shows HELP & LEGAL above Sign out and the version line below it', () => {
    const sheet = source('components/today/today-header.tsx');
    const help = sheet.indexOf('<HelpLegalSection');
    const signOut = sheet.indexOf('testID="sign-out"');
    const version = sheet.indexOf('<AppVersionLine');
    expect(help).toBeGreaterThan(-1);
    expect(signOut).toBeGreaterThan(help);
    expect(version).toBeGreaterThan(signOut);
  });

  it('the section renders every row and opens it through openHelpLegal', () => {
    const section = source('components/settings/help-legal-section.tsx');
    expect(section).toContain('HELP_LEGAL_ROWS.map');
    expect(section).toContain('HELP & LEGAL');
    expect(section).toContain('openHelpLegal(');
  });

  it('the sign-in screen shows the Privacy and Terms links', () => {
    expect(source('app/(auth)/sign-in.tsx')).toContain('<LegalLinks');
    expect(source('components/legal-links.tsx')).toContain('SIGN_IN_LEGAL_LINKS.map');
  });
});
