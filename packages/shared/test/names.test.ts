import { describe, expect, it } from 'vitest';
import { NAME_MAX_LENGTH, compareByLastName, formatFullName, splitFullName } from '../src/index';

describe('splitFullName', () => {
  it.each([
    ['Sam Lee', 'Sam', 'Lee'],
    ['Mary Ann Smith', 'Mary', 'Ann Smith'],
    ['Cher', 'Cher', ''],
    ['  Sam   Lee  ', 'Sam', 'Lee'],
    ['Sam\tLee', 'Sam', 'Lee'],
    ['', '', ''],
    ['   ', '', ''],
  ])('splits %j on the first space', (full, firstName, lastName) => {
    expect(splitFullName(full)).toEqual({ firstName, lastName });
  });
});

describe('formatFullName', () => {
  it('joins first and last with one space', () => {
    expect(formatFullName({ firstName: 'Sam', lastName: 'Lee' })).toBe('Sam Lee');
  });

  it('has no stray spaces when a part is empty', () => {
    expect(formatFullName({ firstName: ' Cher ', lastName: '' })).toBe('Cher');
    expect(formatFullName({ firstName: '', lastName: 'Lee' })).toBe('Lee');
    expect(formatFullName({ firstName: '', lastName: '' })).toBe('');
  });
});

describe('compareByLastName', () => {
  const sort = (names: [string, string][]) =>
    names
      .map(([firstName, lastName]) => ({ firstName, lastName }))
      .sort(compareByLastName)
      .map(formatFullName);

  it('sorts by last name, then first name', () => {
    expect(sort([['Sam', 'Lee'], ['Priya', 'Rao'], ['Ann', 'Lee'], ['Zed', 'Adams']])).toEqual([
      'Zed Adams',
      'Ann Lee',
      'Sam Lee',
      'Priya Rao',
    ]);
  });

  it('ignores case and accents', () => {
    expect(sort([['b', 'émile'], ['a', 'Emile'], ['c', 'adams']])).toEqual(['c adams', 'a Emile', 'b émile']);
  });

  it('files a single-name person under their first name', () => {
    expect(sort([['Sam', 'Lee'], ['Cher', ''], ['Ann', 'Baker']])).toEqual(['Ann Baker', 'Cher', 'Sam Lee']);
  });
});

it('limits each name part to 100 characters', () => {
  expect(NAME_MAX_LENGTH).toBe(100);
});
