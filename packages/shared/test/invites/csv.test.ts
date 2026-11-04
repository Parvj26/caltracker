import { describe, expect, it } from 'vitest';
import {
  CLIENT_CSV_MAX_ROWS,
  EMAIL_HEADERS,
  FIRST_NAME_HEADERS,
  LAST_NAME_HEADERS,
  NAME_HEADERS,
  clientCsvTemplate,
  parseClientCsv,
} from '../../src/index';

const row = (firstName: string, lastName: string, email: string) => ({ firstName, lastName, email });

describe('parseClientCsv: first and last name columns', () => {
  it('parses separate first and last name columns', () => {
    expect(parseClientCsv('First name,Last name,Email\nSam,Lee,sam@x.com')).toEqual({
      rows: [row('Sam', 'Lee', 'sam@x.com')],
      errors: [],
    });
  });

  it('parses an Everfit-style export (extra columns, any order)', () => {
    const csv = [
      'First Name,Last Name,Email,Phone,Status',
      'Sam,Lee,sam@x.com,555-0100,Active',
      'Priya,Rao,priya@x.com,,Active',
    ].join('\n');
    expect(parseClientCsv(csv)).toEqual({
      rows: [row('Sam', 'Lee', 'sam@x.com'), row('Priya', 'Rao', 'priya@x.com')],
      errors: [],
    });
  });

  it.each([
    ['first name', 'last name'],
    ['First_Name', 'LAST_NAME'],
    ['Given name', 'Surname'],
    [' First name ', ' Last name '],
  ])('accepts headers %s / %s', (first, last) => {
    const { rows, errors } = parseClientCsv(`Email,${last},${first}\nsam@x.com,Lee,Sam`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([row('Sam', 'Lee', 'sam@x.com')]);
  });

  it('accepts an empty last name', () => {
    const { rows, errors } = parseClientCsv('First name,Last name,Email\nCher,,cher@x.com');
    expect(errors).toEqual([]);
    expect(rows).toEqual([row('Cher', '', 'cher@x.com')]);
  });

  it('accepts a first name column without a last name column', () => {
    expect(parseClientCsv('First name,Email\nCher,cher@x.com').rows).toEqual([row('Cher', '', 'cher@x.com')]);
  });

  it('trims both names', () => {
    expect(parseClientCsv('First name,Last name,Email\n  Sam , Lee  ,sam@x.com').rows).toEqual([
      row('Sam', 'Lee', 'sam@x.com'),
    ]);
  });

  it('reports a row with an empty first name', () => {
    const { rows, errors } = parseClientCsv('First name,Last name,Email\n,Lee,sam@x.com');
    expect(rows).toEqual([]);
    expect(errors).toEqual([
      { line: 2, message: 'Invalid name on line 2: a first name of 1 to 100 characters is required' },
    ]);
  });

  it('reports a last name over 100 characters', () => {
    const { rows, errors } = parseClientCsv(`First name,Last name,Email\nSam,${'x'.repeat(101)},sam@x.com`);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 2, message: 'Invalid name on line 2: the last name can be at most 100 characters' }]);
  });

  it('prefers the first name column over a single Name column', () => {
    const { rows } = parseClientCsv('Name,First name,Last name,Email\nSam Lee,Samuel,Lee,sam@x.com');
    expect(rows).toEqual([row('Samuel', 'Lee', 'sam@x.com')]);
  });

  it('treats Name as the first name when a separate last name column exists', () => {
    const { rows } = parseClientCsv('Name,Surname,Email\nMary Ann,Smith,mary@x.com');
    expect(rows).toEqual([row('Mary Ann', 'Smith', 'mary@x.com')]);
  });
});

