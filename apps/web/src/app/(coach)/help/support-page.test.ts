import { describe, expect, it } from 'vitest';
import { supportPage } from './support-page';

const ORIGIN = 'https://caltracker.app';

describe('supportPage', () => {
  it('names the page the coach was on before Help, so support sees where they got stuck', () => {
    expect(supportPage('/clients/abc/body', ORIGIN, '/help')).toBe(`${ORIGIN}/clients/abc/body`);
  });
  it('drops anything after the path (a query string or hash can hold names or search text)', () => {
    expect(supportPage('/clients?q=sam#top', ORIGIN, '/help')).toBe(`${ORIGIN}/clients`);
  });
  it('falls back to the Help page itself when there is no earlier page or it is not a plain path', () => {
    expect(supportPage(null, ORIGIN, '/help')).toBe(`${ORIGIN}/help`);
    expect(supportPage('', ORIGIN, '/help')).toBe(`${ORIGIN}/help`);
    expect(supportPage('//evil.example/x', ORIGIN, '/help')).toBe(`${ORIGIN}/help`);
    expect(supportPage('https://example.com/x', ORIGIN, '/help')).toBe(`${ORIGIN}/help`);
  });
});
