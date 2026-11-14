/**
 * The client page's injury chip: the first line of the coach's "Limitations & injuries" note, and how many more lines
 * there are ("+2 more"). Blank lines and list marks (-, •, *) are skipped; a single closing full stop is dropped.
 */
export function injurySummary(text: string): { first: string; more: number } | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-•*]\s*/, '').trim())
    .filter((l) => l.length > 0);
  const [first] = lines;
  if (first === undefined) return null;
  return { first: /[^.]\.$/.test(first) ? first.slice(0, -1) : first, more: lines.length - 1 };
}
