// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scrubUrl } from '@caltracker/shared';
import { RECORDING_CONFIG, maskAttribute, maskText } from './replay-config';

const rec = RECORDING_CONFIG.session_recording;

function el(html: string, pick: string): HTMLElement {
  document.body.innerHTML = html;
  const found = document.querySelector<HTMLElement>(pick);
  if (!found) throw new Error(`no ${pick}`);
  return found;
}

describe('RECORDING_CONFIG', () => {
  it('masks every input and all page text by default', () => {
    expect(rec.maskAllInputs).toBe(true);
    expect(rec.maskTextSelector).toBe('*');
    expect(rec.maskTextFn).toBe(maskText);
  });

  it('blocks photos, video, canvas and anything marked data-ph-block', () => {
    for (const s of ['img', 'picture', 'video', 'canvas', '[data-ph-block]']) expect(rec.blockSelector).toContain(s);
  });

  it('records no network headers, bodies, timings, console or cross-origin frames', () => {
    expect(rec.recordHeaders).toBe(false);
    expect(rec.recordBody).toBe(false);
    expect(rec.recordCrossOriginIframes).toBe(false);
    expect(RECORDING_CONFIG.capture_performance.network_timing).toBe(false);
    expect(RECORDING_CONFIG.enable_recording_console_log).toBe(false);
  });

  it('scrubs captured request URLs (and the page URL in the player)', () => {
    const name = 'https://x/invite/abc123token';
    expect(rec.maskCapturedNetworkRequestFn({ name })).toEqual({ name: scrubUrl(name) });
  });
});

describe('maskText', () => {
  it('hides text that is not inside data-ph-safe', () => {
    expect(maskText('Luis', el('<div>Luis</div>', 'div'))).toBe('****');
  });

  it('shows fixed copy inside data-ph-safe', () => {
    expect(maskText('Save', el('<button data-ph-safe><span>Save</span></button>', 'span'))).toBe('Save');
  });

  it('hides text with no element', () => {
    expect(maskText('x', undefined)).toBe('*');
    expect(maskText('ab', null)).toBe('**');
  });
});

describe('maskAttribute', () => {
  it('hides text-carrying attributes outside data-ph-safe', () => {
    const button = el('<button aria-label="Remove Luis" title="Luis">x</button>', 'button');
    expect(maskAttribute('aria-label', 'Remove Luis', button)).toBe('***********');
    expect(maskAttribute('title', 'Luis', button)).toBe('****');
    expect(maskAttribute('alt', 'Luis', button)).toBe('****');
    expect(maskAttribute('placeholder', 'Luis', button)).toBe('****');
  });

  it('hides email and phone links', () => {
    const a = el('<a href="mailto:luis@example.com">x</a>', 'a');
    expect(maskAttribute('href', 'mailto:luis@example.com', a)).not.toContain('luis');
    expect(maskAttribute('href', 'tel:+3460000000', a)).not.toContain('346');
  });

  it('hides image links (React preloads photos with <link rel="preload" as="image">) and photo sources', () => {
    const link = el('<link rel="preload" as="image" href="https://x/storage/luis.jpg?token=abc">', 'link');
    expect(maskAttribute('href', 'https://x/storage/luis.jpg?token=abc', link)).not.toMatch(/luis|abc/);
    const img = el('<img src="https://x/luis.jpg">', 'img');
    expect(maskAttribute('src', 'https://x/luis.jpg', img)).not.toContain('luis');
    expect(maskAttribute('srcset', 'https://x/luis.jpg 2x', img)).not.toContain('luis');
    expect(maskAttribute('imagesrcset', 'https://x/luis.jpg 2x', link)).not.toContain('luis');
  });

  it('hides every link (paths can hold storage file names)', () => {
    const a = el('<a href="/x">x</a>', 'a');
    expect(maskAttribute('href', '/invite/secret-token?x=1', a)).not.toMatch(/secret|invite/);
    expect(maskAttribute('href', 'https://x/storage/v1/object/sign/photos/luis.jpg', a)).not.toContain('luis');
  });

  it('is deny-by-default: dates, ids, numbers, test ids and unknown attributes are hidden', () => {
    const div = el('<div>x</div>', 'div');
    for (const [name, value] of [
      ['datetime', '2026-03-04T10:00:00Z'],
      ['content', 'Luis'],
      ['data-date', '2026-03-05'],
      ['data-client-id', '0b8c2f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f'],
      ['data-invite-id', 'abc'],
      ['data-testid', 'food-day-2026-11-10'],
      ['aria-valuenow', '83'],
      ['aria-valuemin', '0'],
      ['aria-valuemax', '120'],
      ['points', '0,82 10,79.5'],
      ['data-anything-new', 'luis'],
      ['name', 'luis'],
    ] as [string, string][]) {
      expect(maskAttribute(name, value, div), name).toBe('*'.repeat(value.length));
    }
  });

  it('keeps layout, styling and behaviour attributes so the recording still looks right', () => {
    const div = el('<div class="card">x</div>', 'div');
    for (const [name, value] of [
      ['class', 'card'],
      ['style', 'width: 40%'],
      ['_cssText', '.a{color:red}'],
      ['role', 'dialog'],
      ['type', 'button'],
      ['aria-hidden', 'true'],
      ['aria-expanded', 'false'],
      ['aria-current', 'page'],
      ['viewBox', '0 0 24 24'],
      ['d', 'M6 11l6-6 6 6'],
      ['rr_width', '40px'],
      ['data-ph-safe', ''],
      ['data-ph-block', ''],
      ['data-ph-capture-attribute-label', 'nav_clients'],
      ['data-error-code', 'invite_email_invalid'],
      ['data-screen', 'thread'],
      ['data-over', 'true'],
    ] as [string, string][]) {
      expect(maskAttribute(name, value, div), name).toBe(value);
    }
  });

  it('keeps styling hooks only while their value is a plain word', () => {
    const div = el('<div>x</div>', 'div');
    expect(maskAttribute('data-unread', '3', div)).toBe('*');
    expect(maskAttribute('data-state', '2026-11-10', div)).toBe('**********');
  });

  it('keeps element references but drops record ids from them', () => {
    const div = el('<div>x</div>', 'div');
    expect(maskAttribute('id', '_r_1_', div)).toBe('_r_1_');
    expect(maskAttribute('aria-controls', 'invite-panel-email', div)).toBe('invite-panel-email');
    expect(maskAttribute('id', 'row-0b8c2f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f', div)).toBe('row-[id]');
    expect(maskAttribute('id', 'luis@example.com', div)).toBe('****************');
  });

  it('keeps fixed labels inside data-ph-safe', () => {
    const a = el('<a data-ph-safe aria-label="Clients">x</a>', 'a');
    expect(maskAttribute('aria-label', 'Clients', a)).toBe('Clients');
  });
});
