import type { Tone } from '@/components/ui';

/** Up to two initials: first letter of the first and last word ("Priya van der Rao" -> "PR"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0]!;
  const last = words.length > 1 ? [...words[words.length - 1]!][0]! : '';
  return (first + last).toLocaleUpperCase();
}

const AVATAR_TONES = ['blue', 'lime', 'pink'] as const satisfies readonly Tone[];

/** A pastel picked from a stable key (user id or email), so a person keeps their colour between visits. */
export function avatarTone(key: string): (typeof AVATAR_TONES)[number] {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}
