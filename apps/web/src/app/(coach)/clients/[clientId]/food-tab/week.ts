import { IsoDateSchema, MACRO_KEYS, parseMacroInput, startOfWeek, type IsoDate, type MacroKey, type MacroTargets } from '@caltracker/shared';

/** The Monday of the week to show: `?week=` when it is a real date not in a future week, else this week. */
export function weekFromParam(raw: string | string[] | undefined, today: IsoDate): IsoDate {
  const thisWeek = startOfWeek(today);
  if (typeof raw !== 'string' || !IsoDateSchema.safeParse(raw).success) return thisWeek;
  const monday = startOfWeek(raw);
  return monday > thisWeek ? thisWeek : monday;
}

export type TargetsParse = { ok: true; value: MacroTargets } | { ok: false; errors: Partial<Record<MacroKey, string>> };

/** The targets form: each field is a number in range or blank (no target). */
export function parseTargetsForm(input: Partial<Record<MacroKey, unknown>>): TargetsParse {
  const value: MacroTargets = { calories: null, protein: null, carbs: null, fat: null };
  const errors: Partial<Record<MacroKey, string>> = {};
  for (const k of MACRO_KEYS) {
    const raw = input[k];
    const r = parseMacroInput(k, typeof raw === 'string' ? raw : '');
    if ('error' in r) errors[k] = r.error;
    else value[k] = r.value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}
