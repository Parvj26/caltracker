import type { PostHogConfig } from 'posthog-js';
import { scrubUrl } from '@caltracker/shared';

/**
 * Session recordings on the coach website: "hide everything, show only what we mark safe" (spec: better usage
 * insight, section 1). All page text is masked; only text inside an element marked `data-ph-safe` (fixed product
 * copy such as button and menu labels) is shown. Every input is masked, photos/video/canvas are grey boxes, and no
 * network requests or console messages are recorded.
 */

const SAFE = '[data-ph-safe]';

function stars(text: string): string {
  return '*'.repeat(text.length);
}

/** rrweb calls this for every text node (with `maskTextSelector: '*'`): shown only inside `data-ph-safe`. */
export function maskText(text: string, el?: HTMLElement | null): string {
  return el?.closest(SAFE) ? text : stars(text);
}

/** Readable words (tooltips, screen-reader labels, alt text): shown only inside `data-ph-safe` (fixed copy). */
const SAFE_TEXT_ATTRIBUTES = new Set(['alt', 'title', 'placeholder', 'aria-label', 'aria-description', 'aria-roledescription']);

/**
 * Attributes that only shape how the page looks or behaves, never what a person entered: recorded as they are so
 * the replay renders. Everything not listed here is masked (deny by default), so a new attribute is hidden until
 * someone decides it is safe. SVG geometry is kept for icons; charts are blocked whole (`data-ph-block`), so their
 * data-driven geometry is never recorded. `points` is not kept.
 */
const LAYOUT_ATTRIBUTES = new Set([
  // styling and structure
  'class', 'style', '_csstext', 'role', 'type', 'tabindex', 'rel', 'as', 'media', 'dir', 'lang', 'hidden', 'inert',
  'disabled', 'checked', 'selected', 'readonly', 'required', 'multiple', 'open', 'draggable', 'contenteditable',
  'width', 'height',
  // SVG icons and the logo
  'xmlns', 'viewbox', 'focusable', 'fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'preserveaspectratio', 'd', 'r', 'rx', 'ry', 'cx', 'cy', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'transform', 'text-anchor', 'dominant-baseline',
  // widget state (true/false/page, never content)
  'aria-hidden', 'aria-expanded', 'aria-selected', 'aria-current', 'aria-disabled', 'aria-modal', 'aria-pressed',
  'aria-checked', 'aria-busy', 'aria-live', 'aria-haspopup', 'aria-orientation', 'aria-required', 'aria-invalid',
  'aria-multiselectable', 'aria-sort', 'aria-level', 'aria-posinset', 'aria-setsize', 'aria-colcount', 'aria-rowcount',
  'aria-colindex', 'aria-rowindex',
  // our own markers (fixed labels and codes)
  'data-ph-safe', 'data-ph-block', 'data-ph-capture-attribute-label', 'data-error-code',
  // layout rrweb itself adds to blocked elements (their size and position)
  'rr_width', 'rr_height', 'rr_left', 'rr_top', 'rr_position', 'rr_transform', 'rr_display', 'rr_scrollleft',
  'rr_scrolltop', 'rr_mediastate', 'rr_open_mode',
]);

/** Styling hooks the CSS reads (`[data-screen='thread']`): kept only while the value is a plain word like `true`. */
const STYLE_HOOKS = new Set([
  'data-loaded', 'data-over', 'data-state', 'data-screen', 'data-message', 'data-unread', 'data-here', 'data-flash',
  'data-on-now', 'data-preview', 'data-preview-tile', 'data-drop', 'data-mine', 'data-avatar', 'data-coach-sidebar',
  'data-nav-badge', 'data-menu-dot', 'data-menu-backdrop', 'data-live',
]);
const PLAIN_WORD = /^[a-z]+(-[a-z]+)*$|^$/;

/** Attributes that point at another element by id (labels, tabs, menus). Kept so the page structure holds. */
const REFERENCES = new Set(['id', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns', 'aria-activedescendant', 'aria-errormessage', 'form', 'list', 'headers']);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function reference(value: string): string {
  const scrubbed = value.replace(UUID, '[id]');
  return /@|\d{4,}/.test(scrubbed) ? stars(value) : scrubbed;
}

/**
 * rrweb calls this for every attribute it records. Deny by default: only layout, styling and behaviour attributes
 * (above) are kept. Everything else is masked: dates (`datetime`, `data-date`), record ids (`data-client-id`), test
 * ids, numbers (`aria-valuenow`), every link and photo address (paths can hold file names), and readable words
 * (`aria-label="Remove Luis"`, `title`, `alt`) unless they sit inside `data-ph-safe`.
 */
export function maskAttribute(name: string, value: string, el?: Element | null): string {
  const key = name.toLowerCase();
  // Inline percentages are progress bars drawn from client numbers (macros eaten, sets done): all shown as 50%.
  if (key === 'style') return value.replace(/-?\d+(\.\d+)?%/g, '50%');
  if (LAYOUT_ATTRIBUTES.has(key)) return value;
  if (STYLE_HOOKS.has(key)) return PLAIN_WORD.test(value) ? value : stars(value);
  if (REFERENCES.has(key)) return reference(value);
  if (SAFE_TEXT_ATTRIBUTES.has(key) && el?.closest(SAFE)) return value;
  return stars(value);
}

type RecordingConfig = {
  session_recording: Required<
    Pick<
      NonNullable<PostHogConfig['session_recording']>,
      'maskAllInputs' | 'maskTextSelector' | 'blockSelector' | 'recordHeaders' | 'recordBody' | 'recordCrossOriginIframes'
    >
  > & {
    maskTextFn: typeof maskText;
    maskAttributeFn: typeof maskAttribute;
    maskCapturedNetworkRequestFn: <R extends { name: string }>(req: R) => R;
  };
  capture_performance: { network_timing: false };
  enable_recording_console_log: false;
};

/** Spread into `posthog.init`. Recording itself still only starts via `startReplay()` (coach pages, env switch on). */
export const RECORDING_CONFIG: RecordingConfig = {
  session_recording: {
    maskAllInputs: true, // every input, textarea, select: always masked
    maskTextSelector: '*', // all page text masked by default
    maskTextFn: maskText,
    maskAttributeFn: maskAttribute,
    blockSelector: 'img, picture, video, canvas, [data-ph-block]', // photos, avatars, charts: grey box
    recordHeaders: false,
    recordBody: false,
    recordCrossOriginIframes: false,
    maskCapturedNetworkRequestFn: (req) => ({ ...req, name: scrubUrl(req.name) }), // also scrubs the page URL in the player
  },
  capture_performance: { network_timing: false },
  enable_recording_console_log: false,
};

// Compile-time proof that every option name and value type is one posthog-js accepts.
RECORDING_CONFIG satisfies Partial<PostHogConfig>;
