/**
 * Assessment templates (board AS11): a coach's named, ordered set of tests ("My lower-body screen"), owned by the
 * workspace. Picking one when starting an assessment (AS2) fills the test list in the template's order.
 *
 * A template names tests by their library key, not a version: starting from it always takes the newest version. A
 * key that is no longer offered (its definition retired) is kept in the template but left out when it is used, and the
 * coach is told which.
 */

export const TEMPLATE_NAME_MAX = 60;
export const TEMPLATE_TESTS_MAX = 20;
const KEY = /^[a-z][a-z0-9_]{1,60}$/;

export type TemplateInput = { name: string; testKeys: string[] };

/** The cleaned template (name trimmed), or null when it doesn't fit the rules the database also checks. */
export function checkTemplateInput(input: unknown): TemplateInput | null {
  if (typeof input !== 'object' || input === null) return null;
  const { name, testKeys } = input as Record<string, unknown>;
  if (typeof name !== 'string' || !Array.isArray(testKeys)) return null;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > TEMPLATE_NAME_MAX) return null;
  if (testKeys.length < 1 || testKeys.length > TEMPLATE_TESTS_MAX) return null;
  if (!testKeys.every((k): k is string => typeof k === 'string' && KEY.test(k))) return null;
  if (new Set(testKeys).size !== testKeys.length) return null;
  return { name: trimmed, testKeys: [...testKeys] };
}

/** Why a template name can't be used, for the field's error line; null when it is fine. */
export function templateNameProblem(name: string, otherNames: readonly string[]): 'empty' | 'too_long' | 'taken' | null {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return 'empty';
  if (trimmed.length > TEMPLATE_NAME_MAX) return 'too_long';
  if (otherNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase())) return 'taken';
  return null;
}

/**
 * A template against the tests offered now: the keys still in the library, in the template's order, and the ones
 * that are not (retired or gone).
 */
export function resolveTemplate(testKeys: readonly string[], available: readonly string[]): { keys: string[]; missing: string[] } {
  const offered = new Set(available);
  const keys: string[] = [];
  const missing: string[] = [];
  for (const k of testKeys) (offered.has(k) ? keys : missing).push(k);
  return { keys, missing };
}
