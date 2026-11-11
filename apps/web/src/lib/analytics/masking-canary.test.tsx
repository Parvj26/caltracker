// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { record } from 'posthog-js/rrweb';
import { describe, expect, it } from 'vitest';
import { Button, Chip, Tile } from '@/components/ui';
import { CoachAvatar } from '@/components/coach-avatar';
import { RECORDING_CONFIG } from './replay-config';

/**
 * Masking canary: records a page full of a fake client's details with the rrweb recorder that ships inside
 * posthog-js, configured the way posthog-js configures it from our `session_recording` options, and checks the
 * recorded payload never contains the canary while fixed copy marked `data-ph-safe` stays readable.
 */

const CANARY = 'Zebracanary';

/**
 * posthog-js 1.447.3 `LazyLoadedSessionRecording._startRecorder`: these defaults, then every key of
 * `config.session_recording` that is one of them, then the masking trio (client config wins over the project's).
 * Keys not listed here (recordHeaders, maskCapturedNetworkRequestFn…) belong to the network plugin, not rrweb.
 */
const POSTHOG_RRWEB_DEFAULTS: Record<string, unknown> = {
  blockClass: 'ph-no-capture',
  blockSelector: undefined,
  ignoreClass: 'ph-ignore-input',
  maskTextClass: 'ph-mask',
  maskTextSelector: undefined,
  maskTextFn: undefined,
  maskAllInputs: true,
  maskInputOptions: { password: true },
  maskInputFn: undefined,
  maskAllElementAttributes: false,
  maskAttributeFn: undefined,
  slimDOMOptions: {},
  collectFonts: false,
  inlineStylesheet: true,
  inlineStylesheetBudgetRules: 10000,
  recordCrossOriginIframes: false,
  sampling: undefined,
  attributeFilter: undefined,
};

function rrwebOptionsLikePosthog(user: Record<string, unknown>): Record<string, unknown> {
  const options: Record<string, unknown> = { ...POSTHOG_RRWEB_DEFAULTS };
  for (const [key, value] of Object.entries(user)) if (key in options) options[key] = value;
  return options;
}

function page(): string {
  return renderToStaticMarkup(
    <main>
      <h1>{CANARY} Testperson</h1>
      <p className="note">Knee injury, told {CANARY} to rest</p>
      <input defaultValue={CANARY} />
      <input type="email" defaultValue={`${CANARY.toLowerCase()}@example.com`} />
      <textarea defaultValue={`${CANARY} notes`} />
      <select defaultValue="z">
        <option value="z">{CANARY}</option>
      </select>
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain photo, as the app renders private photos */}
      <img alt={CANARY} src={`https://x/storage/${CANARY}.jpg`} />
      <CoachAvatar url={null} name={`${CANARY} Testperson`} seed="seed" />
      <button type="button" aria-label={`Remove ${CANARY}`} title={CANARY}>
        Remove {CANARY}
      </button>
      <a href={`mailto:${CANARY.toLowerCase()}@example.com`}>Email</a>
      <Button phSafe>Save</Button>
      <Button>Assign to {CANARY}</Button>
      <Chip phSafe>Past client</Chip>
      <Chip>{CANARY}</Chip>
      <Tile phSafe tone="lime" label="Workouts this week" value={`${CANARY} 7`} />
    </main>,
  );
}

function recordFullSnapshot(): string {
  document.body.innerHTML = page();
  const events: unknown[] = [];
  const stop = record({
    emit: (e: unknown) => events.push(e),
    ...rrwebOptionsLikePosthog(RECORDING_CONFIG.session_recording),
  });
  stop?.();
  // type 2 = FullSnapshot: the whole page as recorded.
  const full = events.filter((e) => (e as { type?: number }).type === 2);
  expect(full.length).toBe(1);
  return JSON.stringify(events);
}

describe('masking canary (session recordings)', () => {
  it('records nothing of the client: names, notes, typed values, photos, labels, emails', () => {
    const json = recordFullSnapshot();
    expect(json).not.toContain(CANARY);
    expect(json.toLowerCase()).not.toContain(CANARY.toLowerCase());
  });

  it('keeps fixed copy marked data-ph-safe readable', () => {
    const json = recordFullSnapshot();
    expect(json).toContain('Save');
    expect(json).toContain('Past client');
    expect(json).toContain('Workouts this week');
  });

  it('records nothing of the client in later changes either: new text, typing, attributes', async () => {
    document.body.innerHTML = '<main><input id="name"><p id="msg">Hello</p></main>';
    const events: unknown[] = [];
    const stop = record({ emit: (e: unknown) => events.push(e), ...rrwebOptionsLikePosthog(RECORDING_CONFIG.session_recording) });
    const input = document.getElementById('name') as HTMLInputElement;
    input.value = CANARY;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const p = document.getElementById('msg') as HTMLElement;
    p.textContent = `Message from ${CANARY}`;
    p.setAttribute('title', CANARY);
    const added = document.createElement('h2');
    added.textContent = `${CANARY} Testperson`;
    document.body.append(added);
    await new Promise((r) => setTimeout(r, 50));
    stop?.();
    // type 3 = IncrementalSnapshot: the changes were recorded, and masked.
    expect(events.some((e) => (e as { type?: number }).type === 3)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(CANARY);
  });

  it('is a real canary: without our options the canary would be recorded', () => {
    document.body.innerHTML = page();
    const events: unknown[] = [];
    const stop = record({ emit: (e: unknown) => events.push(e), ...POSTHOG_RRWEB_DEFAULTS });
    stop?.();
    expect(JSON.stringify(events)).toContain(CANARY);
  });
});