describe('parseClientCsv: single Name column (older files)', () => {
  it('splits the name on the first space', () => {
    expect(parseClientCsv('Name,Email\nSam Lee,sam@x.com')).toEqual({
      rows: [row('Sam', 'Lee', 'sam@x.com')],
      errors: [],
    });
  });

  it('puts everything after the first space in the last name', () => {
    expect(parseClientCsv('Name,Email\nMary Ann Smith,mary@x.com').rows).toEqual([
      row('Mary', 'Ann Smith', 'mary@x.com'),
    ]);
  });

  it('accepts a single-word name with an empty last name', () => {
    expect(parseClientCsv('Name,Email\nCher,cher@x.com').rows).toEqual([row('Cher', '', 'cher@x.com')]);
  });

  it.each(['name', 'Full Name', 'full_name', 'CLIENT NAME', ' Name '])('accepts name header %s', (h) => {
    const { rows, errors } = parseClientCsv(`${h},Email\nSam,sam@x.com`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([row('Sam', '', 'sam@x.com')]);
  });

  it('keeps commas inside quoted fields', () => {
    const { rows } = parseClientCsv('Name,Email\n"Lee, Sam",sam@x.com');
    expect(rows).toEqual([row('Lee,', 'Sam', 'sam@x.com')]);
  });

  it('reports a row with an empty name', () => {
    const { rows, errors } = parseClientCsv('Name,Email\n,sam@x.com');
    expect(rows).toEqual([]);
    expect(errors).toEqual([
      { line: 2, message: 'Invalid name on line 2: a first name of 1 to 100 characters is required' },
    ]);
  });

  it('reports a missing name column on every row', () => {
    const { rows, errors } = parseClientCsv('Email\nsam@x.com');
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

describe('parseClientCsv: email and file handling', () => {
  it.each(['email', 'E-mail', 'EMAIL ADDRESS', ' Email '])('accepts email header %s', (h) => {
    const { rows, errors } = parseClientCsv(`Name,${h}\nSam,sam@x.com`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([row('Sam', '', 'sam@x.com')]);
  });

  it('accepts email column first', () => {
    const { rows } = parseClientCsv('Email,Name\nsam@x.com,Sam');
    expect(rows).toEqual([row('Sam', '', 'sam@x.com')]);
  });

  it('handles a BOM and CRLF line endings', () => {
    const { rows, errors } = parseClientCsv('﻿First name,Last name,Email\r\nSam,Lee,sam@x.com\r\nAnn,Bo,ann@x.com\r\n');
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('skips blank lines without errors and keeps physical line numbers', () => {
    const { rows, errors } = parseClientCsv('Name,Email\n\nSam,sam@x.com\n  ,  \n\nAnn,not-an-email');
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 6, message: 'Invalid email: not-an-email' }]);
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
    expect(FIRST_NAME_HEADERS).toEqual(['first name', 'first_name', 'given name']);
    expect(LAST_NAME_HEADERS).toEqual(['last name', 'last_name', 'surname']);
    expect(NAME_HEADERS).toEqual(['name', 'full name', 'full_name', 'client name']);
    expect(EMAIL_HEADERS).toEqual(['email', 'e-mail', 'email address']);
    const lines = ['Name,Email', ...Array.from({ length: CLIENT_CSV_MAX_ROWS + 1 }, (_, i) => `C ${i},c${i}@x.com`)];
    const { rows, errors } = parseClientCsv(lines.join('\n'));
    expect(rows).toHaveLength(CLIENT_CSV_MAX_ROWS);
    expect(errors).toEqual([{ line: CLIENT_CSV_MAX_ROWS + 2, message: `Maximum ${CLIENT_CSV_MAX_ROWS} clients per upload.` }]);
  });

  it('builds an example file with First name, Last name and Email columns and two valid example.com rows', () => {
    const template = clientCsvTemplate();
    const lines = template.trim().split('\n');
    expect(lines[0]).toBe('First name,Last name,Email');
    expect(lines).toHaveLength(3);
    const { rows, errors } = parseClientCsv(template);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.email).toMatch(/@example\.com$/);
      expect(r.firstName).not.toBe('');
      expect(r.lastName).not.toBe('');
    }
  });
});
