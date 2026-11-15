import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { notAContact } from './not-a-contact';
import { TextField } from './text-field';

describe('notAContact', () => {
  it('names the field with "search" so iPhone Safari offers no AutoFill Contact', () => {
    expect(notAContact('meal-title')).toEqual({
      name: 'meal-title-search',
      autoComplete: 'off',
      'data-1p-ignore': '',
      'data-lpignore': 'true',
      'data-form-type': 'other',
    });
  });

  it('puts the search name in a TextField id too, and keeps the visible label', () => {
    const html = renderToStaticMarkup(createElement(TextField, { label: 'Name', ...notAContact('meal-title') }));
    expect(html).toContain('name="meal-title-search"');
    expect(html).toMatch(/id="meal-title-search[^"]*"/);
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('>Name</span>');
  });

  it('keeps an id that was passed in', () => {
    const html = renderToStaticMarkup(createElement(TextField, { label: 'Name', id: 'given', ...notAContact('x') }));
    expect(html).toContain('id="given"');
  });
});
