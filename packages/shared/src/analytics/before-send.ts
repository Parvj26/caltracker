import { sanitize } from './sanitize';
import { scrubUrl } from './scrub-url';

/** The parts of a PostHog event this guard reads and rewrites. */
export interface OutgoingEvent {
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown> | undefined;
  $set_once?: Record<string, unknown> | undefined;
}

const URL_KEY = /(url|pathname|referrer|screen_name)$/i;
const ROUTING_KEYS = new Set(['token', 'distinct_id']);
const DROPPED_KEYS = ['title', '$title', '$el_text'];
const KEPT_ELEMENT_KEYS = new Set(['tag_name', 'nth_child', 'nth_of_type', 'attr__ph-label']);

/** Removes text, attributes (except ph-label) and links from PostHog's compact elements chain. */
function scrubChain(chain: string): string {
  return chain
    .replace(/text="(?:[^"\\]|\\.)*"/g, '')
    .replace(/href="(?:[^"\\]|\\.)*"/g, '')
    .replace(/attr__(?!ph-label=)[\w-]+="(?:[^"\\]|\\.)*"/g, '')
    .replace(/attr_id="(?:[^"\\]|\\.)*"/g, '');
}

function scrubElements(elements: unknown): unknown {
  if (!Array.isArray(elements)) return undefined;
  return elements.map((el: unknown) => {
    const kept: Record<string, unknown> = {};
    if (el && typeof el === 'object') {
      for (const [k, v] of Object.entries(el)) if (KEPT_ELEMENT_KEYS.has(k)) kept[k] = v;
    }
    return kept;
  });
}

/**
 * Last stop before an event leaves the browser: hides secrets in URLs, drops page titles (they can
 * name a client), strips on-screen text and attributes from clicks, and runs custom events through
 * the shared allow-list.
 */
export function beforeSend<E extends OutgoingEvent>(input: E): E | null {
  const props: Record<string, unknown> = {};
  const custom = !input.event.startsWith('$');
  const allowed = custom ? sanitize(input.event, input.properties) : null;
  for (const [key, value] of Object.entries(input.properties)) {
    if (DROPPED_KEYS.includes(key)) continue;
    if (ROUTING_KEYS.has(key)) {
      props[key] = value;
      continue;
    }
    if (!key.startsWith('$')) {
      if (allowed && key in allowed) props[key] = allowed[key];
      continue;
    }
    if (key === '$elements') props[key] = scrubElements(value);
    else if (key === '$elements_chain' && typeof value === 'string') props[key] = scrubChain(value);
    else if (URL_KEY.test(key) && typeof value === 'string') props[key] = scrubUrl(value);
    else props[key] = value;
  }
  const out = { ...input, properties: props };
  if (custom) {
    delete out.$set;
    delete out.$set_once;
  }
  return out;
}
