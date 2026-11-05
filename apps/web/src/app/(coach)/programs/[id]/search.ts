/** Case-insensitive "contains" match for the library search boxes. A blank query matches everything. */
export function matchesSearch(name: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return q === '' || name.toLocaleLowerCase().includes(q);
}
