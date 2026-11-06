import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import MessagesError from './error';

describe('messages error screen', () => {
  it('says messages could not load and offers Try again', () => {
    const html = renderToStaticMarkup(createElement(MessagesError, { error: new Error('boom'), reset: vi.fn() }));
    expect(html).toContain('Couldn&#x27;t load messages');
    expect(html).toContain('Try again');
    expect(html).toContain('role="alert"');
    // The raw error text is never shown to the coach.
    expect(html).not.toContain('boom');
  });
});
