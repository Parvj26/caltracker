import { LABEL_PATTERN } from './error-codes';
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
/** PostHog events we never send: they can carry raw URLs or error text. */
const DROPPED_EVENTS = /^\$(exception|web_vitals)/;
/** Click events where the button's own `label` (set via data-ph-capture-attribute-label) is kept. */
const CLICK_EVENTS = new Set(['$autocapture', '$rageclick', '$dead_click']);
const KEPT_ELEMENT_KEYS = new Set(['tag_name', 'nth_child', 'nth_of_type', 'attr__ph-label', 'attr__testID']);
const LABEL_KEYS = new Set(['attr__ph-label', 'attr__testID']);

/** Developer labels can embed record ids; replace them so labels group (and carry nothing about a person). */
function normalizeLabel(label: string): string {
  return label.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]').replace(/\d+/g, '[n]');
}

/** A plain element or component name (posthog-react-native turns component names into this shape). */
const PLAIN_TAG = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * posthog-react-native copies the raw ph-label into `tag_name` of that element and its children, so a label that
 * breaks the naming rule could slip out there. Keep a tag only when it is a plain name or a valid label, and never
 * when it equals a label that was dropped (raw or in PostHog's hyphenated form).
 */
function tagKept(tag: string, dropped: ReadonlySet<string>): boolean {
  if (dropped.has(tag)) return false;
  return LABEL_PATTERN.test(tag) || PLAIN_TAG.test(tag);
}

function droppedLabels(labels: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const l of labels) {
    if (LABEL_PATTERN.test(l)) continue;
    out.add(l);
    out.add(l.replace(/[^a-z0-9]+/gi, '-'));
  }
  return out;
}

const CHAIN_LABEL = /attr__ph-label="((?:[^"\\]|\\.)*)"/g;

/** Removes text, attributes (except ph-label) and links from PostHog's compact elements chain. */
function scrubChain(chain: string): string {
  const dropped = droppedLabels([...chain.matchAll(CHAIN_LABEL)].map((m) => m[1] ?? ''));
  const scrubbed = chain
    .replace(/text="(?:[^"\\]|\\.)*"/g, '')
    .replace(/href="(?:[^"\\]|\\.)*"/g, '')
    .replace(/attr__(?!ph-label=)[\w-]+="(?:[^"\\]|\\.)*"/g, '')
    .replace(CHAIN_LABEL, (whole, label: string) => (LABEL_PATTERN.test(label) ? whole : ''))
    .replace(/attr_id="(?:[^"\\]|\\.)*"/g, '');
  // Each element is `tag.class…:attributes`; blank a tag that could carry a bad label.
  return scrubbed
    .split(';')
    .map((segment) => {
      const cut = segment.search(/[.:]/);
      const tag = cut === -1 ? segment : segment.slice(0, cut);
      return tag === '' || tagKept(tag, dropped) ? segment : segment.slice(tag.length);
    })
    .join(';');
}

function scrubElements(elements: unknown): unknown {
  if (!Array.isArray(elements)) return undefined;
  const dropped = droppedLabels(
    elements.flatMap((el: unknown) => {
      const v = el && typeof el === 'object' ? (el as Record<string, unknown>)['attr__ph-label'] : undefined;
      return typeof v === 'string' ? [v] : [];
    }),
  );
  return elements.map((el: unknown) => {
    const kept: Record<string, unknown> = {};
    if (el && typeof el === 'object') {
      for (const [k, v] of Object.entries(el)) {
        if (!KEPT_ELEMENT_KEYS.has(k)) continue;
        if (k === 'attr__ph-label' && !(typeof v === 'string' && LABEL_PATTERN.test(v))) continue;
        if (k === 'tag_name') {
          kept[k] = typeof v === 'string' && tagKept(v, dropped) ? v : '';
          continue;
        }
        kept[k] = LABEL_KEYS.has(k) && typeof v === 'string' ? normalizeLabel(v) : v;
      }
    }
    return kept;
  });
}

/**
 * Last stop before an event leaves the browser: hides secrets in URLs, drops page titles (they can
 * name a client), strips on-screen text and attributes from clicks, and runs custom events through
 * the shared allow-list.
 */
function scrubPersonProps(props: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!props) return props;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) out[k] = URL_KEY.test(k) && typeof v === 'string' ? scrubUrl(v) : v;
  return out;
}

function scrubHeatmap(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = {};
  for (const [url, points] of Object.entries(data)) out[scrubUrl(url)] = points;
  return out;
}

export function beforeSend<E extends OutgoingEvent>(input: E): E | null {
  if (DROPPED_EVENTS.test(input.event)) return null;
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
      else if (key === 'label' && CLICK_EVENTS.has(input.event) && typeof value === 'string' && LABEL_PATTERN.test(value)) props[key] = value;
      continue;
    }
    if (key === '$elements') props[key] = scrubElements(value);
    else if (key === '$elements_chain' && typeof value === 'string') props[key] = scrubChain(value);
    else if (key === '$heatmap_data') props[key] = scrubHeatmap(value);
    else if (URL_KEY.test(key) && typeof value === 'string') props[key] = scrubUrl(value);
    else props[key] = value;
  }
  const out = { ...input, properties: props };
  if (custom) {
    delete out.$set;
    delete out.$set_once;
  } else {
    if (out.$set) out.$set = scrubPersonProps(out.$set);
    if (out.$set_once) out.$set_once = scrubPersonProps(out.$set_once);
  }
  return out;
}
