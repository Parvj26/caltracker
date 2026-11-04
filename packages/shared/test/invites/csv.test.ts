import { describe, expect, it } from 'vitest';
import { CLIENT_CSV_MAX_ROWS, EMAIL_HEADERS, NAME_HEADERS, clientCsvTemplate, parseClientCsv } from '../../src/index';

describe('parseClientCsv', () => {
  it('parses a simple file', () => {
    expect(parseClientCsv('Name,Email\nSam Lee,sam@x.com')).toEqual({
      rows: [{ fullName: 'Sam Lee', email: 'sam@x.com' }],
      errors: [],
    });
  });

  it.each(['name', 'Full Name', 'full_name', 'CLIENT NAME', ' Name '])('accepts name header %s', (h) => {
    const { rows, errors } = parseClientCsv(`${h},Email\nSam,sam@x.com`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ fullName: 'Sam', email: 'sam@x.com' }]);
  });

  it.each(['email', 'E-mail', 'EMAIL ADDRESS', ' Email '])('accepts email header %s', (h) => {
    const { rows, errors } = parseClientCsv(`Name,${h}\nSam,sam@x.com`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ fullName: 'Sam', email: 'sam@x.com' }]);
  });

  it('accepts email column first', () => {
    const { rows } = parseClientCsv('Email,Name\nsam@x.com,Sam');
    expect(rows).toEqual([{ fullName: 'Sam', email: 'sam@x.com' }]);
  });

  it('handles a BOM and CRLF line endings', () => {
    const { rows, errors } = parseClientCsv('﻿Name,Email\r\nSam,sam@x.com\r\nAnn,ann@x.com\r\n');
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('skips blank lines without errors and keeps physical line numbers', () => {
    const { rows, errors } = parseClientCsv('Name,Email\n\nSam,sam@x.com\n  ,  \n\nAnn,not-an-email');
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 6, message: 'Invalid email: not-an-email' }]);
  });

  it('keeps commas inside quoted fields', () => {
    const { rows } = parseClientCsv('Name,Email\n"Lee, Sam",sam@x.com');
    expect(rows).toEqual([{ fullName: 'Lee, Sam', email: 'sam@x.com' }]);
  });

  it('reports an invalid email and still returns the other rows', () => {
    const { rows, errors } = parseClientCsv('Name,Email\nSam,sam@x.com\nBad,not-an-email\nAnn,ann@x.com');
    expect(errors).toEqual([{ line: 3, message: 'Invalid email: not-an-email' }]);
    expect(rows.map((r) => r.email)).toEqual(['sam@x.com', 'ann@x.com']);
  });

  it('reports duplicate emails case-insensitively', () => {
    const { rows, errors } = parseClientCsv('Name,Email\nSam,sam@x.com\nAnn,ann@x.com\nSam Two,SAM@x.com');
    expect(errors).toEqual([{ line: 4, message: 'Duplicate email: sam@x.com (also on line 2)' }]);
    expect(rows).toHaveLength(2);
  });

  it('reports a missing email column', () => {
    expect(parseClientCsv('Name,Phone\nSam,123')).toEqual({
      rows: [],
      errors: [{ line: 1, message: 'Could not find an email column. Expected a header like "Email".' }],
    });
  });

  it('reports an empty file as a missing email column', () => {
    expect(parseClientCsv('').errors).toEqual([
      { line: 1, message: 'Could not find an email column. Expected a header like "Email".' },
    ]);
  });

  it('reports a row with an empty name', () => {
    const { rows, errors } = parseClientCsv('Name,Email\n,sam@x.com');
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
  });

  it('limits to 200 data rows', () => {
    const lines = Array.from({ length: 201 }, (_, i) => `Client ${i},c${i}@x.com`);
    const { rows, errors } = parseClientCsv(['Name,Email', ...lines].join('\n'));
    expect(rows).toHaveLength(200);
    expect(errors).toEqual([{ line: 202, message: 'Maximum 200 clients per upload.' }]);
  });

  it('accepts exactly 200 data rows', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Client ${i},c${i}@x.com`);
    const { rows, errors } = parseClientCsv(['Name,Email', ...lines].join('\n'));
    expect(rows).toHaveLength(200);
    expect(errors).toEqual([]);
  });
});

describe('client CSV constants and template', () => {
  it('exports the accepted headers and the row limit the parser enforces', () => {
    expect(CLIENT_CSV_MAX_ROWS).toBe(200);
    expect(NAME_HEADERS).toEqual(['name', 'full name', 'full_name', 'client name']);
    expect(EMAIL_HEADERS).toEqual(['email', 'e-mail', 'email address']);
    const lines = ['Name,Email', ...Array.from({ length: CLIENT_CSV_MAX_ROWS + 1 }, (_, i) => `C ${i},c${i}@x.com`)];
    const { rows, errors } = parseClientCsv(lines.join('\n'));
    expect(rows).toHaveLength(CLIENT_CSV_MAX_ROWS);
    expect(errors).toEqual([{ line: CLIENT_CSV_MAX_ROWS + 2, message: `Maximum ${CLIENT_CSV_MAX_ROWS} clients per upload.` }]);
  });

  it('builds an example file with a Name,Email header and two valid example.com rows', () => {
    const template = clientCsvTemplate();
    const lines = template.trim().split('\n');
    expect(lines[0]).toBe('Name,Email');
    expect(lines).toHaveLength(3);
    const { rows, errors } = parseClientCsv(template);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.email).toMatch(/@example\.com$/);
  });
});
