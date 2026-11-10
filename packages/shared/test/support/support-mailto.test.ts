import { describe, expect, it } from 'vitest';
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL, supportMailto } from '../../src/index';

describe('supportMailto', () => {
  it('opens an email to support with the app, version and device under two blank lines', () => {
    expect(supportMailto({ surface: 'iOS app', release: '1.0.0 (3)', device: 'iPhone 15, iOS 26.1' })).toBe(
      'mailto:support@caltracker.app?subject=CalTracker%20help&body=' +
        '%0A%0A---%0AApp%3A%20iOS%20app%0AVersion%3A%201.0.0%20(3)%0ADevice%3A%20iPhone%2015%2C%20iOS%2026.1',
    );
  });

  it('adds the page on the website', () => {
    const url = supportMailto({ surface: 'Coach website', release: 'abc1234', device: 'Mozilla/5.0', page: 'https://caltracker.app/clients' });
    const body = decodeURIComponent(url.split('&body=')[1]!);
    expect(body).toBe('\n\n---\nApp: Coach website\nVersion: abc1234\nDevice: Mozilla/5.0\nPage: https://caltracker.app/clients');
  });

  it('keeps an & or a newline in the device name inside the body', () => {
    const url = supportMailto({ surface: 'iOS app', release: '1', device: 'A&B\nsubject=x' });
    expect(url).not.toMatch(/&(?!body=)/);
    expect(url).not.toContain('\n');
    expect(new URL(url).searchParams.get('subject')).toBe('CalTracker help');
    expect(new URL(url).searchParams.get('body')).toContain('Device: A&B\nsubject=x');
  });
});

describe('legal links', () => {
  it('points at the public pages and the support inbox', () => {
    expect(PRIVACY_URL).toBe('https://caltracker.app/privacy');
    expect(TERMS_URL).toBe('https://caltracker.app/terms');
    expect(SUPPORT_EMAIL).toBe('support@caltracker.app');
  });
});
