import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorText, TextField } from './text-field';

describe('ErrorText', () => {
  it('shows the catalogue message and its code when no children are given', () => {
    const html = renderToStaticMarkup(createElement(ErrorText, { code: 'invite_email_invalid' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-error-code="invite_email_invalid"');
    expect(html).toContain('data-ph-safe');
    expect(html).toContain('Check the name and email, then try again.');
  });
  it('shows fixed copy given as children, keeping the code', () => {
    const html = renderToStaticMarkup(createElement(ErrorText, { code: 'field_required' }, 'Name the section.'));
    expect(html).toContain('data-error-code="field_required"');
    expect(html).toContain('Name the section.');
    expect(html).not.toContain('Fill in this field.');
  });
});

describe('TextField', () => {
  it('renders its error with a code and marks label and hint safe', () => {
    const html = renderToStaticMarkup(createElement(TextField, { label: 'Date', hint: 'Pick a day', error: { code: 'assign_date_invalid' } }));
    expect(html).toContain('data-error-code="assign_date_invalid"');
    expect(html).toContain('Pick a valid start date.');
    expect(html).toMatch(/data-ph-safe="">Date</);
    expect(html).toMatch(/data-ph-safe="">Pick a day</);
  });
});

describe('TextField hintSafe', () => {
  it('leaves a hint that can show typed text unmarked', () => {
    const html = renderToStaticMarkup(createElement(TextField, { label: 'Business name', hint: 'Welcome to Luis Fit', hintSafe: false }));
    expect(html).not.toMatch(/data-ph-safe="">Welcome/);
  });
});

describe('unsafe text', () => {
  it('keeps the code but leaves typed text unmarked', () => {
    const html = renderToStaticMarkup(createElement(ErrorText, { code: 'field_format', safe: false }, 'Zebracanary must be between 1 and 2.'));
    expect(html).toContain('data-error-code="field_format"');
    expect(html).not.toContain('data-ph-safe');
  });
  it('TextField can leave a typed label unmarked', () => {
    const html = renderToStaticMarkup(createElement(TextField, { label: 'Zebracanary (cm)', labelSafe: false }));
    expect(html).not.toContain('data-ph-safe');
  });
});
