/**
 * An exercise's tempo, "3-1-1-0": seconds down, pause, up, pause. Each part is 0–9, or X for explosive. Stored
 * normalised (no spaces, a capital X, plain hyphens); the database checks the same pattern.
 */
export const TEMPO_PLACEHOLDER = '0-0-0-0';
export const TEMPO_PATTERN = /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/;
export const TEMPO_MESSAGE = 'Tempo is four parts like 3-1-1-0, each 0–9 or X (explosive).';

export type TempoResult = { ok: true; tempo: string | null } | { ok: false; message: string };

/** Blank is no tempo. Spaces, a lowercase x and en / em dashes (an iPad's smart punctuation) are accepted. */
export function parseTempo(text: string | null | undefined): TempoResult {
  const t = (text ?? '').replace(/\s+/g, '').replace(/[–—−]/g, '-').toUpperCase();
  if (t === '') return { ok: true, tempo: null };
  return TEMPO_PATTERN.test(t) ? { ok: true, tempo: t } : { ok: false, message: TEMPO_MESSAGE };
}

/** A stored tempo as it is when valid, else null (a bad value is never shown to a client). */
export function validTempo(tempo: string | null | undefined): string | null {
  const r = parseTempo(tempo);
  return r.ok ? r.tempo : null;
}
