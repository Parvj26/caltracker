import { describe, expect, it } from 'vitest';
import { SEARCH_MAX_RESULTS, searchClients } from '../../src';

const c = (id: string, firstName: string, lastName: string) => ({ id, firstName, lastName });

describe('searchClients', () => {
  const clients = [c('1', 'José', 'García'), c('2', 'Anna', 'Smith'), c('3', 'Ann', 'Marie Jones')];

  it('folds accents and case both ways', () => {
    expect(searchClients(clients, 'jose').map((x) => x.id)).toEqual(['1']);
    expect(searchClients(clients, 'GARCÍA').map((x) => x.id)).toEqual(['1']);
  });
  it('matches part of a last name', () => {
    expect(searchClients(clients, 'smi').map((x) => x.id)).toEqual(['2']);
  });
  it('matches "first last" across the space', () => {
    expect(searchClients(clients, 'anna sm').map((x) => x.id)).toEqual(['2']);
    expect(searchClients(clients, 'ann marie').map((x) => x.id)).toEqual(['3']);
  });
  it('caps results at 8, keeping order', () => {
    const many = Array.from({ length: 12 }, (_, i) => c(String(i), 'Sam', `Lee${i}`));
    const found = searchClients(many, 'sam');
    expect(SEARCH_MAX_RESULTS).toBe(8);
    expect(found.map((x) => x.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
  });
  it('finds nothing for an empty or blank query', () => {
    expect(searchClients(clients, '')).toEqual([]);
    expect(searchClients(clients, '   ')).toEqual([]);
  });
});
