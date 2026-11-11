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

/** Attributes that carry words a person could read (tooltips, screen-reader labels, alt text, placeholders). */
const TEXT_ATTRIBUTES = new Set([
  'alt',
  'title',
  'placeholder',
  'label',
  'value',
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'aria-roledescription',
  'aria-placeholder',
]);

/** Where a photo's address lives. Photos themselves are blocked, but their (signed) links must not leak either. */
const IMAGE_SOURCES = new Set(['src', 'srcset', 'imagesrcset', 'poster']);

/**
 * rrweb calls this for every attribute it records. Text masking does not reach attributes, and an `aria-label` or
 * `title` can say "Remove Luis", so these are masked like text (unless inside `data-ph-safe`). Photo addresses
 * (including the `<link rel="preload" as="image">` React adds for each photo) and email/phone links are always
 * masked; other links lose their query, tokens and ids. Layout attributes (class, style) stay so the recording
 * still looks right.
 */
export function maskAttribute(name: string, value: string, el?: Element | null): string {
  const key = name.toLowerCase();
  if (IMAGE_SOURCES.has(key)) return stars(value);
  if (key === 'href') {
    if (/^\s*(mailto|tel|sms):/i.test(value)) return stars(value);
    if (el?.tagName === 'LINK' && el.getAttribute('as') === 'image') return stars(value);
    return scrubUrl(value);
  }
  if (!TEXT_ATTRIBUTES.has(key)) return value;
  return el?.closest(SAFE) ? value : stars(value);
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
