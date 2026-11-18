import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

const html = (props: Parameters<typeof Button>[0]) => renderToStaticMarkup(createElement(Button, props));

describe('Button (UI rules §4)', () => {
  it('a disabled button stays focusable: aria-disabled, never the disabled attribute', () => {
    const out = html({ disabled: true, children: 'Send' });
    expect(out).toContain('aria-disabled="true"');
    expect(out).not.toMatch(/\sdisabled=""/);
  });

  it('links the reason it is disabled with aria-describedby', () => {
    const out = html({ disabled: true, disabledReason: 'Pick at least 1 client', children: 'Assign' });
    const id = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}" hidden="">Pick at least 1 client</span>`);
  });

  it('shows no reason while it can be used', () => {
    const out = html({ disabledReason: 'Pick at least 1 client', children: 'Assign' });
    expect(out).not.toContain('aria-describedby');
    expect(out).not.toContain('aria-disabled');
  });

  it('pending is busy and inert', () => {
    const out = html({ pending: true, children: 'Saving…' });
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
  });

  it.each(['primary', 'create', 'secondary', 'quiet', 'danger', 'finish'] as const)('has a %s variant', (variant) => {
    expect(html({ variant, children: 'x' })).toMatch(new RegExp(`class="[^"]*${variant}`));
  });

  it('compact size is its own class', () => {
    expect(html({ size: 'compact', children: 'x' })).toMatch(/class="[^"]*compact/);
  });
});
