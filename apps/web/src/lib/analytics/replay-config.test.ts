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

  it('keeps layout attributes and page links', () => {
    const div = el('<div class="card">x</div>', 'div');
    expect(maskAttribute('class', 'card', div)).toBe('card');
    expect(maskAttribute('href', '/clients', div)).toBe('/clients');
    expect(maskAttribute('_cssText', '.a{color:red}', div)).toBe('.a{color:red}');
  });

  it('keeps fixed labels inside data-ph-safe', () => {
    const a = el('<a data-ph-safe aria-label="Clients">x</a>', 'a');
    expect(maskAttribute('aria-label', 'Clients', a)).toBe('Clients');
  });
});
